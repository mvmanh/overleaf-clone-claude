'use client';

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HistoryLabel,
  HistoryListResponse,
  type HistoryVersion,
  HistoryVersionDetail,
  initialsOf,
  collabColorFor,
  type ProjectFile,
  ProjectFileWithContent,
  RestoreVersionResponse,
} from '@latex-cloud/shared';
import { Alert, Button, Dialog, EmptyState, Spinner, TextField } from '@latex-cloud/ui';
import { ApiError, apiFetch } from '../../../lib/api';
import { computeDiff, type DiffRow, expandGap } from '../../../lib/history/diff';
import { buildTimeline, SOURCE_LABEL } from '../../../lib/history/group';

type Compare = 'previous' | 'current';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function Authors({ people }: { people: HistoryVersion['authors'] }) {
  if (!people.length) return null;
  return (
    <span className="history__authors">
      {people.slice(0, 3).map((p) => (
        <span
          key={p.id}
          className="history__author"
          style={{ background: collabColorFor(p.id).color }}
          title={p.name}
        >
          {initialsOf(p.name)}
        </span>
      ))}
      <span className="history__author-names">{people.map((p) => p.name).join(', ')}</span>
    </span>
  );
}

/**
 * Project history: a timeline of file checkpoints and labels, a diff of the
 * selected checkpoint (against the one before it, or against the current
 * text), and actions to restore a file, label the current state, or download
 * the whole project as it was.
 */
