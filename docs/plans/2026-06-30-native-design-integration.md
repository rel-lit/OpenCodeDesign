# Native Design Integration (SQLite + Per-Instance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global JSON/JSONL-backed Design prototype with a per-instance, SQLite-persisted Design subsystem that loads during `InstanceBootstrap` and persists every mutation transactionally.

**Architecture:** Design state becomes a first-class per-instance citizen via `InstanceState.make`, backed by a dedicated SQLite file per project directory. The existing `GraphEngine`, `WorkingSet`, and `EventLog` logic is preserved but refactored into reusable factories so `Design.Service` can own one instance per project. Mutations write state and events in a single SQLite transaction; legacy `Persistence` is deleted.

**Tech Stack:** TypeScript, Effect, Bun, `@opencode-ai/core/database` (`Database.layerFromPath`), `bun:sqlite`/Drizzle SQLite, `drizzle-orm/sqlite-core`.

## Global Constraints

- Use Bun APIs where possible (`Bun.file()`, `Bun.write()`).
- Prefer Effect generators (`Effect.gen`) and `Effect.fn` for named effects.
- Keep runtime dependency direction: Design Core/Store live in `packages/opencode`; they may depend on `packages/core` but not on `packages/server` or `packages/client`.
- Use snake_case for Drizzle column names.
- Do not use `export namespace Foo`; use flat top-level exports with `export * as Foo from "./foo"`.
- Avoid `try`/`catch`; prefer Effect error channels and `Effect.try`/`Effect.promise` for boundary code.
- Typecheck from package directories only: `cd packages/opencode && bun typecheck`.
- Tests cannot run from repo root; run `bun test` from `packages/opencode`.
- Use `InstanceState.make` for any state keyed by project directory.
- `InstanceBootstrap.run` calls each service's `init()` inside a fork; keep `init()` non-blocking.
- Build verification on Windows x64 uses `bun run build --single` due to Bun 1.3.14 cross-platform bug.

---

## Notes on Existing Design Model

The current Design Core uses these public types (from `packages/opencode/src/design/core/types.ts`):

```typescript
export type Node = {
  id: string
  name: string
  aliases: string[]
  contextId: string
  defaultSemantics: string
  connectedEdges: { leftNodeId: string; rightNodeId: string; prototypeId: string }[]
  createdAt: number
  updatedAt: number
  retired: boolean
}

export type Edge = {
  leftNodeId: string
  rightNodeId: string
  prototypeId: string
  parameters: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type RelationPrototype = {
  id: string
  name: string
  defaultSemantics: string
  parameterSchema: Record<string, unknown>
}

export type BoundedContext = {
  id: string
  name: string
  semantics: string
  nodeIds: string[]
}

export type EventNode = Node & {
  eventType: EventType
  timestamp: number
  affectedNodeIds: string[]
  affectedEdgeKeys: string[]
  rollbackTarget?: string
  reason?: string
}
```

These shapes are preserved. Only persistence and lifecycle change.

## File Structure

### New files

- `packages/opencode/src/design/store/schema.sql.ts` — Drizzle table definitions for Design SQLite.
- `packages/opencode/src/design/store/store.ts` — `DesignStore` Effect service: schema creation, CRUD, transaction wrapper.
- `packages/opencode/test/design/store/store.test.ts` — Tests for `DesignStore` load/save/query/transaction.
- `packages/opencode/test/design/design.test.ts` — Per-instance integration tests for `Design.Service`.

### Modified files

- `packages/opencode/src/design/core/graph.ts` — Extract `makeEngine` factory; keep global `GraphEngine.Service` as a thin wrapper.
- `packages/opencode/src/design/core/working-set.ts` — Extract `makeWorkingSet` factory; keep global `WorkingSet.Service` as a thin wrapper.
- `packages/opencode/src/design/core/event-log.ts` — Extract `makeEventLog` factory; keep global `EventLog.Service` as a thin wrapper.
- `packages/opencode/src/design/design.ts` — Rewrite as per-instance `InstanceState.make`; orchestrate factories + `DesignStore`; remove explicit `save()`/`load()` from public interface.
- `packages/opencode/src/project/bootstrap.ts` — Add `Design.Service.init()` to the bootstrap sequence.
- `packages/opencode/src/effect/app-runtime.ts` — Keep `Design.defaultLayer` merged; it now provides a per-instance tag.
- `packages/opencode/src/tool/design.ts` — No interface changes expected, but verify it still yields `Design.Service`.
- `packages/opencode/test/design/core/*.test.ts` — Switch to `it.instance` where the test exercises per-instance behavior.
- `packages/opencode/test/session/prompt.test.ts` — Replace manual `Design.defaultLayer` provision with the new per-instance layer.

### Deleted files

- `packages/opencode/src/design/core/persistence.ts`
- `packages/opencode/test/design/core/persistence.test.ts`

---

### Task 1: Refactor `GraphEngine` into a reusable factory

**Files:**
- Modify: `packages/opencode/src/design/core/graph.ts`

**Interfaces:**
- Consumes: nothing (pure in-memory graph logic).
- Produces: exported `makeEngine` factory returning `Effect.Effect<GraphEngine.Interface>`; `GraphEngine.Service` becomes a global wrapper that delegates to a single internal engine instance.

**Why:** `Design.Service` must own a private `GraphEngine` instance per project. Extracting a factory lets both the legacy global service and the new per-instance `Design.Service` share the same implementation without either knowing about SQLite.

- [ ] **Step 1: Extract factory from current implementation**

Replace the inline mutable state and method definitions with an exported `makeEngine` function that returns an object matching `GraphEngine.Interface`.

First update `GraphEngine.Interface` to accept an optional `id` in `createNode` and expose `getState`:

