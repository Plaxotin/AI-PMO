import { Hono } from "hono";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { log } from "../lib/logger";
import { analyzeProjectSignal } from "../ai/risk";
import { getTelegramConfig, telegramCredentialDiagnostics, telegramRole } from "../telegram/config";
import { getTelegramChatMigration } from "../telegram/migration";
import { answerTelegramCallback, editTelegramMessage, sendTelegramMessage } from "../telegram/client";
import { decideProposalRecord } from "../queries/pmo";
import { claimTelegramUpdate, completeTaskResult, createRiskProposal, createTelegramSignal, findPendingResult, finishTelegramUpdate, getRiskProposal, getTaskWithDecision, markTelegramSignal, migrateTelegramChat, requestTaskResult, resolveTelegramProjectChat, setResultPromptMessage } from "../queries/telegram";

const userSchema = z.object({ id: z.number(), first_name: z.string(), last_name: z.string().optional(), username: z.string().optional(), is_bot: z.boolean().optional() });
const messageSchema = z.object({ message_id: z.number(), text: z.string().optional(), from: userSchema.optional(), chat: z.object({ id: z.number() }), reply_to_message: z.object({ message_id: z.number() }).optional(), migrate_to_chat_id: z.number().optional(), migrate_from_chat_id: z.number().optional() });
const updateSchema = z.object({ update_id: z.number(), message: messageSchema.optional(), callback_query: z.object({ id: z.string(), from: userSchema, data: z.string().optional(), message: messageSchema.optional() }).optional() }).passthrough();

type TelegramUser = z.infer<typeof userSchema>;
type TelegramMessage = z.infer<typeof messageSchema>;

function person(user: TelegramUser) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ");
}

function safeSecretEqual(actual: string, expected: string) {
  const a = createHmac("sha256", "telegram-webhook").update(actual).digest();
  const b = createHmac("sha256", "telegram-webhook").update(expected).digest();
  return timingSafeEqual(a, b);
}

function proposalText(bundle: NonNullable<Awaited<ReturnType<typeof getRiskProposal>>>) {
  const { decision, risk, signal } = bundle;
  return `⚠️ ${risk?.id || "Риск"} · ${risk?.probability || "оценка"}\n${risk?.title || ""}\n\nВлияние: ${risk?.impact || "—"}\n\nПредложение ${decision.id}:\n${decision.title}\n\nОтветственный: ${decision.proposalOwner || "Руководитель проекта"}\nСрок: ${decision.proposalDue || "—"}\n\nИсточник: Telegram · чат ${signal?.chatId || "—"} · сообщение ${signal?.messageId || "—"} · ${signal?.authorName || "—"}`;
}

function proposalButtons(decisionId: string, riskId: string) {
  return [[{ text: "⚠️ Открыть риск", callback_data: `open:${riskId}` }, { text: "✅ Принять предложение", callback_data: `accept:${decisionId}` }], [{ text: "Отклонить", callback_data: `reject:${decisionId}` }]];
}

