# Compile sandbox: threat model, controls and the production gate

> **Status (PR 1): NOT approved for untrusted users.** The only executors that
> exist are `local-trusted-dev` (no isolation) and `docker` with runc
> (container isolation). Both are refused in production by the security gate.
> Public / multi-tenant exposure is forbidden until a gVisor or microVM executor
> passes an independent review (ADR-0007).

## Trust boundary

```
browser ──HTTPS──> web (Next.js) ──/api proxy──> api (NestJS) ──> Postgres / Redis / S3
                                                     │
                                         (PR 6: enqueue job by revisionId)
                                                     ▼
                                      compile-orchestrator  ── SandboxExecutor ──> [ sandbox: TeX ]
```

- `api` never executes TeX, has no TeX toolchain in its image, never imports
  `child_process`, and never receives the Docker socket. This is enforced by
  `apps/api/src/architecture.test.ts` and the compose file.
- Only `compile-orchestrator` drives execution, and only through
  `SandboxExecutor.run(snapshot, engineConfig, limits, artifactWriter)`.
- The sandbox sees **only** the snapshot files. It has no credentials, no
  network, and returns artifacts as a byte stream the orchestrator validates.

## Threats considered

Malicious or buggy LaTeX; `\write18`/shell escape; reading host files
(`\input{/etc/passwd}`); writing outside the workspace; option injection via
file names; `latexmkrc` (Perl) code execution; infinite loops; fork/process
floods; memory exhaustion; huge outputs/logs; ZIP bombs and path traversal at
import (PR 4); symlink tricks; network exfiltration / SSRF / cloud metadata;
cross-tenant cache leakage (P1 incremental caches); container escape via kernel
bugs (the reason runc is insufficient).

## Controls implemented in PR 1

| Control                                                                                                             | Where                                            | Verified by                                                      |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| Path validation (no absolute, `..`, backslash, control chars, leading `-`, reserved names, `latexmkrc`/`texmf.cnf`) | `compiler-protocol/src/paths.ts`                 | unit tests                                                       |
| Snapshot hashes re-verified right before execution; size limits                                                     | `compile-orchestrator/src/snapshot.ts`           | unit tests                                                       |
| `latexmk -norc -r <platform rc>`; project rc files never read                                                       | `buildLatexmkArgs`, `infra/tex-images/latexmkrc` | unit tests                                                       |
| `-no-shell-escape` + `shell_escape=f`                                                                               | engine args, env, image ENV                      | `adversarial-shell-escape` fixture                               |
| `openin_any=p`, `openout_any=p`, `TEXMFOUTPUT`                                                                      | env, image ENV                                   | `adversarial-read-absolute`, `adversarial-write-escape` fixtures |
| Wall-clock timeout + kill (container by name / process group)                                                       | executors                                        | `adversarial-infinite-loop` fixture                              |
| Output byte limit (artifacts never published when exceeded)                                                         | executors                                        | `adversarial-output-limit` fixture                               |
| Artifacts: flat regular files only, `%PDF-` check                                                                   | `tar.ts`, `result.ts`                            | unit tests                                                       |
| Fresh container per job, `--rm`, no bind mounts, input via stdin tar, output via stdout tar                         | `executors/docker.ts`                            | unit + isolation tests                                           |
| `--network=none`                                                                                                    | docker args                                      | isolation test: no interfaces besides `lo`, no DNS               |
| `--read-only` root fs; tmpfs `/work`, `/tmp` with `noexec,nosuid,nodev` and size caps                               | docker args                                      | isolation tests                                                  |
| Unprivileged UID 10001, `--cap-drop=ALL`, `no-new-privileges`, `--ipc=none`                                         | docker args                                      | isolation test reads `/proc/self/status`                         |
| `--pids-limit`, `--memory` = `--memory-swap`, `--cpus`, `nofile`, no core dumps                                     | docker args                                      | isolation test (process flood contained)                         |
| No secrets in sandbox env                                                                                           | executors pass an explicit env only              | isolation test                                                   |
| Production gate                                                                                                     | `evaluateSecurityGate`                           | unit tests                                                       |

Run them:

```bash
pnpm tex-image:build
pnpm --filter @latex-cloud/compile-orchestrator test:fixtures
```

## Compose stack (trusted local only)

`pnpm stack:up` runs the compile worker with the **host Docker socket** so it can
start one sandbox container per compile. The socket is root-equivalent on the
host. This is acceptable only on a developer machine with trusted documents; it
is the main reason the stack must not be exposed to other users.

Additional controls added with the compile pipeline:

- Source snapshots are re-verified against the revision fingerprint in the
  worker; archive entries must be regular files with valid project paths.
- The build cache is per project, only produced by successful builds, enters
  the sandbox under a reserved prefix that project paths cannot use, and a
  failing cached build is retried clean.
- Artifacts are served only through the API with authorization,
  `Content-Security-Policy: sandbox` and `nosniff`; PDF.js runs with
  `isEvalSupported: false`.

## Known gaps (must close before any untrusted use)

1. **Kernel isolation.** runc shares the host kernel. Required: gVisor
   (`DOCKER_RUNTIME=runsc`) or a microVM per job, then re-run the full suite
   under that runtime.
2. **Seccomp/AppArmor profiles** tailored to TeX (default Docker profile today).
3. **Orchestrator privilege.** The docker executor needs the Docker API. In
   production the orchestrator must talk to a dedicated sandbox node pool
   (no Docker socket on application hosts).
4. **Disk quota** beyond tmpfs size; per-tenant compile quotas and fairness
   (Phase 3).
5. **Malicious fonts/images** processed by TeX/dvipdfmx/libpng: rely on the
   sandbox, keep the image patched (rebuild cadence + image scanning).
6. **Independent review + adversarial test expansion** (font bombs, deeply
   nested macros, `\openin` probing of `/proc`, PDF size amplification).
