import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { DesignTypes } from "../core/types"
import * as GraphAgentTypes from "../agent/types"
import { GraphEngine } from "../core/graph"

export interface Interface {
  readonly getPendingDelta: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly addNode: (sessionID: string, input: GraphAgentTypes.NodeInput) => Effect.Effect<void>
  readonly updateNode: (sessionID: string, id: string, patch: Partial<GraphAgentTypes.NodeInput>) => Effect.Effect<void>
  readonly deleteNode: (sessionID: string, id: string) => Effect.Effect<void>
  readonly addEdge: (sessionID: string, input: GraphAgentTypes.EdgeInput) => Effect.Effect<void>
  readonly updateEdge: (
    sessionID: string,
    leftNodeId: string,
    rightNodeId: string,
    patch: Partial<GraphAgentTypes.EdgeInput>,
  ) => Effect.Effect<void>
  readonly deleteEdge: (sessionID: string, leftNodeId: string, rightNodeId: string) => Effect.Effect<void>
  readonly apply: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly clear: (sessionID: string) => Effect.Effect<void>
  readonly getMergedState: (sessionID: string) => Effect.Effect<DesignTypes.GraphState>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignChangeAccumulator") {}

export const make = (graph: GraphEngine.Interface) => {
  const store = new Map<string, GraphAgentTypes.GraphDelta>()

  const getPendingDelta = Effect.fn("DesignChangeAccumulator.getPendingDelta")(function* (sessionID: string) {
    return store.get(sessionID) ?? {}
  })

  const ensureSession = (sessionID: string) => {
    if (!store.has(sessionID)) store.set(sessionID, {})
  }

  const addNode = Effect.fn("DesignChangeAccumulator.addNode")(function* (sessionID: string, input: GraphAgentTypes.NodeInput) {
    ensureSession(sessionID)
    const delta = store.get(sessionID)!
    const node = { ...input, id: input.id ?? crypto.randomUUID() }
    delta.addNodes = [...(delta.addNodes ?? []), node]
    store.set(sessionID, delta)
  })

  const updateNode = Effect.fn("DesignChangeAccumulator.updateNode")(
    function* (sessionID: string, id: string, patch: Partial<GraphAgentTypes.NodeInput>) {
      ensureSession(sessionID)
      const delta = store.get(sessionID)!
      delta.updateNodes = [...(delta.updateNodes ?? []), { id, patch }]
      store.set(sessionID, delta)
    },
  )

  const deleteNode = Effect.fn("DesignChangeAccumulator.deleteNode")(function* (sessionID: string, id: string) {
    ensureSession(sessionID)
    const delta = store.get(sessionID)!
    delta.deleteNodeIds = [...(delta.deleteNodeIds ?? []), id]
    store.set(sessionID, delta)
  })

  const addEdge = Effect.fn("DesignChangeAccumulator.addEdge")(function* (sessionID: string, input: GraphAgentTypes.EdgeInput) {
    ensureSession(sessionID)
    const delta = store.get(sessionID)!
    delta.addEdges = [...(delta.addEdges ?? []), input]
    store.set(sessionID, delta)
  })

  const updateEdge = Effect.fn("DesignChangeAccumulator.updateEdge")(
    function* (
      sessionID: string,
      leftNodeId: string,
      rightNodeId: string,
      patch: Partial<GraphAgentTypes.EdgeInput>,
    ) {
      ensureSession(sessionID)
      const delta = store.get(sessionID)!
      delta.updateEdges = [...(delta.updateEdges ?? []), { leftNodeId, rightNodeId, patch }]
      store.set(sessionID, delta)
    },
  )

  const deleteEdge = Effect.fn("DesignChangeAccumulator.deleteEdge")(
    function* (sessionID: string, leftNodeId: string, rightNodeId: string) {
      ensureSession(sessionID)
      const delta = store.get(sessionID)!
      delta.deleteEdgeKeys = [...(delta.deleteEdgeKeys ?? []), DesignTypes.edgeKey(leftNodeId, rightNodeId)]
      store.set(sessionID, delta)
    },
  )

  const apply = Effect.fn("DesignChangeAccumulator.apply")(function* (sessionID: string) {
    const delta = store.get(sessionID) ?? {}
    store.delete(sessionID)
    return delta
  })

  const clear = Effect.fn("DesignChangeAccumulator.clear")(function* (sessionID: string) {
    store.delete(sessionID)
  })

  const getMergedState = Effect.fn("DesignChangeAccumulator.getMergedState")(function* (sessionID: string) {
    const state = yield* graph.getState()
    const delta = store.get(sessionID) ?? {}

    const nodeMap = new Map(state.nodes.map((n) => [n.id, { ...n }]))
    const edgeMap = new Map(state.edges.map((e) => [DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId), { ...e }]))

    for (const node of delta.addNodes ?? []) {
      const id = node.id ?? crypto.randomUUID()
      nodeMap.set(id, {
        id,
        name: node.name,
        contextId: node.contextId,
        kind: node.kind ?? "node",
        aliases: node.aliases ?? [],
        defaultSemantics: node.defaultSemantics ?? "",
        connectedEdges: node.connectedEdges ?? [],
        createdAt: node.createdAt ?? Date.now(),
        updatedAt: node.updatedAt ?? Date.now(),
        retired: node.retired ?? false,
      })
    }

    for (const update of delta.updateNodes ?? []) {
      const node = nodeMap.get(update.id)
      if (node) {
        if (update.patch.name !== undefined) node.name = update.patch.name
        if (update.patch.contextId !== undefined) node.contextId = update.patch.contextId
        if (update.patch.kind !== undefined) node.kind = update.patch.kind
        if (update.patch.aliases !== undefined) node.aliases = [...update.patch.aliases]
        if (update.patch.defaultSemantics !== undefined) node.defaultSemantics = update.patch.defaultSemantics
        if (update.patch.retired !== undefined) node.retired = update.patch.retired
      }
    }

    for (const id of delta.deleteNodeIds ?? []) {
      nodeMap.delete(id)
    }

    for (const edge of delta.addEdges ?? []) {
      const key = DesignTypes.edgeKey(edge.leftNodeId, edge.rightNodeId)
      edgeMap.set(key, {
        leftNodeId: edge.leftNodeId,
        rightNodeId: edge.rightNodeId,
        prototypeId: edge.prototypeId,
        parameters: { ...(edge.parameters ?? {}) },
        createdAt: edge.createdAt ?? Date.now(),
        updatedAt: edge.updatedAt ?? Date.now(),
      })
    }

    for (const update of delta.updateEdges ?? []) {
      const key = DesignTypes.edgeKey(update.leftNodeId, update.rightNodeId)
      const edge = edgeMap.get(key)
      if (edge) {
        if (update.patch.prototypeId !== undefined) edge.prototypeId = update.patch.prototypeId
        if (update.patch.parameters !== undefined) edge.parameters = { ...update.patch.parameters }
      }
    }

    for (const key of delta.deleteEdgeKeys ?? []) {
      edgeMap.delete(key)
    }

    return {
      ...state,
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
    }
  })

  return {
    getPendingDelta,
    addNode,
    updateNode,
    deleteNode,
    addEdge,
    updateEdge,
    deleteEdge,
    apply,
    clear,
    getMergedState,
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

export * as ChangeAccumulator from "./change-accumulator"
