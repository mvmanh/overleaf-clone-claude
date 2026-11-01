import { type Kysely, sql } from 'kysely';
import {
  type ArtifactKind,
  MAX_BUILD_CACHE_BYTES,
  type SandboxExecutor,
  type SandboxLimits,
  sha256Hex,
  type SnapshotFile,
  unpackSnapshot,
} from '@latex-cloud/compiler-protocol';
import type { CompileJobStatus, CompileOutcome } from '@latex-cloud/shared';
import { MemoryArtifactWriter } from '../executors/memory-writer';
import { createSnapshot, SnapshotRejectedError } from '../snapshot';
import type { WorkerDatabase } from './db';
import type { WorkerStorage } from './storage';

const CONTENT_TYPES: Record<ArtifactKind, string> = {
  pdf: 'application/pdf',
  log: 'text/plain; charset=utf-8',
  synctex: 'application/gzip',
};

export interface ProcessDeps {
  db: Kysely<WorkerDatabase>;
  storage: WorkerStorage;
  executor: SandboxExecutor;
  limits: SandboxLimits;
  workerId: string;
  log?: (msg: string) => void;
}

export type ProcessResult = 'skipped' | 'succeeded' | 'failed';

/** Conditional transition: only moves forward from the expected state. */
async function transition(
  db: Kysely<WorkerDatabase>,
  jobId: string,
  from: CompileJobStatus,
  to: CompileJobStatus,
): Promise<boolean> {
  const r = await db
    .updateTable('compile_jobs')
    .set({ status: to })
    .where('id', '=', jobId)
    .where('status', '=', from)
    .executeTakeFirst();
  return Number(r.numUpdatedRows) === 1;
}

async function fail(
  db: Kysely<WorkerDatabase>,
  jobId: string,
  outcome: CompileOutcome,
  message: string,
): Promise<'failed'> {
  await db
    .updateTable('compile_jobs')
    .set({
      status: 'failed',
      outcome,
      message,
      finished_at: sql<Date>`now()`,
      diagnostics: JSON.stringify([{ severity: 'error', message, code: outcome }]),
    })
    .where('id', '=', jobId)
    .where('status', 'in', ['preparing', 'running', 'publishing'])
    .execute();
  return 'failed';
}

/**
 * Builds one compile job end to end. Safe to call more than once for the same
 * id: only a `queued` job can be claimed, and every later step is conditional
 * on the previous state.
 */
