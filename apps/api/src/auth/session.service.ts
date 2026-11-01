import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import type { SessionUser } from '@latex-cloud/shared';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LAST_SEEN_RESOLUTION_MS = 5 * 60_000;

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Server-side sessions with opaque random tokens. Only a SHA-256 of the token
 * is stored, so a database leak does not yield usable cookies. Revocation is
 * immediate (logout, password change, admin action).
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get ttlMs(): number {
    return this.config.SESSION_TTL_HOURS * 3_600_000;
  }

  async create(
    userId: string,
    meta: { userAgent?: string | undefined; ip?: string | undefined },
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.db
      .insertInto('auth_sessions')
      .values({
        user_id: userId,
        token_hash: hashToken(token),
        expires_at: expiresAt,
        user_agent: meta.userAgent?.slice(0, 512) ?? null,
        ip: meta.ip ?? null,
      })
      .execute();
    return { token, expiresAt };
  }

  async resolve(token: string | undefined): Promise<SessionUser | null> {
    if (!token || !TOKEN_PATTERN.test(token)) return null;
    const row = await this.db
      .selectFrom('auth_sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select(['s.id as sessionId', 's.last_seen_at', 'u.id', 'u.email', 'u.display_name'])
      .where('s.token_hash', '=', hashToken(token))
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', sql<Date>`now()`)
      .executeTakeFirst();
    if (!row) return null;

    if (Date.now() - new Date(row.last_seen_at).getTime() > LAST_SEEN_RESOLUTION_MS) {
      await this.db
        .updateTable('auth_sessions')
        .set({ last_seen_at: sql`now()` })
        .where('id', '=', row.sessionId)
        .execute();
    }
    return { id: row.id, email: row.email, displayName: row.display_name };
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!token || !TOKEN_PATTERN.test(token)) return;
    await this.db
      .updateTable('auth_sessions')
      .set({ revoked_at: sql`now()` })
      .where('token_hash', '=', hashToken(token))
      .where('revoked_at', 'is', null)
      .execute();
  }
}
