# Task 1 Report

## Status

DONE

## What changed

- `packages/opencode/src/design/agent/types.ts`
  - Added `NodeInput` and `EdgeInput` interfaces that keep required user-facing fields and make system fields (`id`, `kind`, `aliases`, `connectedEdges`, `createdAt`, `updatedAt`, `retired` for nodes; `createdAt`, `updatedAt` for edges) optional.
  - Updated `GraphDelta` to use `NodeInput[]` / `EdgeInput[]` for `addNodes` / `addEdges` and `Partial<NodeInput>` / `Partial<EdgeInput>` for update patches.
- `packages/opencode/src/design/design.ts`
  - Made `applyRawDelta` tolerant of optional node system fields when adding nodes: copies aliases only when present and uses the created node's generated id for the audit event.
- `packages/opencode/src/design/system/working-set-computer.ts`
  - Only adds `node.id` to involved nodes when it is provided.
- `packages/opencode/test/design/agent/types.test.ts`
  - Added a test constructing a minimal `GraphAgent.GraphDelta` that omits all system fields.

## TDD evidence

### RED — failing typecheck before implementation

```bash
$ bun run typecheck
$ tsgo --noEmit
test/design/agent/types.test.ts(38,18): error TS2740: Type '{ name: string; contextId: string; defaultSemantics: string; }' is missing the following properties from type '{ readonly id: string; readonly name: string; ... }': id, aliases, kind, connectedEdges, and 3 more.
test/design/agent/types.test.ts(39,18): error TS2739: Type '{ leftNodeId: string; rightNodeId: string; prototypeId: string; parameters: {}; }' is missing the following properties from type '{ readonly leftNodeId: string; ... }': createdAt, updatedAt
```

### GREEN — after implementation

```bash
$ bun run typecheck
$ tsgo --noEmit
(no errors)

$ bun test test/design/agent/types.test.ts
bun test v1.3.14 (0d9b296a)
test\design\agent\types.test.ts:
(pass) GraphAgent types > input schema accepts chat source with proposed change [0.09ms]
(pass) GraphAgent types > minimal GraphDelta omits system node and edge fields [0.05ms]
 2 pass
 0 fail
 3 expect() calls
```

## Verification commands

### Typecheck

```bash
$ bun run typecheck
$ tsgo --noEmit
(no errors)
```

### Related tests

```bash
$ bun test test/design/agent/types.test.ts test/design/design.test.ts test/design/e2e/multi-agent.test.ts test/tool/design.test.ts test/design/visual-editor-protocol.test.ts test/design/agent/graph-execute.test.ts test/design/system/working-set-computer.test.ts
bun test v1.3.14 (0d9b296a)
... 29 pass
 0 fail
 79 expect() calls
Ran 29 tests across 7 files. [7.09s]
```

### Full suite

`bun test` from `packages/opencode` was attempted but exceeded the 5-minute timeout before completing. The one observed failure was a pre-existing timeout in `test/server/httpapi-file.test.ts` unrelated to this change.

## Commit

`feat(design): allow GraphDelta to omit system node and edge fields`

Hash: `a40aff7afee1ab04e5ffc877d3a9a681f6d36d57`
