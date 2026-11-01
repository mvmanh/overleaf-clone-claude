import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { ProjectSummary } from '@latex-cloud/shared';
import { notFound } from '../common/api-exception';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';

@Injectable()
export class ProjectsService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  private baseQuery(userId: string) {
    return this.db
      .selectFrom('projects as p')
      .innerJoin('project_members as m', (j) =>
        j.onRef('m.project_id', '=', 'p.id').on('m.user_id', '=', userId),
      )
      .innerJoin('users as o', 'o.id', 'p.owner_id')
      .select((eb) => [
        'p.id',
        'p.name',
        'p.engine',
        'p.created_at',
        'p.updated_at',
        'm.role',
        'o.id as owner_id',
        'o.display_name as owner_name',
        eb
          .selectFrom('project_members as mc')
          .select((e) => e.fn.countAll<string>().as('n'))
          .whereRef('mc.project_id', '=', 'p.id')
          .as('member_count'),
      ])
      .where('p.deleted_at', 'is', null);
  }

  private toSummary(
    r: Awaited<ReturnType<ReturnType<ProjectsService['baseQuery']>['executeTakeFirstOrThrow']>>,
  ): ProjectSummary {
    return {
      id: r.id,
      name: r.name,
      engine: r.engine,
      role: r.role,
      owner: { id: r.owner_id, displayName: r.owner_name },
      memberCount: Number(r.member_count ?? 1),
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  /** Only projects the user is a member of — tenant separation lives in the join. */
  async listForUser(userId: string): Promise<ProjectSummary[]> {
    const rows = await this.baseQuery(userId)
      .orderBy('p.updated_at', 'desc')
      .orderBy('p.id')
      .execute();
    return rows.map((r) => this.toSummary(r));
  }

  async getForUser(userId: string, projectId: string): Promise<ProjectSummary> {
    const row = await this.baseQuery(userId).where('p.id', '=', projectId).executeTakeFirst();
    if (!row) throw notFound('Project');
    return this.toSummary(row);
  }
}
