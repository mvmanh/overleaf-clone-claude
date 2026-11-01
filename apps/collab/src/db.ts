import { type ColumnType, type Generated, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { ProjectRole } from '@latex-cloud/shared';

/**
 * The slice of the API's schema the collab server touches. The API owns the
 * migrations (apps/api/src/database/migrations); this is a read model plus
 * the two collab tables.
 */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface CollabDatabase {
  users: { id: string; display_name: string };
  projects: { id: string; deleted_at: Date | null };
  project_members: { project_id: string; user_id: string; role: ProjectRole };
  project_files: {
    id: string;
    project_id: string;
    path: string;
    kind: 'text' | 'binary';
    content_text: string | null;
    size_bytes: number;
    sha256: string;
    updated_by: string | null;
    updated_at: Timestamp;
    deleted_at: Date | null;
  };
  collab_documents: {
    file_id: string;
    state: Buffer;
    created_at: Timestamp;
    updated_at: Timestamp;
  };
  collab_updates: {
    id: Generated<string>;
    file_id: string;
    data: Buffer;
    source: 'client' | 'api';
    user_id: string | null;
    created_at: Timestamp;
  };
}

export function createCollabDb(url: string, poolMax = 10): Kysely<CollabDatabase> {
  return new Kysely<CollabDatabase>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: poolMax }) }),
  });
}
