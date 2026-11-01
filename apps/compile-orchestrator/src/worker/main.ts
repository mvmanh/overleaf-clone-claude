/* Compile worker: consumes the BullMQ compile queue and runs jobs through the
 * configured SandboxExecutor (security gate enforced in createExecutor). */
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DEFAULT_SANDBOX_LIMITS } from '@latex-cloud/compiler-protocol';
import {
  COMPILE_QUEUE_NAME,
  COMPILE_WORKER_KEY,
  type CompileWorkerInfo,
} from '@latex-cloud/shared';
import { createExecutor } from '../executors/factory';
import { loadWorkerEnv } from './config';
import { createWorkerDb } from './db';
import { failAbandonedJobs, processCompileJob } from './process-job';
import { createS3Storage } from './storage';

function redisOptions(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

async function main() {
  const env = loadWorkerEnv();
  const executor = createExecutor(env);
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const limits = { ...DEFAULT_SANDBOX_LIMITS, wallTimeMs: env.COMPILE_WALL_TIME_MS };
  const db = createWorkerDb(env.DATABASE_URL);
  const storage = createS3Storage(env);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const log = (m: string) => console.log(`[compile-worker] ${m}`);

  const info: CompileWorkerInfo = {
    texImage: executor.descriptor.texImage,
    executor: executor.descriptor.kind,
    isolation: executor.descriptor.isolation,
    concurrency: env.COMPILE_CONCURRENCY,
    updatedAt: new Date().toISOString(),
  };
  const heartbeat = async () => {
    info.updatedAt = new Date().toISOString();
    await redis.set(COMPILE_WORKER_KEY, JSON.stringify(info), 'EX', 30);
  };
  await heartbeat();
  const beat = setInterval(
    () => void heartbeat().catch((e: unknown) => log(`heartbeat failed: ${String(e)}`)),
    10_000,
  );

  const abandonAfter = limits.wallTimeMs * 3;
  const sweep = async () => {
    const n = await failAbandonedJobs(db, abandonAfter);
    if (n) log(`marked ${n} abandoned job(s) as failed`);
  };
  await sweep();
  const sweeper = setInterval(() => void sweep().catch(() => undefined), 60_000);

  const worker = new Worker(
    COMPILE_QUEUE_NAME,
    async (job) => {
      const jobId = (job.data as { jobId?: unknown }).jobId;
      if (typeof jobId !== 'string') throw new Error('malformed compile job payload');
      return processCompileJob({ db, storage, executor, limits, workerId, log }, jobId);
    },
    {
      connection: { ...redisOptions(env.REDIS_URL), maxRetriesPerRequest: null },
      concurrency: env.COMPILE_CONCURRENCY,
      // A compile can legitimately take up to the wall-clock limit.
      lockDuration: limits.wallTimeMs + 30_000,
    },
  );
  worker.on('failed', (job, err) => log(`queue job ${job?.id} failed: ${err.message}`));
  log(
    `ready: executor=${info.executor} isolation=${info.isolation} image=${info.texImage} concurrency=${info.concurrency}`,
  );

  const shutdown = async (signal: string) => {
    log(`${signal}: draining`);
    clearInterval(beat);
    clearInterval(sweeper);
    await worker.close();
    await redis.del(COMPILE_WORKER_KEY).catch(() => undefined);
    redis.disconnect();
    storage.destroy();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
