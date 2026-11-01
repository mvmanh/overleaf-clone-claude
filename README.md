# latex-cloud

A private, self-hostable, multi-user LaTeX authoring platform for mathematics and
computer science. Independent codebase (no Overleaf CE code — see
[ADR-0001](docs/architecture/ADRs/0001-independent-product.md)).

> **Status: single-author vertical slice.** Sign in, create a project from a
> template, share it with owner/editor/viewer roles, edit `.tex`/`.bib` files in
> CodeMirror with autosave, compile in a per-job Docker sandbox, read the PDF
> and jump from errors to their line. Uploads/ZIP import and real-time
> collaboration are **not implemented yet**. **Trusted local use only** — see
> [compile sandbox security](docs/security/compile-sandbox.md).

Specification: [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) ·
[`AGENT_BRIEF.md`](docs/architecture/AGENT_BRIEF.md) · [ADRs](docs/architecture/ADRs/) ·
[PR 2 notes](docs/product/pr-2-proposal.md) · [PR 3 notes](docs/product/pr-3-proposal.md) · [next: PR 5 proposal](docs/product/pr-5-proposal.md)

## Quick start (one command)

Requirements: Docker with Compose v2.20+, Node 22, pnpm 10 (`corepack enable`).

```bash
cp .env.example .env
```

```bash
pnpm stack:up
```

This builds and starts PostgreSQL, Redis, S3-compatible storage (SeaweedFS), a one-shot `migrate` job
(migrations + dev seed + bucket), the API, the web app, the TeX Live sandbox
image and the compile worker, and waits until all health checks pass. The
first run builds the TeX image (~1.7 GB, several minutes). Then open
<http://localhost:3000> and sign in:

| User                | Password                   | Sees                       |
| ------------------- | -------------------------- | -------------------------- |
| `alice@example.com` | `latex-cloud-dev-password` | 2 projects (owner, viewer) |
| `bob@example.com`   | `latex-cloud-dev-password` | 2 projects (owner, editor) |
| `carol@example.com` | `latex-cloud-dev-password` | 1 project (owner)          |

Health: <http://localhost:3000/api/v1/health/ready>. Stop with `pnpm stack:down`
(add `-v` to the underlying compose command to drop volumes).

> Object storage is SeaweedFS (`chrislusf/seaweedfs:4.48`, amd64 + arm64)
> with S3 authentication from `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`.
> MinIO's public images are no longer available; if you have a MinIO image,
> set `MINIO_IMAGE` and run `pnpm stack:up:minio`. Behind a TLS-intercepting
> proxy, build with `--secret id=extra_ca,src=/path/to/ca.pem`.

### Troubleshooting compiles

- **"The compile service is not running"**: the `compile-worker` container (or
  `pnpm dev:worker`) is not up — check `docker compose -f infra/compose/docker-compose.yml --env-file .env logs compile-worker`.
- **"TeX image … not found locally"**: build it with `pnpm tex-image:build`
  (compose builds it through the `texlive` service). The worker never pulls
  images from a registry.
- After updating the code, rebuild and restart: `pnpm stack:up` (it runs
  `--build`). Previously failed compiles of unchanged content are retried
  automatically when the failure was a sandbox error.

## Hot-reload development

```bash
pnpm install
```

```bash
pnpm infra:up      # postgres, redis, storage only
```

```bash
pnpm dev:setup         # build shared packages, migrate, seed, create bucket
```

```bash
pnpm dev           # api on :4000 (node --watch) + web on :3000 (next dev)
```

```bash
pnpm tex-image:build && pnpm dev:worker   # compile worker (second terminal)
```

The API reads the repository-root `.env`. The browser only talks to the web
origin; Next.js proxies `/api/*` to the API so the session cookie stays first-party.

## Tests

| Command                                                         | What it runs                                                                                   | Needs                                                                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`                                                     | ESLint (flat config), zero warnings                                                            | —                                                                                                                                                                              |
| `pnpm format:check`                                             | Prettier                                                                                       | —                                                                                                                                                                              |
| `pnpm typecheck`                                                | `tsc --noEmit` in every workspace                                                              | —                                                                                                                                                                              |
| `pnpm test`                                                     | Unit tests (Vitest) in every workspace                                                         | —                                                                                                                                                                              |
| `pnpm test:integration`                                         | API against a fresh, migrated, seeded Postgres database per test file                          | Postgres (`TEST_DATABASE_ADMIN_URL`, default `postgres://latex_cloud:latex_cloud@localhost:5432/postgres`); set `TEST_REDIS_URL` to also run the multi-replica rate-limit test |
| `pnpm tex-image:build`                                          | Builds the TeX Live sandbox image                                                              | Docker                                                                                                                                                                         |
| `pnpm fixtures:compile`                                         | Compiles every fixture, prints a timing table, writes PDFs to `tests/compile-fixtures/*/_out/` | TeX image (or the trusted local executor)                                                                                                                                      |
| `pnpm --filter @latex-cloud/compile-orchestrator test:fixtures` | Fixture assertions + empirical sandbox isolation tests                                         | TeX image                                                                                                                                                                      |
| `pnpm test:e2e`                                                 | Playwright against a running stack (`E2E_BASE_URL`, default `http://localhost:3000`)           | `pnpm stack:up`                                                                                                                                                                |

