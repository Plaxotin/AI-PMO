import { generateObject } from "ai";
import { z } from "zod";
import { listModels, classifyAiError } from "./client";
import { kimiGw } from "./provider";

const proposalEditSchema = z.object({
  title: z.string().min(1).max(1500),
  owner: z.string().min(1).max(255),
  due: z.string().min(1).max(16),
});

export async function reviseProjectProposal(input: {
  title: string;
  owner: string;
  due: string;
  instruction: string;
}) {
  try {
    const { defaultModelId } = await listModels();
    const { object } = await generateObject({
      model: kimiGw(defaultModelId),
      schema: proposalEditSchema,
      system: "Ты редактор управленческого предложения AI PMO. Примени ровно одну текстовую инструкцию РП к текущему предложению. Верни новые title, owner и due. Не изменяй поля, которых не касается инструкция. Не выдумывай факты, людей, даты или эффекты. Сохраняй Supported date formats DD.MM.YYYY или YYYY-MM-DD; если срок не задан в исходном тексте или инструкции, оставь исходный.",
      messages: [{
        role: "user",
        content: `Текущее предложение: ${input.title}\nТекущий ответственный: ${input.owner}\nТекущий срок: ${input.due}\nИнструкция РП: ${input.instruction.slice(0, 4000)}`,
      }],
    });
    return object;
  } catch (error) {
    throw classifyAiError(error);
  }
}
