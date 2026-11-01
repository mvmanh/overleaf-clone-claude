'use client';

import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  can,
  ProjectFile,
  ProjectFileListResponse,
  ProjectSummary,
  type ProjectFile as ProjectFileT,
  UploadFileResponse,
} from '@latex-cloud/shared';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Kbd,
  Spinner,
  ThemeToggle,
  type Tone,
} from '@latex-cloud/ui';
import { useSession } from '../../../components/useSession';
import { ApiError, apiFetch } from '../../../lib/api';
import type { SaveStatus } from '../../../lib/editor/file-session';
import { ENGINE_LABELS } from '../../../lib/format';
import './editor.css';
import 'katex/dist/katex.min.css';
import { useProjectIndex } from '../../../lib/latex/use-project-index';
import { AssetPreview } from './AssetPreview';
import { EditorSettingsDialog } from './EditorSettingsDialog';
import { HelpDialog } from './HelpDialog';
import { SymbolPalette } from './SymbolPalette';
import { FileTree } from './FileTree';
import { SettingsDialog } from './SettingsDialog';
import { PdfViewer } from './PdfViewer';
import { ProblemsPanel } from './ProblemsPanel';
import { ShareDialog } from './ShareDialog';
import { SourceEditor, type SourceEditorHandle } from './SourceEditor';
import { useCompile } from './useCompile';

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

const SAVE_LABEL: Record<SaveStatus['kind'], [string, Tone]> = {
  saved: ['Saved', 'success'],
  dirty: ['Unsaved changes', 'warning'],
  saving: ['Saving…', 'info'],
  conflict: ['Conflict', 'danger'],
  error: ['Not saved', 'danger'],
};

