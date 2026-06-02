'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PROJECT_ID } from '@/lib/config';
import {
  GOOGLE_OAUTH_ERROR_PARAM,
  googleOAuthErrorMessage,
} from '@/lib/google/oauth-errors';
import {
  hostingUploadLimitMessage,
  parseJsonResponse,
} from '@/lib/api/parse-json-response';
import type { ParsedAssignment, SheetRow } from '@/lib/pmi/types';

const PROJECT_ID = DEFAULT_PROJECT_ID;
const PAGE_SIZE = 25;

/** Shared focus ring for keyboard navigation (BL2-4). */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-void)]';

function apiRoot(): string {
  const prefix = process.env.NEXT_PUBLIC_API_PREFIX ?? '';
  return `${prefix}/api/projects/${PROJECT_ID}`;
}

type ColumnKey =
  | 'id'
  | 'brief_name'
  | 'description'
  | 'source'
  | 'owner'
  | 'priority'
  | 'date_added'
  | 'target_date'
  | 'status';

const COLUMNS: {
  key: ColumnKey;
  label: string;
  filterable: boolean;
  /** Tailwind width on th/td (Make proportions). */
  widthClass: string;
}[] = [
  { key: 'id', label: 'ID', filterable: true, widthClass: 'w-[60px]' },
  {
    key: 'brief_name',
    label: 'Краткое название',
    filterable: true,
    widthClass: 'min-w-[220px]',
  },
  {
    key: 'description',
    label: 'Описание',
    filterable: false,
    widthClass: 'min-w-[140px]',
  },
  { key: 'source', label: 'Источник', filterable: false, widthClass: 'min-w-[100px]' },
  { key: 'owner', label: 'Ответственный', filterable: true, widthClass: 'min-w-[120px]' },
  {
    key: 'priority',
    label: 'Приоритет',
    filterable: true,
    widthClass: 'w-[130px]',
  },
  {
    key: 'target_date',
    label: 'Целевая дата',
    filterable: true,
    widthClass: 'w-[130px]',
  },
  { key: 'status', label: 'Статус', filterable: true, widthClass: 'w-[130px]' },
];

function columnWidthClass(key: ColumnKey): string {
  return COLUMNS.find((c) => c.key === key)?.widthClass ?? '';
}

function priorityDisplayLabel(p: 1 | 2 | 3): string {
  switch (p) {
    case 1:
      return 'Высокий';
    case 2:
      return 'Средний';
    case 3:
      return 'Низкий';
  }
}

function statusDisplayLabel(s: 1 | 2 | 3): string {
  switch (s) {
    case 1:
      return 'Не начато';
    case 2:
      return 'В работе';
    case 3:
      return 'Завершено';
  }
}

function PriorityChip({ value }: { value: 1 | 2 | 3 | null | undefined }) {
  if (value == null) {
    return <span className="text-text-muted">—</span>;
  }
  const tone =
    value === 1
      ? 'chip border-cyan/25 bg-cyan-glow text-cyan'
      : value === 2
        ? 'chip border-border bg-bg-card text-text-secondary'
        : 'chip border-border bg-bg-deep text-text-muted';
  return <span className={tone}>{priorityDisplayLabel(value)}</span>;
}

function StatusChip({ value }: { value: 1 | 2 | 3 | null | undefined }) {
  if (value == null) {
    return <span className="text-text-muted">—</span>;
  }
  const tone =
    value === 1
      ? 'chip border-border bg-bg-deep text-text-muted'
      : value === 2
        ? 'chip border-cyan/25 bg-cyan-glow text-cyan'
        : 'chip border-blue/30 bg-blue-glow text-blue';
  return <span className={tone}>{statusDisplayLabel(value)}</span>;
}

const EDITABLE_KEYS = new Set<ColumnKey>([
  'brief_name',
  'description',
  'source',
  'owner',
  'priority',
  'target_date',
  'status',
]);

