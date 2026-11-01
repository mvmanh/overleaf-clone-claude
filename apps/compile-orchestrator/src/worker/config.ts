import { z } from 'zod';
import { OrchestratorEnv } from '../config';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const WorkerEnv = OrchestratorEnv.and(
  z.object({
    DATABASE_URL: z.string().url().startsWith('postgres'),
    REDIS_URL: z.string().url().startsWith('redis'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default('true'),
    COMPILE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    COMPILE_WALL_TIME_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  }),
);
export type WorkerEnv = z.infer<typeof WorkerEnv>;

export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const r = WorkerEnv.safeParse(env);
  if (!r.success) {
    throw new Error(
      `Invalid compile worker configuration:\n  - ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  - ')}`,
    );
  }
  return r.data;
}
