# Claude Code / Codex — Master Implementation Brief

You are the lead engineer implementing a private, self-hostable, multi-user LaTeX collaboration platform (working name: `latex-cloud`). **Read `ARCHITECTURE.md` first and treat its safety boundaries, product invariants, and phase exits as requirements.**

## Mission
Produce a working, polished minimum viable vertical slice: sign in, create/import LaTeX project, edit `.tex` and `.bib`, compile using an isolated TeX Live build executor, inspect PDF/error diagnostics, export PDF/ZIP; then add reliable multi-user collaboration. Prioritize excellent UX and measured compile performance over premature feature breadth.

## Technical architecture
- TypeScript monorepo with Next.js frontend, NestJS modular-monolith API, separate Hocuspocus/Yjs collaboration app, compile orchestration/queue worker.
- CodeMirror 6 with stable Yjs integration, PDF.js, PostgreSQL, Redis/BullMQ, MinIO (S3-compatible), TeX Live/latexmk with pdfLaTeX/XeLaTeX/LuaLaTeX.
- Docker Compose for local development. Prepare interfaces for AWS ECS + RDS + S3 + ElastiCache and a dedicated secure compiler sandbox pool.
- Do not copy code from Overleaf CE without explicit AGPL/license decision.

## Nonnegotiable engineering rules
1. **Never compile untrusted TeX inside the API or collaboration service.** A Compose worker with ordinary Docker isolation is not a security guarantee. Build a `SandboxExecutor` interface and enforce a release gate: public internet multi-tenant usage requires gVisor/microVM/per-task sandbox, no network egress, read-only image, unprivileged execution, resources limits, no secrets, no shell escape and adversarial tests. A weaker local dev executor must be prominently labeled trusted-only and must not be enabled in production.
2. Compile an immutable **revision manifest**. Artifacts and state always refer to `revisionId`. Stale compile results cannot replace current PDF. Preserve last successful PDF on errors.
3. No arbitrary remote code or shell execution from uploaded documents. Treat ZIPs, paths, symlinks, LaTeX macros, logs and PDFs as untrusted inputs.
4. Do not convert persisted Yjs state into JSON and recreate it as a fresh Yjs document. Preserve CRDT data and implement a documented durability strategy.
5. Server-enforce authorization for REST, collaboration WS, revision snapshots, job queue, uploads and artifacts. Add tests for unauthorized users and tenant separation.
6. No AI assistant, full GitHub sync, WYSIWYG or multi-service sprawl in Phase 1.
7. Every completed milestone includes unit/integration/e2e tests, migrations, README instructions, UI states for loading/error/empty and instrumented compile timing.
8. Never assume compile is fast without benchmarks. Implement warm images, deduplication, latest-wins and async queue before optimization claims.

## Workflow / working agreement
- **First action:** inspect repository and state missing components, then present exact files/modules to change for the next small vertical slice.
- Implement one milestone/PR at a time. Commit to a coherent, runnable system instead of mass-generating placeholder modules.
- Keep Next.js/NestJS framework versions and related libraries mutually compatible; use current docs and pin dependencies and TeX image digest.
- Before adding code, define acceptance tests. After adding code, run `lint`, `typecheck`, unit/integration tests and relevant Playwright tests; report exact commands and results without inventing passes.
- If test/environment limitations prevent verification, report them clearly and leave reproducible steps.
- Record architecture decisions in `docs/architecture/ADRs/`, API contracts in `packages/shared`, and environment examples without secrets.

## Milestone to implement first
**Phase 0 / PR 1: repo bootstrap, no fake functionality.**

Deliver:
- `pnpm` workspace (or clearly justified alternative), TypeScript standards, ESLint/formatter, CI and typed config validation.
- Docker Compose for PostgreSQL, Redis, MinIO, `web`, `api`; healthchecks, persistent dev volumes, env examples and documentation.
- Next.js dashboard/editor route skeleton and reusable design tokens/components (dark/light, keyboard-first design).
- NestJS health endpoint, database migrations and seed (project/users/ACL schema); real authentication approach, not mock auth on production path.
- Compiler protocol and sandbox executor interface, with explicit prod security gate documented.
- Baseline TeX Live image definition and compile fixtures to exercise math/CS; separate fixture runner from web process.
- `README.md` with one-command development startup and test commands.

Definition of Done:
- Fresh checkout can start locally using documented commands.
- Browser loads a polished dashboard/editor skeleton; API health passes; DB migrations apply.
- CI lint/typecheck/tests pass, and fixture compile test produces a verifiable PDF.
- No API route runs TeX directly or receives Docker socket privileges.

After finishing PR 1, propose PR 2 (project CRUD + ACL) with an exact test plan; do not begin it until PR 1 code is verifiably complete in the repository.

## Product UX checklist
- Polished sidebar/tree, editor center, PDF panel right, bottom issues panel, top compile status.
- Responsive, accessible, resizable, keyboard-navigable; visible sync/save and compile states.
- PDF viewer retains zoom/page/scroll and does not blank on compilation errors.
- Support math and CS templates and syntax without requiring premium flags.

## Compile MVP acceptance tests
- Basic article, AMS math, TikZ/pgfplots, CS algorithm/listings, BibTeX/Biber, Unicode engine-specific cases, invalid code/missing asset.
- Correct engine/root-file selection; errors point to file and line where feasible.
- Two projects cannot read/write each other's sources or artifacts.
- Huge output, CPU/memory exhaustion, traversal, shell-escape attempts, network access attempts trigger sandbox denial/controlled error, not host compromise.
- Redundant compile clicks coalesce; stale jobs never replace new output; last successful PDF persists.

**Important:** Source documents may include malicious LaTeX. Production exposure is forbidden until the sandbox security gate is satisfied and verified independently.
