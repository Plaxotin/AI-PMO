import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PROJECT_ID } from '@/lib/config';
import { GET, POST } from './route';
import * as dbAssignments from '@/lib/db/assignments';
import * as routeHelpers from '@/lib/api/route-helpers';

vi.mock('@/lib/db/assignments', () => ({
  listAssignments: vi.fn(),
  createAssignment: vi.fn(),
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
const listAssignmentsMock = vi.mocked(dbAssignments.listAssignments);
const createAssignmentMock = vi.mocked(dbAssignments.createAssignment);

function routeContext(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function assignmentFixture() {
  return {
    id: '10000000-0000-4000-8000-000000000050',
    project_id: DEFAULT_PROJECT_ID,
    title: 'Подготовить отчёт',
    description: null,
    status: 'open' as const,
    due_at: null,
    owner_id: null,
    assignee_label: '@lead',
    source: 'manual' as const,
    version: 1,
    created_at: '2026-05-25T20:00:00.000Z',
    updated_at: '2026-05-25T20:00:00.000Z',
  };
}

describe('GET /api/projects/[projectId]/assignments', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    withAuthMock.mockResolvedValue({
      ok: true,
      auth: { mode: 'disabled', userId: null },
    });
  });

  it('supports BL1-1 filters and pagination meta', async () => {
    listAssignmentsMock.mockResolvedValue({
      data: [assignmentFixture()],
      meta: {
        total: 1,
        page: 2,
        per_page: 10,
      },
    });

    const request = new NextRequest(
      `http://localhost/api/projects/${DEFAULT_PROJECT_ID}/assignments` +
        '?status=open' +
        '&due_before=2026-05-30T00:00:00.000Z' +
        '&due_after=2026-05-20T00:00:00.000Z' +
        '&assignee=%40lead' +
        '&source=web_upload' +
        '&page=2' +
        '&per_page=10',
    );

    const response = await GET(request, routeContext(DEFAULT_PROJECT_ID));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(listAssignmentsMock).toHaveBeenCalledWith(DEFAULT_PROJECT_ID, {
      status: 'open',
      due_before: '2026-05-30T00:00:00.000Z',
      due_after: '2026-05-20T00:00:00.000Z',
      assignee: '@lead',
      source: 'web_upload',
      page: 2,
      per_page: 10,
    });
    expect(json.meta).toEqual({ total: 1, page: 2, per_page: 10 });
  });

  it('returns 404 PROJECT_MISMATCH for foreign UUID project', async () => {
    const request = new NextRequest(
      'http://localhost/api/projects/00000000-0000-4000-8000-000000000099/assignments',
    );

    const response = await GET(
      request,
      routeContext('00000000-0000-4000-8000-000000000099'),
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error.code).toBe('PROJECT_MISMATCH');
  });
});

describe('POST /api/projects/[projectId]/assignments', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    withAuthMock.mockResolvedValue({
      ok: true,
      auth: { mode: 'disabled', userId: null },
    });
  });

  it('creates assignment (CRUD: create)', async () => {
    const created = assignmentFixture();
    createAssignmentMock.mockResolvedValue(created);

    const request = new NextRequest(
      `http://localhost/api/projects/${DEFAULT_PROJECT_ID}/assignments`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: 'Подготовить отчёт',
          source: 'web_upload',
        }),
        headers: { 'content-type': 'application/json' },
      },
    );

    const response = await POST(request, routeContext(DEFAULT_PROJECT_ID));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(createAssignmentMock).toHaveBeenCalledWith(
      DEFAULT_PROJECT_ID,
      expect.objectContaining({
        title: 'Подготовить отчёт',
        source: 'web_upload',
      }),
      null,
    );
    expect(json.data.id).toBe(created.id);
  });
});
