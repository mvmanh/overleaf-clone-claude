# ADR-0015: Version history — per-file checkpoints, labels, restore

- Status: Accepted (2026-11-01)
- Builds on: ADR-0014 (collaboration), ARCHITECTURE.md §9 Phase 2 ("version browser and restore")

## Decisions

**Checkpoints, not keystrokes.** History is a list of immutable per-file
checkpoints in `file_versions` (path, kind, hash, size, authors, source). Text
is stored once per project and hash in `history_blobs`. Binary checkpoints
point at the content-addressed object key, which is never overwritten. Yjs
update logs are compacted away (ADR-0014), so history does not depend on them.

**When a checkpoint is written:**

| Event                                    | Where                                                                            | Source                              |
| ---------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
| Project created / imported               | API, same transaction                                                            | `create` / `import`                 |
| File created, uploaded, renamed, deleted | API, same transaction                                                            | `create`/`upload`/`rename`/`delete` |
| Collaborative editing                    | collab compaction, at most every 5 min per file (`COLLAB_HISTORY_CHECKPOINT_MS`) | `edit`                              |
| Last editor leaves a document / shutdown | collab `beforeUnloadDocument`                                                    | `edit`                              |
| REST save (autosave fallback)            | API, coalesced to one per 5 min                                                  | `edit`                              |
| A label is added                         | API: every file whose text changed                                               | `edit`                              |
| A version is restored                    | API                                                                              | `restore`                           |

Unchanged content at the same path is never recorded twice. Authors of a
collaborative checkpoint are everyone whose updates were folded in since the
previous checkpoint (`collab_documents.history_authors`).

**Labels** name a moment (`project_labels`). Creating one first checkpoints
every file whose live text (snapshot + un-compacted log) differs from its last
checkpoint. The label therefore always points at exactly what the authors saw.

**Project state at a point** = for each file, its latest checkpoint at or
before that point, minus files whose latest checkpoint is a deletion.
`GET /history/export.zip?version=…|label=…` streams it. Points are compared in
SQL, so timestamps keep their microseconds.

**Restore** is per file and never destructive:

- The chosen content becomes a new `restore` checkpoint, and the current text
  stays in history.
- For a live file, the content goes through `CollabTextService.applyExternalEdit`.
  Open editors receive it as a normal collaborative edit.
- A deletion checkpoint holds the file's last content. Restoring it undeletes
  the file, under `<name>-restored.<ext>` if the path was taken meanwhile. The
  file's Yjs state is kept and edited, never reset, so a client still holding
  the old document can't duplicate text by syncing it back.

**Access.** Browsing, diffs and downloads need `files:read`, so viewers can see
history. Restoring and labelling need `files:write`. Labels can be removed by
their author or the owner.

**UI.** A History mode replaces the editor area:

- Timeline grouped by day, with authors (in their collaboration colours), the
  type of change and labels. Filter by file; ↑/↓ moves through versions.
- Line diff with word-level highlights and folded unchanged regions. It can
  compare a version with the previous one or with the current text.
- Actions: restore (with confirmation), "Open file" afterwards, download the
  project at any point.

## Consequences

- Storage grows with distinct texts, roughly one copy per 5-minute editing
  window per file. There is no retention policy yet; one is needed for very
  long-lived projects.
- History starts at migration 0005. Existing files get one backfilled
  `create` checkpoint, with their materialised text at migration time.
- A restore is per file. Restoring a whole project means downloading it at a
  label, or restoring files one by one. A one-click project restore is future
  work.
