import { z } from 'zod';
import { DEV_COLLAB_TOKEN_SECRET } from '@latex-cloud/collab-protocol';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/**
 * Typed, validated process configuration. The API refuses to start with an
 * invalid or incomplete environment rather than failing later at runtime.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().url().startsWith('postgres'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.string().url().startsWith('redis'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default('true'),
    /** Origins allowed to make state-changing requests (CSRF defence). Comma-separated. */
    WEB_ORIGIN: z
      .string()
      .min(1)
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().url()).min(1)),
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(24 * 14),
    COOKIE_SECURE: bool.optional(),
    /** Number of reverse-proxy hops to trust for client IP (express `trust proxy`). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    LOGIN_RATE_LIMIT_PER_15M: z.coerce.number().int().min(1).default(20),
    /** Namespace for rate-limit keys in Redis (lets environments share a Redis). */
    RATE_LIMIT_KEY_PREFIX: z.string().min(1).max(64).default('lc:rl:'),
    /**
     * Shared with the collab server, which verifies the WebSocket tokens the
     * API mints. Unset = real-time collaboration is off and the editor falls
     * back to compare-and-swap autosave.
     */
    COLLAB_TOKEN_SECRET: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(32).optional(),
    ),
    /** Where browsers reach the collab WebSocket: ws(s)://host[:port]/collab or a same-origin path. */
    COLLAB_PUBLIC_URL: z
      .string()
      .regex(/^(wss?:\/\/[^\s]+|\/[^\s]*)$/, 'must be ws(s)://… or an absolute path')
      .default('ws://localhost:4100/collab'),
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    COLLAB_TOKEN_SECRET:
      env.COLLAB_TOKEN_SECRET ??
      (env.NODE_ENV === 'development' ? DEV_COLLAB_TOKEN_SECRET : undefined),
  }))
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.COLLAB_TOKEN_SECRET === DEV_COLLAB_TOKEN_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COLLAB_TOKEN_SECRET'],
        message: 'must not be the development default in production',
      });
    }
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export class ConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    // Report variable names and problems only — never echo values (secrets).
    throw new ConfigValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
