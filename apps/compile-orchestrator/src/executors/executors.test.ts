import { DEFAULT_SANDBOX_LIMITS, SecurityGateError } from '@latex-cloud/compiler-protocol';
import { describe, expect, it } from 'vitest';
import { loadOrchestratorEnv } from '../config';
import { createSnapshot, verifySnapshot } from '../snapshot';
import { buildDockerRunArgs, DockerExecutor } from './docker';
import { createExecutor } from './factory';
import { LocalTrustedDevExecutor } from './local-trusted-dev';
import { jobBaseName } from './result';

describe('buildDockerRunArgs', () => {
  const args = buildDockerRunArgs({
    name: 'lc-compile-x',
    image: 'img@sha256:abc',
    limits: DEFAULT_SANDBOX_LIMITS,
    rootFile: 'main.tex',
    latexmkArgs: ['-norc', '-pdf', 'main.tex'],
  });

  it.each([
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=10001:10001',
    '--ipc=none',
    '--rm',
    '--log-driver=none',
  ])('includes %s', (flag) => {
    expect(args).toContain(flag);
  });

  it('applies resource limits', () => {
    expect(args).toContain(`--pids-limit=${DEFAULT_SANDBOX_LIMITS.pids}`);
    expect(args).toContain(`--memory=${DEFAULT_SANDBOX_LIMITS.memoryBytes}`);
    expect(args).toContain(`--memory-swap=${DEFAULT_SANDBOX_LIMITS.memoryBytes}`);
    expect(
      args.some(
        (a) => a.startsWith('--tmpfs=/work:') && a.includes('size=512m') && a.includes('noexec'),
      ),
    ).toBe(true);
  });

  it('never mounts host paths or the docker socket, and never runs privileged', () => {
    const joined = args.join(' ');
    expect(joined).not.toMatch(/(^| )(-v|--volume|--mount)[ =]/);
    expect(joined).not.toMatch(/docker\.sock|--privileged|--cap-add|seccomp=unconfined/);
  });

  it('disables shell escape via the environment as well as latexmk flags', () => {
    expect(args).toContain('shell_escape=f');
    expect(args).toContain('openout_any=p');
  });

  it('adds the gVisor runtime only when requested', () => {
    expect(args.some((a) => a.startsWith('--runtime'))).toBe(false);
    const g = buildDockerRunArgs({
      name: 'n',
      image: 'i',
      runtime: 'runsc',
      limits: DEFAULT_SANDBOX_LIMITS,
      rootFile: 'm.tex',
      latexmkArgs: [],
    });
    expect(g).toContain('--runtime=runsc');
  });

  it('places image and arguments last', () => {
    expect(args.slice(-5)).toEqual(['img@sha256:abc', 'main.tex', '-norc', '-pdf', 'main.tex']);
  });
});

describe('executor descriptors', () => {
  it('docker without gVisor is container isolation', () => {
    expect(new DockerExecutor({ image: 'i' }).descriptor).toMatchObject({
      isolation: 'container',
      trustedInputOnly: false,
    });
    expect(new DockerExecutor({ image: 'i', runtime: 'runsc' }).descriptor.isolation).toBe(
      'gvisor',
    );
  });

  it('local executor is trusted-only and requires explicit acknowledgement', () => {
    expect(
      new LocalTrustedDevExecutor({ acknowledgeTrustedInputOnly: true, rcFile: 'x' }).descriptor,
    ).toMatchObject({
      isolation: 'none',
      trustedInputOnly: true,
    });
    expect(
      () =>
        new LocalTrustedDevExecutor({
          acknowledgeTrustedInputOnly: false as unknown as true,
          rcFile: 'x',
        }),
    ).toThrow();
  });
});

describe('createExecutor', () => {
  it('requires explicit opt-in for the local trusted executor', () => {
    expect(() =>
      createExecutor(loadOrchestratorEnv({ COMPILE_EXECUTOR: 'local-trusted-dev' })),
    ).toThrow(/ALLOW_TRUSTED_LOCAL_EXECUTOR/);
  });

  it('refuses the local executor in production even when opted in', () => {
    expect(() =>
      createExecutor(
        loadOrchestratorEnv({
          NODE_ENV: 'production',
          COMPILE_EXECUTOR: 'local-trusted-dev',
          ALLOW_TRUSTED_LOCAL_EXECUTOR: 'true',
          COMPILE_SANDBOX_ATTESTATION: 'SEC-1',
        }),
      ),
    ).toThrow(SecurityGateError);
  });

  it('refuses plain docker in production', () => {
    expect(() =>
      createExecutor(
        loadOrchestratorEnv({
          NODE_ENV: 'production',
          TEX_IMAGE: 'img@sha256:' + 'a'.repeat(64),
          COMPILE_SANDBOX_ATTESTATION: 'SEC-1',
        }),
      ),
    ).toThrow(/gvisor or microvm/);
  });
});

describe('snapshots', () => {
  const files = [
    { path: 'main.tex', content: Buffer.from('\\documentclass{article}') },
    { path: 'img/a.png', content: Buffer.from([1, 2, 3]) },
  ];

  it('rejects unsafe paths at creation', () => {
    expect(() =>
      createSnapshot({
        files: [{ path: '../x.tex', content: Buffer.from('') }],
        rootFile: 'main.tex',
        engine: 'pdflatex',
        texImage: 'i',
      }),
    ).toThrow(/invalid path/);
    expect(() =>
      createSnapshot({
        files: [{ path: 'latexmkrc', content: Buffer.from('system("id")') }, ...files],
        rootFile: 'main.tex',
        engine: 'pdflatex',
        texImage: 'i',
      }),
    ).toThrow(/build configuration/);
  });

  it('detects content mutated after capture', () => {
    const snap = createSnapshot({
      files: files.map((f) => ({ ...f, content: Buffer.from(f.content) })),
      rootFile: 'main.tex',
      engine: 'pdflatex',
      texImage: 'i',
    });
    expect(() => verifySnapshot(snap, DEFAULT_SANDBOX_LIMITS)).not.toThrow();
    (snap.files[0]!.content as Buffer)[0] = 0x41;
    expect(() => verifySnapshot(snap, DEFAULT_SANDBOX_LIMITS)).toThrow(/hash mismatch/);
  });

  it('enforces per-file size limits', () => {
    const snap = createSnapshot({ files, rootFile: 'main.tex', engine: 'pdflatex', texImage: 'i' });
    expect(() => verifySnapshot(snap, { ...DEFAULT_SANDBOX_LIMITS, maxInputFileBytes: 4 })).toThrow(
      /too large/,
    );
  });
});

describe('jobBaseName', () => {
  it('derives artifact base names', () => {
    expect(jobBaseName('chapters/thesis.tex')).toBe('thesis');
    expect(jobBaseName('main.ltx')).toBe('main');
  });
});
