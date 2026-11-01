'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { snippet } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { Annotation, Compartment, EditorState, type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { ProjectFile, ProjectFileWithContent } from '@latex-cloud/shared';
import { Alert, Button, Spinner } from '@latex-cloud/ui';
import { ApiError, apiFetch } from '../../../lib/api';
import type { CollabSession, FileBinding } from '../../../lib/collab/session';
import { FileSession, type SaveStatus } from '../../../lib/editor/file-session';
import { languageFor, languageName } from '../../../lib/editor/languages';
import { baseSetup, latexSetup, plainSetup } from '../../../lib/editor/latex/extension';
import { undoBoundary } from '../../../lib/editor/latex/input';
import {
  type EditorSettings,
  loadSettings,
  onSettingsChange,
} from '../../../lib/editor/latex/settings';
import { collabCursorTheme, editorTheme, syntaxTheme } from '../../../lib/editor/theme';
import { mathContextAt } from '../../../lib/latex/math-context';
import type { ProjectIndex } from '../../../lib/latex/project-index';

export interface SourceEditorHandle {
  /** Resolves when the server has every edit (or saving failed / timed out). */
  flush(): Promise<void>;
  focus(): void;
  hasUnsavedChanges(): boolean;
  /** Moves the cursor to a 1-based line and focuses the editor. */
  goToLine(line: number): void;
  /**
   * Inserts a snippet at the cursor (symbol palette). With `math`, the
   * snippet is wrapped in $…$ when the cursor is not already in math.
   */
  insert(template: string, opts?: { math?: boolean }): void;
}

/** Marks programmatic document replacements so they are not treated as user edits. */
const external = Annotation.define<boolean>();

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

/** How long a compile waits for unacknowledged collaborative edits. */
const FLUSH_TIMEOUT_MS = 8_000;

export const SourceEditor = forwardRef<
  SourceEditorHandle,
  {
    projectId: string;
    file: ProjectFile;
    readOnly: boolean;
    onStatus: (s: SaveStatus) => void;
    onSaved: (f: ProjectFile) => void;
    /** Ctrl/Cmd+Enter inside the editor. */
    onCompile: () => void;
    /** Line to reveal once the file is open (e.g. from a diagnostic). */
    jumpTo?: { line: number; nonce: number } | null;
    /** Project-wide index for completions and checks; kept in sync with this buffer. */
    index: ProjectIndex;
    /** Real-time session; null = compare-and-swap autosave. */
    collab: CollabSession | null;
    /** The file was deleted (by someone else) while open: keep the text, stop syncing. */
    deleted?: boolean;
    /** Any change to the text, local or remote (collaborative mode). */
    onEdited?: () => void;
    /** Saves the kept text of a deleted file as a new file. */
    onRecover?: (content: string) => Promise<void>;
  }
