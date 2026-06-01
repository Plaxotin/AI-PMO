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

function apiRoot(): string {
  const prefix = process.env.NEXT_PUBLIC_API_PREFIX ?? '';
  return `${prefix}/api/projects/${PROJECT_ID}`;
}

type DraftRow = ParsedAssignment & { draftId: string };

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

const COLUMNS: { key: ColumnKey; label: string; filterable: boolean }[] = [
  { key: 'id', label: 'ID', filterable: true },
  { key: 'brief_name', label: 'Краткое название', filterable: true },
  { key: 'description', label: 'Описание', filterable: false },
  { key: 'source', label: 'Источник', filterable: false },
  { key: 'owner', label: 'Ответственный', filterable: true },
  { key: 'priority', label: 'Приоритет', filterable: true },
  { key: 'target_date', label: 'Целевая дата', filterable: true },
  { key: 'status', label: 'Статус', filterable: true },
];

function cellValue(row: SheetRow | DraftRow, key: ColumnKey): string {
  const r = row as SheetRow & ParsedAssignment;
  switch (key) {
    case 'id':
      return r.id != null ? String(r.id) : '';
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
      return 'date_added' in r ? (r.date_added ?? '') : '';
    case 'target_date':
      return row.target_date ?? '';
    case 'status':
      return r.status != null ? String(r.status) : '';
    default:
      return '';
  }
}

