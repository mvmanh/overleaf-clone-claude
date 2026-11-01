'use client';

import { type FormEvent, type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { extensionOf, isTexRoot, type ProjectFile } from '@latex-cloud/shared';
import { Alert, Badge, Button, Dialog, TextField } from '@latex-cloud/ui';
import { ApiError } from '../../../lib/api';

interface Folder {
  name: string;
  path: string;
  folders: Folder[];
  files: ProjectFile[];
}

/** Builds a folder hierarchy from flat project paths (folders first, then files, alphabetical). */
function fileIcon(f: ProjectFile): string {
  if (isTexRoot(f.path)) return 'T';
  if (f.path.endsWith('.bib')) return 'B';
  if (f.kind === 'binary') {
    const ext = extensionOf(f.path);
    if (ext === 'pdf') return 'P';
    if (ext === 'ttf' || ext === 'otf') return 'F';
    return 'I';
  }
  return '·';
}

export function buildTree(files: ProjectFile[]): Folder {
  const root: Folder = { name: '', path: '', folders: [], files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/');
      let next = node.folders.find((d) => d.path === path);
      if (!next) node.folders.push((next = { name: parts[i]!, path, folders: [], files: [] }));
      node = next;
    }
    node.files.push(f);
  }
  const sort = (n: Folder) => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.files.sort((a, b) => a.path.localeCompare(b.path));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}

type Modal =
  | { kind: 'create'; folder: string }
  | { kind: 'rename'; file: ProjectFile }
  | { kind: 'delete'; file: ProjectFile }
  | null;

