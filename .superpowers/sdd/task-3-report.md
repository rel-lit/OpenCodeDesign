# Task 3 Report: Refactor EventLog into a reusable factory

## What I implemented

- Extracted the in-memory event log implementation into a reusable factory, `makeEventLog`, in `packages/opencode/src/design/core/event-log.ts`.
- `makeEventLog` is an `Effect.fn("EventLog.make")` that returns `{ append, rollbackTo, list }` satisfying `EventLog.Interface`.
- Extended `EventLog.Interface.append` to accept an optional `id?: string` so events restored from SQLite can keep their original IDs.
- Updated `append` to use `input.id ?? makeId()` when constructing the event node.
- Rewrote the global `EventLog.Service` layer as a thin wrapper:
  ```ts
  const log = yield* makeEventLog()
  return Service.of(log)
  ```
- Added a focused test verifying that a supplied `id` is preserved instead of generating a new one.

## What I tested and test results

- Ran focused test: `bun test test/design/core/event-log.test.ts`
  - 3 pass, 0 fail
- Ran full design core suite: `bun test test/design/core`
  - 21 pass, 0 fail
- Ran typecheck: `bun typecheck`
  - Passed (`tsgo --noEmit`)

## Files changed

- `packages/opencode/src/design/core/event-log.ts`
- `packages/opencode/test/design/core/event-log.test.ts`

## Self-review findings

- The spec item "optional `id` in `append`" is fully implemented and covered by a test.
- Names follow the existing factory pattern (`makeEngine`, `makeWorkingSet`).
- The global `EventLog.Service` remains a thin wrapper, preserving existing consumers.
- The brief's pseudocode showed `yield* makeEventLog` without parentheses. I used `yield* makeEventLog()` to match the established `GraphEngine.makeEngine()` pattern and because `Effect.fn` returns a callable function.
- No overbuilding: the factory is scoped to the existing interface and does not introduce persistence or instance state yet.

## Issues or concerns

- None blocking. The working tree contains unrelated changes (`.opencode/` deletions, `bun.lock`, etc.) that were left unstaged.
