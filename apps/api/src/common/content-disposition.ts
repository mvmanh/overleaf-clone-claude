/**
 * Builds a Content-Disposition header that is safe for any file name:
 * an ASCII fallback plus the RFC 5987 UTF-8 form (Vietnamese names survive).
 */
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii =
    fileName
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\]/g, '_')
      .trim() || 'download';
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
