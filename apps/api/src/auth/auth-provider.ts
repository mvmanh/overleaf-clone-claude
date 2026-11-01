import type { SessionUser } from '@latex-cloud/shared';

/**
 * Pluggable identity source. `LocalPasswordAuthProvider` is the first
 * implementation; an OIDC provider (authorization-code + PKCE, server-side
 * token exchange) slots in here without touching sessions or ACLs.
 */
export interface AuthProvider {
  readonly id: string;
  authenticate(credentials: { email: string; password: string }): Promise<SessionUser | null>;
}

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
