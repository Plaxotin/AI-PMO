import { Hono } from "hono";
import { z } from "zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { log } from "../lib/logger";
import { analyzeProjectSignalDetailed } from "../ai/risk";
import { analyzeCommitmentSignal } from "../ai/commitment";
import { buildLearningContext, recordLearningContextUsage } from "../queries/learning-context";
import { acceptCommitmentCandidate, createCommitmentCandidate, hasCommitmentCandidate, ignoreCommitmentCandidate, mergeCommitmentCandidate, rejectCommitmentCandidate } from "../queries/commitment";
import { getTelegramConfig, telegramCredentialDiagnostics, telegramRole } from "../telegram/config";
import { getTelegramChatMigration } from "../telegram/migration";
import { answerTelegramCallback, editTelegramMessage, sendTelegramMessage, type TelegramButton } from "../telegram/client";
import { decideProposalRecord } from "../queries/pmo";
import { claimTelegramUpdate, createRiskProposal, createTelegramSignal, finishTelegramUpdate, getRiskProposal, getRiskProposalByRiskId, getTaskWithDecision, markTelegramSignal, migrateTelegramChat, resolveTelegramProjectChat } from "../queries/telegram";
import { answerCompletionCheck } from "../queries/completion";
import { deliverEffectNotification } from "../telegram/completion-scheduler";
import { deliverOnboardingMessages } from "../telegram/first-value";
import { recordRiskOpened } from "../queries/first-value";
import { reviseProjectProposal } from "../ai/proposal-edit";
import { buildProposalDiff, telegramSourceLink } from "../queries/proposal-audit";
import { cancelTelegramProposalEdit, claimTelegramEditInstruction, completeTelegramProposalEdit, failTelegramProposalPreview, getActiveTelegramProposalEdit, saveTelegramProposalPreview, startTelegramProposalEdit } from "../queries/telegram-edit";

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
  const source = signal ? telegramSourceLink(signal.chatId, signal.messageId) : null;
  const sourceText = source?.url || `источник недоступен; сохранён sourceId ${source?.sourceId || "—"}`;
  return `⚠️ ${risk?.id || "Риск"} · ${risk?.probability || "оценка"}\n${risk?.title || ""}\n\nВлияние: ${risk?.impact || "—"}\n\nПредложение ${decision.id}:\n${decision.title}\n\nОтветственный: ${decision.proposalOwner || "Руководитель проекта"}\nСрок: ${decision.proposalDue || "—"}\n\nИсточник: ${sourceText} · ${signal?.authorName || "—"}`;
}

function proposalButtons(decisionId: string, riskId: string, opened = false) {
  if (opened) return [[{ text: "✅ Принять", callback_data: `accept:${decisionId}` }, { text: "Изменить", callback_data: `edit:${decisionId}` }], [{ text: "Отклонить", callback_data: `reject:${decisionId}` }]];
  return [[{ text: "⚠️ Открыть риск", callback_data: `open:${riskId}` }, { text: "✅ Принять", callback_data: `accept:${decisionId}` }], [{ text: "Изменить", callback_data: `edit:${decisionId}` }]];
}

function previewText(decision: { id: string; title: string; rationale: string; effect: string; proposalOwner: string | null; proposalDue: string | null; proposalVersion: number }, edit: { previewTitle: string | null; previewOwner: string | null; previewDue: string | null }) {
  const before = { title: decision.title, rationale: decision.rationale, effect: decision.effect, owner: decision.proposalOwner || "Руководитель проекта", due: decision.proposalDue || "—" };
  const after = { ...before, title: edit.previewTitle || before.title, owner: edit.previewOwner || before.owner, due: edit.previewDue || before.due };
  const change = buildProposalDiff(before, after);
  return `Новый предпросмотр ${decision.id} · версия ${decision.proposalVersion} → ${decision.proposalVersion + 1}\n\nПредложение:\n${after.title}\n\nОтветственный: ${after.owner}\nСрок: ${after.due}\n\nОбоснование: ${after.rationale}\nЭффект: ${after.effect}\n\nDiff:\n${change.diff || "Изменений нет"}\n\nИсходная версия не изменена. Решение и поручение будут созданы только после «Принять».`;
}

function statusText(role: "rp" | "member") {
  return `Пиэмка · AI PMO\nЧат привязан к проекту PRJ-01.\nВаша роль: ${role === "rp" ? "РП" : "участник"}.\n\nРабочие чаты используются только для наблюдения. Предложения, решения и персональные действия доступны РП в этом личном чате.`;
}

