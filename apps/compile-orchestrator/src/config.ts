import { z } from 'zod';

export const OrchestratorEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * `docker` (default): per-job container via the Docker CLI.
   * `local-trusted-dev`: host latexmk, trusted documents only; also requires
   * ALLOW_TRUSTED_LOCAL_EXECUTOR=true.
   */
  COMPILE_EXECUTOR: z.enum(['docker', 'local-trusted-dev']).default('docker'),
  ALLOW_TRUSTED_LOCAL_EXECUTOR: z.enum(['true', 'false']).default('false'),
  TEX_IMAGE: z.string().min(1).default('latex-cloud/texlive:dev'),
  /** `runsc` enables gVisor when installed on the Docker host. */
  DOCKER_RUNTIME: z.enum(['runc', 'runsc']).default('runc'),
  /** Reference to an independent sandbox security review. Required in production. */
  COMPILE_SANDBOX_ATTESTATION: z.string().optional(),
});
export type OrchestratorEnv = z.infer<typeof OrchestratorEnv>;

export function loadOrchestratorEnv(env: NodeJS.ProcessEnv = process.env): OrchestratorEnv {
  const r = OrchestratorEnv.safeParse(env);
  if (!r.success) {
    throw new Error(
      `Invalid compile-orchestrator configuration:\n  - ${r.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('\n  - ')}`,
    );
  }
  return r.data;
}
