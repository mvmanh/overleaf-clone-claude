import type { Migration, MigrationProvider } from 'kysely';
import * as m0001 from './0001_users_projects_acl';
import * as m0002 from './0002_project_files';
import * as m0003 from './0003_compiles';
import * as m0004 from './0004_collab';

/**
 * Static registry (no filesystem globbing) so migrations work identically from
 * ts sources, compiled dist and container images. Append-only: never edit or
 * reorder a migration that has shipped.
 */
export const MIGRATIONS: Record<string, Migration> = {
  '0001_users_projects_acl': m0001,
  '0002_project_files': m0002,
  '0003_compiles': m0003,
  '0004_collab': m0004,
};

export const migrationProvider: MigrationProvider = {
  getMigrations: () => Promise.resolve(MIGRATIONS),
};
