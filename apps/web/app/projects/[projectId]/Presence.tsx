'use client';

import { initialsOf, type ProjectFile } from '@latex-cloud/shared';
import type { ConnectionState, Peer } from '../../../lib/collab/session';

const MAX_SHOWN = 4;

/**
 * Who else is here. Each avatar has the collaborator's cursor colour; the
 * tooltip says what they are editing and a click opens that file.
 */
export function Presence({
  peers,
  files,
  connection,
  onOpenFile,
}: {
  peers: Peer[];
  files: ProjectFile[] | null;
  connection: ConnectionState | null;
  onOpenFile: (f: ProjectFile) => void;
}) {
  const fileOf = (p: Peer) => files?.find((f) => p.fileIds.includes(f.id)) ?? null;
  const shown = peers.slice(0, MAX_SHOWN);
  const hidden = peers.slice(MAX_SHOWN);
  return (
    <div className="presence" data-testid="presence" aria-label="People in this project">
      {connection === 'offline' ? (
        <span
          className="presence__offline"
          role="status"
          title="Edits are kept and sent when the connection returns"
        >
          Reconnecting…
        </span>
      ) : null}
      {shown.map((p) => {
        const f = fileOf(p);
        const where = f ? `editing ${f.path}` : 'in this project';
        return (
          <button
            key={p.user.id}
            type="button"
            className="presence__avatar"
            style={{ background: p.user.color }}
            title={`${p.user.name} — ${where}${f ? ' (click to open)' : ''}`}
            aria-label={`${p.user.name}, ${where}`}
            data-testid="presence-avatar"
            disabled={!f}
            onClick={() => f && onOpenFile(f)}
          >
            {initialsOf(p.user.name)}
          </button>
        );
      })}
      {hidden.length ? (
        <span
          className="presence__avatar presence__avatar--more"
          title={hidden.map((p) => p.user.name).join(', ')}
        >
          +{hidden.length}
        </span>
      ) : null}
    </div>
  );
}
