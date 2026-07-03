# Task 3 Report: Add design_propose_change tool and remove ChatAgent write tools from registry

## Status

Complete.

## Summary

Added a new `design_propose_change` tool that lets ChatAgent submit a complete batch of graph changes as a `GraphDelta`. Removed all graph-mutation tools from the ChatAgent-visible registry while keeping their definitions in `src/tool/design.ts` and exposing them for GraphAgent internal use via a new `GraphAgentDesignTools` export. Updated tests and the ChatAgent prompt/permissions to match the new tool surface.

## Files changed

- `packages/opencode/src/tool/design.ts`
  - Added `DesignProposeChangeTool` (`design_propose_change`).
  - Added `GraphAgentDesignTools` const export containing the internal mutation tools.
- `packages/opencode/src/tool/registry.ts`
  - Imports only ChatAgent-visible design tools.
  - Registers only ChatAgent-visible design tools.
- `packages/opencode/test/tool/design.test.ts`
  - Rewrote tests to exercise `design_propose_change` for create/update/delete of nodes and edges.
  - Removed direct tests for tools that are no longer ChatAgent-visible.
- `packages/opencode/test/tool/graph-agent-design.test.ts` (new)
  - Moved direct tests for mutation tools to a GraphAgent-internal test file.
- `packages/opencode/src/agent/agent.ts`
  - Added `design_propose_change: "allow"` to design tool permissions.
- `packages/opencode/src/agent/prompt/design.txt`
  - Rewrote workflow and tool guide to recommend `design_propose_change` instead of individual mutation tools.

## Commands run

```bash
bun test test/tool/design.test.ts test/tool/graph-agent-design.test.ts
bun test test/tool
bun run typecheck
```

## Test results

- `test/tool/design.test.ts`: 12 pass, 0 fail.
- `test/tool/graph-agent-design.test.ts`: 6 pass, 0 fail.
- `test/tool` suite: 335 pass, 8 fail. The 8 failures are pre-existing Windows/environment issues unrelated to this change (path normalization in external-directory/read, grep/glob timeouts).
- `bun run typecheck`: clean.

Full `bun test` from `packages/opencode` could not complete in this environment (ChildProcess.kill), but the relevant tool tests pass and typecheck is clean.

## Commit

```bash
git add packages/opencode/src/tool/design.ts packages/opencode/src/tool/registry.ts packages/opencode/test/tool/design.test.ts packages/opencode/test/tool/graph-agent-design.test.ts packages/opencode/src/agent/agent.ts packages/opencode/src/agent/prompt/design.txt
git commit -m "feat(design): add design_propose_change and hide mutation tools from ChatAgent"
```

Commit hash: `a40ae7df5585d6b2f29d6d3e90c6c046b4468692`

## Notes

- The `design_propose_change` tool schema uses `Schema.Unknown` for the `delta` field so the existing `GraphDelta` shape can pass through without a precise schema duplication. Validation happens inside `Design.proposeChanges` / `applyRawDelta`.
- Mutation tools remain defined and exported as `GraphAgentDesignTools` for internal GraphAgent use.
- The ChatAgent prompt and permissions were updated so the `design` primary agent can actually invoke the new tool.
