# PR 5 — binary assets, uploads and ZIP import/export

**Status: implemented.** Notes vs. the proposal:

- Uploads go through the API (multipart, streamed into memory with per-file limits) rather than presigned URLs; bytes are signature-checked before storage.
- Binary blobs are content-addressed per project (`files/<project>/<sha256>`), never shared across projects.
- ZIP import runs in the API process: it parses but never executes content. Structural attacks reject the archive; unsupported entries are reported.
- SVG is not accepted (it needs an external converter, i.e. shell escape).

Original proposal follows.

## Scope

- `BlobStorage.signUpload`-free path: multipart upload through the API (size-limited, streamed to S3) for images/PDF figures; `project_files.kind = 'binary'` with `blob_key`.
- ZIP import (new project from an Overleaf-style ZIP): streaming extraction with path validation, entry count/size/ratio limits (ZIP bombs), symlink and special-file rejection, case-insensitive duplicate detection, root-file auto-detection (`\documentclass`).
- Download project as ZIP; download PDF already exists.
- Binary files flow into revision snapshots and the compile sandbox (manifest already supports arbitrary bytes).
- File tree: upload button, drag-and-drop, image preview.

## Test plan

- Unit: ZIP limits (bomb ratio, entry count, path traversal, absolute paths, symlinks, `latexmkrc`), root detection.
- Integration: upload by role; oversize → 413; ZIP import creates files with exact bytes; malicious archives rejected with clear errors; tenant separation of blobs.
- Fixtures/E2E: project with `\includegraphics` of an uploaded PNG compiles; ZIP export round-trips.
