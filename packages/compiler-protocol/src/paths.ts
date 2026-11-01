/**
 * Validation for project-relative file paths. Every path that crosses a trust
 * boundary (upload, ZIP entry, revision manifest, sandbox input) must pass
 * through `validateProjectPath`. Paths are POSIX, relative, and normalised.
 */

export const MAX_PATH_LENGTH = 512;
export const MAX_PATH_DEPTH = 16;
export const MAX_SEGMENT_LENGTH = 128;

/** Files that configure build tooling as code and must never enter a sandbox input. */
export const FORBIDDEN_FILE_NAMES: ReadonlySet<string> = new Set([
  'latexmkrc',
  '.latexmkrc',
  'texmf.cnf',
]);

export type PathValidationResult = { ok: true; path: string } | { ok: false; reason: string };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function validateProjectPath(input: string): PathValidationResult {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, reason: 'path is empty' };
  }
  if (input.length > MAX_PATH_LENGTH) return { ok: false, reason: 'path is too long' };
  if (CONTROL_CHARS.test(input)) return { ok: false, reason: 'path contains control characters' };
  if (input.includes('\\')) return { ok: false, reason: 'backslashes are not allowed' };
  if (input.startsWith('/')) return { ok: false, reason: 'absolute paths are not allowed' };
  if (/^[a-zA-Z]:/.test(input)) return { ok: false, reason: 'drive-letter paths are not allowed' };

  const normalised = input.normalize('NFC');
  const segments = normalised.split('/');
  if (segments.length > MAX_PATH_DEPTH) return { ok: false, reason: 'path is too deep' };

  for (const segment of segments) {
    if (segment === '') return { ok: false, reason: 'empty path segment' };
    if (segment === '.' || segment === '..') {
      return { ok: false, reason: 'relative segments are not allowed' };
    }
    if (segment.length > MAX_SEGMENT_LENGTH) return { ok: false, reason: 'path segment too long' };
    if (segment.startsWith('-')) return { ok: false, reason: 'segments may not start with "-"' };
    if (segment.endsWith(' ') || segment.endsWith('.')) {
      return { ok: false, reason: 'segments may not end with a space or dot' };
    }
    if (WINDOWS_RESERVED.test(segment)) return { ok: false, reason: 'reserved file name' };
  }

  const base = segments[segments.length - 1]!.toLowerCase();
  if (FORBIDDEN_FILE_NAMES.has(base)) {
    return { ok: false, reason: `"${base}" is build configuration and is not accepted` };
  }
  return { ok: true, path: normalised };
}
