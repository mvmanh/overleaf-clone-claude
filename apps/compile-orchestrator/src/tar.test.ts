import { describe, expect, it } from 'vitest';
import { pack } from 'tar-stream';
import { packSnapshot, unpackArtifacts } from './tar';

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
