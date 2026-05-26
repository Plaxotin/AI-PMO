import { describe, expect, it } from 'vitest';
import {
  applyOptimisticCancel,
  applyOptimisticPatch,
  upsertAssignment,
} from '@/lib/assignments/optimistic';
import type { Assignment } from '@/lib/assignments/types';
import { DEFAULT_PROJECT_ID } from '@/lib/config';

function assignmentFixture(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: '10000000-0000-4000-8000-000000000010',
    project_id: DEFAULT_PROJECT_ID,
    title: 'Подготовить отчёт',
    description: 'Исходное описание',
    status: 'open',
    due_at: '2026-05-30T09:00:00.000Z',
    owner_id: null,
    assignee_label: '@lead',
    source: 'manual',
    version: 4,
    created_at: '2026-05-20T09:00:00.000Z',
    updated_at: '2026-05-20T09:00:00.000Z',
    ...overrides,
  };
}

describe('upsertAssignment', () => {
  it('replaces existing assignment with same id', () => {
    const updated = assignmentFixture({ title: 'Обновлено' });
    const result = upsertAssignment([assignmentFixture()], updated);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Обновлено');
  });

  it('prepends assignment when id is new', () => {
    const second = assignmentFixture({
      id: '10000000-0000-4000-8000-000000000011',
      title: 'Новая запись',
    });
    const result = upsertAssignment([assignmentFixture()], second);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(second.id);
  });
});

describe('applyOptimisticPatch', () => {
  it('applies changes and increments version', () => {
    const now = '2026-05-26T10:00:00.000Z';
    const result = applyOptimisticPatch(
      assignmentFixture(),
      {
        title: 'Патч',
        due_at: null,
      },
      now,
    );

    expect(result.title).toBe('Патч');
    expect(result.due_at).toBeNull();
    expect(result.version).toBe(5);
    expect(result.updated_at).toBe(now);
  });
});

describe('applyOptimisticCancel', () => {
  it('sets cancelled status and increments version', () => {
    const now = '2026-05-26T10:01:00.000Z';
    const result = applyOptimisticCancel(assignmentFixture(), now);
    expect(result.status).toBe('cancelled');
    expect(result.version).toBe(5);
    expect(result.updated_at).toBe(now);
  });
});
