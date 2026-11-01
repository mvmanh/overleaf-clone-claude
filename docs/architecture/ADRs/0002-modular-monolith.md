# ADR-0002: Modular monolith API + separate collab and compile processes

- Status: Accepted (2026-11-01)

## Decision

- `apps/api` (NestJS) hosts all business domains as modules (auth, projects, later files/revisions/compiles).
- `apps/collab` (Hocuspocus/Yjs, Phase 2) is a separate process because its connection/state profile differs.
- `apps/compile-orchestrator` is a separate process because it is the only component allowed to drive TeX execution (through a `SandboxExecutor`), and must never share a trust domain with the API.

## Consequences

One deployable for business logic; process boundaries only where trust or scaling characteristics differ. Revisit when team/domain scaling demands it.
