import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { can, type ProjectAction, type ProjectRole } from '@latex-cloud/shared';
import { forbidden, notFound } from '../common/api-exception';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * The single place project authorization decisions are made. Every project-
 * scoped endpoint (and later: collab WS auth, compile jobs, artifacts) must go
 * through here. Non-members get 404, not 403, so project ids cannot be probed.
 */
@Injectable()
export class ProjectAccessService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async roleOf(userId: string, projectId: string): Promise<ProjectRole | null> {
    if (!isUuid(projectId)) return null;
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

  /** Read-path check. Mutations must use `lockForAction` inside their transaction. */
  async requireAction(
    userId: string,
    projectId: string,
    action: ProjectAction,
  ): Promise<ProjectRole> {
    const role = await this.roleOf(userId, projectId);
    if (!role) throw notFound('Project');
    if (!can(role, action)) throw forbidden();
    return role;
  }

  /**
   * Locks the project row (`FOR UPDATE`) and re-checks the actor's role inside
   * the transaction. Serialises all membership/ownership mutations per project,
   * so concurrent requests cannot act on a stale role (no TOCTOU).
   */
  async lockForAction(
    trx: Transaction<Database>,
    userId: string,
    projectId: string,
    action: ProjectAction,
    /**
     * `update` serialises membership/ownership/settings changes. File writes use
     * `share`: they may run concurrently with each other but still wait for (and
     * observe) any in-flight membership change.
     */
    mode: 'update' | 'share' = 'update',
  ): Promise<ProjectRole> {
    if (!isUuid(projectId)) throw notFound('Project');
    const base = trx
      .selectFrom('projects')
      .select('id')
      .where('id', '=', projectId)
      .where('deleted_at', 'is', null);
    const project = await (
      mode === 'update' ? base.forUpdate() : base.forShare()
    ).executeTakeFirst();
    if (!project) throw notFound('Project');
    const member = await trx
      .selectFrom('project_members')
      .select('role')
      .where('project_id', '=', projectId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!member) throw notFound('Project');
    if (!can(member.role, action)) throw forbidden();
    return member.role;
  }
}
