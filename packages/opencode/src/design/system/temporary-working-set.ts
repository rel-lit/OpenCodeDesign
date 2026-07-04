import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { GraphEngine } from "../core/graph"
import { WorkingSet } from "../core/working-set"

export interface TemporaryWorkingSet {
  contextIds: string[]
  nodeIds: string[]
  capacity: number
}

export interface Update {
  readonly addNodeIds?: readonly string[]
  readonly removeNodeIds?: readonly string[]
  readonly addContextIds?: readonly string[]
  readonly removeContextIds?: readonly string[]
}

export interface Interface {
  readonly get: (sessionID: string) => Effect.Effect<TemporaryWorkingSet>
  readonly reset: (sessionID: string) => Effect.Effect<TemporaryWorkingSet>
  readonly update: (sessionID: string, input: Update) => Effect.Effect<TemporaryWorkingSet>
  readonly expand: (sessionID: string, nodeId: string) => Effect.Effect<TemporaryWorkingSet>
  readonly destroy: (sessionID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignTemporaryWorkingSet") {}

export const make = (graph: GraphEngine.Interface, activeWorkingSet: WorkingSet.Interface) => {
  const store = new Map<string, TemporaryWorkingSet>()
  const capacity = 20

  const get = Effect.fn("DesignTemporaryWorkingSet.get")(function* (sessionID: string) {
    const existing = store.get(sessionID)
    if (existing) return existing
    return yield* reset(sessionID)
  })

  const reset = Effect.fn("DesignTemporaryWorkingSet.reset")(function* (sessionID: string) {
    const active = yield* activeWorkingSet.list()
    const ws: TemporaryWorkingSet = {
      contextIds: [...active.contextIds],
      nodeIds: [...active.nodeIds],
      capacity,
    }
    store.set(sessionID, ws)
    return ws
  })

  const update = Effect.fn("DesignTemporaryWorkingSet.update")(function* (sessionID: string, input: Update) {
    const ws = yield* get(sessionID)
    const next: TemporaryWorkingSet = {
      ...ws,
      contextIds: [
        ...ws.contextIds.filter((id) => !(input.removeContextIds ?? []).includes(id)),
        ...(input.addContextIds ?? []).filter((id) => !ws.contextIds.includes(id)),
      ],
      nodeIds: [
        ...ws.nodeIds.filter((id) => !(input.removeNodeIds ?? []).includes(id)),
        ...(input.addNodeIds ?? []).filter((id) => !ws.nodeIds.includes(id)),
      ],
    }
    if (next.nodeIds.length > capacity) {
      next.nodeIds = next.nodeIds.slice(0, capacity)
    }
    store.set(sessionID, next)
    return next
  })

  const expand = Effect.fn("DesignTemporaryWorkingSet.expand")(function* (sessionID: string, nodeId: string) {
    const ws = yield* get(sessionID)
    const edges = yield* graph.listEdgesForNode(nodeId)
    const neighborIds = edges.flatMap((e) => [e.leftNodeId, e.rightNodeId]).filter((id) => id !== nodeId)
    const addNodeIds = neighborIds.filter((id) => !ws.nodeIds.includes(id))
    return yield* update(sessionID, { addNodeIds })
  })

  const destroy = Effect.fn("DesignTemporaryWorkingSet.destroy")(function* (sessionID: string) {
    store.delete(sessionID)
  })

  return {
    get,
    reset,
    update,
    expand,
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
