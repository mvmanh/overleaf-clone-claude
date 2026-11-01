import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  type ArtifactWriter,
  buildLatexmkArgs,
  type EngineRunConfig,
  type ExecutorDescriptor,
  type SandboxExecutor,
  type SandboxLimits,
  type SandboxOutcome,
  type SandboxRunResult,
  RESERVED_TOP_LEVEL,
  type SourceSnapshot,
  TEX_SAFE_ENV,
} from '@latex-cloud/compiler-protocol';
import { SnapshotRejectedError, verifySnapshot } from '../snapshot';
import { packSnapshot, unpackArtifacts } from '@latex-cloud/compiler-protocol';
import { finalizeRun, rejectedResult } from './result';

/** Paths inside the TeX image (see infra/tex-images/Dockerfile). */
export const SANDBOX_UID = 10001;
export const SANDBOX_SRC = '/work/src';
export const SANDBOX_OUT = '/work/out';
export const SANDBOX_RC = '/etc/latex-cloud/latexmkrc';

export interface DockerExecutorOptions {
  /** Local image reference to run, ideally the image ID (`sha256:…`). Never pulled. */
  image: string;
  /** Identity recorded in manifests (defaults to `image`). */
  texImageLabel?: string;
  /** `runsc` selects gVisor. Anything else is plain container isolation. */
  runtime?: 'runc' | 'runsc' | undefined;
  dockerBin?: string;
}

/**
 * Pure: the complete `docker run` argument vector. Kept separate so the
 * hardening flags are unit-tested and reviewable in one place.
 */
