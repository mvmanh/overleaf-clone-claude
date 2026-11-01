import { extract, pack } from 'tar-stream';
import type { SnapshotFile } from '@latex-cloud/compiler-protocol';

const FIXED_MTIME = new Date(0);

/** Packs snapshot files as a tar of regular files only (no links, no devices). */
export async function packSnapshot(files: readonly SnapshotFile[]): Promise<Buffer> {
  const p = pack();
  const chunks: Buffer[] = [];
  p.on('data', (c: unknown) => {
    chunks.push(c as Buffer);
  });
  const done = new Promise<void>((resolve, reject) => {
    p.on('end', resolve);
    p.on('error', reject);
  });
  for (const f of files) {
    await new Promise<void>((resolve, reject) => {
      p.entry(
        {
          name: f.path,
          type: 'file',
          mode: 0o644,
          uid: 0,
          gid: 0,
          mtime: FIXED_MTIME,
          size: f.content.byteLength,
        },
        Buffer.from(f.content.buffer, f.content.byteOffset, f.content.byteLength),
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }
  p.finalize();
  await done;
  return Buffer.concat(chunks);
}

/**
 * Extracts regular files from an (untrusted) tar produced by the sandbox.
 * Anything that is not a flat regular file name is ignored.
 */
export async function unpackArtifacts(data: Buffer, maxFiles = 16): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const ex = extract();
  const finished = new Promise<void>((resolve, reject) => {
    ex.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: unknown) => {
        chunks.push(c as Buffer);
      });
      stream.on('end', () => {
        const name = header.name.replace(/^\.\//, '');
        if (header.type === 'file' && /^[A-Za-z0-9._-]{1,128}$/.test(name) && out.size < maxFiles) {
          out.set(name, Buffer.concat(chunks));
        }
        next();
      });
      stream.on('error', reject);
      stream.resume();
    });
    ex.on('finish', resolve);
    ex.on('error', reject);
  });
  ex.end(data);
  await finished;
  return out;
}
