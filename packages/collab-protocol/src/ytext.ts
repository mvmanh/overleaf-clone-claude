import * as Y from 'yjs';
import { COLLAB_TEXT_FIELD } from '@latex-cloud/shared';

/**
 * Yjs helpers shared by the API and the collab server. The persisted form of
 * a file is always Yjs binary (snapshot + update log); plain text is derived
 * from it, never the other way round — except once, when a file is first
 * opened collaboratively and its Yjs state is seeded from the stored text.
 */

export const textOf = (doc: Y.Doc): string => doc.getText(COLLAB_TEXT_FIELD).toString();

/** An update that changes nothing (`Y.encodeStateAsUpdate(new Y.Doc())`). */
export function isEmptyUpdate(update: Uint8Array): boolean {
  return update.length === 2 && update[0] === 0 && update[1] === 0;
}

/**
 * Structural validation before an update is persisted, so a malformed
 * message can never poison the log. Throws on garbage.
 */
export function assertValidUpdate(update: Uint8Array): void {
  Y.decodeUpdate(update);
}

/**
 * Rebuilds a document from its snapshot and log. Updates that fail to apply
 * are reported, not fatal: one corrupt row must not lock authors out.
 */
export function buildDoc(
  state: Uint8Array | null,
  updates: Iterable<Uint8Array>,
  doc: Y.Doc = new Y.Doc(),
): { doc: Y.Doc; failed: number } {
  let failed = 0;
  const apply = (u: Uint8Array) => {
    try {
      Y.applyUpdate(doc, u);
    } catch {
      failed++;
    }
  };
  if (state) apply(state);
  for (const u of updates) apply(u);
  return { doc, failed };
}

/** A fresh document whose text is `text` (the one-time seed). */
export function seedDoc(text: string): Y.Doc {
  const doc = new Y.Doc();
  if (text) doc.getText(COLLAB_TEXT_FIELD).insert(0, text);
  return doc;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * Minimal single-range edit turning `a` into `b` (common prefix/suffix).
 * Never splits a surrogate pair, so intermediate Y.Text content stays valid.
 */
export function textDiff(a: string, b: string): { from: number; remove: number; insert: string } {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  if (start > 0 && isHigh(a.charCodeAt(start - 1))) start--;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  if (endA < a.length && isLow(a.charCodeAt(endA))) {
    endA++;
    endB++;
  }
  return { from: start, remove: endA - start, insert: b.slice(start, endB) };
}

/**
 * Replaces the document text with `next` as a minimal edit and returns the
 * Yjs update it produced (null when nothing changed). Concurrent edits made
 * elsewhere merge with it like any other collaborator's change.
 */
export function replaceText(doc: Y.Doc, next: string, origin?: unknown): Uint8Array | null {
  const text = doc.getText(COLLAB_TEXT_FIELD);
  const { from, remove, insert } = textDiff(text.toString(), next);
  if (remove === 0 && insert === '') return null;
  const before = Y.encodeStateVector(doc);
  doc.transact(() => {
    if (remove) text.delete(from, remove);
    if (insert) text.insert(from, insert);
  }, origin);
  return Y.encodeStateAsUpdate(doc, before);
}

export { Y };
