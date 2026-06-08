'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { INITIAL_GROUPS, PROGRAM } from '@/lib/dashboard/mock-data';
import {
  DOC_STATUS_LABELS,
  DOC_STATUS_OPTIONS,
  TASK_STATUS_LABELS,
  TASK_STATUS_OPTIONS,
  docStatusTone,
  sourceLabel,
  taskStatusTone,
} from '@/lib/dashboard/labels';
import type {
  Assignment,
  DeliverableDoc,
  DocStatus,
  TaskStatus,
  WorkingGroup,
} from '@/lib/dashboard/types';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-void)]';

type ViewTab = 'overview' | 'structure' | 'assignments' | 'documents';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function workloadPercent(group: WorkingGroup): number {
  const items = [...group.assignments, ...group.documents];
  if (items.length === 0) return 0;
  const active = items.filter(
    (i) => i.status === 'in_progress' || i.status === 'review',
  ).length;
  return Math.round((active / items.length) * 100);
}

function countByTaskStatus(groups: WorkingGroup[], status: TaskStatus): number {
  return groups.reduce(
    (n, g) => n + g.assignments.filter((a) => a.status === status).length,
    0,
  );
}

function countOverdue(groups: WorkingGroup[]): number {
  return groups.reduce(
    (n, g) =>
      n +
      g.assignments.filter((a) => a.status === 'overdue').length +
      g.documents.filter((d) => d.status === 'overdue').length,
    0,
  );
}

function memberName(group: WorkingGroup, ownerId: string): string {
  return group.members.find((m) => m.id === ownerId)?.name ?? '—';
}

function StatusSelect<T extends string>({
  value,
  options,
  labels,
  onChange,
  toneFn,
}: {
  value: T;
  options: T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
  toneFn: (v: T) => string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`chip cursor-pointer appearance-none pr-6 ${toneFn(value)} ${FOCUS_RING}`}
      aria-label="Изменить статус"
    >
      {options.map((opt) => (
        <option key={opt} value={opt} className="bg-bg-deep text-text-primary">
          {labels[opt]}
        </option>
      ))}
    </select>
  );
}

