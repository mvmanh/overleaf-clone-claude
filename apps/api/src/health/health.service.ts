import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { type Kysely, sql } from 'kysely';
import type { DependencyStatus, ReadinessResponse } from '@latex-cloud/shared';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { pendingMigrations } from '../database/connection';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { ensureRedisConnected, REDIS, S3 } from './dependencies';

const CHECK_TIMEOUT_MS = 2_000;

class CheckFailure extends Error {}

async function timed(fn: () => Promise<void>): Promise<DependencyStatus> {
  const start = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CheckFailure('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return { status: 'up', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    // Public endpoint: expose a coarse reason only, never driver messages.
    const error = err instanceof CheckFailure ? err.message : 'unreachable';
    return { status: 'down', latencyMs: Math.round(performance.now() - start), error };
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async readiness(): Promise<ReadinessResponse> {
    const [database, migrations, redis, objectStorage] = await Promise.all([
      timed(async () => {
        await sql`select 1`.execute(this.db);
      }),
      timed(async () => {
        const pending = await pendingMigrations(this.db);
        if (pending.length > 0) throw new CheckFailure(`${pending.length} pending`);
      }),
      timed(async () => {
        await ensureRedisConnected(this.redis);
        const pong = await this.redis.ping();
        if (pong !== 'PONG') throw new CheckFailure('unexpected reply');
      }),
      timed(async () => {
        await this.s3.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }));
      }),
    ]);
    const checks = { database, migrations, redis, objectStorage };
    const ready = Object.values(checks).every((c) => c.status === 'up');
    return { status: ready ? 'ready' : 'degraded', checks };
  }
}
