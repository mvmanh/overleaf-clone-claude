# ADR-0003: CodeMirror 6 + Yjs for editing

- Status: Accepted, implementation pending (PR 3 / Phase 2)

## Decision

CodeMirror 6 for the editor; Yjs v13 with the matching stable `y-codemirror.next` binding for collaboration. Versions are pinned only after a compatibility test in the PR that introduces them. Persisted state is the Yjs binary update/state — never re-created from JSON (AGENT_BRIEF rule 4).