export async function processCompileJob(deps: ProcessDeps, jobId: string): Promise<ProcessResult> {
  const { db, storage, executor, limits } = deps;
  const started = performance.now();

  const claimed = await db
    .updateTable('compile_jobs')
    .set({ status: 'preparing', started_at: sql<Date>`now()`, worker: deps.workerId })
    .where('id', '=', jobId)
    .where('status', '=', 'queued')
    .returning(['project_id', 'revision_id', 'engine', 'root_file'])
    .executeTakeFirst();
  if (!claimed) return 'skipped'; // superseded, cancelled, or already taken

  try {
    const rev = await db
      .selectFrom('project_revisions')
      .select(['fingerprint', 'manifest', 'source_key'])
      .where('id', '=', claimed.revision_id)
      .executeTakeFirstOrThrow();
    const manifest = rev.manifest as { texImage?: string };
    if (manifest.texImage !== executor.descriptor.texImage) {
      return await fail(
        db,
        jobId,
        'input-rejected',
        'The TeX image changed after this revision was captured. Compile again.',
      );
    }

    const archive = await storage.get(rev.source_key, limits.maxInputBytes + 1024 * 1024);
    let snapshot;
    try {
      const files = await unpackSnapshot(archive, {
        maxFiles: 10_000,
        maxTotalBytes: limits.maxInputBytes,
      });
      snapshot = createSnapshot({
        files,
        rootFile: claimed.root_file,
        engine: claimed.engine,
        texImage: executor.descriptor.texImage,
      });
    } catch (err) {
      return await fail(
        db,
        jobId,
        'input-rejected',
        `Source snapshot rejected: ${(err as Error).message}`,
      );
    }
    // The bytes must be exactly what the revision promised (ADR-0005).
    if (snapshot.fingerprint !== rev.fingerprint) {
      return await fail(
        db,
        jobId,
        'input-rejected',
        'Source snapshot does not match its revision fingerprint.',
      );
    }

    // Per-project incremental build cache (never shared across projects).
    const cacheKey = `cache/${claimed.project_id}/${claimed.engine}-${sha256Hex(executor.descriptor.texImage).slice(0, 16)}.tar`;
    let cache: SnapshotFile[] | undefined;
    const cacheTar = await storage.getOptional(cacheKey, MAX_BUILD_CACHE_BYTES).catch(() => null);
    if (cacheTar) {
      cache = await unpackSnapshot(cacheTar, {
        maxFiles: 2000,
        maxTotalBytes: MAX_BUILD_CACHE_BYTES,
      }).catch(() => undefined);
    }

    if (!(await transition(db, jobId, 'preparing', 'running'))) return 'skipped';
    const engine = { engine: claimed.engine, rootFile: claimed.root_file };
    let writer = new MemoryArtifactWriter();
    let result = await executor.run(
      snapshot,
      { ...engine, ...(cache ? { cache } : {}) },
      limits,
      writer,
    );
    if (cache && result.outcome === 'compile-error') {
      // A stale or inconsistent cache must never cause a spurious failure:
      // confirm the error with a clean build before reporting it.
      deps.log?.(`compile ${jobId}: failed with cache, retrying clean`);
      writer = new MemoryArtifactWriter();
      result = await executor.run(snapshot, engine, limits, writer);
    }
    if (result.outcome === 'succeeded' && result.buildCache) {
      await storage.put(cacheKey, result.buildCache, 'application/x-tar').catch(() => undefined);
    }

    if (!(await transition(db, jobId, 'running', 'publishing'))) return 'skipped';
    for (const [kind, art] of writer.artifacts) {
      const key = `artifacts/${claimed.project_id}/${jobId}/${art.fileName}`;
      await storage.put(key, art.data, CONTENT_TYPES[kind]);
      await db
        .insertInto('compile_artifacts')
        .values({
          compile_job_id: jobId,
          kind,
          file_name: art.fileName,
          blob_key: key,
          size_bytes: art.data.byteLength,
          sha256: sha256Hex(art.data),
        })
        .onConflict((oc) => oc.columns(['compile_job_id', 'kind']).doNothing())
        .execute();
    }

    const succeeded = result.outcome === 'succeeded';
    await db
      .updateTable('compile_jobs')
      .set({
        status: succeeded ? 'succeeded' : 'failed',
        outcome: result.outcome,
        message: result.message ?? null,
        finished_at: sql<Date>`now()`,
        setup_ms: Math.round(result.timings.setupMs),
        compile_ms: Math.round(result.timings.compileMs),
        total_ms: Math.round(performance.now() - started),
        diagnostics: JSON.stringify(result.diagnostics),
      })
      .where('id', '=', jobId)
      .where('status', '=', 'publishing')
      .execute();
    deps.log?.(
      `compile ${jobId}: ${result.outcome} in ${Math.round(performance.now() - started)} ms (cache: ${result.usedCache ? 'hit' : 'none'})`,
    );
    return succeeded ? 'succeeded' : 'failed';
  } catch (err) {
    deps.log?.(`compile ${jobId} crashed: ${(err as Error).stack ?? String(err)}`);
    const message =
      err instanceof SnapshotRejectedError
        ? err.message
        : 'The compile service hit an internal error.';
    return fail(db, jobId, 'sandbox-error', message);
  }
}

/**
 * Jobs stuck mid-build belong to a worker that died. Mark them failed so the
 * UI does not spin forever; users can simply compile again.
 */
export async function failAbandonedJobs(
  db: Kysely<WorkerDatabase>,
  olderThanMs: number,
): Promise<number> {
  const r = await db
    .updateTable('compile_jobs')
    .set({
      status: 'failed',
      outcome: 'sandbox-error',
      message: 'The compile worker stopped during this build. Compile again.',
      finished_at: sql<Date>`now()`,
    })
    .where('status', 'in', ['preparing', 'running', 'publishing'])
    .where('started_at', '<', sql<Date>`now() - (${olderThanMs} * interval '1 millisecond')`)
    .executeTakeFirst();
  return Number(r.numUpdatedRows);
}
