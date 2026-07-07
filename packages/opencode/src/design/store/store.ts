import { Context, Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database, type DatabaseShape } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import path from "path"
import { DesignTypes } from "../core/types"

export interface Store {
  readonly ensureSchema: () => Effect.Effect<void>
  readonly loadGraphState: () => Effect.Effect<DesignTypes.GraphState>
  readonly saveGraphState: (state: Omit<DesignTypes.GraphState, "eventLog" | "workingSet">) => Effect.Effect<void>
  readonly loadWorkingSet: () => Effect.Effect<DesignTypes.WorkingSetEntry[]>
  readonly saveWorkingSet: (entries: DesignTypes.WorkingSetEntry[]) => Effect.Effect<void>
  readonly appendEvent: (event: DesignTypes.EventNode) => Effect.Effect<void>
  readonly listEvents: () => Effect.Effect<DesignTypes.EventNode[]>
  readonly transaction: <A, E, R>(f: (store: Store) => Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export interface Interface {
  readonly store: Store
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignStore") {}

export type DbLike = Pick<DatabaseShape, "run" | "all" | "transaction">

const makeStore = (db: DbLike): Store => {
  const run = (query: Parameters<DbLike["run"]>[0]) => db.run(query).pipe(Effect.orDie)
  const all = (query: Parameters<DbLike["all"]>[0]) => db.all(query).pipe(Effect.orDie)

  const ensureSchema = Effect.fn("DesignStore.ensureSchema")(function* () {
    yield* run(`
      CREATE TABLE IF NOT EXISTS design_contexts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        semantics TEXT NOT NULL DEFAULT '',
        node_ids TEXT NOT NULL DEFAULT '[]'
      )
    `)
    yield* run(`
      CREATE TABLE IF NOT EXISTS design_nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        context_id TEXT NOT NULL REFERENCES design_contexts(id),
        kind TEXT NOT NULL DEFAULT 'node',
        default_semantics TEXT NOT NULL DEFAULT '',
        connected_edges TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        retired INTEGER NOT NULL DEFAULT 0
      )
    `)

    const nodeColumns = (yield* all(sql`PRAGMA table_info(design_nodes)`)) as Array<{ name: string }>
    if (!nodeColumns.some((c) => c.name === "kind")) {
      yield* run(sql`ALTER TABLE design_nodes ADD COLUMN kind TEXT NOT NULL DEFAULT 'node'`)
    }
    yield* run(`
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
    yield* run(`
      CREATE TABLE IF NOT EXISTS design_prototypes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        default_semantics TEXT NOT NULL DEFAULT '',
        parameter_schema TEXT NOT NULL DEFAULT '{}'
      )
    `)
    yield* run(`
      CREATE TABLE IF NOT EXISTS design_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        affected_node_ids TEXT NOT NULL DEFAULT '[]',
        affected_edge_keys TEXT NOT NULL DEFAULT '[]',
        rollback_target TEXT,
        reason TEXT,
        source TEXT
      )
    `)

    yield* run(`
      CREATE TABLE IF NOT EXISTS design_working_set (
        entry_id TEXT PRIMARY KEY,
        entry_type TEXT NOT NULL,
        name TEXT NOT NULL,
        brief_semantics TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL
      )
    `)

    const columns = (yield* all(sql`PRAGMA table_info(design_events)`)) as Array<{ name: string }>
    if (!columns.some((c) => c.name === "source")) {
      yield* run(sql`ALTER TABLE design_events ADD COLUMN source TEXT`)
    }
  })

  const loadGraphState = Effect.fn("DesignStore.loadGraphState")(function* () {
    const contexts = (yield* all("SELECT * FROM design_contexts")) as ContextRow[]
    const nodes = (yield* all("SELECT * FROM design_nodes")) as NodeRow[]
    const edges = (yield* all("SELECT * FROM design_edges")) as EdgeRow[]
    const prototypes = (yield* all("SELECT * FROM design_prototypes")) as PrototypeRow[]
    const events = yield* listEvents()

    return {
      contexts: contexts.map(rowFromContext),
      nodes: nodes.map(rowFromNode),
      edges: edges.map(rowFromEdge),
      prototypes: prototypes.map(rowFromPrototype),
      workingSet: { entries: [], capacity: 20 },
      eventLog: { events },
    } as DesignTypes.GraphState
  })

  const saveGraphState = Effect.fn("DesignStore.saveGraphState")(function* (state) {
    yield* run(sql`DELETE FROM design_edges`)
    yield* run(sql`DELETE FROM design_nodes`)
    yield* run(sql`DELETE FROM design_contexts`)
    yield* run(sql`DELETE FROM design_prototypes`)

    for (const ctx of state.contexts) {
      yield* run(sql`
        INSERT INTO design_contexts (id, name, semantics, node_ids)
        VALUES (${ctx.id}, ${ctx.name}, ${ctx.semantics}, ${JSON.stringify(ctx.nodeIds)})
      `)
    }
    for (const node of state.nodes) {
      yield* run(sql`
        INSERT INTO design_nodes (
          id, name, aliases, context_id, kind, default_semantics, connected_edges,
          created_at, updated_at, retired
        )
        VALUES (
          ${node.id}, ${node.name}, ${JSON.stringify(node.aliases)}, ${node.contextId},
          ${node.kind}, ${node.defaultSemantics}, ${JSON.stringify(node.connectedEdges)},
          ${node.createdAt}, ${node.updatedAt}, ${node.retired ? 1 : 0}
        )
      `)
    }
    for (const edge of state.edges) {
      yield* run(sql`
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
      yield* run(sql`
        INSERT INTO design_prototypes (id, name, default_semantics, parameter_schema)
        VALUES (${proto.id}, ${proto.name}, ${proto.defaultSemantics}, ${JSON.stringify(proto.parameterSchema)})
      `)
    }
  })

  const loadWorkingSet = Effect.fn("DesignStore.loadWorkingSet")(function* () {
    const rows = (yield* all("SELECT * FROM design_working_set ORDER BY position ASC")) as WorkingSetRow[]
    return rows.map((row) => ({
      id: row.entry_id,
      name: row.name,
      type: row.entry_type as "context" | "node",
      briefSemantics: row.brief_semantics,
    }))
  })

  const saveWorkingSet = Effect.fn("DesignStore.saveWorkingSet")(function* (entries) {
    yield* run(sql`DELETE FROM design_working_set`)
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      yield* run(sql`
        INSERT INTO design_working_set (entry_id, entry_type, name, brief_semantics, position)
        VALUES (${entry.id}, ${entry.type}, ${entry.name}, ${entry.briefSemantics}, ${i})
      `)
    }
  })

