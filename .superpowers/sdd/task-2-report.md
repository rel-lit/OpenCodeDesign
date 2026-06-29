# Task 2 Report: GraphEngine

## What I Implemented

Created the in-memory `GraphEngine` service for OpenCode Design Core:

- `packages/opencode/src/design/core/graph.ts`
  - `GraphEngine.Service` with `Context.Service` / `Layer.effect` pattern.
  - Full CRUD for nodes (`createNode`, `updateNode`, `retireNode`, `deleteNode`, `getNode`, `listNodes`, `findNodesByName`).
  - Bounded context CRUD (`createContext`, `getContext`, `listContexts`).
  - Relation prototype CRUD (`createPrototype`, `getPrototype`, `listPrototypes`).
  - Edge CRUD (`createEdge`, `updateEdge`, `deleteEdge`, `getEdge`, `listEdges`, `listEdgesForNode`).
  - Enforces one edge per unordered node pair by replacing an existing edge keyed via `DesignTypes.edgeKey`.
  - Maintains `connectedEdges` indexes on nodes and `nodeIds` on contexts.
  - Exposes `defaultLayer`, a `LayerNode`, and the `GraphEngine` namespace re-export.

- `packages/opencode/test/design/core/graph.test.ts`
  - Nine tests covering node creation, edge uniqueness, node update/retire/delete, contexts, prototypes, edge update/delete, edge listing per node, and name/alias lookup.

## TDD Evidence

### RED — failing test before implementation

```powershell
cd packages/opencode
bun test test/design/core/graph.test.ts
```

```
bun test v1.3.14 (0d9b296a)

test\design\core\graph.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../../../src/design/core/graph' from 'D:\RLDemos\OpenCodeDesign\packages\opencode\test\design\core\graph.test.ts'
-------------------------------

 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [97.98s]
```

### GREEN — tests pass after implementation

```powershell
bun test test/design/core/graph.test.ts
```

```
bun test v1.3.14 (0d9b296a)

test\design\core\graph.test.ts:
(pass) GraphEngine > creates a node [10.63ms]
(pass) GraphEngine > enforces one edge per node pair [1.41ms]
(pass) GraphEngine > updates and retrieves a node [1.00ms]
(pass) GraphEngine > retires and deletes a node [1.16ms]
(pass) GraphEngine > creates bounded contexts [0.82ms]
(pass) GraphEngine > creates relation prototypes [0.78ms]
(pass) GraphEngine > updates and deletes edges [1.32ms]
(pass) GraphEngine > lists edges for a node [1.12ms]
(pass) GraphEngine > finds nodes by name or alias [0.88ms]

 9 pass
 0 fail
 21 expect() calls
Ran 9 tests across 1 file. [2.35s]
```

## Type Checking

```powershell
cd packages/opencode
bun typecheck
```

```
$ tsgo --noEmit
```

No errors.

## Files Changed

- `packages/opencode/src/design/core/graph.ts` (new)
- `packages/opencode/test/design/core/graph.test.ts` (new)

## Commit

```
72f6a9126 feat(design): add graph engine with node and edge management
```

## Self-Review Findings

- Follows OpenCode module shape: `Interface`, `Service`, `layer`, `defaultLayer`, namespace re-export.
- Uses `Effect.gen`, `Effect.fn`, `Effect.fnUntraced`; no star imports; no aliased imports.
- `Schema.Struct` types are readonly, so `DeepMutable` from `@opencode-ai/core/schema` is used for the internal mutable state to allow safe in-place updates.
- Error channels on `updateNode`, `retireNode`, and `updateEdge` are declared as `Error` in the `Interface` to match implementations that fail on missing entities.
- All provided task tests and additional coverage tests pass.

## Issues / Concerns

- Error handling uses plain `Error` rather than `Schema.TaggedErrorClass`. This matches the task brief but may be revisited when the design layer grows.
- `updateNode` uses `Object.assign(node, input, { updatedAt: now() })`; the input type already omits `id` and `createdAt`, so this is safe at compile time, but a runtime guard could be added later for extra defensiveness.
- No validation that edge endpoints or context IDs exist before creation; again consistent with the brief and current Core-only scope.

---

# Task 2 Review Fixes

## What I Fixed

### Critical: connectedEdges index invariants

- `createEdge` replacement branch now updates the `prototypeId` stored in both endpoints' `connectedEdges` entries, not just the edge object in `state.edges`.
- `updateEdge` now updates the `prototypeId` in both endpoints' `connectedEdges` entries when it changes.
- `deleteNode` now purges `connectedEdges` entries on all surviving nodes for edges that involved the deleted node.

### Important: typed errors

- Added `GraphEngineError` tagged error class via `Schema.TaggedErrorClass`.
- Replaced all plain `Effect.fail(new Error(...))` failures with `yield* new GraphEngineError({ message: ... })`.
- Updated `Interface` signatures for `updateNode`, `retireNode`, and `updateEdge` to return `Effect.Effect<..., GraphEngineError>`.

### Tests added

- `createEdge replacement updates connectedEdges prototypeId`
- `updateEdge updates connectedEdges prototypeId`
- `deleteNode purges connectedEdges on surviving nodes`
- `typed errors for missing node operations`
- `typed error for missing edge update`

## Verification

```powershell
cd packages/opencode
bun test test/design/core/graph.test.ts
```

```
bun test v1.3.14 (0d9b296a)

test\design\core\graph.test.ts:
(pass) GraphEngine > creates a node [10.54ms]
(pass) GraphEngine > enforces one edge per node pair [1.38ms]
(pass) GraphEngine > updates and retrieves a node [1.01ms]
(pass) GraphEngine > retires and deletes a node [1.45ms]
(pass) GraphEngine > creates bounded contexts [0.83ms]
(pass) GraphEngine > creates relation prototypes [0.70ms]
(pass) GraphEngine > updates and deletes edges [1.27ms]
(pass) GraphEngine > lists edges for a node [0.79ms]
(pass) GraphEngine > finds nodes by name or alias [0.70ms]
(pass) GraphEngine > createEdge replacement updates connectedEdges prototypeId [0.67ms]
(pass) GraphEngine > updateEdge updates connectedEdges prototypeId [0.83ms]
(pass) GraphEngine > deleteNode purges connectedEdges on surviving nodes [1.19ms]
(pass) GraphEngine > typed errors for missing node operations [1.30ms]
(pass) GraphEngine > typed error for missing edge update [0.50ms]

 14 pass
  0 fail
 34 expect() calls
Ran 14 tests across 1 file. [2.34s]
```

```powershell
bun typecheck
```

```
$ tsgo --noEmit
```

No errors.

## Files Changed

- `packages/opencode/src/design/core/graph.ts`
- `packages/opencode/test/design/core/graph.test.ts`

## Concerns

- None remaining. All reviewer issues addressed; tests and typecheck pass.
