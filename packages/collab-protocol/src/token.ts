import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Short-lived, project-scoped bearer token for the collab WebSocket.
 *
 * Minted by the API for an authenticated member, verified by the collab
 * server. It proves *who* is connecting and *which project* they may open;
 * the collab server still re-reads the current role from the database on
 * connect (and whenever membership changes), so a token never outlives a
 * revoked membership.
 *
 * Format: `v1.<base64url(JSON claims)>.<base64url(HMAC-SHA256)>`.
 */

export const COLLAB_TOKEN_TTL_SECONDS = 10 * 60;
/**
 * Used when NODE_ENV=development and no secret is configured, so a fresh
 * checkout (or an older .env) works out of the box. Refused in production.
 */
export const DEV_COLLAB_TOKEN_SECRET = 'latex-cloud-dev-only-collab-secret-change-me';
/** Secrets shorter than this are refused (prevents weak/dev secrets in prod). */
export const MIN_COLLAB_SECRET_LENGTH = 32;

const Claims = z.object({
  /** User id. */
  sub: z.string().uuid(),
  /** Project id the token is scoped to. */
  pid: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  /** Random id, for log correlation. */
  jti: z.string().min(8),
});
export type CollabTokenClaims = z.infer<typeof Claims>;

const b64 = (b: Buffer) => b.toString('base64url');

function sign(secret: string, body: string): Buffer {
  return createHmac('sha256', secret).update(`v1.${body}`).digest();
}

function assertSecret(secret: string): void {
  if (secret.length < MIN_COLLAB_SECRET_LENGTH)
    throw new Error(`collab token secret must be at least ${MIN_COLLAB_SECRET_LENGTH} characters`);
}

export function mintCollabToken(
  secret: string,
  subject: { userId: string; projectId: string },
  opts: { now?: number; ttlSeconds?: number } = {},
): { token: string; claims: CollabTokenClaims } {
  assertSecret(secret);
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const claims: CollabTokenClaims = {
    sub: subject.userId,
    pid: subject.projectId,
    iat,
    exp: iat + (opts.ttlSeconds ?? COLLAB_TOKEN_TTL_SECONDS),
    jti: b64(randomBytes(9)),
  };
  const body = b64(Buffer.from(JSON.stringify(claims), 'utf8'));
  return { token: `v1.${body}.${b64(sign(secret, body))}`, claims };
}

export type VerifyResult =
  | { ok: true; claims: CollabTokenClaims }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

/** Constant-time signature check, then expiry (with 30 s clock-skew allowance). */
export function verifyCollabToken(
  secret: string,
  token: string,
  opts: { now?: number } = {},
): VerifyResult {
  assertSecret(secret);
  if (typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, reason: 'malformed' };
  const [, body, sig] = parts as [string, string, string];
  const expected = sign(secret, body);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return { ok: false, reason: 'signature' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const claims = Claims.safeParse(parsed);
  if (!claims.success) return { ok: false, reason: 'malformed' };
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (claims.data.exp + 30 < now) return { ok: false, reason: 'expired' };
  return { ok: true, claims: claims.data };
}
