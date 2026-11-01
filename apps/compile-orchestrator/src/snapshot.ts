import {
  computeFingerprint,
  type RevisionManifest,
  type SandboxLimits,
  sha256Hex,
  type SnapshotFile,
  type SourceSnapshot,
  type TexEngine,
  validateProjectPath,
} from '@latex-cloud/compiler-protocol';

export class SnapshotRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotRejectedError';
  }
}

/**
 * Builds an immutable snapshot (manifest + fingerprint) from in-memory files.
 * Every path is validated; every file is hashed. This is the only way inputs
 * reach an executor.
 */
export function createSnapshot(opts: {
  files: readonly SnapshotFile[];
  rootFile: string;
  engine: TexEngine;
  texImage: string;
}): SourceSnapshot {
  const manifest: RevisionManifest = {
    schemaVersion: 1,
    rootFile: opts.rootFile,
    engine: opts.engine,
    texImage: opts.texImage,
    options: { synctex: true },
    files: opts.files.map((f) => {
      const v = validateProjectPath(f.path);
      if (!v.ok) throw new SnapshotRejectedError(`invalid path "${f.path}": ${v.reason}`);
      return { path: v.path, sha256: sha256Hex(f.content), sizeBytes: f.content.byteLength };
    }),
  };
  return { manifest, fingerprint: computeFingerprint(manifest), files: opts.files };
}

/**
 * Re-verifies a snapshot right before execution: limits, path safety, and that
 * file bytes still match the manifest hashes (defence against mutation between
 * capture and run).
 */
export function verifySnapshot(snapshot: SourceSnapshot, limits: SandboxLimits): void {
  if (computeFingerprint(snapshot.manifest) !== snapshot.fingerprint) {
    throw new SnapshotRejectedError('fingerprint does not match manifest');
  }
  const expected = new Map(snapshot.manifest.files.map((f) => [f.path, f]));
  if (expected.size !== snapshot.files.length) {
    throw new SnapshotRejectedError('snapshot files do not match manifest');
  }
  let total = 0;
  for (const file of snapshot.files) {
    const entry = expected.get(file.path);
    if (!entry) throw new SnapshotRejectedError(`file not in manifest: ${file.path}`);
    if (file.content.byteLength > limits.maxInputFileBytes) {
      throw new SnapshotRejectedError(`file too large: ${file.path}`);
    }
    total += file.content.byteLength;
    if (sha256Hex(file.content) !== entry.sha256) {
      throw new SnapshotRejectedError(`content hash mismatch: ${file.path}`);
    }
  }
  if (total > limits.maxInputBytes)
    throw new SnapshotRejectedError('snapshot exceeds total input size limit');
}
