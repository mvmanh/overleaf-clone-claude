type Level = 'info' | 'warn' | 'error';

const quiet = () => process.env.NODE_ENV === 'test' && !process.env.COLLAB_LOG;

/** One JSON line per event: easy to grep locally, ready for a log pipeline. */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (quiet() && level === 'info') return;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    svc: 'collab',
    event,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}
