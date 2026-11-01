import { useId, type InputHTMLAttributes } from 'react';

export function TextField({
  label,
  ...rest
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="lc-field">
      <label className="lc-field__label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="lc-input" {...rest} />
    </div>
  );
}
