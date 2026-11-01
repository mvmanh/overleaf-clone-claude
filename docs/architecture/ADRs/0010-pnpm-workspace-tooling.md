# ADR-0010: pnpm workspace, TypeScript 5.9, conservative framework majors

- Status: Accepted (2026-11-01)

## Decision

- **pnpm workspaces** (strict, content-addressed, fast; `workspace:*` protocol). No Turborepo yet — `pnpm -r` topological runs are sufficient at this size.
- **Pinned exact versions** (`save-exact`), `pnpm-lock.yaml` committed, `--frozen-lockfile` in CI and images.
- Mutually compatible majors verified together: Node 22 LTS, TypeScript 5.9, Next.js 15.5 (patched line) + React 19.2, NestJS 11, ESLint 9 flat config + typescript-eslint 8, Vitest 3, Zod 3.25, Kysely 0.28.
  Newer majors (TypeScript 7, NestJS 12, Next 16, ESLint 10) exist; adopting them is a separate, tested upgrade PR rather than a bootstrap risk.
- **Kysely** (typed SQL + migrations) over an ORM: explicit SQL for ACL-critical queries, static migration registry.
- Shared packages compile to CommonJS `dist/` (consumed by Nest and Next); `@latex-cloud/ui` is consumed from source via `transpilePackages`.