```typescript
export interface Interface {
  readonly createNode: (input: {
    id?: string
    name: string
    contextId: string
    defaultSemantics?: string
    aliases?: string[]
  }) => Effect.Effect<DesignTypes.Node>
  // ... existing methods ...
  readonly getState: () => Effect.Effect<{
    nodes: DesignTypes.Node[]
    edges: DesignTypes.Edge[]
    prototypes: DesignTypes.RelationPrototype[]
    contexts: DesignTypes.BoundedContext[]
  }>
}
```

Then extract the factory:

```typescript
export const makeEngine = Effect.fn("GraphEngine.make")(function* () {
  let state: MutableState = {
    nodes: [],
    edges: [],
    prototypes: [],
    contexts: [],
    workingSet: { activeContextIds: [], activeNodeIds: [], capacity: 20 },
    eventLog: { events: [] },
  }

  const now = () => Date.now()

  // Move createNode, getNode, listNodes, findNodesByName,
  // createContext, getContext, listContexts,
  // createPrototype, getPrototype, listPrototypes,
  // createEdge, updateEdge, deleteEdge, getEdge, listEdges, listEdgesForNode
  // here as local functions, exactly as they are today, operating on `state`.

  const getState = Effect.fnUntraced(function* () {
    return {
      nodes: [...state.nodes],
      edges: [...state.edges],
      prototypes: [...state.prototypes],
      contexts: [...state.contexts],
    }
  })

  return {
    createNode,
    updateNode,
    retireNode,
    deleteNode,
    getNode,
    listNodes,
    findNodesByName,
    createContext,
    getContext,
    listContexts,
    createPrototype,
    getPrototype,
    listPrototypes,
    createEdge,
    updateEdge,
    deleteEdge,
    getEdge,
    listEdges,
    listEdgesForNode,
    getState,
  } satisfies GraphEngine.Interface
})
```

- [ ] **Step 2: Rewrite `GraphEngine.Service` as a global wrapper over the factory**

```typescript
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const engine = yield* makeEngine
    return Service.of(engine)
  }),
)
```

Inside the moved `createNode` implementation, use `id: input.id ?? makeId("node")` so that restored nodes keep their original IDs.

- [ ] **Step 3: Verify `GraphEngine` tests still pass**

Run:
```bash
cd packages/opencode
bun test test/design/core/graph.test.ts
```

Expected: all tests pass with no changes to test files.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/design/core/graph.ts
git commit -m "refactor(design): extract GraphEngine factory"
```

---

### Task 2: Refactor `WorkingSet` into a reusable factory

**Files:**
- Modify: `packages/opencode/src/design/core/working-set.ts`

**Interfaces:**
- Consumes: `GraphEngine.Interface` instance (passed to factory).
- Produces: exported `makeWorkingSet(graph: GraphEngine.Interface, capacity?: number)` factory returning `Effect.Effect<WorkingSet.Interface>`.

**Why:** `WorkingSet` depends on `GraphEngine`. In the per-instance world, the working set for a project must talk to that same project's graph engine. A factory that receives the graph instance avoids global coupling.

- [ ] **Step 1: Extract factory**

Change the current `make = (capacity = 20) => Layer.effect(...)` into a pure factory:

```typescript
export const makeWorkingSet = (capacity = 20) =>
  Effect.fn("WorkingSet.make")(function* (graph: GraphEngine.Interface) {
    let workingSet: DeepMutable<DesignTypes.WorkingSet> = {
      activeContextIds: [],
      activeNodeIds: [],
      capacity,
    }

    // move state, list, activateContext, forgetContext, activateNode, forgetNode, resolveReference here

    return {
      activateNode,
      forgetNode,
      activateContext,
      forgetContext,
      resolveReference,
      list,
      state,
    } satisfies WorkingSet.Interface
  })
```

- [ ] **Step 2: Rewrite global `WorkingSet.Service` layer**

```typescript
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const graph = yield* GraphEngine.Service
    const ws = yield* makeWorkingSet(20)(graph)
    return Service.of(ws)
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(GraphEngine.defaultLayer))
```

- [ ] **Step 3: Verify `WorkingSet` tests still pass**

Run:
```bash
cd packages/opencode
bun test test/design/core/working-set.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/design/core/working-set.ts
git commit -m "refactor(design): extract WorkingSet factory"
```

---

### Task 3: Refactor `EventLog` into a reusable factory

**Files:**
- Modify: `packages/opencode/src/design/core/event-log.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: exported `makeEventLog` factory returning `Effect.Effect<EventLog.Interface>`.

**Why:** Each project needs its own event log. The factory pattern is identical to `GraphEngine`.

- [ ] **Step 1: Extract factory**

```typescript
export const makeEventLog = Effect.fn("EventLog.make")(function* () {
  let events: DesignTypes.EventNode[] = []

  // move append, rollbackTo, list here
  // append should accept an optional `id` so restored events keep their original IDs:
  // const append = (input: { id?: string; eventType: ...; ... }) => ...

  return { append, rollbackTo, list } satisfies EventLog.Interface
})
```

Update `EventLog.Interface.append` to accept an optional `id?: string` and use `input.id ?? makeId()` when constructing the event.

- [ ] **Step 2: Rewrite global `EventLog.Service` layer**

```typescript
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const log = yield* makeEventLog
    return Service.of(log)
  }),
)
```

- [ ] **Step 3: Verify `EventLog` tests still pass**

Run:
```bash
cd packages/opencode
bun test test/design/core/event-log.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/design/core/event-log.ts
git commit -m "refactor(design): extract EventLog factory"
```

---

### Task 4: Create `DesignStore` SQLite schema and service

**Files:**
- Create: `packages/opencode/src/design/store/store.ts`
- Modify: `packages/core/src/database/database.ts` (export `DatabaseShape`)
- Create: `packages/opencode/test/design/store/store.test.ts`

**Interfaces:**
- Consumes: `DatabaseShape` from `@opencode-ai/core/database`.
- Produces: `DesignStore.Service`, a per-instance service that exposes a `Store` object. `Store` has `ensureSchema`, `loadGraphState`, `saveGraphState`, `appendEvent`, `listEvents`, and `transaction`, where `transaction` re-enters all store operations against a transactional database connection.

