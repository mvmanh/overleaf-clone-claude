# ADR-0013: Compile pipeline — revisions, queue, worker, cache, artifact delivery

- Status: Accepted (2026-11-01)

## Decisions

- **Revision capture in the API**, inside one `REPEATABLE READ` transaction, so a revision never mixes file versions. The manifest includes the TeX image digest published by running workers (Redis heartbeat `lc:compile:worker`); without a live worker the API answers `503 COMPILER_UNAVAILABLE` instead of queueing work nobody will do.
- **Snapshots in object storage**, content-addressed per project (`sources/<project>/<fingerprint>.tar`). The worker re-derives the fingerprint from the bytes and refuses mismatches (ADR-0005).
- **BullMQ** carries only the job id; Postgres is the source of truth for job state. Every state change is a conditional `UPDATE … WHERE status = <expected>`, so duplicate deliveries are harmless. Workers mark jobs stuck mid-build (worker crash) as failed after 3× the wall-clock limit.
- **Coalescing and latest-wins** happen under the project row lock: same fingerprint → same job (also reused for deterministic `compile-error`s, not for sandbox errors/timeouts); a new fingerprint supersedes still-queued jobs. Running jobs finish but are attributed to their own revision.
- **Incremental build cache** per project + engine + image, only from successful builds, fed into the sandbox's output directory under a reserved input prefix (`__lc_cache__/`, rejected for project paths). A failure with cache is confirmed by a clean rebuild.
- **Artifacts are streamed through the API** (`GET /compiles/{id}/artifacts/{kind}`) rather than presigned URLs: authorization on every request, no need for the browser to reach the object store, `Content-Security-Policy: sandbox`, `nosniff`, immutable private caching. Presigned URLs remain an option for large-scale deployments.
- **Polling** (400 ms → 1.5 s backoff) instead of SSE for job progress in this slice: simpler through the Next.js proxy, and jobs are short. SSE/WebSocket push is a later improvement.

## Consequences

- Viewers may compile (`compile:run` = viewer) because they need the PDF; per-user quotas/rate limits on compiles are still to do.
- The compose stack gives the worker the host Docker socket (root-equivalent) — acceptable only for trusted local use; production requires the sandbox pool described in docs/security/compile-sandbox.md.
