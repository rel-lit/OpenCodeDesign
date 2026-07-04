# Review Package: Task 4 (including fixes)

## Commits

`
fabb35c44 fix(design-store): address Task 4 review issues
7394ef5f5 feat(design): add SQLite-backed DesignStore
`

## Stat

`
 .superpowers/sdd/task-4-report.md                 |  85 ++++++
 packages/core/src/database/database.ts            |   2 +-
 packages/opencode/src/design/store/store.ts       | 336 ++++++++++++++++++++++
 packages/opencode/test/design/store/store.test.ts |  75 +++++
 4 files changed, 497 insertions(+), 1 deletion(-)
`

## Diff

`diff
diff --git a/.superpowers/sdd/task-4-report.md b/.superpowers/sdd/task-4-report.md
new file mode 100644
index 000000000..9b7d87fbd
--- /dev/null
+++ b/.superpowers/sdd/task-4-report.md
@@ -0,0 +1,85 @@
+# Task 4 Report: Create DesignStore SQLite schema and service
+
+## What I Implemented
+
+1. **Exported `DatabaseShape` from `@opencode-ai/core/database`**
+   - Modified `packages/core/src/database/database.ts` to export the existing `DatabaseShape` type so consumers can structurally depend on it.
+
+2. **Created `DesignStore` service (`packages/opencode/src/design/store/store.ts`)**
+   - Defined a `Store` interface with `ensureSchema`, `loadGraphState`, `saveGraphState`, `appendEvent`, `listEvents`, and `transaction`.
+   - Implemented `makeStore(db: DbLike)` using raw `CREATE TABLE IF NOT EXISTS` statements and `sql`-tagged parameterized queries via `drizzle-orm`.
+   - Used `InstanceState.make` so each project directory gets its own `.opencode/design/design.sqlite` database, creating the directory before opening the db.
+   - Wired up the public service layer and `LayerNode` node with `Database.node` as a dependency.
+
+3. **Created tests (`packages/opencode/test/design/store/store.test.ts`)**
+   - Added missing `DesignTypes` import and wrote two instance-scoped tests verifying schema creation / graph persistence and event append/list behavior.
+
+## Deviations from the Task Brief
+
+The brief's `Store` interface omitted the database error types that `EffectDrizzleSqlite` returns. To make the code typecheck while keeping the public surface as simple as possible:
+
+- Individual store operations (`run`/`all`) are wrapped with `.pipe(Effect.orDie)`, so their signatures remain `Effect.Effect<void>` / `Effect.Effect<...>` as shown in the brief.
+- The `transaction` signature was updated to `Effect.Effect<A, E | SqlError, R>` to accurately reflect the transaction primitive's actual error and requirement types.
+
+These are the minimal type-correctness adjustments required; runtime behavior matches the spec.
+
+## What I Tested
+
+- Focused test: `bun test test/design/store/store.test.ts` — 2 pass
+- Full design suite: `bun test test/design` — 23 pass, 0 fail
+- Typecheck:
+  - `cd packages/opencode && bun typecheck` — clean
+  - `cd packages/core && bun typecheck` — clean
+
+## Files Changed
+
+- `packages/core/src/database/database.ts`
+- `packages/opencode/src/design/store/store.ts` (new)
+- `packages/opencode/test/design/store/store.test.ts` (new)
+- `.superpowers/sdd/task-4-report.md` (this report)
+
+## Self-Review Findings
+
+- All spec-mandated operations are implemented.
+- Tests verify persistence and event ordering, not just mocked behavior.
+- Typecheck and full design test suite are pristine.
+- The only concerns are the intentional interface adjustments for database error types, noted above.
+
+---
+
+# Task 4 Fix Report
+
+## What I Fixed
+
+1. **Public `transaction` signature no longer leaks `SqlError`**
+   - Removed the `SqlError` import from `effect/unstable/sql/SqlError`.
+   - Changed the `Store.transaction` signature from `Effect.Effect<A, E | SqlError, R>` to `Effect.Effect<A, E, R>`.
+   - Wrapped `db.transaction(...)` with `.pipe(Effect.orDie)` so SQL-level errors become defects, matching the other store operations.
+
+2. **Row mappers are now typed instead of using `any`**
+   - Added narrow TypeScript interfaces for each raw SQLite row shape: `ContextRow`, `NodeRow`, `EdgeRow`, `PrototypeRow`, and `EventRow`.
+   - Updated `rowFromContext`, `rowFromNode`, `rowFromEdge`, `rowFromPrototype`, and `rowFromEvent` to accept these typed rows.
+   - Cast the `unknown[]` results from `db.all` once at each call site (`loadGraphState` and `listEvents`) to the appropriate row type.
+
+3. **Directory creation uses an Effect file-system service instead of raw `fs/promises`**
+   - Replaced the `fs/promises` import and `Effect.promise(() => fs.mkdir(...))` call with `FSUtil.Service` from `@opencode-ai/core/fs-util`.
+   - Used `fs.makeDirectory(designDir, { recursive: true }).pipe(Effect.orDie)`.
+   - Updated `defaultLayer` to provide `FSUtil.defaultLayer` and added `FSUtil.node` to the `LayerNode` dependencies.
+
+## Test Results
+
+- `bun test test/design/store/store.test.ts` — 2 pass, 0 fail
+
+## Typecheck Results
+
+- `cd packages/opencode && bun typecheck` — clean
+- `cd packages/core && bun typecheck` — clean
+
+## Files Changed
+
+- `packages/opencode/src/design/store/store.ts`
+- `.superpowers/sdd/task-4-report.md` (this report)
+
+## Issues or Concerns
+
+- The fix brief suggested using `FileSystem.FileSystem` from `@opencode-ai/core/filesystem`, but that project's `FileSystem.Service` interface does not expose `makeDirectory`. I used `FSUtil.Service` instead, which wraps Effect's `FileSystem.FileSystem` and is the established pattern elsewhere in `packages/opencode` (e.g., `src/worktree/index.ts`). This satisfies the intent of replacing raw `fs/promises` with an Effect-aware file-system service and keeps the call signature (`makeDirectory(path, { recursive: true })`) identical to the brief's example.
diff --git a/packages/core/src/database/database.ts b/packages/core/src/database/database.ts
index 2946450e2..4a5df8e6e 100644
--- a/packages/core/src/database/database.ts
+++ b/packages/core/src/database/database.ts
@@ -4,21 +4,21 @@ import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
 import { layer as sqliteLayer } from "#sqlite"
 import { Context, Effect, Layer } from "effect"
 import { Global } from "../global"
 import { Flag } from "../flag/flag"
 import { isAbsolute, join } from "path"
 import { DatabaseMigration } from "./migration"
 import { InstallationChannel } from "../installation/version"
 import { makeGlobalNode } from "../effect/app-node"
 
 const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
-type DatabaseShape = Effect.Success<typeof makeDatabase>
+export type DatabaseShape = Effect.Success<typeof makeDatabase>
 
 export interface Interface {
   db: DatabaseShape
 }
 
 export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}
 
 export const layer = Layer.effect(
   Service,
   Effect.gen(function* () {
diff --git a/packages/opencode/src/design/store/store.ts b/packages/opencode/src/design/store/store.ts
new file mode 100644
index 000000000..011f24706
--- /dev/null
+++ b/packages/opencode/src/design/store/store.ts
@@ -0,0 +1,336 @@
+import { Context, Effect, Layer } from "effect"
+import { sql } from "drizzle-orm"
+import { LayerNode } from "@opencode-ai/core/effect/layer-node"
+import { Database, type DatabaseShape } from "@opencode-ai/core/database/database"
+import { FSUtil } from "@opencode-ai/core/fs-util"
+import { InstanceState } from "@/effect/instance-state"
+import path from "path"
+import { DesignTypes } from "../core/types"
+
+export interface Store {
+  readonly ensureSchema: () => Effect.Effect<void>
+  readonly loadGraphState: () => Effect.Effect<DesignTypes.GraphState>
+  readonly saveGraphState: (state: Omit<DesignTypes.GraphState, "eventLog" | "workingSet">) => Effect.Effect<void>
+  readonly appendEvent: (event: DesignTypes.EventNode) => Effect.Effect<void>
+  readonly listEvents: () => Effect.Effect<DesignTypes.EventNode[]>
+  readonly transaction: <A, E, R>(f: (store: Store) => Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
+}
+
+export interface Interface {
+  readonly store: Store
+}
+
+export class Service extends Context.Service<Service, Interface>()("@opencode/DesignStore") {}
+
+export type DbLike = Pick<DatabaseShape, "run" | "all" | "transaction">
+
+const makeStore = (db: DbLike): Store => {
+  const run = (query: Parameters<DbLike["run"]>[0]) => db.run(query).pipe(Effect.orDie)
+  const all = (query: Parameters<DbLike["all"]>[0]) => db.all(query).pipe(Effect.orDie)
+
+  const ensureSchema = Effect.fn("DesignStore.ensureSchema")(function* () {
+    yield* run(`
+      CREATE TABLE IF NOT EXISTS design_contexts (
+        id TEXT PRIMARY KEY,
+        name TEXT NOT NULL,
+        semantics TEXT NOT NULL DEFAULT '',
+        node_ids TEXT NOT NULL DEFAULT '[]'
+      )
+    `)
+    yield* run(`
+      CREATE TABLE IF NOT EXISTS design_nodes (
+        id TEXT PRIMARY KEY,
+        name TEXT NOT NULL,
+        aliases TEXT NOT NULL DEFAULT '[]',
+        context_id TEXT NOT NULL REFERENCES design_contexts(id),
+        default_semantics TEXT NOT NULL DEFAULT '',
+        connected_edges TEXT NOT NULL DEFAULT '[]',
+        created_at INTEGER NOT NULL,
+        updated_at INTEGER NOT NULL,
+        retired INTEGER NOT NULL DEFAULT 0
+      )
+    `)
+    yield* run(`
+      CREATE TABLE IF NOT EXISTS design_edges (
+        left_node_id TEXT NOT NULL,
+        right_node_id TEXT NOT NULL,
+        prototype_id TEXT NOT NULL,
+        parameters TEXT NOT NULL DEFAULT '{}',
+        created_at INTEGER NOT NULL,
+        updated_at INTEGER NOT NULL,
+        PRIMARY KEY (left_node_id, right_node_id)
+      )
+    `)
+    yield* run(`
+      CREATE TABLE IF NOT EXISTS design_prototypes (
+        id TEXT PRIMARY KEY,
+        name TEXT NOT NULL,
+        default_semantics TEXT NOT NULL DEFAULT '',
+        parameter_schema TEXT NOT NULL DEFAULT '{}'
+      )
+    `)
+    yield* run(`
+      CREATE TABLE IF NOT EXISTS design_events (
+        id TEXT PRIMARY KEY,
+        name TEXT NOT NULL,
+        event_type TEXT NOT NULL,
+        timestamp INTEGER NOT NULL,
+        affected_node_ids TEXT NOT NULL DEFAULT '[]',
+        affected_edge_keys TEXT NOT NULL DEFAULT '[]',
+        rollback_target TEXT,
+        reason TEXT
+      )
+    `)
+  })
+
+  const loadGraphState = Effect.fn("DesignStore.loadGraphState")(function* () {
+    const contexts = (yield* all("SELECT * FROM design_contexts")) as ContextRow[]
+    const nodes = (yield* all("SELECT * FROM design_nodes")) as NodeRow[]
+    const edges = (yield* all("SELECT * FROM design_edges")) as EdgeRow[]
+    const prototypes = (yield* all("SELECT * FROM design_prototypes")) as PrototypeRow[]
+    const events = yield* listEvents()
+
+    return {
+      contexts: contexts.map(rowFromContext),
+      nodes: nodes.map(rowFromNode),
+      edges: edges.map(rowFromEdge),
+      prototypes: prototypes.map(rowFromPrototype),
+      workingSet: { activeContextIds: [], activeNodeIds: [], capacity: 20 },
+      eventLog: { events },
+    } as DesignTypes.GraphState
+  })
+
+  const saveGraphState = Effect.fn("DesignStore.saveGraphState")(function* (state) {
+    yield* run(sql`DELETE FROM design_edges`)
+    yield* run(sql`DELETE FROM design_nodes`)
+    yield* run(sql`DELETE FROM design_contexts`)
+    yield* run(sql`DELETE FROM design_prototypes`)
+
+    for (const ctx of state.contexts) {
+      yield* run(sql`
+        INSERT INTO design_contexts (id, name, semantics, node_ids)
+        VALUES (${ctx.id}, ${ctx.name}, ${ctx.semantics}, ${JSON.stringify(ctx.nodeIds)})
+      `)
+    }
+    for (const node of state.nodes) {
+      yield* run(sql`
+        INSERT INTO design_nodes (
+          id, name, aliases, context_id, default_semantics, connected_edges,
+          created_at, updated_at, retired
+        )
+        VALUES (
+          ${node.id}, ${node.name}, ${JSON.stringify(node.aliases)}, ${node.contextId},
+          ${node.defaultSemantics}, ${JSON.stringify(node.connectedEdges)},
+          ${node.createdAt}, ${node.updatedAt}, ${node.retired ? 1 : 0}
+        )
+      `)
+    }
+    for (const edge of state.edges) {
+      yield* run(sql`
+        INSERT INTO design_edges (
+          left_node_id, right_node_id, prototype_id, parameters, created_at, updated_at
+        )
+        VALUES (
+          ${edge.leftNodeId}, ${edge.rightNodeId}, ${edge.prototypeId},
+          ${JSON.stringify(edge.parameters)}, ${edge.createdAt}, ${edge.updatedAt}
+        )
+      `)
+    }
+    for (const proto of state.prototypes) {
+      yield* run(sql`
+        INSERT INTO design_prototypes (id, name, default_semantics, parameter_schema)
+        VALUES (${proto.id}, ${proto.name}, ${proto.defaultSemantics}, ${JSON.stringify(proto.parameterSchema)})
+      `)
+    }
+  })
+
+  const appendEvent = Effect.fn("DesignStore.appendEvent")(function* (event) {
+    yield* run(sql`
+      INSERT INTO design_events (
+        id, name, event_type, timestamp, affected_node_ids, affected_edge_keys,
+        rollback_target, reason
+      )
+      VALUES (
+        ${event.id}, ${event.name}, ${event.eventType}, ${event.timestamp},
+        ${JSON.stringify(event.affectedNodeIds)}, ${JSON.stringify(event.affectedEdgeKeys)},
+        ${event.rollbackTarget ?? null}, ${event.reason ?? null}
+      )
+    `)
+  })
+
+  const listEvents = Effect.fn("DesignStore.listEvents")(function* () {
+    const rows = (yield* all("SELECT * FROM design_events ORDER BY timestamp")) as EventRow[]
+    return rows.map(rowFromEvent)
+  })
+
+  const transaction = <A, E, R>(f: (store: Store) => Effect.Effect<A, E, R>) =>
+    db.transaction((tx) => f(makeStore(tx))).pipe(Effect.orDie)
+
+  return {
+    ensureSchema,
+    loadGraphState,
+    saveGraphState,
+    appendEvent,
+    listEvents,
+    transaction,
+  }
+}
+
+interface ContextRow {
+  readonly id: string
+  readonly name: string
+  readonly semantics: string
+  readonly node_ids: string
+}
+
+interface NodeRow {
+  readonly id: string
+  readonly name: string
+  readonly aliases: string
+  readonly context_id: string
+  readonly default_semantics: string
+  readonly connected_edges: string
+  readonly created_at: number
+  readonly updated_at: number
+  readonly retired: number
+}
+
+interface EdgeRow {
+  readonly left_node_id: string
+  readonly right_node_id: string
+  readonly prototype_id: string
+  readonly parameters: string
+  readonly created_at: number
+  readonly updated_at: number
+}
+
+interface PrototypeRow {
+  readonly id: string
+  readonly name: string
+  readonly default_semantics: string
+  readonly parameter_schema: string
+}
+
+interface EventRow {
+  readonly id: string
+  readonly name: string
+  readonly event_type: string
+  readonly timestamp: number
+  readonly affected_node_ids: string
+  readonly affected_edge_keys: string
+  readonly rollback_target: string | null
+  readonly reason: string | null
+}
+
+const rowFromContext = (row: ContextRow): DesignTypes.BoundedContext => ({
+  id: row.id,
+  name: row.name,
+  semantics: row.semantics,
+  nodeIds: JSON.parse(row.node_ids),
+})
+
+const rowFromNode = (row: NodeRow): DesignTypes.Node => ({
+  id: row.id,
+  name: row.name,
+  aliases: JSON.parse(row.aliases),
+  contextId: row.context_id,
+  defaultSemantics: row.default_semantics,
+  connectedEdges: JSON.parse(row.connected_edges),
+  createdAt: row.created_at,
+  updatedAt: row.updated_at,
+  retired: Boolean(row.retired),
+})
+
+const rowFromEdge = (row: EdgeRow): DesignTypes.Edge => ({
+  leftNodeId: row.left_node_id,
+  rightNodeId: row.right_node_id,
+  prototypeId: row.prototype_id,
+  parameters: JSON.parse(row.parameters),
+  createdAt: row.created_at,
+  updatedAt: row.updated_at,
+})
+
+const rowFromPrototype = (row: PrototypeRow): DesignTypes.RelationPrototype => ({
+  id: row.id,
+  name: row.name,
+  defaultSemantics: row.default_semantics,
+  parameterSchema: JSON.parse(row.parameter_schema),
+})
+
+const rowFromEvent = (row: EventRow): DesignTypes.EventNode => ({
+  id: row.id,
+  name: row.name,
+  contextId: "event-log",
+  aliases: [],
+  defaultSemantics: "",
+  connectedEdges: [],
+  createdAt: row.timestamp,
+  updatedAt: row.timestamp,
+  retired: false,
+  eventType: row.event_type as DesignTypes.EventType,
+  timestamp: row.timestamp,
+  affectedNodeIds: JSON.parse(row.affected_node_ids),
+  affectedEdgeKeys: JSON.parse(row.affected_edge_keys),
+  rollbackTarget: row.rollback_target ?? undefined,
+  reason: row.reason ?? undefined,
+})
+
+const DESIGN_DIR = ".opencode/design"
+const DESIGN_DB = "design.sqlite"
+
+export const layer = Layer.effect(
+  Service,
+  Effect.gen(function* () {
+    const fs = yield* FSUtil.Service
+    const state = yield* InstanceState.make<Store>(
+      Effect.fn("DesignStore.state")(function* (ctx) {
+        const designDir = path.join(ctx.directory, DESIGN_DIR)
+        yield* fs.makeDirectory(designDir, { recursive: true }).pipe(Effect.orDie)
+        const dbContext = yield* Layer.build(Database.layerFromPath(path.join(designDir, DESIGN_DB)))
+        const database = Context.get(dbContext, Database.Service)
+        const store = makeStore(database.db)
+        yield* store.ensureSchema()
+        return store
+      }),
+    )
+
+    return Service.of({
+      store: {
+        ensureSchema: () => Effect.gen(function* () {
+          const s = yield* InstanceState.get(state)
+          return yield* s.ensureSchema()
+        }),
+        loadGraphState: () => Effect.gen(function* () {
+          const s = yield* InstanceState.get(state)
+          return yield* s.loadGraphState()
+        }),
+        saveGraphState: (stateArg) => Effect.gen(function* () {
+          const s = yield* InstanceState.get(state)
+          return yield* s.saveGraphState(stateArg)
+        }),
+        appendEvent: (event) => Effect.gen(function* () {
+          const s = yield* InstanceState.get(state)
+          return yield* s.appendEvent(event)
+        }),
+        listEvents: () => Effect.gen(function* () {
+          const s = yield* InstanceState.get(state)
+          return yield* s.listEvents()
+        }),
+        transaction: (f) => Effect.gen(function* () {
+          const s = yield* InstanceState.get(state)
+          return yield* s.transaction(f)
+        }),
+      },
+    })
+  }),
+)
+
+export const defaultLayer = layer.pipe(Layer.provide(FSUtil.defaultLayer))
+
+export const node = LayerNode.make({
+  service: Service,
+  layer: defaultLayer,
+  deps: [Database.node, FSUtil.node],
+})
+
+export * as DesignStore from "./store"
diff --git a/packages/opencode/test/design/store/store.test.ts b/packages/opencode/test/design/store/store.test.ts
new file mode 100644
index 000000000..1eaca5ba3
--- /dev/null
+++ b/packages/opencode/test/design/store/store.test.ts
@@ -0,0 +1,75 @@
+import { describe, expect } from "bun:test"
+import { Effect } from "effect"
+import { testEffect } from "../../lib/effect"
+import { DesignTypes } from "../../../src/design/core/types"
+import { DesignStore } from "../../../src/design/store/store"
+
+const it = testEffect(DesignStore.defaultLayer)
+
+describe("DesignStore", () => {
+  it.instance("creates schema and persists graph state", () =>
+    Effect.gen(function* () {
+      const designStore = yield* DesignStore.Service
+      const store = designStore.store
+
+      const state = {
+        contexts: [{ id: "ctx-1", name: "战斗系统", semantics: "", nodeIds: [] }],
+        nodes: [
+          {
+            id: "node-1",
+            name: "船",
+            aliases: ["战船"],
+            contextId: "ctx-1",
+            defaultSemantics: "水上交通工具",
+            connectedEdges: [],
+            createdAt: 1,
+            updatedAt: 1,
+            retired: false,
+          },
+        ],
+        edges: [],
+        prototypes: [{ id: "aggregate", name: "聚合", defaultSemantics: "", parameterSchema: {} }],
+      }
+
+      yield* store.saveGraphState(state)
+      const loaded = yield* store.loadGraphState()
+
+      expect(loaded.contexts).toHaveLength(1)
+      expect(loaded.nodes).toHaveLength(1)
+      expect(loaded.nodes[0].name).toBe("船")
+      expect(loaded.nodes[0].aliases).toEqual(["战船"])
+      expect(loaded.prototypes).toHaveLength(1)
+    }),
+  )
+
+  it.instance("appends and lists events", () =>
+    Effect.gen(function* () {
+      const designStore = yield* DesignStore.Service
+      const store = designStore.store
+
+      const event: DesignTypes.EventNode = {
+        id: "evt-1",
+        name: "node_created",
+        contextId: "event-log",
+        aliases: [],
+        defaultSemantics: "",
+        connectedEdges: [],
+        createdAt: 1,
+        updatedAt: 1,
+        retired: false,
+        eventType: "node_created",
+        timestamp: 1,
+        affectedNodeIds: ["node-1"],
+        affectedEdgeKeys: [],
+      }
+
+      yield* store.appendEvent(event)
+      yield* store.appendEvent({ ...event, id: "evt-2" })
+      const events = yield* store.listEvents()
+
+      expect(events).toHaveLength(2)
+      expect(events[0].id).toBe("evt-1")
+      expect(events[1].id).toBe("evt-2")
+    }),
+  )
+})
`
