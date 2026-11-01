'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImportProjectResponse } from '@latex-cloud/shared';
import { Alert, Button, Dialog } from '@latex-cloud/ui';
import { ApiError, apiFetch } from '../../lib/api';
import { ENGINE_LABELS } from '../../lib/format';

/** Creates a project from a ZIP (e.g. an Overleaf "Download source" archive). */
export function ImportZipButton() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportProjectResponse | null>(null);

  async function importFile(file: File) {
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file, file.name);
      const r = await apiFetch('/api/v1/projects/import', ImportProjectResponse, {
        method: 'POST',
        body: form,
      });
      if (r.skipped.length === 0 && r.detected.rootFile) router.push(`/projects/${r.project.id}`);
      else setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Import failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => input.current?.click()}
        disabled={pending}
        title="Create a project from a .zip"
      >
        {pending ? 'Importing…' : 'Import ZIP'}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-testid="import-zip-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importFile(f);
        }}
      />
      <Dialog open={error !== null} onClose={() => setError(null)} title="Import failed">
        <Alert tone="danger">{error}</Alert>
        <div className="dialog-form__actions">
          <Button onClick={() => setError(null)}>Close</Button>
        </div>
      </Dialog>
      <Dialog
        open={result !== null}
        onClose={() => setResult(null)}
        title="Project imported"
        description={
          result
            ? `${result.importedFiles} file${result.importedFiles === 1 ? '' : 's'} imported · compiler: ${ENGINE_LABELS[result.detected.engine]} · main file: ${result.detected.rootFile ?? 'not found'}`
            : undefined
        }
        size="lg"
      >
        {result && !result.detected.rootFile ? (
          <Alert tone="warning">
            No .tex file with \documentclass was found. Choose the main file in the editor.
          </Alert>
        ) : null}
        {result && result.skipped.length > 0 ? (
          <>
            <p className="muted">These entries were not imported:</p>
            <ul className="import-skipped" data-testid="import-skipped">
              {result.skipped.map((s) => (
                <li key={s.path}>
                  <code>{s.path}</code> — {s.reason}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <div className="dialog-form__actions">
          <Button
            variant="primary"
            onClick={() => result && router.push(`/projects/${result.project.id}`)}
          >
            Open project
          </Button>
        </div>
      </Dialog>
    </>
  );
}
