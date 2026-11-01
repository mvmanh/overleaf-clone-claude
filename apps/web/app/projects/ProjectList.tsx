'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ProjectListResponse, type ProjectSummary } from '@latex-cloud/shared';
import { Alert, Badge, Button, EmptyState, type Tone } from '@latex-cloud/ui';
import { ApiError, apiFetch } from '../../lib/api';
import { ENGINE_LABELS, relativeTime } from '../../lib/format';
import { ImportZipButton } from './ImportZipButton';
import { NewProjectDialog } from './NewProjectDialog';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; requestId?: string | undefined }
  | { kind: 'ready'; projects: ProjectSummary[] };

const ROLE_TONE: Record<ProjectSummary['role'], Tone> = {
  owner: 'accent',
  editor: 'info',
  viewer: 'neutral',
};

export function ProjectList() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    apiFetch('/api/v1/projects', ProjectListResponse)
      .then((r) => setState({ kind: 'ready', projects: r.projects }))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return; // useSession redirects
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Could not load projects.',
          requestId: e instanceof ApiError ? e.requestId : undefined,
        });
      });
  }, []);

  useEffect(load, [load]);

  // `n` opens the new-project dialog (when not typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setCreating(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Projects</h1>
          <p className="page__subtitle">Projects you own or that were shared with you.</p>
        </div>
        <div className="page__actions">
          <ImportZipButton />
          <Button variant="primary" onClick={() => setCreating(true)} title="New project (N)">
            New project
          </Button>
        </div>
      </div>
      {renderBody(state, load, () => setCreating(true))}
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function renderBody(state: State, load: () => void, create: () => void) {
  if (state.kind === 'loading') {
    return (
      <div className="project-list" aria-busy="true" aria-label="Loading projects">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" />
        ))}
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <Alert tone="danger">
        {state.message} {state.requestId ? <small>(request {state.requestId})</small> : null}{' '}
        <Button size="sm" onClick={load}>
          Retry
        </Button>
      </Alert>
    );
  }

  if (state.projects.length === 0) {
    return (
      <div className="project-list">
        <EmptyState
          title="No projects yet"
          action={
            <Button variant="primary" onClick={create}>
              Create your first project
            </Button>
          }
        >
          Create a project, or ask a collaborator to share one with you.
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <div className="project-list__head" aria-hidden>
        <span>Name</span>
        <span>Your role</span>
        <span>Engine</span>
        <span>Updated</span>
      </div>
      <ul className="project-list" aria-label="Projects">
        {state.projects.map((p) => (
          <li key={p.id}>
            <Link className="project-row" href={`/projects/${p.id}`} data-testid="project-row">
              <span>
                <div className="project-row__name">{p.name}</div>
                <div className="project-row__meta">
                  Owner: {p.owner.displayName} · {p.memberCount} member
                  {p.memberCount === 1 ? '' : 's'}
                </div>
              </span>
              <span>
                <Badge tone={ROLE_TONE[p.role]} dot={false}>
                  {p.role}
                </Badge>
              </span>
              <span className="project-row__meta">{ENGINE_LABELS[p.engine]}</span>
              <span className="project-row__meta" title={new Date(p.updatedAt).toLocaleString()}>
                {relativeTime(p.updatedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
