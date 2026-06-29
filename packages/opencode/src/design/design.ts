import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { GraphEngine } from "./core/graph"
import { WorkingSet } from "./core/working-set"
import { EventLog } from "./core/event-log"
import { Persistence } from "./core/persistence"
import { DesignTypes } from "./core/types"

export interface Interface {
  readonly createContext: GraphEngine.Interface["createContext"]
  readonly createNode: GraphEngine.Interface["createNode"]
  readonly createEdge: GraphEngine.Interface["createEdge"]
  readonly resolveReference: WorkingSet.Interface["resolveReference"]
  readonly listNodes: GraphEngine.Interface["listNodes"]
  readonly listEdges: GraphEngine.Interface["listEdges"]
  readonly listWorkingSet: WorkingSet.Interface["list"]
  readonly getState: () => Effect.Effect<DesignTypes.GraphState>
  readonly save: () => Effect.Effect<void>
  readonly load: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Design") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const graph = yield* GraphEngine.Service
    const workingSet = yield* WorkingSet.Service
    const eventLog = yield* EventLog.Service
    const persistence = yield* Persistence.Service

    const getState = Effect.fn("Design.getState")(function* () {
      const [nodes, edges, prototypes, contexts] = yield* Effect.all([
        graph.listNodes(),
        graph.listEdges(),
        graph.listPrototypes(),
        graph.listContexts(),
      ])
      const ws = yield* workingSet.state()
      const events = yield* eventLog.list()
      return {
        nodes,
        edges,
        prototypes,
        contexts,
        workingSet: ws,
        eventLog: { events },
      }
    })

    const save = Effect.fn("Design.save")(function* () {
      const state = yield* getState()
      yield* persistence.save(state)
    })

    const load = Effect.fn("Design.load")(function* () {
      const loaded = yield* persistence.load()
      if (!loaded) return
      // In first milestone, loaded state is not restored into in-memory engine.
      // Restoration will be implemented in P2.
      yield* Effect.log("Loaded design state (restoration deferred to P2)")
    })

    const persistMutation = Effect.fn("Design.persistMutation")(function* (event: DesignTypes.EventNode) {
      yield* persistence.appendEvent(event)
      yield* save()
    })

    return Service.of({
      createContext: (input) =>
        Effect.gen(function* () {
          const ctx = yield* graph.createContext(input)
          const event = yield* eventLog.append({ eventType: "context_created", affectedNodeIds: [], affectedEdgeKeys: [] })
          yield* workingSet.activateContext(ctx.id)
          yield* persistMutation(event)
          return ctx
        }),
      createNode: (input) =>
        Effect.gen(function* () {
          const node = yield* graph.createNode(input)
          const event = yield* eventLog.append({ eventType: "node_created", affectedNodeIds: [node.id] })
          yield* workingSet.activateNode(node.id)
          yield* persistMutation(event)
          return node
        }),
      createEdge: (input) =>
        Effect.gen(function* () {
          const edge = yield* graph.createEdge(input)
          const event = yield* eventLog.append({
            eventType: "edge_created",
            affectedNodeIds: [edge.leftNodeId, edge.rightNodeId],
            affectedEdgeKeys: [DesignTypes.edgeKey(edge.leftNodeId, edge.rightNodeId)],
          })
          yield* Effect.all([workingSet.activateNode(edge.leftNodeId), workingSet.activateNode(edge.rightNodeId)])
          yield* persistMutation(event)
          return edge
        }),
      resolveReference: (input) =>
        Effect.gen(function* () {
          const result = yield* workingSet.resolveReference(input)
          if (result.action === "created") {
            const event = yield* eventLog.append({ eventType: "node_created", affectedNodeIds: [result.nodeId] })
            yield* persistMutation(event)
          }
          return result
        }),
      listNodes: graph.listNodes,
      listEdges: graph.listEdges,
      listWorkingSet: workingSet.list,
      getState,
      save,
      load,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(WorkingSet.defaultLayer),
  Layer.provide(GraphEngine.defaultLayer),
  Layer.provide(EventLog.defaultLayer),
  Layer.provide(Persistence.defaultLayer),
)

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [GraphEngine.node, WorkingSet.node, EventLog.node, Persistence.node],
})

export * as Design from "./design"