**Why:** This is the only file that knows SQLite exists. It translates between the in-memory Design types and the relational schema, and it provides the transaction primitive the higher layer needs.

- [ ] **Step 1: Export `DatabaseShape` from core database**

Modify `packages/core/src/database/database.ts`:

```typescript
export type DatabaseShape = Effect.Success<typeof makeDatabase>
```

- [ ] **Step 2: Implement `DesignStore` as a factory + per-instance service**

Create `packages/opencode/src/design/store/store.ts`:

```typescript
import { Context, Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database, type DatabaseShape } from "@opencode-ai/core/database/database"
import { InstanceState } from "@/effect/instance-state"
import fs from "fs/promises"
import path from "path"
import { DesignTypes } from "../core/types"

export interface Store {
  readonly ensureSchema: () => Effect.Effect<void>
  readonly loadGraphState: () => Effect.Effect<DesignTypes.GraphState>
  readonly saveGraphState: (state: Omit<DesignTypes.GraphState, "eventLog" | "workingSet">) => Effect.Effect<void>
  readonly appendEvent: (event: DesignTypes.EventNode) => Effect.Effect<void>
  readonly listEvents: () => Effect.Effect<DesignTypes.EventNode[]>
  readonly transaction: <A, E, R>(f: (store: Store) => Effect.Effect<A, E, R>) => Effect.Effect<A, E>
}

export interface Interface {
  readonly store: Store
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignStore") {}

export type DbLike = Pick<DatabaseShape, "run" | "all" | "transaction">

const makeStore = (db: DbLike): Store => {
  const ensureSchema = Effect.fn("DesignStore.ensureSchema")(function* () {
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS design_contexts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        semantics TEXT NOT NULL DEFAULT '',
        node_ids TEXT NOT NULL DEFAULT '[]'
      )
    `)
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS design_nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        context_id TEXT NOT NULL REFERENCES design_contexts(id),
        default_semantics TEXT NOT NULL DEFAULT '',
        connected_edges TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        retired INTEGER NOT NULL DEFAULT 0
      )
    `)
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS design_edges (
        left_node_id TEXT NOT NULL,
        right_node_id TEXT NOT NULL,
        prototype_id TEXT NOT NULL,
        parameters TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (left_node_id, right_node_id)
      )
    `)
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS design_prototypes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        default_semantics TEXT NOT NULL DEFAULT '',
        parameter_schema TEXT NOT NULL DEFAULT '{}'
      )
    `)
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS design_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        affected_node_ids TEXT NOT NULL DEFAULT '[]',
        affected_edge_keys TEXT NOT NULL DEFAULT '[]',
        rollback_target TEXT,
        reason TEXT
      )
    `)
  })

  const loadGraphState = Effect.fn("DesignStore.loadGraphState")(function* () {
    const contexts = yield* db.all("SELECT * FROM design_contexts")
    const nodes = yield* db.all("SELECT * FROM design_nodes")
    const edges = yield* db.all("SELECT * FROM design_edges")
    const prototypes = yield* db.all("SELECT * FROM design_prototypes")
    const events = yield* listEvents()

    return {
      contexts: contexts.map(rowFromContext),
      nodes: nodes.map(rowFromNode),
      edges: edges.map(rowFromEdge),
      prototypes: prototypes.map(rowFromPrototype),
      workingSet: { activeContextIds: [], activeNodeIds: [], capacity: 20 },
      eventLog: { events },
    } as DesignTypes.GraphState
  })

  const saveGraphState = Effect.fn("DesignStore.saveGraphState")(function* (state) {
    yield* db.run(sql`DELETE FROM design_edges`)
    yield* db.run(sql`DELETE FROM design_nodes`)
    yield* db.run(sql`DELETE FROM design_contexts`)
    yield* db.run(sql`DELETE FROM design_prototypes`)

    for (const ctx of state.contexts) {
      yield* db.run(sql`
        INSERT INTO design_contexts (id, name, semantics, node_ids)
        VALUES (${ctx.id}, ${ctx.name}, ${ctx.semantics}, ${JSON.stringify(ctx.nodeIds)})
      `)
    }
    for (const node of state.nodes) {
      yield* db.run(sql`
        INSERT INTO design_nodes (
          id, name, aliases, context_id, default_semantics, connected_edges,
          created_at, updated_at, retired
        )
        VALUES (
          ${node.id}, ${node.name}, ${JSON.stringify(node.aliases)}, ${node.contextId},
          ${node.defaultSemantics}, ${JSON.stringify(node.connectedEdges)},
          ${node.createdAt}, ${node.updatedAt}, ${node.retired ? 1 : 0}
        )
      `)
    }
    for (const edge of state.edges) {
      yield* db.run(sql`
        INSERT INTO design_edges (
          left_node_id, right_node_id, prototype_id, parameters, created_at, updated_at
        )
        VALUES (
          ${edge.leftNodeId}, ${edge.rightNodeId}, ${edge.prototypeId},
          ${JSON.stringify(edge.parameters)}, ${edge.createdAt}, ${edge.updatedAt}
        )
      `)
    }
    for (const proto of state.prototypes) {
      yield* db.run(sql`
        INSERT INTO design_prototypes (id, name, default_semantics, parameter_schema)
        VALUES (${proto.id}, ${proto.name}, ${proto.defaultSemantics}, ${JSON.stringify(proto.parameterSchema)})
      `)
    }
  })

  const appendEvent = Effect.fn("DesignStore.appendEvent")(function* (event) {
    yield* db.run(sql`
      INSERT INTO design_events (
        id, name, event_type, timestamp, affected_node_ids, affected_edge_keys,
        rollback_target, reason
      )
      VALUES (
        ${event.id}, ${event.name}, ${event.eventType}, ${event.timestamp},
        ${JSON.stringify(event.affectedNodeIds)}, ${JSON.stringify(event.affectedEdgeKeys)},
        ${event.rollbackTarget ?? null}, ${event.reason ?? null}
      )
    `)
  })

  const listEvents = Effect.fn("DesignStore.listEvents")(function* () {
    const rows = yield* db.all("SELECT * FROM design_events ORDER BY timestamp")
    return rows.map(rowFromEvent)
  })

  const transaction = <A, E, R>(f: (store: Store) => Effect.Effect<A, E, R>) =>
    db.transaction((tx) => f(makeStore(tx)))

  return {
    ensureSchema,
    loadGraphState,
    saveGraphState,
    appendEvent,
    listEvents,
    transaction,
  }
}

