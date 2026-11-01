import type { Kysely } from 'kysely';
import type { ProjectRole } from '@latex-cloud/shared';
import type { CollabDatabase } from './db';

/** Authorization reads. The API's ProjectAccessService is the source of these rules. */
export class CollabAccess {
  constructor(private readonly db: Kysely<CollabDatabase>) {}

  async roleOf(userId: string, projectId: string): Promise<ProjectRole | null> {
    const row = await this.db
      .selectFrom('project_members as m')
      .innerJoin('projects as p', 'p.id', 'm.project_id')
      .select('m.role')
      .where('m.project_id', '=', projectId)
      .where('m.user_id', '=', userId)
      .where('p.deleted_at', 'is', null)
      .executeTakeFirst();
    return row?.role ?? null;
  }

  /** Every member's role in one query (re-validation after a membership change). */
  async roles(projectId: string): Promise<Map<string, ProjectRole>> {
    const rows = await this.db
      .selectFrom('project_members as m')
      .innerJoin('projects as p', 'p.id', 'm.project_id')
      .select(['m.user_id', 'm.role'])
      .where('m.project_id', '=', projectId)
      .where('p.deleted_at', 'is', null)
      .execute();
    return new Map(rows.map((r) => [r.user_id, r.role]));
  }

  async isLiveTextFile(projectId: string, fileId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('project_files')
      .select('id')
      .where('id', '=', fileId)
      .where('project_id', '=', projectId)
      .where('kind', '=', 'text')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Boolean(row);
  }

  async displayName(userId: string): Promise<string> {
    const row = await this.db
      .selectFrom('users')
      .select('display_name')
      .where('id', '=', userId)
      .executeTakeFirst();
    return row?.display_name ?? 'Unknown';
  }
}
