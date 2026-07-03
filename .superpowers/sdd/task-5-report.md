# Task 5 Report

## Status

Completed.

## What I implemented

Rewrote `packages/opencode/src/agent/prompt/design.txt` so the Design agent prompt matches the tool-split requirement that all graph mutations go through `design_propose_change({ delta })` as a single batch.

Key changes to the prompt:

- Added an explicit rule: the agent cannot modify the graph directly; every mutation must be submitted as a single batch through `design_propose_change({ delta })`.
- Added guidance to build the complete delta first, assembling all node/edge additions, updates, and deletions into one `GraphDelta` object before calling the tool.
- Listed the system fields the delta can omit for nodes (`id`, `kind`, `aliases`, `defaultSemantics`, `connectedEdges`, `createdAt`, `updatedAt`, `retired`) and edges (`parameters`, `createdAt`, `updatedAt`).
- Added guidance on temporary IDs: new nodes created in the same delta can use temporary IDs and later `addEdges` entries can reference those same temporary IDs; the system resolves them to real IDs.
- Reaffirmed that read and working-set tools remain available.
- Updated the tool usage guide to state that `design_propose_change` is the only write tool and that separate create/update/delete tools should not be used for graph mutations.
- Applied inline code formatting to tool names throughout the prompt for consistency.

## Commands run

```
cd packages/opencode
bun run typecheck
```

Result: passed (no errors).

```
cd packages/opencode
bun test
```

Result: the full suite ran longer than the 300 s timeout and had unrelated failures/timeouts in `test/server/httpapi-file.test.ts` (search endpoint timeout) and `test/server/httpapi-sdk.test.ts` (SDK file search index not ready / instance read routes timeout). The prompt change is text-only and does not affect these server/SDK tests. Typecheck passed cleanly.

## Files changed

- `packages/opencode/src/agent/prompt/design.txt`
- `.superpowers/sdd/task-5-report.md` (this report)

## Commit

```
feat(agent): update design prompt for batched delta proposals
```

Hash: `c574bce9d86ee0ab0f40e435a5e04f2137fff99a`

## Notes

The task brief file at `.superpowers/sdd/task-5-brief.md` describes an approval-panel state machine, which appears to be a different task than the prompt-rewrite task stated in the request. I followed the explicit request to rewrite the design prompt and ran the requested verification commands.