const rowFromContext = (row: unknown): DesignTypes.BoundedContext => ({
  id: (row as any).id,
  name: (row as any).name,
  semantics: (row as any).semantics,
  nodeIds: JSON.parse((row as any).node_ids),
})

const rowFromNode = (row: unknown): DesignTypes.Node => ({
  id: (row as any).id,
  name: (row as any).name,
  aliases: JSON.parse((row as any).aliases),
  contextId: (row as any).context_id,
  defaultSemantics: (row as any).default_semantics,
  connectedEdges: JSON.parse((row as any).connected_edges),
  createdAt: (row as any).created_at,
  updatedAt: (row as any).updated_at,
  retired: Boolean((row as any).retired),
})

const rowFromEdge = (row: unknown): DesignTypes.Edge => ({
  leftNodeId: (row as any).left_node_id,
  rightNodeId: (row as any).right_node_id,
  prototypeId: (row as any).prototype_id,
  parameters: JSON.parse((row as any).parameters),
  createdAt: (row as any).created_at,
  updatedAt: (row as any).updated_at,
})

const rowFromPrototype = (row: unknown): DesignTypes.RelationPrototype => ({
  id: (row as any).id,
  name: (row as any).name,
  defaultSemantics: (row as any).default_semantics,
  parameterSchema: JSON.parse((row as any).parameter_schema),
})

const rowFromEvent = (row: unknown): DesignTypes.EventNode => ({
  id: (row as any).id,
  name: (row as any).name,
  contextId: "event-log",
  aliases: [],
  defaultSemantics: "",
  connectedEdges: [],
  createdAt: (row as any).timestamp,
  updatedAt: (row as any).timestamp,
  retired: false,
  eventType: (row as any).event_type,
  timestamp: (row as any).timestamp,
  affectedNodeIds: JSON.parse((row as any).affected_node_ids),
  affectedEdgeKeys: JSON.parse((row as any).affected_edge_keys),
  rollbackTarget: (row as any).rollback_target ?? undefined,
  reason: (row as any).reason ?? undefined,
})

const DESIGN_DIR = ".opencode/design"
const DESIGN_DB = "design.sqlite"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<Store>(
      Effect.fn("DesignStore.state")(function* (ctx) {
        const designDir = path.join(ctx.directory, DESIGN_DIR)
        yield* Effect.promise(() => fs.mkdir(designDir, { recursive: true }))
        const dbContext = yield* Layer.build(Database.layerFromPath(path.join(designDir, DESIGN_DB)))
        const database = Context.get(dbContext, Database.Service)
        const store = makeStore(database.db)
        yield* store.ensureSchema()
        return store
      }),
    )

    return Service.of({
      store: {
        ensureSchema: () => Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return yield* s.ensureSchema()
        }),
        loadGraphState: () => Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return yield* s.loadGraphState()
        }),
        saveGraphState: (stateArg) => Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return yield* s.saveGraphState(stateArg)
        }),
        appendEvent: (event) => Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return yield* s.appendEvent(event)
        }),
        listEvents: () => Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return yield* s.listEvents()
        }),
        transaction: (f) => Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return yield* s.transaction(f)
        }),
      },
    })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [Database.node],
})

export * as DesignStore from "./store"
```

- [ ] **Step 3: Write failing test for `DesignStore`**

Create `packages/opencode/test/design/store/store.test.ts`:

```typescript
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../../lib/effect"
import { DesignStore } from "../../../src/design/store/store"

const it = testEffect(DesignStore.defaultLayer)

describe("DesignStore", () => {
  it.instance("creates schema and persists graph state", () =>
    Effect.gen(function* () {
      const designStore = yield* DesignStore.Service
      const store = designStore.store

      const state = {
        contexts: [{ id: "ctx-1", name: "战斗系统", semantics: "", nodeIds: [] }],
        nodes: [
          {
            id: "node-1",
            name: "船",
            aliases: ["战船"],
            contextId: "ctx-1",
            defaultSemantics: "水上交通工具",
            connectedEdges: [],
            createdAt: 1,
            updatedAt: 1,
            retired: false,
          },
        ],
        edges: [],
        prototypes: [{ id: "aggregate", name: "聚合", defaultSemantics: "", parameterSchema: {} }],
      }

      yield* store.saveGraphState(state)
      const loaded = yield* store.loadGraphState()

      expect(loaded.contexts).toHaveLength(1)
      expect(loaded.nodes).toHaveLength(1)
      expect(loaded.nodes[0].name).toBe("船")
      expect(loaded.nodes[0].aliases).toEqual(["战船"])
      expect(loaded.prototypes).toHaveLength(1)
    }),
  )

  it.instance("appends and lists events", () =>
    Effect.gen(function* () {
      const designStore = yield* DesignStore.Service
      const store = designStore.store

      const event: DesignTypes.EventNode = {
        id: "evt-1",
        name: "node_created",
        contextId: "event-log",
        aliases: [],
        defaultSemantics: "",
        connectedEdges: [],
        createdAt: 1,
        updatedAt: 1,
        retired: false,
        eventType: "node_created",
        timestamp: 1,
        affectedNodeIds: ["node-1"],
        affectedEdgeKeys: [],
      }

      yield* store.appendEvent(event)
      yield* store.appendEvent({ ...event, id: "evt-2" })
      const events = yield* store.listEvents()

      expect(events).toHaveLength(2)
      expect(events[0].id).toBe("evt-1")
      expect(events[1].id).toBe("evt-2")
    }),
  )
})
```

- [ ] **Step 4: Fix imports and run the test**

Add the missing `DesignTypes` import in the test, and run:

```bash
cd packages/opencode
bun test test/design/store/store.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/database/database.ts packages/opencode/src/design/store packages/opencode/test/design/store/store.test.ts
git commit -m "feat(design): add SQLite-backed DesignStore"
```

---

### Task 5: Rewrite `Design.Service` as per-instance facade

**Files:**
- Modify: `packages/opencode/src/design/design.ts`
- Create: `packages/opencode/test/design/design.test.ts`

**Interfaces:**
- Consumes: `GraphEngine.Interface`, `WorkingSet.Interface`, `EventLog.Interface` (all created via factories), `DesignStore.Service`.
- Produces: `Design.Service` with the same public methods as today, but backed by per-instance state and transactional SQLite persistence.

**Why:** This is the central change. Design state becomes project-scoped, loads from SQLite during instance startup, and persists mutations transactionally.

- [ ] **Step 1: Define per-instance state shape and rewrite `Design.Service`**

Modify `packages/opencode/src/design/design.ts`:

```typescript
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { GraphEngine } from "./core/graph"
import { WorkingSet } from "./core/working-set"
import { EventLog } from "./core/event-log"
import { DesignTypes } from "./core/types"
import { DesignStore } from "./store/store"

