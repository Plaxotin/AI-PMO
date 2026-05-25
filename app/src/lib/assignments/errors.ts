import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'PROJECT_MISMATCH'
  | 'VERSION_CONFLICT'
  | 'INTERNAL_ERROR'
  | 'DATABASE_UNAVAILABLE';

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    },
    { status },
  );
}

export function validationError(zodError: ZodError): NextResponse<ApiErrorBody> {
  return apiError(
    'VALIDATION_ERROR',
    'Некорректные параметры запроса',
    400,
    zodError.flatten(),
  );
}

export function notImplemented(feature: string): NextResponse<ApiErrorBody> {
  return apiError(
    'NOT_IMPLEMENTED',
    `Функция «${feature}» будет реализована в фазе BL1-1`,
    501,
  );
}
