'use client';

import { type FormEvent, useState } from 'react';
import {
  can,
  type ProjectSummary,
  ProjectSummary as ProjectSummarySchema,
} from '@latex-cloud/shared';
import { Alert, Button, Dialog, SelectField, TextField } from '@latex-cloud/ui';
import { ApiError, apiFetch } from '../../../lib/api';
import { ENGINE_OPTIONS } from '../../../lib/format';
import { useMembers } from './useMembers';

export function SettingsDialog({
  open,
  onClose,
  project,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectSummary;
  onUpdated: (p: ProjectSummary) => void;
}) {
  const isOwner = can(project.role, 'project:delete');
  const canUpdate = can(project.role, 'project:update');
  const { state: members } = useMembers(project.id, open && isOwner);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [transferTo, setTransferTo] = useState('');

  /** Runs a request, surfacing errors in the dialog. `ok` distinguishes 204s from failures. */
  async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const r = await run(() =>
      apiFetch(`/api/v1/projects/${project.id}`, ProjectSummarySchema, {
        method: 'PATCH',
        body: JSON.stringify({ name: form.get('name'), engine: form.get('engine') }),
      }),
    );
    if (r.ok) {
      onUpdated(r.value);
      setSaved(true);
    }
  }

  async function transfer() {
    const r = await run(() =>
      apiFetch(`/api/v1/projects/${project.id}/transfer-ownership`, ProjectSummarySchema, {
        method: 'POST',
        body: JSON.stringify({ userId: transferTo }),
      }),
    );
    if (r.ok) {
      onUpdated(r.value);
      onClose();
    }
  }

  async function remove() {
    const r = await run(() =>
      apiFetch(`/api/v1/projects/${project.id}`, null, { method: 'DELETE' }),
    );
    if (r.ok) window.location.assign('/projects');
  }

  const candidates =
    members.kind === 'ready' ? members.members.filter((m) => m.role !== 'owner') : [];

  return (
    <Dialog open={open} onClose={onClose} title="Project settings" size="lg">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved ? <Alert tone="info">Saved.</Alert> : null}

      <form className="dialog-form" onSubmit={save} aria-label="General settings">
        <TextField
          label="Project name"
          name="name"
          defaultValue={project.name}
          required
          maxLength={200}
          disabled={!canUpdate}
        />
        <SelectField
          label="Compiler"
          name="engine"
          defaultValue={project.engine}
          options={ENGINE_OPTIONS}
          disabled={!canUpdate}
        />
        {canUpdate ? (
          <div className="dialog-form__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              Save changes
            </Button>
          </div>
        ) : (
          <p className="muted">Viewers cannot change project settings.</p>
        )}
      </form>

      {isOwner ? (
        <section className="danger-zone" aria-labelledby="danger-zone-title">
          <h3 id="danger-zone-title">Owner actions</h3>

          <div className="danger-zone__row">
            <div>
              <strong>Transfer ownership</strong>
              <p className="muted">
                The new owner must already be a member. You will become an editor.
              </p>
            </div>
            <div className="danger-zone__controls">
              <SelectField
                label="New owner"
                hideLabel
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                options={[
                  { value: '', label: candidates.length ? 'Choose a member…' : 'No other members' },
                  ...candidates.map((m) => ({
                    value: m.userId,
                    label: `${m.displayName} (${m.email})`,
                  })),
                ]}
              />
              <Button disabled={!transferTo || busy} onClick={() => void transfer()}>
                Transfer
              </Button>
            </div>
          </div>

          <div className="danger-zone__row">
            <div>
              <strong>Delete project</strong>
              <p className="muted">
                Removes the project for every member. Type <code>{project.name}</code> to confirm.
              </p>
            </div>
            <div className="danger-zone__controls">
              <TextField
                label="Confirm project name"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
              />
              <Button
                variant="danger"
                disabled={confirmName !== project.name || busy}
                onClick={() => void remove()}
              >
                Delete project
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </Dialog>
  );
}