export function buildDockerRunArgs(opts: {
  name: string;
  image: string;
  runtime?: string | undefined;
  limits: SandboxLimits;
  rootFile: string;
  latexmkArgs: string[];
  /** Test-only: override the image entrypoint to probe the sandbox itself. */
  entrypoint?: string;
}): string[] {
  const { limits } = opts;
  const scratchMb = Math.max(16, Math.floor(limits.scratchBytes / (1024 * 1024)));
  const args = [
    'run',
    '--rm',
    '-i',
    // Only ever run the locally built, pinned image; never reach a registry.
    '--pull=never',
    `--name=${opts.name}`,
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--user=${SANDBOX_UID}:${SANDBOX_UID}`,
    '--ipc=none',
    `--pids-limit=${limits.pids}`,
    `--memory=${limits.memoryBytes}`,
    `--memory-swap=${limits.memoryBytes}`,
    `--cpus=${limits.cpus}`,
    '--ulimit=nofile=1024:1024',
    '--ulimit=core=0:0',
    `--tmpfs=/work:rw,nosuid,nodev,noexec,size=${scratchMb}m,uid=${SANDBOX_UID},gid=${SANDBOX_UID},mode=0700`,
    `--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777`,
    '--log-driver=none',
    '--label=latex-cloud.role=compile-sandbox',
  ];
  if (opts.runtime && opts.runtime !== 'runc') args.push(`--runtime=${opts.runtime}`);
  if (opts.entrypoint) args.push(`--entrypoint=${opts.entrypoint}`);
  for (const [k, v] of Object.entries(TEX_SAFE_ENV)) args.push('-e', `${k}=${v}`);
  args.push('-e', `TEXMFOUTPUT=${SANDBOX_OUT}`);
  args.push(opts.image, opts.rootFile, ...opts.latexmkArgs);
  return args;
}

/**
 * Runs each compile in a fresh, network-less, read-only, unprivileged
 * container. Source goes in as a tar on stdin and artifacts come back as a tar
 * on stdout, so the container has no host bind mounts at all.
 *
 * With `runtime: 'runc'` this is DEFENCE IN DEPTH ONLY — a shared host kernel
 * is not a sufficient boundary for untrusted multi-tenant input (see
 * docs/security/compile-sandbox.md). The security gate refuses it in production.
 */
export class DockerExecutor implements SandboxExecutor {
  readonly descriptor: ExecutorDescriptor;
  private readonly dockerBin: string;

  constructor(private readonly options: DockerExecutorOptions) {
    this.dockerBin = options.dockerBin ?? 'docker';
    this.descriptor = {
      kind: options.runtime === 'runsc' ? 'docker+runsc' : 'docker',
      isolation: options.runtime === 'runsc' ? 'gvisor' : 'container',
      trustedInputOnly: false,
      texImage: options.texImageLabel ?? options.image,
    };
  }

  async run(
    snapshot: SourceSnapshot,
    engine: EngineRunConfig,
    limits: SandboxLimits,
    writer: ArtifactWriter,
    signal?: AbortSignal,
  ): Promise<SandboxRunResult> {
    const startedAt = performance.now();
    try {
      verifySnapshot(snapshot, limits);
    } catch (err) {
      if (err instanceof SnapshotRejectedError) return rejectedResult(err.message, startedAt);
      throw err;
    }

    // Cache entries ride along under a reserved prefix that project paths can
    // never use (validateProjectPath rejects it); lc-compile moves them to /work/out.
    const cache = engine.cache ?? [];
    const input = await packSnapshot([
      ...snapshot.files,
      ...cache.map((f) => ({ path: `${RESERVED_TOP_LEVEL}/${f.path}`, content: f.content })),
    ]);
    const name = `lc-compile-${randomUUID()}`;
    const args = buildDockerRunArgs({
      name,
      image: this.options.image,
      runtime: this.options.runtime,
      limits,
      rootFile: engine.rootFile,
      latexmkArgs: buildLatexmkArgs({
        engine: engine.engine,
        rootFile: engine.rootFile,
        outDir: SANDBOX_OUT,
        rcFile: SANDBOX_RC,
      }),
    });

    const spawnedAtEpoch = Date.now();
    const child = spawn(this.dockerBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let forced: SandboxOutcome | undefined;
    let message: string | undefined;

    const kill = (outcome: SandboxOutcome, why: string) => {
      if (forced) return;
      forced = outcome;
      message = why;
      // Kill by name: the docker CLI exiting does not guarantee the container stops.
      spawn(this.dockerBin, ['kill', name], { stdio: 'ignore' }).on('error', () => undefined);
      child.kill('SIGKILL');
    };

    const timer = setTimeout(
      () => kill('timeout', `Compilation exceeded ${limits.wallTimeMs} ms.`),
      limits.wallTimeMs,
    );
    const onAbort = () => kill('cancelled', 'Compilation was cancelled.');
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (c: Buffer) => {
      stdoutBytes += c.byteLength;
      if (stdoutBytes > limits.maxOutputBytes) {
        kill('output-limit-exceeded', `Output exceeded ${limits.maxOutputBytes} bytes.`);
        return;
      }
      stdout.push(c);
    });
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += c.toString('utf8');
    });
    child.stdin.on('error', () => undefined); // container may exit before reading all input
    child.stdin.end(input);

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('error', (err) => {
        stderr += String(err);
        resolve(null);
      });
      child.on('close', (code) => resolve(code));
    });
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);

    let files = new Map<string, Buffer>();
    if (!forced) {
      try {
        files = await unpackArtifacts(Buffer.concat(stdout));
      } catch {
        forced = 'sandbox-error';
        message = 'Sandbox produced unreadable output.';
      }
    }
    if (!forced && !files.has('exit-status')) {
      forced = 'sandbox-error';
      message =
        `Sandbox failed to start or crashed (docker exit ${exitCode}). ${stderr.trim().split('\n').slice(-3).join(' ')}`.trim();
    }

    const latexmkExit = files.has('exit-status')
      ? Number(files.get('exit-status')!.toString().trim())
      : exitCode;
    const t = parseTimings(files.get('timings')?.toString());
    return finalizeRun({
      files,
      rootFile: engine.rootFile,
      exitCode: Number.isFinite(latexmkExit) ? latexmkExit : null,
      forcedOutcome: forced,
      message,
      timings: {
        startedAt,
        setupMs: t ? Math.max(0, t.compileStart - spawnedAtEpoch) : 0,
        compileMs: t ? Math.max(0, t.compileEnd - t.compileStart) : 0,
      },
      writer,
      workspaceRoots: [SANDBOX_SRC, SANDBOX_OUT],
      buildCache: files.get('build-cache.tar'),
      usedCache: cache.length > 0,
    });
  }
}

function parseTimings(
  raw: string | undefined,
): { compileStart: number; compileEnd: number } | undefined {
  if (!raw) return undefined;
  const [start, end] = raw.trim().split(/\s+/).map(Number);
  if (!start || !end || !Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return { compileStart: start, compileEnd: end };
}