async function notifyRp(text: string, buttons?: TelegramButton[][]) {
  const config = getTelegramConfig();
  if (!config.rpUserIds.size) throw new Error("Личный чат РП не настроен");
  for (const chatId of config.rpUserIds) {
    await sendTelegramMessage({ chatId, text, buttons });
  }
}

export async function handlePrivateMessage(message: TelegramMessage) {
  const user = message.from;
  const text = message.text?.trim();
  if (!user || user.is_bot || !text || telegramRole(user.id) !== "rp" || String(message.chat.id) !== String(user.id)) return "ignored" as const;
  const chatId = String(message.chat.id);
  if (text.startsWith("/start") || text.startsWith("/status")) {
    await sendTelegramMessage({ chatId, text: statusText("rp") });
    return "processed" as const;
  }
  const claimed = await claimTelegramEditInstruction({ chatId, userId: String(user.id), instruction: text });
  if (!claimed) return "ignored" as const;
  try {
    const revised = await reviseProjectProposal({
      title: claimed.decision.title,
      owner: claimed.decision.proposalOwner || person(user),
      due: claimed.decision.proposalDue || "—",
      instruction: text,
    });
    const preview = await saveTelegramProposalPreview({ editId: claimed.edit.id, ...revised });
    if (!preview) {
      await sendTelegramMessage({ chatId, text: "Ветка редактирования отменена; исходное предложение не изменено." });
      return "ignored" as const;
    }
    await sendTelegramMessage({
      chatId,
      text: previewText(claimed.decision, preview),
      buttons: [[{ text: "✅ Принять", callback_data: `accept:${claimed.decision.id}` }, { text: "Отменить правку", callback_data: `editcancel:${claimed.decision.id}` }]],
    });
    return "processed" as const;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await failTelegramProposalPreview(claimed.edit.id, messageText);
    await sendTelegramMessage({ chatId, text: `Не удалось подготовить новый предпросмотр. Исходное предложение не изменено. Отправьте правку ещё раз или отмените редактирование.\n${messageText.slice(0, 500)}` });
    return "error" as const;
  }
}

