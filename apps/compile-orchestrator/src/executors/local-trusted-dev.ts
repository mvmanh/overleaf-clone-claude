import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type ArtifactWriter,
  buildLatexmkArgs,
  type EngineRunConfig,
  type ExecutorDescriptor,
  type SandboxExecutor,
  type SandboxLimits,
  type SandboxOutcome,
  type SandboxRunResult,
  BUILD_CACHE_EXTENSIONS,
  packSnapshot,
  type SourceSnapshot,
  TEX_SAFE_ENV,
  validateProjectPath,
} from '@latex-cloud/compiler-protocol';
import { SnapshotRejectedError, verifySnapshot } from '../snapshot';

async function collectCache(out: string): Promise<{ path: string; content: Buffer }[]> {
  const found: { path: string; content: Buffer }[] = [];
  const walk = async (dir: string, rel: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(join(dir, e.name), r);
      else if (e.isFile() && BUILD_CACHE_EXTENSIONS.some((x) => e.name.endsWith(`.${x}`))) {
        found.push({ path: r, content: await readFile(join(dir, e.name)) });
      }
    }
  };
  await walk(out, '');
  return found;
}
import { finalizeRun, rejectedResult } from './result';

export interface LocalTrustedDevExecutorOptions {
  /** Must be literally `true`; the factory only sets it when explicitly configured. */
  acknowledgeTrustedInputOnly: true;
  /** Path to the platform latexmkrc (infra/tex-images/latexmkrc). */
  rcFile: string;
  latexmkBin?: string;
  texImageLabel?: string;
}

/**
 * ⚠️  TRUSTED INPUT ONLY — NOT A SANDBOX. ⚠️
 *
 * Runs latexmk directly on the host as the current user. TeX can read any
 * file that user can read (subject only to kpathsea's openin_any), consume
 * unbounded memory, and so on. It exists for local development and CI fixture
 * runs on machines without Docker. The security gate refuses it in
 * production, and the factory requires an explicit opt-in.
 */
export class LocalTrustedDevExecutor implements SandboxExecutor {
  readonly descriptor: ExecutorDescriptor;

  constructor(private readonly options: LocalTrustedDevExecutorOptions) {
    if (options.acknowledgeTrustedInputOnly !== true) {
      throw new Error('LocalTrustedDevExecutor requires acknowledgeTrustedInputOnly: true');
    }
    this.descriptor = {
      kind: 'local-trusted-dev',
      isolation: 'none',
      trustedInputOnly: true,
      texImage: options.texImageLabel ?? 'host-texlive',
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

    const root = await mkdtemp(join(tmpdir(), 'lc-compile-'));
    const src = join(root, 'src');
    const out = join(root, 'out');
    try {
      await mkdir(src);
      await mkdir(out);
      await mkdir(join(root, 'home'));
      for (const f of engine.cache ?? []) {
        const v = validateProjectPath(f.path);
        if (!v.ok) continue;
        const target = join(out, v.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, f.content, { flag: 'wx' });
      }
      for (const f of snapshot.files) {
        const target = join(src, f.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, f.content, { flag: 'wx' }); // fresh dir: never follows an existing link
      }
      const setupMs = Math.round(performance.now() - startedAt);

      const compileStart = performance.now();
      const { exitCode, forced, message, stdout } = await this.spawnLatexmk(
        engine,
        src,
        out,
        root,
        limits,
        signal,
      );
      const compileMs = Math.round(performance.now() - compileStart);

      const files = new Map<string, Buffer>();
      let total = 0;
      for (const name of await readdir(out)) {
        if (!/\.(pdf|log|synctex\.gz)$/.test(name)) continue;
        const data = await readFile(join(out, name));
        total += data.byteLength;
        files.set(name, data);
      }
      files.set('latexmk.stdout', Buffer.from(stdout));
      const overLimit = total > limits.maxOutputBytes;

      const cacheFiles = await collectCache(out);
      return await finalizeRun({
        files: overLimit ? new Map() : files,
        rootFile: engine.rootFile,
        exitCode,
        forcedOutcome: forced ?? (overLimit ? 'output-limit-exceeded' : undefined),
        message:
          message ?? (overLimit ? `Output exceeded ${limits.maxOutputBytes} bytes.` : undefined),
        timings: { startedAt, setupMs, compileMs },
        writer,
        workspaceRoots: [src, out],
        buildCache: cacheFiles.length ? await packSnapshot(cacheFiles) : undefined,
        usedCache: (engine.cache?.length ?? 0) > 0,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  private spawnLatexmk(
    engine: EngineRunConfig,
    src: string,
    out: string,
    root: string,
    limits: SandboxLimits,
    signal?: AbortSignal,
  ): Promise<{
    exitCode: number | null;
    forced?: SandboxOutcome;
    message?: string;
    stdout: string;
  }> {
    const args = buildLatexmkArgs({
      engine: engine.engine,
      rootFile: engine.rootFile,
      outDir: out,
      rcFile: this.options.rcFile,
    });
    // Minimal environment: nothing from the parent process (no secrets) except PATH.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: join(root, 'home'),
      TEXMFVAR: join(root, 'home', 'texmf-var'),
      TEXMFOUTPUT: out,
      ...TEX_SAFE_ENV,
    };
    return new Promise((resolve) => {
      const child = spawn(this.options.latexmkBin ?? 'latexmk', args, {
        cwd: src,
        env,
        detached: true, // own process group so the whole tree can be killed
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      const append = (c: Buffer) => {
        if (stdout.length < 256 * 1024) stdout += c.toString('utf8');
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);

      let forced: SandboxOutcome | undefined;
      let message: string | undefined;
      const killTree = (outcome: SandboxOutcome, why: string) => {
        if (forced) return;
        forced = outcome;
        message = why;
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already exited */
        }
      };
      const timer = setTimeout(
        () => killTree('timeout', `Compilation exceeded ${limits.wallTimeMs} ms.`),
        limits.wallTimeMs,
      );
      const onAbort = () => killTree('cancelled', 'Compilation was cancelled.');
      signal?.addEventListener('abort', onAbort, { once: true });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: null,
          forced: 'sandbox-error',
          message: `could not start latexmk: ${err.message}`,
          stdout,
        });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({
          exitCode: code,
          ...(forced ? { forced } : {}),
          ...(message ? { message } : {}),
          stdout,
        });
      });
    });
  }
}