export function HistoryView({
  projectId,
  files,
  canWrite,
  currentUserId,
  isOwner,
  refreshKey,
  onRestored,
  onOpenFile,
  onClose,
}: {
  projectId: string;
  files: ProjectFile[];
  canWrite: boolean;
  currentUserId: string | undefined;
  isOwner: boolean;
  /** Bumped by the shell when files change elsewhere: reload the list. */
  refreshKey: number;
  onRestored: (file: ProjectFile) => void;
  /** Leaves history and opens a file in the editor. */
  onOpenFile: (file: ProjectFile) => void;
  onClose: () => void;
}) {
  const base = `/api/v1/projects/${projectId}/history`;
  const [versions, setVersions] = useState<HistoryVersion[] | null>(null);
  const [labels, setLabels] = useState<HistoryLabel[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryVersionDetail | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [compare, setCompare] = useState<Compare>('previous');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelName, setLabelName] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; file?: ProjectFile } | null>(null);
  const [expanded, setExpanded] = useState<Record<number, DiffRow[]>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (opts: { more?: boolean; selectNewest?: boolean } = {}) => {
      try {
        const q = new URLSearchParams();
        if (fileFilter) q.set('file', fileFilter);
        if (opts.more && cursor) q.set('before', cursor);
        const r = await apiFetch(`${base}?${q}`, HistoryListResponse);
        setVersions((prev) => (opts.more && prev ? [...prev, ...r.versions] : r.versions));
        if (!opts.more) setLabels(r.labels);
        setCursor(r.nextCursor);
        setError(null);
        if (!opts.more)
          setSelectedId((sel) =>
            !opts.selectNewest && sel && r.versions.some((v) => v.id === sel)
              ? sel
              : (r.versions[0]?.id ?? null),
          );
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not load the history.');
      }
    },
    [base, cursor, fileFilter],
  );

  // (Re)load on open, filter change and external changes.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `cursor` only matters for "Load older"
  }, [fileFilter, refreshKey]);

  // Details (and the current text, for "compare with current").
  useEffect(() => {
    if (!selectedId) return setDetail(null);
    let live = true;
    setLoadingDetail(true);
    setExpanded({});
    apiFetch(`${base}/versions/${selectedId}`, HistoryVersionDetail)
      .then(async (d) => {
        if (!live) return;
        setDetail(d);
        const exists = files.some((f) => f.id === d.version.fileId);
        if (exists && d.version.kind === 'text') {
          const f = await apiFetch(
            `/api/v1/projects/${projectId}/files/${d.version.fileId}`,
            ProjectFileWithContent,
          ).catch(() => null);
          if (live) setCurrent(f?.content ?? null);
        } else if (live) setCurrent(null);
      })
      .catch(
        (e: unknown) =>
          live && setError(e instanceof ApiError ? e.message : 'Could not load the version.'),
      )
      .finally(() => live && setLoadingDetail(false));
    return () => {
      live = false;
    };
  }, [base, selectedId, projectId, files]);

  const days = useMemo(() => buildTimeline(versions ?? [], labels), [versions, labels]);
  const flat = useMemo(
    () => days.flatMap((d) => d.items).flatMap((i) => (i.kind === 'version' ? [i.version] : [])),
    [days],
  );

  const sides = useMemo(() => {
    if (!detail || detail.version.kind !== 'text') return null;
    const thisText = detail.content ?? '';
    if (compare === 'current') {
      if (current === null) return null;
      return {
        before: thisText,
        after: current,
        beforeLabel: 'this version',
        afterLabel: 'current',
      };
    }
    if (detail.version.source === 'delete')
      return { before: thisText, after: '', beforeLabel: 'before deletion', afterLabel: 'deleted' };
    return {
      before: detail.previous?.content ?? '',
      after: thisText,
      beforeLabel: detail.previous ? `${dateTime(detail.previous.version.createdAt)}` : 'empty',
      afterLabel: 'this version',
    };
  }, [detail, compare, current]);
  const diff = useMemo(() => (sides ? computeDiff(sides.before, sides.after) : null), [sides]);

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = flat.findIndex((v) => v.id === selectedId);
    const next = flat[Math.min(Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)), flat.length - 1)];
    if (next) {
      setSelectedId(next.id);
      listRef.current?.querySelector<HTMLElement>(`[data-version="${next.id}"]`)?.focus();
    }
  }

  async function restore() {
    if (!detail) return;
    setBusy(true);
    try {
      const r = await apiFetch(
        `${base}/versions/${detail.version.id}/restore`,
        RestoreVersionResponse,
        {
          method: 'POST',
        },
      );
      setConfirmRestore(false);
      setNotice({
        text: r.samePath
          ? `${r.file.path} was restored to the version from ${dateTime(detail.version.createdAt)}.`
          : `${detail.version.path} was restored as ${r.file.path} (its old name is taken).`,
        file: r.file,
      });
      onRestored(r.file);
      await load({ selectNewest: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not restore.');
      setConfirmRestore(false);
    } finally {
      setBusy(false);
    }
  }

  async function createLabel() {
    setBusy(true);
    try {
      await apiFetch(base + '/labels', HistoryLabel, {
        method: 'POST',
        body: JSON.stringify({ name: labelName }),
      });
      setLabelOpen(false);
      setLabelName('');
      await load({ selectNewest: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the label.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteLabel(l: HistoryLabel) {
    try {
      await apiFetch(`${base}/labels/${l.id}`, null, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove the label.');
    }
  }

  const v = detail?.version;
  const filterOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of files) seen.set(f.id, f.path);
    for (const x of versions ?? [])
      if (!seen.has(x.fileId)) seen.set(x.fileId, `${x.path} (deleted)`);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [files, versions]);

  return (
    <div className="history" data-testid="history">
      <aside className="history__timeline" aria-label="Versions">
        <div className="history__head">
          <strong>History</strong>
          <span className="editor__spacer" />
          {canWrite ? (
            <Button size="sm" onClick={() => setLabelOpen(true)} data-testid="label-current">
              Label current version
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close history">
            ✕
          </Button>
        </div>
        <div className="history__filter">
          <label className="lc-visually-hidden" htmlFor="history-file">
            Show history of
          </label>
          <select
            id="history-file"
            className="lc-input lc-select"
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value)}
          >
            <option value="">All files</option>
            {filterOptions.map(([id, path]) => (
              <option key={id} value={id}>
                {path}
              </option>
            ))}
          </select>
        </div>
        <div
          className="history__list"
          ref={listRef}
          onKeyDown={onListKey}
          role="listbox"
          aria-label="Versions, newest first"
        >
          {versions === null ? (
            <div className="editor__center">
              <Spinner label="Loading history" />
            </div>
          ) : versions.length === 0 ? (
            <EmptyState title="No history yet">Edits appear here as you work.</EmptyState>
          ) : (
            days.map((day) => (
              <section key={day.key} className="history__day">
                <h3 className="history__day-title">{day.title}</h3>
                {day.items.map((item) =>
                  item.kind === 'label' ? (
                    <div
                      key={`l:${item.label.id}`}
                      className="history__label"
                      data-testid="history-label"
                    >
                      <span className="history__label-tag" title={item.label.name}>
                        🏷 {item.label.name}
                      </span>
                      <span className="history__meta">
                        {time(item.label.createdAt)}
                        {item.label.createdBy ? ` · ${initialsOf(item.label.createdBy.name)}` : ''}
                      </span>
                      <span className="editor__spacer" />
                      <a
                        className="history__link"
                        href={`${base}/export.zip?label=${item.label.id}`}
                        title="Download the project as it was at this label"
                      >
                        ZIP
                      </a>
                      {canWrite && (item.label.createdBy?.id === currentUserId || isOwner) ? (
                        <button
                          type="button"
                          className="history__icon-button"
                          aria-label={`Remove label ${item.label.name}`}
                          onClick={() => void deleteLabel(item.label)}
                        >
                          ✕
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      key={item.version.id}
                      type="button"
                      role="option"
                      aria-selected={item.version.id === selectedId}
                      data-version={item.version.id}
                      data-testid="history-version"
                      className="history__version"
                      tabIndex={item.version.id === selectedId ? 0 : -1}
                      onClick={() => setSelectedId(item.version.id)}
                    >
                      <span className="history__version-top">
                        <span className="history__time">{time(item.version.createdAt)}</span>
                        <span className="history__path">{item.version.path}</span>
                        <span className={`history__source history__source--${item.version.source}`}>
                          {SOURCE_LABEL[item.version.source]}
                        </span>
                      </span>
                      <Authors people={item.version.authors} />
                    </button>
                  ),
                )}
              </section>
            ))
          )}
          {cursor ? (
            <div className="history__more">
              <Button size="sm" variant="ghost" onClick={() => void load({ more: true })}>
                Load older versions
              </Button>
            </div>
          ) : null}
        </div>
      </aside>

      <section className="history__detail" aria-label="Selected version">
        {error ? (
          <Alert tone="danger">
            {error}{' '}
            <Button size="sm" variant="ghost" onClick={() => setError(null)}>
              Dismiss
            </Button>
          </Alert>
        ) : null}
        {notice ? (
          <div className="history__notice" role="status">
            <span>{notice.text}</span>
            <span className="editor__spacer" />
            {notice.file ? (
              <Button size="sm" onClick={() => onOpenFile(notice.file!)}>
                Open {notice.file.path.split('/').pop()}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
              OK
            </Button>
          </div>
        ) : null}
        {!v ? (
          loadingDetail ? (
            <div className="editor__center">
              <Spinner label="Loading version" />
            </div>
          ) : (
            <EmptyState title="Choose a version">Select a version to see what changed.</EmptyState>
          )
        ) : (
          <>
            <div className="history__detail-head">
              <div className="history__detail-title">
                <strong>{v.path}</strong>
                <span className="history__meta">
                  {SOURCE_LABEL[v.source]} {dateTime(v.createdAt)}
                  {v.authors.length ? ` by ${v.authors.map((a) => a.name).join(', ')}` : ''}
                </span>
              </div>
              <span className="editor__spacer" />
              {v.kind === 'text' ? (
                <div className="history__compare" role="group" aria-label="Compare with">
                  <button
                    type="button"
                    aria-pressed={compare === 'previous'}
                    onClick={() => setCompare('previous')}
                  >
                    Changes in this version
                  </button>
                  <button
                    type="button"
                    aria-pressed={compare === 'current'}
                    onClick={() => setCompare('current')}
                    disabled={current === null}
                    title={current === null ? 'The file no longer exists' : undefined}
                  >
                    Compare with current
                  </button>
                </div>
              ) : null}
              <a
                className="lc-button"
                data-variant="ghost"
                data-size="sm"
                href={`${base}/export.zip?version=${v.id}`}
                title="Download the whole project as it was right after this version"
              >
                Download project
              </a>
              {canWrite ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setConfirmRestore(true)}
                  data-testid="restore-version"
                >
                  {v.source === 'delete' ? 'Restore deleted file' : 'Restore this version'}
                </Button>
              ) : null}
            </div>

            {v.kind === 'binary' ? (
              <EmptyState title="Binary file">
                {(v.sizeBytes / 1024).toFixed(1)} KB · download the project to get this version.
              </EmptyState>
            ) : !diff || !sides ? (
              <div className="editor__center">
                <Spinner label="Comparing" />
              </div>
            ) : (
              <div className="history__diff-wrap">
                <div className="history__diff-summary" data-testid="diff-summary">
                  <span className="history__plus">+{diff.added}</span>{' '}
                  <span className="history__minus">−{diff.removed}</span>
                  <span className="history__meta">
                    {' '}
                    · {sides.beforeLabel} → {sides.afterLabel}
                  </span>
                </div>
                {diff.added + diff.removed === 0 ? (
                  <p className="history__nochange">No text changes.</p>
                ) : (
                  <table className="history__diff" data-testid="diff">
                    <tbody>
                      {diff.rows.flatMap((row, i) => {
                        if (row.type === 'gap') {
                          const rows = expanded[i];
                          if (rows)
                            return rows.flatMap((r, k) =>
                              r.type === 'gap' ? [] : [<DiffLine key={`${i}:${k}`} row={r} />],
                            );
                          return [
                            <tr key={i} className="history__gap">
                              <td colSpan={3}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpanded((e) => ({
                                      ...e,
                                      [i]: expandGap(sides.before, sides.after, row),
                                    }))
                                  }
                                >
                                  ⋯ {row.count} unchanged line{row.count === 1 ? '' : 's'}
                                </button>
                              </td>
                            </tr>,
                          ];
                        }
                        return [<DiffLine key={i} row={row} />];
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <Dialog
        open={confirmRestore}
        onClose={() => setConfirmRestore(false)}
        title="Restore this version?"
        description={
          v
            ? v.source === 'delete'
              ? `${v.path} comes back with the text it had when it was deleted (${dateTime(v.createdAt)}).`
              : `${v.path} goes back to how it was on ${dateTime(v.createdAt)}. The current text stays in the history, and collaborators see the change live.`
            : undefined
        }
        footer={
          <>
            <Button onClick={() => setConfirmRestore(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void restore()} disabled={busy}>
              Restore
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
      <Dialog
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        title="Label current version"
        description="Name this moment (e.g. “Submitted to ICALP”) to find, compare or download it later."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createLabel();
          }}
        >
          <TextField
            label="Label"
            value={labelName}
            maxLength={120}
            autoFocus
            onChange={(e) => setLabelName(e.target.value)}
          />
          <div className="dialog-form__actions">
            <Button onClick={() => setLabelOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy || !labelName.trim()}>
              Add label
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function DiffLine({ row }: { row: Exclude<DiffRow, { type: 'gap' }> }) {
  if (row.type === 'same')
    return (
      <tr className="history__row">
        <td className="history__no">{row.oldNo}</td>
        <td className="history__no">{row.newNo}</td>
        <td className="history__code">{row.text || ' '}</td>
      </tr>
    );
  const del = row.type === 'del';
  return (
    <tr className={`history__row history__row--${row.type}`}>
      <td className="history__no">{del ? row.oldNo : ''}</td>
      <td className="history__no">{del ? '' : row.newNo}</td>
      <td className="history__code">
        <span className="history__sign" aria-hidden>
          {del ? '−' : '+'}
        </span>
        <span className="lc-visually-hidden">{del ? 'removed: ' : 'added: '}</span>
        {row.segments.map((s, k) =>
          s.changed ? (
            <mark key={k} className="history__word">
              {s.text}
            </mark>
          ) : (
            <span key={k}>{s.text}</span>
          ),
        )}
        {row.segments.every((s) => !s.text) ? ' ' : null}
      </td>
    </tr>
  );
}
