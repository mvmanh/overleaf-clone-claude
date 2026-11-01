import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Readable } from 'node:stream';
import { ZipFile as ZipWriter } from 'yazl';
import {
  type CreateFileRequest,
  extensionOf,
  isTexRoot,
  isTextPath,
  MAX_FILES_PER_PROJECT,
  MAX_PROJECT_BYTES,
  MAX_TEXT_CONTENTS_BYTES,
  type ProjectTextContentsResponse,
  MAX_TEXT_FILE_BYTES,
  type ProjectFile,
  type ProjectFileListResponse,
  type ProjectFileWithContent,
} from '@latex-cloud/shared';
import { CollabEvents } from '../collab/collab-events';
import { CollabTextService } from '../collab/collab-text.service';
import { ApiException, notFound } from '../common/api-exception';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { BLOB_STORAGE, type BlobStorage } from '../storage/blob-storage';
import { recordAudit } from './audit';
import { classifyFile, contentTypeFor, isInlineSafe } from './file-types';
import { sha256Hex } from './hash';
import { isUuid, ProjectAccessService } from './project-access.service';

const conflict = (message: string) => new ApiException('CONFLICT', message, HttpStatus.CONFLICT);
const invalid = (message: string) =>
  new ApiException('VALIDATION_FAILED', message, HttpStatus.BAD_REQUEST);

