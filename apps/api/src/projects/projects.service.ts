import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { isTexRoot } from '@latex-cloud/shared';
import type {
  AssignableRole,
  CreateProjectRequest,
  InviteMemberRequest,
  ProjectMember,
  ProjectSummary,
  UpdateProjectRequest,
} from '@latex-cloud/shared';
import { ApiException, notFound } from '../common/api-exception';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { recordAudit } from './audit';
import { sha256Hex } from './hash';
import { templateFiles } from './templates';
import { isUuid, ProjectAccessService } from './project-access.service';

const conflict = (message: string) => new ApiException('CONFLICT', message, HttpStatus.CONFLICT);

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly access: ProjectAccessService,
  ) {}

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
        'p.root_file_path',
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
      rootFile: r.root_file_path,
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
    if (!isUuid(projectId)) throw notFound('Project');
    const row = await this.baseQuery(userId).where('p.id', '=', projectId).executeTakeFirst();
    if (!row) throw notFound('Project');
    return this.toSummary(row);
  }

  async create(userId: string, req: CreateProjectRequest): Promise<ProjectSummary> {
    const id = await this.db.transaction().execute(async (trx) => {
      const project = await trx
        .insertInto('projects')
        .values({
          owner_id: userId,
          name: req.name,
          engine: req.engine,
          root_file_path: 'main.tex',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('project_members')
        .values({ project_id: project.id, user_id: userId, role: 'owner', accepted_at: new Date() })
        .execute();
      const files = templateFiles(req.template, req.name, req.engine);
      await trx
        .insertInto('project_files')
        .values(
          files.map((f) => ({
            project_id: project.id,
            path: f.path,
            kind: 'text' as const,
            content_text: f.content,
            size_bytes: Buffer.byteLength(f.content, 'utf8'),
            sha256: sha256Hex(f.content),
            created_by: userId,
            updated_by: userId,
          })),
        )
        .execute();
      await recordAudit(trx, {
        projectId: project.id,
        actorId: userId,
        action: 'project.created',
        metadata: { name: req.name, engine: req.engine, template: req.template },
      });
      return project.id;
    });
    return this.getForUser(userId, id);
  }

  async update(
    userId: string,
    projectId: string,
    req: UpdateProjectRequest,
  ): Promise<ProjectSummary> {
    await this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'project:update');
      const before = await trx
        .selectFrom('projects')
        .select(['name', 'engine', 'root_file_path'])
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();
      if (req.rootFile !== undefined) {
        const root = await trx
          .selectFrom('project_files')
          .select('path')
          .where('project_id', '=', projectId)
          .where('path', '=', req.rootFile)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (!root || !isTexRoot(root.path)) {
          throw new ApiException(
            'VALIDATION_FAILED',
            'The main file must be an existing .tex file in this project.',
            HttpStatus.BAD_REQUEST,
          );
        }
      }
      await trx
        .updateTable('projects')
        .set({
          ...(req.name !== undefined ? { name: req.name } : {}),
          ...(req.engine !== undefined ? { engine: req.engine } : {}),
          ...(req.rootFile !== undefined ? { root_file_path: req.rootFile } : {}),
          updated_at: sql`now()`,
        })
        .where('id', '=', projectId)
        .execute();
      const changes: Record<string, { from: string; to: string }> = {};
      if (req.name !== undefined && req.name !== before.name)
        changes.name = { from: before.name, to: req.name };
      if (req.engine !== undefined && req.engine !== before.engine) {
        changes.engine = { from: before.engine, to: req.engine };
      }
      if (req.rootFile !== undefined && req.rootFile !== before.root_file_path) {
        changes.rootFile = { from: before.root_file_path ?? '', to: req.rootFile };
      }
      await recordAudit(trx, {
        projectId,
        actorId: userId,
        action: 'project.updated',
        metadata: changes,
      });
    });
    return this.getForUser(userId, projectId);
  }

  /** Soft delete: the project disappears for every member immediately. */
  async softDelete(userId: string, projectId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'project:delete');
      await trx
        .updateTable('projects')
        .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
        .where('id', '=', projectId)
        .execute();
      await recordAudit(trx, { projectId, actorId: userId, action: 'project.deleted' });
    });
  }

  async listMembers(userId: string, projectId: string): Promise<ProjectMember[]> {
    await this.access.requireAction(userId, projectId, 'members:read');
    const rows = await this.db
      .selectFrom('project_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.email', 'u.display_name', 'm.role', 'm.invited_at'])
      .where('m.project_id', '=', projectId)
      .orderBy(sql`case m.role when 'owner' then 0 when 'editor' then 1 else 2 end`)
      .orderBy('u.display_name')
      .execute();
    return rows.map((r) => ({
      userId: r.id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      invitedAt: new Date(r.invited_at).toISOString(),
    }));
  }

  async invite(
    userId: string,
    projectId: string,
    req: InviteMemberRequest,
  ): Promise<ProjectMember[]> {
    await this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'members:manage');
      // Owners can learn whether an email has an account; acceptable for a
      // private deployment. Pending invitations for unknown emails come later.
      const invitee = await trx
        .selectFrom('users')
        .select('id')
        .where('email', '=', req.email)
        .executeTakeFirst();
      if (!invitee) {
        throw new ApiException(
          'NOT_FOUND',
          'No account exists with that email.',
          HttpStatus.NOT_FOUND,
        );
      }
      const inserted = await trx
        .insertInto('project_members')
        .values({
          project_id: projectId,
          user_id: invitee.id,
          role: req.role,
          invited_by: userId,
          accepted_at: new Date(),
        })
        .onConflict((oc) => oc.columns(['project_id', 'user_id']).doNothing())
        .returning('user_id')
        .executeTakeFirst();
      if (!inserted) throw conflict('That person is already a member of this project.');
      await recordAudit(trx, {
        projectId,
        actorId: userId,
        action: 'member.added',
        metadata: { userId: invitee.id, role: req.role },
      });
    });
    return this.listMembers(userId, projectId);
  }

  async changeRole(
    userId: string,
    projectId: string,
    targetId: string,
    role: AssignableRole,
  ): Promise<ProjectMember[]> {
    await this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'members:manage');
      const target = await this.memberOrThrow(trx, projectId, targetId);
      if (target.role === 'owner') throw conflict('Transfer ownership to change the owner’s role.');
      if (target.role === role) return;
      await trx
        .updateTable('project_members')
        .set({ role })
        .where('project_id', '=', projectId)
        .where('user_id', '=', targetId)
        .execute();
      await recordAudit(trx, {
        projectId,
        actorId: userId,
        action: 'member.role_changed',
        metadata: { userId: targetId, from: target.role, to: role },
      });
    });
    return this.listMembers(userId, projectId);
  }

  /** Owners remove others; any non-owner member may remove themselves (leave). */
  async removeMember(userId: string, projectId: string, targetId: string): Promise<void> {
    const leaving = userId === targetId;
    await this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(
        trx,
        userId,
        projectId,
        leaving ? 'project:read' : 'members:manage',
      );
      const target = await this.memberOrThrow(trx, projectId, targetId);
      if (target.role === 'owner') {
        throw conflict(
          leaving
            ? 'Owners cannot leave a project. Transfer ownership or delete the project.'
            : 'The owner cannot be removed.',
        );
      }
      await trx
        .deleteFrom('project_members')
        .where('project_id', '=', projectId)
        .where('user_id', '=', targetId)
        .execute();
      await recordAudit(trx, {
        projectId,
        actorId: userId,
        action: leaving ? 'member.left' : 'member.removed',
        metadata: { userId: targetId, role: target.role },
      });
    });
  }

  /** Old owner becomes editor; target (an existing member) becomes owner. */
  async transferOwnership(
    userId: string,
    projectId: string,
    targetId: string,
  ): Promise<ProjectSummary> {
    await this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'project:transfer');
      if (targetId === userId) throw conflict('You already own this project.');
      const target = await this.memberOrThrow(trx, projectId, targetId);
      // Demote first: the partial unique index allows at most one owner row.
      await trx
        .updateTable('project_members')
        .set({ role: 'editor' })
        .where('project_id', '=', projectId)
        .where('user_id', '=', userId)
        .execute();
      await trx
        .updateTable('project_members')
        .set({ role: 'owner' })
        .where('project_id', '=', projectId)
        .where('user_id', '=', targetId)
        .execute();
      await trx
        .updateTable('projects')
        .set({ owner_id: targetId, updated_at: sql`now()` })
        .where('id', '=', projectId)
        .execute();
      await recordAudit(trx, {
        projectId,
        actorId: userId,
        action: 'project.ownership_transferred',
        metadata: { from: userId, to: targetId, previousRoleOfNewOwner: target.role },
      });
    });
    return this.getForUser(userId, projectId);
  }

  private async memberOrThrow(
    trx: Kysely<Database>,
    projectId: string,
    targetId: string,
  ): Promise<{ role: ProjectMember['role'] }> {
    if (!isUuid(targetId)) throw notFound('Member');
    const row = await trx
      .selectFrom('project_members')
      .select('role')
      .where('project_id', '=', projectId)
      .where('user_id', '=', targetId)
      .executeTakeFirst();
    if (!row) throw notFound('Member');
    return row;
  }
}
