import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Readable } from 'node:stream';
import { ZipFile as ZipWriter } from 'yazl';
import {
  type HistoryLabel,
  type HistoryListResponse,
  type HistoryVersion,
  type HistoryVersionDetail,
  MAX_FILES_PER_PROJECT,
  type ProjectFile,
  type RestoreVersionResponse,
} from '@latex-cloud/shared';
import { CollabEvents } from '../collab/collab-events';
import { CollabTextService } from '../collab/collab-text.service';
import { ApiException, forbidden, notFound } from '../common/api-exception';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { recordAudit } from '../projects/audit';
import { sha256Hex } from '../projects/hash';
import { isUuid, ProjectAccessService } from '../projects/project-access.service';
import { BLOB_STORAGE, type BlobStorage } from '../storage/blob-storage';
import { recordVersion } from './recorder';

type Db = Kysely<Database> | Transaction<Database>;

const PAGE = 100;

const VERSION_COLUMNS = [
  'v.id',
  'v.file_id',
  'v.path',
  'v.kind',
  'v.sha256',
  'v.size_bytes',
  'v.blob_key',
  'v.source',
  'v.authors',
  'v.created_at',
] as const;

type VersionRow = {
  id: string;
  file_id: string;
  path: string;
  kind: 'text' | 'binary';
  sha256: string;
  size_bytes: number;
  blob_key: string | null;
  source: HistoryVersion['source'];
  authors: string[];
  created_at: Date | string;
};

/** Cursor = `<created_at ISO with microseconds>|<id>`, opaque to clients. */
const encodeCursor = (createdAt: string, id: string) =>
  Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');

function decodeCursor(cursor: string): { at: string; id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!at || !id || !isUuid(id) || Number.isNaN(Date.parse(at)))
    throw new ApiException('VALIDATION_FAILED', 'Invalid cursor.', HttpStatus.BAD_REQUEST);
  return { at, id };
}

