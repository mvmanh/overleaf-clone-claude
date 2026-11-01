import { z } from 'zod';

export const LivenessResponse = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});
export type LivenessResponse = z.infer<typeof LivenessResponse>;

export const DependencyStatus = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});
export type DependencyStatus = z.infer<typeof DependencyStatus>;

export const ReadinessResponse = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.object({
    database: DependencyStatus,
    migrations: DependencyStatus,
    redis: DependencyStatus,
    objectStorage: DependencyStatus,
  }),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;
