import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TexEngine } from './engines';
import { validateProjectPath } from './paths';

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'expected lowercase sha256 hex');

const ManifestPath = z.string().superRefine((value, ctx) => {
  const result = validateProjectPath(value);
  if (!result.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason });
  else if (result.path !== value) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'path is not NFC-normalised' });
  }
});

export const ManifestEntry = z.object({
  path: ManifestPath,
  sha256: Sha256Hex,
  sizeBytes: z.number().int().nonnegative(),
});
export type ManifestEntry = z.infer<typeof ManifestEntry>;

/**
 * Immutable description of exactly what a compile job builds. A job references
 * one manifest; artifacts are attributed to the manifest's fingerprint so a
 * stale build can never be mistaken for the current one.
 */
export const RevisionManifest = z
  .object({
    schemaVersion: z.literal(1),
    rootFile: ManifestPath,
    engine: TexEngine,
    /** Content-addressed TeX image reference, e.g. `registry/texlive@sha256:...`. */
    texImage: z.string().min(1),
    options: z.object({ synctex: z.boolean() }).strict(),
    files: z.array(ManifestEntry).min(1).max(10_000),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    for (const file of manifest.files) {
      const key = file.path.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate path (case-insensitive): ${file.path}`,
        });
      }
      seen.add(key);
    }
    if (!manifest.files.some((f) => f.path === manifest.rootFile)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'rootFile is not in files' });
    }
  });
export type RevisionManifest = z.infer<typeof RevisionManifest>;

/** Deterministic JSON: object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Content fingerprint of a manifest. File order does not matter; any change to
 * content, path, root file, engine, options or TeX image changes the result.
 */
export function computeFingerprint(manifest: RevisionManifest): string {
  const parsed = RevisionManifest.parse(manifest);
  const files = [...parsed.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const canonical = canonicalJson({ ...parsed, files });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}
