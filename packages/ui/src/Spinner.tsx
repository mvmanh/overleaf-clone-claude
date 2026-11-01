export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="lc-spinner" role="status" aria-label={label} />;
}
