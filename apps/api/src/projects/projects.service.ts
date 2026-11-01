import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import {
  type ImportProjectResponse,
  isTexRoot,
  MAX_FILES_PER_PROJECT,
  MAX_PROJECT_BYTES,
  MAX_TEXT_FILE_BYTES,
  MAX_UPLOAD_BYTES,
} from '@latex-cloud/shared';
import type {
  AssignableRole,
  CreateProjectRequest,
  InviteMemberRequest,
  ProjectMember,
  ProjectSummary,
  UpdateProjectRequest,
} from '@latex-cloud/shared';
import { ApiException, notFound } from '../common/api-exception';
import { CollabEvents } from '../collab/collab-events';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { randomUUID } from 'node:crypto';
import { BLOB_STORAGE, type BlobStorage } from '../storage/blob-storage';
import { recordProjectFiles } from '../history/recorder';
import { recordAudit } from './audit';
import { classifyFile, contentTypeFor } from './file-types';
import { fileBlobKey } from './files.service';
import { detectEngine, detectRootFile, readProjectZip, ZipRejectedError } from './zip-import';
import { sha256Hex } from './hash';
import { templateFiles } from './templates';
import { isUuid, ProjectAccessService } from './project-access.service';

const conflict = (message: string) => new ApiException('CONFLICT', message, HttpStatus.CONFLICT);

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly access: ProjectAccessService,
    @Inject(BLOB_STORAGE) private readonly blobs: BlobStorage,
    private readonly events: CollabEvents,
  ) {}

  /**
   * Creates a project from an uploaded ZIP (e.g. an Overleaf export). The
   * archive is untrusted: structural attacks reject it, unsupported entries
   * are skipped and reported back.
   */
  async importZip(
    userId: string,
    zip: Buffer,
    archiveName: string,
    requestedName?: string,
  ): Promise<ImportProjectResponse> {
    let read;
    try {
      read = await readProjectZip(zip, {
        maxEntries: MAX_FILES_PER_PROJECT,
        maxFileBytes: MAX_UPLOAD_BYTES,
        maxTotalBytes: MAX_PROJECT_BYTES,
        maxRatio: 200,
      });
    } catch (err) {
      if (err instanceof ZipRejectedError) {
        throw new ApiException('VALIDATION_FAILED', err.message, HttpStatus.BAD_REQUEST);
      }
      throw err;
    }

    const skipped = [...read.skipped];
    const files: { path: string; kind: 'text' | 'binary'; text: string | null; bytes: Buffer }[] =
      [];
    for (const f of read.files) {
      const c = classifyFile(f.path, f.content);
      if (!c.ok) skipped.push({ path: f.path, reason: c.reason });
      else if (c.kind === 'text' && f.content.byteLength > MAX_TEXT_FILE_BYTES)
        skipped.push({ path: f.path, reason: 'text file is larger than 2 MB' });
      else
        files.push({
          path: f.path,
          kind: c.kind,
          text: c.kind === 'text' ? c.text : null,
          bytes: f.content,
        });
    }
    if (files.length === 0) {
      throw new ApiException(
        'VALIDATION_FAILED',
        'The archive contains no supported files.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const rootFile = detectRootFile(
      files
        .filter((f) => f.kind === 'text')
        .map((f) => ({ path: f.path, content: Buffer.from(f.text!) })),
    );
    const engine = detectEngine(rootFile ? files.find((f) => f.path === rootFile)!.text : null);
    const fallbackName = archiveName
      .replace(/\.zip$/i, '')
      .split('')
      .filter((c) => c.charCodeAt(0) >= 0x20)
      .join('')
      .trim();
    const name = (requestedName?.trim() || fallbackName || 'Imported project').slice(0, 200);

    // Blobs first (content-addressed, idempotent), then all rows atomically.
    const projectId = randomUUID();
    for (const f of files) {
      if (f.kind !== 'binary') continue;
      const key = fileBlobKey(projectId, sha256Hex(f.bytes));
      if (!(await this.blobs.exists(key)))
        await this.blobs.put(key, f.bytes, contentTypeFor(f.path));
    }
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('projects')
        .values({ id: projectId, owner_id: userId, name, engine, root_file_path: rootFile })
        .execute();
      await trx
        .insertInto('project_members')
        .values({ project_id: projectId, user_id: userId, role: 'owner', accepted_at: new Date() })
        .execute();
      for (let i = 0; i < files.length; i += 200) {
        await trx
          .insertInto('project_files')
          .values(
            files.slice(i, i + 200).map((f) => ({
              project_id: projectId,
              path: f.path,
              kind: f.kind,
              content_text: f.text,
              blob_key: f.kind === 'binary' ? fileBlobKey(projectId, sha256Hex(f.bytes)) : null,
              size_bytes: f.bytes.byteLength,
              sha256: f.kind === 'text' ? sha256Hex(f.text!) : sha256Hex(f.bytes),
              created_by: userId,
              updated_by: userId,
            })),
          )
          .execute();
      }
      await recordProjectFiles(trx, projectId, 'import', userId);
      await recordAudit(trx, {
        projectId,
        actorId: userId,
        action: 'project.imported',
        metadata: { files: files.length, skipped: skipped.length, rootFile, engine },
      });
    });
    return {
      project: await this.getForUser(userId, projectId),
      importedFiles: files.length,
      skipped,
      detected: { rootFile, engine },
    };
  }

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
      await recordProjectFiles(trx, project.id, 'create', userId);
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
    await this.events.publish({ type: 'project-changed', projectId });
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
    await this.events.publish({ type: 'project-deleted', projectId });
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
    await this.events.publish({ type: 'members-changed', projectId });
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
    await this.events.publish({ type: 'members-changed', projectId });
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
    await this.events.publish({ type: 'members-changed', projectId });
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