export function FileTree({
  files,
  rootFile,
  selectedId,
  canWrite,
  editors,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onSetRoot,
  upload,
  exportUrl,
}: {
  files: ProjectFile[];
  rootFile: string | null;
  selectedId: string | null;
  canWrite: boolean;
  /** Colours of collaborators who have each file open. */
  editors?: Map<string, string[]>;
  onOpen: (f: ProjectFile) => void;
  onCreate: (path: string) => Promise<void>;
  onRename: (f: ProjectFile, path: string) => Promise<void>;
  onDelete: (f: ProjectFile) => Promise<void>;
  onSetRoot: (f: ProjectFile) => Promise<void>;
  /** Uploads one file; resolves 'conflict' when the path exists and overwrite is false. */
  upload: (file: File, path: string, overwrite: boolean) => Promise<'ok' | 'conflict'>;
  exportUrl: string;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ file: File; path: string }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selected = files.find((f) => f.id === selectedId) ?? null;
  const selectedFolder = selected?.path.includes('/')
    ? selected.path.slice(0, selected.path.lastIndexOf('/'))
    : '';

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setModal(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const items = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>('[data-tree-item]') ?? [],
    );
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    } else if (canWrite && selected && e.key === 'F2') {
      e.preventDefault();
      setModal({ kind: 'rename', file: selected });
    } else if (canWrite && selected && e.key === 'Delete') {
      e.preventDefault();
      setModal({ kind: 'delete', file: selected });
    }
  }

  const renderFolder = (folder: Folder, depth: number) => (
    <>
      {folder.folders.map((d) => {
        const isOpen = !collapsed.has(d.path);
        return (
          <li key={`d:${d.path}`}>
            <button
              type="button"
              className="tree__row tree__row--folder"
              style={{ paddingLeft: 8 + depth * 14 }}
              data-tree-item
              aria-expanded={isOpen}
              onClick={() =>
                setCollapsed((s) => {
                  const n = new Set(s);
                  if (n.has(d.path)) n.delete(d.path);
                  else n.add(d.path);
                  return n;
                })
              }
            >
              <span className="tree__icon" aria-hidden>
                {isOpen ? '▾' : '▸'}
              </span>
              {d.name}
            </button>
            {isOpen ? <ul role="group">{renderFolder(d, depth + 1)}</ul> : null}
          </li>
        );
      })}
      {folder.files.map((f) => {
        const name = f.path.split('/').pop();
        const isRoot = f.path === rootFile;
        return (
          <li key={f.id}>
            <button
              type="button"
              className="tree__row"
              style={{ paddingLeft: 8 + depth * 14 }}
              data-tree-item
              data-testid="file-row"
              aria-current={f.id === selectedId ? 'true' : undefined}
              title={f.path}
              onClick={() => onOpen(f)}
            >
              <span className="tree__icon" aria-hidden>
                {fileIcon(f)}
              </span>
              <span className="tree__name">{name}</span>
              {editors?.get(f.id)?.length ? (
                <span
                  className="tree__editors"
                  aria-label={`${editors.get(f.id)!.length} collaborator(s) editing`}
                  data-testid="tree-editors"
                >
                  {editors
                    .get(f.id)!
                    .slice(0, 3)
                    .map((c, i) => (
                      <span key={i} className="tree__editor-dot" style={{ background: c }} />
                    ))}
                </span>
              ) : null}
              {isRoot ? (
                <Badge tone="accent" dot={false} title="Main file (compiled)">
                  main
                </Badge>
              ) : null}
            </button>
          </li>
        );
      })}
    </>
  );

  async function uploadAll(items: { file: File; path: string }[], overwrite: boolean) {
    setError(null);
    const conflicting: { file: File; path: string }[] = [];
    const failures: string[] = [];
    for (const [i, item] of items.entries()) {
      setUploading(`Uploading ${i + 1} / ${items.length}: ${item.path}`);
      try {
        if ((await upload(item.file, item.path, overwrite)) === 'conflict') conflicting.push(item);
      } catch (e) {
        failures.push(e instanceof ApiError ? e.message : `${item.path}: upload failed.`);
      }
    }
    setUploading(null);
    if (failures.length) setError(failures.join(' '));
    setConflicts(conflicting);
  }

  function startUpload(list: FileList | File[] | null) {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    void uploadAll(
      picked.map((file) => ({
        file,
        path: selectedFolder ? `${selectedFolder}/${file.name}` : file.name,
      })),
      false,
    );
  }

  return (
    <div
      className="tree"
      data-dragging={dragging ? 'true' : undefined}
      onDragOver={(e) => {
        if (!canWrite || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (!canWrite) return;
        e.preventDefault();
        setDragging(false);
        startUpload(e.dataTransfer.files);
      }}
      data-testid="file-tree"
    >
      {canWrite ? (
        <div className="tree__toolbar">
          <Button size="sm" onClick={() => setModal({ kind: 'create', folder: selectedFolder })}>
            New file
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fileInput.current?.click()}
            disabled={uploading !== null}
          >
            Upload
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            data-testid="upload-input"
            accept=".tex,.bib,.sty,.cls,.bst,.txt,.png,.jpg,.jpeg,.pdf,.eps,.ttf,.otf,.csv,.dat"
            onChange={(e) => {
              startUpload(e.target.files);
              e.target.value = '';
            }}
          />
          {selected ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setModal({ kind: 'rename', file: selected })}
                title="Rename (F2)"
              >
                Rename
              </Button>
              {isTexRoot(selected.path) && selected.path !== rootFile ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act(() => onSetRoot(selected))}
                >
                  Set as main
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setModal({ kind: 'delete', file: selected })}
                title="Delete (Del)"
              >
                Delete
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {uploading ? (
        <p className="tree__drop-hint" role="status">
          {uploading}
        </p>
      ) : null}
      {error && !modal ? <Alert tone="danger">{error}</Alert> : null}
      <ul
        ref={list}
        className="tree__list"
        role="tree"
        aria-label="Project files"
        onKeyDown={onKeyDown}
      >
        {renderFolder(tree, 0)}
      </ul>
      {canWrite ? (
        <p className="tree__drop-hint">
          Drop files here to upload (images, PDF, fonts, .tex, .bib).
        </p>
      ) : null}
      <div className="tree__toolbar">
        <a
          className="lc-button"
          data-size="sm"
          data-variant="ghost"
          href={exportUrl}
          download
          data-testid="download-zip"
        >
          Download ZIP
        </a>
      </div>

      <PathDialog
        open={modal?.kind === 'create'}
        title="New file"
        submitLabel="Create"
        initial={modal?.kind === 'create' && modal.folder ? `${modal.folder}/` : ''}
        hint="Use / for folders, e.g. chapters/intro.tex. Text files only (.tex, .bib, .sty, …)."
        busy={busy}
        error={modal ? error : null}
        onClose={() => {
          setModal(null);
          setError(null);
        }}
        onSubmit={(path) => act(() => onCreate(path))}
      />
      <PathDialog
        open={modal?.kind === 'rename'}
        title="Rename file"
        submitLabel="Rename"
        initial={modal?.kind === 'rename' ? modal.file.path : ''}
        hint="Moving into a folder: include the folder in the path."
        busy={busy}
        error={modal ? error : null}
        onClose={() => {
          setModal(null);
          setError(null);
        }}
        onSubmit={(path) =>
          modal?.kind === 'rename' ? act(() => onRename(modal.file, path)) : Promise.resolve()
        }
      />
      <Dialog
        open={conflicts.length > 0}
        onClose={() => setConflicts([])}
        title={
          conflicts.length === 1
            ? 'Replace existing file?'
            : `Replace ${conflicts.length} existing files?`
        }
        description={conflicts.map((c) => c.path).join(', ')}
      >
        <div className="dialog-form__actions">
          <Button onClick={() => setConflicts([])}>Keep existing</Button>
          <Button
            variant="primary"
            onClick={() => {
              const items = conflicts;
              setConflicts([]);
              void uploadAll(items, true);
            }}
          >
            Replace
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={modal?.kind === 'delete'}
        onClose={() => {
          setModal(null);
          setError(null);
        }}
        title="Delete file?"
        description={
          modal?.kind === 'delete'
            ? `“${modal.file.path}” will be removed from the project.`
            : undefined
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="dialog-form__actions">
          <Button onClick={() => setModal(null)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              modal?.kind === 'delete' ? void act(() => onDelete(modal.file)) : undefined
            }
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function PathDialog(props: {
  open: boolean;
  title: string;
  submitLabel: string;
  initial: string;
  hint: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (path: string) => Promise<void>;
}) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const path = String(new FormData(e.currentTarget).get('path') ?? '').trim();
    void props.onSubmit(path);
  }
  return (
    <Dialog open={props.open} onClose={props.onClose} title={props.title} description={props.hint}>
      <form className="dialog-form" onSubmit={submit}>
        {props.error ? <Alert tone="danger">{props.error}</Alert> : null}
        <TextField
          label="Path"
          name="path"
          defaultValue={props.initial}
          required
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
        <div className="dialog-form__actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={props.busy}>
            {props.submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
