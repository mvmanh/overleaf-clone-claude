import { type Kysely, sql } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema type */

/**
 * Durable collaboration state (ADR-0014). The Yjs binary is authoritative for
 * any file that has been opened collaboratively; `project_files.content_text`
 * becomes its materialised text.
 *
 * - `collab_documents`: latest compacted snapshot (`Y.encodeStateAsUpdate`).
 * - `collab_updates`: append-only log of updates not yet folded into the
 *   snapshot. A row is committed before the client's edit is acknowledged.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('collab_documents')
    .addColumn('file_id', 'uuid', (c) =>
      c.primaryKey().references('project_files.id').onDelete('cascade'),
    )
    .addColumn('state', 'bytea', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('collab_updates')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('file_id', 'uuid', (c) =>
      c.notNull().references('project_files.id').onDelete('cascade'),
    )
    .addColumn('data', 'bytea', (c) => c.notNull())
    .addColumn('source', 'text', (c) => c.notNull())
    .addColumn('user_id', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('collab_updates_source_check', sql`source in ('client', 'api')`)
    .execute();
  await db.schema
    .createIndex('collab_updates_file_idx')
    .on('collab_updates')
    .columns(['file_id', 'id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('collab_updates').ifExists().execute();
  await db.schema.dropTable('collab_documents').ifExists().execute();
}