/** Content-addressed per project: identical uploads share one object, never across projects. */
export const fileBlobKey = (projectId: string, sha256: string) => `files/${projectId}/${sha256}`;

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
    @Inject(BLOB_STORAGE) private readonly blobs: BlobStorage,
    private readonly collabText: CollabTextService,
    private readonly events: CollabEvents,
  ) {}

  /**
   * Uploads one file (text or allowed binary). With `overwrite`, replaces an
   * existing file at the same path; otherwise an existing path is a conflict.
   */
  async upload(
    userId: string,
    projectId: string,
    path: string,
    bytes: Buffer,
    overwrite: boolean,
  ): Promise<{ file: ProjectFile; replaced: boolean }> {
    // Cheap authorization before storing anything.
    await this.access.requireAction(userId, projectId, 'files:write');
    const classified = classifyFile(path, bytes);
    if (!classified.ok) throw invalid(`${path}: ${classified.reason}.`);
    if (classified.kind === 'text' && bytes.byteLength > MAX_TEXT_FILE_BYTES) {
      throw new ApiException(
        'PAYLOAD_TOO_LARGE',
        'Text files are limited to 2 MB.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const sha = sha256Hex(bytes);
    let blobKey: string | null = null;
    if (classified.kind === 'binary') {
      blobKey = fileBlobKey(projectId, sha);
      if (!(await this.blobs.exists(blobKey)))
        await this.blobs.put(blobKey, bytes, contentTypeFor(path));
    }

    const result = await this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'files:write', 'update');
      const existing = await trx
        .selectFrom('project_files')
        .select(['id', 'path', 'kind', 'size_bytes'])
        .where('project_id', '=', projectId)
        .where('deleted_at', 'is', null)
        .where(sql`lower(path)`, '=', path.toLowerCase())
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (existing && !overwrite) throw conflict(`A file named "${existing.path}" already exists.`);
      if (existing && existing.kind !== classified.kind)
        throw conflict(`Cannot replace "${existing.path}" with a different kind of file.`);

      const usage = await trx
        .selectFrom('project_files')
        .select((e) => [
          e.fn.coalesce(e.fn.sum<string>('size_bytes'), sql<string>`0`).as('bytes'),
          e.fn.countAll<string>().as('n'),
        ])
        .where('project_id', '=', projectId)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      if (
        Number(usage.bytes) - (existing?.size_bytes ?? 0) + bytes.byteLength >
        MAX_PROJECT_BYTES
      ) {
        throw new ApiException(
          'PAYLOAD_TOO_LARGE',
          `Projects are limited to ${MAX_PROJECT_BYTES / 1024 / 1024} MB in total.`,
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      if (!existing && Number(usage.n) >= MAX_FILES_PER_PROJECT) {
        throw conflict(`A project can contain at most ${MAX_FILES_PER_PROJECT} files.`);
      }

      const values = {
        content_text: classified.kind === 'text' ? classified.text : null,
        blob_key: blobKey,
        size_bytes: bytes.byteLength,
        sha256: classified.kind === 'text' ? sha256Hex(classified.text) : sha,
        updated_by: userId,
      };
      let row;
      // Replacing a collaboratively edited file goes through its Yjs state.
      const viaCollab =
        existing && classified.kind === 'text'
          ? await this.collabText.applyExternalEdit(trx, existing.id, classified.text, userId)
          : false;
      if (existing) {
        row = await trx
          .updateTable('project_files')
          .set({ ...values, updated_at: sql`now()` })
          .where('id', '=', existing.id)
          .returning(FILE_COLUMNS)
          .executeTakeFirstOrThrow();
      } else {
        row = await trx
          .insertInto('project_files')
          .values({
            ...values,
            project_id: projectId,
            path,
            kind: classified.kind,
            created_by: userId,
          })
          .returning(FILE_COLUMNS)
          .executeTakeFirstOrThrow();
      }
      await trx
        .updateTable('projects')
        .set({ updated_at: sql`now()` })
        .where('id', '=', projectId)
        .execute();
      await recordAudit(trx, {
        projectId,
        actorId: userId,
        action: existing ? 'file.replaced' : 'file.uploaded',
        metadata: { path, kind: classified.kind, sizeBytes: bytes.byteLength },
      });
      return { file: toFile(row), replaced: Boolean(existing), viaCollab };
    });
    await this.events.publish(
      result.viaCollab
        ? { type: 'file-updated', projectId, fileId: result.file.id }
        : { type: 'files-changed', projectId },
    );
    return { file: result.file, replaced: result.replaced };
  }

  /** Every live text file with its content (viewer+), bounded by a size budget. */
  async textContents(userId: string, projectId: string): Promise<ProjectTextContentsResponse> {
    await this.access.requireAction(userId, projectId, 'files:read');
    const rows = await this.db
      .selectFrom('project_files')
      .select(['id', 'path', 'sha256', 'size_bytes', 'content_text'])
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .where('kind', '=', 'text')
      .orderBy('path')
      .execute();
    let budget = MAX_TEXT_CONTENTS_BYTES;
    const files: ProjectTextContentsResponse['files'] = [];
    let truncated = false;
    const included = rows.filter((r) => {
      if (r.size_bytes > budget) {
        truncated = true;
        return false;
      }
      budget -= r.size_bytes;
      return true;
    });
    const texts = await this.collabText.liveTexts(this.db, included);
    for (const r of included) {
      files.push({ id: r.id, path: r.path, sha256: r.sha256, content: texts.get(r.id) ?? '' });
    }
    return { files, truncated };
  }

  /** Raw bytes of any file (download, image/PDF preview). */
  async raw(
    userId: string,
    projectId: string,
    fileId: string,
  ): Promise<{
    body: Buffer | Readable;
    size: number;
    path: string;
    contentType: string;
    inline: boolean;
    sha256: string;
  }> {
    await this.access.requireAction(userId, projectId, 'files:read');
    const row = await this.liveFile(this.db, projectId, fileId);
    const base = {
      size: row.size_bytes,
      path: row.path,
      contentType: contentTypeFor(row.path),
      sha256: row.sha256,
    };
    if (row.kind === 'text') {
      const text = await this.collabText.liveText(this.db, row);
      const body = Buffer.from(text, 'utf8');
      return { ...base, size: body.byteLength, sha256: sha256Hex(text), body, inline: false };
    }
    const blob = await this.db
      .selectFrom('project_files')
      .select('blob_key')
      .where('id', '=', fileId)
      .executeTakeFirstOrThrow();
    const { stream } = await this.blobs.getStream(blob.blob_key!);
    return { ...base, body: stream, inline: isInlineSafe(row.path) };
  }

  /** Streams every live file of the project as a ZIP (viewer+). */
  async exportZip(userId: string, projectId: string): Promise<{ stream: Readable; name: string }> {
    await this.access.requireAction(userId, projectId, 'files:read');
    const project = await this.db
      .selectFrom('projects')
      .select('name')
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow();
    const rows = await this.db
      .selectFrom('project_files')
      .select(['id', 'path', 'kind', 'content_text', 'blob_key'])
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .orderBy('path')
      .execute();
    const texts = await this.collabText.liveTexts(
      this.db,
      rows.filter((r) => r.kind === 'text'),
    );
    const zip = new ZipWriter();
    for (const r of rows) {
      if (r.kind === 'text') zip.addBuffer(Buffer.from(texts.get(r.id) ?? '', 'utf8'), r.path);
      else zip.addBuffer(await this.blobs.get(r.blob_key!), r.path, { compress: false });
    }
    zip.end();
    const name = project.name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim() || 'project';
    return { stream: zip.outputStream as unknown as Readable, name };
  }

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
    const content = await this.collabText.liveText(this.db, row);
    return {
      ...toFile(row),
      sha256: sha256Hex(content),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      content,
    };
  }

  async create(userId: string, projectId: string, req: CreateFileRequest): Promise<ProjectFile> {
    const file = await this.db.transaction().execute(async (trx) => {
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
    await this.events.publish({ type: 'files-changed', projectId });
    return file;
  }

  /**
   * Compare-and-swap save: succeeds only if the current text still hashes to
   * `expectedSha256` (the client's If-Match). Never silently overwrites a
   * newer version written by another tab or user. For a file being edited
   * collaboratively the save becomes a minimal Yjs edit, merged with live
   * collaborators' changes.
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
    if (!isUuid(fileId)) throw notFound('File');
    const result = await this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'files:write', 'share');
      const current = await trx
        .selectFrom('project_files')
        .select([...FILE_COLUMNS, 'content_text'])
        .where('id', '=', fileId)
        .where('project_id', '=', projectId)
        .where('deleted_at', 'is', null)
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (!current) throw notFound('File');
      if (current.kind !== 'text')
        throw new ApiException(
          'BAD_REQUEST',
          'Binary files cannot be edited as text.',
          HttpStatus.BAD_REQUEST,
        );
      const currentSha = sha256Hex(await this.collabText.liveText(trx, current));
      const newHash = sha256Hex(content);
      if (currentSha === newHash) return { file: { ...toFile(current), sha256: newHash } };
      if (currentSha !== expectedSha256) {
        throw new ApiException(
          'PRECONDITION_FAILED',
          'This file was changed somewhere else since you opened it.',
          HttpStatus.PRECONDITION_FAILED,
        );
      }
      const viaCollab = await this.collabText.applyExternalEdit(trx, fileId, content, userId);
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
        .returning(FILE_COLUMNS)
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('projects')
        .set({ updated_at: sql`now()` })
        .where('id', '=', projectId)
        .execute();
      return { file: toFile(row), viaCollab };
    });
    if (result.viaCollab) await this.events.publish({ type: 'file-updated', projectId, fileId });
    return result.file;
  }

  async rename(
    userId: string,
    projectId: string,
    fileId: string,
    newPath: string,
  ): Promise<ProjectFile> {
    const renamed = await this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'files:write', 'update');
      const current = await this.liveFile(trx, projectId, fileId);
      if (current.path === newPath) return toFile(current);
      if (current.kind === 'binary' && extensionOf(newPath) !== extensionOf(current.path)) {
        throw invalid('Renaming cannot change the type of an uploaded file.');
      }
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
    await this.events.publish({ type: 'files-changed', projectId });
    return renamed;
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
    await this.events.publish({ type: 'file-deleted', projectId, fileId });
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
