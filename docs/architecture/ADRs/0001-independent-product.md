# ADR-0001: Build an independent product (no Overleaf CE code)

- Status: Accepted (2026-11-01)

## Context

Overleaf Community Edition is AGPL-3.0. Reusing its code would put this product under AGPL obligations and tie our compile/collab architecture to theirs.

## Decision

latex-cloud is written from scratch. No Overleaf CE source is copied or vendored. Its public documentation may inform requirements (e.g. its warning that unsandboxed compiles are unsafe for untrusted users).

## Consequences

More initial work; full freedom over UX, compile pipeline and licensing. Revisit only with an explicit licensing decision.