export default function AssignmentsScreen() {
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
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
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const statusRes = await fetch(`${apiRoot()}/sheets/status`);
    const status = await statusRes.json();
    setGoogleSignedIn(Boolean(status.google_signed_in));
    setConnected(Boolean(status.connected));
    setSpreadsheetUrl(status.spreadsheet_url ?? null);

    if (!status.google_signed_in) {
      setLoading(false);
      return;
    }

    if (!status.connected) {
      const initRes = await fetch(`${apiRoot()}/sheets/init`, { method: 'POST' });
      if (!initRes.ok) {
        const err = await initRes.json();
        setError(err?.error?.message ?? 'Не удалось создать таблицу');
        setLoading(false);
        return;
      }
      const initData = await initRes.json();
      setSpreadsheetUrl(initData.spreadsheet_url);
      setConnected(true);
    }

    const listRes = await fetch(`${apiRoot()}/assignments`);
    const list = await listRes.json();
    if (listRes.ok) {
      setRows(list.data ?? []);
      setSpreadsheetUrl(list.meta?.spreadsheet_url ?? spreadsheetUrl);
    } else {
      setError(list?.error?.message ?? 'Ошибка загрузки реестра');
    }
    setLoading(false);
  }, [spreadsheetUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const filteredRows = useMemo(() => {
    let list = [...rows];
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
  }, [rows, filters, sort]);

  const uniqueValues = (key: ColumnKey): string[] => {
    const set = new Set<string>();
    for (const r of rows) {
      const v = cellValue(r, key);
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  };

  async function handleParseAndDraft() {
    const text = inputText.trim();
    if (!text) return;
    setProgress('Разбор текста…');
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
      setDrafts((d) => [
        { ...parsed, draftId: crypto.randomUUID() },
        ...d,
      ]);
      setInputText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setProgress(null);
    }
  }

  async function saveDraft(draft: DraftRow) {
    setError(null);
    const res = await fetch(`${apiRoot()}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? 'Ошибка сохранения');
      return;
    }
    setDrafts((d) => d.filter((x) => x.draftId !== draft.draftId));
    await refresh();
  }

  function discardDraft(draftId: string) {
    setDrafts((d) => d.filter((x) => x.draftId !== draftId));
  }

  function updateDraft(draftId: string, patch: Partial<ParsedAssignment>) {
    setDrafts((d) =>
      d.map((row) => (row.draftId === draftId ? { ...row, ...patch } : row)),
    );
  }

  async function handleFile(file: File) {
    setError(null);
    const limitMsg = hostingUploadLimitMessage(file.size);
    if (limitMsg) {
      setError(limitMsg);
      return;
    }

    setProgress('Загрузка файла…');
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
        addDraftsFromParsed(data.drafts);
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
        addDraftsFromParsed(data.drafts);
        return;
      }
      if (data.status === 'failed') {
        throw new Error(data.error ?? 'Инжест не удался');
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('Таймаут обработки файла');
  }

  function addDraftsFromParsed(items: ParsedAssignment[]) {
    setDrafts((d) => [
      ...items.map((p) => ({ ...p, draftId: crypto.randomUUID() })),
      ...d,
    ]);
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

  if (!googleSignedIn && !loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 p-8 text-slate-100">
        <h1 className="text-2xl font-semibold">Реестр поручений (BL-6)</h1>
        <p className="max-w-md text-center text-slate-400">
          Войдите через Google, чтобы создать или подключить таблицу PMI Action Item
          Tracker.
        </p>
        <p className="max-w-lg text-center text-xs text-slate-500">
          Пока приложение в Google Cloud в статусе <strong>Testing</strong>, вход
          разрешён только аккаунтам из списка <strong>Test users</strong> (см.{' '}
          <code className="text-slate-400">docs/plans/BL2-0_SECRETS_SETUP.md</code>
          ).
        </p>
        {error && (
          <p className="max-w-lg rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <a
          href={`/api/auth/google?returnTo=/assignments`}
          className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-500"
        >
          Войти через Google
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900 p-4">
        <div className="mb-6 text-sm font-semibold text-cyan-400">AI PMO</div>
        <nav className="flex flex-col gap-1 text-sm">
          <span className="rounded bg-slate-800 px-3 py-2 text-white">
            Реестр поручений
          </span>
          {spreadsheetUrl && (
            <a
              href={spreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 text-slate-300 hover:text-white"
            >
              Открыть в Google Sheets ↗
            </a>
          )}
          <button
            type="button"
            className="px-3 py-2 text-left text-slate-300 hover:text-white"
            onClick={() => setShowConnect((v) => !v)}
          >
            Подключить свой реестр
          </button>
          <button
            type="button"
            className="px-3 py-2 text-left text-slate-300 hover:text-white"
            onClick={() => void refresh()}
          >
            Обновить
          </button>
        </nav>
        {showConnect && (
          <div className="mt-4 flex flex-col gap-2">
            <input
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
              placeholder="URL Google Sheet"
              value={connectUrl}
              onChange={(e) => setConnectUrl(e.target.value)}
            />
            <button
              type="button"
              className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
              onClick={() => void connectOwnSheet()}
            >
              Подключить
            </button>
          </div>
        )}
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="border-b border-slate-800 px-6 py-4">
          <h1 className="text-lg font-semibold">Реестр поручений</h1>
          {connected && (
            <p className="text-xs text-slate-500">Google Sheets подключён</p>
          )}
        </header>

        <div className="border-b border-slate-800 px-6 py-4">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-cyan-600"
              placeholder="Введите поручение или загрузите протокол / запись совещания…"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleParseAndDraft();
                }
              }}
            />
            <button
              type="button"
              title="Диктовка"
              className="rounded-lg border border-slate-700 px-3 hover:bg-slate-800"
              onClick={startDictation}
            >
              🎤
            </button>
            <button
              type="button"
              title="Файл"
              className="rounded-lg border border-slate-700 px-3 hover:bg-slate-800"
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
              className="rounded-lg bg-cyan-600 px-4 font-medium hover:bg-cyan-500"
              onClick={() => void handleParseAndDraft()}
            >
              ➤
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Файлы: аудио/видео, протокол Word (.docx), .txt. На Vercel — до ~4,5 МБ на файл.
          </p>
          {progress && (
            <p className="mt-2 text-sm text-cyan-400">{progress}</p>
          )}
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <p className="text-slate-500">Загрузка…</p>
          ) : (
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  {COLUMNS.map((col) => (
                    <th key={col.key} className="relative px-2 py-2 font-medium">
                      <span
                        className="cursor-pointer hover:text-white"
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
                      {col.filterable && (
                        <button
                          type="button"
                          className="ml-1 text-xs"
                          onClick={() =>
                            setOpenFilter(
                              openFilter === col.key ? null : col.key,
                            )
                          }
                        >
                          ▾
                        </button>
                      )}
                      {openFilter === col.key && (
                        <div className="absolute z-10 mt-1 max-h-40 overflow-auto rounded border border-slate-600 bg-slate-900 p-2 shadow-lg">
                          {uniqueValues(col.key).map((v) => (
                            <label
                              key={v}
                              className="flex gap-2 whitespace-nowrap text-xs"
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
                  <th className="w-20 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => (
                  <tr
                    key={draft.draftId}
                    className="border-b border-amber-900/50 bg-amber-950/40"
                  >
                    {COLUMNS.map((col) => (
                      <td key={col.key} className="px-2 py-1">
                        <input
                          className="w-full min-w-[80px] rounded border border-amber-800/50 bg-amber-950/20 px-1 py-0.5 text-xs"
                          value={
                            col.key === 'brief_name'
                              ? draft.brief_name
                              : col.key === 'description'
                                ? (draft.description ?? '')
                                : col.key === 'source'
                                  ? (draft.source ?? '')
                                  : col.key === 'owner'
                                    ? (draft.owner ?? '')
                                    : col.key === 'priority'
                                      ? (draft.priority?.toString() ?? '')
                                      : col.key === 'target_date'
                                        ? (draft.target_date ?? '')
                                        : ''
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (col.key === 'brief_name')
                              updateDraft(draft.draftId, { brief_name: v });
                            else if (col.key === 'description')
                              updateDraft(draft.draftId, { description: v });
                            else if (col.key === 'source')
                              updateDraft(draft.draftId, { source: v });
                            else if (col.key === 'owner')
                              updateDraft(draft.draftId, { owner: v });
                            else if (col.key === 'priority')
                              updateDraft(draft.draftId, {
                                priority: [1, 2, 3].includes(Number(v))
                                  ? (Number(v) as 1 | 2 | 3)
                                  : null,
                              });
                            else if (col.key === 'target_date')
                              updateDraft(draft.draftId, { target_date: v });
                          }}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        className="mr-1 text-green-400 hover:text-green-300"
                        title="Сохранить"
                        onClick={() => void saveDraft(draft)}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="text-red-400 hover:text-red-300"
                        title="Удалить"
                        onClick={() => discardDraft(draft.draftId)}
                      >
                        ✗
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredRows.map((row) => (
                  <tr
                    key={row.row_number}
                    className="border-b border-slate-800 hover:bg-slate-900/50"
                  >
                    {COLUMNS.map((col) => (
                      <td key={col.key} className="px-2 py-2 text-slate-300">
                        {cellValue(row, col.key)}
                      </td>
                    ))}
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
