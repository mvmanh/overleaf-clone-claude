# Next milestone proposal — PR 5: binary assets, uploads and ZIP import

Not started.

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
