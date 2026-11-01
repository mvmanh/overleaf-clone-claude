import { type Kysely, sql } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema type */

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'text', (c) => c.notNull())
    .addColumn('display_name', 'text', (c) => c.notNull())
    .addColumn('auth_provider', 'text', (c) => c.notNull().defaultTo('local'))
    .addColumn('auth_provider_subject', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('users_email_lowercase', sql`email = lower(email)`)
    .execute();
  await db.schema.createIndex('users_email_key').unique().on('users').column('email').execute();
  await db.schema
    .createIndex('users_provider_subject_key')
    .unique()
    .on('users')
    .columns(['auth_provider', 'auth_provider_subject'])
    .where(sql.ref('auth_provider_subject'), 'is not', null)
    .execute();

  await db.schema
    .createTable('user_password_credentials')
    .addColumn('user_id', 'uuid', (c) => c.primaryKey().references('users.id').onDelete('cascade'))
    .addColumn('password_hash', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('auth_sessions')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    // SHA-256 of the opaque cookie token; the token itself is never stored.
    .addColumn('token_hash', 'bytea', (c) => c.notNull().unique())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('last_seen_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('user_agent', 'text')
    .addColumn('ip', 'text')
    .execute();
  await db.schema
    .createIndex('auth_sessions_user_idx')
    .on('auth_sessions')
    .column('user_id')
    .execute();

  await db.schema
    .createTable('projects')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('owner_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('restrict'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('engine', 'text', (c) => c.notNull().defaultTo('pdflatex'))
    .addColumn('root_file_path', 'text')
    .addColumn('tex_image_version', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .addCheckConstraint('projects_engine_check', sql`engine in ('pdflatex', 'xelatex', 'lualatex')`)
    .addCheckConstraint('projects_name_length', sql`char_length(name) between 1 and 200`)
    .execute();
  await db.schema.createIndex('projects_owner_idx').on('projects').column('owner_id').execute();

  await db.schema
    .createTable('project_members')
    .addColumn('project_id', 'uuid', (c) =>
      c.notNull().references('projects.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('role', 'text', (c) => c.notNull())
    .addColumn('invited_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('invited_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('accepted_at', 'timestamptz')
    .addPrimaryKeyConstraint('project_members_pkey', ['project_id', 'user_id'])
    .addCheckConstraint('project_members_role_check', sql`role in ('owner', 'editor', 'viewer')`)
    .execute();
  await db.schema
    .createIndex('project_members_user_idx')
    .on('project_members')
    .column('user_id')
    .execute();
  // Exactly-one-owner is enforced by the app; the DB guarantees at most one.
  await db.schema
    .createIndex('project_members_single_owner')
    .unique()
    .on('project_members')
    .column('project_id')
    .where(sql.ref('role'), '=', 'owner')
    .execute();

  await db.schema
    .createTable('project_audit_events')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('project_id', 'uuid', (c) =>
      c.notNull().references('projects.id').onDelete('cascade'),
    )
    .addColumn('actor_id', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('action', 'text', (c) => c.notNull())
    .addColumn('metadata', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('project_audit_events_project_idx')
    .on('project_audit_events')
    .columns(['project_id', 'created_at'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const t of [
    'project_audit_events',
    'project_members',
    'projects',
    'auth_sessions',
    'user_password_credentials',
    'users',
  ]) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
