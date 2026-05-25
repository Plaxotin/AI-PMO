import { describe, expect, it } from 'vitest';
import {
  assignmentListQuerySchema,
  createAssignmentBodySchema,
  patchAssignmentBodySchema,
} from '@/lib/assignments/types';

describe('assignmentListQuerySchema', () => {
  it('applies defaults for page and per_page', () => {
    const result = assignmentListQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.per_page).toBe(50);
  });

  it('parses BL1-1 filters', () => {
    const result = assignmentListQuerySchema.parse({
      status: 'open',
      due_before: '2026-05-25T00:00:00.000Z',
      due_after: '2026-05-24T00:00:00.000Z',
      assignee: '@pmo-lead',
      source: 'web_upload',
      page: '2',
      per_page: '20',
    });
    expect(result).toEqual({
      status: 'open',
      due_before: '2026-05-25T00:00:00.000Z',
      due_after: '2026-05-24T00:00:00.000Z',
      assignee: '@pmo-lead',
      source: 'web_upload',
      page: 2,
      per_page: 20,
    });
  });
});

describe('createAssignmentBodySchema', () => {
  it('requires title', () => {
    const result = createAssignmentBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('defaults status to draft', () => {
    const result = createAssignmentBodySchema.parse({ title: 'Тест' });
    expect(result.status).toBe('draft');
    expect(result.source).toBe('manual');
  });

  it('accepts web_upload source', () => {
    const result = createAssignmentBodySchema.parse({
      title: 'Web upload task',
      source: 'web_upload',
    });
    expect(result.source).toBe('web_upload');
  });
});

describe('patchAssignmentBodySchema', () => {
  it('rejects empty patch', () => {
    const result = patchAssignmentBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('requires version', () => {
    const result = patchAssignmentBodySchema.safeParse({ title: 'Updated' });
    expect(result.success).toBe(false);
  });

  it('accepts version with at least one change', () => {
    const result = patchAssignmentBodySchema.parse({
      version: 3,
      status: 'done',
    });
    expect(result.version).toBe(3);
    expect(result.status).toBe('done');
  });
});
