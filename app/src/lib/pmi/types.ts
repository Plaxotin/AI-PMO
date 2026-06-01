import { z } from 'zod';

/** PMI Action Item Tracker columns A–K (BL-6 v2.2). */
export const PMI_HEADERS = [
  'ID',
  'Brief Name',
  'Description',
  'Source',
  'Owner',
  'Priority',
  'Date Added',
  'Target Date',
  'Status',
  'Running Status Comments',
  'Completion Date',
] as const;

export const pmiRowSchema = z.object({
  id: z.number().int().positive().optional(),
  brief_name: z.string(),
  description: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  owner: z.string().optional().nullable(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().nullable(),
  date_added: z.string().optional().nullable(),
  target_date: z.string().optional().nullable(),
  status: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().nullable(),
  running_status_comments: z.string().optional().nullable(),
  completion_date: z.string().optional().nullable(),
});

export type PmiRow = z.infer<typeof pmiRowSchema>;

export const parsedAssignmentSchema = z.object({
  brief_name: z.string(),
  description: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  owner: z.string().optional().nullable(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().nullable(),
  target_date: z.string().optional().nullable(),
});

export type ParsedAssignment = z.infer<typeof parsedAssignmentSchema>;

export const createPmiRowBodySchema = parsedAssignmentSchema;
export const parseTextBodySchema = z.object({
  text: z.string().trim().min(1).max(50_000),
});

export const batchPmiRowsBodySchema = z.object({
  rows: z.array(pmiRowSchema).min(1).max(100),
});

export const updatePmiRowsBodySchema = z.object({
  rows: z
    .array(pmiRowSchema.extend({ row_number: z.number().int().positive() }))
    .min(1)
    .max(100),
});

export const connectSheetBodySchema = z.object({
  spreadsheet_url: z.string().url(),
});

export type SheetRow = PmiRow & { row_number: number };
