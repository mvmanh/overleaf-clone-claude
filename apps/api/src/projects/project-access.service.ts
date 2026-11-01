import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { type ProjectRole, roleSatisfies } from '@latex-cloud/shared';
import { forbidden, notFound } from '../common/api-exception';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The single place project authorization decisions are made. Every project-
 * scoped endpoint (and later: collab WS auth, compile jobs, artifacts) must call
 * `requireRole`. Non-members get 404, not 403, so project ids cannot be probed.
 */
@Injectable()
export class ProjectAccessService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async roleOf(userId: string, projectId: string): Promise<ProjectRole | null> {
    if (!UUID.test(projectId)) return null;
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

  async requireRole(
    userId: string,
    projectId: string,
    required: ProjectRole,
  ): Promise<ProjectRole> {
    const role = await this.roleOf(userId, projectId);
    if (!role) throw notFound('Project');
    if (!roleSatisfies(role, required)) throw forbidden();
    return role;
  }
}
