import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { DesignTypes } from "../core/types"
import * as GraphAgentTypes from "../agent/types"
import { GraphEngine } from "../core/graph"

export class BufferError {
  readonly _tag = "BufferError"
  constructor(readonly message: string, readonly blockedBy?: string[]) {}
}

export interface Interface {
  readonly listOperations: (sessionID: string) => Effect.Effect<GraphAgentTypes.BufferOperation[]>
  readonly addOperation: (sessionID: string, operation: Omit<GraphAgentTypes.BufferOperation, "id">) => Effect.Effect<GraphAgentTypes.BufferOperation>
  readonly undoOperation: (
    sessionID: string,
    operationId: string,
    cascade?: boolean,
  ) => Effect.Effect<void, BufferError>
  readonly getDelta: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly apply: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly clear: (sessionID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignChangeBuffer") {}

const ensureSession = (store: Map<string, GraphAgentTypes.BufferOperation[]>, sessionID: string) => {
  if (!store.has(sessionID)) store.set(sessionID, [])
}

const operationPayloadId = (op: GraphAgentTypes.BufferOperation): string | undefined => {
  const payload = op.payload as { id?: string }
  return payload.id
}

const isReferencedBy = (op: GraphAgentTypes.BufferOperation, candidate: GraphAgentTypes.BufferOperation): boolean => {
  const opId = operationPayloadId(op)
  if (!opId) return false

  switch (op.type) {
    case "create_context":
    case "update_context": {
      if (candidate.type !== "create_node") return false
      const payload = candidate.payload as { contextId?: string }
      return payload.contextId === opId
    }
    case "create_node":
    case "update_node": {
      if (candidate.type !== "create_edge" && candidate.type !== "update_edge" && candidate.type !== "delete_edge") {
        return false
      }
      const payload = candidate.payload as { leftNodeId?: string; rightNodeId?: string }
      return payload.leftNodeId === opId || payload.rightNodeId === opId
    }
    case "create_prototype":
    case "update_prototype": {
      if (candidate.type !== "create_edge" && candidate.type !== "update_edge") return false
      const payload = candidate.payload as { prototypeId?: string }
      return payload.prototypeId === opId
    }
    default:
      return false
  }
}

const collectDependentOperations = (operations: GraphAgentTypes.BufferOperation[], targetIndex: number): number[] => {
  const dependent = new Set<number>()
  const queue = [targetIndex]

  while (queue.length > 0) {
    const currentIndex = queue.shift()!
    const currentOp = operations[currentIndex]
    if (!currentOp) continue

    for (let i = currentIndex + 1; i < operations.length; i++) {
      if (dependent.has(i)) continue
      const candidate = operations[i]
      if (!candidate) continue
      if (isReferencedBy(currentOp, candidate)) {
        dependent.add(i)
        queue.push(i)
      }
    }
  }

  return Array.from(dependent).sort((a, b) => b - a)
}

export const make = (_graph: GraphEngine.Interface) => {
  const store = new Map<string, GraphAgentTypes.BufferOperation[]>()

  const listOperations = Effect.fn("DesignChangeBuffer.listOperations")(function* (sessionID: string) {
    return store.get(sessionID) ?? []
  })

  const addOperation = Effect.fn("DesignChangeBuffer.addOperation")(
    function* (sessionID: string, operation: Omit<GraphAgentTypes.BufferOperation, "id">) {
      ensureSession(store, sessionID)
      const operations = store.get(sessionID)!
      const id = crypto.randomUUID()
      const bufferOperation: GraphAgentTypes.BufferOperation = { ...operation, id }
      operations.push(bufferOperation)
      if (operations.length > 100) {
        yield* Effect.logWarning("DesignChangeBuffer exceeded 100 operations", { sessionID, operationCount: operations.length })
      }
      return bufferOperation
    },
  )

  const undoOperation = Effect.fn("DesignChangeBuffer.undoOperation")(
    function* (sessionID: string, operationId: string, cascade = false) {
      const operations = store.get(sessionID)
      if (!operations) return

      const index = operations.findIndex((op) => op.id === operationId)
      if (index === -1) return

      const dependentIndexes = collectDependentOperations(operations, index)

      if (dependentIndexes.length > 0 && !cascade) {
        const blockedBy = dependentIndexes.map((i) => operations[i]!.id).reverse()
        return yield* Effect.fail(
          new BufferError(
            `Operation '${operationId}' is referenced by later operations. Undo those first or use cascade: true.`,
            blockedBy,
          ),
        )
      }

      const indexesToRemove = new Set([index, ...dependentIndexes])
      const next = operations.filter((_, i) => !indexesToRemove.has(i))
      store.set(sessionID, next)
    },
  )

  const getDelta = Effect.fn("DesignChangeBuffer.getDelta")(function* (sessionID: string) {
    const operations = store.get(sessionID) ?? []
    const delta: GraphAgentTypes.GraphDelta = {}

    for (const op of operations) {
      switch (op.type) {
        case "create_context": {
          const payload = op.payload as { id: string; name: string; semantics?: string }
          delta.addContexts = [...(delta.addContexts ?? []), payload]
          break
        }
        case "update_context": {
          const payload = op.payload as { id: string; patch: { name?: string; semantics?: string } }
          delta.updateContexts = [...(delta.updateContexts ?? []), payload]
          break
        }
        case "delete_context": {
          const payload = op.payload as { id: string }
          delta.deleteContextIds = [...(delta.deleteContextIds ?? []), payload.id]
          break
        }
        case "create_node": {
          delta.addNodes = [...(delta.addNodes ?? []), op.payload as GraphAgentTypes.NodeInput]
          break
        }
        case "update_node": {
          const payload = op.payload as { id: string; patch: Partial<GraphAgentTypes.NodeInput> }
          delta.updateNodes = [...(delta.updateNodes ?? []), payload]
          break
        }
        case "delete_node": {
          const payload = op.payload as { id: string }
          delta.deleteNodeIds = [...(delta.deleteNodeIds ?? []), payload.id]
          break
        }
        case "create_edge": {
          delta.addEdges = [...(delta.addEdges ?? []), op.payload as GraphAgentTypes.EdgeInput]
          break
        }
        case "update_edge": {
          const payload = op.payload as {
            leftNodeId: string
            rightNodeId: string
            patch: Partial<GraphAgentTypes.EdgeInput>
          }
          delta.updateEdges = [...(delta.updateEdges ?? []), payload]
          break
        }
        case "delete_edge": {
          const payload = op.payload as { leftNodeId: string; rightNodeId: string }
          delta.deleteEdgeKeys = [
            ...(delta.deleteEdgeKeys ?? []),
            DesignTypes.edgeKey(payload.leftNodeId, payload.rightNodeId),
          ]
          break
        }
        case "create_prototype": {
          const payload = op.payload as {
            id: string
            name: string
            defaultSemantics?: string
            parameterSchema?: Record<string, unknown>
          }
          delta.addPrototypes = [...(delta.addPrototypes ?? []), payload]
          break
        }
        case "update_prototype": {
          const payload = op.payload as {
            id: string
            patch: { name?: string; defaultSemantics?: string; parameterSchema?: Record<string, unknown> }
          }
          delta.updatePrototypes = [...(delta.updatePrototypes ?? []), payload]
          break
        }
        case "delete_prototype": {
          const payload = op.payload as { id: string }
          delta.deletePrototypeIds = [...(delta.deletePrototypeIds ?? []), payload.id]
          break
        }
      }
    }

    return delta
  })

  const apply = Effect.fn("DesignChangeBuffer.apply")(function* (sessionID: string) {
    const delta = yield* getDelta(sessionID)
    store.delete(sessionID)
    return delta
  })

  const clear = Effect.fn("DesignChangeBuffer.clear")(function* (sessionID: string) {
    store.delete(sessionID)
  })

  return {
    listOperations,
    addOperation,
    undoOperation,
    getDelta,
    apply,
    clear,
  } satisfies Interface
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const graph = yield* GraphEngine.Service
    return Service.of(make(graph))
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(GraphEngine.defaultLayer))

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [GraphEngine.node],
})

export * as DesignChangeBuffer from "./design-change-buffer"