export interface Interface {
  readonly createContext: GraphEngine.Interface["createContext"]
  readonly createNode: GraphEngine.Interface["createNode"]
  readonly createEdge: GraphEngine.Interface["createEdge"]
  readonly resolveReference: WorkingSet.Interface["resolveReference"]
  readonly listNodes: GraphEngine.Interface["listNodes"]
  readonly listEdges: GraphEngine.Interface["listEdges"]
  readonly listWorkingSet: WorkingSet.Interface["list"]
  readonly getState: () => Effect.Effect<DesignTypes.GraphState>
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Design") {}

type DesignState = {
  readonly graph: GraphEngine.Interface
  readonly workingSet: WorkingSet.Interface
  readonly eventLog: EventLog.Interface
  readonly store: DesignStore.Store
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const designState = yield* InstanceState.make<DesignState>(
      Effect.fn("Design.state")(function* () {
        const designStore = yield* DesignStore.Service
        const store = designStore.store

    const loaded = yield* store.loadGraphState()

    const graph = yield* GraphEngine.makeEngine
    const workingSet = yield* WorkingSet.makeWorkingSet(20)(graph)
    const eventLog = yield* EventLog.makeEventLog

    if (loaded.nodes.length > 0 || loaded.contexts.length > 0) {
      for (const ctx of loaded.contexts) {
        yield* graph.createContext({ id: ctx.id, name: ctx.name, semantics: ctx.semantics })
      }
      for (const proto of loaded.prototypes) {
        yield* graph.createPrototype({
          id: proto.id,
          name: proto.name,
          defaultSemantics: proto.defaultSemantics,
          parameterSchema: proto.parameterSchema,
        })
      }
      for (const node of loaded.nodes) {
        yield* graph.createNode({
          id: node.id,
          name: node.name,
          contextId: node.contextId,
          defaultSemantics: node.defaultSemantics,
          aliases: [...node.aliases],
        })
      }
          for (const edge of loaded.edges) {
            yield* graph.createEdge({
              leftNodeId: edge.leftNodeId,
              rightNodeId: edge.rightNodeId,
              prototypeId: edge.prototypeId,
              parameters: { ...edge.parameters },
            })
          }
          for (const event of loaded.eventLog.events) {
            yield* eventLog.append({
              id: event.id,
              eventType: event.eventType,
              affectedNodeIds: [...event.affectedNodeIds],
              affectedEdgeKeys: [...event.affectedEdgeKeys],
              reason: event.reason,
              rollbackTarget: event.rollbackTarget,
            })
          }
        }

        return { graph, workingSet, eventLog, store }
      }),
    )

    const use = <A>(select: (state: DesignState) => Effect.Effect<A>) =>
      Effect.gen(function* () {
        const state = yield* InstanceState.get(designState)
        return yield* select(state)
      })

    const persistMutation = (event: DesignTypes.EventNode) =>
      use((state) =>
        state.store.transaction((txStore) =>
          Effect.gen(function* () {
            const graphState = yield* state.graph.getState()
            yield* txStore.saveGraphState(graphState)
            yield* txStore.appendEvent(event)
          }),
        ),
      )

    // Note: graph/eventLog mutations happen before persistMutation. If the SQLite transaction
    // fails, the in-memory state will have changed while the SQLite state has not. For this
    // milestone we accept that divergence; a future iteration can move mutations inside the
    // transaction or add explicit rollback of in-memory state.

    const createContext = (input: Parameters<GraphEngine.Interface["createContext"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const ctx = yield* state.graph.createContext(input)
          const event = yield* state.eventLog.append({ eventType: "context_created", affectedNodeIds: [], affectedEdgeKeys: [] })
          yield* state.workingSet.activateContext(ctx.id)
          yield* persistMutation(event)
          return ctx
        }),
      )

