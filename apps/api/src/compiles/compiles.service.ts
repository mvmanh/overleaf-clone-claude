import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { type Kysely, sql } from 'kysely';
import type { Readable } from 'node:stream';
import {
  type CompileArtifactKind,
  type CompileJob,
  CompileWorkerInfo,
  COMPILE_WORKER_KEY,
  Diagnostic,
  type LatestCompilesResponse,
} from '@latex-cloud/shared';
import {
  computeFingerprint,
  packSnapshot,
  type RevisionManifest,
  sha256Hex,
} from '@latex-cloud/compiler-protocol';
import { ApiException, notFound } from '../common/api-exception';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { ensureRedisConnected, REDIS } from '../health/dependencies';
import { isUuid, ProjectAccessService } from '../projects/project-access.service';
import { BLOB_STORAGE, type BlobStorage } from './blob-storage';
import { COMPILE_QUEUE, type CompileQueue } from './compile-queue';

type JobRow = Awaited<ReturnType<CompilesService['jobRows']>>[number];

const ACTIVE = ['queued', 'preparing', 'running', 'publishing'] as const;

const toIso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

@Injectable()
export class CompilesService {
  private readonly logger = new Logger('CompilesService');

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(BLOB_STORAGE) private readonly blobs: BlobStorage,
    @Inject(COMPILE_QUEUE) private readonly queue: CompileQueue,
    private readonly access: ProjectAccessService,
  ) {}

  /** The TeX image the running workers use; part of every fingerprint. */
  private async workerInfo(): Promise<CompileWorkerInfo> {
    let raw: string | null = null;
    try {
      await ensureRedisConnected(this.redis);
      raw = await this.redis.get(COMPILE_WORKER_KEY);
    } catch {
      raw = null;
    }
    const parsed = raw ? CompileWorkerInfo.safeParse(JSON.parse(raw)) : null;
    if (!parsed?.success) {
      throw new ApiException(
        'COMPILER_UNAVAILABLE',
        'The compile service is not running. Start the compile worker and try again.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return parsed.data;
  }

  /**
   * Captures an immutable revision of the project and returns the compile job
   * for it: an existing one when the same content is already built/building
   * (coalescing repeated clicks, cache hits), otherwise a new queued job.
   */
  async request(userId: string, projectId: string): Promise<CompileJob> {
    await this.access.requireAction(userId, projectId, 'compile:run');
    const worker = await this.workerInfo();

    // REPEATABLE READ: every file is read from the same snapshot, so a
    // revision can never mix versions from concurrent saves.
    const captured = await this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        const project = await trx
          .selectFrom('projects')
          .select(['engine', 'root_file_path'])
          .where('id', '=', projectId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (!project) throw notFound('Project');
        const files = await trx
          .selectFrom('project_files')
          .select(['path', 'content_text'])
          .where('project_id', '=', projectId)
          .where('deleted_at', 'is', null)
          .where('kind', '=', 'text')
          .orderBy('path')
          .execute();
        return { project, files };
      });

    const root = captured.project.root_file_path;
    if (!root || !captured.files.some((f) => f.path === root)) {
      throw new ApiException(
        'VALIDATION_FAILED',
        'Choose a main .tex file before compiling.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const snapshotFiles = captured.files.map((f) => ({
      path: f.path,
      content: Buffer.from(f.content_text ?? '', 'utf8'),
    }));
    const manifest: RevisionManifest = {
      schemaVersion: 1,
      rootFile: root,
      engine: captured.project.engine,
      texImage: worker.texImage,
      options: { synctex: true },
      files: snapshotFiles.map((f) => ({
        path: f.path,
        sha256: sha256Hex(f.content),
        sizeBytes: f.content.byteLength,
      })),
    };
    const fingerprint = computeFingerprint(manifest);
    // Keys are scoped per project: no cross-tenant dedup or probing.
    const sourceKey = `sources/${projectId}/${fingerprint}.tar`;
    if (!(await this.blobs.exists(sourceKey))) {
      await this.blobs.put(sourceKey, await packSnapshot(snapshotFiles), 'application/x-tar');
    }

    const { jobId, enqueue } = await this.db.transaction().execute(async (trx) => {
      // Serialise compile requests per project (coalescing + supersede are atomic).
      await this.access.lockForAction(trx, userId, projectId, 'compile:run', 'update');
      await trx
        .insertInto('project_revisions')
        .values({
          project_id: projectId,
          fingerprint,
          manifest: JSON.stringify(manifest),
          source_key: sourceKey,
          created_by: userId,
        })
        .onConflict((oc) => oc.columns(['project_id', 'fingerprint']).doNothing())
        .execute();
      const revision = await trx
        .selectFrom('project_revisions')
        .select('id')
        .where('project_id', '=', projectId)
        .where('fingerprint', '=', fingerprint)
        .executeTakeFirstOrThrow();

      // Reuse: in-flight or successful builds, and deterministic compile errors.
      const reusable = await trx
        .selectFrom('compile_jobs')
        .select('id')
        .where('revision_id', '=', revision.id)
        .where((eb) =>
          eb.or([
            eb('status', 'in', [...ACTIVE, 'succeeded']),
            eb.and([eb('status', '=', 'failed'), eb('outcome', '=', 'compile-error')]),
          ]),
        )
        .orderBy('queued_at', 'desc')
        .executeTakeFirst();
      if (reusable) return { jobId: reusable.id, enqueue: false };

      // Latest wins: queued builds of older revisions will never be shown.
      await trx
        .updateTable('compile_jobs')
        .set({ status: 'superseded', finished_at: sql`now()` })
        .where('project_id', '=', projectId)
        .where('status', '=', 'queued')
        .execute();

      const job = await trx
        .insertInto('compile_jobs')
        .values({
          project_id: projectId,
          revision_id: revision.id,
          status: 'queued',
          engine: captured.project.engine,
          root_file: root,
          requested_by: userId,
          tex_image: worker.texImage,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { jobId: job.id, enqueue: true };
    });

    if (enqueue) {
      try {
        await this.queue.enqueue(jobId);
      } catch (err) {
        this.logger.error(`could not enqueue compile ${jobId}: ${String(err)}`);
        await this.db
          .updateTable('compile_jobs')
          .set({
            status: 'failed',
            outcome: 'sandbox-error',
            message: 'Could not queue the compile.',
            finished_at: sql`now()`,
          })
          .where('id', '=', jobId)
          .execute();
      }
    }
    const job = await this.load(jobId);
    return { ...job, cacheHit: !enqueue && job.status === 'succeeded' };
  }

  async get(userId: string, jobId: string): Promise<CompileJob> {
    const job = await this.loadVisible(userId, jobId);
    return job;
  }

  async latest(userId: string, projectId: string): Promise<LatestCompilesResponse> {
    await this.access.requireAction(userId, projectId, 'project:read');
    const latestRow = await this.jobRows((q) =>
      q
        .where('j.project_id', '=', projectId)
        .where('j.status', '!=', 'superseded')
        .orderBy('j.queued_at', 'desc')
        .limit(1),
    );
    const successRow = await this.jobRows((q) =>
      q
        .where('j.project_id', '=', projectId)
        .where('j.status', '=', 'succeeded')
        .orderBy('j.finished_at', 'desc')
        .limit(1),
    );
    const [latest, lastSuccessful] = await Promise.all([
      latestRow[0] ? this.withArtifacts(latestRow[0]) : null,
      successRow[0] ? this.withArtifacts(successRow[0]) : null,
    ]);
    return { latest, lastSuccessful };
  }

  async artifact(
    userId: string,
    jobId: string,
    kind: CompileArtifactKind,
  ): Promise<{ stream: Readable; size: number | undefined; fileName: string }> {
    await this.loadVisible(userId, jobId);
    const row = await this.db
      .selectFrom('compile_artifacts')
      .select(['blob_key', 'file_name'])
      .where('compile_job_id', '=', jobId)
      .where('kind', '=', kind)
      .executeTakeFirst();
    if (!row) throw notFound('Artifact');
    const { stream, size } = await this.blobs.getStream(row.blob_key);
    return { stream, size, fileName: row.file_name };
  }

  private async loadVisible(userId: string, jobId: string): Promise<CompileJob> {
    if (!isUuid(jobId)) throw notFound('Compile');
    const owner = await this.db
      .selectFrom('compile_jobs')
      .select('project_id')
      .where('id', '=', jobId)
      .executeTakeFirst();
    if (!owner) throw notFound('Compile');
    const role = await this.access.roleOf(userId, owner.project_id);
    if (!role) throw notFound('Compile'); // same answer as "does not exist"
    return this.load(jobId);
  }

  private async load(jobId: string): Promise<CompileJob> {
    const [row] = await this.jobRows((q) => q.where('j.id', '=', jobId));
    if (!row) throw notFound('Compile');
    return this.withArtifacts(row);
  }

  jobRows(
    filter: (q: ReturnType<CompilesService['baseJobs']>) => ReturnType<CompilesService['baseJobs']>,
  ) {
    return filter(this.baseJobs()).execute();
  }

  private baseJobs() {
    return this.db
      .selectFrom('compile_jobs as j')
      .innerJoin('project_revisions as r', 'r.id', 'j.revision_id')
      .select([
        'j.id',
        'j.project_id',
        'j.revision_id',
        'r.fingerprint',
        'j.status',
        'j.outcome',
        'j.message',
        'j.engine',
        'j.root_file',
        'j.queued_at',
        'j.started_at',
        'j.finished_at',
        'j.setup_ms',
        'j.compile_ms',
        'j.total_ms',
        'j.diagnostics',
      ]);
  }

  private async withArtifacts(r: JobRow): Promise<CompileJob> {
    const artifacts = await this.db
      .selectFrom('compile_artifacts')
      .select(['kind', 'file_name', 'size_bytes'])
      .where('compile_job_id', '=', r.id)
      .execute();
    const diagnostics = Diagnostic.array().safeParse(r.diagnostics);
    const queued = new Date(r.queued_at).getTime();
    return {
      id: r.id,
      projectId: r.project_id,
      revisionId: r.revision_id,
      fingerprint: r.fingerprint,
      status: r.status,
      outcome: r.outcome,
      message: r.message,
      engine: r.engine,
      rootFile: r.root_file,
      cacheHit: false,
      queuedAt: toIso(r.queued_at)!,
      startedAt: toIso(r.started_at),
      finishedAt: toIso(r.finished_at),
      timings: {
        queueMs: r.started_at ? Math.max(0, new Date(r.started_at).getTime() - queued) : null,
        setupMs: r.setup_ms,
        compileMs: r.compile_ms,
        totalMs: r.total_ms,
      },
      diagnostics: diagnostics.success ? diagnostics.data : [],
      artifacts: artifacts.map((a) => ({
        kind: a.kind,
        fileName: a.file_name,
        sizeBytes: a.size_bytes,
      })),
    };
  }
}
