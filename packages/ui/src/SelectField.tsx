import { type SelectHTMLAttributes, useId } from 'react';

export function SelectField({
  label,
  options,
  hideLabel,
  ...rest
}: {
  label: string;
  hideLabel?: boolean;
  options: readonly { value: string; label: string }[];
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="lc-field">
      <label className={hideLabel ? 'lc-visually-hidden' : 'lc-field__label'} htmlFor={id}>
        {label}
      </label>
      <select id={id} className="lc-input lc-select" {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
