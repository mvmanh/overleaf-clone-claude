import { type Kysely, sql } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema type */

/**
 * Version history (ADR-0015). Immutable per-file checkpoints plus named
 * project labels. Text content is stored once per project and hash
 * (`history_blobs`); binary versions point at the content-addressed object
 * key, which is never overwritten.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('history_blobs')
    .addColumn('project_id', 'uuid', (c) =>
      c.notNull().references('projects.id').onDelete('cascade'),
    )
    .addColumn('sha256', 'text', (c) => c.notNull())
    .addColumn('content', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('history_blobs_pkey', ['project_id', 'sha256'])
    .execute();

  await db.schema
    .createTable('file_versions')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (c) =>
      c.notNull().references('projects.id').onDelete('cascade'),
    )
    .addColumn('file_id', 'uuid', (c) =>
      c.notNull().references('project_files.id').onDelete('cascade'),
    )
    .addColumn('path', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('sha256', 'text', (c) => c.notNull())
    .addColumn('size_bytes', 'integer', (c) => c.notNull())
    .addColumn('blob_key', 'text')
    .addColumn('source', 'text', (c) => c.notNull())
    .addColumn('authors', sql`uuid[]`, (c) => c.notNull().defaultTo(sql`'{}'::uuid[]`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('file_versions_kind_check', sql`kind in ('text', 'binary')`)
    .addCheckConstraint(
      'file_versions_source_check',
      sql`source in ('create', 'edit', 'upload', 'rename', 'restore', 'delete', 'import')`,
    )
    .execute();
  await sql`create index file_versions_project_time_idx on file_versions (project_id, created_at desc, id)`.execute(
    db,
  );
  await sql`create index file_versions_file_time_idx on file_versions (file_id, created_at desc)`.execute(
    db,
  );

  await db.schema
    .createTable('project_labels')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (c) =>
      c.notNull().references('projects.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('project_labels_project_idx')
    .on('project_labels')
    .columns(['project_id', 'created_at'])
    .execute();

  // Editors whose edits are not yet in a checkpoint (collab server).
  await db.schema
    .alterTable('collab_documents')
    .addColumn('history_authors', sql`uuid[]`, (c) => c.notNull().defaultTo(sql`'{}'::uuid[]`))
    .execute();

  // Backfill: one initial checkpoint per live file (exact current text,
  // including collaborative edits not yet compacted, is captured by the
  // next checkpoint).
  await sql`
    insert into history_blobs (project_id, sha256, content)
    select project_id, sha256, content_text from project_files
    where kind = 'text' and deleted_at is null
    on conflict do nothing`.execute(db);
  await sql`
    insert into file_versions (project_id, file_id, path, kind, sha256, size_bytes, blob_key, source, authors, created_at)
    select project_id, id, path, kind, sha256, size_bytes, blob_key, 'create',
           case when created_by is null then '{}'::uuid[] else array[created_by] end, updated_at
    from project_files where deleted_at is null`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('collab_documents').dropColumn('history_authors').execute();
  await db.schema.dropTable('project_labels').ifExists().execute();
  await db.schema.dropTable('file_versions').ifExists().execute();
  await db.schema.dropTable('history_blobs').ifExists().execute();
}
