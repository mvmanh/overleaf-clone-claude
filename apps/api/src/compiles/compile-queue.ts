import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { COMPILE_QUEUE_NAME } from '@latex-cloud/shared';
import { APP_CONFIG, type AppConfig } from '../config/env';

/** Producer side of the compile queue. Payload is only the job id; the worker reads the rest from the DB. */
export interface CompileQueue {
  enqueue(jobId: string): Promise<void>;
}

export const COMPILE_QUEUE = Symbol('COMPILE_QUEUE');

export function redisConnectionOptions(url: string) {
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

@Injectable()
export class BullCompileQueue implements CompileQueue, OnApplicationShutdown {
  private queue: Queue | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private get q(): Queue {
    this.queue ??= new Queue(COMPILE_QUEUE_NAME, {
      connection: {
        ...redisConnectionOptions(this.config.REDIS_URL),
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      },
    });
    return this.queue;
  }

  async enqueue(jobId: string): Promise<void> {
    await this.q.add(
      'compile',
      { jobId },
      { jobId, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
  }
}
