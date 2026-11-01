'use client';

import { type FormEvent, useState } from 'react';
import {
  type AssignableRole,
  can,
  ProjectMembersResponse,
  type ProjectMember,
  type ProjectSummary,
} from '@latex-cloud/shared';
import { Alert, Badge, Button, Dialog, SelectField, Spinner, TextField } from '@latex-cloud/ui';
import { ApiError, apiFetch } from '../../../lib/api';
import { useMembers } from './useMembers';

const ROLE_OPTIONS = [
  { value: 'editor', label: 'Can edit' },
  { value: 'viewer', label: 'Can view' },
] as const;

export function ShareDialog({
  open,
  onClose,
  project,
  currentUserId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectSummary;
  currentUserId: string | undefined;
  onChanged: () => void;
}) {
  const { state, setState, reload } = useMembers(project.id, open);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const manage = can(project.role, 'members:manage');
  const base = `/api/v1/projects/${project.id}/members`;

  async function mutate(fn: () => Promise<ProjectMember[] | void>) {
    setBusy(true);
    setError(null);
    try {
      const members = await fn();
      if (members) setState({ kind: 'ready', members });
      else reload();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const ok = await mutate(
      async () =>
        (
          await apiFetch(`${base}/invite`, ProjectMembersResponse, {
            method: 'POST',
            body: JSON.stringify({ email: form.get('email'), role: form.get('role') }),
          })
        ).members,
    );
    if (ok) formEl.reset();
  }

  const changeRole = (m: ProjectMember, role: AssignableRole) =>
    mutate(
      async () =>
        (
          await apiFetch(`${base}/${m.userId}`, ProjectMembersResponse, {
            method: 'PATCH',
            body: JSON.stringify({ role }),
          })
        ).members,
    );

  const remove = (m: ProjectMember) =>
    mutate(async () => {
      await apiFetch(`${base}/${m.userId}`, null, { method: 'DELETE' });
    });

  async function leave() {
    if (!currentUserId) return;
    setBusy(true);
    try {
      await apiFetch(`${base}/${currentUserId}`, null, { method: 'DELETE' });
      window.location.assign('/projects');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not leave the project.');
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={`Share “${project.name}”`}
      description={
        manage ? 'Invite people who already have an account.' : 'Only the owner can manage members.'
      }
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {manage ? (
        <form className="share-invite" onSubmit={invite} aria-label="Invite a member">
          <TextField
            label="Email"
            name="email"
            type="email"
            required
            placeholder="name@example.com"
          />
          <SelectField
            label="Permission"
            name="role"
            defaultValue="editor"
            options={ROLE_OPTIONS}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            Invite
          </Button>
        </form>
      ) : null}

      {state.kind === 'loading' ? (
        <Spinner label="Loading members" />
      ) : state.kind === 'error' ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : (
        <ul className="member-list" aria-label="Members">
          {state.members.map((m) => {
            const isSelf = m.userId === currentUserId;
            return (
              <li key={m.userId} className="member" data-testid="member-row">
                <span className="member__avatar" aria-hidden>
                  {m.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="member__who">
                  <span className="member__name">
                    {m.displayName}
                    {isSelf ? ' (you)' : ''}
                  </span>
                  <span className="member__email">{m.email}</span>
                </span>
                {m.role === 'owner' ? (
                  <Badge tone="accent" dot={false}>
                    owner
                  </Badge>
                ) : manage ? (
                  <>
                    <SelectField
                      label={`Permission for ${m.displayName}`}
                      hideLabel
                      value={m.role}
                      disabled={busy}
                      options={ROLE_OPTIONS}
                      onChange={(e) => void changeRole(m, e.target.value as AssignableRole)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void remove(m)}
                      aria-label={`Remove ${m.displayName}`}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <>
                    <Badge tone={m.role === 'editor' ? 'info' : 'neutral'} dot={false}>
                      {m.role}
                    </Badge>
                    {isSelf ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void leave()}
                      >
                        Leave
                      </Button>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
