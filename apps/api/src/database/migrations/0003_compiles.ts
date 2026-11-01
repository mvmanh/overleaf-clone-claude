import { type Kysely, sql } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema type */

/**
 * Immutable revisions and compile jobs (ADR-0005). A job builds exactly one
 * revision; artifacts are attributed to the job (and so to the revision).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('project_revisions')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (c) =>
      c.notNull().references('projects.id').onDelete('cascade'),
    )
    .addColumn('fingerprint', 'text', (c) => c.notNull())
    .addColumn('manifest', 'jsonb', (c) => c.notNull())
    .addColumn('source_key', 'text', (c) => c.notNull())
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('project_revisions_fingerprint_key', ['project_id', 'fingerprint'])
    .execute();

  await db.schema
    .createTable('compile_jobs')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (c) =>
      c.notNull().references('projects.id').onDelete('cascade'),
    )
    .addColumn('revision_id', 'uuid', (c) =>
      c.notNull().references('project_revisions.id').onDelete('cascade'),
    )
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('outcome', 'text')
    .addColumn('message', 'text')
    .addColumn('engine', 'text', (c) => c.notNull())
    .addColumn('root_file', 'text', (c) => c.notNull())
    .addColumn('requested_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('worker', 'text')
    .addColumn('tex_image', 'text')
    .addColumn('queued_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('started_at', 'timestamptz')
    .addColumn('finished_at', 'timestamptz')
    .addColumn('setup_ms', 'integer')
    .addColumn('compile_ms', 'integer')
    .addColumn('total_ms', 'integer')
    .addColumn('diagnostics', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addCheckConstraint(
      'compile_jobs_status_check',
      sql`status in ('queued','preparing','running','publishing','succeeded','failed','cancelled','superseded')`,
    )
    .execute();
  await db.schema
    .createIndex('compile_jobs_project_queued_idx')
    .on('compile_jobs')
    .columns(['project_id', 'queued_at'])
    .execute();
  await db.schema
    .createIndex('compile_jobs_status_idx')
    .on('compile_jobs')
    .column('status')
    .execute();

  await db.schema
    .createTable('compile_artifacts')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('compile_job_id', 'uuid', (c) =>
      c.notNull().references('compile_jobs.id').onDelete('cascade'),
    )
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('file_name', 'text', (c) => c.notNull())
    .addColumn('blob_key', 'text', (c) => c.notNull())
    .addColumn('size_bytes', 'integer', (c) => c.notNull())
    .addColumn('sha256', 'text', (c) => c.notNull())
    .addCheckConstraint('compile_artifacts_kind_check', sql`kind in ('pdf','log','synctex')`)
    .addUniqueConstraint('compile_artifacts_job_kind_key', ['compile_job_id', 'kind'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const t of ['compile_artifacts', 'compile_jobs', 'project_revisions']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
