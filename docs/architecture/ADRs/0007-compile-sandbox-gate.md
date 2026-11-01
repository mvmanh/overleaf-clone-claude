# ADR-0007: Strong compile sandbox is a release gate

- Status: Accepted (2026-11-01) — never relaxed for public multi-tenant use

## Decision

TeX runs only through `SandboxExecutor` implementations, never in `api`/`collab`. `evaluateSecurityGate` (`packages/compiler-protocol/src/sandbox.ts`) refuses to start any executor in `NODE_ENV=production` unless:

1. the executor is not trusted-input-only,
2. its isolation is `gvisor` or `microvm` (not plain containers), and
3. `COMPILE_SANDBOX_ATTESTATION` references an independent security review.

Current executors:

| Executor                          | Isolation           | Production                                           |
| --------------------------------- | ------------------- | ---------------------------------------------------- |
| `local-trusted-dev`               | none (host process) | Never. Requires `ALLOW_TRUSTED_LOCAL_EXECUTOR=true`. |
| `docker` (runc)                   | container           | Never (defence in depth only).                       |
| `docker` + `DOCKER_RUNTIME=runsc` | gvisor              | Only after attestation.                              |

See `docs/security/compile-sandbox.md` for the threat model and controls.
