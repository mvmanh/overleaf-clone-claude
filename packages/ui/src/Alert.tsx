import type { ReactNode } from 'react';

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return (
    <div className="lc-alert" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
