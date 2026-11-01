'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { ProjectFile, ProjectFileWithContent } from '@latex-cloud/shared';
import { Alert, Button, Spinner } from '@latex-cloud/ui';
import { ApiError, apiFetch } from '../../../lib/api';
import { latexCompletions } from '../../../lib/editor/completions';
import { FileSession, type SaveStatus } from '../../../lib/editor/file-session';
import { languageFor, languageName } from '../../../lib/editor/languages';
import { editorTheme, syntaxTheme } from '../../../lib/editor/theme';

export interface SourceEditorHandle {
  /** Saves pending edits now. Resolves when the server has them (or saving failed). */
  flush(): Promise<void>;
  focus(): void;
  hasUnsavedChanges(): boolean;
  /** Moves the cursor to a 1-based line and focuses the editor. */
  goToLine(line: number): void;
}

/** Marks programmatic document replacements so they are not treated as user edits. */
const external = Annotation.define<boolean>();

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

export const SourceEditor = forwardRef<
  SourceEditorHandle,
  {
    projectId: string;
    file: ProjectFile;
    readOnly: boolean;
    onStatus: (s: SaveStatus) => void;
    onSaved: (f: ProjectFile) => void;
  }
>(function SourceEditor({ projectId, file, readOnly, onStatus, onSaved }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const session = useRef<FileSession | null>(null);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [conflict, setConflict] = useState(false);
  // Keep latest callbacks without re-creating the editor.
  const cb = useRef({ onStatus, onSaved });
  cb.current = { onStatus, onSaved };

  useImperativeHandle(ref, () => ({
    flush: () => session.current?.flush() ?? Promise.resolve(),
    focus: () => view.current?.focus(),
    hasUnsavedChanges: () => session.current?.hasUnsavedChanges ?? false,
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
    const url = `/api/v1/projects/${projectId}/files/${file.id}`;
    setLoad({ kind: 'loading' });
    setConflict(false);

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

        const isLatex = languageName(loaded.path) === 'latex';
        view.current = holder.view = new EditorView({
          parent: host.current,
          state: EditorState.create({
            doc: loaded.content,
            extensions: [
              basicSetup,
              keymap.of([
                indentWithTab,
                {
                  key: 'Mod-s',
                  preventDefault: true,
                  run: () => {
                    void s.flush();
                    return true;
                  },
                },
              ]),
              languageFor(loaded.path),
              isLatex
                ? EditorState.languageData.of(() => [{ autocomplete: latexCompletions }])
                : [],
              editorTheme,
              syntaxTheme,
              EditorView.lineWrapping,
              EditorState.readOnly.of(readOnly),
              EditorView.editable.of(!readOnly),
              EditorView.contentAttributes.of({ 'aria-label': `Source of ${loaded.path}` }),
              EditorView.updateListener.of((u) => {
                if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external)))
                  s.markChanged();
              }),
            ],
          }),
        });
        setLoad({ kind: 'ready' });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setLoad({
            kind: 'error',
            message: e instanceof ApiError ? e.message : 'Could not open the file.',
          });
      });

    return () => {
      cancelled = true;
      const s = session.current;
      // Final save of the outgoing file, then tear down.
      if (s?.hasUnsavedChanges) void s.flush().finally(() => s.dispose());
      else s?.dispose();
      session.current = null;
      view.current?.destroy();
      view.current = null;
    };
  }, [projectId, file.id, readOnly]);

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

  return (
    <div className="source-editor">
      {conflict ? (
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
        hidden={load.kind !== 'ready'}
      />
    </div>
  );
});