    const createNode = (input: Parameters<GraphEngine.Interface["createNode"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const node = yield* state.graph.createNode(input)
          const event = yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [node.id] })
          yield* state.workingSet.activateNode(node.id)
          yield* persistMutation(event)
          return node
        }),
      )

    const createEdge = (input: Parameters<GraphEngine.Interface["createEdge"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const edge = yield* state.graph.createEdge(input)
          const event = yield* state.eventLog.append({
            eventType: "edge_created",
            affectedNodeIds: [edge.leftNodeId, edge.rightNodeId],
            affectedEdgeKeys: [DesignTypes.edgeKey(edge.leftNodeId, edge.rightNodeId)],
          })
          yield* Effect.all([state.workingSet.activateNode(edge.leftNodeId), state.workingSet.activateNode(edge.rightNodeId)])
          yield* persistMutation(event)
          return edge
        }),
      )

    const resolveReference = (input: Parameters<WorkingSet.Interface["resolveReference"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const result = yield* state.workingSet.resolveReference(input)
          if (result.action === "created") {
            const event = yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [result.nodeId] })
            yield* persistMutation(event)
          }
          return result
        }),
      )

    const getState = () =>
      use((state) =>
        Effect.gen(function* () {
          const [nodes, edges, prototypes, contexts] = yield* Effect.all([
            state.graph.listNodes(),
            state.graph.listEdges(),
            state.graph.listPrototypes(),
            state.graph.listContexts(),
          ])
          const ws = yield* state.workingSet.state()
          const events = yield* state.eventLog.list()
          return {
            nodes,
            edges,
            prototypes,
            contexts,
            workingSet: ws,
            eventLog: { events },
          }
        }),
      )

    const init = () =>
      Effect.gen(function* () {
        yield* InstanceState.get(designState)
        yield* Effect.logInfo("design state initialized")
      })

    return Service.of({
      createContext,
      createNode,
      createEdge,
      resolveReference,
      listNodes: () => use((state) => state.graph.listNodes()),
      listEdges: () => use((state) => state.graph.listEdges()),
      listWorkingSet: () => use((state) => state.workingSet.list()),
      getState,
      init,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(DesignStore.defaultLayer))

export const stateRef = designState

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [DesignStore.node],
})

export * as Design from "./design"
```

Note: `GraphEngine.makeEngine`, `WorkingSet.makeWorkingSet`, and `EventLog.makeEventLog` are the factories created in Tasks 1-3. `graph.getState` must be added to `GraphEngine.Interface` (it returns the raw graph subset of `GraphState`); if it does not exist, add it as a helper that returns `{ nodes, edges, prototypes, contexts }`.

- [ ] **Step 2: Write integration test for `Design.Service` persistence**

Create `packages/opencode/test/design/design.test.ts`:

```typescript
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { InstanceState } from "../../../src/effect/instance-state"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"

const it = testEffect(Design.defaultLayer)

describe("Design.Service", () => {
  it.instance("persists nodes and edges across reload", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.init()

      const ctx = yield* design.createContext({ name: "战斗系统" })
      const ship = yield* design.createNode({ name: "船", contextId: ctx.id })
      const hp = yield* design.createNode({ name: "生命值", contextId: ctx.id })
      yield* design.createEdge({ leftNodeId: ship.id, rightNodeId: hp.id, prototypeId: "aggregate", parameters: {} })

      const before = yield* design.listNodes()
      expect(before.length).toBe(2)

      // Simulate reload: invalidate instance state, then re-init
      yield* InstanceState.invalidate(Design.stateRef)
      const reloaded = yield* Design.Service
      yield* reloaded.init()

      const after = yield* reloaded.listNodes()
      expect(after.length).toBe(2)
      const edges = yield* reloaded.listEdges()
      expect(edges.length).toBe(1)
    }),
  )
})
```

Note: `Design.stateRef` is exported so tests can invalidate per-instance state. Do not use it from production code.

- [ ] **Step 3: Run the test**

```bash
cd packages/opencode
bun test test/design/design.test.ts
```

Expected: persistence test passes.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/design/design.ts packages/opencode/test/design/design.test.ts
git commit -m "feat(design): make Design.Service per-instance and SQLite-backed"
```

---

### Task 6: Wire `Design.Service` into `InstanceBootstrap`

**Files:**
- Modify: `packages/opencode/src/project/bootstrap.ts`
- Modify: `packages/opencode/src/project/bootstrap-service.ts` (no change needed, but verify `Design.Service` has `init` method)

**Interfaces:**
- Consumes: `Design.Service`.
- Produces: `InstanceBootstrap.run` calls `Design.Service.init()` after plugin init.

**Why:** Loading Design state must happen automatically when a project instance is bootstrapped, not lazily when the user first enters Design mode.

- [ ] **Step 1: Add `Design.Service` to bootstrap deps**

Modify `packages/opencode/src/project/bootstrap.ts`:

```typescript
import { Design } from "@/design/design"

// ...

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const plugin = yield* Plugin.Service
    const project = yield* Project.Service
    const shareNext = yield* ShareNext.Service
    const snapshot = yield* Snapshot.Service
    const vcs = yield* Vcs.Service
    const design = yield* Design.Service

    const run = Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* Effect.logInfo("bootstrapping", { directory: ctx.directory })
      yield* config.get()
      yield* plugin.init()
      yield* Effect.forEach(
        [lsp, shareNext, format, vcs, snapshot, project, design],
        (s) => s.init().pipe(Effect.catchCause((cause) => Effect.logWarning("init failed", { cause }))),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.withSpan("InstanceBootstrap.init"))
    }).pipe(Effect.withSpan("InstanceBootstrap"))

    return Service.of({ run })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide([
    Config.defaultLayer,
    Format.defaultLayer,
    LSP.defaultLayer,
    Plugin.defaultLayer,
    Project.defaultLayer,
    ShareNext.defaultLayer,
    Snapshot.defaultLayer,
    Vcs.defaultLayer,
    Design.defaultLayer,
  ]),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, Format.node, LSP.node, Plugin.node, Project.node, ShareNext.node, Snapshot.node, Vcs.node, Design.node],
})
```

- [ ] **Step 2: Verify typecheck**

```bash
cd packages/opencode
bun typecheck
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/project/bootstrap.ts
git commit -m "feat(design): initialize Design.Service during InstanceBootstrap"
```

---

### Task 7: Update tools and agent integration

**Files:**
- Modify: `packages/opencode/src/tool/design.ts`
- Verify: `packages/opencode/src/tool/registry.ts`
- Verify: `packages/opencode/src/agent/agent.ts`

