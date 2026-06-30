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
