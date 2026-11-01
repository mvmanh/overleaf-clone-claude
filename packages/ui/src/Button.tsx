import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  block?: boolean;
}

export function Button({
  variant = 'default',
  size = 'md',
  block,
  type,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={className ? `lc-button ${className}` : 'lc-button'}
      data-variant={variant}
      data-size={size}
      data-block={block ? 'true' : undefined}
      {...rest}
    />
  );
}
