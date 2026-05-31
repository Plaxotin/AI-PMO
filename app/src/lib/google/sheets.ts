import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { PMI_HEADERS } from '@/lib/pmi/types';
import type { ParsedAssignment, PmiRow, SheetRow } from '@/lib/pmi/types';

const TEMPLATE_SHEET_TITLE = 'Action Items';

export function extractSpreadsheetId(urlOrId: string): string | null {
  const trimmed = urlOrId.trim();
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed) && !trimmed.includes('/')) {
    return trimmed;
  }
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? null;
}

export function spreadsheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

function sheetsApi(auth: OAuth2Client) {
  return google.sheets({ version: 'v4', auth });
}

function driveApi(auth: OAuth2Client) {
  return google.drive({ version: 'v3', auth });
}

export async function createPmiSpreadsheet(auth: OAuth2Client): Promise<{
  spreadsheetId: string;
  spreadsheetUrl: string;
}> {
  const sheets = sheetsApi(auth);
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: 'AI PMO — Action Item Tracker' },
      sheets: [{ properties: { title: TEMPLATE_SHEET_TITLE } }],
    },
  });
  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) throw new Error('Failed to create spreadsheet');

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TEMPLATE_SHEET_TITLE}!A1:K1`,
    valueInputOption: 'RAW',
    requestBody: { values: [PMI_HEADERS as unknown as string[]] },
  });

  return {
    spreadsheetId,
    spreadsheetUrl: spreadsheetUrl(spreadsheetId),
  };
}

export async function validatePmiHeaders(
  auth: OAuth2Client,
  spreadsheetId: string,
): Promise<boolean> {
  const rows = await readAllRows(auth, spreadsheetId);
  if (rows.length === 0) return false;
  const header = rows[0];
  if (!header || header.length < 11) return false;
  return PMI_HEADERS.every(
    (h, i) => String(header[i] ?? '').trim().toLowerCase() === h.toLowerCase(),
  );
}

export async function deleteSpreadsheet(
  auth: OAuth2Client,
  spreadsheetId: string,
): Promise<void> {
  const drive = driveApi(auth);
  await drive.files.delete({ fileId: spreadsheetId });
}

function parsePriority(value: string): 1 | 2 | 3 | null {
  const n = Number.parseInt(value, 10);
  if (n === 1 || n === 2 || n === 3) return n;
  const lower = value.toLowerCase();
  if (lower.includes('high') || lower.includes('высок')) return 1;
  if (lower.includes('medium') || lower.includes('средн')) return 2;
  if (lower.includes('low') || lower.includes('низк')) return 3;
  return null;
}

function parseStatus(value: string): 1 | 2 | 3 | null {
  const n = Number.parseInt(value, 10);
  if (n === 1 || n === 2 || n === 3) return n;
  return 1;
}

function rowFromValues(values: string[], rowNumber: number): SheetRow | null {
  const brief = String(values[1] ?? '').trim();
  if (!brief && rowNumber > 1) return null;
  if (rowNumber === 1 && values[0] === 'ID') return null;

  const idRaw = values[0];
  const id = idRaw ? Number.parseInt(String(idRaw), 10) : undefined;

  return {
    row_number: rowNumber,
    id: Number.isFinite(id) ? id : undefined,
    brief_name: brief || '(без названия)',
    description: values[2] ? String(values[2]) : null,
    source: values[3] ? String(values[3]) : null,
    owner: values[4] ? String(values[4]) : null,
    priority: values[5] ? parsePriority(String(values[5])) : null,
    date_added: values[6] ? String(values[6]) : null,
    target_date: values[7] ? String(values[7]) : null,
    status: values[8] ? parseStatus(String(values[8])) : 1,
    running_status_comments: values[9] ? String(values[9]) : null,
    completion_date: values[10] ? String(values[10]) : null,
  };
}

export async function readAllRows(
  auth: OAuth2Client,
  spreadsheetId: string,
): Promise<string[][]> {
  const sheets = sheetsApi(auth);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TEMPLATE_SHEET_TITLE}!A:K`,
  });
  return (res.data.values as string[][]) ?? [];
}

export async function listAssignmentRows(
  auth: OAuth2Client,
  spreadsheetId: string,
): Promise<SheetRow[]> {
  const values = await readAllRows(auth, spreadsheetId);
  const rows: SheetRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const parsed = rowFromValues(values[i] ?? [], i + 1);
    if (parsed && parsed.brief_name) rows.push(parsed);
  }
  return rows;
}

function nextId(rows: SheetRow[]): number {
  let max = 0;
  for (const r of rows) {
    if (r.id && r.id > max) max = r.id;
  }
  return max + 1;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function priorityLabel(p: 1 | 2 | 3): string {
  return String(p);
}

function statusLabel(s: 1 | 2 | 3): string {
  return String(s);
}

export function buildSheetRowValues(
  row: ParsedAssignment | PmiRow,
  existingRows: SheetRow[],
): string[] {
  const id = 'id' in row && row.id ? row.id : nextId(existingRows);
  const today = formatDate(new Date());
  const priority = row.priority ?? 2;
  const status = ('status' in row && row.status) ? row.status : 1;

  return [
    String(id),
    row.brief_name,
    row.description ?? '',
    row.source ?? '',
    row.owner ?? '',
    priorityLabel(priority),
    ('date_added' in row && row.date_added) ? row.date_added : today,
    row.target_date ?? '',
    statusLabel(status),
    ('running_status_comments' in row && row.running_status_comments)
      ? row.running_status_comments
      : '',
    ('completion_date' in row && row.completion_date) ? row.completion_date : '',
  ];
}

export async function appendRow(
  auth: OAuth2Client,
  spreadsheetId: string,
  row: ParsedAssignment | PmiRow,
): Promise<{ row_number: number }> {
  const existing = await listAssignmentRows(auth, spreadsheetId);
  const values = buildSheetRowValues(row, existing);
  const sheets = sheetsApi(auth);
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TEMPLATE_SHEET_TITLE}!A:K`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
  const updatedRange = res.data.updates?.updatedRange ?? '';
  const match = updatedRange.match(/!A(\d+)/i);
  const row_number = match ? Number.parseInt(match[1], 10) : existing.length + 2;
  return { row_number };
}

export async function appendRowsBatch(
  auth: OAuth2Client,
  spreadsheetId: string,
  rows: (ParsedAssignment | PmiRow)[],
): Promise<{ rows_written: number }> {
  let existing = await listAssignmentRows(auth, spreadsheetId);
  const allValues: string[][] = [];
  for (const row of rows) {
    allValues.push(buildSheetRowValues(row, existing));
    existing = [
      ...existing,
      {
        row_number: existing.length + 2,
        brief_name: row.brief_name,
        id: nextId(existing),
      },
    ];
  }
  const sheets = sheetsApi(auth);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TEMPLATE_SHEET_TITLE}!A:K`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: allValues },
  });
  return { rows_written: rows.length };
}

export async function getSpreadsheetTitle(
  auth: OAuth2Client,
  spreadsheetId: string,
): Promise<string> {
  const sheets = sheetsApi(auth);
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return meta.data.properties?.title ?? 'Spreadsheet';
}
