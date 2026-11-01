import type { Migration, MigrationProvider } from 'kysely';
import * as m0001 from './0001_users_projects_acl';

/**
 * Static registry (no filesystem globbing) so migrations work identically from
 * ts sources, compiled dist and container images. Append-only: never edit or
 * reorder a migration that has shipped.
 */
export const MIGRATIONS: Record<string, Migration> = {
  '0001_users_projects_acl': m0001,
};

export const migrationProvider: MigrationProvider = {
  getMigrations: () => Promise.resolve(MIGRATIONS),
};
