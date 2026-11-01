import { describe, expect, it } from 'vitest';
import { pack } from 'tar-stream';

type TestHeader = { name: string; type?: 'symlink'; linkname?: string };
import { packSnapshot, unpackArtifacts, unpackSnapshot } from './archive';

describe('unpackSnapshot', () => {
  const limits = { maxFiles: 10, maxTotalBytes: 1000 };

  it('round-trips nested project paths', async () => {
    const tar = await packSnapshot([
      { path: 'main.tex', content: Buffer.from('a') },
      { path: 'chapters/one.tex', content: Buffer.from('b') },
    ]);
    const files = await unpackSnapshot(tar, limits);
    expect(files.map((f) => [f.path, Buffer.from(f.content).toString()])).toEqual([
      ['main.tex', 'a'],
      ['chapters/one.tex', 'b'],
    ]);
  });

  it.each<[string, TestHeader]>([
    ['traversal', { name: '../x.tex' }],
    ['absolute', { name: '/etc/passwd' }],
    ['symlink', { name: 'l.tex', type: 'symlink', linkname: '/etc/passwd' }],
    ['latexmkrc', { name: 'latexmkrc' }],
    ['reserved cache prefix', { name: '__lc_cache__/main.aux' }],
  ])('rejects %s entries', async (_, header) => {
    const p = pack();
    const h = header as Parameters<typeof p.entry>[0];
    if (header.type === 'symlink') p.entry(h);
    else p.entry(h, 'x');
    p.finalize();
    const chunks: Buffer[] = [];
    for await (const c of p) chunks.push(c as Buffer);
    await expect(unpackSnapshot(Buffer.concat(chunks), limits)).rejects.toThrow();
  });

  it('enforces size and count limits', async () => {
    const big = await packSnapshot([{ path: 'a.tex', content: Buffer.alloc(2000) }]);
    await expect(unpackSnapshot(big, limits)).rejects.toThrow(/size limit/);
    const many = await packSnapshot(
      Array.from({ length: 11 }, (_, i) => ({ path: `f${i}.tex`, content: Buffer.from('x') })),
    );
    await expect(unpackSnapshot(many, limits)).rejects.toThrow(/too many/);
  });
});

describe('tar helpers', () => {
  it('round-trips flat files', async () => {
    const tar = await packSnapshot([
      { path: 'main.pdf', content: Buffer.from('%PDF-1.5') },
      { path: 'main.log', content: Buffer.from('log') },
    ]);
    const files = await unpackArtifacts(tar);
    expect(files.get('main.pdf')?.toString()).toBe('%PDF-1.5');
    expect(files.get('main.log')?.toString()).toBe('log');
  });

  it('ignores links, nested paths and traversal names from untrusted output', async () => {
    const p = pack();
    p.entry({ name: '../escape.pdf' }, 'x');
    p.entry({ name: 'dir/nested.pdf' }, 'x');
    p.entry({ name: 'link.pdf', type: 'symlink', linkname: '/etc/passwd' });
    p.entry({ name: 'ok.log' }, 'fine');
    p.finalize();
    const chunks: Buffer[] = [];
    for await (const c of p) chunks.push(c as Buffer);
    const files = await unpackArtifacts(Buffer.concat(chunks));
    expect([...files.keys()]).toEqual(['ok.log']);
  });
});
