import { type Kysely, sql } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema type */

/**
 * Project files. Text content lives in Postgres for the single-author editor
 * (PR 3); in Phase 2 the Yjs document becomes the authority and this column
 * becomes a materialised snapshot. Binary blobs (PR 4) will use `blob_key`.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('project_files')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (c) =>
      c.notNull().references('projects.id').onDelete('cascade'),
    )
    .addColumn('path', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('content_text', 'text')
    .addColumn('blob_key', 'text')
    .addColumn('size_bytes', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('sha256', 'text', (c) => c.notNull())
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('updated_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .addCheckConstraint('project_files_kind_check', sql`kind in ('text', 'binary')`)
    .addCheckConstraint(
      'project_files_text_content',
      sql`(kind = 'text' and content_text is not null) or (kind = 'binary' and content_text is null)`,
    )
    .execute();
  // Case-insensitive uniqueness among live files: `Main.tex` and `main.tex`
  // would collide on case-insensitive filesystems (and confuse authors).
  await sql`create unique index project_files_live_path_key on project_files (project_id, lower(path)) where deleted_at is null`.execute(
    db,
  );
  await db.schema
    .createIndex('project_files_project_idx')
    .on('project_files')
    .column('project_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('project_files').ifExists().execute();
}
