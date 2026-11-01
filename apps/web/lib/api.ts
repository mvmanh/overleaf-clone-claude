import { ApiErrorResponse } from '@latex-cloud/shared';
import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Fetches a same-origin API path and validates the response against a contract schema. */
export async function apiFetch<T>(
  path: string,
  schema: ZodType<T> | null,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }
  const text = await res.text();
  const json: unknown = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const parsed = ApiErrorResponse.safeParse(json);
    if (parsed.success) {
      const e = parsed.data.error;
      throw new ApiError(res.status, e.code, e.message, e.requestId);
    }
    throw new ApiError(res.status, 'HTTP_' + res.status, `Request failed (${res.status}).`);
  }
  if (!schema) return undefined as T;
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new ApiError(res.status, 'BAD_RESPONSE', 'Unexpected response from server.');
  return parsed.data;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Only allow same-site relative redirects after login (no open redirect). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\'))
    return '/projects';
  return next;
}
