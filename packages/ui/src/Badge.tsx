import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export interface BadgeProps {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  title?: string;
}

export function Badge({ tone = 'neutral', dot = true, children, title }: BadgeProps) {
  return (
    <span className="lc-badge" data-tone={tone} data-dot={dot ? 'true' : 'false'} title={title}>
      {children}
    </span>
  );
}
