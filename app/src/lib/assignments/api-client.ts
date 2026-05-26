import { z } from 'zod';
import { DEFAULT_PROJECT_ID } from '@/lib/config';
import {
  assignmentListResponseSchema,
  assignmentSchema,
  assignmentWithHistorySchema,
  createAssignmentBodySchema,
  patchAssignmentBodySchema,
  type Assignment,
  type AssignmentListQuery,
  type AssignmentStatus,
  type AssignmentSource,
  type CreateAssignmentBody,
  type PatchAssignmentBody,
} from '@/lib/assignments/types';
import {
  buildAssignmentsSearchParams,
  type AssignmentListRequestQuery,
} from '@/lib/assignments/query';

type FetchLike = typeof fetch;

const assignmentEnvelopeSchema = z.object({
  data: assignmentSchema,
});

const assignmentWithHistoryEnvelopeSchema = z.object({
  data: assignmentWithHistorySchema,
});

const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const versionConflictDetailsSchema = z.object({
  current_version: z.number().int().min(1),
  assignment: assignmentSchema,
});

export class AssignmentsApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = 'AssignmentsApiError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
  }
}

export class AssignmentVersionConflictError extends AssignmentsApiError {
  currentVersion: number;
  assignment: Assignment;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    currentVersion: number;
    assignment: Assignment;
  }) {
    super(params);
    this.name = 'AssignmentVersionConflictError';
    this.currentVersion = params.currentVersion;
    this.assignment = params.assignment;
  }
}

type RequestOptions = {
  projectId?: string;
  fetchImpl?: FetchLike;
};

type ListOptions = RequestOptions & {
  query?: AssignmentListRequestQuery;
};

type CreateInput = Omit<
  CreateAssignmentBody,
  'status' | 'source'
> & {
  status?: AssignmentStatus;
  source?: AssignmentSource;
};

type PatchInput = Omit<
  PatchAssignmentBody,
  'version'
> & {
  version: number;
};

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toApiError(status: number, payload: unknown): AssignmentsApiError {
  const parsedError = apiErrorSchema.safeParse(payload);
  if (!parsedError.success) {
    return new AssignmentsApiError({
      status,
      code: 'INVALID_RESPONSE',
      message: 'Некорректный ответ API',
      details: payload,
    });
  }

  const { error } = parsedError.data;
  if (status === 409 && error.code === 'VERSION_CONFLICT') {
    const detailsParsed = versionConflictDetailsSchema.safeParse(error.details);
    if (detailsParsed.success) {
      return new AssignmentVersionConflictError({
        status,
        code: error.code,
        message: error.message,
        details: error.details,
        currentVersion: detailsParsed.data.current_version,
        assignment: detailsParsed.data.assignment,
      });
    }
  }

  return new AssignmentsApiError({
    status,
    code: error.code,
    message: error.message,
    details: error.details,
  });
}

async function requestAndParse<T>({
  path,
  init,
  schema,
  options,
}: {
  path: string;
  init?: RequestInit;
  schema: z.ZodType<T>;
  options?: RequestOptions;
}): Promise<T> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const projectId = options?.projectId ?? DEFAULT_PROJECT_ID;
  const response = await fetchImpl(`/api/projects/${projectId}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = await safeJson(response);
  if (!response.ok) {
    throw toApiError(response.status, payload);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AssignmentsApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      message: 'Некорректный формат ответа API',
      details: parsed.error.flatten(),
    });
  }
  return parsed.data;
}

export async function listAssignments(options: ListOptions = {}) {
  const params = buildAssignmentsSearchParams(options.query ?? {});
  const queryString = params.toString();
  const path = `/assignments${queryString ? `?${queryString}` : ''}`;

  return requestAndParse({
    path,
    schema: assignmentListResponseSchema,
    options,
  });
}

export async function getAssignment(assignmentId: string, options: RequestOptions = {}) {
  const result = await requestAndParse({
    path: `/assignments/${assignmentId}`,
    schema: assignmentWithHistoryEnvelopeSchema,
    options,
  });
  return result.data;
}

export async function createAssignment(input: CreateInput, options: RequestOptions = {}) {
  const body = createAssignmentBodySchema.parse(input);
  const result = await requestAndParse({
    path: '/assignments',
    init: {
      method: 'POST',
      body: JSON.stringify(body),
    },
    schema: assignmentEnvelopeSchema,
    options,
  });
  return result.data;
}

export async function patchAssignment(
  assignmentId: string,
  input: PatchInput,
  options: RequestOptions = {},
) {
  const body = patchAssignmentBodySchema.parse(input);
  const result = await requestAndParse({
    path: `/assignments/${assignmentId}`,
    init: {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
    schema: assignmentEnvelopeSchema,
    options,
  });
  return result.data;
}

export async function deleteAssignment(assignmentId: string, options: RequestOptions = {}) {
  const result = await requestAndParse({
    path: `/assignments/${assignmentId}`,
    init: { method: 'DELETE' },
    schema: assignmentEnvelopeSchema,
    options,
  });
  return result.data;
}

export type AssignmentListResponse = Awaited<ReturnType<typeof listAssignments>>;
export type AssignmentDetails = Awaited<ReturnType<typeof getAssignment>>;
export type AssignmentListParams = Partial<AssignmentListQuery>;
