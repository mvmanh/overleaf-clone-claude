# ADR-0014: Real-time collaboration — Hocuspocus/Yjs, durable log, token auth

- Status: Accepted (2026-11-01)
- Implements: ADR-0003, ARCHITECTURE.md §5/§9 Phase 2

## Decisions

**Topology.** A separate `apps/collab` service (Hocuspocus 4.7.1, Yjs 13.6.33,
`y-codemirror.next` 0.3.6 in the browser). It has its own process and image,
never runs TeX and never sees session cookies. One Y.Doc per text file
(`file.<project>.<file>`) plus one presence-only room per project
(`project.<project>`). The browser multiplexes all of them over one WebSocket.
Each provider is session-addressed (`sessionAwareness`), so a remount can never
race a stale close message.

**Authentication.** The browser asks the API (cookie-authenticated, same
origin) for a short-lived (10 min), project-scoped HMAC token
(`POST /projects/:id/collab/token`). The collab server verifies the signature
and expiry, checks that the document belongs to the token's project, and then
**re-reads the member's role from Postgres**. A token proves identity, never
permission. Viewers' connections are read-only, and Hocuspocus refuses their
sync updates. The project room is read-only for everyone (presence only). The
upgrade request must come from an allowed origin on `/collab`.

**Awareness can't be spoofed.** The server overwrites `user` in every awareness
state with the authenticated identity. A connection may only set or clear the
states of its own Yjs clients.

**Durability: persist before acknowledge.** Hocuspocus's `beforeSync` hook runs
inside the connection's sequential message queue, before the update is applied
and before the `SyncStatus` acknowledgement is sent. It validates the update
(`Y.decodeUpdate`, ≤ 4 MB) and commits it to `collab_updates`. As a result:

- The "Saved" badge means _committed in Postgres_. The RPO for acknowledged
  edits is zero.
- Unacknowledged edits stay in the client's Y.Doc. The client re-sends them on
  reconnect (the Yjs sync protocol exchanges state vectors), including after a
  collab server crash. They are lost only if the tab is also closed before
  reconnecting; `beforeunload` warns about that.
- If the database write fails, the connection resets and the client keeps its
  changes.

**Compaction.** Debounced (2 s, at most every 10 s, and on unload/shutdown).
Under the file row lock (`FOR NO KEY UPDATE`), compaction:

1. folds exactly the log rows it read into the `collab_documents` snapshot,
2. applies any rows the live document had not seen,
3. materialises the text into `project_files.content_text`/`sha256`/`size_bytes`.

Appends only take `KEY SHARE` (through the foreign key), so typing never waits
for compaction.

**Seeding.** Yjs state is created from the stored text exactly once: on the
first collaborative open, under the row lock, re-checked inside the
transaction. Clients start empty and receive the server state, so text is never
inserted twice. After that, the Yjs binary is the authority and is never
rebuilt from text.

**Readers of text** (compiles, ZIP export, file GET, autocomplete index) replay
`snapshot + log` for files that have un-compacted rows (`CollabTextService`).
Compile revisions are captured in one `REPEATABLE READ` transaction, which acts
as the cross-file snapshot barrier. Because every acknowledged edit is already
committed, and the client waits for its acknowledgements before requesting a
compile, a revision contains every edit the author saw as "Saved", across all
files.

**Writes outside the editor.** REST saves (still `If-Match`) and text uploads
replacing a file go through `CollabTextService.applyExternalEdit`. Under the
row lock, it computes a minimal diff against the current Yjs state and appends
it as an `api` update. Then it publishes `file-updated` on Redis. Live documents
merge it like any collaborator's edit, so concurrent typing is never
overwritten.

**API → collab events** (Redis `lc:collab:events`):

- `file-updated`, `file-deleted`, `files-changed`, `members-changed`,
  `project-changed`, `project-deleted`.
- These are best-effort, published after commit. Every 60 s, a sweep re-checks
  every connection's role and pulls API updates, so a lost message only delays
  an effect.
- When a role changes, connections are made read-only, or closed with a
  `role-changed` notice.

**Rename/delete while editing.** Documents are keyed by file id, so a rename
doesn't affect open editors. A delete sends `file-deleted` to editors, who keep
their buffer read-only with a "Save as new file" action. This favours
preservation over silent loss. The server closes the document's connections and
refuses new ones.

**Undo** is Yjs' `UndoManager`, so it only undoes your own changes. Math
auto-expansions call `stopCapturing()` between the typed character and the
expansion, so Ctrl/⌘+Z still restores what you typed.

**Fallback.** If the API has no `COLLAB_TOKEN_SECRET`, the token endpoint
answers `503 COLLAB_DISABLED`. The editor then falls back to the PR 3
compare-and-swap autosave. Both paths write through the same Yjs-aware service,
so mixing them is safe.

## Consequences

- A single collab instance is supported today. Running several needs document
  affinity (or the Hocuspocus Redis extension); the event bus already fans out
  to all instances.
- A write costs one `INSERT` per client update. Providers batch per transaction;
  measure before adding `flushDelay` batching.
- Old `collab_updates` rows only exist between compactions. The snapshot grows
  with Yjs tombstones (`gc: true` keeps that small). Version history/restore is
  a separate milestone.
- The dev compose stack uses a built-in development secret. Production refuses
  it and requires `COLLAB_TOKEN_SECRET` (≥ 32 characters) on both the API and
  collab.
