import { z } from 'zod';
import { HISTORY_CHECKPOINT_MS } from '@latex-cloud/shared';
import { DEV_COLLAB_TOKEN_SECRET, MIN_COLLAB_SECRET_LENGTH } from '@latex-cloud/collab-protocol';

const list = z
  .string()
  .min(1)
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().url()).min(1));

export const CollabEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  COLLAB_PORT: z.coerce.number().int().min(0).max(65535).default(4100),
  COLLAB_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().startsWith('postgres'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().url().startsWith('redis'),
  /** Shared with the API, which mints the tokens (dev default when NODE_ENV=development). */
  COLLAB_TOKEN_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(MIN_COLLAB_SECRET_LENGTH).optional(),
  ),
  /** Browser origins allowed to open the WebSocket (same list as the API's WEB_ORIGIN). */
  WEB_ORIGIN: list,
  /** Snapshot + materialise text this long after the last edit… */
  COLLAB_STORE_DEBOUNCE_MS: z.coerce.number().int().min(50).default(2000),
  /** …but at least this often while people keep typing. */
  COLLAB_STORE_MAX_DEBOUNCE_MS: z.coerce.number().int().min(100).default(10_000),
  /** Minimum time between history checkpoints of a file while it is being edited. */
  COLLAB_HISTORY_CHECKPOINT_MS: z.coerce.number().int().min(0).default(HISTORY_CHECKPOINT_MS),
  /** Backstop re-check of every connection's role (events make it immediate). */
  COLLAB_ACCESS_RECHECK_MS: z.coerce.number().int().min(1000).default(60_000),
});
export type CollabConfig = z.infer<typeof CollabEnv> & { COLLAB_TOKEN_SECRET: string };

export function loadCollabConfig(env: NodeJS.ProcessEnv = process.env): CollabConfig {
  const r = CollabEnv.transform((c, ctx) => {
    const secret =
      c.COLLAB_TOKEN_SECRET ?? (c.NODE_ENV === 'development' ? DEV_COLLAB_TOKEN_SECRET : undefined);
    if (!secret) {
      ctx.addIssue({ code: 'custom', path: ['COLLAB_TOKEN_SECRET'], message: 'Required' });
      return z.NEVER;
    }
    if (c.NODE_ENV === 'production' && secret === DEV_COLLAB_TOKEN_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['COLLAB_TOKEN_SECRET'],
        message: 'must not be the development default in production',
      });
      return z.NEVER;
    }
    return { ...c, COLLAB_TOKEN_SECRET: secret };
  }).safeParse(env);
  if (!r.success) {
    // Names and problems only — never echo values (secrets).
    const issues = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid collab configuration:\n  - ${issues.join('\n  - ')}`);
  }
  return r.data;
}
