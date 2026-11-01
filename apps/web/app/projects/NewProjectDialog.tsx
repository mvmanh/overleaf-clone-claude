'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProjectSummary } from '@latex-cloud/shared';
import { Alert, Button, Dialog, SelectField, TextField } from '@latex-cloud/ui';
import { ApiError, apiFetch } from '../../lib/api';
import { ENGINE_OPTIONS } from '../../lib/format';

export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const project = await apiFetch('/api/v1/projects', ProjectSummary, {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), engine: form.get('engine') }),
      });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the project.');
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title="New project"
    >
      <form id="new-project" onSubmit={onSubmit} className="dialog-form">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <TextField
          label="Project name"
          name="name"
          required
          maxLength={200}
          autoFocus
          placeholder="e.g. Topology notes"
        />
        <SelectField
          label="Compiler"
          name="engine"
          defaultValue="pdflatex"
          options={ENGINE_OPTIONS}
        />
        <div className="dialog-form__actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
