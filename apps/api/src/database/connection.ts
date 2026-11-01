import { Kysely, Migrator, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { migrationProvider } from './migrations';
import type { Database } from './schema';

export function createDb(url: string, poolMax = 10): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: url, max: poolMax, connectionTimeoutMillis: 5_000 }),
    }),
  });
}

export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({ db, provider: migrationProvider });
}

/** Applies all pending migrations; throws with the failing migration's name. */
export async function migrateToLatest(db: Kysely<Database>): Promise<string[]> {
  const { error, results } = await createMigrator(db).migrateToLatest();
  const failed = results?.find((r) => r.status === 'Error');
  if (error || failed) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`migration ${failed?.migrationName ?? '(unknown)'} failed: ${cause}`);
  }
  return (results ?? []).map((r) => r.migrationName);
}

export async function pendingMigrations(db: Kysely<Database>): Promise<string[]> {
  const all = await createMigrator(db).getMigrations();
  return all.filter((m) => !m.executedAt).map((m) => m.name);
}
