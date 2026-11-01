# ADR-0005: Every compile builds one immutable revision manifest

- Status: Accepted (2026-11-01) — correctness invariant, never relaxed

## Decision

A compile job references exactly one `RevisionManifest` (`packages/compiler-protocol`): sorted file paths + SHA-256 + root file + engine + TeX image digest + options. Its canonical-JSON SHA-256 is the **fingerprint** used for caching, deduplication and attributing artifacts. Executors re-verify file bytes against the manifest immediately before running.

## Consequences

Stale results are identifiable by construction; cache hits are safe; a failed compile can never be confused with the current PDF.
