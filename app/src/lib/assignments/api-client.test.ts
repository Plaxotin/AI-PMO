import { describe, expect, it, vi } from 'vitest';
import {
  AssignmentVersionConflictError,
  AssignmentsApiError,
  getAssignment,
  listAssignments,
  patchAssignment,
} from '@/lib/assignments/api-client';
import { DEFAULT_PROJECT_ID } from '@/lib/config';

const assignmentFixture = {
  id: '10000000-0000-4000-8000-000000000020',
  project_id: DEFAULT_PROJECT_ID,
  title: 'Подготовить отчёт',
  description: null,
  status: 'open',
  due_at: null,
  owner_id: null,
  assignee_label: '@lead',
  source: 'manual',
  version: 1,
  created_at: '2026-05-25T20:00:00.000Z',
  updated_at: '2026-05-25T20:00:00.000Z',
} as const;

describe('assignments api client', () => {
  it('parses list response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [assignmentFixture],
          meta: { total: 1, page: 1, per_page: 10 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const response = await listAssignments({
      query: { status: 'open', page: 1, per_page: 10 },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/projects/${DEFAULT_PROJECT_ID}/assignments?status=open&page=1&per_page=10`,
      expect.any(Object),
    );
    expect(response.data[0].id).toBe(assignmentFixture.id);
    expect(response.meta.total).toBe(1);
  });

  it('parses get response with history', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            ...assignmentFixture,
            history: [
              {
                id: '20000000-0000-4000-8000-000000000001',
                assignment_id: assignmentFixture.id,
                event_type: 'created',
                field_name: null,
                from_status: null,
                to_status: 'open',
                old_value: null,
                new_value: null,
                actor_id: null,
                created_at: '2026-05-25T20:00:00.000Z',
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const response = await getAssignment(assignmentFixture.id, { fetchImpl });
    expect(response.history).toHaveLength(1);
    expect(response.history[0].event_type).toBe('created');
  });

  it('throws version conflict error with parsed details', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'VERSION_CONFLICT',
            message: 'Запись изменилась',
            details: {
              current_version: 7,
              assignment: {
                ...assignmentFixture,
                version: 7,
                title: 'Серверная версия',
              },
            },
          },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    });

    await expect(
      patchAssignment(
        assignmentFixture.id,
        { version: 3, title: 'Локальная версия' },
        { fetchImpl },
      ),
    ).rejects.toMatchObject({
      name: 'AssignmentVersionConflictError',
      currentVersion: 7,
    });

    await patchAssignment(
      assignmentFixture.id,
      { version: 3, title: 'Локальная версия' },
      { fetchImpl },
    ).catch((error: unknown) => {
      expect(error).toBeInstanceOf(AssignmentVersionConflictError);
      const conflictError = error as AssignmentVersionConflictError;
      expect(conflictError.assignment.title).toBe('Серверная версия');
    });
  });

  it('throws INVALID_RESPONSE for malformed successful payload', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ wrong: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      listAssignments({
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AssignmentsApiError);
  });
});
