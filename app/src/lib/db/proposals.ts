import { getSupabaseAdmin } from '@/lib/db/client';

/**
 * BL-36 «TG-надзор»: очередь «Входящие предложения» (SPEC-BL-36 §5, §6.6).
 * Читается из Supabase (bl36_proposals + bl36_signals). MVP — только просмотр;
 * действия (✓/✕/✎) — в Telegram-канале (@PMO_vision_bot).
 */

export type ProposalTarget = 'assignment' | 'decision' | 'risk';

export type ProposalPayload = {
  text?: string;
  assignee?: string | null;
  due?: string | null;
  channel_title?: string | null;
  source_links?: string[];
  edited?: boolean;
  registry_ref?: string;
};

export type ProposalSignal = {
  rationale: string | null;
  confidence: number | null;
};

export type ProposalRow = {
  id: string;
  target: ProposalTarget;
  action: 'create' | 'update';
  payload: ProposalPayload;
  status:
    | 'pending'
    | 'confirmed'
    | 'edited_confirmed'
    | 'rejected'
    | 'merged'
    | 'expired';
  created_at: string;
  decided_at: string | null;
  signal: ProposalSignal | null;
};

export async function listProposals(limit = 100): Promise<ProposalRow[] | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase
    .from('bl36_proposals')
    .select(
      'id, target, action, payload, status, created_at, decided_at, ' +
        'signal:bl36_signals(rationale, confidence)',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('listProposals:', error.message);
    return null;
  }
  return (data ?? []) as unknown as ProposalRow[];
}