Without Docker, fixtures can run against a host TeX Live install. This executor
is **unsandboxed** and requires an explicit opt-in; it is refused in production:

```bash
COMPILE_EXECUTOR=local-trusted-dev ALLOW_TRUSTED_LOCAL_EXECUTOR=true pnpm fixtures:compile
```

## Repository layout

```text
apps/
  web/                   Next.js 15 (App Router): sign-in, dashboard, editor shell
  api/                   NestJS 11 modular monolith: auth, projects (read + ACL), health
  compile-orchestrator/  SandboxExecutor implementations, snapshot/tar protocol, fixture runner
packages/
  shared/                Zod API contracts, error envelope, roles
  compiler-protocol/     engines, latexmk args, path validation, revision manifest +
                         fingerprint, job state machine, SandboxExecutor + security gate
  tex-log-parser/        TeX log -> structured diagnostics (file, line, code, hint)
  ui/                    design tokens (light/dark), components, theme toggle
infra/
  compose/               docker-compose.yml (trusted local stack)
  tex-images/            pinned TeX Live sandbox image, platform latexmkrc, entrypoint
tests/
  compile-fixtures/      basic, math, tikz, cs, cs-algorithm2e, biber, bibtex, xelatex,
                         lualatex, errors, adversarial cases
  e2e/                   Playwright golden path
docs/                    architecture (spec + ADRs), security, product
```

## What PR 1 delivers

- **Auth (real, no mock path):** Argon2id password hashes, opaque session tokens
  stored as SHA-256, `HttpOnly`/`SameSite=Lax` cookie, server-side revocation,
  CSRF origin guard, login rate limiting, timing-equalised unknown users.
  Pluggable `AuthProvider` for OIDC later ([ADR-0011](docs/architecture/ADRs/0011-authentication.md)).
- **Schema + migrations:** users, credentials, sessions, projects, project
  members (owner/editor/viewer, at most one owner), audit events. Idempotent dev seed.
- **ACL:** `ProjectAccessService` — non-members get 404; tenant
  separation covered by integration and E2E tests.
- **API conventions:** `/api/v1` prefix, typed env validation (fails fast, never
  echoes secrets), request IDs, a single error envelope, liveness and readiness
  (DB, pending migrations, Redis, S3) endpoints.
- **Web:** dashboard with loading/empty/error states; editor layout (files,
  source, PDF, problems, top bar) with keyboard focus shortcuts (`Alt+1..4`,
  `?`), light/dark/system theme (`Alt+Shift+T`), responsive read-first layout.
- **Compiler:** immutable revision manifest + fingerprint, job state machine,
  `SandboxExecutor` interface, production security gate, Docker executor
  (no network, read-only, unprivileged, no host mounts, resource limits) and a
  clearly labelled trusted-only local executor. 17 fixtures, including
  adversarial ones, pass in the Docker sandbox.
- **CI:** format, lint, typecheck, unit, integration (Postgres service), compile
  fixtures in the Docker sandbox, and E2E against the compose stack.

## What PR 2 delivers

- **Project lifecycle:** create (creator becomes owner), rename / change
  engine (editor+), soft delete (owner; disappears for every member at once).
- **Membership:** invite existing users as editor or viewer, change roles,
  remove members (owner), leave a project (any non-owner), transfer ownership
  (owner → existing member; previous owner becomes editor).
- **Authorization model** ([ADR-0012](docs/architecture/ADRs/0012-project-authorization.md)):
  one permission table (`PROJECT_PERMISSIONS` in `packages/shared`) used by the
  API to enforce and by the UI only to decide which controls to show. Every
  mutation re-checks the caller's role inside its transaction after locking the
  project row (`SELECT … FOR UPDATE`), so concurrent requests cannot act on a
  stale role, and the database guarantees at most one owner.
- **Audit log:** every mutation writes `project_audit_events` in the same
  transaction.
- **Rate limiting across replicas:** login limits are counted in Redis (atomic
  Lua `INCR`+`PEXPIRE`), degrading to per-process limits if Redis is down.
