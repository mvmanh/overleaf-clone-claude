# PR 2 proposal — Project CRUD + membership ACL

Not started. Begins only after PR 1 is merged.

## Scope

- `POST /api/v1/projects` (name, engine) → creator becomes `owner` (transaction: project + owner membership + audit event).
- `PATCH /api/v1/projects/{id}` (name, engine) — editor+ (engine change: owner? decide in PR; default editor+).
- `DELETE /api/v1/projects/{id}` — owner only; soft delete (`deleted_at`), hidden everywhere.
- `GET /api/v1/projects/{id}/members`, `POST …/members/invite` (existing users by email; role editor|viewer), `PATCH …/members/{userId}` (role), `DELETE …/members/{userId}`; owner cannot be removed/demoted; ownership transfer is a separate explicit endpoint.
- Every mutation writes `project_audit_events`.
- Redis-backed login rate limiter (removes the single-replica limitation).
- Dashboard: create-project dialog, rename, delete with confirmation, members sheet. Loading/empty/error states.
- Zod contracts in `packages/shared` for all of the above.

## Test plan

Unit

- Role matrix: for each endpoint × {owner, editor, viewer, non-member, anonymous} → expected status (table-driven).
- Validation: name length/whitespace, engine enum, invite email normalisation.

Integration (Postgres, per-file database)

- Create → appears only in creator's list with role owner; audit event written.
- Viewer cannot PATCH (403); non-member PATCH/DELETE → 404 (no existence oracle).
- Owner invites bob as editor → bob lists it; role change to viewer → bob PATCH now 403.
- Remove member → immediate 404 for that member; their open sessions remain valid but lose access.
- Owner cannot remove/demote self; at-most-one-owner DB constraint holds under concurrent role updates.
- Soft-deleted project: 404 for all members; absent from lists.
- CSRF: every mutation without an allowed Origin → 403.
- Rate limiter shared across two API instances (two Nest apps, one Redis).

E2E (Playwright, compose stack)

- Alice creates project → opens editor shell → renames → sees new name on dashboard.
- Alice invites Bob as viewer → Bob sees it with `viewer` badge; Compile/edit affordances reflect role.
- Alice deletes project → Bob's dashboard no longer shows it; direct URL shows "Project not found".

Migrations

- `0002_*`: audit indexes as needed; no destructive change to 0001.
