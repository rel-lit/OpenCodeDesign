# Task 4 Report

## What I implemented

- Implemented `GraphAgent.execute()` in `src/design/agent/graph.ts` so that an approved `change-proposal` output is applied to the design graph through `Design.Service`.
- Added a `transaction` method to `Design.Service` in `src/design/design.ts` that wraps a block of design operations in `DesignStore.transaction`, giving the whole delta atomic persistence.
- Added `GraphAgent.NoDeltaError` for proposals that arrive without a `delta`.

### `GraphAgent.execute()` behavior

1. Rejects proposals with no `delta` via `NoDeltaError`.
2. Runs all delta operations inside `design.transaction`:
   - `addNodes` → `design.createNode`
   - `updateNodes` → `design.updateNode`
   - `deleteNodeIds` → `design.deleteNode`
   - `addEdges` → `design.createEdge`
   - `updateEdges` → `design.updateEdge`
   - `deleteEdgeKeys` → parsed with `DesignTypes.edgeKey` format (`left::right`) then `design.deleteEdge`
3. Returns the proposal with `type` changed to `"change-applied"`.

## What I tested and test results

Created `test/design/agent/graph-execute.test.ts` with four cases:

1. `applies a node update via Design.Service` — verifies the result type and that the node name is updated in the DB.
2. `applies mixed delta operations` — add node, update node, add edge, delete node in one proposal.
3. `deletes an edge by key` — verifies `deleteEdgeKeys` parsing and removal.
4. `fails when proposal has no delta` — verifies `NoDeltaError`.

Final focused run:

```
bun test test/design/agent/graph-execute.test.ts
 4 pass
 0 fail
 12 expect() calls
Ran 4 tests across 1 file.
```

Full design suite run before commit:

```
bun test test/design
 32 pass
 0 fail
 79 expect() calls
Ran 32 tests across 8 files.
```

Typecheck:

```
bun run typecheck
$ tsgo --noEmit
```

## TDD Evidence

### RED

Command: `bun test test/design/agent/graph-execute.test.ts`

```
error: expect(received).toBe(expected)
Expected: "UserServiceV2"
Received: "UserService"
(fail) GraphAgent execute > applies a node update via Design.Service
 0 pass
 1 fail
```

### GREEN

Command: `bun test test/design/agent/graph-execute.test.ts`

```
(pass) GraphAgent execute > applies a node update via Design.Service
 1 pass
 0 fail
 2 expect() calls
Ran 1 test across 1 file.
```

## Files changed

- `packages/opencode/src/design/agent/graph.ts`
- `packages/opencode/src/design/design.ts`
- `packages/opencode/test/design/agent/graph-execute.test.ts`
- `.superpowers/sdd/task-4-report.md`

## Self-review findings

- The order of operations inside `execute` matches the task brief.
- `Design.Service.transaction` runs the supplied effect inside `state.store.transaction`; each internal CRUD call then creates a nested savepoint, which is safe because the Effect SQL client supports nested transactions.
- Edge key parsing assumes the `::` separator used by `DesignTypes.edgeKey` and that node IDs do not contain `::`.
- `addNodes` delta entries are typed as full `DesignTypes.Node` objects; `execute` builds a minimal `createNode` input so the readonly/mutable array mismatch is avoided.
- No `try`/`catch` is used; failures flow through Effect error channels.

## Issues or concerns

None blocking. The main assumption is that `deleteEdgeKeys` uses the same canonical key format produced by `DesignTypes.edgeKey`. If that format ever changes, parsing must stay in sync.
