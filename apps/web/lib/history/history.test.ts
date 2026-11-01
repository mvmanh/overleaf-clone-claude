import { describe, expect, it } from 'vitest';
import type { HistoryLabel, HistoryVersion } from '@latex-cloud/shared';
import { computeDiff, expandGap } from './diff';
import { buildTimeline } from './group';

describe('computeDiff', () => {
  it('reports added, removed and modified lines with word highlights', () => {
    const r = computeDiff('a\nb\nc\n', 'a\nB c\nc\nd\n');
    expect(r.added).toBe(2);
    expect(r.removed).toBe(1);
    expect(r.rows.map((x) => x.type)).toEqual(['same', 'del', 'add', 'same', 'add']);
    const del = r.rows[1] as Extract<(typeof r.rows)[number], { type: 'del' }>;
    expect(del.oldNo).toBe(2);
    expect(del.segments.some((s) => s.changed && s.text === 'b')).toBe(true);
    const add = r.rows[2] as Extract<(typeof r.rows)[number], { type: 'add' }>;
    expect(add.newNo).toBe(2);
    expect(
      add.segments
        .filter((s) => s.changed)
        .map((s) => s.text)
        .join(''),
    ).toContain('B');
  });

  it('folds long unchanged stretches and can expand them', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const after = before.replace('line 20', 'line twenty');
    const r = computeDiff(before, after);
    const gaps = r.rows.filter((x) => x.type === 'gap');
    expect(gaps).toHaveLength(2);
    expect(r.rows.length).toBeLessThan(15);
    const first = gaps[0] as Extract<(typeof r.rows)[number], { type: 'gap' }>;
    const expanded = expandGap(before, after, first);
    expect(expanded).toHaveLength(first.count);
    expect(expanded.every((x) => x.type === 'same')).toBe(true);
  });

  it('handles empty sides and identical texts', () => {
    expect(computeDiff('', 'x\n').added).toBe(1);
    expect(computeDiff('x\n', '').removed).toBe(1);
    const same = computeDiff('a\nb\n', 'a\nb\n');
    expect(same.added + same.removed).toBe(0);
  });
});

describe('buildTimeline', () => {
  const v = (id: string, at: string): HistoryVersion => ({
    id,
    fileId: '11111111-1111-4111-8111-111111111111',
    path: 'main.tex',
    kind: 'text',
    sha256: 'x',
    sizeBytes: 1,
    source: 'edit',
    authors: [],
    createdAt: at,
  });
  const label = (at: string): HistoryLabel => ({
    id: '22222222-2222-4222-8222-222222222222',
    name: 'v1',
    createdAt: at,
    createdBy: null,
  });

  it('groups by day, newest first, labels above what they name', () => {
    const now = new Date('2026-11-01T15:00:00');
    const days = buildTimeline(
      [
        v('a', new Date('2026-11-01T14:00:00').toISOString()),
        v('b', new Date('2026-10-31T09:00:00').toISOString()),
        v('c', new Date('2026-10-20T09:00:00').toISOString()),
      ],
      [label(new Date('2026-11-01T14:00:00').toISOString())],
      now,
      'en-GB',
    );
    expect(days.map((d) => d.title.slice(0, 9))).toEqual(['Today', 'Yesterday', 'Tue, 20 O']);
    expect(days[0]!.items.map((i) => i.kind)).toEqual(['label', 'version']);
  });

  it('keeps labels older than the loaded page for later', () => {
    const days = buildTimeline(
      [v('a', '2026-11-01T10:00:00.000Z')],
      [label('2026-01-01T10:00:00.000Z')],
      new Date('2026-11-01T12:00:00Z'),
    );
    expect(days.flatMap((d) => d.items).map((i) => i.kind)).toEqual(['version']);
  });
});