async function handleMessage(message: TelegramMessage, updateId: number, channelId: string) {
  const config = getTelegramConfig();
  const user = message.from;
  const text = message.text?.trim();
  if (!user || user.is_bot || !text) return "ignored" as const;
  const role = telegramRole(user.id, config);
  if (!role) return "ignored" as const;
  const chatId = String(message.chat.id);

  if (message.reply_to_message) {
    const pending = await findPendingResult({ chatId, userId: String(user.id), replyToMessageId: message.reply_to_message.message_id });
    if (pending) {
      const completion = await completeTaskResult({ pendingId: pending.id, taskId: pending.taskId, result: text, actorUserId: user.id, actorName: person(user), actorRole: role });
      await sendTelegramMessage({ chatId, replyToMessageId: message.message_id, text: completion.alreadyCompleted ? `Результат по ${pending.taskId} уже был сохранён.` : `✅ Результат по ${pending.taskId} сохранён.\nПоручение отмечено выполненным, событие добавлено в журнал.` });
      return "processed" as const;
    }
  }

  if (text.startsWith("/start") || text.startsWith("/status")) {
    await sendTelegramMessage({ chatId, text: `Пиэмка · AI PMO\nЧат привязан к проекту PRJ-01.\nВаша роль: ${role === "rp" ? "РП" : "участник"}.\n\nСообщение с риском будет проанализировано. РП утверждает предложения кнопками; результат отправляется ответом на запрос бота.` });
    return "processed" as const;
  }

  const { signal, created } = await createTelegramSignal({ updateId, channelId, chatId, messageId: message.message_id, authorId: String(user.id), authorName: person(user), authorRole: role, text });
  if (!created) return "processed" as const;
  let analysis: Awaited<ReturnType<typeof analyzeProjectSignal>>;
  try {
    analysis = await analyzeProjectSignal(text, person(user));
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await markTelegramSignal(signal.id, "error", messageText);
    log.error("Telegram signal analysis failed", { signalId: signal.id, error: messageText });
    await sendTelegramMessage({ chatId, replyToMessageId: message.message_id, text: `Сигнал ${signal.id} сохранён, но AI-анализ сейчас недоступен. Риск и предложение не созданы. Повторите отправку позже или проверьте сигнал в веб-реестре.` });
    return "error" as const;
  }
  if (!analysis.isRisk || analysis.confidence < 0.6) {
    await markTelegramSignal(signal.id, "ignored");
    return "ignored" as const;
  }
  const ids = await createRiskProposal(signal.id, updateId, analysis);
  const bundle = await getRiskProposal(ids.decisionId);
  if (!bundle) throw new Error("Не удалось прочитать созданное предложение");
  await sendTelegramMessage({ chatId, replyToMessageId: message.message_id, text: proposalText(bundle), buttons: proposalButtons(ids.decisionId, ids.riskId) });
  return "processed" as const;
}


