'use client';

import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ProjectSummary } from '@latex-cloud/shared';
import { Alert, Badge, Button, EmptyState, Kbd, Spinner, ThemeToggle } from '@latex-cloud/ui';
import { useSession } from '../../../components/useSession';
import { ApiError, apiFetch } from '../../../lib/api';
import { ENGINE_LABELS } from '../../../lib/format';
import './editor.css';

type PanelId = 'tree' | 'source' | 'pdf' | 'issues';

const PANELS: { id: PanelId; label: string; key: string }[] = [
  { id: 'tree', label: 'Files', key: '1' },
  { id: 'source', label: 'Source', key: '2' },
  { id: 'pdf', label: 'PDF', key: '3' },
  { id: 'issues', label: 'Problems', key: '4' },
];

type State =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; project: ProjectSummary };

/**
 * Editor layout skeleton (PR 1). Panels are real, focusable regions with
 * keyboard navigation; their contents arrive in later milestones and say so
 * explicitly rather than pretending to work.
 */
export function EditorShell({ projectId }: { projectId: string }) {
  useSession();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const refs = useRef<Partial<Record<PanelId, HTMLElement | null>>>({});
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, ProjectSummary)
      .then((project) => !cancelled && setState({ kind: 'ready', project }))
      .catch((e: unknown) => {
        if (cancelled || (e instanceof ApiError && e.status === 401)) return;
        if (e instanceof ApiError && e.status === 404) setState({ kind: 'not-found' });
        else
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : 'Could not load project.',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const focusPanel = useCallback((id: PanelId) => refs.current[id]?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const panel = PANELS.find((p) => e.code === `Digit${p.key}`);
        if (panel) {
          e.preventDefault();
          focusPanel(panel.id);
        }
      }
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (e.key === '?' && !typing) {
        e.preventDefault();
        dialog.current?.showModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusPanel]);

  if (state.kind !== 'ready') {
    return (
      <main id="main" className="editor">
        <div className="editor__top">
          <Link href="/projects">← Projects</Link>
        </div>
        <div className="editor__center">
          {state.kind === 'loading' ? (
            <Spinner label="Loading project" />
          ) : state.kind === 'not-found' ? (
            <EmptyState
              title="Project not found"
              action={<Link href="/projects">Back to projects</Link>}
            >
              It does not exist, or you do not have access to it.
            </EmptyState>
          ) : (
            <Alert tone="danger">{state.message}</Alert>
          )}
        </div>
      </main>
    );
  }

  const { project } = state;
  const canEdit = project.role !== 'viewer';
  const panel = (id: PanelId, title: string, children: ReactNode, extra?: ReactNode) => (
    <section
      className={`panel panel--${id}`}
      aria-label={title}
      tabIndex={-1}
      ref={(el) => {
        refs.current[id] = el;
      }}
      data-testid={`panel-${id}`}
    >
      <div className="panel__header">
        {title}
        <span className="editor__spacer" />
        {extra}
      </div>
      <div className="panel__body">{children}</div>
    </section>
  );

  return (
    <main id="main" className="editor">
      <div className="editor__top">
        <Link href="/projects" aria-label="Back to projects">
          ←
        </Link>
        <h1 className="editor__project-name" data-testid="project-name">
          {project.name}
        </h1>
        <Badge tone={canEdit ? 'info' : 'neutral'} dot={false}>
          {project.role}
        </Badge>
        <span className="editor__spacer" />
        <Badge tone="neutral" title="Real-time sync is not implemented yet (Phase 2).">
          Sync: offline
        </Badge>
        <Badge tone="neutral" dot={false}>
          {ENGINE_LABELS[project.engine]}
        </Badge>
        <Button
          variant="primary"
          size="sm"
          disabled
          title="Compilation is wired up in Phase 1 (revision manifest + job queue + sandbox executor)."
        >
          Compile
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dialog.current?.showModal()}
          aria-label="Keyboard shortcuts"
        >
          <Kbd>?</Kbd>
        </Button>
        <ThemeToggle />
      </div>

      {panel(
        'tree',
        'Files',
        <EmptyState title="No files yet">
          The project file tree, uploads and ZIP import arrive in the next milestones.
        </EmptyState>,
      )}
      {panel(
        'source',
        'Source',
        <EmptyState title="Editor not available yet">
          CodeMirror 6 editing with LaTeX highlighting lands in PR 3; collaborative editing in Phase
          2.
        </EmptyState>,
      )}
      {panel(
        'pdf',
        'PDF',
        <EmptyState title="No PDF yet">
          Compiled output will appear here. A failed compile will never replace the last good PDF.
        </EmptyState>,
      )}
      {panel(
        'issues',
        'Problems',
        <EmptyState title="No compile has run">
          Errors and warnings will be listed here with click-to-line.
        </EmptyState>,
        <Badge tone="neutral" dot={false}>
          0
        </Badge>,
      )}

      <dialog
        ref={dialog}
        className="shortcuts"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      >
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <table>
          <tbody>
            {PANELS.map((p) => (
              <tr key={p.id}>
                <td>Focus {p.label}</td>
                <td>
                  <Kbd>Alt</Kbd> <Kbd>{p.key}</Kbd>
                </td>
              </tr>
            ))}
            <tr>
              <td>Change theme</td>
              <td>
                <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>T</Kbd>
              </td>
            </tr>
            <tr>
              <td>Show shortcuts</td>
              <td>
                <Kbd>?</Kbd>
              </td>
            </tr>
          </tbody>
        </table>
        <form method="dialog" style={{ marginTop: 16, textAlign: 'right' }}>
          <Button type="submit" size="sm" autoFocus>
            Close
          </Button>
        </form>
      </dialog>
    </main>
  );
}
