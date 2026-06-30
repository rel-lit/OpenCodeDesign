import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { type DeepMutable } from "@opencode-ai/core/schema"
import { DesignTypes } from "./types"
import { GraphEngine } from "./graph"

export interface Interface {
  readonly activateNode: (nodeId: string) => Effect.Effect<void>
  readonly forgetNode: (nodeId: string) => Effect.Effect<void>
  readonly activateContext: (contextId: string) => Effect.Effect<void>
  readonly forgetContext: (contextId: string) => Effect.Effect<void>
  readonly resolveReference: (input: {
    reference: string
    contextId?: string
  }) => Effect.Effect<{ nodeId: string; action: "matched" | "created"; fullName: string }, Error>
  readonly list: () => Effect.Effect<{ nodeIds: string[]; contextIds: string[] }>
  readonly state: () => Effect.Effect<DesignTypes.WorkingSet>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignWorkingSet") {}

export const makeWorkingSet = (capacity = 20) =>
  Effect.fn("WorkingSet.make")(function* (graph: GraphEngine.Interface) {
    let workingSet: DeepMutable<DesignTypes.WorkingSet> = {
      activeContextIds: [],
      activeNodeIds: [],
      capacity,
    }

    const state = Effect.fnUntraced(function* () {
      return workingSet
    })

    const list = Effect.fnUntraced(function* () {
      return {
        nodeIds: [...workingSet.activeNodeIds],
        contextIds: [...workingSet.activeContextIds],
      }
    })

    const activateContext = Effect.fn("WorkingSet.activateContext")(function* (contextId) {
      if (!workingSet.activeContextIds.includes(contextId)) {
        workingSet.activeContextIds.unshift(contextId)
      }
    })

    const forgetContext = Effect.fn("WorkingSet.forgetContext")(function* (contextId) {
      workingSet.activeContextIds = workingSet.activeContextIds.filter((id) => id !== contextId)
    })

    const activateNode = Effect.fn("WorkingSet.activateNode")(function* (nodeId) {
      workingSet.activeNodeIds = workingSet.activeNodeIds.filter((id) => id !== nodeId)
      workingSet.activeNodeIds.unshift(nodeId)
      if (workingSet.activeNodeIds.length > workingSet.capacity) {
        workingSet.activeNodeIds = workingSet.activeNodeIds.slice(0, workingSet.capacity)
      }
      const node = yield* graph.getNode(nodeId)
      if (node) yield* activateContext(node.contextId)
    })

    const forgetNode = Effect.fn("WorkingSet.forgetNode")(function* (nodeId) {
      workingSet.activeNodeIds = workingSet.activeNodeIds.filter((id) => id !== nodeId)
    })

    const fullName = (node: DesignTypes.Node, context: DesignTypes.BoundedContext): string => {
      const parts: string[] = []
      parts.push(context.name)
      parts.push(node.name)
      return parts.join("+")
    }

    const resolveReference = Effect.fn("WorkingSet.resolveReference")(function* (input) {
      const contexts = yield* graph.listContexts()
      const nodes = yield* graph.listNodes()

      const candidates = nodes.filter((n) => {
        const nameMatch = n.name === input.reference || n.aliases.includes(input.reference)
        if (!nameMatch) return false
        if (input.contextId && n.contextId !== input.contextId) return false
        return true
      })

      if (candidates.length === 1) {
        const node = candidates[0]
        yield* activateNode(node.id)
        const ctx = contexts.find((c) => c.id === node.contextId)
        return {
          nodeId: node.id,
          action: "matched" as const,
          fullName: ctx ? fullName(node, ctx) : node.name,
        }
      }

      if (candidates.length > 1) {
        return yield* Effect.fail(
          new Error(
            `Ambiguous reference "${input.reference}". Candidates: ${candidates
              .map((n) => {
                const ctx = contexts.find((c) => c.id === n.contextId)
                return ctx ? fullName(n, ctx) : n.name
              })
              .join(", ")}`,
          ),
        )
      }

      // No match: auto-create in default or hinted context
      let contextId = input.contextId
      if (!contextId) {
        const active = workingSet.activeContextIds[0]
        if (active) {
          contextId = active
        } else {
          const defaultCtx = yield* graph.createContext({ name: "默认上下文", semantics: "自动创建的默认上下文" })
          contextId = defaultCtx.id
          yield* activateContext(contextId)
        }
      }

      const node = yield* graph.createNode({
        name: input.reference,
        contextId,
        defaultSemantics: "",
      })
      yield* activateNode(node.id)
      const ctx = contexts.find((c) => c.id === node.contextId) ?? (yield* graph.getContext(contextId))
      return {
        nodeId: node.id,
        action: "created" as const,
        fullName: ctx ? fullName(node, ctx) : node.name,
      }
    })

    return {
      activateNode,
      forgetNode,
      activateContext,
      forgetContext,
      resolveReference,
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
