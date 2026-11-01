import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertSecurityGate, type SandboxExecutor } from '@latex-cloud/compiler-protocol';
import type { OrchestratorEnv } from '../config';
import { DockerExecutor } from './docker';
import { LocalTrustedDevExecutor } from './local-trusted-dev';

export const REPO_LATEXMKRC = resolve(__dirname, '../../../../infra/tex-images/latexmkrc');

export interface ResolvedImage {
  /** What `docker run` receives: the local image ID (`sha256:…`), never pulled. */
  runRef: string;
  /** Human-readable, content-addressed identity recorded in revision manifests. */
  label: string;
}

/**
 * Pins a tag to the image that is present locally right now.
 *
 * `docker run` gets the bare image ID: `repo:tag@sha256:<id>` only resolves
 * when the ID happens to equal a registry digest (true with the containerd
 * image store, false with the classic store), and otherwise makes Docker try
 * to *pull* — which fails for locally built images and must never happen at
 * compile time anyway.
 */
export function resolveImage(image: string, dockerBin = 'docker'): ResolvedImage {
  let id: string;
  try {
    id = execFileSync(dockerBin, ['image', 'inspect', '--format', '{{.Id}}', image], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
  } catch {
    throw new Error(`TeX image "${image}" not found locally. Build it with: pnpm tex-image:build`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(id))
    throw new Error(`unexpected image id for "${image}": ${id}`);
  const name = image.split('@')[0]!;
  return { runRef: id, label: `${name}@${id}` };
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
    assertSecurityGate({
      mode: env.NODE_ENV,
      descriptor: executor.descriptor,
      sandboxAttestation: env.COMPILE_SANDBOX_ATTESTATION,
    });
  } else {
    // Gate first (from configuration alone), then touch Docker.
    assertSecurityGate({
      mode: env.NODE_ENV,
      descriptor: new DockerExecutor({ image: env.TEX_IMAGE, runtime: env.DOCKER_RUNTIME })
        .descriptor,
      sandboxAttestation: env.COMPILE_SANDBOX_ATTESTATION,
    });
    const resolved = resolveImage(env.TEX_IMAGE);
    executor = new DockerExecutor({
      image: resolved.runRef,
      texImageLabel: resolved.label,
      runtime: env.DOCKER_RUNTIME,
    });
  }

  if (executor.descriptor.trustedInputOnly || executor.descriptor.isolation === 'container') {
    console.warn(
      `\n⚠️  compile executor "${executor.descriptor.kind}" (isolation: ${executor.descriptor.isolation}) ` +
        'is NOT a security boundary for untrusted documents. Local/trusted use only.\n',
    );
  }
  return executor;
}