  const appendEvent = Effect.fn("DesignStore.appendEvent")(function* (event) {
    yield* run(sql`
      INSERT INTO design_events (
        id, name, event_type, timestamp, affected_node_ids, affected_edge_keys,
        rollback_target, reason, source
      )
      VALUES (
        ${event.id}, ${event.name}, ${event.eventType}, ${event.timestamp},
        ${JSON.stringify(event.affectedNodeIds)}, ${JSON.stringify(event.affectedEdgeKeys)},
        ${event.rollbackTarget ?? null}, ${event.reason ?? null}, ${event.source ?? null}
      )
    `)
  })

  const listEvents = Effect.fn("DesignStore.listEvents")(function* () {
    const rows = (yield* all("SELECT * FROM design_events ORDER BY timestamp")) as EventRow[]
    return rows.map(rowFromEvent)
  })

  const transaction = <A, E, R>(f: (store: Store) => Effect.Effect<A, E, R>) =>
    db.transaction((tx) => f(makeStore(tx))).pipe(Effect.orDie)

  return {
    ensureSchema,
    loadGraphState,
    saveGraphState,
    loadWorkingSet,
    saveWorkingSet,
    appendEvent,
    listEvents,
    transaction,
  }
}

interface ContextRow {
  readonly id: string
  readonly name: string
  readonly semantics: string
  readonly node_ids: string
}

