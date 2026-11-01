import { extract, pack } from 'tar-stream';
import { validateProjectPath } from './paths';
import type { SnapshotFile } from './sandbox';

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

/**
 * Extracts a source snapshot archive (untrusted bytes from storage). Only
 * regular files with valid project paths are accepted; anything else rejects
 * the whole archive rather than being silently skipped.
 */
export async function unpackSnapshot(
  data: Buffer,
  limits: { maxFiles: number; maxTotalBytes: number },
): Promise<SnapshotFile[]> {
  const out: SnapshotFile[] = [];
  let total = 0;
  const ex = extract();
  return new Promise<SnapshotFile[]>((resolve, reject) => {
    let settled = false;
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      ex.removeAllListeners('entry');
      ex.on('error', () => undefined); // swallow follow-up stream errors
      ex.destroy();
      reject(new Error(msg));
    };
    ex.on('entry', (header, stream, next) => {
      if (header.type !== 'file') return fail(`archive entry ${header.name} is not a regular file`);
      const v = validateProjectPath(header.name);
      if (!v.ok || v.path !== header.name)
        return fail(`archive entry has an invalid path: ${header.name}`);
      if (out.length >= limits.maxFiles) return fail('archive has too many files');
      const chunks: Buffer[] = [];
      stream.on('data', (c: unknown) => {
        total += (c as Buffer).byteLength;
        if (total > limits.maxTotalBytes) return fail('archive exceeds the size limit');
        chunks.push(c as Buffer);
      });
      stream.on('end', () => {
        if (settled) return;
        out.push({ path: header.name, content: Buffer.concat(chunks) });
        next();
      });
    });
    ex.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve(out);
    });
    ex.on('error', (err: Error) => fail(err.message));
    ex.end(data);
  });
}
