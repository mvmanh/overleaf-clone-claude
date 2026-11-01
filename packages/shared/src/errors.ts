import { z } from 'zod';

/** Stable machine-readable error codes returned by every API endpoint. */
export const ApiErrorCode = z.enum([
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'PRECONDITION_REQUIRED',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/**
 * Consistent error envelope. `requestId` always echoes the `x-request-id`
 * response header so users can quote it in bug reports.
 */
export const ApiErrorResponse = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    requestId: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponse>;

export const REQUEST_ID_HEADER = 'x-request-id';
