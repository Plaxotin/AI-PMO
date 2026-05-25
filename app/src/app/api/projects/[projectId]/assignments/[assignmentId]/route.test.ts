import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PROJECT_ID } from '@/lib/config';
import { DELETE, GET, PATCH } from './route';
import * as dbAssignments from '@/lib/db/assignments';
import * as routeHelpers from '@/lib/api/route-helpers';

vi.mock('@/lib/db/assignments', () => ({
  getAssignmentById: vi.fn(),
  listAssignmentHistoryEvents: vi.fn(),
  updateAssignment: vi.fn(),
  cancelAssignment: vi.fn(),
}));

vi.mock('@/lib/api/route-helpers', () => ({
  withAuth: vi.fn(),
  jsonWithAuth: (body: unknown, init: { status?: number }) =>
    NextResponse.json(body, { status: init.status ?? 200 }),
  databaseUnavailableResponse: () =>
    NextResponse.json(
      {
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'db unavailable',
        },
      },
      { status: 503 },
    ),
}));

const withAuthMock = vi.mocked(routeHelpers.withAuth);
const getAssignmentByIdMock = vi.mocked(dbAssignments.getAssignmentById);
const listAssignmentHistoryEventsMock = vi.mocked(
  dbAssignments.listAssignmentHistoryEvents,
);
const updateAssignmentMock = vi.mocked(dbAssignments.updateAssignment);
const cancelAssignmentMock = vi.mocked(dbAssignments.cancelAssignment);

const ASSIGNMENT_ID = '10000000-0000-4000-8000-000000000050';

function routeContext(projectId: string, assignmentId: string = ASSIGNMENT_ID) {
  return { params: Promise.resolve({ projectId, assignmentId }) };
}

function assignmentFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ASSIGNMENT_ID,
    project_id: DEFAULT_PROJECT_ID,
    title: 'Подготовить отчёт',
    description: null,
    status: 'open',
    due_at: null,
    owner_id: null,
    assignee_label: '@lead',
    source: 'manual',
    version: 2,
    created_at: '2026-05-25T20:00:00.000Z',
    updated_at: '2026-05-25T20:00:00.000Z',
    ...overrides,
  };
}

describe('item assignment routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    withAuthMock.mockResolvedValue({
      ok: true,
      auth: { mode: 'disabled', userId: null },
    });
  });

  it('returns assignment with history (CRUD: read)', async () => {
    getAssignmentByIdMock.mockResolvedValue(assignmentFixture());
    listAssignmentHistoryEventsMock.mockResolvedValue([
      {
        id: '20000000-0000-4000-8000-000000000001',
        assignment_id: ASSIGNMENT_ID,
        event_type: 'created',
        field_name: null,
        from_status: null,
        to_status: 'open',
        old_value: null,
        new_value: null,
        actor_id: null,
        created_at: '2026-05-25T20:00:00.000Z',
      },
    ]);

    const request = new NextRequest(
      `http://localhost/api/projects/${DEFAULT_PROJECT_ID}/assignments/${ASSIGNMENT_ID}`,
    );
    const response = await GET(
      request,
      routeContext(DEFAULT_PROJECT_ID, ASSIGNMENT_ID),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.id).toBe(ASSIGNMENT_ID);
    expect(Array.isArray(json.data.history)).toBe(true);
    expect(json.data.history[0].event_type).toBe('created');
  });

  it('returns 409 VERSION_CONFLICT for stale patch version', async () => {
    const current = assignmentFixture({ version: 5, title: 'Актуальный заголовок' });
    updateAssignmentMock.mockResolvedValue({
      kind: 'version_conflict',
      current,
    });

    const request = new NextRequest(
      `http://localhost/api/projects/${DEFAULT_PROJECT_ID}/assignments/${ASSIGNMENT_ID}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          version: 3,
          title: 'Устаревшее изменение',
        }),
        headers: { 'content-type': 'application/json' },
      },
    );

    const response = await PATCH(
      request,
      routeContext(DEFAULT_PROJECT_ID, ASSIGNMENT_ID),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error.code).toBe('VERSION_CONFLICT');
    expect(json.error.details.current_version).toBe(5);
    expect(json.error.details.assignment.id).toBe(ASSIGNMENT_ID);
  });

  it('updates assignment with versioned PATCH (CRUD: update)', async () => {
    updateAssignmentMock.mockResolvedValue({
      kind: 'updated',
      assignment: assignmentFixture({ version: 3, title: 'Обновлено' }),
    });

    const request = new NextRequest(
      `http://localhost/api/projects/${DEFAULT_PROJECT_ID}/assignments/${ASSIGNMENT_ID}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          version: 2,
          title: 'Обновлено',
        }),
        headers: { 'content-type': 'application/json' },
      },
    );

    const response = await PATCH(
      request,
      routeContext(DEFAULT_PROJECT_ID, ASSIGNMENT_ID),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(updateAssignmentMock).toHaveBeenCalledWith(
      DEFAULT_PROJECT_ID,
      ASSIGNMENT_ID,
      { version: 2, title: 'Обновлено' },
      null,
    );
    expect(json.data.version).toBe(3);
  });

  it('soft-cancels assignment (CRUD: delete)', async () => {
    cancelAssignmentMock.mockResolvedValue(
      assignmentFixture({
        status: 'cancelled',
        version: 4,
      }),
    );

    const request = new NextRequest(
      `http://localhost/api/projects/${DEFAULT_PROJECT_ID}/assignments/${ASSIGNMENT_ID}`,
      {
        method: 'DELETE',
      },
    );
    const response = await DELETE(
      request,
      routeContext(DEFAULT_PROJECT_ID, ASSIGNMENT_ID),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(cancelAssignmentMock).toHaveBeenCalledWith(
      DEFAULT_PROJECT_ID,
      ASSIGNMENT_ID,
      null,
    );
    expect(json.data.status).toBe('cancelled');
  });
});
