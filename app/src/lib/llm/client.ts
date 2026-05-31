export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export function isLlmConfigured(): boolean {
  return Boolean(
    process.env.LLM_API_KEY &&
      (process.env.LLM_API_BASE_URL ?? 'https://api.moonshot.ai/v1'),
  );
}

export async function chatCompletion(
  messages: LlmMessage[],
  options?: { maxTokens?: number; jsonMode?: boolean },
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = (process.env.LLM_API_BASE_URL ?? 'https://api.moonshot.ai/v1').replace(
    /\/$/,
    '',
  );
  const model = process.env.LLM_MODEL_ID ?? 'moonshot-v1-8k';

  if (!apiKey) {
    throw new Error('LLM_API_KEY not configured');
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: options?.maxTokens ?? 2048,
      temperature: 0.2,
      ...(options?.jsonMode
        ? { response_format: { type: 'json_object' } }
        : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM returned empty response');
  return content;
}