>(function SourceEditor(
  {
    projectId,
    file,
    readOnly,
    onStatus,
    onSaved,
    onCompile,
    jumpTo,
    index,
    collab,
    deleted = false,
    onEdited,
    onRecover,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const session = useRef<FileSession | null>(null);
  const binding = useRef<FileBinding | null>(null);
  const editable = useRef(new Compartment());
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [conflict, setConflict] = useState(false);
  const [gone, setGone] = useState(false);
  const [recovering, setRecovering] = useState(false);
  // Keep latest callbacks without re-creating the editor.
  const cb = useRef({ onStatus, onSaved, onCompile, onEdited });
  cb.current = { onStatus, onSaved, onCompile, onEdited };
  const indexRef = useRef(index);
  indexRef.current = index;
  const isDeleted = deleted || gone;

  useImperativeHandle(ref, () => ({
    flush: async () => {
      const b = binding.current;
      if (!b) return session.current?.flush() ?? Promise.resolve();
      // Acknowledged collaborative edits are already durable on the server.
      const end = Date.now() + FLUSH_TIMEOUT_MS;
      while (b.provider.hasUnsyncedChanges && Date.now() < end)
        await new Promise((r) => setTimeout(r, 50));
    },
    focus: () => view.current?.focus(),
    hasUnsavedChanges: () =>
      binding.current
        ? binding.current.provider.hasUnsyncedChanges
        : (session.current?.hasUnsavedChanges ?? false),
    insert: (template: string, opts?: { math?: boolean }) => {
      const v = view.current;
      if (!v || v.state.readOnly) return;
      const { from, to } = v.state.selection.main;
      const inMath = mathContextAt(v.state.doc.toString(), from).inMath;
      const body = opts?.math && !inMath ? `$${template}$` : template;
      snippet(body.includes('${') ? body : `${body}\${}`)(v, { label: 'palette' }, from, to);
      v.focus();
    },
    goToLine: (line: number) => {
      const v = view.current;
      if (!v) return;
      const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
      v.dispatch({
        selection: { anchor: l.from },
        effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
      });
      v.focus();
    },
  }));

  useEffect(() => {
    let cancelled = false;
    let unsubscribeSettings = () => {};
    const cleanups: Array<() => void> = [];
    const url = `/api/v1/projects/${projectId}/files/${file.id}`;
    setLoad({ kind: 'loading' });
    setConflict(false);
    setGone(false);

    /** Builds the editor around `doc`; `mode` adds the sync-specific parts. */
    const mount = (path: string, doc: string, mode: Extension, history: boolean) => {
      const lang = languageName(path);
      const isLatex = lang === 'latex';
      indexRef.current.update(path, doc);
      const settingsNow = () => loadSettings();
      const configure = (st: EditorSettings) => [
        baseSetup(st, { history }),
        isLatex
          ? latexSetup(
              { index: () => indexRef.current, path: () => path, settings: settingsNow },
              st,
            )
          : plainSetup(st),
        isLatex ? [] : keymap.of([indentWithTab]),
      ];
      const configurable = new Compartment();
      let indexTimer: ReturnType<typeof setTimeout> | null = null;
      view.current = new EditorView({
        parent: host.current!,
        state: EditorState.create({
          doc,
          extensions: [
            configurable.of(configure(settingsNow())),
            mode,
            Prec.highest(
              keymap.of([
                {
                  key: 'Mod-Enter',
                  preventDefault: true,
                  run: () => {
                    cb.current.onCompile();
                    return true;
                  },
                },
              ]),
            ),
            languageFor(path),
            editorTheme,
            syntaxTheme,
            editable.current.of([
              EditorState.readOnly.of(readOnly),
              EditorView.editable.of(!readOnly),
            ]),
            EditorView.contentAttributes.of({ 'aria-label': `Source of ${path}` }),
            EditorView.updateListener.of((u) => {
              if (!u.docChanged) return;
              // Keep \cite keys, labels and macros current while typing.
              if (indexTimer) clearTimeout(indexTimer);
              indexTimer = setTimeout(
                () => indexRef.current.update(path, u.state.doc.toString()),
                250,
              );
            }),
          ],
        }),
      });
      unsubscribeSettings = onSettingsChange((st) =>
        view.current?.dispatch({ effects: configurable.reconfigure(configure(st)) }),
      );
      setLoad({ kind: 'ready' });
    };

    const fail = (e: unknown) => {
      if (!cancelled)
        setLoad({
          kind: 'error',
          message:
            e instanceof ApiError
              ? e.message
              : e instanceof Error && e.message
                ? `Could not open the file (${e.message}).`
                : 'Could not open the file.',
        });
    };

    if (collab) {
      // ── Real-time mode: the Yjs document is the source of truth. ──
      const b = collab.openFile(file.id);
      binding.current = b;
      collab.setCurrentFile(file.id);
      const { provider } = b;
      const status = (): SaveStatus =>
        collab.connectionState === 'offline'
          ? { kind: 'offline' }
          : provider.hasUnsyncedChanges
            ? { kind: 'saving' }
            : { kind: 'saved' };
      const report = () => !cancelled && cb.current.onStatus(status());
      provider.on('unsyncedChanges', report);
      cleanups.push(collab.onConnection(report));
      provider.on('stateless', ({ payload }: { payload: string }) => {
        try {
          const n = JSON.parse(payload) as { type?: string };
          if (n.type === 'file-deleted' && !cancelled) setGone(true);
        } catch {
          /* ignore */
        }
      });
      b.ready
        .then(() => {
          if (cancelled || !host.current) return;
          report();
          const onChange = () => cb.current.onEdited?.();
          b.text.observe(onChange);
          cleanups.push(() => b.text.unobserve(onChange));
          mount(
            file.path,
            b.text.toString(),
            [
              yCollab(b.text, provider.awareness, { undoManager: b.undoManager }),
              collabCursorTheme,
              Prec.high(keymap.of(yUndoManagerKeymap)),
              undoBoundary.of(() => b.undoManager.stopCapturing()),
              keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => true }]),
            ],
            false,
          );
        })
        .catch(fail);
    } else {
      // ── Fallback: compare-and-swap autosave over REST. ──
      apiFetch(url, ProjectFileWithContent)
        .then((loaded) => {
          if (cancelled || !host.current) return;
          // Session-local reference: the final save on file switch runs after the
          // shared ref is cleared, and must still read *this* file's text.
          const holder: { view: EditorView | null } = { view: null };
          const s = new FileSession({
            baseSha: loaded.sha256,
            getContent: () => {
              if (!holder.view) throw new Error('editor not ready');
              return holder.view.state.doc.toString();
            },
            put: async (content, ifMatch) => {
              const saved = await apiFetch(`${url}/content`, ProjectFile, {
                method: 'PUT',
                headers: { 'If-Match': `"${ifMatch}"` },
                body: JSON.stringify({ content }),
                keepalive: content.length < 60_000, // lets a final save finish during navigation
              });
              cb.current.onSaved(saved);
              return saved;
            },
            fetchLatest: () => apiFetch(url, ProjectFileWithContent),
            onStatus: (st) => {
              setConflict(st.kind === 'conflict');
              cb.current.onStatus(st);
            },
          });
          session.current = s;
          cb.current.onStatus({ kind: 'saved' });
          mount(
            loaded.path,
            loaded.content,
            [
              keymap.of([
                {
                  key: 'Mod-s',
                  preventDefault: true,
                  run: () => {
                    void s.flush();
                    return true;
                  },
                },
              ]),
              EditorView.updateListener.of((u) => {
                if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external)))
                  s.markChanged();
              }),
            ],
            true,
          );
          holder.view = view.current;
        })
        .catch(fail);
    }

    return () => {
      cancelled = true;
      unsubscribeSettings();
      for (const c of cleanups) c();
      const s = session.current;
      // Final save of the outgoing file, then tear down.
      if (s?.hasUnsavedChanges) void s.flush().finally(() => s.dispose());
      else s?.dispose();
      session.current = null;
      view.current?.destroy();
      view.current = null;
      const b = binding.current;
      binding.current = null;
      if (b) {
        // Give unacknowledged edits a moment to reach the server before closing.
        const close = () => b.destroy();
        if (b.provider.hasUnsyncedChanges) setTimeout(close, 2_000);
        else close();
      }
      collab?.setCurrentFile(null);
    };
  }, [projectId, file.id, file.path, readOnly, collab]);

  // A deleted file keeps its text but stops syncing and becomes read-only.
  useEffect(() => {
    if (!isDeleted) return;
    binding.current?.provider.detach();
    view.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ]),
    });
  }, [isDeleted, load.kind]);

  useEffect(() => {
    if (load.kind !== 'ready' || !jumpTo) return;
    const v = view.current;
    if (!v) return;
    const l = v.state.doc.line(Math.min(Math.max(1, jumpTo.line), v.state.doc.lines));
    v.dispatch({
      selection: { anchor: l.from, head: l.to },
      effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
    });
    v.focus();
  }, [jumpTo, load.kind]);

  async function keepMine() {
    await session.current?.overwrite();
  }

  async function takeTheirs() {
    const s = session.current;
    const v = view.current;
    if (!s || !v) return;
    const content = await s.reload();
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: content },
      annotations: external.of(true),
    });
  }

  async function recover() {
    const v = view.current;
    if (!v || !onRecover) return;
    setRecovering(true);
    try {
      await onRecover(v.state.doc.toString());
    } finally {
      setRecovering(false);
    }
  }

  return (
    <div className="source-editor">
      {isDeleted ? (
        <div className="source-editor__banner" role="alert" data-testid="file-deleted-banner">
          <span>
            <strong>{file.path}</strong> was deleted. Its text is kept here (read-only) until you
            close it.
          </span>
          {onRecover ? (
            <Button size="sm" onClick={() => void recover()} disabled={recovering}>
              Save as new file
            </Button>
          ) : null}
        </div>
      ) : conflict ? (
        <div className="source-editor__banner" role="alert">
          <span>
            <strong>{file.path}</strong> was changed elsewhere after you opened it. Your edits are
            not saved.
          </span>
          <Button size="sm" onClick={() => void keepMine()}>
            Keep my version
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void takeTheirs()}>
            Load their version
          </Button>
        </div>
      ) : null}
      {load.kind === 'loading' ? (
        <div className="source-editor__center">
          <Spinner label={`Opening ${file.path}`} />
        </div>
      ) : null}
      {load.kind === 'error' ? (
        <div className="source-editor__center">
          <Alert tone="danger">{load.message}</Alert>
        </div>
      ) : null}
      <div
        ref={host}
        className="source-editor__host"
        data-testid="source-editor"
        data-mode={collab ? 'collab' : 'autosave'}
        hidden={load.kind !== 'ready'}
      />
    </div>
  );
});
