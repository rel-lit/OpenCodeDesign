# Task 6 Report: Refine GraphAgent prompt role and fix circular dependency

## Status

Complete.

## Summary

Updated `packages/opencode/src/design/agent/prompt/graph.txt` to make GraphAgent's role explicit: it evaluates the exact `proposedChange` delta, does not interpret open-ended user intent, returns `change-proposal` (with the same or corrected delta) or `rejected` (with a clear reason), and does not apply changes itself. Also fixed a circular-dependency/TDZ issue in `packages/opencode/src/design/design.ts` by wrapping `Design.defaultLayer` in `Layer.suspend`, which was required for the GraphAgent tests to load.

## Files changed

- `packages/opencode/src/design/agent/prompt/graph.txt`
  - Rewrote opening to define GraphAgent as a "design-graph proposal evaluator".
  - Explicitly states it does not interpret open-ended intent or invent changes.
  - Clarifies that `proposedChange` is the exact delta to judge.
  - Specifies `change-proposal`/`rejected` outputs and the requirement for a clear rejection reason.
  - Added note that execution happens separately via `Design.applyRawDelta` after user confirmation.
  - Updated formatting of field names and rules for consistency.

- `packages/opencode/src/design/design.ts`
  - Wrapped `defaultLayer` in `Layer.suspend(() => ...)` to break the module-load circular dependency between `Design` and `GraphAgent`.

## Commands run

```bash
bun test test/design/agent/graph.test.ts
bun test test/design/agent/graph-execute.test.ts
bun test test/tool/design.test.ts
bun run typecheck
```

## Test results

- `test/design/agent/graph.test.ts`: 1 pass, 0 fail.
- `test/design/agent/graph-execute.test.ts`: 7 pass, 0 fail.
- `test/tool/design.test.ts`: 12 pass, 0 fail (one run exceeded the default 5000 ms on first initialization; re-run with extended timeout passed cleanly).
- `bun run typecheck`: clean.

## Commit

```bash
git add packages/opencode/src/design/agent/prompt/graph.txt packages/opencode/src/design/design.ts
git commit -m "feat(design): clarify GraphAgent role and fix defaultLayer circular dependency"
```

Commit hash: `97c598d6db80182224d78999294c3feb06635927`

## Notes

- The prompt update is scoped to GraphAgent's evaluator responsibility only; it does not modify the full ChatAgent routing described in the broader task brief.
- The `Layer.suspend` fix is necessary because `GraphAgent.execute` depends on `Design.Service` while `Design.defaultLayer` depends on `GraphAgent.defaultLayer`, creating a circular module import that caused a TDZ error at load time.
