import { z } from 'zod';

export const assignmentStatusSchema = z.enum([
  'draft',
  'open',
  'done',
  'cancelled',
]);

export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const assignmentSourceSchema = z.enum(['manual', 'import', 'webhook']);

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
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Assignment = z.infer<typeof assignmentSchema>;

export const assignmentStatusEventSchema = z.object({
  id: uuidSchema,
  assignment_id: uuidSchema,
  from_status: assignmentStatusSchema.nullable(),
  to_status: assignmentStatusSchema,
  actor_id: uuidSchema.nullable(),
  created_at: z.string().datetime(),
});

export type AssignmentStatusEvent = z.infer<typeof assignmentStatusEventSchema>;

/** Query params for GET /assignments (US-6 filters, BL1-0). */
export const assignmentListQuerySchema = z.object({
  status: assignmentStatusSchema.optional(),
  due_from: z.string().datetime().optional(),
  due_to: z.string().datetime().optional(),
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
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
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(10000).optional().nullable(),
    status: assignmentStatusSchema.optional(),
    due_at: z.string().datetime().optional().nullable(),
    assignee_label: z.string().trim().max(500).optional().nullable(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Укажите хотя бы одно поле для обновления',
  });

export type PatchAssignmentBody = z.infer<typeof patchAssignmentBodySchema>;

export const assignmentListResponseSchema = z.object({
  data: z.array(assignmentSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int(),
    offset: z.number().int(),
  }),
});
