import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { GraphEngine } from "../core/graph"
import { WorkingSet } from "../core/working-set"
import { DesignTypes } from "../core/types"

export interface TemporaryWorkingSet {
  entries: DesignTypes.WorkingSetEntry[]
}

export interface Interface {
  readonly get: (sessionID: string) => Effect.Effect<TemporaryWorkingSet>
  readonly reset: (sessionID: string) => Effect.Effect<TemporaryWorkingSet>
  readonly addEntry: (sessionID: string, entry: DesignTypes.WorkingSetEntry) => Effect.Effect<TemporaryWorkingSet>
  readonly addEntries: (sessionID: string, entries: DesignTypes.WorkingSetEntry[]) => Effect.Effect<TemporaryWorkingSet>
  readonly expandNode: (sessionID: string, nodeId: string) => Effect.Effect<DesignTypes.WorkingSetEntry[]>
  readonly destroy: (sessionID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignTemporaryWorkingSet") {}

export const make = (graph: GraphEngine.Interface, activeWorkingSet: WorkingSet.Interface) => {
  const store = new Map<string, TemporaryWorkingSet>()

  const get = Effect.fn("DesignTemporaryWorkingSet.get")(function* (sessionID: string) {
    const existing = store.get(sessionID)
    if (existing) return existing
    return yield* reset(sessionID)
  })

  const reset = Effect.fn("DesignTemporaryWorkingSet.reset")(function* (sessionID: string) {
    const active = yield* activeWorkingSet.list()
    const ws: TemporaryWorkingSet = { entries: [...active] }
    store.set(sessionID, ws)
    return ws
  })

  const addEntry = Effect.fn("DesignTemporaryWorkingSet.addEntry")(function* (
    sessionID: string,
    entry: DesignTypes.WorkingSetEntry,
  ) {
    const ws = yield* get(sessionID)
    const next = ws.entries.filter((e) => e.id !== entry.id)
    next.unshift(entry)
    const updated = { entries: next }
    store.set(sessionID, updated)
    return updated
  })

  const addEntries = Effect.fn("DesignTemporaryWorkingSet.addEntries")(function* (
    sessionID: string,
    entries: DesignTypes.WorkingSetEntry[],
  ) {
    const ws = yield* get(sessionID)
    const existingIds = new Set(ws.entries.map((e) => e.id))
    const newEntries = entries.filter((e) => !existingIds.has(e.id))
    const updated = { entries: [...newEntries, ...ws.entries] }
    store.set(sessionID, updated)
    if (updated.entries.length > 100) {
      yield* Effect.logWarning("DesignTemporaryWorkingSet exceeded 100 entries", {
        sessionID,
        entryCount: updated.entries.length,
      })
    }
    return updated
  })

  const expandNode = Effect.fn("DesignTemporaryWorkingSet.expandNode")(function* (sessionID: string, nodeId: string) {
    const edges = yield* graph.listEdgesForNode(nodeId)
    const neighborIds = edges.flatMap((e) => [e.leftNodeId, e.rightNodeId]).filter((id) => id !== nodeId)
    const uniqueNeighborIds = [...new Set(neighborIds)]

    const entries: DesignTypes.WorkingSetEntry[] = []
    for (const id of uniqueNeighborIds) {
      const node = yield* graph.getNode(id)
      if (!node) continue
      entries.push({
        id: node.id,
        name: node.name,
        type: "node",
        briefSemantics: node.defaultSemantics || "",
      })
    }

    if (entries.length > 0) {
      yield* addEntries(sessionID, entries)
    }

    return entries
  })

  const destroy = Effect.fn("DesignTemporaryWorkingSet.destroy")(function* (sessionID: string) {
    store.delete(sessionID)
  })

  return {
    get,
    reset,
    addEntry,
    addEntries,
    expandNode,
    destroy,
  } satisfies Interface
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const graph = yield* GraphEngine.Service
    const activeWorkingSet = yield* WorkingSet.Service
    return Service.of(make(graph, activeWorkingSet))
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(GraphEngine.defaultLayer),
  Layer.provide(WorkingSet.defaultLayer),
)

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [GraphEngine.node, WorkingSet.node],
})

export * as TemporaryWorkingSet from "./temporary-working-set"
