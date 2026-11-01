import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorCode, ApiErrorResponse } from '@latex-cloud/shared';
import { ApiException } from './api-exception';

const STATUS_CODES: Partial<Record<number, ApiErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  428: 'PRECONDITION_REQUIRED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Every error leaves the API in the shared `ApiErrorResponse` shape. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = req.requestId ?? 'unknown';

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorResponse['error'];

    if (exception instanceof ApiException) {
      status = exception.getStatus();
      body = {
        code: exception.code,
        message: exception.message,
        requestId,
        ...(exception.details ? { details: exception.details } : {}),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const code = STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST');
      // Body-parser errors (malformed JSON, too large) surface as HttpExceptions.
      const message =
        status === 404 ? 'Not found.' : status >= 500 ? 'Internal error.' : exception.message;
      body = { code, message, requestId };
    } else {
      this.logger.error({ requestId, err: exception }, 'unhandled error');
      body = { code: 'INTERNAL', message: 'Something went wrong.', requestId };
    }

    if (status >= 500 && !(exception instanceof ApiException)) {
      this.logger.error(`[${requestId}] ${req.method} ${req.path} -> ${status}`);
    }
    res.status(status).json({ error: body } satisfies ApiErrorResponse);
  }
}
