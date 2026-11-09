import { generateObject } from "ai";
import { z } from "zod";
import { listModels, classifyAiError } from "./client";
import { kimiGw } from "./provider";

const commitmentSchema = z.object({
  isCommitment: z.boolean(),
  confidence: z.number().min(0).max(1),
  title: z.string().max(1500),
  owner: z.string().max(255),
  due: z.string().max(16),
  changeType: z.enum(["create", "update"]),
  existingTaskId: z.string().max(64).nullable(),
});

export type CommitmentAnalysis = z.infer<typeof commitmentSchema>;

export async function analyzeCommitmentSignal(text: string, authorName: string): Promise<CommitmentAnalysis> {
  try {
    const { defaultModelId } = await listModels();
    const { object } = await generateObject({
      model: kimiGw(defaultModelId),
      schema: commitmentSchema,
      system: "Ты выделяешь из одного сообщения проектного чата только явные обязательства: обещание выполнить действие, прислать результат, согласовать, перенести срок. Обычное обсуждение, вопрос, риск без обязательства и информационное сообщение не являются обязательством. Не выдумывай действие, ответственного, дату или существующий ID поручения. Для нового обязательства changeType=create, existingTaskId=null. Для переноса срока существующего поручения changeType=update и existingTaskId указывай только если он явно известен из текста. Если ID неизвестен, используй null. Дату пиши DD.MM.YYYY или YYYY-MM-DD, если её нет — «—». Пиши title по-русски, кратко и конкретно.",
      messages: [{ role: "user", content: `Автор: ${authorName}\nСообщение:\n${text.slice(0, 12000)}` }],
    });
    return object;
  } catch (error) {
    throw classifyAiError(error);
  }
}