export default function TeamBoardDashboard() {
  const [groups, setGroups] = useState<WorkingGroup[]>(INITIAL_GROUPS);
  const [selectedId, setSelectedId] = useState(INITIAL_GROUPS[0].id);
  const [tab, setTab] = useState<ViewTab>('overview');
  const [actingAsLeader, setActingAsLeader] = useState(true);

  const selected = useMemo(
    () => groups.find((g) => g.id === selectedId) ?? groups[0],
    [groups, selectedId],
  );

  const kpis = useMemo(
    () => ({
      groups: groups.length,
      members: groups.reduce((n, g) => n + g.members.length, 0),
      inProgress: countByTaskStatus(groups, 'in_progress'),
      overdue: countOverdue(groups),
      docsTotal: groups.reduce((n, g) => n + g.documents.length, 0),
    }),
    [groups],
  );

  const updateAssignmentStatus = useCallback(
    (groupId: string, assignmentId: string, status: TaskStatus) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id !== groupId
            ? g
            : {
                ...g,
                assignments: g.assignments.map((a) =>
                  a.id === assignmentId ? { ...a, status } : a,
                ),
              },
        ),
      );
    },
    [],
  );

  const updateDocStatus = useCallback(
    (groupId: string, docId: string, status: DocStatus) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id !== groupId
            ? g
            : {
                ...g,
                documents: g.documents.map((d) =>
                  d.id === docId ? { ...d, status } : d,
                ),
              },
        ),
      );
    },
    [],
  );

  const tabs: { id: ViewTab; label: string }[] = [
    { id: 'overview', label: 'Обзор' },
    { id: 'structure', label: 'ОФС команды' },
    { id: 'assignments', label: 'Поручения' },
    { id: 'documents', label: 'Документы' },
  ];

  return (
    <div className="relative z-10 min-h-screen">
      <header className="border-b border-border bg-bg-deep/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <div className="mb-1 flex items-center gap-3">
              <Link
                href="/"
                className={`text-xs text-text-muted hover:text-cyan ${FOCUS_RING}`}
              >
                ← AI PMO
              </Link>
              <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-400">
                Мокап
              </span>
            </div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-text-bright">
              {PROGRAM.name}
            </h1>
            <p className="text-sm text-text-secondary">
              {PROGRAM.period} · куратор: {PROGRAM.sponsor}
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={actingAsLeader}
              onChange={(e) => setActingAsLeader(e.target.checked)}
              className={`h-4 w-4 rounded border-border accent-cyan ${FOCUS_RING}`}
            />
            Режим руководителя РГ (обновление статусов)
          </label>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-6 p-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <div className="glass p-4">
            <h2 className="mb-3 font-display text-xs font-semibold uppercase tracking-wider text-text-muted">
              Рабочие группы
            </h2>
            <ul className="space-y-1">
              {groups.map((g) => {
                const load = workloadPercent(g);
                const isActive = g.id === selectedId;
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(g.id)}
                      className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${FOCUS_RING} ${
                        isActive
                          ? 'bg-cyan-glow border border-cyan/25 text-text-bright'
                          : 'hover:bg-bg-card-hover border border-transparent text-text-secondary'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{g.shortName}</span>
                        <span className="text-xs text-text-muted">{load}%</span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-deep">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan to-blue transition-all"
                          style={{ width: `${load}%` }}
                        />
                      </div>
                      <p className="mt-1 truncate text-xs text-text-muted">
                        {g.members.length} чел. · {g.assignments.length} поруч. ·{' '}
                        {g.documents.length} док.
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="glass p-4">
            <h2 className="mb-3 font-display text-xs font-semibold uppercase tracking-wider text-text-muted">
              Сводка программы
            </h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-text-muted">РГ</dt>
                <dd className="font-display text-lg font-semibold text-text-bright">
                  {kpis.groups}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Участников</dt>
                <dd className="font-display text-lg font-semibold text-text-bright">
                  {kpis.members}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">В работе</dt>
                <dd className="font-display text-lg font-semibold text-cyan">
                  {kpis.inProgress}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Просрочено</dt>
                <dd className="font-display text-lg font-semibold text-red-400">
                  {kpis.overdue}
                </dd>
              </div>
            </dl>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          <div className="glass p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-text-bright">
                  {selected.name}
                </h2>
                <p className="text-sm text-text-secondary">
                  Руководитель:{' '}
                  {memberName(selected, selected.leaderId)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-text-muted">Загрузка РГ</p>
                <p className="font-display text-2xl font-bold gradient-text">
                  {workloadPercent(selected)}%
                </p>
              </div>
            </div>

            <nav className="flex flex-wrap gap-1 border-b border-border pb-px">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${FOCUS_RING} ${
                    tab === t.id
                      ? 'border-b-2 border-cyan text-cyan'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>

          {tab === 'overview' && (
            <OverviewPanel group={selected} actingAsLeader={actingAsLeader} onAssignmentStatus={updateAssignmentStatus} onDocStatus={updateDocStatus} />
          )}
          {tab === 'structure' && <StructurePanel group={selected} />}
          {tab === 'assignments' && (
            <AssignmentsPanel
              group={selected}
              actingAsLeader={actingAsLeader}
              onStatusChange={updateAssignmentStatus}
            />
          )}
          {tab === 'documents' && (
            <DocumentsPanel
              group={selected}
              actingAsLeader={actingAsLeader}
              onStatusChange={updateDocStatus}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function OverviewPanel({
  group,
  actingAsLeader,
  onAssignmentStatus,
  onDocStatus,
}: {
  group: WorkingGroup;
  actingAsLeader: boolean;
  onAssignmentStatus: (gId: string, aId: string, s: TaskStatus) => void;
  onDocStatus: (gId: string, dId: string, s: DocStatus) => void;
}) {
  const urgent = [
    ...group.assignments.filter((a) => a.status === 'overdue' || a.status === 'in_progress'),
    ...group.documents.filter((d) => d.status === 'overdue' || d.status === 'review'),
  ].slice(0, 5);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="glass p-4">
        <h3 className="mb-3 font-display text-sm font-semibold text-text-bright">
          Активные поручения
        </h3>
        <AssignmentsTable
          group={group}
          items={group.assignments.filter((a) => a.status !== 'done').slice(0, 4)}
          actingAsLeader={actingAsLeader}
          onStatusChange={onAssignmentStatus}
          compact
        />
      </div>
      <div className="glass p-4">
        <h3 className="mb-3 font-display text-sm font-semibold text-text-bright">
          Документы на контроле
        </h3>
        <DocumentsTable
          group={group}
          items={group.documents.filter((d) => d.status !== 'approved').slice(0, 4)}
          actingAsLeader={actingAsLeader}
          onStatusChange={onDocStatus}
          compact
        />
      </div>
      {urgent.length > 0 && (
        <div className="glass p-4 lg:col-span-2">
          <h3 className="mb-2 font-display text-sm font-semibold text-text-bright">
            Требует внимания руководителя
          </h3>
          <ul className="space-y-2 text-sm">
            {group.assignments
              .filter((a) => a.status === 'overdue')
              .map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-red-400">
                  <span className="chip border-red-500/25 bg-red-500/10">!</span>
                  Поручение: {a.title} — {memberName(group, a.ownerId)}
                </li>
              ))}
            {group.documents
              .filter((d) => d.status === 'overdue')
              .map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-red-400">
                  <span className="chip border-red-500/25 bg-red-500/10">!</span>
                  Документ {d.code}: {d.title}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StructurePanel({ group }: { group: WorkingGroup }) {
  return (
    <div className="glass overflow-hidden">
      <div className="border-b border-border bg-bg-card/50 px-5 py-3">
        <h3 className="font-display text-sm font-semibold text-text-bright">
          Организационно-функциональная структура
        </h3>
        <p className="text-xs text-text-muted">
          Роли, зоны ответственности и привязка к итоговым артефактам программы
        </p>
      </div>
      <div className="divide-y divide-border">
        {group.members.map((member, idx) => {
          const isLeader = member.id === group.leaderId;
          const memberDocs = group.documents.filter((d) => d.ownerId === member.id);
          const memberTasks = group.assignments.filter((a) => a.ownerId === member.id);
          return (
            <div key={member.id} className="p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {idx > 0 && (
                  <span className="text-text-muted" aria-hidden>
                    └
                  </span>
                )}
                <span className="font-medium text-text-bright">{member.name}</span>
                {isLeader && (
                  <span className="chip border-cyan/25 bg-cyan-glow text-cyan">
                    Руководитель РГ
                  </span>
                )}
                <span className="text-sm text-text-secondary">— {member.role}</span>
              </div>
              <div className="ml-0 space-y-3 sm:ml-6">
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Обязанности
                  </h4>
                  <ul className="list-inside list-disc space-y-0.5 text-sm text-text-secondary">
                    {member.responsibilities.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Поручения ({memberTasks.length})
                    </h4>
                    {memberTasks.length === 0 ? (
                      <p className="text-sm text-text-muted">Нет активных</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {memberTasks.map((t) => (
                          <li key={t.id} className="flex items-center gap-2">
                            <span className={`chip ${taskStatusTone(t.status)}`}>
                              {TASK_STATUS_LABELS[t.status]}
                            </span>
                            <span className="truncate text-text-secondary">{t.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Документы ({memberDocs.length})
                    </h4>
                    {memberDocs.length === 0 ? (
                      <p className="text-sm text-text-muted">Не назначены</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {memberDocs.map((d) => (
                          <li key={d.id} className="flex items-center gap-2">
                            <span className="font-mono text-xs text-cyan">{d.code}</span>
                            <span className={`chip ${docStatusTone(d.status)}`}>
                              {DOC_STATUS_LABELS[d.status]}
                            </span>
                            <span className="truncate text-text-secondary">{d.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AssignmentsPanel({
  group,
  actingAsLeader,
  onStatusChange,
}: {
  group: WorkingGroup;
  actingAsLeader: boolean;
  onStatusChange: (gId: string, aId: string, s: TaskStatus) => void;
}) {
  return (
    <div className="glass p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-text-bright">
          Поручения (таск-трекер и план-график)
        </h3>
        <span className="text-xs text-text-muted">{group.assignments.length} записей</span>
      </div>
      <AssignmentsTable
        group={group}
        items={group.assignments}
        actingAsLeader={actingAsLeader}
        onStatusChange={onStatusChange}
      />
    </div>
  );
}

function DocumentsPanel({
  group,
  actingAsLeader,
  onStatusChange,
}: {
  group: WorkingGroup;
  actingAsLeader: boolean;
  onStatusChange: (gId: string, dId: string, s: DocStatus) => void;
}) {
  return (
    <div className="glass p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-text-bright">
          Итоговые проектные документы
        </h3>
        <span className="text-xs text-text-muted">{group.documents.length} документов</span>
      </div>
      <DocumentsTable
        group={group}
        items={group.documents}
        actingAsLeader={actingAsLeader}
        onStatusChange={onStatusChange}
      />
    </div>
  );
}

function AssignmentsTable({
  group,
  items,
  actingAsLeader,
  onStatusChange,
  compact,
}: {
  group: WorkingGroup;
  items: Assignment[];
  actingAsLeader: boolean;
  onStatusChange: (gId: string, aId: string, s: TaskStatus) => void;
  compact?: boolean;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-text-muted">Нет поручений</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-text-muted">
            {!compact && <th className="pb-2 pr-3 font-semibold">Источник</th>}
            <th className="pb-2 pr-3 font-semibold">Поручение</th>
            <th className="pb-2 pr-3 font-semibold">Ответственный</th>
            <th className="pb-2 pr-3 font-semibold">Срок</th>
            <th className="pb-2 font-semibold">Статус</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {items.map((a) => (
            <tr key={a.id} className="hover:bg-bg-card-hover/50">
              {!compact && (
                <td className="py-2.5 pr-3">
                  <span className="chip border-border bg-bg-deep text-text-muted">
                    {sourceLabel(a.source)}
                  </span>
                  {a.scheduleRef && (
                    <span className="ml-1 font-mono text-xs text-text-muted">
                      {a.scheduleRef}
                    </span>
                  )}
                </td>
              )}
              <td className="py-2.5 pr-3 text-text-secondary">{a.title}</td>
              <td className="py-2.5 pr-3 text-text-muted">
                {memberName(group, a.ownerId)}
              </td>
              <td className="py-2.5 pr-3 font-mono text-xs text-text-muted">
                {formatDate(a.dueDate)}
              </td>
              <td className="py-2.5">
                {actingAsLeader ? (
                  <StatusSelect
                    value={a.status}
                    options={TASK_STATUS_OPTIONS}
                    labels={TASK_STATUS_LABELS}
                    toneFn={taskStatusTone}
                    onChange={(s) => onStatusChange(group.id, a.id, s)}
                  />
                ) : (
                  <span className={`chip ${taskStatusTone(a.status)}`}>
                    {TASK_STATUS_LABELS[a.status]}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentsTable({
  group,
  items,
  actingAsLeader,
  onStatusChange,
  compact,
}: {
  group: WorkingGroup;
  items: DeliverableDoc[];
  actingAsLeader: boolean;
  onStatusChange: (gId: string, dId: string, s: DocStatus) => void;
  compact?: boolean;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-text-muted">Нет документов</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-text-muted">
            <th className="pb-2 pr-3 font-semibold">Код</th>
            <th className="pb-2 pr-3 font-semibold">Документ</th>
            {!compact && <th className="pb-2 pr-3 font-semibold">Владелец</th>}
            <th className="pb-2 pr-3 font-semibold">Срок</th>
            <th className="pb-2 font-semibold">Статус</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {items.map((d) => (
            <tr key={d.id} className="hover:bg-bg-card-hover/50">
              <td className="py-2.5 pr-3 font-mono text-xs text-cyan">{d.code}</td>
              <td className="py-2.5 pr-3 text-text-secondary">{d.title}</td>
              {!compact && (
                <td className="py-2.5 pr-3 text-text-muted">
                  {memberName(group, d.ownerId)}
                </td>
              )}
              <td className="py-2.5 pr-3 font-mono text-xs text-text-muted">
                {formatDate(d.dueDate)}
              </td>
              <td className="py-2.5">
                {actingAsLeader ? (
                  <StatusSelect
                    value={d.status}
                    options={DOC_STATUS_OPTIONS}
                    labels={DOC_STATUS_LABELS}
                    toneFn={docStatusTone}
                    onChange={(s) => onStatusChange(group.id, d.id, s)}
                  />
                ) : (
                  <span className={`chip ${docStatusTone(d.status)}`}>
                    {DOC_STATUS_LABELS[d.status]}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
