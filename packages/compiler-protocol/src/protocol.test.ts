import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  buildLatexmkArgs,
  canTransition,
  computeFingerprint,
  evaluateSecurityGate,
  type ExecutorDescriptor,
  isTerminal,
  type RevisionManifest,
  RevisionManifest as RevisionManifestSchema,
  sha256Hex,
  validateProjectPath,
} from './index';

describe('validateProjectPath', () => {
  it.each(['main.tex', 'chapters/intro.tex', 'figures/plot-1.pdf', 'refs.bib', 'Ünïcode/ß.tex'])(
    'accepts %s',
    (p) => {
      expect(validateProjectPath(p)).toEqual({ ok: true, path: p.normalize('NFC') });
    },
  );

  it.each([
    ['', 'empty'],
    ['/etc/passwd', 'absolute'],
    ['../secret', 'parent'],
    ['a/../../b', 'nested parent'],
    ['a//b', 'empty segment'],
    ['./main.tex', 'dot segment'],
    ['a\\b.tex', 'backslash'],
    ['C:/x.tex', 'drive letter'],
    ['a\u0000b', 'nul'],
    ['-shell-escape.tex', 'option-like'],
    ['latexmkrc', 'latexmkrc'],
    ['sub/.latexmkrc', 'hidden latexmkrc'],
    ['texmf.cnf', 'texmf.cnf'],
    ['aux.tex', 'windows reserved'],
    ['x'.repeat(600), 'too long'],
  ])('rejects %j (%s)', (p) => {
    expect(validateProjectPath(p).ok).toBe(false);
  });
});

const baseManifest = (): RevisionManifest => ({
  schemaVersion: 1,
  rootFile: 'main.tex',
  engine: 'pdflatex',
  texImage: 'latex-cloud/texlive@sha256:' + 'a'.repeat(64),
  options: { synctex: true },
  files: [
    { path: 'main.tex', sha256: sha256Hex('hello'), sizeBytes: 5 },
    { path: 'refs.bib', sha256: sha256Hex('bib'), sizeBytes: 3 },
  ],
});

describe('computeFingerprint', () => {
  it('is independent of file order', () => {
    const a = baseManifest();
    const b = { ...a, files: [...a.files].reverse() };
    expect(computeFingerprint(a)).toBe(computeFingerprint(b));
  });

  it.each<[string, (m: RevisionManifest) => RevisionManifest]>([
    [
      'content',
      (m) => ({ ...m, files: [{ ...m.files[0]!, sha256: sha256Hex('x') }, m.files[1]!] }),
    ],
    ['engine', (m) => ({ ...m, engine: 'xelatex' })],
    ['image', (m) => ({ ...m, texImage: m.texImage.replace(/a$/, 'b') })],
    ['root', (m) => ({ ...m, rootFile: 'refs.bib' })],
    ['options', (m) => ({ ...m, options: { synctex: false } })],
  ])('changes when %s changes', (_, mutate) => {
    const base = baseManifest();
    expect(computeFingerprint(mutate(base))).not.toBe(computeFingerprint(base));
  });

  it('rejects manifests whose root file is missing or paths are unsafe', () => {
    expect(
      RevisionManifestSchema.safeParse({ ...baseManifest(), rootFile: 'nope.tex' }).success,
    ).toBe(false);
    const bad = baseManifest();
    bad.files.push({ path: '../x.tex', sha256: sha256Hex('x'), sizeBytes: 1 });
    expect(RevisionManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects case-insensitive duplicate paths', () => {
    const dup = baseManifest();
    dup.files.push({ path: 'MAIN.tex', sha256: sha256Hex('x'), sizeBytes: 1 });
    expect(RevisionManifestSchema.safeParse(dup).success).toBe(false);
  });
});

describe('compile job state machine', () => {
  it('allows the happy path', () => {
    expect(() => {
      assertTransition('queued', 'preparing');
      assertTransition('preparing', 'running');
      assertTransition('running', 'publishing');
      assertTransition('publishing', 'succeeded');
    }).not.toThrow();
  });

  it('never leaves a terminal state', () => {
    for (const terminal of ['succeeded', 'failed', 'cancelled', 'superseded'] as const) {
      expect(isTerminal(terminal)).toBe(true);
      expect(canTransition(terminal, 'queued')).toBe(false);
      expect(canTransition(terminal, 'running')).toBe(false);
    }
  });

  it('rejects skipping straight to succeeded', () => {
    expect(() => assertTransition('queued', 'succeeded')).toThrow(/queued -> succeeded/);
  });
});

describe('buildLatexmkArgs', () => {
  it('always disables rc files and shell escape, with the root file last', () => {
    const args = buildLatexmkArgs({
      engine: 'xelatex',
      rootFile: 'main.tex',
      outDir: '/o',
      rcFile: '/rc',
    });
    expect(args[0]).toBe('-norc');
    expect(args).toContain('-no-shell-escape');
    expect(args).toContain('-xelatex');
    expect(args).not.toContain('-shell-escape');
    expect(args.at(-1)).toBe('main.tex');
  });

  it('refuses root files that could be parsed as options', () => {
    expect(() =>
      buildLatexmkArgs({
        engine: 'pdflatex',
        rootFile: '-shell-escape',
        outDir: '/o',
        rcFile: '/rc',
      }),
    ).toThrow();
  });
});

describe('evaluateSecurityGate', () => {
  const d = (over: Partial<ExecutorDescriptor>): ExecutorDescriptor => ({
    kind: 'x',
    isolation: 'gvisor',
    trustedInputOnly: false,
    texImage: 'img',
    ...over,
  });

  it('permits any executor outside production', () => {
    expect(
      evaluateSecurityGate({
        mode: 'development',
        descriptor: d({ isolation: 'none', trustedInputOnly: true }),
      }).allowed,
    ).toBe(true);
  });

  it('refuses trusted-only executors in production even with an attestation', () => {
    const r = evaluateSecurityGate({
      mode: 'production',
      descriptor: d({ isolation: 'none', trustedInputOnly: true }),
      sandboxAttestation: 'SEC-1',
    });
    expect(r.allowed).toBe(false);
  });

  it('refuses plain container isolation in production', () => {
    const r = evaluateSecurityGate({
      mode: 'production',
      descriptor: d({ isolation: 'container' }),
      sandboxAttestation: 'SEC-1',
    });
    expect(r).toMatchObject({ allowed: false, reason: expect.stringMatching(/gvisor or microvm/) });
  });

  it('requires an attestation for strong isolation in production', () => {
    expect(evaluateSecurityGate({ mode: 'production', descriptor: d({}) }).allowed).toBe(false);
    expect(
      evaluateSecurityGate({ mode: 'production', descriptor: d({}), sandboxAttestation: '  ' })
        .allowed,
    ).toBe(false);
    expect(
      evaluateSecurityGate({
        mode: 'production',
        descriptor: d({}),
        sandboxAttestation: 'SEC-2026-11 review',
      }).allowed,
    ).toBe(true);
  });
});