function cellValue(row: SheetRow, key: ColumnKey): string {
  switch (key) {
    case 'id':
      return row.id != null ? String(row.id) : '';
    case 'brief_name':
      return row.brief_name ?? '';
    case 'description':
      return row.description ?? '';
    case 'source':
      return row.source ?? '';
    case 'owner':
      return row.owner ?? '';
    case 'priority':
      return row.priority != null ? String(row.priority) : '';
    case 'date_added':
      return row.date_added ?? '';
    case 'target_date':
      return row.target_date ?? '';
    case 'status':
      return row.status != null ? String(row.status) : '';
    default:
      return '';
  }
}

function parsePriorityInput(v: string): 1 | 2 | 3 | null {
  const n = Number.parseInt(v, 10);
  if (n === 1 || n === 2 || n === 3) return n;
  return null;
}

function parseStatusInput(v: string): 1 | 2 | 3 | null {
  const n = Number.parseInt(v, 10);
  if (n === 1 || n === 2 || n === 3) return n;
  return null;
}

export default function AssignmentsScreen() {
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [googleSignedIn, setGoogleSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Partial<Record<ColumnKey, Set<string>>>>({});
  const [openFilter, setOpenFilter] = useState<ColumnKey | null>(null);
  const [sort, setSort] = useState<{ key: ColumnKey; dir: 'asc' | 'desc' } | null>(
    null,
  );
  const [connectUrl, setConnectUrl] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [registryEditMode, setRegistryEditMode] = useState(false);
  const [editRows, setEditRows] = useState<SheetRow[] | null>(null);
  const [devPreview, setDevPreview] = useState(false);
  const [page, setPage] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const sheetsInitPromiseRef = useRef<Promise<{
    ok: boolean;
    spreadsheetUrl: string | null;
  }> | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const statusRes = await fetch(`${apiRoot()}/sheets/status`, {
        credentials: 'same-origin',
      });
      const statusParsed = await parseJsonResponse<{
        connected?: boolean;
        google_signed_in?: boolean;
        oauth_configured?: boolean;
        dev_preview?: boolean;
        spreadsheet_url?: string | null;
      }>(statusRes);

      if (!statusParsed.ok) {
        setGoogleSignedIn(false);
        setConnected(false);
        setError(statusParsed.message);
        return;
      }

      const status = statusParsed.data;
      setDevPreview(Boolean(status.dev_preview));

      if (status.oauth_configured === false) {
        setGoogleSignedIn(false);
        setConnected(false);
        setError(
          'Google OAuth не настроен на сервере. См. docs/plans/BL2-0_SECRETS_SETUP.md',
        );
        return;
      }

      setGoogleSignedIn(Boolean(status.google_signed_in));
      if (!status.google_signed_in) {
        setConnected(false);
        return;
      }

      let isConnected = Boolean(status.connected);
      let sheetUrl = status.spreadsheet_url ?? null;

      if (!isConnected) {
        if (!sheetsInitPromiseRef.current) {
          sheetsInitPromiseRef.current = (async () => {
            const initRes = await fetch(`${apiRoot()}/sheets/init`, {
              method: 'POST',
              credentials: 'same-origin',
            });
            const initParsed = await parseJsonResponse<{
              spreadsheet_url?: string;
            }>(initRes);
            if (!initParsed.ok) {
              setError(initParsed.message);
              return { ok: false, spreadsheetUrl: null };
            }
            return {
              ok: true,
              spreadsheetUrl: initParsed.data.spreadsheet_url ?? null,
            };
          })().finally(() => {
            sheetsInitPromiseRef.current = null;
          });
        }

        const initResult = await sheetsInitPromiseRef.current;
        if (!initResult.ok) {
          setConnected(false);
          return;
        }
        isConnected = true;
        sheetUrl = initResult.spreadsheetUrl ?? sheetUrl;
      }

      setConnected(isConnected);
      setSpreadsheetUrl(sheetUrl);

      const listRes = await fetch(`${apiRoot()}/assignments`, {
        credentials: 'same-origin',
      });
      const listParsed = await parseJsonResponse<{
        data?: SheetRow[];
        meta?: { spreadsheet_url?: string | null; connected?: boolean };
      }>(listRes);

      if (!listParsed.ok) {
        setError(listParsed.message);
        return;
      }

      setRows(listParsed.data.data ?? []);
      if (listParsed.data.meta?.spreadsheet_url) {
        setSpreadsheetUrl(listParsed.data.meta.spreadsheet_url);
      }
      if (listParsed.data.meta?.connected) {
        setConnected(true);
      }
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : 'Ошибка сети');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setPage(0);
  }, [filters, sort]);

  useEffect(() => {
    if (!showSettingsMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(e.target as Node)
      ) {
        setShowSettingsMenu(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSettingsMenu(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showSettingsMenu]);

  useEffect(() => {
    if (openFilter == null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenFilter(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const oauthErr = params.get(GOOGLE_OAUTH_ERROR_PARAM);
    const msg = googleOAuthErrorMessage(oauthErr);
    if (msg) {
      setError(msg);
      params.delete(GOOGLE_OAUTH_ERROR_PARAM);
      const next = params.toString();
      const path = window.location.pathname;
      window.history.replaceState(null, '', next ? `${path}?${next}` : path);
    }
  }, []);

  const sourceRows = registryEditMode && editRows ? editRows : rows;

  const filteredRows = useMemo(() => {
    let list = [...sourceRows];
    for (const col of COLUMNS) {
      const f = filters[col.key];
      if (!f || f.size === 0) continue;
      list = list.filter((r) => f.has(cellValue(r, col.key)));
    }
    if (sort) {
      list.sort((a, b) => {
        const av = cellValue(a, sort.key);
        const bv = cellValue(b, sort.key);
        const cmp = av.localeCompare(bv, 'ru', { numeric: true });
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [sourceRows, filters, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  const paginatedRows = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page]);

  const pageStart = filteredRows.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, filteredRows.length);

  const uniqueValues = (key: ColumnKey): string[] => {
    const set = new Set<string>();
    for (const r of rows) {
      const v = cellValue(r, key);
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  };

  async function persistAssignments(items: ParsedAssignment[]) {
    if (items.length === 0) return;

    if (items.length === 1) {
      const res = await fetch(`${apiRoot()}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items[0]),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? 'Ошибка сохранения');
      }
      return;
    }

    const res = await fetch(`${apiRoot()}/assignments/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: items }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message ?? 'Ошибка сохранения');
    }
  }

  async function handleParseAndSave() {
    const text = inputText.trim();
    if (!text) return;
    setProgress('Разбор и сохранение…');
    setError(null);
    try {
      const res = await fetch(`${apiRoot()}/assignments/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Ошибка LLM');
      const parsed = data.parsed as ParsedAssignment;
      await persistAssignments([parsed]);
      setInputText('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setProgress(null);
    }
  }

  async function handleFile(file: File) {
    setError(null);
    const limitMsg = hostingUploadLimitMessage(file.size);
    if (limitMsg) {
      setError(limitMsg);
      return;
    }

    setProgress('Загрузка и сохранение…');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`${apiRoot()}/ingest`, { method: 'POST', body: form });
      const parsed = await parseJsonResponse<{
        async?: boolean;
        job_id?: string;
        drafts?: ParsedAssignment[];
      }>(res);
      if (!parsed.ok) throw new Error(parsed.message);

      const data = parsed.data;
      if (data.async && data.job_id) {
        await pollJob(data.job_id);
      } else if (data.drafts?.length) {
        await persistAssignments(data.drafts);
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка файла');
    } finally {
      setProgress(null);
    }
  }

  async function pollJob(jobId: string) {
    for (let i = 0; i < 120; i++) {
      setProgress('Обработка файла…');
      const res = await fetch(`${apiRoot()}/ingest/${jobId}`);
      const parsed = await parseJsonResponse<{
        status?: string;
        stage?: string;
        drafts?: ParsedAssignment[];
        error?: string;
      }>(res);
      if (!parsed.ok) throw new Error(parsed.message);

      const data = parsed.data;
      if (data.stage) setProgress(data.stage);
      if (data.status === 'done' && data.drafts) {
        setProgress('Сохранение в реестр…');
        await persistAssignments(data.drafts);
        await refresh();
        return;
      }
      if (data.status === 'failed') {
        throw new Error(data.error ?? 'Инжест не удался');
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('Таймаут обработки файла');
  }

  function updateEditRow(rowNumber: number, patch: Partial<SheetRow>) {
    setEditRows((prev) =>
      prev?.map((r) => (r.row_number === rowNumber ? { ...r, ...patch } : r)) ??
      null,
    );
  }

  async function toggleRegistryEdit() {
    if (!registryEditMode) {
      setEditRows(rows.map((r) => ({ ...r })));
      setRegistryEditMode(true);
      setError(null);
      return;
    }

    if (!editRows?.length) {
      setRegistryEditMode(false);
      setEditRows(null);
      return;
    }

    setProgress('Сохранение реестра…');
    setError(null);
    try {
      const res = await fetch(`${apiRoot()}/assignments/batch`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: editRows }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? 'Ошибка сохранения реестра');
      }
      setRegistryEditMode(false);
      setEditRows(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setProgress(null);
    }
  }

  function startDictation() {
    const SR =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;
    if (!SR) {
      setError('Диктовка не поддерживается в этом браузере');
      return;
    }
    const rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = true;
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let text = '';
      for (let i = 0; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      setInputText(text);
    };
    rec.start();
    recognitionRef.current = rec;
  }

  async function connectOwnSheet() {
    setError(null);
    const res = await fetch(`${apiRoot()}/sheets/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spreadsheet_url: connectUrl }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? 'Не удалось подключить');
      return;
    }
    setShowConnect(false);
    setConnectUrl('');
    await refresh();
  }

  const cellPad = (key: ColumnKey) =>
    `px-3 py-2.5 text-sm ${columnWidthClass(key)}`;

  const inputClass =
    'w-full min-w-[80px] rounded-md border border-border bg-bg-deep px-2 py-1 text-xs text-text-primary outline-none focus:border-cyan';

  function renderCell(row: SheetRow, key: ColumnKey) {
    if (!registryEditMode || !EDITABLE_KEYS.has(key)) {
      if (key === 'priority') {
        return (
          <td key={key} className={cellPad(key)}>
            <PriorityChip value={row.priority} />
          </td>
        );
      }
      if (key === 'status') {
        return (
          <td key={key} className={cellPad(key)}>
            <StatusChip value={row.status} />
          </td>
        );
      }
      const isTitle = key === 'brief_name';
      const isId = key === 'id';
      const text = cellValue(row, key);
      return (
        <td
          key={key}
          className={`${cellPad(key)} ${
            isTitle
              ? 'font-medium text-text-bright'
              : isId
                ? 'text-text-muted tabular-nums'
                : 'text-text-secondary'
          }`}
        >
          {text || <span className="text-text-muted">—</span>}
        </td>
      );
    }

    if (key === 'brief_name') {
      return (
        <td key={key} className={`${cellPad(key)} py-1.5`}>
          <input
            className={inputClass}
            value={row.brief_name}
            onChange={(e) =>
              updateEditRow(row.row_number, { brief_name: e.target.value })
            }
          />
        </td>
      );
    }
    if (key === 'description') {
      return (
        <td key={key} className={`${cellPad(key)} py-1.5`}>
          <input
            className={inputClass}
            value={row.description ?? ''}
            onChange={(e) =>
              updateEditRow(row.row_number, { description: e.target.value })
            }
          />
        </td>
      );
    }
    if (key === 'source') {
      return (
        <td key={key} className={`${cellPad(key)} py-1.5`}>
          <input
            className={inputClass}
            value={row.source ?? ''}
            onChange={(e) =>
              updateEditRow(row.row_number, { source: e.target.value })
            }
          />
        </td>
      );
    }
    if (key === 'owner') {
      return (
        <td key={key} className={`${cellPad(key)} py-1.5`}>
          <input
            className={inputClass}
            value={row.owner ?? ''}
            onChange={(e) =>
              updateEditRow(row.row_number, { owner: e.target.value })
            }
          />
        </td>
      );
    }
    if (key === 'priority') {
      return (
        <td key={key} className={`${cellPad(key)} py-1.5`}>
          <input
            className={inputClass}
            value={row.priority?.toString() ?? ''}
            onChange={(e) =>
              updateEditRow(row.row_number, {
                priority: parsePriorityInput(e.target.value),
              })
            }
          />
        </td>
      );
    }
    if (key === 'target_date') {
      return (
        <td key={key} className={`${cellPad(key)} py-1.5`}>
          <input
            className={inputClass}
            value={row.target_date ?? ''}
            onChange={(e) =>
              updateEditRow(row.row_number, { target_date: e.target.value })
            }
          />
        </td>
      );
    }
    if (key === 'status') {
      return (
        <td key={key} className={`${cellPad(key)} py-1.5`}>
          <input
            className={inputClass}
            value={row.status?.toString() ?? ''}
            onChange={(e) =>
              updateEditRow(row.row_number, {
                status: parseStatusInput(e.target.value) ?? row.status ?? 1,
              })
            }
          />
        </td>
      );
    }

    return (
      <td key={key} className={`${cellPad(key)} text-text-secondary`}>
        {cellValue(row, key)}
      </td>
    );
  }

  if (!googleSignedIn && !loading) {
    return (
      <div className="bg-bg-void text-text-primary flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h1 className="font-display text-2xl font-semibold">
          AI PMO - Администратор поручений
        </h1>
        <p className="text-text-secondary max-w-md text-center">
          Войдите через Google, чтобы создать или подключить таблицу PMI Action Item
          Tracker.
        </p>
        <p className="text-text-muted max-w-lg text-center text-xs">
          Пока приложение в Google Cloud в статусе <strong>Testing</strong>, вход
          разрешён только аккаунтам из списка <strong>Test users</strong> (см.{' '}
          <code className="text-text-secondary">docs/plans/BL2-0_SECRETS_SETUP.md</code>
          ).
        </p>
        {error && (
          <p className="max-w-lg rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <a href={`/api/auth/google?returnTo=/assignments`} className="btn-primary">
          Войти через Google
        </a>
      </div>
    );
  }

  return (
    <div className="bg-bg-void text-text-primary min-h-screen">
      <main className="flex min-h-screen flex-col">
        {devPreview && (
          <div
            className="border-b border-cyan/30 bg-cyan-glow px-6 py-2 text-center text-sm text-cyan"
            role="status"
          >
            Режим предпросмотра (без Google): демо-данные для UI. Сохранение в Sheets
            отключено. Уберите{' '}
            <code className="text-text-secondary">BL6_DEV_SKIP_GOOGLE_AUTH=true</code> из{' '}
            <code className="text-text-secondary">app/.env.local</code> для входа через Google.
          </div>
        )}

        <header className="glass sticky top-0 z-20 border-b border-border px-6 py-4 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-gradient-to-r from-cyan-500 to-blue-500 text-sm font-bold text-white">
                AI
              </div>
              <div>
                <h1 className="font-display text-base font-semibold md:text-lg">
                  AI PMO - Администратор поручений
                </h1>
                <p className="text-text-muted text-xs">
                  {loading
                    ? 'Проверка подключения…'
                    : connected
                      ? 'Google Sheets подключён'
                      : error
                        ? 'Sheets не подключён'
                        : 'Подключение Sheets…'}
                </p>
              </div>
            </div>

            <div ref={settingsMenuRef} className="relative flex items-center gap-2">
              <button
                type="button"
                disabled
                title="Уведомления — скоро"
                aria-label="Уведомления (скоро)"
                className={`flex h-9 w-9 items-center justify-center rounded-md border border-border bg-bg-card text-base opacity-50 ${FOCUS_RING}`}
              >
                🔔
              </button>
              <button
                type="button"
                className={
                  registryEditMode
                    ? `rounded-md border border-cyan/40 bg-cyan-glow px-3 py-2 text-xs font-medium text-cyan hover:bg-cyan/20 disabled:opacity-50 ${FOCUS_RING}`
                    : `rounded-md border border-border bg-bg-card px-3 py-2 text-xs font-medium text-text-primary hover:bg-bg-card-hover disabled:opacity-50 ${FOCUS_RING}`
                }
                onClick={() => void toggleRegistryEdit()}
                disabled={loading || rows.length === 0}
              >
                {registryEditMode ? 'Сохранить реестр' : 'Редактировать реестр'}
              </button>
              <button
                type="button"
                className={`rounded-md border border-border bg-bg-card px-3 py-2 text-xs font-medium text-text-primary hover:bg-bg-card-hover ${FOCUS_RING}`}
                onClick={() => setShowSettingsMenu((v) => !v)}
                aria-expanded={showSettingsMenu}
                aria-haspopup="menu"
              >
                Настройки
              </button>
              {showSettingsMenu && (
                <div className="glass absolute right-0 top-full z-30 mt-2 min-w-56 rounded-xl border border-border p-2 text-sm shadow-xl">
                  {spreadsheetUrl && (
                    <a
                      href={spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-md px-3 py-2 text-text-primary hover:bg-bg-card-hover"
                    >
                      Открыть в Google Sheets ↗
                    </a>
                  )}
                  <button
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-text-primary hover:bg-bg-card-hover"
                    onClick={() => {
                      setShowConnect((v) => !v);
                      setShowSettingsMenu(false);
                    }}
                  >
                    Подключить свой реестр
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-text-primary hover:bg-bg-card-hover disabled:opacity-50"
                    onClick={() => {
                      setShowSettingsMenu(false);
                      void refresh();
                    }}
                    disabled={registryEditMode}
                  >
                    Обновить
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-6 py-6">
          <div className="glass mb-4 rounded-2xl border border-border p-4 md:p-5">
            <div className="flex min-w-0 flex-1 flex-wrap items-stretch gap-2">
              <div className="flex min-w-[280px] flex-1 items-stretch gap-1 rounded-[var(--radius-sm)] border border-border bg-bg-deep/80 p-1 focus-within:border-cyan focus-within:ring-1 focus-within:ring-cyan/25">
                <input
                  className="text-text-primary placeholder:text-text-muted min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-50"
                  placeholder="Введите поручение или загрузите протокол / запись совещания…"
                  value={inputText}
                  disabled={registryEditMode}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleParseAndSave();
                    }
                  }}
                />
                <div className="flex shrink-0 items-stretch gap-1">
                <button
                  type="button"
                  title="Диктовка"
                  className={`flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-bg-card text-lg hover:bg-bg-card-hover disabled:opacity-50 ${FOCUS_RING}`}
                  disabled={registryEditMode}
                  onClick={startDictation}
                >
                  🎤
                </button>
                <button
                  type="button"
                  title="Файл"
                  className={`flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-bg-card text-lg hover:bg-bg-card-hover disabled:opacity-50 ${FOCUS_RING}`}
                  disabled={registryEditMode}
                  onClick={() => fileRef.current?.click()}
                >
                  📎
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".mp3,.m4a,.ogg,.wav,.opus,.mp4,.mov,.webm,.mkv,.docx,.txt,.doc"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className={`btn-primary flex h-11 min-w-11 items-center justify-center rounded-[var(--radius-sm)] px-4 py-0 text-base font-medium disabled:opacity-50 ${FOCUS_RING}`}
                  disabled={registryEditMode}
                  onClick={() => void handleParseAndSave()}
                  title="Разобрать и сохранить"
                >
                  ➤
                </button>
                </div>
              </div>
            </div>

            <p className="text-text-muted mt-2 text-xs">
              Новые поручения сохраняются в Google Sheet сразу после разбора. Файлы:
              аудио/видео, .docx, .txt (на Vercel — до ~4,5 МБ).
            </p>

            {registryEditMode && (
              <p className="mt-2 text-xs text-cyan">
                Режим редактирования: измените ячейки в таблице и нажмите «Сохранить
                реестр».
              </p>
            )}
            {showConnect && (
              <div className="mt-3 flex flex-col gap-2 sm:max-w-md">
                <input
                  className="text-text-primary placeholder:text-text-muted rounded-md border border-border bg-bg-deep px-2 py-2 text-xs outline-none focus:border-cyan"
                  placeholder="URL Google Sheet"
                  value={connectUrl}
                  onChange={(e) => setConnectUrl(e.target.value)}
                />
                <button
                  type="button"
                  className="rounded-md border border-border bg-bg-card px-2 py-2 text-xs text-text-primary hover:bg-bg-card-hover"
                  onClick={() => void connectOwnSheet()}
                >
                  Подключить
                </button>
              </div>
            )}
            {progress && <p className="mt-2 text-sm text-cyan">{progress}</p>}
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          </div>

          <div className="glass flex flex-1 flex-col overflow-hidden rounded-2xl border border-border">
            {loading ? (
              <p className="text-text-muted px-5 py-4">Загрузка…</p>
            ) : (
              <>
              <div
                className="overflow-x-auto p-3 [-webkit-overflow-scrolling:touch]"
                role="region"
                aria-label="Таблица реестра поручений"
                tabIndex={0}
              >
              {filteredRows.length === 0 ? (
                <p className="text-text-muted px-2 py-10 text-center text-sm">
                  {rows.length === 0
                    ? 'Реестр пуст. Добавьте поручение через поле ввода выше.'
                    : 'Нет строк по выбранным фильтрам.'}
                </p>
              ) : (
              <table className="w-full min-w-[960px] table-fixed border-collapse text-sm">
                <colgroup>
                  {COLUMNS.map((col) => (
                    <col key={col.key} className={col.widthClass} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-border text-left text-text-muted">
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className={`relative px-3 py-2.5 font-medium ${col.widthClass}`}
                      >
                        <span
                          className="cursor-pointer hover:text-text-bright"
                          onClick={() =>
                            setSort((s) =>
                              s?.key === col.key
                                ? {
                                    key: col.key,
                                    dir: s.dir === 'asc' ? 'desc' : 'asc',
                                  }
                                : { key: col.key, dir: 'asc' },
                            )
                          }
                        >
                          {col.label}
                        </span>
                        {col.filterable && !registryEditMode && (
                          <button
                            type="button"
                            className={`ml-1 rounded px-0.5 text-xs hover:text-text-bright ${FOCUS_RING}`}
                            aria-label={`Фильтр: ${col.label}`}
                            aria-expanded={openFilter === col.key}
                            onClick={() =>
                              setOpenFilter(openFilter === col.key ? null : col.key)
                            }
                          >
                            ▾
                          </button>
                        )}
                        {openFilter === col.key && (
                          <div className="glass absolute z-10 mt-1 max-h-40 min-w-[10rem] overflow-auto rounded-lg border border-border bg-bg-deep p-2 shadow-xl">
                            {uniqueValues(col.key).map((v) => (
                              <label
                                key={v}
                                className="flex gap-2 whitespace-nowrap text-xs text-text-primary"
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    filters[col.key]?.has(v) ??
                                    !(filters[col.key]?.size ?? 0)
                                  }
                                  onChange={() => {
                                    setFilters((prev) => {
                                      const next = { ...prev };
                                      const set =
                                        next[col.key] ??
                                        new Set(uniqueValues(col.key));
                                      if (set.has(v)) set.delete(v);
                                      else set.add(v);
                                      next[col.key] = set;
                                      return next;
                                    });
                                  }}
                                />
                                {v}
                              </label>
                            ))}
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row) => (
                    <tr
                      key={row.row_number}
                      className={
                        registryEditMode
                          ? 'border-b border-cyan/20 bg-cyan-glow/40'
                          : 'border-b border-border/50 transition-colors hover:bg-bg-card-hover'
                      }
                    >
                      {COLUMNS.map((col) => renderCell(row, col.key))}
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
              </div>
              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-text-muted">
                <span>
                  {filteredRows.length === 0
                    ? `0 из ${rows.length}`
                    : `${pageStart}–${pageEnd} из ${filteredRows.length}`}
                  {filteredRows.length !== rows.length &&
                    filteredRows.length > 0 &&
                    ` (всего в реестре: ${rows.length})`}
                </span>
                {filteredRows.length > PAGE_SIZE && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={`rounded-md border border-border bg-bg-card px-2.5 py-1 text-text-primary hover:bg-bg-card-hover disabled:opacity-40 ${FOCUS_RING}`}
                      disabled={page <= 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      Назад
                    </button>
                    <span className="text-text-secondary">
                      {page + 1} / {pageCount}
                    </span>
                    <button
                      type="button"
                      className={`rounded-md border border-border bg-bg-card px-2.5 py-1 text-text-primary hover:bg-bg-card-hover disabled:opacity-40 ${FOCUS_RING}`}
                      disabled={page >= pageCount - 1}
                      onClick={() =>
                        setPage((p) => Math.min(pageCount - 1, p + 1))
                      }
                    >
                      Вперёд
                    </button>
                  </div>
                )}
              </footer>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
