# PR 3 proposal — Editor shell: file tree + CodeMirror 6 (single author)

Not started. Next milestone per ARCHITECTURE.md §15 ("Editor shell + CodeMirror + local project file tree + responsive split panes").

## Scope

- Migration `0002_project_files`: `project_files(id, project_id, path, kind[text|binary], content_text, size_bytes, sha256, created_at, updated_at, deleted_at)` — text content stored in Postgres for now (Yjs replaces it as the authority in Phase 2; binary blobs arrive with PR 4).
- API: `GET/POST /projects/{id}/files`, `GET/PUT/PATCH(rename)/DELETE /projects/{id}/files/{fileId}`, set root file. Every path through `validateProjectPath`; editor+ to write, viewer+ to read; optimistic concurrency with `If-Match: <sha256>` to avoid silent overwrites.
- New projects get a `main.tex` template (Math or CS starter).
- Web: file tree (create/rename/delete, root-file indicator, keyboard navigation), CodeMirror 6 with LaTeX + BibTeX highlighting, bracket matching, search, save state indicator (debounced autosave + Ctrl/Cmd+S), read-only mode for viewers, resizable panes persisted per user/project (localStorage).

## Test plan

- Unit: path/rename validation, If-Match conflict logic, template generation.
- Integration: CRUD per role; path traversal/duplicate (case-insensitive) rejection; 412 on stale If-Match; viewer cannot write; non-member 404; soft-deleted project blocks file access.
- E2E: create project → edit `main.tex` → reload shows saved text; viewer sees read-only editor; rename file updates tree; typing latency smoke check.
