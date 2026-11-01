import { z } from 'zod';
import { Diagnostic } from './diagnostics';
import { TexEngineName } from './projects';

export const CompileJobStatus = z.enum([
  'queued',
  'preparing',
  'running',
  'publishing',
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
]);
export type CompileJobStatus = z.infer<typeof CompileJobStatus>;

export const TERMINAL_COMPILE_STATUSES: readonly CompileJobStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
];

export const CompileOutcome = z.enum([
  'succeeded',
  'compile-error',
  'timeout',
  'output-limit-exceeded',
  'input-rejected',
  'cancelled',
  'sandbox-error',
]);
export type CompileOutcome = z.infer<typeof CompileOutcome>;

export const CompileArtifactKind = z.enum(['pdf', 'log', 'synctex']);
export type CompileArtifactKind = z.infer<typeof CompileArtifactKind>;

export const CompileTimings = z.object({
  queueMs: z.number().nonnegative().nullable(),
  setupMs: z.number().nonnegative().nullable(),
  compileMs: z.number().nonnegative().nullable(),
  totalMs: z.number().nonnegative().nullable(),
});
export type CompileTimings = z.infer<typeof CompileTimings>;

export const CompileJob = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  revisionId: z.string().uuid(),
  /** Content fingerprint of the revision (files + engine + root + TeX image). */
  fingerprint: z.string(),
  status: CompileJobStatus,
  outcome: CompileOutcome.nullable(),
  message: z.string().nullable(),
  engine: TexEngineName,
  rootFile: z.string(),
  /** True when the response reused an existing build of the same fingerprint. */
  cacheHit: z.boolean(),
  queuedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  timings: CompileTimings,
  diagnostics: z.array(Diagnostic),
  artifacts: z.array(
    z.object({ kind: CompileArtifactKind, fileName: z.string(), sizeBytes: z.number() }),
  ),
});
export type CompileJob = z.infer<typeof CompileJob>;

export const LatestCompilesResponse = z.object({
  /** Most recent job (any status), for progress and diagnostics. */
  latest: CompileJob.nullable(),
  /** Most recent job that produced a PDF; shown while newer ones fail or run. */
  lastSuccessful: CompileJob.nullable(),
});
export type LatestCompilesResponse = z.infer<typeof LatestCompilesResponse>;

/** Status published by running compile workers (heartbeat in Redis). */
export const CompileWorkerInfo = z.object({
  texImage: z.string(),
  executor: z.string(),
  isolation: z.string(),
  concurrency: z.number().int().positive(),
  updatedAt: z.string(),
});
export type CompileWorkerInfo = z.infer<typeof CompileWorkerInfo>;

export const COMPILE_WORKER_KEY = 'lc:compile:worker';
export const COMPILE_QUEUE_NAME = 'compile';
