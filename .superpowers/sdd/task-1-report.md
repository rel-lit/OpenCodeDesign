# Task 1 Report: Refactor GraphEngine into a reusable factory

## What was implemented

Refactored `packages/opencode/src/design/core/graph.ts` so the graph logic is no longer tied to a single global service layer:

- Updated `GraphEngine.Interface`:
  - Added optional `id?: string` to `createNode` so restored nodes can keep their original IDs.
  - Added `getState` to expose a snapshot of nodes, edges, prototypes, and contexts.
- Extracted an exported `makeEngine` factory using `Effect.fn("GraphEngine.make")`.
  - The factory owns its own mutable `state`, `now`, and all graph operation helpers.
  - All previous logic was preserved: `createNode`, `updateNode`, `retireNode`, `deleteNode`, `getNode`, `listNodes`, `findNodesByName`, `createContext`, `getContext`, `listContexts`, `createPrototype`, `getPrototype`, `listPrototypes`, `createEdge`, `updateEdge`, `deleteEdge`, `getEdge`, `listEdges`, `listEdgesForNode`, plus the new `getState`.
  - `createNode` now uses `id: input.id ?? makeId("node")`.
- Rewrote `GraphEngine.layer` as a thin global wrapper that creates one internal engine via `makeEngine()` and wraps it with `Service.of(engine)`.
- Kept `defaultLayer`, `node`, and the `GraphEngine` namespace self-reexport unchanged so existing consumers continue to work.

## Deviations from the brief

Two small adjustments were required to make the code compile and run with the Effect version in this repo (`effect@4.0.0-beta.83`):

1. The brief showed `const engine = yield* makeEngine` in `layer`. `Effect.fn` returns a zero-arity function, so the actual call must be `yield* makeEngine()`.
2. The brief showed `} satisfies GraphEngine.Interface` at the end of the factory return. The self-reexport namespace `GraphEngine` is not available inside the same module at that position, so it was changed to `} satisfies Interface`.

## Testing

- Focused test:
  ```bash
  cd packages/opencode
  bun test test/design/core/graph.test.ts
  ```
  Result: 14 pass, 0 fail, 34 expect() calls.

- Full design core suite:
  ```bash
  cd packages/opencode
  bun test test/design/core/
  ```
  Result: 20 pass, 0 fail, 44 expect() calls (graph, working-set, persistence, event-log).

- Typecheck:
  ```bash
  cd packages/opencode
  bun typecheck
  ```
  Result: clean (`$ tsgo --noEmit` with no errors).

## Files changed

- `packages/opencode/src/design/core/graph.ts`

## Commit

- `e6a896d36 refactor(design): extract GraphEngine factory`

## Self-review

- **Completeness:** All brief requirements met: factory extracted, interface updated, global wrapper preserved, `id` reuse supported, `getState` exposed.
- **Quality:** Logic is unchanged; only structure moved. Names match the brief (`makeEngine`, `getState`).
- **Discipline:** No unrelated refactoring. No new dependencies.
- **Testing:** Tests pass without modification; typecheck passes.

## Concerns

None. The refactor is a pure structural extraction with no behavioral changes.
