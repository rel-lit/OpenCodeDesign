import { Context, Effect, Layer, Scope } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { GraphEngine } from "./core/graph"
import { WorkingSet } from "./core/working-set"
import { EventLog } from "./core/event-log"
import { DesignTypes } from "./core/types"
import { DesignStore } from "./store/store"

export interface Interface {
  readonly createContext: GraphEngine.Interface["createContext"]
  readonly createNode: GraphEngine.Interface["createNode"]
  readonly createEdge: GraphEngine.Interface["createEdge"]
  readonly resolveReference: WorkingSet.Interface["resolveReference"]
  readonly listNodes: GraphEngine.Interface["listNodes"]
  readonly listEdges: GraphEngine.Interface["listEdges"]
  readonly listWorkingSet: WorkingSet.Interface["list"]
  readonly getState: () => Effect.Effect<DesignTypes.GraphState>
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Design") {}

type DesignState = {
  readonly graph: GraphEngine.Interface
  readonly workingSet: WorkingSet.Interface
  readonly eventLog: EventLog.Interface
  readonly store: DesignStore.Store
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const designStore = yield* DesignStore.Service

    const designState = yield* InstanceState.make<DesignState, never, Scope.Scope>(
      Effect.fn("Design.state")(function* () {
        const store = designStore.store

        const loaded = yield* store.loadGraphState()

        const graph = yield* GraphEngine.makeEngine()
        const workingSet = yield* WorkingSet.makeWorkingSet(20)(graph)
        const eventLog = yield* EventLog.makeEventLog()

        if (loaded.nodes.length > 0 || loaded.contexts.length > 0) {
          for (const ctx of loaded.contexts) {
            yield* graph.createContext({ id: ctx.id, name: ctx.name, semantics: ctx.semantics })
          }
          for (const proto of loaded.prototypes) {
            yield* graph.createPrototype({
              id: proto.id,
              name: proto.name,
              defaultSemantics: proto.defaultSemantics,
              parameterSchema: proto.parameterSchema,
            })
          }
          for (const node of loaded.nodes) {
            yield* graph.createNode({
              id: node.id,
              name: node.name,
              contextId: node.contextId,
              defaultSemantics: node.defaultSemantics,
              aliases: [...node.aliases],
            })
          }
          for (const edge of loaded.edges) {
            yield* graph.createEdge({
              leftNodeId: edge.leftNodeId,
              rightNodeId: edge.rightNodeId,
              prototypeId: edge.prototypeId,
              parameters: { ...edge.parameters },
            })
          }
          for (const event of loaded.eventLog.events) {
            yield* eventLog.append({
              id: event.id,
              eventType: event.eventType,
              affectedNodeIds: [...event.affectedNodeIds],
              affectedEdgeKeys: [...event.affectedEdgeKeys],
              reason: event.reason,
              rollbackTarget: event.rollbackTarget,
            })
          }
        }

        return { graph, workingSet, eventLog, store } as DesignState
      }),
    )

    const use = <A, E>(select: (state: DesignState) => Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const state = yield* InstanceState.get(designState)
        return yield* select(state)
      })

    const persistMutation = (event: DesignTypes.EventNode) =>
      use((state) =>
        state.store.transaction((txStore) =>
          Effect.gen(function* () {
            const graphState = yield* state.graph.getState()
            yield* txStore.saveGraphState(graphState)
            yield* txStore.appendEvent(event)
          }),
        ),
      )

    const createContext = (input: Parameters<GraphEngine.Interface["createContext"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const ctx = yield* state.graph.createContext(input)
          const event = yield* state.eventLog.append({ eventType: "context_created", affectedNodeIds: [], affectedEdgeKeys: [] })
          yield* state.workingSet.activateContext(ctx.id)
          yield* persistMutation(event)
          return ctx
        }),
      )

    const createNode = (input: Parameters<GraphEngine.Interface["createNode"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const node = yield* state.graph.createNode(input)
          const event = yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [node.id] })
          yield* state.workingSet.activateNode(node.id)
          yield* persistMutation(event)
          return node
        }),
      )

    const createEdge = (input: Parameters<GraphEngine.Interface["createEdge"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const edge = yield* state.graph.createEdge(input)
          const event = yield* state.eventLog.append({
            eventType: "edge_created",
            affectedNodeIds: [edge.leftNodeId, edge.rightNodeId],
            affectedEdgeKeys: [DesignTypes.edgeKey(edge.leftNodeId, edge.rightNodeId)],
          })
          yield* Effect.all([state.workingSet.activateNode(edge.leftNodeId), state.workingSet.activateNode(edge.rightNodeId)])
          yield* persistMutation(event)
          return edge
        }),
      )

    const resolveReference = (input: Parameters<WorkingSet.Interface["resolveReference"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const result = yield* state.workingSet.resolveReference(input)
          if (result.action === "created") {
            const event = yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [result.nodeId] })
            yield* persistMutation(event)
          }
          return result
        }),
      )

    const getState = () =>
      use((state) =>
        Effect.gen(function* () {
          const [nodes, edges, prototypes, contexts] = yield* Effect.all([
            state.graph.listNodes(),
            state.graph.listEdges(),
            state.graph.listPrototypes(),
            state.graph.listContexts(),
          ])
          const ws = yield* state.workingSet.state()
          const events = yield* state.eventLog.list()
          return {
            nodes,
            edges,
            prototypes,
            contexts,
            workingSet: ws,
            eventLog: { events },
          }
        }),
      )

    const init = () =>
      Effect.gen(function* () {
        yield* InstanceState.get(designState)
        yield* Effect.logInfo("design state initialized")
      })

    return Service.of({
      createContext,
      createNode,
      createEdge,
      resolveReference,
      listNodes: () => use((state) => state.graph.listNodes()),
      listEdges: () => use((state) => state.graph.listEdges()),
      listWorkingSet: () => use((state) => state.workingSet.list()),
      getState,
      init,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(DesignStore.defaultLayer))

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [DesignStore.node],
})

export * as Design from "./design"
