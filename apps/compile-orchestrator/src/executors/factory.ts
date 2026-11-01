import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertSecurityGate, type SandboxExecutor } from '@latex-cloud/compiler-protocol';
import type { OrchestratorEnv } from '../config';
import { DockerExecutor } from './docker';
import { LocalTrustedDevExecutor } from './local-trusted-dev';

export const REPO_LATEXMKRC = resolve(__dirname, '../../../../infra/tex-images/latexmkrc');

/** Resolves a tag to its immutable image id so manifests are content-addressed. */
export function resolveImageDigest(image: string, dockerBin = 'docker'): string {
  if (image.includes('@sha256:')) return image;
  try {
    const id = execFileSync(dockerBin, ['image', 'inspect', '--format', '{{.Id}}', image], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
    return id ? `${image}@${id}` : image;
  } catch {
    throw new Error(`TeX image "${image}" not found. Build it with: pnpm tex-image:build`);
  }
}

/**
 * The only way to obtain an executor. Applies the production security gate
 * (ADR-007) before anything can run.
 */
export function createExecutor(env: OrchestratorEnv): SandboxExecutor {
  let executor: SandboxExecutor;
  if (env.COMPILE_EXECUTOR === 'local-trusted-dev') {
    if (env.ALLOW_TRUSTED_LOCAL_EXECUTOR !== 'true') {
      throw new Error(
        'COMPILE_EXECUTOR=local-trusted-dev runs TeX unsandboxed on this host. ' +
          'Set ALLOW_TRUSTED_LOCAL_EXECUTOR=true to confirm all documents are trusted.',
      );
    }
    executor = new LocalTrustedDevExecutor({
      acknowledgeTrustedInputOnly: true,
      rcFile: REPO_LATEXMKRC,
    });
  } else {
    executor = new DockerExecutor({
      image: resolveImageDigest(env.TEX_IMAGE),
      runtime: env.DOCKER_RUNTIME,
    });
  }

  assertSecurityGate({
    mode: env.NODE_ENV,
    descriptor: executor.descriptor,
    sandboxAttestation: env.COMPILE_SANDBOX_ATTESTATION,
  });

  if (executor.descriptor.trustedInputOnly || executor.descriptor.isolation === 'container') {
    console.warn(
      `\n⚠️  compile executor "${executor.descriptor.kind}" (isolation: ${executor.descriptor.isolation}) ` +
        'is NOT a security boundary for untrusted documents. Local/trusted use only.\n',
    );
  }
  return executor;
}
