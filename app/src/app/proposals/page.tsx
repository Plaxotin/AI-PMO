import { listProposals, type ProposalRow } from '@/lib/db/proposals';

export const metadata = {
  title: 'Входящие предложения — AI PMO',
  description:
    'BL-36 TG-надзор: очередь ИИ-предложений из Telegram-чатов проекта. Действия — в канале (@PMO_vision_bot).',
};

export const dynamic = 'force-dynamic';

const TARGET_LABEL: Record<string, string> = {
  assignment: '📌 Поручение',
  decision: '🤝 Решение',
  risk: '⚠️ Риск',
};

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pending: { label: 'ожидает решения', className: 'text-cyan border-cyan/40' },
  confirmed: {
    label: 'принято',
    className: 'text-emerald-300 border-emerald-400/30',
  },
  edited_confirmed: {
    label: 'принято с правкой',
    className: 'text-emerald-300 border-emerald-400/30',
  },
  rejected: { label: 'отклонено', className: 'text-rose-300 border-rose-400/30' },
  merged: { label: 'объединено', className: 'text-text-muted border-border' },
  expired: { label: 'устарело', className: 'text-text-muted border-border' },
};

function ProposalCard({ p }: { p: ProposalRow }) {
  const status = STATUS_LABEL[p.status] ?? STATUS_LABEL.pending;
  const links = (p.payload.source_links ?? []).filter(Boolean);
  return (
    <li className="rounded-lg border border-border bg-bg-card p-5 hover:border-border-hover transition-colors">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-text-bright">
          {TARGET_LABEL[p.target] ?? p.target}
        </span>
        <span className="rounded-sm border border-border px-2 py-0.5 font-mono text-text-secondary">
          TG
        </span>
        {p.payload.channel_title ? (
          <span className="text-text-muted">{p.payload.channel_title}</span>
        ) : null}
        <span
          className={`ml-auto rounded-sm border px-2 py-0.5 ${status.className}`}
        >
          {status.label}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-text-primary">
        {p.payload.text}
        {p.payload.edited ? (
          <span className="ml-2 text-xs text-text-muted">(✎ правка РП)</span>
        ) : null}
      </p>

      {p.payload.assignee || p.payload.due ? (
        <p className="mt-2 text-xs text-text-secondary">
          {p.payload.assignee ? `👤 ${p.payload.assignee}` : ''}
          {p.payload.assignee && p.payload.due ? ' · ' : ''}
          {p.payload.due ? `📅 ${p.payload.due}` : ''}
        </p>
      ) : null}

      {p.signal?.rationale ? (
        <p className="mt-3 border-l-2 border-cyan/40 pl-3 text-xs leading-relaxed text-text-secondary">
          <span className="text-text-muted">Почему предлагает: </span>
          {p.signal.rationale}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text-muted">
        {links.length > 0 ? (
          <a
            href={links[0]}
            target="_blank"
            rel="noreferrer"
            className="text-cyan hover:underline"
          >
            Исходное сообщение →
          </a>
        ) : null}
        {p.signal?.confidence != null ? (
          <span>уверенность {Number(p.signal.confidence).toFixed(2)}</span>
        ) : null}
        <time dateTime={p.created_at}>
          {new Date(p.created_at).toLocaleString('ru-RU')}
        </time>
        {p.payload.registry_ref ? (
          <span className="text-emerald-300/80">{p.payload.registry_ref}</span>
        ) : null}
      </div>
    </li>
  );
}

export default async function ProposalsPage() {
  const proposals = await listProposals();

  if (proposals === null) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-2xl text-text-bright">
          Входящие предложения
        </h1>
        <p className="mt-4 text-sm text-text-secondary">
          Supabase не настроен: задайте NEXT_PUBLIC_SUPABASE_URL и ключи в
          окружении приложения.
        </p>
      </main>
    );
  }

  const pending = proposals.filter((p) => p.status === 'pending');
  const decided = proposals.filter((p) => p.status !== 'pending');

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header>
        <p className="text-xs uppercase tracking-widest text-text-muted">
          BL-36 · TG-надзор
        </p>
        <h1 className="mt-2 font-display text-3xl text-text-bright">
          Входящие предложения
          {pending.length > 0 ? (
            <span className="ml-3 rounded-sm bg-cyan/15 px-2 py-1 align-middle text-sm text-cyan">
              ●{pending.length}
            </span>
          ) : null}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-text-secondary">
          ИИ-предложения из подключённых Telegram-чатов. Реестр — место проверки
          и аудита: подтвердить, изменить или отклонить предложение можно в
          канале — кнопками в Telegram (@PMO_vision_bot).
        </p>
      </header>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wider text-text-muted">
          Ожидают решения · {pending.length}
        </h2>
        {pending.length === 0 ? (
          <p className="mt-4 text-sm text-text-secondary">
            Очередь пуста — все предложения обработаны.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {pending.map((p) => (
              <ProposalCard key={p.id} p={p} />
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-sm font-medium uppercase tracking-wider text-text-muted">
            Обработанные · {decided.length}
          </h2>
          <ul className="mt-4 space-y-4 opacity-80">
            {decided.map((p) => (
              <ProposalCard key={p.id} p={p} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