- **UI:** "New project" dialog (`N` shortcut), Share dialog (invite, role
  select, remove, leave), Settings dialog (rename, compiler, transfer
  ownership, delete with name confirmation), all with error states.

| Method   | Path                                       | Minimum role             |
| -------- | ------------------------------------------ | ------------------------ |
| `POST`   | `/api/v1/projects`                         | authenticated            |
| `PATCH`  | `/api/v1/projects/{id}`                    | editor                   |
| `DELETE` | `/api/v1/projects/{id}`                    | owner                    |
| `POST`   | `/api/v1/projects/{id}/transfer-ownership` | owner                    |
| `GET`    | `/api/v1/projects/{id}/members`            | viewer                   |
| `POST`   | `/api/v1/projects/{id}/members/invite`     | owner                    |
| `PATCH`  | `/api/v1/projects/{id}/members/{userId}`   | owner                    |
| `DELETE` | `/api/v1/projects/{id}/members/{userId}`   | owner (or self to leave) |

## What PR 3 delivers

- **Editor:** CodeMirror 6 with LaTeX and BibTeX highlighting, bracket matching,
  search/replace, LaTeX command/environment autocompletion with snippets,
  light/dark syntax colours, read-only mode for viewers.
- **Saving:** autosave + Ctrl/Cmd+S with optimistic concurrency (`If-Match`
  content hash). Two tabs or two people editing the same file get an explicit
  conflict choice instead of a silent overwrite.
- **Files:** file tree with folders, create/rename/delete, "Set as main",
  keyboard navigation (↑/↓, F2, Del). Path rules are shared by browser, API and
  compiler (`packages/shared/src/paths.ts`).
- **Templates:** new projects start from Article, Mathematics, Computer science
  or Blank; seeded demo projects have files.
- **Layout:** resizable file / source / PDF / problems panes, remembered per browser.

## Compile pipeline

1. **Compile** (button or Ctrl/⌘+Enter) flushes unsaved edits, then the API
   reads all files in one `REPEATABLE READ` transaction and builds an
   immutable **revision manifest** (paths + SHA-256 + root + engine + TeX
   image digest). Its fingerprint identifies the build.
2. The snapshot is stored as a tar in object storage
   (`sources/<project>/<fingerprint>.tar`). If the same fingerprint is already
   built or building, that job is returned (coalesced clicks, cache hits);
   queued jobs of older revisions are marked `superseded` (latest wins).
3. A BullMQ job (id only) goes to the **compile worker**, which re-verifies the
   snapshot against the fingerprint, runs latexmk in a fresh locked-down
   container, uploads PDF/log/SyncTeX and records diagnostics and timings.
4. The browser polls the job, renders the PDF with PDF.js (zoom/scroll kept
   across rebuilds), lists problems with click-to-line, and never replaces the
   last good PDF with a failed build.

**Incremental cache:** after a successful build the worker keeps the project's
intermediates (`.aux`, `.bbl`, `.toc`, `.fdb_latexmk`, …) under
`cache/<project>/…` and feeds them to the next build. A build that fails with a
cache is retried clean before reporting the error, so a stale cache can only
cost time, never correctness. Measured on the CS template (biber, 4 vCPU dev
container): first build 5.0 s end to end, subsequent edits 1.5 s.

## Measured fixture timings (Docker executor, warm image)

Measured on the development container used for PR 1 (4 vCPU). One run, not a
benchmark; see `ARCHITECTURE.md` §11 for the real benchmark plan.

| Fixture                 | Engine   | Sandbox setup | latexmk | Total   |
| ----------------------- | -------- | ------------- | ------- | ------- |
| basic                   | pdfLaTeX | 184 ms        | 340 ms  | 588 ms  |
| math (2 passes + TOC)   | pdfLaTeX | 197 ms        | 1033 ms | 1282 ms |
| tikz + pgfplots         | pdfLaTeX | 179 ms        | 796 ms  | 1032 ms |
| biber                   | pdfLaTeX | 202 ms        | 3244 ms | 3505 ms |
| xelatex (Unicode)       | XeLaTeX  | 179 ms        | 605 ms  | 837 ms  |
| lualatex (unicode-math) | LuaLaTeX | 168 ms        | 3962 ms | 4188 ms |

## Configuration

All configuration is environment variables, validated at startup
(`apps/api/src/config/env.ts`, `apps/compile-orchestrator/src/config.ts`).
See [`.env.example`](.env.example). Production requires `COOKIE_SECURE=true`
(the default when `NODE_ENV=production`) and, for any compile executor, a
strong-isolation runtime plus `COMPILE_SANDBOX_ATTESTATION`.
