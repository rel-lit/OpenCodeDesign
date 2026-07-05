import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { type DeepMutable } from "@opencode-ai/core/schema"
import { DesignTypes } from "./types"
import { GraphEngine } from "./graph"

export interface Interface {
  readonly touchContext: (contextId: string) => Effect.Effect<void>
  readonly touchNode: (nodeId: string) => Effect.Effect<void>
  readonly forgetNode: (nodeId: string) => Effect.Effect<void>
  readonly forgetContext: (contextId: string) => Effect.Effect<void>
  readonly list: () => Effect.Effect<DesignTypes.WorkingSetEntry[]>
  readonly state: () => Effect.Effect<DesignTypes.WorkingSet>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignWorkingSet") {}

export const makeWorkingSet = (capacity = 20) =>
  Effect.fn("WorkingSet.make")(function* (graph: GraphEngine.Interface) {
    let workingSet: DeepMutable<DesignTypes.WorkingSet> = {
      entries: [],
      capacity,
    }

    const contexts = yield* Effect.sync(() => new Map<string, DesignTypes.BoundedContext>())
    const nodes = yield* Effect.sync(() => new Map<string, DesignTypes.Node>())

    const loadContext = (id: string) =>
      Effect.gen(function* () {
        if (!contexts.has(id)) {
          const ctx = yield* graph.getContext(id)
          if (ctx) contexts.set(id, ctx)
        }
        return contexts.get(id)
      })

    const loadNode = (id: string) =>
      Effect.gen(function* () {
        if (!nodes.has(id)) {
          const node = yield* graph.getNode(id)
          if (node) nodes.set(id, node)
        }
        return nodes.get(id)
      })

    const state = Effect.fnUntraced(function* () {
      return workingSet
    })

    const list = Effect.fnUntraced(function* () {
      return [...workingSet.entries]
    })

    const touchEntry = (entry: DesignTypes.WorkingSetEntry) => {
      workingSet.entries = workingSet.entries.filter((e) => e.id !== entry.id)
      workingSet.entries.unshift(entry)
    }

    const evictNodes = () => {
      const nodeEntries = workingSet.entries.filter((e) => e.type === "node")
      const overflow = nodeEntries.length - workingSet.capacity
      if (overflow <= 0) return
      const evicting = nodeEntries.slice(-overflow)
      for (const entry of evicting) {
        workingSet.entries = workingSet.entries.filter((e) => e.id !== entry.id)
      }
    }

    const evictContexts = Effect.fn("WorkingSet.evictContexts")(function* () {
      const contextEntries = workingSet.entries.filter((e) => e.type === "context")
      const allNodes = yield* graph.listNodes()
      for (const ctxEntry of contextEntries) {
        const hasActiveNode = workingSet.entries.some(
          (e) => e.type === "node" && allNodes.some((n) => n.id === e.id && n.contextId === ctxEntry.id),
        )
        if (!hasActiveNode) {
          workingSet.entries = workingSet.entries.filter((e) => e.id !== ctxEntry.id)
        }
      }
    })

    const touchContext = Effect.fn("WorkingSet.touchContext")(function* (contextId: string) {
      const ctx = yield* loadContext(contextId)
      if (!ctx) return
      const entry: DesignTypes.WorkingSetEntry = {
        id: ctx.id,
        name: ctx.name,
        type: "context",
        briefSemantics: ctx.semantics || "",
      }
      touchEntry(entry)
    })

    const touchNode = Effect.fn("WorkingSet.touchNode")(function* (nodeId: string) {
      const node = yield* loadNode(nodeId)
      if (!node) return
      const ctx = yield* loadContext(node.contextId)
      const entry: DesignTypes.WorkingSetEntry = {
        id: node.id,
        name: node.name,
        type: "node",
        briefSemantics: node.defaultSemantics || "",
      }
      touchEntry(entry)
      evictNodes()
      yield* touchContext(node.contextId)
      yield* evictContexts()
    })

    const forgetNode = Effect.fn("WorkingSet.forgetNode")(function* (nodeId: string) {
      workingSet.entries = workingSet.entries.filter((e) => e.id !== nodeId)
      yield* evictContexts()
    })

    const forgetContext = Effect.fn("WorkingSet.forgetContext")(function* (contextId: string) {
      workingSet.entries = workingSet.entries.filter((e) => e.id !== contextId)
    })

    return {
      touchContext,
      touchNode,
      forgetNode,
      forgetContext,
      list,
      state,
    } satisfies Interface
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const graph = yield* GraphEngine.Service
    const ws = yield* makeWorkingSet(20)(graph)
    return Service.of(ws)
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(GraphEngine.defaultLayer))

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [GraphEngine.node],
})

export * as WorkingSet from "./working-set"
