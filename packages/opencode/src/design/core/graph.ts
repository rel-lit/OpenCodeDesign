import { Context, Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { type DeepMutable } from "@opencode-ai/core/schema"
import { DesignTypes } from "./types"

export class GraphEngineError extends Schema.TaggedErrorClass<GraphEngineError>()("GraphEngineError", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly createNode: (input: {
    id?: string
    name: string
    contextId: string
    kind?: string
    defaultSemantics?: string
    aliases?: string[]
    connectedEdges?: Array<{ leftNodeId: string; rightNodeId: string; prototypeId: string }>
    createdAt?: number
    updatedAt?: number
    retired?: boolean
  }) => Effect.Effect<DesignTypes.Node>
  readonly updateNode: (id: string, input: Partial<Omit<DesignTypes.Node, "id" | "createdAt">>) => Effect.Effect<DesignTypes.Node, GraphEngineError>
  readonly retireNode: (id: string, retired: boolean) => Effect.Effect<DesignTypes.Node, GraphEngineError>
  readonly deleteNode: (id: string) => Effect.Effect<void>
  readonly getNode: (id: string) => Effect.Effect<DesignTypes.Node | undefined>
  readonly listNodes: () => Effect.Effect<DesignTypes.Node[]>
  readonly findNodesByName: (name: string, contextId?: string) => Effect.Effect<DesignTypes.Node[]>

  readonly createContext: (input: {
    id?: string
    name: string
    semantics?: string
  }) => Effect.Effect<DesignTypes.BoundedContext>
  readonly getContext: (id: string) => Effect.Effect<DesignTypes.BoundedContext | undefined>
  readonly listContexts: () => Effect.Effect<DesignTypes.BoundedContext[]>
  readonly updateContext: (id: string, input: Partial<Omit<DesignTypes.BoundedContext, "id">>) => Effect.Effect<DesignTypes.BoundedContext, GraphEngineError>

  readonly createPrototype: (input: {
    id?: string
    name: string
    defaultSemantics?: string
    parameterSchema?: Record<string, unknown>
  }) => Effect.Effect<DesignTypes.RelationPrototype>
  readonly updatePrototype: (id: string, input: Partial<Omit<DesignTypes.RelationPrototype, "id">>) => Effect.Effect<DesignTypes.RelationPrototype, GraphEngineError>
  readonly deletePrototype: (id: string) => Effect.Effect<void>
  readonly getPrototype: (id: string) => Effect.Effect<DesignTypes.RelationPrototype | undefined>
  readonly listPrototypes: () => Effect.Effect<DesignTypes.RelationPrototype[]>
  readonly deleteContext: (id: string) => Effect.Effect<void>

  readonly createEdge: (
    input: Omit<DesignTypes.Edge, "createdAt" | "updatedAt"> & Partial<Pick<DesignTypes.Edge, "createdAt" | "updatedAt">>,
  ) => Effect.Effect<DesignTypes.Edge>
  readonly updateEdge: (leftNodeId: string, rightNodeId: string, input: Partial<Pick<DesignTypes.Edge, "prototypeId" | "parameters">>) => Effect.Effect<DesignTypes.Edge, GraphEngineError>
  readonly deleteEdge: (leftNodeId: string, rightNodeId: string) => Effect.Effect<void>
  readonly getEdge: (leftNodeId: string, rightNodeId: string) => Effect.Effect<DesignTypes.Edge | undefined>
  readonly listEdges: () => Effect.Effect<DesignTypes.Edge[]>
  readonly listEdgesForNode: (nodeId: string) => Effect.Effect<DesignTypes.Edge[]>

  readonly getState: () => Effect.Effect<{
    nodes: DesignTypes.Node[]
    edges: DesignTypes.Edge[]
    prototypes: DesignTypes.RelationPrototype[]
    contexts: DesignTypes.BoundedContext[]
  }>
  readonly getStats: () => Effect.Effect<{
    getStateCallCount: number
    nodeCount: number
    edgeCount: number
    prototypeCount: number
    contextCount: number
  }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignGraphEngine") {}

const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

type MutableState = DeepMutable<DesignTypes.GraphState>

export const makeEngine = Effect.fn("GraphEngine.make")(function* () {
  let state: MutableState = {
    nodes: [],
    edges: [],
    prototypes: [],
    contexts: [],
    workingSet: { entries: [], capacity: 20 },
    eventLog: { events: [] },
  }
  let getStateCallCount = 0

  const now = () => Date.now()

  const createNode = Effect.fn("GraphEngine.createNode")(function* (input) {
    const node: MutableState["nodes"][number] = {
      id: input.id ?? makeId("node"),
      name: input.name,
      aliases: input.aliases ?? [],
      contextId: input.contextId,
      kind: input.kind ?? "node",
      defaultSemantics: input.defaultSemantics ?? "",
      connectedEdges: input.connectedEdges ?? [],
      createdAt: input.createdAt ?? now(),
      updatedAt: input.updatedAt ?? now(),
      retired: input.retired ?? false,
    }
    state.nodes.push(node)
    const ctx = state.contexts.find((c) => c.id === input.contextId)
    if (ctx) ctx.nodeIds.push(node.id)
    return node
  })

  const updateNode = Effect.fn("GraphEngine.updateNode")(function* (id, input) {
    const node = state.nodes.find((n) => n.id === id)
    if (!node) return yield* new GraphEngineError({ message: `Node not found: ${id}` })
    if (input.name !== undefined) node.name = input.name
    if (input.kind !== undefined) node.kind = input.kind
    if (input.defaultSemantics !== undefined) node.defaultSemantics = input.defaultSemantics
    if (input.aliases !== undefined) node.aliases = input.aliases
    if (input.contextId !== undefined) node.contextId = input.contextId
    if (input.retired !== undefined) node.retired = input.retired
    node.updatedAt = now()
    return node
  })

  const retireNode = Effect.fn("GraphEngine.retireNode")(function* (id, retired) {
    const node = state.nodes.find((n) => n.id === id)
    if (!node) return yield* new GraphEngineError({ message: `Node not found: ${id}` })
    node.retired = retired
    node.updatedAt = now()
    return node
  })

  const deleteNode = Effect.fn("GraphEngine.deleteNode")(function* (id) {
    state.nodes = state.nodes.filter((n) => n.id !== id)
    state.edges = state.edges.filter((e) => e.leftNodeId !== id && e.rightNodeId !== id)
    for (const node of state.nodes) {
      node.connectedEdges = node.connectedEdges.filter((e) => e.leftNodeId !== id && e.rightNodeId !== id)
    }
    for (const ctx of state.contexts) {
      ctx.nodeIds = ctx.nodeIds.filter((nid) => nid !== id)
    }
  })

  const getNode = Effect.fnUntraced(function* (id: string) {
    return state.nodes.find((n) => n.id === id)
  })

  const listNodes = Effect.fnUntraced(function* () {
    return [...state.nodes]
  })

  const findNodesByName = Effect.fn("GraphEngine.findNodesByName")(function* (name, contextId) {
    return state.nodes.filter((n) => {
      const matchName = n.name === name || n.aliases.includes(name)
      if (!matchName) return false
      if (contextId && n.contextId !== contextId) return false
      return true
    })
  })

  const createContext = Effect.fn("GraphEngine.createContext")(function* (input) {
    const ctx: MutableState["contexts"][number] = {
      id: input.id ?? makeId("ctx"),
      name: input.name,
      semantics: input.semantics ?? "",
      nodeIds: [],
    }
    state.contexts.push(ctx)
    return ctx
  })

  const getContext = Effect.fnUntraced(function* (id: string) {
    return state.contexts.find((c) => c.id === id)
  })

  const listContexts = Effect.fnUntraced(function* () {
    return [...state.contexts]
  })

  const updateContext = Effect.fn("GraphEngine.updateContext")(function* (id, input) {
    const ctx = state.contexts.find((c) => c.id === id)
    if (!ctx) return yield* new GraphEngineError({ message: `Context not found: ${id}` })
    if (input.name !== undefined) ctx.name = input.name
    if (input.semantics !== undefined) ctx.semantics = input.semantics
    return ctx
  })

  const deleteContext = Effect.fn("GraphEngine.deleteContext")(function* (id) {
    state.contexts = state.contexts.filter((c) => c.id !== id)
  })

  const createPrototype = Effect.fn("GraphEngine.createPrototype")(function* (input) {
    const proto: MutableState["prototypes"][number] = {
      id: input.id ?? makeId("proto"),
      name: input.name,
      defaultSemantics: input.defaultSemantics ?? "",
      parameterSchema: input.parameterSchema ?? {},
    }
    state.prototypes.push(proto)
    return proto
  })

  const updatePrototype = Effect.fn("GraphEngine.updatePrototype")(function* (id, input) {
    const proto = state.prototypes.find((p) => p.id === id)
    if (!proto) return yield* new GraphEngineError({ message: `Prototype not found: ${id}` })
    if (input.name !== undefined) proto.name = input.name
    if (input.defaultSemantics !== undefined) proto.defaultSemantics = input.defaultSemantics
    if (input.parameterSchema !== undefined) proto.parameterSchema = input.parameterSchema
    return proto
  })

  const deletePrototype = Effect.fn("GraphEngine.deletePrototype")(function* (id) {
    state.prototypes = state.prototypes.filter((p) => p.id !== id)
  })

  const getPrototype = Effect.fnUntraced(function* (id: string) {
    return state.prototypes.find((p) => p.id === id)
  })

  const listPrototypes = Effect.fnUntraced(function* () {
    return [...state.prototypes]
  })

  const getEdge = Effect.fnUntraced(function* (leftNodeId: string, rightNodeId: string) {
    const key = DesignTypes.edgeKey(leftNodeId, rightNodeId)
    return state.edges.find((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) === key)
  })

  const listEdges = Effect.fnUntraced(function* () {
    return [...state.edges]
  })

  const listEdgesForNode = Effect.fn("GraphEngine.listEdgesForNode")(function* (nodeId) {
    return state.edges.filter((e) => e.leftNodeId === nodeId || e.rightNodeId === nodeId)
  })

  const createEdge = Effect.fn("GraphEngine.createEdge")(function* (input) {
    const key = DesignTypes.edgeKey(input.leftNodeId, input.rightNodeId)
    const existingIndex = state.edges.findIndex((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) === key)
    const edge: MutableState["edges"][number] = {
      leftNodeId: input.leftNodeId,
      rightNodeId: input.rightNodeId,
      prototypeId: input.prototypeId,
      parameters: input.parameters ?? {},
      createdAt: input.createdAt ?? now(),
      updatedAt: input.updatedAt ?? now(),
    }

    if (existingIndex >= 0) {
      state.edges[existingIndex] = edge
      const left = state.nodes.find((n) => n.id === input.leftNodeId)
      const right = state.nodes.find((n) => n.id === input.rightNodeId)
      if (left) {
        const entry = left.connectedEdges.find((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) === key)
        if (entry) entry.prototypeId = input.prototypeId
      }
      if (right) {
        const entry = right.connectedEdges.find((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) === key)
        if (entry) entry.prototypeId = input.prototypeId
      }
    } else {
      state.edges.push(edge)
      const left = state.nodes.find((n) => n.id === input.leftNodeId)
      const right = state.nodes.find((n) => n.id === input.rightNodeId)
      if (left) left.connectedEdges.push({ leftNodeId: input.leftNodeId, rightNodeId: input.rightNodeId, prototypeId: input.prototypeId })
      if (right) right.connectedEdges.push({ leftNodeId: input.leftNodeId, rightNodeId: input.rightNodeId, prototypeId: input.prototypeId })
    }

    return edge
  })

  const updateEdge = Effect.fn("GraphEngine.updateEdge")(function* (leftNodeId, rightNodeId, input) {
    const key = DesignTypes.edgeKey(leftNodeId, rightNodeId)
    const edge = yield* getEdge(leftNodeId, rightNodeId)
    if (!edge) return yield* new GraphEngineError({ message: `Edge not found: ${leftNodeId} <-> ${rightNodeId}` })
    if (input.prototypeId !== undefined) {
      edge.prototypeId = input.prototypeId
      for (const node of state.nodes) {
        if (node.id !== leftNodeId && node.id !== rightNodeId) continue
        const entry = node.connectedEdges.find((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) === key)
        if (entry) entry.prototypeId = input.prototypeId
      }
    }
    if (input.parameters !== undefined) edge.parameters = input.parameters
    edge.updatedAt = now()
    return edge
  })

  const deleteEdge = Effect.fn("GraphEngine.deleteEdge")(function* (leftNodeId, rightNodeId) {
    const key = DesignTypes.edgeKey(leftNodeId, rightNodeId)
    state.edges = state.edges.filter((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) !== key)
    for (const node of state.nodes) {
      node.connectedEdges = node.connectedEdges.filter((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) !== key)
    }
  })

  const getState = Effect.fnUntraced(function* () {
    getStateCallCount++
    const result = {
      nodes: [...state.nodes],
      edges: [...state.edges],
      prototypes: [...state.prototypes],
      contexts: [...state.contexts],
    }
    yield* Effect.logDebug("GraphEngine.getState", {
      callCount: getStateCallCount,
      nodeCount: result.nodes.length,
      edgeCount: result.edges.length,
      contextCount: result.contexts.length,
      prototypeCount: result.prototypes.length,
    })
    return result
  })

  const getStats = Effect.fnUntraced(function* () {
    return {
      getStateCallCount,
      nodeCount: state.nodes.length,
      edgeCount: state.edges.length,
      prototypeCount: state.prototypes.length,
      contextCount: state.contexts.length,
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
    updateContext,
    deleteContext,
    createPrototype,
    updatePrototype,
    deletePrototype,
    getPrototype,
    listPrototypes,
    createEdge,
    updateEdge,
    deleteEdge,
    getEdge,
    listEdges,
    listEdgesForNode,
    getState,
    getStats,
  } satisfies Interface
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const engine = yield* makeEngine()
    return Service.of(engine)
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [],
})

export * as GraphEngine from "./graph"
