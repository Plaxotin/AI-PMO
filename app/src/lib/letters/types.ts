import { z } from 'zod';

export const REQUIRED_PLACEHOLDER_NAMES = [
  'SIGNATORY_NAME',
  'SIGNATORY_TITLE',
  'LETTER_BODY',
  'LETTER_SUBJECT',
  'LETTER_SALUTATION',
  'LETTER_CLOSING',
  'ATTACHMENTS_LIST',
] as const;

export type RequiredPlaceholderName =
  (typeof REQUIRED_PLACEHOLDER_NAMES)[number];

export const LETTER_TEMPLATE_MAX_BYTES = 10 * 1024 * 1024;

export const letterTemplateListItemSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string(),
  organization: z.string().nullable(),
  style_passport: z.string().nullable(),
  active_version: z.number().int().positive().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type LetterTemplateListItem = z.infer<
  typeof letterTemplateListItemSchema
>;

export const letterTemplateDetailSchema = letterTemplateListItemSchema.extend({
  active_version_id: z.string().uuid().nullable(),
  storage_key: z.string().nullable(),
  byte_size: z.number().int().nonnegative().nullable(),
});

export type LetterTemplateDetail = z.infer<typeof letterTemplateDetailSchema>;

export const createTemplateResponseSchema = z.object({
  template_id: z.string().uuid(),
  version: z.number().int().positive(),
  storage_key: z.string(),
});

export type CreateTemplateResponse = z.infer<
  typeof createTemplateResponseSchema
>;
