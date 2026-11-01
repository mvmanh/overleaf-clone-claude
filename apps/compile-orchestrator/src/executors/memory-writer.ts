import type { ArtifactKind, ArtifactWriter } from '@latex-cloud/compiler-protocol';

/** Collects artifacts in memory (tests, fixture runner). */
export class MemoryArtifactWriter implements ArtifactWriter {
  readonly artifacts = new Map<ArtifactKind, { fileName: string; data: Uint8Array }>();

  write(kind: ArtifactKind, fileName: string, data: Uint8Array): Promise<void> {
    this.artifacts.set(kind, { fileName, data });
    return Promise.resolve();
  }
}
