import { describe, expect, it } from 'vitest';
import { classifyFile } from './file-types';
import { detectEngine, detectRootFile, readProjectZip, ZipRejectedError } from './zip-import';
import { makeZip, PNG_1PX } from '../../test/zip-utils';

const limits = {
  maxEntries: 50,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxRatio: 100,
};
const doc = Buffer.from('\\documentclass{article}\\begin{document}x\\end{document}');

describe('readProjectZip', () => {
  it('imports supported files, strips a single top-level folder and drops platform junk', async () => {
    const zip = makeZip([
      { name: 'paper-main/main.tex', data: doc },
      { name: 'paper-main/figs/plot.png', data: PNG_1PX, deflate: true },
      { name: 'paper-main/refs.bib', data: Buffer.from('@book{x,}') },
      { name: '__MACOSX/paper-main/._main.tex', data: Buffer.from('junk') },
      { name: 'paper-main/.DS_Store', data: Buffer.from('junk') },
    ]);
    const r = await readProjectZip(zip, limits);
    expect(r.files.map((f) => f.path).sort()).toEqual(['figs/plot.png', 'main.tex', 'refs.bib']);
    expect(r.files.find((f) => f.path === 'figs/plot.png')!.content.equals(PNG_1PX)).toBe(true);
    expect(r.skipped).toEqual([]);
  });

  it('skips and reports unsupported files, build outputs, symlinks and unsafe names', async () => {
    const zip = makeZip([
      { name: 'main.tex', data: doc },
      { name: 'build.sh', data: Buffer.from('rm -rf /') },
      { name: 'main.aux', data: Buffer.from('\\relax') },
      { name: 'link.tex', data: Buffer.from('/etc/passwd'), mode: 0o120777 },
      { name: 'latexmkrc', data: Buffer.from('system("id")') },
      { name: 'sub/-opt.tex', data: Buffer.from('x') },
    ]);
    const r = await readProjectZip(zip, limits);
    expect(r.files.map((f) => f.path)).toEqual(['main.tex']);
    expect(r.skipped.map((s) => s.path).sort()).toEqual([
      'build.sh',
      'latexmkrc',
      'link.tex',
      'main.aux',
      'sub/-opt.tex',
    ]);
  });

  it.each([
    ['parent traversal', '../../etc/cron.d/evil.tex'],
    ['nested traversal', 'a/../../evil.tex'],
    ['absolute path', '/etc/passwd.tex'],
    ['windows drive', 'C:/evil.tex'],
  ])('rejects the whole archive for %s', async (_, name) => {
    await expect(readProjectZip(makeZip([{ name, data: doc }]), limits)).rejects.toBeInstanceOf(
      ZipRejectedError,
    );
  });

  it('rejects decompression bombs before inflating', async () => {
    const zip = makeZip([
      { name: 'bomb.tex', data: Buffer.alloc(4 * 1024 * 1024, 0x20), deflate: true },
    ]);
    await expect(readProjectZip(zip, limits)).rejects.toThrow(/decompression bomb/);
  });

  it('rejects oversize files, oversize totals and too many entries', async () => {
    await expect(
      readProjectZip(
        makeZip([{ name: 'big.tex', data: Buffer.alloc(6 * 1024 * 1024, 0x61) }]),
        limits,
      ),
    ).rejects.toThrow(/larger than/);
    const many = Array.from({ length: 51 }, (_, i) => ({
      name: `f${i}.tex`,
      data: Buffer.from('x'),
    }));
    await expect(readProjectZip(makeZip(many), limits)).rejects.toThrow(/entries/);
    const total = Array.from({ length: 3 }, (_, i) => ({
      name: `f${i}.tex`,
      data: Buffer.alloc(4 * 1024 * 1024, 0x61),
    }));
    await expect(readProjectZip(makeZip(total), limits)).rejects.toThrow(/expands/);
  });

  it('rejects case-insensitive duplicates and garbage input', async () => {
    await expect(
      readProjectZip(
        makeZip([
          { name: 'Main.tex', data: doc },
          { name: 'main.tex', data: doc },
        ]),
        limits,
      ),
    ).rejects.toThrow(/two files/);
    await expect(readProjectZip(Buffer.from('not a zip at all'), limits)).rejects.toThrow(
      /not a valid ZIP/,
    );
  });
});

describe('detectRootFile / detectEngine', () => {
  const f = (path: string, content: string) => ({ path, content: Buffer.from(content) });

  it('prefers main.tex, else the shallowest document', () => {
    expect(detectRootFile([f('chapters/a.tex', 'x'), f('main.tex', '\\documentclass{book}')])).toBe(
      'main.tex',
    );
    expect(
      detectRootFile([
        f('chapters/a.tex', 'x'),
        f('src/thesis.tex', '\\documentclass{report}'),
        f('z.tex', '\\documentclass{article}'),
      ]),
    ).toBe('z.tex');
    expect(detectRootFile([f('a.tex', '% \\documentclass{article}\nhello')])).toBeNull();
  });

  it('detects the engine from packages, ignoring comments', () => {
    expect(detectEngine('\\usepackage{fontspec}')).toBe('xelatex');
    expect(detectEngine('\\usepackage[math-style=ISO]{unicode-math}')).toBe('xelatex');
    expect(detectEngine('\\directlua{tex.print(1)}')).toBe('lualatex');
    expect(detectEngine('% \\usepackage{fontspec}\n\\usepackage{amsmath}')).toBe('pdflatex');
    expect(detectEngine(null)).toBe('pdflatex');
  });
});

describe('classifyFile', () => {
  it('accepts valid UTF-8 text and strips a BOM', () => {
    expect(classifyFile('a.tex', Buffer.from('\uFEFFhé'))).toEqual({
      ok: true,
      kind: 'text',
      text: 'hé',
    });
    expect(classifyFile('a.tex', Buffer.from([0xff, 0xfe, 0x00]))).toMatchObject({ ok: false });
  });

  it('requires binary content to match its extension', () => {
    expect(classifyFile('p.png', PNG_1PX)).toEqual({ ok: true, kind: 'binary' });
    expect(classifyFile('p.png', Buffer.from('#!/bin/sh\nrm -rf /'))).toMatchObject({ ok: false });
    expect(classifyFile('d.pdf', Buffer.from('%PDF-1.7\n...'))).toEqual({
      ok: true,
      kind: 'binary',
    });
    expect(classifyFile('d.pdf', Buffer.from('<html><script>'))).toMatchObject({ ok: false });
    expect(classifyFile('x.exe', Buffer.from('MZ'))).toMatchObject({ ok: false });
  });
});