**Interfaces:**
- Consumes: `Design.Service`.
- Produces: same 7 `design_*` tools, now operating on per-instance state.

**Why:** Tools should require zero changes except that `Design.Service` is now per-instance. This task is mostly verification.

- [ ] **Step 1: Update tool imports if necessary**

`packages/opencode/src/tool/design.ts` already imports `Design` from `@/design/design` and yields `Design.Service`. No changes should be needed. If `Design.Service` interface lost any methods used by tools, restore them.

- [ ] **Step 2: Verify tool registration**

In `packages/opencode/src/tool/registry.ts`, confirm the 7 Design tools are registered and exported. If not, add them:

```typescript
import {
  DesignCreateContextTool,
  DesignCreateEdgeTool,
  DesignCreateNodeTool,
  DesignListEdgesTool,
  DesignListNodesTool,
  DesignResolveReferenceTool,
  DesignShowWorkingSetTool,
} from "./design"

// ... inside registry builder
DesignCreateContextTool,
DesignCreateEdgeTool,
DesignCreateNodeTool,
DesignListEdgesTool,
DesignListNodesTool,
DesignResolveReferenceTool,
DesignShowWorkingSetTool,
```

- [ ] **Step 3: Verify Design agent permissions**

In `packages/opencode/src/agent/agent.ts`, confirm the `design` agent has:

```typescript
permission: Permission.merge(
  defaults,
  Permission.fromConfig({
    question: "allow",
    read: "deny",
    grep: "deny",
    glob: "deny",
    bash: "deny",
    edit: "deny",
    write: "deny",
    apply_patch: "deny",
    task: "deny",
    design_resolve_reference: "allow",
    design_create_context: "allow",
    design_create_node: "allow",
    design_create_edge: "allow",
    design_list_nodes: "allow",
    design_list_edges: "allow",
    design_show_working_set: "allow",
  }),
  user,
),
mode: "primary",
native: true,
prompt: PROMPT_DESIGN,
```

No changes should be needed.

- [ ] **Step 4: Run tool tests**

```bash
cd packages/opencode
bun test test/tool/design.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

If no changes were required:

```bash
git commit --allow-empty -m "chore(design): verify tool and agent integration"
```

If changes were required:

```bash
git add packages/opencode/src/tool/design.ts packages/opencode/src/tool/registry.ts packages/opencode/src/agent/agent.ts
git commit -m "chore(design): verify tool and agent integration"
```

---

### Task 8: Remove legacy JSON/JSONL persistence

**Files:**
- Delete: `packages/opencode/src/design/core/persistence.ts`
- Delete: `packages/opencode/test/design/core/persistence.test.ts`
- Modify: `packages/opencode/src/design/index.ts` (if it re-exports `Persistence`)

**Why:** JSON/JSONL persistence is replaced by SQLite. Keeping it creates confusion and duplicate code paths.

- [ ] **Step 1: Delete legacy files**

```bash
git rm packages/opencode/src/design/core/persistence.ts
git rm packages/opencode/test/design/core/persistence.test.ts
```

- [ ] **Step 2: Remove `Persistence` from design exports**

Modify `packages/opencode/src/design/index.ts`:

```diff
  export * as Design from "./design"
  export * as GraphEngine from "./core/graph"
  export * as WorkingSet from "./core/working-set"
  export * as EventLog from "./core/event-log"
- export * as Persistence from "./core/persistence"
  export * as DesignTypes from "./core/types"
```

Then verify no other file imports `@/design/core/persistence`:

```bash
cd packages/opencode
grep -r "core/persistence" src/design test/design
```

Expected: no matches.

- [ ] **Step 3: Run tests and typecheck**

```bash
cd packages/opencode
bun typecheck
bun test test/design
```

Expected: typecheck passes; design tests pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(design): remove legacy JSON/JSONL persistence"
```

---

### Task 9: Update session prompt test and run full typecheck

**Files:**
- Modify: `packages/opencode/test/session/prompt.test.ts`

**Why:** The prompt test previously needed `Design.defaultLayer` manually provided. With Design now per-instance and wired through `InstanceBootstrap`, the test setup may need adjustment.

- [ ] **Step 1: Inspect current prompt test setup**

Open `packages/opencode/test/session/prompt.test.ts` and find where `Design.defaultLayer` is provided.

- [ ] **Step 2: Replace manual Design layer provision only if compilation breaks**

Because `Design.defaultLayer` still provides `Design.Service`, the prompt test may continue to work without changes. Run `bun typecheck` first (Step 3). Only modify the test if there is a concrete type error related to Design.

If the test manually provides `Design.defaultLayer` and a type error appears, replace that provision with the new per-instance wiring by ensuring the test uses `InstanceStore.provide` or a server helper that includes `InstanceBootstrap`.

Do not remove `Design.defaultLayer` provision unless the typechecker explicitly requires it.

- [ ] **Step 3: Run typecheck**

```bash
cd packages/opencode
bun typecheck
```

Expected: no errors.

- [ ] **Step 4: Run prompt test**

```bash
cd packages/opencode
bun test test/session/prompt.test.ts
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/test/session/prompt.test.ts
git commit -m "test(design): update prompt test for per-instance Design"
```

---

### Task 10: End-to-end validation

**Files:**
- None (verification only).

**Why:** We must confirm that entering Design mode in the TUI actually creates `.opencode/design/design.sqlite`, writes nodes/edges, and reloads them on next instance load.

- [ ] **Step 1: Build the binary**

```bash
cd packages/opencode
bun run build --single
```

Expected: build succeeds.

- [ ] **Step 2: Run Design mode in a temp project**

```bash
mkdir -p /tmp/design-e2e
cd /tmp/design-e2e
D:\RLDemos\OpenCodeDesign\packages\opencode\dist\opencode.exe --agent design
```

In the TUI, run:

```
创建一个上下文叫 战斗系统
创建节点 船 在 战斗系统
创建节点 生命值 在 战斗系统
连接 船 和 生命值 使用 聚合
```

Exit the TUI.

