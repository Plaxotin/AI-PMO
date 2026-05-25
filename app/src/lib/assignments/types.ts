import { z } from 'zod';

export const assignmentStatusSchema = z.enum([
  'draft',
  'open',
  'done',
  'cancelled',
]);

export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const assignmentSourceSchema = z.enum([
  'manual',
  'import',
  'webhook',
  'web_upload',
]);

export type AssignmentSource = z.infer<typeof assignmentSourceSchema>;

export const uuidSchema = z.string().uuid();

export const projectSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(500),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Project = z.infer<typeof projectSchema>;

export const assignmentSchema = z.object({
  id: uuidSchema,
  project_id: uuidSchema,
  title: z.string().min(1).max(500),
  description: z.string().max(10000).nullable(),
  status: assignmentStatusSchema,
  due_at: z.string().datetime().nullable(),
  owner_id: uuidSchema.nullable(),
  assignee_label: z.string().max(500).nullable(),
  source: assignmentSourceSchema,
  version: z.number().int().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Assignment = z.infer<typeof assignmentSchema>;

export const assignmentStatusEventSchema = z.object({
  id: uuidSchema,
  assignment_id: uuidSchema,
  event_type: z.enum(['created', 'status_change', 'field_change', 'cancelled']),
  field_name: z.string().nullable(),
  from_status: assignmentStatusSchema.nullable(),
  to_status: assignmentStatusSchema.nullable(),
  old_value: z.unknown().nullable(),
  new_value: z.unknown().nullable(),
  actor_id: uuidSchema.nullable(),
  created_at: z.string().datetime(),
});

export type AssignmentStatusEvent = z.infer<typeof assignmentStatusEventSchema>;

/** Query params for GET /assignments (BL1-1 contract). */
export const assignmentListQuerySchema = z.object({
  status: assignmentStatusSchema.optional(),
  due_before: z.string().datetime().optional(),
  due_after: z.string().datetime().optional(),
  assignee: z.string().trim().min(1).max(500).optional(),
  source: assignmentSourceSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
});

export type AssignmentListQuery = z.infer<typeof assignmentListQuerySchema>;

export const createAssignmentBodySchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10000).optional().nullable(),
  status: assignmentStatusSchema.default('draft'),
  due_at: z.string().datetime().optional().nullable(),
  assignee_label: z.string().trim().max(500).optional().nullable(),
  source: assignmentSourceSchema.default('manual'),
});

export type CreateAssignmentBody = z.infer<typeof createAssignmentBodySchema>;

export const patchAssignmentBodySchema = z
  .object({
    version: z.number().int().min(1),
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(10000).optional().nullable(),
    status: assignmentStatusSchema.optional(),
    due_at: z.string().datetime().optional().nullable(),
    assignee_label: z.string().trim().max(500).optional().nullable(),
  })
  .refine(
    (body) =>
      body.title !== undefined ||
      body.description !== undefined ||
      body.status !== undefined ||
      body.due_at !== undefined ||
      body.assignee_label !== undefined,
    {
      message: 'Укажите хотя бы одно поле для обновления',
    },
  );

export type PatchAssignmentBody = z.infer<typeof patchAssignmentBodySchema>;

export const assignmentListResponseSchema = z.object({
  data: z.array(assignmentSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    per_page: z.number().int().min(1),
  }),
});

export const assignmentWithHistorySchema = assignmentSchema.extend({
  history: z.array(assignmentStatusEventSchema),
});
