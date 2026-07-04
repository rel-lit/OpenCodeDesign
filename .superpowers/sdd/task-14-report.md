# Task 14 Report: Visual Editor Save Protocol

## What Was Implemented

- Created `src/design/visual-editor-protocol.ts` exposing `VisualEditorProtocol.Service.save(delta)`.
  - `save` checks that no agent is already processing for the instance, applies the delta directly to the graph/DB, builds a temporary working set from the delta, and asks `GraphAgent` to review the post-write state.
  - Per-instance processing state is kept via `InstanceState` + `Ref` to follow the project’s per-instance isolation rules.
- Added `Design.Service.applyRawDelta(delta)` in `src/design/design.ts`.
  - Applies all delta operations (`addNodes`, `updateNodes`, `deleteNodeIds`, `addEdges`, `updateEdges`, `deleteEdgeKeys`) directly against the graph engine inside a single `DesignStore` transaction and persists the resulting graph state.
- Added `WorkingSetComputer.fromDelta(delta, activeWorkingSet, graphState)` in `src/design/system/working-set-computer.ts`.
  - Collects nodes/edges touched by the delta plus the active working set, then expands to include adjacent edges and their nodes, mirroring the existing `fromInput` behavior.
- Added `test/design/visual-editor-protocol.test.ts` covering the save flow and `fromDelta` behavior.

## What Was Tested

- `bun test test/design/visual-editor-protocol.test.ts` — 2 pass, 0 fail.
- `bun test test/design` — 57 pass, 0 fail.
- `bun run typecheck` — clean.

## TDD Evidence

1. Wrote `visual-editor-protocol.test.ts` with the failing save test before any implementation existed.
2. Ran the test and observed the expected failure: module not found → missing `VisualEditorProtocol` service → runtime service/context errors.
3. Implemented the protocol, `applyRawDelta`, and `fromDelta` incrementally and re-ran the test until it passed.
4. Added a second test for `WorkingSetComputer.fromDelta` after the helper was implemented; it passed on first run (tests-after for this helper, added for regression coverage).

## Files Changed

- `packages/opencode/src/design/visual-editor-protocol.ts` (created)
- `packages/opencode/src/design/design.ts` (added `applyRawDelta`)
- `packages/opencode/src/design/system/working-set-computer.ts` (added `fromDelta`)
- `packages/opencode/test/design/visual-editor-protocol.test.ts` (created)
- `packages/opencode/.superpowers/sdd/task-14-report.md` (created)

## Self-Review Findings

- The protocol uses `Effect.ensuring` to reset the processing flag even if `applyRawDelta` or the review fails.
- `applyRawDelta` is wrapped in `state.store.transaction` so the graph state write is atomic.
- The interface type for `save` includes the realistic error union (`VisualEditorProtocolError | GraphEngine.GraphEngineError | Provider.DefaultModelError`).
- The layer captures `Design.Service` and `GraphAgent.Service` at construction time, so the public method does not expose those as runtime requirements.
- No `try`/`catch` blocks were introduced; errors flow through Effect channels.

## Issues / Concerns

- `applyRawDelta` relies on the existing `GraphEngine.updateNode`, which currently ignores the `kind` field in a patch. A delta that updates node `kind` would silently not apply that field. This was not required for the current test scenario, but a future raw delta that mutates `kind` would need `GraphEngine.updateNode` to handle `kind` as well.
- The test needs to pre-create the context referenced by the new node because the SQLite schema enforces a foreign-key constraint on `context_id`. The brief’s sample delta assumed an existing context; the test reflects that by creating the context first.
