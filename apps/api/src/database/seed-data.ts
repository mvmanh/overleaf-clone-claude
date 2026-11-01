import type { Kysely } from 'kysely';
import type { ProjectRole, ProjectTemplate, TexEngineName } from '@latex-cloud/shared';
import { PasswordHasher } from '../auth/password-hasher';
import { sha256Hex } from '../projects/hash';
import { templateFiles } from '../projects/templates';
import type { Database } from './schema';

export const SEED_USERS = [
  { email: 'alice@example.com', displayName: 'Alice Nguyen' },
  { email: 'bob@example.com', displayName: 'Bob Tran' },
  { email: 'carol@example.com', displayName: 'Carol Le' },
] as const;

type SeedEmail = (typeof SEED_USERS)[number]['email'];

export const SEED_PROJECTS: {
  id: string;
  name: string;
  engine: TexEngineName;
  owner: SeedEmail;
  template: ProjectTemplate;
  members: { email: SeedEmail; role: Exclude<ProjectRole, 'owner'> }[];
}[] = [
  {
    id: '6f1d7c4e-0001-4a51-9b1e-5e3c1d000001',
    name: 'Analytic Number Theory — Lecture Notes',
    engine: 'pdflatex',
    owner: 'alice@example.com',
    template: 'math',
    members: [{ email: 'bob@example.com', role: 'editor' }],
  },
  {
    id: '6f1d7c4e-0002-4a51-9b1e-5e3c1d000002',
    name: 'Graph Algorithms Paper (ICALP draft)',
    engine: 'pdflatex',
    owner: 'bob@example.com',
    template: 'cs',
    members: [{ email: 'alice@example.com', role: 'viewer' }],
  },
  {
    id: '6f1d7c4e-0003-4a51-9b1e-5e3c1d000003',
    name: 'Luận văn Thạc sĩ — Học máy',
    engine: 'xelatex',
    owner: 'carol@example.com',
    template: 'article',
    members: [],
  },
];

/** Idempotent development/test seed. Never run against production data. */
export async function seedDatabase(db: Kysely<Database>, password: string): Promise<void> {
  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hash(password);

  await db.transaction().execute(async (trx) => {
    const ids = new Map<string, string>();
    for (const u of SEED_USERS) {
      const row = await trx
        .insertInto('users')
        .values({ email: u.email, display_name: u.displayName })
        .onConflict((oc) => oc.column('email').doUpdateSet({ display_name: u.displayName }))
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.set(u.email, row.id);
      await trx
        .insertInto('user_password_credentials')
        .values({ user_id: row.id, password_hash: passwordHash })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({ password_hash: passwordHash }))
        .execute();
    }

    for (const p of SEED_PROJECTS) {
      const ownerId = ids.get(p.owner)!;
      await trx
        .insertInto('projects')
        .values({
          id: p.id,
          name: p.name,
          engine: p.engine,
          owner_id: ownerId,
          root_file_path: 'main.tex',
        })
        .onConflict((oc) => oc.column('id').doUpdateSet({ name: p.name, engine: p.engine }))
        .execute();
      // Starter files only if the project has none (never clobber edits on re-seed).
      const existing = await trx
        .selectFrom('project_files')
        .select('id')
        .where('project_id', '=', p.id)
        .executeTakeFirst();
      if (!existing) {
        await trx
          .insertInto('project_files')
          .values(
            templateFiles(p.template, p.name, p.engine).map((f) => ({
              project_id: p.id,
              path: f.path,
              kind: 'text' as const,
              content_text: f.content,
              size_bytes: Buffer.byteLength(f.content, 'utf8'),
              sha256: sha256Hex(f.content),
              created_by: ownerId,
              updated_by: ownerId,
            })),
          )
          .execute();
      }
      const members = [{ email: p.owner, role: 'owner' as ProjectRole }, ...p.members];
      for (const m of members) {
        await trx
          .insertInto('project_members')
          .values({
            project_id: p.id,
            user_id: ids.get(m.email)!,
            role: m.role,
            accepted_at: new Date(),
          })
          .onConflict((oc) => oc.columns(['project_id', 'user_id']).doUpdateSet({ role: m.role }))
          .execute();
      }
    }
  });
}
