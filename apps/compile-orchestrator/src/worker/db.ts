import { type ColumnType, type Generated, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type {
  CompileArtifactKind,
  CompileJobStatus,
  CompileOutcome,
  TexEngineName,
} from '@latex-cloud/shared';

/*
 * The worker's view of the schema: only the compile tables it reads/writes.
 * Migrations are owned by the API (apps/api/src/database/migrations).
 */
export interface WorkerDatabase {
  project_revisions: {
    id: string;
    project_id: string;
    fingerprint: string;
    manifest: ColumnType<unknown, never, never>;
    source_key: string;
  };
  compile_jobs: {
    id: string;
    project_id: string;
    revision_id: string;
    status: CompileJobStatus;
    outcome: CompileOutcome | null;
    message: string | null;
    engine: TexEngineName;
    root_file: string;
    worker: string | null;
    tex_image: string | null;
    started_at: ColumnType<Date | null, never, Date | string | null>;
    finished_at: ColumnType<Date | null, never, Date | string | null>;
    setup_ms: number | null;
    compile_ms: number | null;
    total_ms: number | null;
    diagnostics: ColumnType<unknown, never, string>;
  };
  compile_artifacts: {
    id: Generated<string>;
    compile_job_id: string;
    kind: CompileArtifactKind;
    file_name: string;
    blob_key: string;
    size_bytes: number;
    sha256: string;
  };
}

export function createWorkerDb(url: string): Kysely<WorkerDatabase> {
  return new Kysely<WorkerDatabase>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 5 }) }),
  });
}