/** `chapter.tex` → `chapter-restored.tex` (or `-restored-2`, …). */
export function alternativePath(path: string, taken: Set<string>): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const stem = dot > slash ? path.slice(0, dot) : path;
  const ext = dot > slash ? path.slice(dot) : '';
  for (let i = 1; ; i++) {
    const candidate = `${stem}-restored${i === 1 ? '' : `-${i}`}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Version history: browse checkpoints, diff, restore a file, label a moment,
 * download the project as it was. Reads need `files:read`; restoring and
 * labelling need `files:write` (ADR-0015).
 */
@Injectable()
export class HistoryService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly access: ProjectAccessService,
    @Inject(BLOB_STORAGE) private readonly blobs: BlobStorage,
    private readonly collabText: CollabTextService,
    private readonly events: CollabEvents,
  ) {}

  async list(
    userId: string,
    projectId: string,
    opts: { before?: string; fileId?: string } = {},
  ): Promise<HistoryListResponse> {
    await this.access.requireAction(userId, projectId, 'files:read');
    let q = this.db
      .selectFrom('file_versions as v')
      .select([...VERSION_COLUMNS, sql<string>`v.created_at::text`.as('at_text')])
      .where('v.project_id', '=', projectId)
      .orderBy('v.created_at', 'desc')
      .orderBy('v.id', 'desc')
      .limit(PAGE + 1);
    if (opts.fileId) {
      if (!isUuid(opts.fileId)) throw notFound('File');
      q = q.where('v.file_id', '=', opts.fileId);
    }
    if (opts.before) {
      const c = decodeCursor(opts.before);
      q = q.where(sql<boolean>`(v.created_at, v.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await q.execute();
    const page = rows.slice(0, PAGE);
    const labels = opts.before
      ? []
      : await this.db
          .selectFrom('project_labels as l')
          .leftJoin('users as u', 'u.id', 'l.created_by')
          .select(['l.id', 'l.name', 'l.created_at', 'u.id as user_id', 'u.display_name'])
          .where('l.project_id', '=', projectId)
          .orderBy('l.created_at', 'desc')
          .execute();
    const names = await this.names(page.flatMap((r) => r.authors));
    const last = page[page.length - 1];
    return {
      versions: page.map((r) => this.toVersion(r, names)),
      labels: labels.map(
        (l): HistoryLabel => ({
          id: l.id,
          name: l.name,
          createdAt: new Date(l.created_at).toISOString(),
          createdBy: l.user_id ? { id: l.user_id, name: l.display_name ?? 'Unknown' } : null,
        }),
      ),
      nextCursor: rows.length > PAGE && last ? encodeCursor(last.at_text, last.id) : null,
    };
  }

  async detail(
    userId: string,
    projectId: string,
    versionId: string,
  ): Promise<HistoryVersionDetail> {
    await this.access.requireAction(userId, projectId, 'files:read');
    const v = await this.versionRow(this.db, projectId, versionId);
    const prev = await this.db
      .selectFrom('file_versions as v')
      .select(VERSION_COLUMNS)
      .where('v.file_id', '=', v.file_id)
      .where(
        sql<boolean>`(v.created_at, v.id) < (select created_at, id from file_versions where id = ${v.id})`,
      )
      .orderBy('v.created_at', 'desc')
      .orderBy('v.id', 'desc')
      .executeTakeFirst();
    const names = await this.names([...v.authors, ...(prev?.authors ?? [])]);
    return {
      version: this.toVersion(v, names),
      content: await this.textOf(projectId, v),
      previous: prev
        ? { version: this.toVersion(prev, names), content: await this.textOf(projectId, prev) }
        : null,
    };
  }

  /**
   * Restores one file to a version. A deletion checkpoint holds the file's
   * last content, so restoring it undeletes the file as it was. A live file gets the old content (merged
   * into any collaborative document as a normal edit, so open editors update
   * live); a deleted file comes back, under a new name if its path is taken.
   */
  async restore(
    userId: string,
    projectId: string,
    versionId: string,
  ): Promise<RestoreVersionResponse> {
    const result = await this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'files:write', 'update');
      const v = await this.versionRow(trx, projectId, versionId);
      const file = await trx
        .selectFrom('project_files')
        .select(['id', 'path', 'kind', 'content_text', 'sha256', 'deleted_at'])
        .where('id', '=', v.file_id)
        .forNoKeyUpdate()
        .executeTakeFirstOrThrow();
      if (file.kind !== v.kind) throw notFound('Version');
      const text = v.kind === 'text' ? await this.textOf(projectId, v, trx) : null;

      let path = file.path;
      let samePath = true;
      if (file.deleted_at) {
        const live = await trx
          .selectFrom('project_files')
          .select(['path'])
          .where('project_id', '=', projectId)
          .where('deleted_at', 'is', null)
          .execute();
        if (live.length >= MAX_FILES_PER_PROJECT)
          throw new ApiException(
            'CONFLICT',
            `A project can contain at most ${MAX_FILES_PER_PROJECT} files.`,
            HttpStatus.CONFLICT,
          );
        const taken = new Set(live.map((f) => f.path.toLowerCase()));
        path = taken.has(v.path.toLowerCase()) ? alternativePath(v.path, taken) : v.path;
        samePath = path === v.path;
      }

      // Through the Yjs state when there is one (also for a deleted file: a
      // client that still holds the old document can then never duplicate
      // text by syncing it back).
      const viaCollab =
        text !== null ? await this.collabText.applyExternalEdit(trx, file.id, text, userId) : false;
      const row = await trx
        .updateTable('project_files')
        .set({
          path,
          deleted_at: null,
          sha256: v.sha256,
          size_bytes: v.size_bytes,
          ...(v.kind === 'text' ? { content_text: text } : { blob_key: v.blob_key }),
          updated_by: userId,
          updated_at: sql`now()`,
        })
        .where('id', '=', file.id)
        .returning(['id', 'path', 'kind', 'size_bytes', 'sha256', 'updated_at'])
        .executeTakeFirstOrThrow();
      await recordVersion(trx, {
        projectId,
        fileId: file.id,
        path,
        kind: v.kind,
        sha256: v.sha256,
        sizeBytes: v.size_bytes,
        blobKey: v.blob_key,
        text,
        source: 'restore',
        authors: [userId],
      });
      await recordAudit(trx, {
        projectId,
        actorId: userId,
        action: 'file.restored',
        metadata: { path, versionId: v.id, from: v.created_at },
      });
      const restored: ProjectFile = {
        id: row.id,
        path: row.path,
        kind: row.kind,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        updatedAt: new Date(row.updated_at).toISOString(),
      };
      return { file: restored, samePath, viaCollab, undeleted: Boolean(file.deleted_at) };
    });
    if (result.viaCollab)
      await this.events.publish({ type: 'file-updated', projectId, fileId: result.file.id });
    else await this.events.publish({ type: 'files-changed', projectId });
    return { file: result.file, samePath: result.samePath };
  }

  /**
   * Names the current state of the project. Every file whose text changed
   * since its last checkpoint is checkpointed first, so the label always
   * points at exactly what is on screen.
   */
  async createLabel(userId: string, projectId: string, name: string): Promise<HistoryLabel> {
    return this.db.transaction().execute(async (trx) => {
      await this.access.lockForAction(trx, userId, projectId, 'files:write', 'share');
      await this.checkpointAll(trx, projectId, userId);
      const label = await trx
        .insertInto('project_labels')
        .values({ project_id: projectId, name, created_by: userId })
        .returning(['id', 'name', 'created_at'])
        .executeTakeFirstOrThrow();
      const user = await trx
        .selectFrom('users')
        .select('display_name')
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      await recordAudit(trx, {
        projectId,
        actorId: userId,
        action: 'label.created',
        metadata: { name },
      });
      return {
        id: label.id,
        name: label.name,
        createdAt: new Date(label.created_at).toISOString(),
        createdBy: { id: userId, name: user.display_name },
      };
    });
  }

  /** The label's author or the owner may remove it; checkpoints stay. */
  async deleteLabel(userId: string, projectId: string, labelId: string): Promise<void> {
    if (!isUuid(labelId)) throw notFound('Label');
    await this.db.transaction().execute(async (trx) => {
      const role = await this.access.lockForAction(trx, userId, projectId, 'files:write', 'share');
      const label = await trx
        .selectFrom('project_labels')
        .select(['created_by', 'name'])
        .where('id', '=', labelId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!label) throw notFound('Label');
      if (label.created_by !== userId && role !== 'owner') throw forbidden();
      await trx.deleteFrom('project_labels').where('id', '=', labelId).execute();
      await recordAudit(trx, {
        projectId,
        actorId: userId,
        action: 'label.deleted',
        metadata: { name: label.name },
      });
    });
  }

  /** The project as it was right after a version or label, as a ZIP. */
  async exportAt(
    userId: string,
    projectId: string,
    at: { versionId?: string; labelId?: string },
  ): Promise<{ stream: Readable; name: string }> {
    await this.access.requireAction(userId, projectId, 'files:read');
    let bound;
    if (at.versionId) {
      const v = await this.versionRow(this.db, projectId, at.versionId);
      // Compared in SQL: timestamps keep their microseconds.
      bound = sql`(created_at, id) <= (select created_at, id from file_versions where id = ${v.id}::uuid)`;
    } else if (at.labelId && isUuid(at.labelId)) {
      const l = await this.db
        .selectFrom('project_labels')
        .select(['id'])
        .where('id', '=', at.labelId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!l) throw notFound('Label');
      bound = sql`created_at <= (select created_at from project_labels where id = ${l.id}::uuid)`;
    } else {
      throw new ApiException(
        'VALIDATION_FAILED',
        'Choose a version or a label.',
        HttpStatus.BAD_REQUEST,
      );
    }
    // Latest checkpoint of every file at that moment.
    const rows = await sql<VersionRow & { point: Date }>`
      select distinct on (file_id) id, file_id, path, kind, sha256, size_bytes, blob_key, source, authors, created_at
      from file_versions
      where project_id = ${projectId} and ${bound}
      order by file_id, created_at desc, id desc`.execute(this.db);
    const live = rows.rows
      .filter((r) => r.source !== 'delete')
      .sort((a, b) => a.path.localeCompare(b.path));
    const project = await this.db
      .selectFrom('projects')
      .select('name')
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow();
    const zip = new ZipWriter();
    for (const r of live) {
      if (r.kind === 'text')
        zip.addBuffer(Buffer.from((await this.textOf(projectId, r)) ?? '', 'utf8'), r.path);
      else zip.addBuffer(await this.blobs.get(r.blob_key!), r.path, { compress: false });
    }
    zip.end();
    const newest = live.reduce((m, r) => Math.max(m, new Date(r.created_at).getTime()), 0);
    const stamp = new Date(newest || Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const name = `${project.name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim() || 'project'} (${stamp})`;
    return { stream: zip.outputStream as unknown as Readable, name };
  }

  /** Checkpoints every live file whose current text differs from its last checkpoint. */
  private async checkpointAll(trx: Transaction<Database>, projectId: string, userId: string) {
    const files = await trx
      .selectFrom('project_files')
      .select(['id', 'path', 'kind', 'content_text', 'sha256', 'size_bytes', 'blob_key'])
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .execute();
    const texts = await this.collabText.liveTexts(
      trx,
      files.filter((f) => f.kind === 'text'),
    );
    const pending = await trx
      .selectFrom('collab_documents')
      .select(['file_id', 'history_authors'])
      .where(
        'file_id',
        'in',
        files.length ? files.map((f) => f.id) : ['00000000-0000-0000-0000-000000000000'],
      )
      .execute();
    const authorsOf = new Map(pending.map((p) => [p.file_id, p.history_authors]));
    for (const f of files) {
      const text = f.kind === 'text' ? (texts.get(f.id) ?? '') : null;
      const recorded = await recordVersion(trx, {
        projectId,
        fileId: f.id,
        path: f.path,
        kind: f.kind,
        sha256: text !== null ? sha256Hex(text) : f.sha256,
        sizeBytes: text !== null ? Buffer.byteLength(text, 'utf8') : f.size_bytes,
        blobKey: f.blob_key,
        text,
        source: 'edit',
        authors: authorsOf.get(f.id)?.length ? authorsOf.get(f.id)! : [userId],
      });
      if (recorded && authorsOf.get(f.id)?.length)
        await trx
          .updateTable('collab_documents')
          .set({ history_authors: [] })
          .where('file_id', '=', f.id)
          .execute();
    }
  }

  private async versionRow(db: Db, projectId: string, versionId: string): Promise<VersionRow> {
    if (!isUuid(versionId)) throw notFound('Version');
    const v = await db
      .selectFrom('file_versions as v')
      .select(VERSION_COLUMNS)
      .where('v.id', '=', versionId)
      .where('v.project_id', '=', projectId)
      .executeTakeFirst();
    if (!v) throw notFound('Version');
    return v;
  }

  private async textOf(projectId: string, v: VersionRow, db: Db = this.db): Promise<string | null> {
    if (v.kind !== 'text') return null;
    const blob = await db
      .selectFrom('history_blobs')
      .select('content')
      .where('project_id', '=', projectId)
      .where('sha256', '=', v.sha256)
      .executeTakeFirst();
    return blob?.content ?? '';
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.db
      .selectFrom('users')
      .select(['id', 'display_name'])
      .where('id', 'in', unique)
      .execute();
    return new Map(rows.map((r) => [r.id, r.display_name]));
  }

  private toVersion(r: VersionRow, names: Map<string, string>): HistoryVersion {
    return {
      id: r.id,
      fileId: r.file_id,
      path: r.path,
      kind: r.kind,
      sha256: r.sha256,
      sizeBytes: r.size_bytes,
      source: r.source,
      authors: r.authors.map((id) => ({ id, name: names.get(id) ?? 'Former member' })),
      createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
