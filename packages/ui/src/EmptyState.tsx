import type { ReactNode } from 'react';

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="lc-empty">
      <p className="lc-empty__title">{title}</p>
      {children ? <p className="lc-empty__body">{children}</p> : null}
      {action}
    </div>
  );
}
