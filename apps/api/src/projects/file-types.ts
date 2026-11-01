import { extensionOf, isBinaryPath, isTextPath } from '@latex-cloud/shared';

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  b.byteLength >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Expected file signatures per binary extension. */
const SIGNATURES: Record<string, ((b: Uint8Array) => boolean)[]> = {
  png: [(b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  jpg: [(b) => startsWith(b, [0xff, 0xd8, 0xff])],
  jpeg: [(b) => startsWith(b, [0xff, 0xd8, 0xff])],
  pdf: [(b) => startsWith(b, ascii('%PDF-'))],
  eps: [(b) => startsWith(b, ascii('%!PS')), (b) => startsWith(b, [0xc5, 0xd0, 0xd3, 0xc6])],
  ttf: [(b) => startsWith(b, [0x00, 0x01, 0x00, 0x00]), (b) => startsWith(b, ascii('true'))],
  otf: [(b) => startsWith(b, ascii('OTTO')), (b) => startsWith(b, [0x00, 0x01, 0x00, 0x00])],
};

export type ClassifiedFile =
  | { ok: true; kind: 'text'; text: string }
  | { ok: true; kind: 'binary' }
  | { ok: false; reason: string };

/**
 * Decides how an uploaded/imported file is stored. Text extensions must be
 * valid UTF-8; binary extensions must carry the matching file signature, so a
 * script renamed to `.png` (or an HTML/PDF polyglot) is rejected.
 */
export function classifyFile(path: string, bytes: Uint8Array): ClassifiedFile {
  if (isTextPath(path)) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { ok: true, kind: 'text', text: text.startsWith('﻿') ? text.slice(1) : text };
    } catch {
      return { ok: false, reason: 'is not valid UTF-8 text (re-save it as UTF-8)' };
    }
  }
  if (isBinaryPath(path)) {
    const checks = SIGNATURES[extensionOf(path)] ?? [];
    if (!checks.some((c) => c(bytes))) {
      return { ok: false, reason: `content does not look like a .${extensionOf(path)} file` };
    }
    return { ok: true, kind: 'binary' };
  }
  return { ok: false, reason: 'file type is not supported' };
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  eps: 'application/postscript',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

export function contentTypeFor(path: string): string {
  return (
    CONTENT_TYPES[extensionOf(path)] ??
    (isTextPath(path) ? 'text/plain; charset=utf-8' : 'application/octet-stream')
  );
}

/** Only images and PDFs are shown inline (as untrusted content, CSP-sandboxed). */
export function isInlineSafe(path: string): boolean {
  return ['png', 'jpg', 'jpeg', 'pdf'].includes(extensionOf(path));
}
