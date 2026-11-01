# ADR-0012: Project authorization model

- Status: Accepted (2026-11-01)

## Decision

- Three project roles, ordered `viewer < editor < owner`. Exactly one owner per project (app invariant; the DB enforces "at most one" with a partial unique index).
- Permissions are declared once in `PROJECT_PERMISSIONS` (`packages/shared/src/projects.ts`) as "minimum role per action". The API enforces it; the web UI reads it only to hide controls. Hiding a control is never relied on for security.
- **Reads** use `ProjectAccessService.requireAction`.
- **Mutations** run in a transaction that first calls `lockForAction`: `SELECT … FOR UPDATE` on the project row, then re-reads the caller's membership. This serialises membership/ownership changes per project and removes time-of-check/time-of-use gaps (e.g. two concurrent ownership transfers: one wins, the other sees its caller is no longer owner and gets 403).
- Non-members (and malformed ids) get **404** on every project route so ids cannot be probed; members lacking a permission get **403**.
- Ownership never moves through invite or role change (schemas reject `owner`); it moves only through `transfer-ownership` to an existing member, demoting the previous owner to editor.
- Soft delete (`deleted_at`) hides a project everywhere immediately; hard deletion/retention is a later storage decision.
- Every mutation writes an audit event in the same transaction.

## Consequences

- Future project-scoped surfaces (files, revisions, compiles, artifacts, collab WebSocket auth) must reuse `ProjectAccessService` and add their actions to `PROJECT_PERMISSIONS`.
- Owners can learn whether an email has an account when inviting. Acceptable for a private deployment; revisit with pending invitations.
