import { z } from 'zod';
import { validateProjectPath } from './paths';

/** Extensions edited as text in the browser (UTF-8). Everything else is binary (PR 4). */
export const TEXT_FILE_EXTENSIONS: readonly string[] = [
  'tex',
  'ltx',
  'bib',
  'sty',
  'cls',
  'bst',
  'bbx',
  'cbx',
  'lbx',
  'def',
  'cfg',
  'clo',
  'dtx',
  'ins',
  'txt',
  'md',
  'csv',
  'tsv',
  'dat',
  'tikz',
  'pgf',
  'lua',
  'bbl',
  'ist',
  'gst',
  'gnuplot',
];

/** Upper bound for one text file (UTF-8 bytes). */
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
/** Upper bound for the number of live files in a project. */
export const MAX_FILES_PER_PROJECT = 1000;

export function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function isTextPath(path: string): boolean {
  return TEXT_FILE_EXTENSIONS.includes(extensionOf(path));
}

export function isTexRoot(path: string): boolean {
  return ['tex', 'ltx'].includes(extensionOf(path));
}

/** A project path that passes the shared safety rules. */
export const ProjectPath = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const r = validateProjectPath(value);
    if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.reason });
  })
  .transform((v) => v.normalize('NFC'));

export const TextPath = ProjectPath.refine(isTextPath, {
  message: `Only text files can be created here (${TEXT_FILE_EXTENSIONS.slice(0, 6).join(', ')}, …)`,
});

const utf8Bytes = (s: string) => new TextEncoder().encode(s).byteLength;

export const FileContent = z
  .string()
  .refine(
    (s) => utf8Bytes(s) <= MAX_TEXT_FILE_BYTES,
    `File exceeds ${MAX_TEXT_FILE_BYTES / 1024 / 1024} MB`,
  );

export const ProjectFile = z.object({
  id: z.string().uuid(),
  path: z.string(),
  kind: z.enum(['text', 'binary']),
  sizeBytes: z.number().int().nonnegative(),
  /** Content hash; also the ETag for optimistic concurrency. */
  sha256: z.string(),
  updatedAt: z.string().datetime(),
});
export type ProjectFile = z.infer<typeof ProjectFile>;

export const ProjectFileListResponse = z.object({
  files: z.array(ProjectFile),
  rootFile: z.string().nullable(),
});
export type ProjectFileListResponse = z.infer<typeof ProjectFileListResponse>;

export const ProjectFileWithContent = ProjectFile.extend({ content: z.string() });
export type ProjectFileWithContent = z.infer<typeof ProjectFileWithContent>;

export const CreateFileRequest = z
  .object({ path: TextPath, content: FileContent.default('') })
  .strict();
export type CreateFileRequest = z.infer<typeof CreateFileRequest>;

export const RenameFileRequest = z.object({ path: ProjectPath }).strict();
export type RenameFileRequest = z.infer<typeof RenameFileRequest>;

/** Body of `PUT …/files/{id}/content`; send the last known sha256 in `If-Match`. */
export const SaveFileRequest = z.object({ content: FileContent }).strict();
export type SaveFileRequest = z.infer<typeof SaveFileRequest>;
