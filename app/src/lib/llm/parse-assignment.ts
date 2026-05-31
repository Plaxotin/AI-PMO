import { chatCompletion } from '@/lib/llm/client';
import {
  parsedAssignmentSchema,
  type ParsedAssignment,
} from '@/lib/pmi/types';

const SYSTEM_PROMPT = `You extract PMI Action Item Tracker fields from Russian or English text.
Return JSON only with keys: brief_name (required, 3-5 words), description, source, owner, priority (1=high,2=medium,3=low), target_date (YYYY-MM-DD if known).
If unknown, use null. brief_name must never be empty.`;

export async function parseAssignmentText(text: string): Promise<ParsedAssignment> {
  const raw = await chatCompletion(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
    { jsonMode: true },
  );

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM did not return JSON');
    json = JSON.parse(match[0]);
  }

  const parsed = parsedAssignmentSchema.safeParse(json);
  if (!parsed.success) {
    return {
      brief_name: text.trim().slice(0, 80) || 'Поручение',
      description: text,
      source: null,
      owner: null,
      priority: null,
      target_date: null,
    };
  }
  return parsed.data;
}

const MEETING_SYSTEM = `You split meeting transcripts into separate action items for PMI tracker.
Return JSON: { "items": [ { brief_name, description, source, owner, priority, target_date } ] }
Each item is one actionable assignment. brief_name required. Use null for unknown fields.`;

export async function parseMeetingTranscript(
  transcript: string,
  sourceLabel: string,
): Promise<ParsedAssignment[]> {
  const raw = await chatCompletion(
    [
      { role: 'system', content: MEETING_SYSTEM },
      {
        role: 'user',
        content: `Source label: ${sourceLabel}\n\nTranscript:\n${transcript.slice(0, 120_000)}`,
      },
    ],
    { jsonMode: true, maxTokens: 4096 },
  );

  let json: { items?: unknown[] };
  try {
    json = JSON.parse(raw) as { items?: unknown[] };
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM did not return JSON for meeting');
    json = JSON.parse(match[0]) as { items?: unknown[] };
  }

  const items = json.items ?? [];
  const results: ParsedAssignment[] = [];
  for (const item of items) {
    const p = parsedAssignmentSchema.safeParse(item);
    if (p.success) {
      results.push({
        ...p.data,
        source: p.data.source ?? sourceLabel,
      });
    }
  }

  if (results.length === 0) {
    return [
      {
        brief_name: 'Поручение из совещания',
        description: transcript.slice(0, 2000),
        source: sourceLabel,
        owner: null,
        priority: 2,
        target_date: null,
      },
    ];
  }

  return results;
}
