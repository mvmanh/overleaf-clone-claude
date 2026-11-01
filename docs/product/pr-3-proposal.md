# PR 3 — Editor shell: file tree + CodeMirror 6 (single author)

**Status: implemented.** Notes vs. the proposal:

- Save is `PUT /projects/{id}/files/{fileId}/content` with `If-Match`; missing header → 428, stale → 412 (compare-and-swap in one `UPDATE … WHERE sha256 = $expected`).
- Autosave (1 s debounce) + Ctrl/Cmd+S. The `FileSession` state machine (`apps/web/lib/editor/file-session.ts`) is unit-tested; a 412 stops saving and offers _Keep my version_ / _Load their version_.
- Templates: article, math (amsart + theorems), cs (algorithms + biblatex + `references.bib`), blank. Titles are TeX-escaped.
- The root file cannot be deleted; renaming it keeps it the root (must stay `.tex`).
- Pane sizes persist per browser (`react-resizable-panels` `autoSaveId`), not per project.
- Binary files/uploads are PR 4.

Original proposal follows.

## Scope

- Migration `0002_project_files`: `project_files(id, project_id, path, kind[text|binary], content_text, size_bytes, sha256, created_at, updated_at, deleted_at)` — text content stored in Postgres for now (Yjs replaces it as the authority in Phase 2; binary blobs arrive with PR 4).
- API: `GET/POST /projects/{id}/files`, `GET/PUT/PATCH(rename)/DELETE /projects/{id}/files/{fileId}`, set root file. Every path through `validateProjectPath`; editor+ to write, viewer+ to read; optimistic concurrency with `If-Match: <sha256>` to avoid silent overwrites.
- New projects get a `main.tex` template (Math or CS starter).
- Web: file tree (create/rename/delete, root-file indicator, keyboard navigation), CodeMirror 6 with LaTeX + BibTeX highlighting, bracket matching, search, save state indicator (debounced autosave + Ctrl/Cmd+S), read-only mode for viewers, resizable panes persisted per user/project (localStorage).

## Test plan

- Unit: path/rename validation, If-Match conflict logic, template generation.
- Integration: CRUD per role; path traversal/duplicate (case-insensitive) rejection; 412 on stale If-Match; viewer cannot write; non-member 404; soft-deleted project blocks file access.
- E2E: create project → edit `main.tex` → reload shows saved text; viewer sees read-only editor; rename file updates tree; typing latency smoke check.