interface WorkingSetRow {
  readonly entry_id: string
  readonly entry_type: string
  readonly name: string
  readonly brief_semantics: string
  readonly position: number
}

interface NodeRow {
  readonly id: string
  readonly name: string
  readonly aliases: string
  readonly context_id: string
  readonly kind: string
  readonly default_semantics: string
  readonly connected_edges: string
  readonly created_at: number
  readonly updated_at: number
  readonly retired: number
}

interface EdgeRow {
  readonly left_node_id: string
  readonly right_node_id: string
  readonly prototype_id: string
  readonly parameters: string
  readonly created_at: number
  readonly updated_at: number
}

interface PrototypeRow {
  readonly id: string
  readonly name: string
  readonly default_semantics: string
  readonly parameter_schema: string
}

interface EventRow {
  readonly id: string
  readonly name: string
  readonly event_type: string
  readonly timestamp: number
  readonly affected_node_ids: string
  readonly affected_edge_keys: string
  readonly rollback_target: string | null
  readonly reason: string | null
  readonly source: string | null
}

const rowFromContext = (row: ContextRow): DesignTypes.BoundedContext => ({
  id: row.id,
  name: row.name,
  semantics: row.semantics,
  nodeIds: JSON.parse(row.node_ids),
})

const rowFromNode = (row: NodeRow): DesignTypes.Node => ({
  id: row.id,
  name: row.name,
  aliases: JSON.parse(row.aliases),
  contextId: row.context_id,
  kind: row.kind,
  defaultSemantics: row.default_semantics,
  connectedEdges: JSON.parse(row.connected_edges),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  retired: Boolean(row.retired),
})

const rowFromEdge = (row: EdgeRow): DesignTypes.Edge => ({
  leftNodeId: row.left_node_id,
  rightNodeId: row.right_node_id,
  prototypeId: row.prototype_id,
  parameters: JSON.parse(row.parameters),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const rowFromPrototype = (row: PrototypeRow): DesignTypes.RelationPrototype => ({
  id: row.id,
  name: row.name,
  defaultSemantics: row.default_semantics,
  parameterSchema: JSON.parse(row.parameter_schema),
})

const rowFromEvent = (row: EventRow): DesignTypes.EventNode => ({
  id: row.id,
  name: row.name,
  contextId: "event-log",
  aliases: [],
  defaultSemantics: "",
  connectedEdges: [],
  createdAt: row.timestamp,
  updatedAt: row.timestamp,
  retired: false,
  eventType: row.event_type as DesignTypes.EventType,
  timestamp: row.timestamp,
  affectedNodeIds: JSON.parse(row.affected_node_ids),
  affectedEdgeKeys: JSON.parse(row.affected_edge_keys),
  rollbackTarget: row.rollback_target ?? undefined,
  reason: row.reason ?? undefined,
  source: row.source as DesignTypes.VersionBumpSource | null ?? undefined,
})

const DESIGN_DIR = ".opencode/design"
const DESIGN_DB = "design.sqlite"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const state = yield* InstanceState.make<Store>(
      Effect.fn("DesignStore.state")(function* (ctx) {
        const designDir = path.join(ctx.directory, DESIGN_DIR)
        yield* fs.makeDirectory(designDir, { recursive: true }).pipe(Effect.orDie)
        const dbContext = yield* Layer.build(Layer.fresh(Database.layerFromPath(path.join(designDir, DESIGN_DB))))
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
        loadWorkingSet: () => Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return yield* s.loadWorkingSet()
        }),
        saveWorkingSet: (entries) => Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return yield* s.saveWorkingSet(entries)
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

export const defaultLayer = layer.pipe(Layer.provide(LayerNode.compile(FSUtil.node)))

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [Database.node, FSUtil.node],
})

export * as DesignStore from "./store"
