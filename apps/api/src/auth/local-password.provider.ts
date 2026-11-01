import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { SessionUser } from '@latex-cloud/shared';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import type { AuthProvider } from './auth-provider';
import { PasswordHasher } from './password-hasher';

@Injectable()
export class LocalPasswordAuthProvider implements AuthProvider {
  readonly id = 'local';

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly hasher: PasswordHasher,
  ) {}

  async authenticate({
    email,
    password,
  }: {
    email: string;
    password: string;
  }): Promise<SessionUser | null> {
    const row = await this.db
      .selectFrom('users as u')
      .innerJoin('user_password_credentials as c', 'c.user_id', 'u.id')
      .select(['u.id', 'u.email', 'u.display_name', 'c.password_hash'])
      .where('u.email', '=', email.toLowerCase())
      .where('u.auth_provider', '=', 'local')
      .executeTakeFirst();

    if (!row) return this.hasher.verifyAgainstDummy(password).then(() => null);
    if (!(await this.hasher.verify(row.password_hash, password))) return null;
    return { id: row.id, email: row.email, displayName: row.display_name };
  }
}
