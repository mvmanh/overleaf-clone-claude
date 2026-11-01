import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorCode } from '@latex-cloud/shared';

export class ApiException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message, status);
  }
}

export const unauthenticated = () =>
  new ApiException('UNAUTHENTICATED', 'Sign in to continue.', HttpStatus.UNAUTHORIZED);
export const forbidden = (message = 'You do not have permission to do that.') =>
  new ApiException('FORBIDDEN', message, HttpStatus.FORBIDDEN);
export const notFound = (what = 'Resource') =>
  new ApiException('NOT_FOUND', `${what} not found.`, HttpStatus.NOT_FOUND);
