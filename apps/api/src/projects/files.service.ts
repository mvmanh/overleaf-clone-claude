import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql, type Transaction } from 'kysely';
import {
  type CreateFileRequest,
  isTexRoot,
  isTextPath,
  MAX_FILES_PER_PROJECT,
  type ProjectFile,
  type ProjectFileListResponse,
  type ProjectFileWithContent,
} from '@latex-cloud/shared';
import { ApiException, notFound } from '../common/api-exception';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { recordAudit } from './audit';
import { sha256Hex } from './hash';
import { isUuid, ProjectAccessService } from './project-access.service';

const conflict = (message: string) => new ApiException('CONFLICT', message, HttpStatus.CONFLICT);

const FILE_COLUMNS = ['id', 'path', 'kind', 'size_bytes', 'sha256', 'updated_at'] as const;

type FileRow = {
  id: string;
  path: string;
  kind: 'text' | 'binary';
  size_bytes: number;
  sha256: string;
  updated_at: Date | string;
};

function toFile(r: FileRow): ProjectFile {
  return {
    id: r.id,
    path: r.path,
    kind: r.kind,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** Text files of a project. All access goes through ProjectAccessService. */
@Injectable()
export class FilesService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly access: ProjectAccessService,
  ) {}

  async list(userId: string, projectId: string): Promise<ProjectFileListResponse> {
    await this.access.requireAction(userId, projectId, 'files:read');
    const [files, project] = await Promise.all([
      this.db
        .selectFrom('project_files')
        .select(FILE_COLUMNS)
        .where('project_id', '=', projectId)
        .where('deleted_at', 'is', null)
        .orderBy('path')
        .execute(),
      this.db
        .selectFrom('projects')
        .select('root_file_path')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow(),
    ]);
    return { files: files.map(toFile), rootFile: project.root_file_path };
  }

  async get(userId: string, projectId: string, fileId: string): Promise<ProjectFileWithContent> {
    await this.access.requireAction(userId, projectId, 'files:read');
    const row = await this.liveFile(this.db, projectId, fileId);
    if (row.kind !== 'text')
      throw new ApiException(
        'BAD_REQUEST',
        'Binary files have no text content.',
        HttpStatus.BAD_REQUEST,
      );
    return { ...toFile(row), content: row.content_text ?? '' };
  }

  async create(userId: string, projectId: string, req: CreateFileRequest): Promise<ProjectFile> {
    return this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'files:write', 'share');
      const { count } = await trx
        .selectFrom('project_files')
        .select((e) => e.fn.countAll<string>().as('count'))
        .where('project_id', '=', projectId)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      if (Number(count) >= MAX_FILES_PER_PROJECT) {
        throw conflict(`A project can contain at most ${MAX_FILES_PER_PROJECT} files.`);
      }
      try {
        const row = await trx
          .insertInto('project_files')
          .values({
            project_id: projectId,
            path: req.path,
            kind: 'text',
            content_text: req.content,
            size_bytes: Buffer.byteLength(req.content, 'utf8'),
            sha256: sha256Hex(req.content),
            created_by: userId,
            updated_by: userId,
          })
          .returning(FILE_COLUMNS)
          .executeTakeFirstOrThrow();
        await recordAudit(trx, {
          projectId,
          actorId: userId,
          action: 'file.created',
          metadata: { path: req.path },
        });
        return toFile(row);
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict(`A file named "${req.path}" already exists.`);
        throw err;
      }
    });
  }

  /**
   * Compare-and-swap save: succeeds only if the stored hash still equals
   * `expectedSha256` (the client's If-Match). Never silently overwrites a
   * newer version written by another tab or user.
   */
  async save(
    userId: string,
    projectId: string,
    fileId: string,
    content: string,
    expectedSha256: string | undefined,
  ): Promise<ProjectFile> {
    if (!expectedSha256) {
      throw new ApiException(
        'PRECONDITION_REQUIRED',
        'Send the If-Match header with the version you edited.',
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }
    return this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'files:write', 'share');
      const current = await this.liveFile(trx, projectId, fileId);
      if (current.kind !== 'text')
        throw new ApiException(
          'BAD_REQUEST',
          'Binary files cannot be edited as text.',
          HttpStatus.BAD_REQUEST,
        );
      const newHash = sha256Hex(content);
      if (current.sha256 === newHash) return toFile(current); // idempotent retry
      const row = await trx
        .updateTable('project_files')
        .set({
          content_text: content,
          size_bytes: Buffer.byteLength(content, 'utf8'),
          sha256: newHash,
          updated_by: userId,
          updated_at: sql`now()`,
        })
        .where('id', '=', fileId)
        .where('sha256', '=', expectedSha256)
        .returning(FILE_COLUMNS)
        .executeTakeFirst();
      if (!row) {
        throw new ApiException(
          'PRECONDITION_FAILED',
          'This file was changed somewhere else since you opened it.',
          HttpStatus.PRECONDITION_FAILED,
        );
      }
      await trx
        .updateTable('projects')
        .set({ updated_at: sql`now()` })
        .where('id', '=', projectId)
        .execute();
      return toFile(row);
    });
  }

  async rename(
    userId: string,
    projectId: string,
    fileId: string,
    newPath: string,
  ): Promise<ProjectFile> {
    return this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'files:write', 'update');
      const current = await this.liveFile(trx, projectId, fileId);
      if (current.path === newPath) return toFile(current);
      if (current.kind === 'text' && !isTextPath(newPath)) {
        throw new ApiException(
          'VALIDATION_FAILED',
          'A text file must keep a text extension (.tex, .bib, …).',
          HttpStatus.BAD_REQUEST,
        );
      }
      const project = await trx
        .selectFrom('projects')
        .select('root_file_path')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();
      const isRoot = project.root_file_path === current.path;
      if (isRoot && !isTexRoot(newPath)) {
        throw new ApiException(
          'VALIDATION_FAILED',
          'The main file must stay a .tex file.',
          HttpStatus.BAD_REQUEST,
        );
      }
      try {
        const row = await trx
          .updateTable('project_files')
          .set({ path: newPath, updated_by: userId, updated_at: sql`now()` })
          .where('id', '=', fileId)
          .returning(FILE_COLUMNS)
          .executeTakeFirstOrThrow();
        if (isRoot) {
          await trx
            .updateTable('projects')
            .set({ root_file_path: newPath })
            .where('id', '=', projectId)
            .execute();
        }
        await recordAudit(trx, {
          projectId,
          actorId: userId,
          action: 'file.renamed',
          metadata: { from: current.path, to: newPath },
        });
        return toFile(row);
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict(`A file named "${newPath}" already exists.`);
        throw err;
      }
    });
  }

  async remove(userId: string, projectId: string, fileId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'files:write', 'update');
      const current = await this.liveFile(trx, projectId, fileId);
      const project = await trx
        .selectFrom('projects')
        .select('root_file_path')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();
      if (project.root_file_path === current.path) {
        throw conflict('This is the main file. Choose another main file before deleting it.');
      }
      await trx
        .updateTable('project_files')
        .set({ deleted_at: sql`now()`, updated_by: userId })
        .where('id', '=', fileId)
        .execute();
      await recordAudit(trx, {
        projectId,
        actorId: userId,
        action: 'file.deleted',
        metadata: { path: current.path },
      });
    });
  }

  private async liveFile(
    db: Kysely<Database> | Transaction<Database>,
    projectId: string,
    fileId: string,
  ) {
    if (!isUuid(fileId)) throw notFound('File');
    const row = await db
      .selectFrom('project_files')
      .select([...FILE_COLUMNS, 'content_text'])
      .where('id', '=', fileId)
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw notFound('File');
    return row;
  }
}
