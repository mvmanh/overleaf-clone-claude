'use client';

import { useEffect, useState } from 'react';
import type { CompileJob, Diagnostic } from '@latex-cloud/shared';
import { Button, EmptyState, Spinner } from '@latex-cloud/ui';

const ICON = { error: '✕', warning: '!', info: 'i' } as const;
const ORDER = { error: 0, warning: 1, info: 2 } as const;

export function ProblemsPanel({
  job,
  onJump,
}: {
  job: CompileJob | null;
  onJump: (d: Diagnostic) => void;
}) {
  const [tab, setTab] = useState<'problems' | 'log'>('problems');
  const [log, setLog] = useState<{ jobId: string; text: string } | null>(null);
  const hasLog = job?.artifacts.some((a) => a.kind === 'log') ?? false;

  useEffect(() => {
    if (tab !== 'log' || !job || !hasLog || log?.jobId === job.id) return;
    let cancelled = false;
    void fetch(`/api/v1/compiles/${job.id}/artifacts/log`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => !cancelled && setLog({ jobId: job.id, text }))
      .catch(() => !cancelled && setLog({ jobId: job.id, text: 'Could not load the log.' }));
    return () => {
      cancelled = true;
    };
  }, [tab, job, hasLog, log?.jobId]);

  if (!job) {
    return (
      <EmptyState title="No compile has run">
        Press Compile (Ctrl/⌘+Enter). Errors will be listed here.
      </EmptyState>
    );
  }

  const diagnostics = [...job.diagnostics].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  return (
    <div className="problems">
      <div className="problems__tabs" role="tablist" aria-label="Compile output">
        <Button
          size="sm"
          variant="ghost"
          role="tab"
          aria-selected={tab === 'problems'}
          className="problems__tab"
          onClick={() => setTab('problems')}
        >
          Problems ({diagnostics.length})
        </Button>
        <Button
          size="sm"
          variant="ghost"
          role="tab"
          aria-selected={tab === 'log'}
          className="problems__tab"
          onClick={() => setTab('log')}
          disabled={!hasLog}
        >
          Raw log
        </Button>
      </div>
      {tab === 'problems' ? (
        diagnostics.length === 0 ? (
          <EmptyState title={job.status === 'succeeded' ? 'No problems' : 'No diagnostics yet'}>
            {job.status === 'succeeded' ? 'The document compiled cleanly.' : (job.message ?? '')}
          </EmptyState>
        ) : (
          <ul className="problems__list" aria-label="Problems" data-testid="problems">
            {diagnostics.map((d, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="problem"
                  data-testid="problem"
                  onClick={() => onJump(d)}
                  disabled={!d.line}
                  title={d.excerpt}
                >
                  <span
                    className="problem__icon"
                    data-severity={d.severity}
                    aria-label={d.severity}
                  >
                    {ICON[d.severity]}
                  </span>
                  <span>
                    {d.message}
                    {d.hint ? <span className="problem__hint">{d.hint}</span> : null}
                  </span>
                  <span className="problem__loc">
                    {d.file ?? ''}
                    {d.line ? `:${d.line}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : log?.jobId === job.id ? (
        <pre className="problems__log" data-testid="raw-log">
          {log.text}
        </pre>
      ) : (
        <div className="source-editor__center">
          <Spinner label="Loading log" />
        </div>
      )}
    </div>
  );
}