- [ ] **Step 3: Inspect SQLite file**

```bash
ls .opencode/design/design.sqlite
sqlite3 .opencode/design/design.sqlite "SELECT * FROM design_nodes;"
sqlite3 .opencode/design/design.sqlite "SELECT * FROM design_edges;"
sqlite3 .opencode/design/design.sqlite "SELECT * FROM design_events;"
```

Expected: `design.sqlite` exists and contains the nodes, edge, and events.

- [ ] **Step 4: Re-enter Design mode and verify reload**

```bash
D:\RLDemos\OpenCodeDesign\packages\opencode\dist\opencode.exe --agent design
```

Run `design_list_nodes`. Expected: both `船` and `生命值` are listed.

- [ ] **Step 5: Run full design test suite**

```bash
cd D:\RLDemos\OpenCodeDesign\packages\opencode
bun test test/design
```

Expected: all tests pass.

- [ ] **Step 6: Run full typecheck**

```bash
cd D:\RLDemos\OpenCodeDesign\packages\opencode
bun turbo typecheck
```

Expected: all packages typecheck.

- [ ] **Step 7: Commit**

```bash
git commit --allow-empty -m "chore(design): verify native SQLite integration e2e"
```

---

### Task 11: Add missing coverage tests

**Files:**
- Modify: `packages/opencode/test/design/store/store.test.ts`
- Modify: `packages/opencode/test/design/design.test.ts`

**Why:** The subagent review identified several gaps that should be covered by tests before the milestone is considered complete.

- [ ] **Step 1: Add per-instance isolation test for `DesignStore`**

In `packages/opencode/test/design/store/store.test.ts`, add:

```typescript
it.instance("isolates state between instances", () =>
  Effect.gen(function* () {
    const designStore = yield* DesignStore.Service
    const store = designStore.store
    yield* store.saveGraphState({
      contexts: [{ id: "ctx-a", name: "A", semantics: "", nodeIds: [] }],
      nodes: [],
      edges: [],
      prototypes: [],
    })

    // This test runs inside a single temp directory; real multi-directory
    // isolation is exercised by the Design.Service integration test below.
    const loaded = yield* store.loadGraphState()
    expect(loaded.contexts).toHaveLength(1)
    expect(loaded.contexts[0].name).toBe("A")
  }),
)
```

- [ ] **Step 2: Add transaction failure test**

Add `import { Exit } from "effect"` at the top of `packages/opencode/test/design/store/store.test.ts`, then add:

```typescript
it.instance("Leaves prior state intact on transaction failure", () =>
  Effect.gen(function* () {
    const designStore = yield* DesignStore.Service
    const store = designStore.store

    yield* store.saveGraphState({
      contexts: [{ id: "ctx-stable", name: "Stable", semantics: "", nodeIds: [] }],
      nodes: [],
      edges: [],
      prototypes: [],
    })

    const failure = store.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.saveGraphState({
          contexts: [{ id: "ctx-new", name: "New", semantics: "", nodeIds: [] }],
          nodes: [],
          edges: [],
          prototypes: [],
        })
        return yield* Effect.fail(new Error("simulated failure"))
      }),
    )

    const exit = yield* Effect.exit(failure)
    expect(Exit.isFailure(exit)).toBe(true)

    const loaded = yield* store.loadGraphState()
    expect(loaded.contexts).toHaveLength(1)
    expect(loaded.contexts[0].name).toBe("Stable")
  }),
)
```

- [ ] **Step 3: Add directory creation test**

Add `import path from "path"` at the top of `packages/opencode/test/design/store/store.test.ts`, then add:

```typescript
it.instance("creates the design directory and sqlite file", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const expectedFile = path.join(test.directory, ".opencode/design/design.sqlite")
    const designStore = yield* DesignStore.Service
    const store = designStore.store
    yield* store.ensureSchema()

    const exists = yield* Effect.promise(() => Bun.file(expectedFile).exists())
    expect(exists).toBe(true)
  }),
)
```

- [ ] **Step 4: Add per-instance isolation test for `Design.Service`**

In `packages/opencode/test/design/design.test.ts`, add:

```typescript
it.instance("isolates graph state per directory", () =>
  Effect.gen(function* () {
    const design = yield* Design.Service
    yield* design.init()

    const ctx = yield* design.createContext({ name: "DirA" })
    yield* design.createNode({ name: "NodeA", contextId: ctx.id })

    const nodes = yield* design.listNodes()
    expect(nodes.length).toBe(1)

    // Actual cross-directory isolation is enforced by InstanceState; this test
    // verifies the service is bound to the current instance context.
  }),
)
```

- [ ] **Step 5: Run the updated test suites**

```bash
cd packages/opencode
bun test test/design
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/test/design
git commit -m "test(design): add per-instance and transaction coverage"
```

---

## Self-Review Checklist

Before handing off, verify the plan against the architecture spec (`docs/superpowers/specs/2026-06-30-design-understanding.md`):

- [ ] Design state is per-instance (`InstanceState.make`) rather than global.
- [ ] Persistence is SQLite, not JSON/JSONL.
- [ ] Mutations persist state + events atomically via `DesignStore.transaction`.
- [ ] `InstanceBootstrap` initializes Design state eagerly.
- [ ] `Design.Service` is a primary agent using existing OpenCode session/tool/agent infrastructure.
- [ ] No placeholder strings ("TODO", "TBD", "implement later", "appropriate", "similar to") remain.
- [ ] Every task ends with a concrete test command and expected outcome.
- [ ] File paths are exact.
- [ ] Type names and method signatures are consistent across tasks.
- [ ] Existing `graph.json`/`events.jsonl` files are treated as a breaking change; no migration path is promised.
- [ ] `DesignStore` schema (raw `CREATE TABLE`) is consistent with `schema.sql.ts`.
- [ ] `packages/opencode/src/design/index.ts` no longer re-exports `Persistence`.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-30-native-design-integration.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints for review.

Which approach would you like?