async function handleMessage(message: TelegramMessage, updateId: number, channelId: string) {
  const config = getTelegramConfig();
  const user = message.from;
  const text = message.text?.trim();
  if (!user || user.is_bot || !text) return "ignored" as const;
  const role = telegramRole(user.id, config);
  if (!role) return "ignored" as const;
  const chatId = String(message.chat.id);

  if (text.startsWith("/start") || text.startsWith("/status")) {
    if (role === "rp") {
      await notifyRp(statusText(role));
      return "processed" as const;
    }
    return "ignored" as const;
  }

  const { signal, created } = await createTelegramSignal({ updateId, channelId, chatId, messageId: message.message_id, authorId: String(user.id), authorName: person(user), authorRole: role, text });
  if (!created) return "processed" as const;
  const learningContext = await buildLearningContext();
  let analysisResult: Awaited<ReturnType<typeof analyzeProjectSignalDetailed>>;
  try {
    analysisResult = await analyzeProjectSignalDetailed(text, person(user), learningContext);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await markTelegramSignal(signal.id, "error", messageText);
    log.error("Telegram signal analysis failed", { signalId: signal.id, error: messageText });
    await notifyRp(`Сигнал ${signal.id} сохранён, но AI-анализ сейчас недоступен. Риск и предложение не созданы. Повторите отправку позже или проверьте сигнал в веб-реестре.`);
    return "error" as const;
  }
  const { analysis, modelId } = analysisResult;
  if (!analysis.isRisk || analysis.confidence < 0.6) {
    try {
      const commitment = await analyzeCommitmentSignal(text, person(user));
      if (commitment.isCommitment && commitment.confidence >= 0.6) {
        const evidenceHash = createHash("sha256").update(`${signal.id}:${text}`).digest("hex");
        const createdCommitment = await createCommitmentCandidate({
          signalId: signal.id,
          title: commitment.title,
          owner: commitment.owner || person(user),
          due: commitment.due,
          confidence: commitment.confidence,
          changeType: commitment.changeType,
          existingTaskId: commitment.existingTaskId || undefined,
          evidenceHash,
        });
        if (createdCommitment.candidate.status === "pending_merge") {
          await notifyRp(
            `🤝 Похоже на существующее поручение ${createdCommitment.candidate.existingTaskId} (совпадение ≥ 92%).\n${createdCommitment.candidate.title}\nОтветственный: ${createdCommitment.candidate.owner}\nСрок: ${createdCommitment.candidate.due}\n\nОбъединить вместо создания нового поручения?`,
            [[{ text: "Объединить", callback_data: `merge:${createdCommitment.candidate.id}` }], [{ text: "Игнорировать", callback_data: `ignore:${createdCommitment.candidate.id}` }]],
          );
        } else {
          const decisionId = createdCommitment.decisionId!;
          const bundle = await getRiskProposal(decisionId);
          if (!bundle) throw new Error("Не удалось прочитать предложение обязательства");
          await notifyRp(proposalText(bundle), proposalButtons(decisionId, ""));
        }
        return "processed" as const;
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await markTelegramSignal(signal.id, "error", messageText);
      log.error("Telegram commitment analysis failed", { signalId: signal.id, error: messageText });
      await notifyRp(`Сигнал ${signal.id} сохранён, но обязательство не удалось проанализировать. Поручение не создано.`);
      return "error" as const;
    }
    await markTelegramSignal(signal.id, "ignored");
    return "ignored" as const;
  }
  const ids = await createRiskProposal(signal.id, updateId, analysis);
  await recordLearningContextUsage({ proposalId: ids.decisionId, proposalVersion: 1, modelId, context: learningContext });
  const bundle = await getRiskProposal(ids.decisionId);
  if (!bundle) throw new Error("Не удалось прочитать созданное предложение");
  await notifyRp(proposalText(bundle), proposalButtons(ids.decisionId, ids.riskId));
  return "processed" as const;
}


export async function handleCallback(callback: NonNullable<z.infer<typeof updateSchema>["callback_query"]>) {
  const config = getTelegramConfig();
  const role = telegramRole(callback.from.id, config);
  if (!role) {
    await answerTelegramCallback(callback.id, "Нет доступа к проекту");
    return "ignored" as const;
  }
  const [action, reasonOrEntity, thirdSegment] = (callback.data || "").split(":");
  const entityId = thirdSegment ?? reasonOrEntity;
  const message = callback.message;
  if (!message || !entityId) return "ignored" as const;
  const chatId = String(message.chat.id);

  // All interactive actions live in the RP DM. Never edit legacy group cards.
  if (role !== "rp" || chatId !== String(callback.from.id)) {
    await answerTelegramCallback(callback.id, "Действия доступны РП в личном чате с Пиэмкой");
    return "ignored" as const;
  }

  if (action === "merge") {
    const result = await mergeCommitmentCandidate(Number(entityId), { userId: callback.from.id, name: person(callback.from), channel: "telegram" });
    await editTelegramMessage({ chatId, messageId: message.message_id, text: `✅ Кандидат объединён с поручением ${result.taskId}. Новое поручение не создано.`, buttons: [] });
    await answerTelegramCallback(callback.id, "Объединено");
    return "processed" as const;
  }

  if (action === "ignore") {
    await ignoreCommitmentCandidate(Number(entityId), { userId: callback.from.id, name: person(callback.from), channel: "telegram" });
    await editTelegramMessage({ chatId, messageId: message.message_id, text: "Кандидат проигнорирован. Новое поручение не создано.", buttons: [] });
    await answerTelegramCallback(callback.id, "Игнорировано");
    return "processed" as const;
  }

  if (action === "open") {
    const bundle = await getRiskProposalByRiskId(entityId);
    if (!bundle) { await answerTelegramCallback(callback.id, "Риск не найден"); return "error" as const; }
    await recordRiskOpened({ riskId: entityId, decisionId: bundle.decision.id, actorUserId: callback.from.id, actorName: person(callback.from) });
    await answerTelegramCallback(callback.id, `Открыт ${entityId}`);
    await sendTelegramMessage({ chatId, text: `${proposalText(bundle)}\n\nОбоснование: ${bundle.decision.rationale}\nЭффект: ${bundle.decision.effect}\n\nИсходный сигнал:\n${bundle.signal?.content || "—"}`, buttons: bundle.decision.status === "wait" && bundle.risk ? proposalButtons(bundle.decision.id, bundle.risk.id, true) : undefined });
    return "processed" as const;
  }

  if (action === "edit") {
    const started = await startTelegramProposalEdit({ decisionId: entityId, chatId, userId: String(callback.from.id) });
    if (!started) { await answerTelegramCallback(callback.id, "Предложение уже решено"); return "ignored" as const; }
    await answerTelegramCallback(callback.id, "Отправьте одну текстовую правку");
    await sendTelegramMessage({
      chatId,
      text: `Редактирование ${entityId}, версия ${started.decision.proposalVersion}. Отправьте одну текстовую инструкцию: что изменить в предложении, ответственном или сроке. Исходная версия не изменится до принятия нового предпросмотра.`,
      buttons: [[{ text: "Отменить правку", callback_data: `editcancel:${entityId}` }]],
    });
    return "processed" as const;
  }

  if (action === "editcancel") {
    const cancelled = await cancelTelegramProposalEdit({ decisionId: entityId, chatId, userId: String(callback.from.id) });
    if (!cancelled) { await answerTelegramCallback(callback.id, "Активная правка не найдена"); return "ignored" as const; }
    const bundle = await getRiskProposal(entityId);
    await answerTelegramCallback(callback.id, "Правка отменена");
    if (bundle) await sendTelegramMessage({ chatId, text: `Правка отменена. Исходная версия ${bundle.decision.proposalVersion} не изменена.\n\n${proposalText(bundle)}`, buttons: bundle.decision.status === "wait" && bundle.risk ? proposalButtons(bundle.decision.id, bundle.risk.id, true) : undefined });
    return "processed" as const;
  }

  if (action === "reject") {
    if (!await hasCommitmentCandidate(entityId)) {
      const result = await decideProposalRecord({ decisionId: entityId, action: "no" }, { userId: callback.from.id, name: person(callback.from), channel: "telegram" });
      await editTelegramMessage({ chatId, messageId: message.message_id, text: `Решение ${entityId} ${result.alreadyDecided ? "уже было отклонено" : "отклонено"}. Поручение не создано.`, buttons: [] });
      await answerTelegramCallback(callback.id, result.alreadyDecided ? "Решение уже отклонено" : "Решение отклонено");
      return "processed" as const;
    }
    await sendTelegramMessage({
      chatId,
      text: `Выберите причину отклонения ${entityId}. Решение пока не изменено.`,
      buttons: [
        [{ text: "Не обязательство", callback_data: `rejectreason:not_commitment:${entityId}` }],
        [{ text: "Уже исполнено", callback_data: `rejectreason:already_done:${entityId}` }],
        [{ text: "Неактуально", callback_data: `rejectreason:wont_do:${entityId}` }],
      ],
    });
    await answerTelegramCallback(callback.id, "Нужна причина отклонения");
    return "processed" as const;
  }

  if (action === "rejectreason") {
    if (!["not_commitment", "already_done", "wont_do"].includes(reasonOrEntity)) return "ignored" as const;
    const result = await rejectCommitmentCandidate(entityId, reasonOrEntity as "not_commitment" | "already_done" | "wont_do", { userId: callback.from.id, name: person(callback.from), channel: "telegram" });
    await editTelegramMessage({ chatId, messageId: message.message_id, text: `Решение ${entityId} отклонено с причиной: ${reasonOrEntity}. Поручение не создано.`, buttons: [] });
    await answerTelegramCallback(callback.id, result.alreadyDecided ? "Решение уже отклонено" : "Причина отклонения сохранена");
    return "processed" as const;
  }

  if (action === "accept") {
    const pendingEdit = await getActiveTelegramProposalEdit({ decisionId: entityId, chatId, userId: String(callback.from.id) });
    if (pendingEdit && pendingEdit.status !== "preview") {
      await answerTelegramCallback(callback.id, "Сначала отправьте правку или отмените редактирование");
      return "ignored" as const;
    }
    try {
      const result = await acceptCommitmentCandidate({
        decisionId: entityId,
        ...(pendingEdit?.status === "preview" ? {
          title: pendingEdit.previewTitle || undefined,
          owner: pendingEdit.previewOwner || undefined,
          due: pendingEdit.previewDue || undefined,
          expectedVersion: pendingEdit.sourceVersion,
        } : {}),
      }, { userId: callback.from.id, name: person(callback.from), channel: "telegram" });
      if (pendingEdit?.status === "preview") await completeTelegramProposalEdit({ decisionId: entityId, chatId, userId: String(callback.from.id) });
      const bundle = await getRiskProposal(entityId);
      if (!bundle) throw new Error("Решение не найдено после обработки");
      if (result.status === "ok" && result.taskId) {
        const taskBundle = await getTaskWithDecision(result.taskId);
        const taskText = result.alreadyDecided
          ? `Поручение ${result.taskId} уже связано с решением.`
          : `Поручение ${result.taskId} создано и связано с решением.`;
        await editTelegramMessage({ chatId, messageId: message.message_id, text: `✅ Решение ${entityId} ${result.alreadyDecided ? "уже было принято" : "принято"}\n${bundle.decision.title}\n\n${taskText}\nОтветственный: ${taskBundle?.task.owner || "—"}\nСрок: ${taskBundle?.task.due || "—"}\n\n${bundle.decision.attribution || `Пиэмка от имени ${person(callback.from)}`}`, buttons: [] });
      } else {
        await editTelegramMessage({ chatId, messageId: message.message_id, text: `Решение ${entityId} ${result.alreadyDecided ? "уже было отклонено" : "отклонено"}.\n${bundle.decision.attribution || `Пиэмка от имени ${person(callback.from)}`}` });
      }
      await answerTelegramCallback(callback.id, result.alreadyDecided ? "Решение уже обработано; показано сохранённое состояние" : result.status === "ok" ? `Создано поручение ${result.taskId}` : "Решение отклонено");
      return "processed" as const;
    } catch (error) {
      await answerTelegramCallback(callback.id, error instanceof Error ? error.message : "Не удалось сохранить решение");
      return "error" as const;
    }
  }

  if (action === "cd" || action === "cn") {
    const checkId = Number(entityId);
    if (!Number.isSafeInteger(checkId) || checkId <= 0) return "ignored" as const;
    try {
      const outcome = await answerCompletionCheck({
        checkId,
        chatId,
        userId: String(callback.from.id),
        answer: action === "cd" ? "done" : "not_done",
        actorUserId: callback.from.id,
        actorName: person(callback.from),
      });
      if (outcome.kind === "not_done" || outcome.kind === "already_not_done") {
        if (outcome.kind === "not_done") {
          await editTelegramMessage({
            chatId,
            messageId: message.message_id,
            text: `${message.text || `Поручение ${entityId}`}\n\nОтвет сохранён: поручение не выполнено и остаётся открытым.`,
            buttons: [[
              { text: "Выполнено", callback_data: `cd:${checkId}` },
              { text: "Не выполнено", callback_data: `cn:${checkId}` },
            ]],
          });
        }
        await answerTelegramCallback(callback.id, outcome.kind === "not_done" ? "Ответ сохранён; поручение остаётся открытым" : "Ответ уже был сохранён");
        return "processed" as const;
      }
      await answerTelegramCallback(callback.id, outcome.kind === "done" ? "Выполнение подтверждено" : "Поручение уже было закрыто");
      await deliverEffectNotification(checkId);
      if (outcome.kind === "done") {
        await editTelegramMessage({
          chatId,
          messageId: message.message_id,
          text: `${message.text || `Поручение ${entityId}`}\n\n✅ Выполнение подтверждено РП ${person(callback.from)}.`,
          buttons: [],
        });
      }
      return "processed" as const;
    } catch (error) {
      await answerTelegramCallback(callback.id, error instanceof Error ? error.message : "Не удалось сохранить ответ");
      return "error" as const;
    }
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
  const actor = update.message?.from ?? update.callback_query?.from;
  const privateRp = Boolean(actor && !actor.is_bot && telegramRole(actor.id, config) === "rp" && String(chatId) === String(actor.id));
  const binding = privateRp ? null : await resolveTelegramProjectChat(String(migration?.oldChatId ?? chatId), config.projectChatIds);
  if (!privateRp && !binding) return c.json({ ok: true, ignored: "chat" });
  const claimed = await claimTelegramUpdate(update.update_id, update);
  if (!claimed) return c.json({ ok: true, duplicate: true });
  try {
    if (binding?.onboarding) await deliverOnboardingMessages(binding.onboarding);
    const status = migration && update.message
      ? await migrateTelegramChat({ ...migration, messageChatId: String(update.message.chat.id), messageId: update.message.message_id }).then(() => "processed" as const)
      : update.callback_query
        ? await handleCallback(update.callback_query)
        : update.message
          ? privateRp
            ? await handlePrivateMessage(update.message)
            : await handleMessage(update.message, update.update_id, binding!.channelId)
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
