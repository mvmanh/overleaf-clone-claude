import type { SessionUser } from '@latex-cloud/shared';

declare global {
  namespace Express {
    interface Request {
      /** Set by requestIdMiddleware for every request. */
      requestId: string;
      /** Set by SessionGuard on authenticated routes. */
      user?: SessionUser;
    }
  }
}

export {};
