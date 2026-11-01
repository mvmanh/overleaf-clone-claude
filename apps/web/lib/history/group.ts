import type { HistoryLabel, HistoryVersion } from '@latex-cloud/shared';

export type TimelineItem =
  | { kind: 'version'; version: HistoryVersion }
  | { kind: 'label'; label: HistoryLabel };

export interface TimelineDay {
  key: string;
  title: string;
  items: TimelineItem[];
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Newest first, grouped by local day ("Today", "Yesterday", then dates).
 * Labels sit above the versions they name (a label is created after the
 * checkpoints it forces).
 */
export function buildTimeline(
  versions: HistoryVersion[],
  labels: HistoryLabel[],
  now: Date = new Date(),
  locale?: string,
): TimelineDay[] {
  const items: Array<TimelineItem & { at: number }> = [
    ...versions.map((v) => ({ kind: 'version' as const, version: v, at: Date.parse(v.createdAt) })),
    ...labels.map((l) => ({ kind: 'label' as const, label: l, at: Date.parse(l.createdAt) })),
  ];
  // Only show labels inside the loaded range (older ones appear when paging).
  const oldest = versions.length ? Date.parse(versions[versions.length - 1]!.createdAt) : -Infinity;
  const visible = items.filter((i) => i.kind === 'version' || i.at >= oldest);
  visible.sort((a, b) => b.at - a.at || (a.kind === 'label' ? -1 : 1));

  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const days: TimelineDay[] = [];
  for (const item of visible) {
    const d = new Date(item.at);
    const key = dayKey(d);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      const title =
        key === today
          ? 'Today'
          : key === yesterday
            ? 'Yesterday'
            : d.toLocaleDateString(locale, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              });
      day = { key, title, items: [] };
      days.push(day);
    }
    const { at: _at, ...rest } = item;
    day.items.push(rest as TimelineItem);
  }
  return days;
}

export const SOURCE_LABEL: Record<HistoryVersion['source'], string> = {
  create: 'created',
  edit: 'edited',
  upload: 'uploaded',
  rename: 'renamed',
  restore: 'restored',
  delete: 'deleted',
  import: 'imported',
};
