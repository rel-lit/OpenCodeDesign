# Task 2 Report: Refactor WorkingSet into a reusable factory

## What was implemented

Refactored `packages/opencode/src/design/core/working-set.ts` to extract a reusable `makeWorkingSet` factory:

- Replaced the previous `make = (capacity = 20) => Layer.effect(...)` helper with a pure factory `makeWorkingSet = (capacity = 20) => Effect.fn("WorkingSet.make")(function* (graph) { ... })`.
- The factory receives a `GraphEngine.Interface` instance and returns a `WorkingSet.Interface` implementation, moving all state and methods (`state`, `list`, `activateContext`, `forgetContext`, `activateNode`, `forgetNode`, `resolveReference`) into the factory closure.
- Rewrote the global `WorkingSet.Service` layer as a thin wrapper that yields `GraphEngine.Service`, builds a working set via `makeWorkingSet(20)(graph)`, and wraps it with `Service.of`.
- Kept `defaultLayer` and the `LayerNode`/`node` wiring unchanged so existing consumers continue to work.

## What was tested

- Focused test: `bun test test/design/core/working-set.test.ts`
  - 2 pass, 0 fail
- Full design core suite: `bun test test/design/core`
  - 20 pass, 0 fail
- Typecheck: `bun typecheck`
  - clean (`tsgo --noEmit`)

## Files changed

- `packages/opencode/src/design/core/working-set.ts`

## Self-review findings

- The refactor matches the brief exactly, including the curried factory signature and the thin global service layer.
- All existing tests pass without modification, confirming the global `WorkingSet.Service` wrapper remains compatible.
- No concerns.
