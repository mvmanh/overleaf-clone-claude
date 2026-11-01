import { z } from 'zod';
import { ProjectFile } from './files';

/**
 * Version history (ADR-0015). A version is an immutable checkpoint of one
 * file. Editing creates at most one checkpoint per file per
 * `HISTORY_CHECKPOINT_MS` (plus one when the last editor leaves); structural
 * changes (create, upload, rename, delete, restore) always create one.
 */
export const HISTORY_CHECKPOINT_MS = 5 * 60 * 1000;

export const HistorySource = z.enum([
  'create',
  'edit',
  'upload',
  'rename',
  'restore',
  'delete',
  'import',
]);
export type HistorySource = z.infer<typeof HistorySource>;

const Person = z.object({ id: z.string().uuid(), name: z.string() });

export const HistoryVersion = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
  path: z.string(),
  kind: z.enum(['text', 'binary']),
  sha256: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  source: HistorySource,
  authors: z.array(Person),
  createdAt: z.string().datetime(),
});
export type HistoryVersion = z.infer<typeof HistoryVersion>;

export const HistoryLabel = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string().datetime(),
  createdBy: Person.nullable(),
});
export type HistoryLabel = z.infer<typeof HistoryLabel>;

export const HistoryListResponse = z.object({
  versions: z.array(HistoryVersion),
  labels: z.array(HistoryLabel),
  /** Pass as `before` to load older versions; null when there are none. */
  nextCursor: z.string().nullable(),
});
export type HistoryListResponse = z.infer<typeof HistoryListResponse>;

export const HistoryVersionDetail = z.object({
  version: HistoryVersion,
  /** Text of this version (null for binary files). */
  content: z.string().nullable(),
  /** The file's version before this one, for the diff. */
  previous: z.object({ version: HistoryVersion, content: z.string().nullable() }).nullable(),
});
export type HistoryVersionDetail = z.infer<typeof HistoryVersionDetail>;

export const CreateLabelRequest = z
  .object({ name: z.string().trim().min(1, 'Name is required').max(120) })
  .strict();
export type CreateLabelRequest = z.infer<typeof CreateLabelRequest>;

export const RestoreVersionResponse = z.object({
  file: ProjectFile,
  /** False when the file had to be restored under a new path. */
  samePath: z.boolean(),
});
export type RestoreVersionResponse = z.infer<typeof RestoreVersionResponse>;
