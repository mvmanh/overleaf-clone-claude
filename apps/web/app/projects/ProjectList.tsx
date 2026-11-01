'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ProjectListResponse, type ProjectSummary } from '@latex-cloud/shared';
import { Alert, Badge, Button, EmptyState, type Tone } from '@latex-cloud/ui';
import { ApiError, apiFetch } from '../../lib/api';
import { ENGINE_LABELS, relativeTime } from '../../lib/format';

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
        <EmptyState title="No projects yet">
          Projects shared with you will appear here. Creating and importing projects is the next
          milestone.
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
