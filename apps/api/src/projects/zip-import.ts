import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import {
  isAllowedPath,
  isTexRoot,
  type TexEngineName,
  validateProjectPath,
} from '@latex-cloud/shared';

export interface ZipLimits {
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  /** Uncompressed/compressed ratio above which an entry is treated as a bomb. */
  maxRatio: number;
}

export interface ZipFileEntry {
  path: string;
  content: Buffer;
}

export interface ZipReadResult {
  files: ZipFileEntry[];
  skipped: { path: string; reason: string }[];
}

export class ZipRejectedError extends Error {}

/** Platform junk that is silently dropped (not reported as skipped). */
const JUNK = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i];
/** Build outputs that should not be imported as sources. */
const BUILD_OUTPUT =
  /\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex\.gz|blg|bcf|run\.xml|nav|snm)$/i;

function isSymlink(entry: Entry): boolean {
  // Unix mode lives in the high 16 bits of externalFileAttributes (made by Unix).
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
  return mode === 0o120000;
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) =>
    fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: false, decodeStrings: true },
      (err, zip) =>
        err || !zip
          ? reject(new ZipRejectedError('The file is not a valid ZIP archive.'))
          : resolve(zip),
    ),
  );
}

function readEntry(zip: ZipFile, entry: Entry, limits: ZipLimits): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(new ZipRejectedError(`Could not read ${entry.fileName}.`));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (c: Buffer) => {
        size += c.byteLength;
        // Enforce limits on actual bytes too: headers can lie.
        if (size > limits.maxFileBytes)
          stream.destroy(new ZipRejectedError(`${entry.fileName} is larger than allowed.`));
        else chunks.push(c);
      });
      stream.on('error', (e) =>
        reject(
          e instanceof ZipRejectedError ? e : new ZipRejectedError(`${entry.fileName} is corrupt.`),
        ),
      );
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

/**
 * Reads an untrusted ZIP archive into project files. Rejects the whole archive
 * for structural attacks (bombs, too many entries, traversal, duplicates);
 * skips — and reports — entries that are merely unsupported.
 */
export async function readProjectZip(buffer: Buffer, limits: ZipLimits): Promise<ZipReadResult> {
  const zip = await openZip(buffer);
  if (zip.entryCount > limits.maxEntries) {
    zip.close();
    throw new ZipRejectedError(
      `The archive has ${zip.entryCount} entries; at most ${limits.maxEntries} are allowed.`,
    );
  }
  const entries: Entry[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (e: Entry) => {
      entries.push(e);
      zip.readEntry();
    });
    zip.on('end', () => resolve());
    zip.on('error', () => reject(new ZipRejectedError('The ZIP archive is corrupt.')));
    zip.readEntry();
  });

  // Declared sizes first (cheap), so bombs are rejected before inflating anything.
  let declared = 0;
  for (const e of entries) {
    if (e.fileName.endsWith('/')) continue;
    declared += e.uncompressedSize;
    if (e.uncompressedSize > limits.maxFileBytes) {
      zip.close();
      throw new ZipRejectedError(
        `${e.fileName} is larger than ${Math.round(limits.maxFileBytes / 1048576)} MB.`,
      );
    }
    if (
      e.compressedSize > 0 &&
      e.uncompressedSize / e.compressedSize > limits.maxRatio &&
      e.uncompressedSize > 1024 * 1024
    ) {
      zip.close();
      throw new ZipRejectedError('The archive looks like a decompression bomb and was rejected.');
    }
  }
  if (declared > limits.maxTotalBytes) {
    zip.close();
    throw new ZipRejectedError(
      `The archive expands to more than ${Math.round(limits.maxTotalBytes / 1048576)} MB.`,
    );
  }

  // A single top-level folder (GitHub-style "repo-main/") is stripped.
  const names = entries
    .map((e) => e.fileName.replace(/\\/g, '/'))
    .filter((n) => !JUNK.some((j) => j.test(n)));
  const firstSegments = new Set(names.map((n) => n.split('/')[0]));
  const stripPrefix =
    firstSegments.size === 1 && names.every((n) => n.includes('/'))
      ? `${[...firstSegments][0]}/`
      : '';

  const files: ZipFileEntry[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const seen = new Set<string>();
  let total = 0;
  try {
    for (const e of entries) {
      const raw = e.fileName.replace(/\\/g, '/');
      if (raw.endsWith('/') || JUNK.some((j) => j.test(raw))) continue;
      if (raw.startsWith('/') || raw.split('/').includes('..') || /^[a-zA-Z]:/.test(raw)) {
        throw new ZipRejectedError(`The archive contains an unsafe path: ${raw}`);
      }
      if (isSymlink(e)) {
        skipped.push({ path: raw, reason: 'symbolic links are not imported' });
        continue;
      }
      const path = raw.startsWith(stripPrefix) ? raw.slice(stripPrefix.length) : raw;
      const v = validateProjectPath(path);
      if (!v.ok) {
        skipped.push({ path, reason: v.reason });
        continue;
      }
      if (BUILD_OUTPUT.test(path)) {
        skipped.push({ path, reason: 'build output (regenerated when compiling)' });
        continue;
      }
      if (!isAllowedPath(path)) {
        skipped.push({ path, reason: 'file type is not supported' });
        continue;
      }
      const key = v.path.toLowerCase();
      if (seen.has(key))
        throw new ZipRejectedError(
          `The archive contains two files named ${v.path} (names are case-insensitive).`,
        );
      seen.add(key);
      const content = await readEntry(zip, e, limits);
      total += content.byteLength;
      if (total > limits.maxTotalBytes)
        throw new ZipRejectedError('The archive expands beyond the project size limit.');
      files.push({ path: v.path, content });
    }
  } finally {
    zip.close();
  }
  return { files, skipped };
}

/**
 * Picks the main file: `main.tex` if it is a document, otherwise the
 * shallowest .tex file with `\documentclass` (ties: alphabetical).
 */
export function detectRootFile(files: readonly ZipFileEntry[]): string | null {
  const docs = files
    .filter((f) => isTexRoot(f.path))
    .filter((f) => /^[^%\n]*\\documentclass\b/m.test(f.content.toString('utf8')));
  const main = docs.find((f) => /(^|\/)main\.tex$/i.test(f.path) && !f.path.includes('/'));
  if (main) return main.path;
  docs.sort(
    (a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path),
  );
  return docs[0]?.path ?? null;
}

/** fontspec/unicode-math need a Unicode engine; LuaLaTeX-only packages need LuaLaTeX. */
export function detectEngine(rootContent: string | null): TexEngineName {
  if (!rootContent) return 'pdflatex';
  const body = rootContent.replace(/(^|[^\\])%.*$/gm, '$1');
  if (
    /\\(directlua|luaexec)\b|\\usepackage(\[[^\]]*\])?\{[^}]*\b(luacode|luatexja|lua-visual-debug)\b/.test(
      body,
    )
  )
    return 'lualatex';
  if (/\\usepackage(\[[^\]]*\])?\{[^}]*\b(fontspec|unicode-math|xeCJK|polyglossia)\b/.test(body))
    return 'xelatex';
  return 'pdflatex';
}