async function handleCallback(callback: NonNullable<z.infer<typeof updateSchema>["callback_query"]>) {
  const config = getTelegramConfig();
  const role = telegramRole(callback.from.id, config);
  if (!role) {
    await answerTelegramCallback(callback.id, "Нет доступа к проекту");
    return "ignored" as const;
  }
  const [action, entityId] = (callback.data || "").split(":");
  const message = callback.message;
  if (!message || !entityId) return "ignored" as const;
  const chatId = String(message.chat.id);

  if (action === "open") {
    const bundle = await getRiskProposal(entityId.replace(/^R-/, "D-"));
    if (!bundle) { await answerTelegramCallback(callback.id, "Риск не найден"); return "error" as const; }
    await answerTelegramCallback(callback.id, `Открыт ${entityId}`);
    await sendTelegramMessage({ chatId, text: `${proposalText(bundle)}\n\nОбоснование: ${bundle.decision.rationale}\nЭффект: ${bundle.decision.effect}\n\nИсходный сигнал:\n${bundle.signal?.content || "—"}`, buttons: bundle.decision.status === "wait" && bundle.risk ? proposalButtons(bundle.decision.id, bundle.risk.id) : undefined });
    return "processed" as const;
  }

  if (action === "accept" || action === "reject") {
    if (role !== "rp") { await answerTelegramCallback(callback.id, "Утверждает только руководитель проекта"); return "ignored" as const; }
    try {
      const result = await decideProposalRecord({ decisionId: entityId, action: action === "accept" ? "ok" : "no" }, { userId: callback.from.id, name: person(callback.from), channel: "telegram" });
      const bundle = await getRiskProposal(entityId);
      if (!bundle) throw new Error("Решение не найдено после обработки");
      if (result.status === "ok" && result.taskId) {
        const taskBundle = await getTaskWithDecision(result.taskId);
        const taskText = result.alreadyDecided
          ? `Поручение ${result.taskId} уже связано с решением.`
          : `Поручение ${result.taskId} создано и связано с решением.`;
        await editTelegramMessage({ chatId, messageId: message.message_id, text: `✅ Решение ${entityId} ${result.alreadyDecided ? "уже было принято" : "принято"}\n${bundle.decision.title}\n\n${taskText}\nОтветственный: ${taskBundle?.task.owner || "—"}\nСрок: ${taskBundle?.task.due || "—"}\n\n${bundle.decision.attribution || `Пиэмка от имени ${person(callback.from)}`}`, buttons: [[{ text: "📌 Отметить результат", callback_data: `result:${result.taskId}` }]] });
      } else {
        await editTelegramMessage({ chatId, messageId: message.message_id, text: `Решение ${entityId} ${result.alreadyDecided ? "уже было отклонено" : "отклонено"}.\n${bundle.decision.attribution || `Пиэмка от имени ${person(callback.from)}`}` });
      }
      await answerTelegramCallback(callback.id, result.alreadyDecided ? "Решение уже обработано; показано сохранённое состояние" : result.status === "ok" ? `Создано поручение ${result.taskId}` : "Решение отклонено");
      return "processed" as const;
    } catch (error) {
      await answerTelegramCallback(callback.id, error instanceof Error && error.message.includes("уже") ? "Решение уже обработано" : "Не удалось сохранить решение");
      return "error" as const;
    }
  }

  if (action === "result") {
    const bundle = await getTaskWithDecision(entityId);
    if (!bundle) { await answerTelegramCallback(callback.id, "Поручение не найдено"); return "error" as const; }
    if (bundle.task.status === "done") { await answerTelegramCallback(callback.id, "Результат уже сохранён"); return "processed" as const; }
    const pendingId = await requestTaskResult({ taskId: entityId, chatId, userId: String(callback.from.id) });
    const prompt = await sendTelegramMessage({ chatId, text: `Результат по ${entityId}.\nОтветьте на это сообщение: что сделано, когда и какой итог?`, forceReply: true });
    await setResultPromptMessage(pendingId, prompt.message_id);
    await answerTelegramCallback(callback.id, "Ответьте на запрос бота");
    return "processed" as const;
  }
  return "ignored" as const;
}

export const telegramRoutes = new Hono();

telegramRoutes.post("/webhook", async (c) => {
  const config = getTelegramConfig();
  if (!config.configured) return c.json({ ok: false, error: "Telegram не настроен", diagnostics: telegramCredentialDiagnostics() }, 503);
  if (!safeSecretEqual(c.req.header("x-telegram-bot-api-secret-token") || "", config.webhookSecret)) return c.json({ ok: false, error: "Неверный секрет webhook" }, 401);
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: "Некорректный update" }, 400);
  const update = parsed.data;
  const migration = getTelegramChatMigration(update.message);
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  const binding = await resolveTelegramProjectChat(String(migration?.oldChatId ?? chatId), config.projectChatIds);
  if (!binding) return c.json({ ok: true, ignored: "chat" });
  const claimed = await claimTelegramUpdate(update.update_id, update);
  if (!claimed) return c.json({ ok: true, duplicate: true });
  try {
    const status = migration && update.message
      ? await migrateTelegramChat({ ...migration, messageChatId: String(update.message.chat.id), messageId: update.message.message_id }).then(() => "processed" as const)
      : update.callback_query
        ? await handleCallback(update.callback_query)
        : update.message
          ? await handleMessage(update.message, update.update_id, binding.channelId)
          : "ignored";
    await finishTelegramUpdate(update.update_id, status, status === "error" ? "Обработка завершилась с ошибкой" : undefined);
    return c.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishTelegramUpdate(update.update_id, "error", message);
    log.error("Telegram update failed", { updateId: update.update_id, error: message });
    return c.json({ ok: false, error: "Update сохранён для диагностики" }, 500);
  }
});
