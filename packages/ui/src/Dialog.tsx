'use client';

import { type ReactNode, useEffect, useId, useRef } from 'react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider layout for tables/lists. */
  size?: 'md' | 'lg';
}

/**
 * Modal built on the native <dialog>: focus trapping, Escape-to-close and the
 * inert background come from the browser. Clicking the backdrop closes it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="lc-dialog"
      data-size={size}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="lc-dialog__inner">
          <header className="lc-dialog__header">
            <h2 id={titleId} className="lc-dialog__title">
              {title}
            </h2>
            <button
              type="button"
              className="lc-dialog__close"
              onClick={onClose}
              aria-label="Close dialog"
            >
              ×
            </button>
          </header>
          {description ? (
            <p id={descId} className="lc-dialog__description">
              {description}
            </p>
          ) : null}
          <div className="lc-dialog__body">{children}</div>
          {footer ? <footer className="lc-dialog__footer">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
