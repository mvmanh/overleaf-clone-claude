# Next milestone proposal — Phase 2: real-time collaboration

Not started. ARCHITECTURE.md §9 Phase 2, ADR-0003.

## Scope

- `apps/collab`: Hocuspocus server (Yjs v13), one Y.Doc per text file, WebSocket
  auth with a short-lived, project-scoped token minted by the API (role checked
  on connect and on every message for read-only enforcement).
- Durable persistence: Yjs binary state in Postgres (`collab_documents` snapshot
  - `collab_updates` append log, flushed per update with an explicit RPO); never
    rebuilt from JSON. `project_files.content_text` becomes a materialised snapshot
    used for compiles/export; revision capture takes a snapshot barrier across
    all open documents.
- Editor: `y-codemirror.next` binding, remote cursors/selections with names and
  colours, presence list in the top bar, offline edits merged on reconnect.
- Rename/delete while others edit: preservation over silent loss (open editors
  are notified and keep their buffer until they reload).

## Test plan

- Unit: token minting/verification, role → permission, update log replay.
- Integration: WS rejects non-members and expired tokens; viewers cannot apply
  updates; persistence survives a collab restart; snapshot barrier gives a
  consistent revision.
- E2E (3 browser contexts): concurrent typing converges without lost text,
  cursors visible, reconnect after a network drop, viewer read-only.
