import { describe, expect, it } from 'vitest';
import {
  assignmentListQuerySchema,
  createAssignmentBodySchema,
  patchAssignmentBodySchema,
} from '@/lib/assignments/types';

describe('assignmentListQuerySchema', () => {
  it('applies defaults for limit and offset', () => {
    const result = assignmentListQuerySchema.parse({});
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it('rejects invalid status', () => {
    const result = assignmentListQuerySchema.safeParse({ status: 'pending' });
    expect(result.success).toBe(false);
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
});

describe('patchAssignmentBodySchema', () => {
  it('rejects empty patch', () => {
    const result = patchAssignmentBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
