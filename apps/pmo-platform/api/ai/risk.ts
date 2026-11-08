import { generateObject } from "ai";
import { z } from "zod";
import { listModels, classifyAiError } from "./client";
import { kimiGw } from "./provider";
import type { LearningContext } from "../queries/learning-context";

const riskAnalysisSchema = z.object({
  isRisk: z.boolean(),
  confidence: z.number().min(0).max(1),
  riskTitle: z.string().max(1000),
  impact: z.string().max(1500),
  probability: z.enum(["высокая", "средняя", "низкая", "активный"]),
  proposalTitle: z.string().max(1500),
  rationale: z.string().max(3000),
  effect: z.string().max(1000),
  measure: z.string().max(1500),
  owner: z.string().max(255),
  due: z.string().max(16),
});

export type RiskAnalysis = z.infer<typeof riskAnalysisSchema>;

export async function analyzeProjectSignalDetailed(
  text: string,
  authorName: string,
  learningContext?: LearningContext,
): Promise<{ analysis: RiskAnalysis; modelId: string }> {
  try {
    const { defaultModelId } = await listModels();
    const contextText = learningContext?.text
      ? `\n\nКонтекст подтверждённых эффектов:\n${learningContext.text}`
      : "";
    const { object } = await generateObject({
      model: kimiGw(defaultModelId),
      schema: riskAnalysisSchema,
      system: "Ты аналитик AI PMO. Анализируй одно сообщение из проектного Telegram-чата. Определи только управленчески значимый риск или уже наступившее событие, влияющее на сроки, стоимость, качество, ресурсы, безопасность или приёмку. Обычное обсуждение, вопрос и информационное сообщение без последствий не считай риском. Не выдумывай факты, людей, даты и эффекты. Если сведений нет, возвращай пустые owner/due и нейтральную формулировку эффекта. Если событие уже произошло, probability=активный. Пиши по-русски, кратко и конкретно. Предложение должно быть управленческим действием, которое может утвердить руководитель проекта. Исторические эффекты в контексте — только проверяемые прецеденты и ассоциации, не доказательство причинности; не переноси их численные значения на новый сигнал без основания и не повышай confidence из-за одного прецедента.",
      messages: [
        { role: "user", content: `Автор: ${authorName}\nСообщение:\n${text.slice(0, 12000)}${contextText}` },
      ],
    });
    return { analysis: object, modelId: defaultModelId };
  } catch (error) {
    throw classifyAiError(error);
  }
}

export async function analyzeProjectSignal(text: string, authorName: string, learningContext?: LearningContext): Promise<RiskAnalysis> {
  return (await analyzeProjectSignalDetailed(text, authorName, learningContext)).analysis;
}
