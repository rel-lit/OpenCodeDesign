import { Context, Effect, Layer } from "effect"
import type { Scope } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { GraphEngine } from "./core/graph"
import { WorkingSet } from "./core/working-set"
import { EventLog } from "./core/event-log"
import { DesignTypes } from "./core/types"
import { DesignStore } from "./store/store"
import { GraphAgent } from "./agent/graph"
import * as GraphAgentTypes from "./agent/types"
import { Preprocessor } from "./system/preprocessor"
import { WorkingSetComputer } from "./system/working-set-computer"
import { SystemAnalyzer } from "./system/analyzer"
import { VersionSync } from "./system/version-sync"
import { ApprovalPanel } from "./approval-panel"
import { Provider } from "@/provider/provider"
import { PlanHandoff } from "./plan-handoff"

export interface Interface {
  readonly createContext: GraphEngine.Interface["createContext"]
  readonly listContexts: GraphEngine.Interface["listContexts"]
  readonly getContext: GraphEngine.Interface["getContext"]
  readonly updateContext: (id: string, input: Partial<Omit<DesignTypes.BoundedContext, "id">>) => Effect.Effect<DesignTypes.BoundedContext, GraphEngine.GraphEngineError>
  readonly createNode: GraphEngine.Interface["createNode"]
  readonly getNode: GraphEngine.Interface["getNode"]
  readonly updateNode: GraphEngine.Interface["updateNode"]
  readonly retireNode: GraphEngine.Interface["retireNode"]
  readonly deleteNode: GraphEngine.Interface["deleteNode"]
  readonly findNodesByName: GraphEngine.Interface["findNodesByName"]
  readonly createEdge: GraphEngine.Interface["createEdge"]
  readonly updateEdge: GraphEngine.Interface["updateEdge"]
  readonly deleteEdge: GraphEngine.Interface["deleteEdge"]
  readonly createPrototype: GraphEngine.Interface["createPrototype"]
  readonly listPrototypes: GraphEngine.Interface["listPrototypes"]
  readonly getPrototype: GraphEngine.Interface["getPrototype"]
  readonly resolveReference: WorkingSet.Interface["resolveReference"]
  readonly activateContext: WorkingSet.Interface["activateContext"]
  readonly activateNode: WorkingSet.Interface["activateNode"]
  readonly listNodes: GraphEngine.Interface["listNodes"]
  readonly listEdges: GraphEngine.Interface["listEdges"]
  readonly listWorkingSet: WorkingSet.Interface["list"]
  readonly getState: () => Effect.Effect<DesignTypes.GraphState>
  readonly init: () => Effect.Effect<void>
  readonly transaction: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>
  readonly proposeChanges: (
    delta: GraphAgentTypes.GraphDelta,
    panel?: ApprovalPanel.Interface,
  ) => Effect.Effect<
    GraphAgentTypes.Output,
    GraphEngine.GraphEngineError | GraphAgent.NoDeltaError | Provider.DefaultModelError
  >
  readonly preprocessInput: (input: string) => Effect.Effect<
    {
      processedText: string
      temporaryWorkingSet: GraphAgentTypes.TemporaryWorkingSet
      enriched?: GraphAgentTypes.Output
    },
    Provider.DefaultModelError
  >
  readonly handoffToPlan: (input: {
    diffAnalysis: PlanHandoff.PlanHandoffPayload["diffAnalysis"]
    designGraphSummary: string
  }) => Effect.Effect<PlanHandoff.PlanHandoffPayload>
  readonly applyRawDelta: (delta: GraphAgentTypes.GraphDelta) => Effect.Effect<
    void,
    GraphEngine.GraphEngineError
  >
  readonly getCurrentVersion: VersionSync.Interface["getCurrentVersion"]
  readonly bumpVersion: VersionSync.Interface["bumpVersion"]
  readonly refreshChatAgentContext: VersionSync.Interface["refreshChatAgentContext"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Design") {}

type DesignState = {
  readonly graph: GraphEngine.Interface
  readonly workingSet: WorkingSet.Interface
  readonly eventLog: EventLog.Interface
  readonly versionSync: VersionSync.Interface
  readonly store: DesignStore.Store
}

export type LayerOptions = {
  readonly makeApprovalPanel?: () => ApprovalPanel.Interface
}

export const layer = (options?: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const designStore = yield* DesignStore.Service
      const graphAgent = yield* GraphAgent.Service
      const makeApprovalPanel = options?.makeApprovalPanel ?? ApprovalPanel.make

    const designState = yield* InstanceState.make<DesignState, never, Scope.Scope>(
      Effect.fn("Design.state")(function* () {
        const store = designStore.store

        const loaded = yield* store.loadGraphState()

        const graph = yield* GraphEngine.makeEngine()
        const workingSet = yield* WorkingSet.makeWorkingSet(20)(graph)
        const eventLog = yield* EventLog.makeEventLog()
        const versionSync = VersionSync.make(eventLog)

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
          for (const event of loaded.eventLog?.events ?? []) {
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

        return { graph, workingSet, eventLog, versionSync, store }
      }),
    )

    const use = <A, E>(select: (state: DesignState) => Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const state = yield* InstanceState.get(designState)
        return yield* select(state)
      })

    const persistMutation = Effect.fn("Design.persistMutation")((event: DesignTypes.EventNode) =>
      use((state) =>
        state.store.transaction((txStore) =>
          Effect.gen(function* () {
            const graphState = yield* state.graph.getState()
            yield* txStore.saveGraphState(graphState)
            yield* txStore.appendEvent(event)
          }),
        ),
      ),
    )

    const createContext = Effect.fn("Design.createContext")((input: Parameters<GraphEngine.Interface["createContext"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const ctx = yield* state.graph.createContext(input)
          const event = yield* state.eventLog.append({ eventType: "context_created", affectedNodeIds: [], affectedEdgeKeys: [] })
          yield* state.workingSet.activateContext(ctx.id)
          yield* persistMutation(event)
          return ctx
        }),
      ),
    )

    const createNode = Effect.fn("Design.createNode")((input: Parameters<GraphEngine.Interface["createNode"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const node = yield* state.graph.createNode(input)
          const event = yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [node.id] })
          yield* state.workingSet.activateNode(node.id)
          yield* persistMutation(event)
          return node
        }),
      ),
    )

    const createEdge = Effect.fn("Design.createEdge")((input: Parameters<GraphEngine.Interface["createEdge"]>[0]) =>
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
      ),
    )

    const resolveReference = Effect.fn("Design.resolveReference")((input: Parameters<WorkingSet.Interface["resolveReference"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const result = yield* state.workingSet.resolveReference(input)
          if (result.action === "created") {
            const event = yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [result.nodeId] })
            yield* persistMutation(event)
          }
          return result
        }),
      ),
    )

    const listContexts = Effect.fn("Design.listContexts")(() => use((state) => state.graph.listContexts()))
    const getContext = Effect.fn("Design.getContext")((id: string) => use((state) => state.graph.getContext(id)))
    const updateContext = Effect.fn("Design.updateContext")((id: string, input: Partial<Omit<DesignTypes.BoundedContext, "id">>) =>
      use((state) =>
        Effect.gen(function* () {
          const ctx = yield* state.graph.updateContext(id, input)
          const event = yield* state.eventLog.append({ eventType: "context_updated", affectedNodeIds: [] })
          yield* persistMutation(event)
          return ctx
        }),
      ),
    )

    const getNode = Effect.fn("Design.getNode")((id: string) => use((state) => state.graph.getNode(id)))
    const updateNode = Effect.fn("Design.updateNode")((id: string, input: Parameters<GraphEngine.Interface["updateNode"]>[1]) =>
      use((state) =>
        Effect.gen(function* () {
          const node = yield* state.graph.updateNode(id, input)
          const event = yield* state.eventLog.append({ eventType: "node_updated", affectedNodeIds: [node.id] })
          yield* state.workingSet.activateNode(node.id)
          yield* persistMutation(event)
          return node
        }),
      ),
    )
    const retireNode = Effect.fn("Design.retireNode")((id: string, retired: boolean) =>
      use((state) =>
        Effect.gen(function* () {
          const node = yield* state.graph.retireNode(id, retired)
          const event = yield* state.eventLog.append({
            eventType: retired ? "node_retired" : "node_unretired",
            affectedNodeIds: [node.id],
          })
          yield* persistMutation(event)
          return node
        }),
      ),
    )
    const deleteNode = Effect.fn("Design.deleteNode")((id: string) =>
      use((state) =>
        Effect.gen(function* () {
          yield* state.graph.deleteNode(id)
          const event = yield* state.eventLog.append({ eventType: "node_deleted", affectedNodeIds: [id] })
          yield* state.workingSet.forgetNode(id)
          yield* persistMutation(event)
        }),
      ),
    )
    const findNodesByName = Effect.fn("Design.findNodesByName")((name: string, contextId?: string) =>
      use((state) => state.graph.findNodesByName(name, contextId)),
    )

    const updateEdge = Effect.fn("Design.updateEdge")((leftNodeId: string, rightNodeId: string, input: Parameters<GraphEngine.Interface["updateEdge"]>[2]) =>
      use((state) =>
        Effect.gen(function* () {
          const edge = yield* state.graph.updateEdge(leftNodeId, rightNodeId, input)
          const event = yield* state.eventLog.append({
            eventType: "edge_updated",
            affectedNodeIds: [edge.leftNodeId, edge.rightNodeId],
            affectedEdgeKeys: [DesignTypes.edgeKey(edge.leftNodeId, edge.rightNodeId)],
          })
          yield* Effect.all([state.workingSet.activateNode(edge.leftNodeId), state.workingSet.activateNode(edge.rightNodeId)])
          yield* persistMutation(event)
          return edge
        }),
      ),
    )
    const deleteEdge = Effect.fn("Design.deleteEdge")((leftNodeId: string, rightNodeId: string) =>
      use((state) =>
        Effect.gen(function* () {
          yield* state.graph.deleteEdge(leftNodeId, rightNodeId)
          const event = yield* state.eventLog.append({
            eventType: "edge_deleted",
            affectedNodeIds: [leftNodeId, rightNodeId],
            affectedEdgeKeys: [DesignTypes.edgeKey(leftNodeId, rightNodeId)],
          })
          yield* Effect.all([state.workingSet.activateNode(leftNodeId), state.workingSet.activateNode(rightNodeId)])
          yield* persistMutation(event)
        }),
      ),
    )

    const createPrototype = Effect.fn("Design.createPrototype")((input: Parameters<GraphEngine.Interface["createPrototype"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const proto = yield* state.graph.createPrototype(input)
          const event = yield* state.eventLog.append({ eventType: "prototype_created", affectedNodeIds: [] })
          yield* persistMutation(event)
          return proto
        }),
      ),
    )
    const listPrototypes = Effect.fn("Design.listPrototypes")(() => use((state) => state.graph.listPrototypes()))
    const getPrototype = Effect.fn("Design.getPrototype")((id: string) => use((state) => state.graph.getPrototype(id)))

    const activateContext = Effect.fn("Design.activateContext")((contextId: string) =>
      use((state) => state.workingSet.activateContext(contextId)),
    )
    const activateNode = Effect.fn("Design.activateNode")((nodeId: string) => use((state) => state.workingSet.activateNode(nodeId)))

    const getState = Effect.fn("Design.getState")(() =>
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
      ),
    )

    const init = Effect.fn("Design.init")(function* () {
      yield* InstanceState.get(designState)
      yield* Effect.logInfo("design state initialized")
    })

    const shouldEnrich = (input: string, tws: GraphAgentTypes.TemporaryWorkingSet): boolean =>
      input.includes("@") && tws.nodeIds.length > 0

    const preprocessInput = Effect.fn("Design.preprocessInput")((input: string) =>
      use((state) =>
        Effect.gen(function* () {
          const graphState = yield* state.graph.getState()
          const activeWs = yield* state.workingSet.state()
          const activeWorkingSet: GraphAgentTypes.ActiveWorkingSet = {
            contextIds: [...activeWs.activeContextIds],
            nodeIds: [...activeWs.activeNodeIds],
            capacity: activeWs.capacity,
          }
          const expanded = Preprocessor.expandAtReferences(input, graphState)
          const temporaryWorkingSet = WorkingSetComputer.fromInput(input, activeWorkingSet, graphState)
          const analyzed = SystemAnalyzer.analyze(temporaryWorkingSet, graphState)
          const enriched = yield* shouldEnrich(input, analyzed)
            ? graphAgent.analyze({
                source: "chat",
                userInput: input,
                temporaryWorkingSet: analyzed,
                activeWorkingSet,
                graphState,
              })
            : Effect.succeed(undefined)
          const processedText = Preprocessor.buildProcessedText(expanded, analyzed, enriched)
          const result: {
            processedText: string
            temporaryWorkingSet: GraphAgentTypes.TemporaryWorkingSet
            enriched?: GraphAgentTypes.Output
          } = { processedText, temporaryWorkingSet: analyzed }
          if (enriched !== undefined) result.enriched = enriched
          return result
        }),
      ),
    )

    const transaction = <A, E>(effect: Effect.Effect<A, E>) =>
      use((state) => state.store.transaction(() => effect))

    const handoffToPlan = Effect.fn("Design.handoffToPlan")((input: {
      diffAnalysis: PlanHandoff.PlanHandoffPayload["diffAnalysis"]
      designGraphSummary: string
    }) => Effect.succeed(PlanHandoff.build(input)))

    const getCurrentVersion = Effect.fn("Design.getCurrentVersion")(() => use((state) => state.versionSync.getCurrentVersion()))
    const bumpVersion = Effect.fn("Design.bumpVersion")((source: VersionSync.GraphVersion["source"]) =>
      use((state) => state.versionSync.bumpVersion(source)),
    )
    const refreshChatAgentContext = Effect.fn("Design.refreshChatAgentContext")((version: VersionSync.GraphVersion) =>
      use((state) => state.versionSync.refreshChatAgentContext(version)),
    )

    const parseEdgeKey = (key: string): [string, string] => {
      const parts = key.split("::")
      return [parts[0], parts[1]]
    }

    const applyRawDelta = Effect.fn("Design.applyRawDelta")((delta: GraphAgentTypes.GraphDelta) =>
      use((state) =>
        state.store.transaction((txStore) =>
          Effect.gen(function* () {
            for (const node of delta.addNodes ?? []) {
              yield* state.graph.createNode({
                id: node.id,
                name: node.name,
                contextId: node.contextId,
                kind: node.kind,
                defaultSemantics: node.defaultSemantics,
                aliases: [...node.aliases],
              })
            }
            for (const update of delta.updateNodes ?? []) {
              yield* state.graph.updateNode(update.id, update.patch)
            }
            for (const id of delta.deleteNodeIds ?? []) {
              yield* state.graph.deleteNode(id)
            }
            for (const edge of delta.addEdges ?? []) {
              yield* state.graph.createEdge({
                leftNodeId: edge.leftNodeId,
                rightNodeId: edge.rightNodeId,
                prototypeId: edge.prototypeId,
                parameters: { ...edge.parameters },
              })
            }
            for (const update of delta.updateEdges ?? []) {
              yield* state.graph.updateEdge(update.leftNodeId, update.rightNodeId, update.patch)
            }
            for (const key of delta.deleteEdgeKeys ?? []) {
              const [leftNodeId, rightNodeId] = parseEdgeKey(key)
              yield* state.graph.deleteEdge(leftNodeId, rightNodeId)
            }
            const graphState = yield* state.graph.getState()
            yield* txStore.saveGraphState(graphState)
          }),
        ),
      ),
    )

    let self!: Interface

    const proposeChanges = Effect.fn("Design.proposeChanges")(
      (delta: GraphAgentTypes.GraphDelta, panel?: ApprovalPanel.Interface) =>
        Effect.gen(function* () {
          const state = yield* getState()
          const activeWs = yield* use((s) => s.workingSet.list())
          const input: GraphAgentTypes.Input = {
            source: "chat",
            userInput: "",
            temporaryWorkingSet: {
              contextIds: state.contexts.map((ctx) => ctx.id),
              nodeIds: state.nodes.map((node) => node.id),
              edgeKeys: state.edges.map((edge) => DesignTypes.edgeKey(edge.leftNodeId, edge.rightNodeId)),
              systemAnalysis: {
                conflictingRelations: [],
                duplicateNodeCandidates: [],
                orphanNodes: [],
                invalidPrototypeUsage: [],
              },
              expandedByGraphAgent: {
                contextIds: [],
                nodeIds: [],
                edgeKeys: [],
                reason: "",
              },
            },
            activeWorkingSet: {
              contextIds: activeWs.contextIds,
              nodeIds: activeWs.nodeIds,
              capacity: 20,
            },
            graphState: state,
            proposedChange: delta,
          }
          const proposal = yield* graphAgent.analyze(input)
          if (proposal.type !== "change-proposal") return proposal
          const approvalPanel = panel ?? makeApprovalPanel()
          approvalPanel.propose(proposal)
          const approved = yield* approvalPanel.awaitConfirmation()
          return yield* graphAgent.execute(approved).pipe(Effect.provideService(Service, self as Interface))
        }),
    )

    self = Service.of({
      createContext,
      listContexts,
      getContext,
      updateContext,
      createNode,
      getNode,
      updateNode,
      retireNode,
      deleteNode,
      findNodesByName,
      createEdge,
      updateEdge,
      deleteEdge,
      createPrototype,
      listPrototypes,
      getPrototype,
      resolveReference,
      activateContext,
      activateNode,
      listNodes: () => use((state) => state.graph.listNodes()),
      listEdges: () => use((state) => state.graph.listEdges()),
      listWorkingSet: () => use((state) => state.workingSet.list()),
      getState,
      init,
      transaction,
      proposeChanges,
      preprocessInput,
      handoffToPlan,
      applyRawDelta,
      getCurrentVersion,
      bumpVersion,
      refreshChatAgentContext,
    })

    return self
  }),
)

export const defaultLayer = layer().pipe(
  Layer.provide(DesignStore.defaultLayer),
  Layer.provide(GraphAgent.defaultLayer),
)

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [DesignStore.node],
})

export * as Design from "./design"
