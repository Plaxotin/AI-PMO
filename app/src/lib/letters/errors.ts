import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

import {
  apiError as baseApiError,
  validationError as baseValidationError,
  type ApiErrorBody,
} from '@/lib/assignments/errors';

export type LetterApiErrorCode =
  | 'BL18_DISABLED'
  | 'FILE_TOO_LARGE'
  | 'TENANT_STORAGE_QUOTA_EXCEEDED'
  | 'TEMPLATE_VALIDATION_FAILED'
  | 'TENANT_MISMATCH'
  | 'TENANT_NOT_FOUND';

export function letterApiError(
  code: LetterApiErrorCode | Parameters<typeof baseApiError>[0],
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return baseApiError(
    code as Parameters<typeof baseApiError>[0],
    message,
    status,
    details,
  );
}

export function letterValidationError(
  zodError: ZodError,
): NextResponse<ApiErrorBody> {
  return baseValidationError(zodError);
}
