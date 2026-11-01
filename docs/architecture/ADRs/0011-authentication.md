# ADR-0011: Server-side sessions with a pluggable identity provider

- Status: Accepted (2026-11-01)

## Decision

- Identity comes from an `AuthProvider` interface. First implementation: local email + password, hashed with **Argon2id** (19 MiB, t=2, p=1). OIDC (auth-code + PKCE, server-side exchange) is a future provider; sessions/ACL do not change.
- Sessions are **opaque random 256-bit tokens** in an `HttpOnly`, `SameSite=Lax` (`Secure` in production) cookie. Only `SHA-256(token)` is stored, so a DB leak yields no usable cookies; logout revokes server-side immediately.
- The browser talks only to the web origin; Next.js proxies `/api/*` to the API, keeping cookies first-party.
- CSRF: SameSite=Lax + `OriginGuard` requiring an allowed `Origin`/`Referer` on every state-changing request.
- Unknown-user logins run a dummy Argon2 verification so timing does not reveal registered emails. Login is rate-limited per email and per IP (in-process for now; must become Redis-backed before running >1 API replica).
- There is no mock/bypass auth path. Seed users exist only via the dev seed, which refuses `NODE_ENV=production`.

## Why not JWT

Revocation, rotation and payload exposure are simpler with server-side sessions; the collab service will receive short-lived _scoped_ tokens minted by the API (Phase 2).