const lastOpenedKey = (projectId: string) => `lc-last-file:${projectId}`;

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** Project workspace: file tree, source editor, PDF and problems panels. */
export function EditorShell({ projectId }: { projectId: string }) {
  const { user } = useSession();
  const narrow = useNarrow();
  const [openDialog, setOpenDialog] = useState<'share' | 'settings' | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [files, setFiles] = useState<ProjectFileT[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const refs = useRef<Partial<Record<PanelId, HTMLElement | null>>>({});
  const source = useRef<SourceEditorHandle>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [jumpTo, setJumpTo] = useState<{ line: number; nonce: number } | null>(null);
  /** Bumped when the open file is replaced by an upload, to reload the editor. */
  const [reloadNonce, setReloadNonce] = useState(0);
  /** Saves since the PDF on screen was built: the PDF may be out of date. */
  const [editedSinceCompile, setEditedSinceCompile] = useState(false);

  const flushEditor = useCallback(async () => {
    await source.current?.flush();
  }, []);
  const build = useCompile(projectId, flushEditor);
  const { compile } = build;
  const compileNow = useCallback(() => {
    setEditedSinceCompile(false);
    void compile();
  }, [compile]);

  const reloadProject = useCallback(() => {
    apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, ProjectSummary)
      .then((project) => setState({ kind: 'ready', project }))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return;
        if (e instanceof ApiError && e.status === 404) setState({ kind: 'not-found' });
        else
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : 'Could not load project.',
          });
      });
  }, [projectId]);

  const reloadFiles = useCallback(async () => {
    try {
      const r = await apiFetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/files`,
        ProjectFileListResponse,
      );
      setFiles(r.files);
      setFilesError(null);
      return r;
    } catch (e) {
      if (!(e instanceof ApiError && (e.status === 401 || e.status === 404))) {
        setFilesError(e instanceof ApiError ? e.message : 'Could not load files.');
      }
      return null;
    }
  }, [projectId]);

  useEffect(reloadProject, [reloadProject]);

  // Initial file selection: last opened (this browser), else the main file.
  useEffect(() => {
    void reloadFiles().then((r) => {
      if (!r) return;
      let remembered: string | null = null;
      try {
        remembered = localStorage.getItem(lastOpenedKey(projectId));
      } catch {
        /* storage unavailable */
      }
      const pick =
        r.files.find((f) => f.id === remembered) ??
        r.files.find((f) => f.path === r.rootFile) ??
        r.files.find((f) => f.kind === 'text') ??
        null;
      setSelectedId(pick?.id ?? null);
    });
  }, [projectId, reloadFiles]);

  const openFile = useCallback(
    (f: ProjectFileT) => {
      setSelectedId(f.id);
      try {
        localStorage.setItem(lastOpenedKey(projectId), f.id);
      } catch {
        /* ignore */
      }
    },
    [projectId],
  );

  // Warn before leaving with edits the server does not have.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (source.current?.hasUnsavedChanges()) {
        void source.current.flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const focusPanel = useCallback((id: PanelId) => {
    if (id === 'source' && source.current) source.current.focus();
    else refs.current[id]?.focus();
  }, []);

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
        setHelpOpen(true);
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.defaultPrevented) {
        e.preventDefault();
        compileNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusPanel, compileNow]);

  const openPath = files?.find((f) => f.id === selectedId)?.path ?? null;
  const index = useProjectIndex(projectId, files, openPath);

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
  const canWrite = can(project.role, 'files:write');
  const selected = files?.find((f) => f.id === selectedId) ?? null;
  const base = `/api/v1/projects/${project.id}`;

  const panel = (id: PanelId, title: ReactNode, children: ReactNode, extra?: ReactNode) => (
    <section
      className={`panel panel--${id}`}
      aria-label={typeof title === 'string' ? title : PANELS.find((p) => p.id === id)?.label}
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

  const tree = panel(
    'tree',
    'Files',
    files === null ? (
      filesError ? (
        <Alert tone="danger">{filesError}</Alert>
      ) : (
        <div className="editor__center">
          <Spinner label="Loading files" />
        </div>
      )
    ) : (
      <FileTree
        files={files}
        rootFile={project.rootFile}
        selectedId={selectedId}
        canWrite={canWrite}
        onOpen={openFile}
        onCreate={async (path) => {
          const f = await apiFetch(`${base}/files`, ProjectFile, {
            method: 'POST',
            body: JSON.stringify({ path }),
          });
          await reloadFiles();
          openFile(f);
        }}
        onRename={async (f, path) => {
          await source.current?.flush();
          await apiFetch(`${base}/files/${f.id}`, ProjectFile, {
            method: 'PATCH',
            body: JSON.stringify({ path }),
          });
          await reloadFiles();
          reloadProject(); // root path may have moved
        }}
        onDelete={async (f) => {
          await apiFetch(`${base}/files/${f.id}`, null, { method: 'DELETE' });
          const r = await reloadFiles();
          if (f.id === selectedId)
            setSelectedId(r?.files.find((x) => x.path === project.rootFile)?.id ?? null);
        }}
        exportUrl={`${base}/export.zip`}
        upload={async (file, path, overwrite) => {
          await source.current?.flush(); // replacing the open file must not race a pending save
          const form = new FormData();
          form.set('path', path);
          if (overwrite) form.set('overwrite', 'true');
          form.set('file', file, file.name);
          try {
            const r = await apiFetch(`${base}/files/upload`, UploadFileResponse, {
              method: 'POST',
              body: form,
            });
            await reloadFiles();
            if (r.replaced && r.file.id === selectedId) setReloadNonce((n) => n + 1);
            if (!r.replaced) openFile(r.file);
            return 'ok';
          } catch (e) {
            if (e instanceof ApiError && e.status === 409 && !overwrite) return 'conflict';
            throw e;
          }
        }}
        onSetRoot={async (f) => {
          const p = await apiFetch(base, ProjectSummary, {
            method: 'PATCH',
            body: JSON.stringify({ rootFile: f.path }),
          });
          setState({ kind: 'ready', project: p });
        }}
      />
    ),
  );

  const editorPanel = panel(
    'source',
    selected ? <span className="panel__path">{selected.path}</span> : 'Source',
    selected && selected.kind === 'binary' ? (
      <AssetPreview key={selected.id + selected.sha256} projectId={project.id} file={selected} />
    ) : selected ? (
      <div className="source-wrap">
        <SourceEditor
          ref={source}
          key={`${selected.id}:${reloadNonce}`}
          projectId={project.id}
          file={selected}
          readOnly={!canWrite}
          onStatus={setSaveStatus}
          onSaved={(saved) => {
            setFiles((fs) => fs?.map((f) => (f.id === saved.id ? saved : f)) ?? fs);
            setEditedSinceCompile(true);
          }}
          onCompile={compileNow}
          jumpTo={jumpTo}
          index={index}
        />
        {paletteOpen && canWrite ? (
          <SymbolPalette
            onInsert={(tex) => source.current?.insert(tex, { math: true })}
            onClose={() => {
              setPaletteOpen(false);
              source.current?.focus();
            }}
          />
        ) : null}
      </div>
    ) : (
      <EmptyState title={files?.length ? 'No file open' : 'No files yet'}>
        {files?.length
          ? 'Choose a file in the tree.'
          : canWrite
            ? 'Create a file to start writing.'
            : 'This project is empty.'}
      </EmptyState>
    ),
    <>
      {canWrite ? null : (
        <Badge tone="neutral" dot={false}>
          read-only
        </Badge>
      )}
      {selected && selected.kind === 'text' && canWrite ? (
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={paletteOpen}
          onClick={() => setPaletteOpen((o) => !o)}
          title="Math symbol palette"
          data-testid="palette-toggle"
        >
          Σ Symbols
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setSettingsOpen(true)}
        title="Editor settings"
        aria-label="Editor settings"
      >
        ⚙
      </Button>
    </>,
  );

  const latest = build.latest;
  const shown = build.lastSuccessful;
  const latestFailed = latest !== null && latest.status === 'failed';
  const pdfPanel = panel(
    'pdf',
    'PDF',
    <>
      {shown && latestFailed ? (
        <div className="pdf-banner" data-tone="warning" role="status" data-testid="pdf-previous">
          Showing the PDF from the previous successful compile. The latest compile failed — see
          Problems.
        </div>
      ) : shown &&
        (editedSinceCompile ||
          (latest && latest.id !== shown.id && latest.status !== 'succeeded')) ? (
        <div className="pdf-banner" data-tone="info" role="status">
          Source changed since this PDF was built.{' '}
          <Button size="sm" variant="ghost" onClick={compileNow} disabled={build.busy}>
            Compile latest
          </Button>
        </div>
      ) : null}
      {shown ? (
        <PdfViewer
          url={`/api/v1/compiles/${shown.id}/artifacts/pdf`}
          fileName={`${project.name.replace(/[^\w.-]+/g, '_') || 'document'}.pdf`}
        />
      ) : build.busy ? (
        <div className="source-editor__center">
          <Spinner label="Compiling" />
        </div>
      ) : (
        <EmptyState
          title="No PDF yet"
          action={
            <Button variant="primary" onClick={compileNow}>
              Compile
            </Button>
          }
        >
          Compile to see the PDF here. A failed compile never replaces the last good PDF.
        </EmptyState>
      )}
    </>,
  );

  const errorCount = latest?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
  const issuesPanel = panel(
    'issues',
    'Problems',
    <ProblemsPanel
      job={latest}
      onJump={(d) => {
        const target = d.file
          ? files?.find((f) => f.path === d.file)
          : files?.find((f) => f.path === latest?.rootFile);
        if (!target || !d.line) return;
        openFile(target);
        setJumpTo({ line: d.line, nonce: Date.now() });
      }}
    />,
    errorCount > 0 ? (
      <Badge tone="danger" dot={false}>
        {errorCount}
      </Badge>
    ) : null,
  );

  const compileLabel = !latest
    ? null
    : latest.status === 'queued'
      ? ['Queued…', 'info']
      : ['preparing', 'running', 'publishing'].includes(latest.status)
        ? ['Compiling…', 'info']
        : latest.status === 'succeeded'
          ? [
              `Compiled${latest.timings.totalMs ? ` in ${(latest.timings.totalMs / 1000).toFixed(1)} s` : ''}${latest.cacheHit ? ' (cached)' : ''}`,
              'success',
            ]
          : latest.status === 'failed'
            ? [
                latest.outcome === 'compile-error'
                  ? `Compile failed (${errorCount} error${errorCount === 1 ? '' : 's'})`
                  : (latest.message ?? 'Compile failed'),
                'danger',
              ]
            : null;

  const [saveLabel, saveTone] = saveStatus ? SAVE_LABEL[saveStatus.kind] : ['', 'neutral' as Tone];

  return (
    <main id="main" className="editor">
      <div className="editor__top">
        <Link href="/projects" aria-label="Back to projects">
          ←
        </Link>
        <h1 className="editor__project-name" data-testid="project-name">
          {project.name}
        </h1>
        <Badge tone={canWrite ? 'info' : 'neutral'} dot={false}>
          {project.role}
        </Badge>
        <span className="editor__spacer" />
        {saveStatus && selected ? (
          <span data-testid="save-status" aria-live="polite">
            <Badge
              tone={saveTone}
              title={saveStatus.kind === 'error' ? saveStatus.message : undefined}
            >
              {saveLabel}
            </Badge>
          </span>
        ) : null}
        <Badge tone="neutral" dot={false}>
          {ENGINE_LABELS[project.engine]}
        </Badge>
        {build.error ? (
          <Badge tone="danger" title={build.error}>
            {build.error.length > 60 ? 'Compile unavailable' : build.error}
          </Badge>
        ) : compileLabel ? (
          <span data-testid="compile-status" aria-live="polite">
            <Badge tone={compileLabel[1] as Tone}>{compileLabel[0]}</Badge>
          </span>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          onClick={compileNow}
          disabled={build.busy}
          title="Compile (Ctrl/⌘+Enter)"
          data-testid="compile-button"
        >
          {build.busy ? 'Compiling…' : 'Compile'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHelpOpen(true)}
          aria-label="Help: shortcuts and snippets"
        >
          <Kbd>?</Kbd>
        </Button>
        <Button size="sm" onClick={() => setOpenDialog('share')}>
          Share
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpenDialog('settings')}>
          Settings
        </Button>
        <ThemeToggle />
      </div>

      <ShareDialog
        open={openDialog === 'share'}
        onClose={() => setOpenDialog(null)}
        project={project}
        currentUserId={user?.id}
        onChanged={reloadProject}
      />
      <SettingsDialog
        open={openDialog === 'settings'}
        onClose={() => setOpenDialog(null)}
        project={project}
        onUpdated={(p) => setState({ kind: 'ready', project: p })}
      />

      <div className="editor__workspace">
        <PanelGroup
          direction={narrow ? 'vertical' : 'horizontal'}
          autoSaveId={narrow ? 'lc-layout-outer-narrow' : 'lc-layout-outer'}
        >
          <Panel id="tree" order={1} defaultSize={narrow ? 20 : 18} minSize={10} collapsible>
            {tree}
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel id="main" order={2} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="lc-layout-main">
              <Panel id="work" order={1} minSize={25}>
                <PanelGroup
                  direction={narrow ? 'vertical' : 'horizontal'}
                  autoSaveId={narrow ? 'lc-layout-work-narrow' : 'lc-layout-work'}
                >
                  <Panel id="source" order={1} minSize={20}>
                    {editorPanel}
                  </Panel>
                  <PanelResizeHandle className="resize-handle" />
                  <Panel id="pdf" order={2} minSize={15} collapsible>
                    {pdfPanel}
                  </Panel>
                </PanelGroup>
              </Panel>
              <PanelResizeHandle className="resize-handle" />
              <Panel id="issues" order={2} defaultSize={20} minSize={8} collapsible>
                {issuesPanel}
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <EditorSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
