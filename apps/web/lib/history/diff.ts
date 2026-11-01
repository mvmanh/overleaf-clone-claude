import { diffLines, diffWordsWithSpace } from 'diff';

export interface Segment {
  text: string;
  /** Changed part of a modified line (highlighted more strongly). */
  changed: boolean;
}

export type DiffRow =
  | { type: 'same'; oldNo: number; newNo: number; text: string }
  | { type: 'del'; oldNo: number; segments: Segment[] }
  | { type: 'add'; newNo: number; segments: Segment[] }
  /** Unchanged lines folded away; `from`/`to` index into the full row list. */
  | { type: 'gap'; count: number; from: number; to: number };

export interface DiffResult {
  rows: DiffRow[];
  added: number;
  removed: number;
}

const splitLines = (value: string) => {
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

/** Word-level highlight for a removed/added line pair. */
function pairSegments(a: string, b: string): [Segment[], Segment[]] {
  const parts = diffWordsWithSpace(a, b);
  const del: Segment[] = [];
  const add: Segment[] = [];
  for (const p of parts) {
    if (!p.added) del.push({ text: p.value, changed: Boolean(p.removed) });
    if (!p.removed) add.push({ text: p.value, changed: Boolean(p.added) });
  }
  return [del, add];
}

/**
 * Line diff with intra-line word highlights; runs of more than
 * `2 × context` unchanged lines are folded into a gap row.
 */
export function computeDiff(before: string, after: string, context = 3): DiffResult {
  const full: Exclude<DiffRow, { type: 'gap' }>[] = [];
  let oldNo = 1;
  let newNo = 1;
  let added = 0;
  let removed = 0;
  const changes = diffLines(before, after);
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]!;
    const lines = splitLines(c.value);
    if (c.removed) {
      const next = changes[i + 1];
      const addLines = next?.added ? splitLines(next.value) : [];
      // Pair removed and added lines one-to-one for word highlights.
      const pairs = Math.min(lines.length, addLines.length);
      const dels: DiffRow[] = [];
      const adds: DiffRow[] = [];
      lines.forEach((text, k) => {
        const segs = k < pairs ? pairSegments(text, addLines[k]!)[0] : [{ text, changed: false }];
        dels.push({ type: 'del', oldNo: oldNo++, segments: segs });
      });
      addLines.forEach((text, k) => {
        const segs = k < pairs ? pairSegments(lines[k]!, text)[1] : [{ text, changed: false }];
        adds.push({ type: 'add', newNo: newNo++, segments: segs });
      });
      removed += lines.length;
      added += addLines.length;
      full.push(...(dels as typeof full), ...(adds as typeof full));
      if (next?.added) i++;
    } else if (c.added) {
      for (const text of lines)
        full.push({ type: 'add', newNo: newNo++, segments: [{ text, changed: false }] });
      added += lines.length;
    } else {
      for (const text of lines) full.push({ type: 'same', oldNo: oldNo++, newNo: newNo++, text });
    }
  }

  // Fold long unchanged stretches, keeping `context` lines around changes.
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < full.length) {
    if (full[i]!.type !== 'same') {
      rows.push(full[i]!);
      i++;
      continue;
    }
    let j = i;
    while (j < full.length && full[j]!.type === 'same') j++;
    const atStart = i === 0;
    const atEnd = j === full.length;
    const keepBefore = atStart ? 0 : context;
    const keepAfter = atEnd ? 0 : context;
    if (j - i > keepBefore + keepAfter + 1) {
      rows.push(...full.slice(i, i + keepBefore));
      rows.push({
        type: 'gap',
        count: j - i - keepBefore - keepAfter,
        from: i + keepBefore,
        to: j - keepAfter,
      });
      rows.push(...full.slice(j - keepAfter, j));
    } else rows.push(...full.slice(i, j));
    i = j;
  }
  return { rows, added, removed };
}

/** The rows a gap stands for (to expand it in place). */
export function expandGap(
  before: string,
  after: string,
  gap: { from: number; to: number },
): DiffRow[] {
  const all = computeDiff(before, after, Number.MAX_SAFE_INTEGER).rows;
  return all.slice(gap.from, gap.to);
}
