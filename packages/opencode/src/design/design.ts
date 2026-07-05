import { Clock, Context, Effect, Layer } from "effect"
import type { Scope } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { GraphEngine } from "./core/graph"
import { WorkingSet } from "./core/working-set"
import { EventLog } from "./core/event-log"
import { DesignTypes } from "./core/types"
import { DesignStore } from "./store/store"
import * as GraphAgentTypes from "./agent/types"
import { VersionSync } from "./system/version-sync"
import { TemporaryWorkingSet } from "./system/temporary-working-set"
import { ChangeAccumulator } from "./system/change-accumulator"
import { PlanHandoff } from "./plan-handoff"
import { Provider } from "@/provider/provider"

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
  readonly touchContext: WorkingSet.Interface["touchContext"]
  readonly touchNode: WorkingSet.Interface["touchNode"]
  readonly listNodes: GraphEngine.Interface["listNodes"]
  readonly listEdges: GraphEngine.Interface["listEdges"]
  readonly listWorkingSet: WorkingSet.Interface["list"]
  readonly getState: () => Effect.Effect<DesignTypes.GraphState>
  readonly init: () => Effect.Effect<void>
  readonly transaction: <A, E>(
    f: (txStore: DesignStore.Store) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>
  readonly handoffToPlan: (input: {
    diffAnalysis: PlanHandoff.PlanHandoffPayload["diffAnalysis"]
    designGraphSummary: string
  }) => Effect.Effect<PlanHandoff.PlanHandoffPayload>
  readonly applyRawDelta: (
    delta: GraphAgentTypes.GraphDelta,
    source?: DesignTypes.VersionBumpSource,
  ) => Effect.Effect<void, GraphEngine.GraphEngineError>
  readonly getCurrentVersion: VersionSync.Interface["getCurrentVersion"]
  readonly bumpVersion: VersionSync.Interface["bumpVersion"]
  readonly isVisualEditorDirty: VersionSync.Interface["isVisualEditorDirty"]
  readonly checkChatAgentSync: VersionSync.Interface["checkChatAgentSync"]
  readonly getTemporaryWorkingSet: TemporaryWorkingSet.Interface["get"]
  readonly addTemporaryWorkingSetEntry: TemporaryWorkingSet.Interface["addEntry"]
  readonly addTemporaryWorkingSetEntries: TemporaryWorkingSet.Interface["addEntries"]
  readonly expandTemporaryWorkingSetNode: TemporaryWorkingSet.Interface["expandNode"]
  readonly resetTemporaryWorkingSet: TemporaryWorkingSet.Interface["reset"]
  readonly destroyTemporaryWorkingSet: TemporaryWorkingSet.Interface["destroy"]
  readonly getChangeAccumulator: ChangeAccumulator.Interface["getPendingDelta"]
  readonly addAccumulatedNode: ChangeAccumulator.Interface["addNode"]
  readonly updateAccumulatedNode: ChangeAccumulator.Interface["updateNode"]
  readonly deleteAccumulatedNode: ChangeAccumulator.Interface["deleteNode"]
  readonly addAccumulatedEdge: ChangeAccumulator.Interface["addEdge"]
  readonly updateAccumulatedEdge: ChangeAccumulator.Interface["updateEdge"]
  readonly deleteAccumulatedEdge: ChangeAccumulator.Interface["deleteEdge"]
  readonly applyAccumulatedChanges: (
    sessionID: string,
    options?: { source?: DesignTypes.VersionBumpSource },
  ) => Effect.Effect<void, GraphEngine.GraphEngineError>
  readonly clearAccumulatedChanges: ChangeAccumulator.Interface["clear"]
  readonly getAccumulatedGraphState: ChangeAccumulator.Interface["getMergedState"]
  readonly findContextByNameOrId: (nameOrId: string) => Effect.Effect<DesignTypes.BoundedContext | undefined>
  readonly findNodeByNameOrId: (nameOrId: string) => Effect.Effect<DesignTypes.Node | undefined>
  readonly listEdgesForNode: GraphEngine.Interface["listEdgesForNode"]
  readonly summarizeGraphState: (state: DesignTypes.GraphState) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Design") {}

type DesignState = {
  readonly graph: GraphEngine.Interface
  readonly workingSet: WorkingSet.Interface
  readonly eventLog: EventLog.Interface
  readonly versionSync: VersionSync.Interface
  readonly temporaryWorkingSet: TemporaryWorkingSet.Interface
  readonly changeAccumulator: ChangeAccumulator.Interface
  readonly store: DesignStore.Store
}

export type LayerOptions = {
  readonly placeholder?: never
}

export const layer = (options?: LayerOptions) =>
  Layer.effect(
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
        const versionSync = VersionSync.make(eventLog)
        const temporaryWorkingSet = TemporaryWorkingSet.make(graph, workingSet)
        const changeAccumulator = ChangeAccumulator.make(graph)

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
              kind: node.kind,
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
              source: event.source,
            })
          }
        }

        return { graph, workingSet, eventLog, versionSync, store, temporaryWorkingSet, changeAccumulator }
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
          yield* state.workingSet.touchContext(ctx.id)
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
          yield* state.workingSet.touchNode(node.id)
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
          yield* Effect.all([state.workingSet.touchNode(edge.leftNodeId), state.workingSet.touchNode(edge.rightNodeId)])
          yield* persistMutation(event)
          return edge
        }),
      ),
    )

    const listContexts = Effect.fn("Design.listContexts")(() => use((state) => state.graph.listContexts()))
    const getContext = Effect.fn("Design.getContext")((id: string) =>
      use((state) =>
        Effect.gen(function* () {
          const ctx = yield* state.graph.getContext(id)
          if (ctx) yield* state.workingSet.touchContext(ctx.id)
          return ctx
        }),
      ),
    )
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

    const getNode = Effect.fn("Design.getNode")((id: string) =>
      use((state) =>
        Effect.gen(function* () {
          const node = yield* state.graph.getNode(id)
          if (node) yield* state.workingSet.touchNode(node.id)
          return node
        }),
      ),
    )
    const updateNode = Effect.fn("Design.updateNode")((id: string, input: Parameters<GraphEngine.Interface["updateNode"]>[1]) =>
      use((state) =>
        Effect.gen(function* () {
          const node = yield* state.graph.updateNode(id, input)
          const event = yield* state.eventLog.append({ eventType: "node_updated", affectedNodeIds: [node.id] })
          yield* state.workingSet.touchNode(node.id)
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
      use((state) =>
        Effect.gen(function* () {
          const nodes = yield* state.graph.findNodesByName(name, contextId)
          for (const node of nodes) {
            yield* state.workingSet.touchNode(node.id)
          }
          return nodes
        }),
      ),
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
          yield* Effect.all([state.workingSet.touchNode(edge.leftNodeId), state.workingSet.touchNode(edge.rightNodeId)])
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
          yield* Effect.all([state.workingSet.touchNode(leftNodeId), state.workingSet.touchNode(rightNodeId)])
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

    const touchContext = Effect.fn("Design.touchContext")((contextId: string) =>
      use((state) => state.workingSet.touchContext(contextId)),
    )
    const touchNode = Effect.fn("Design.touchNode")((nodeId: string) => use((state) => state.workingSet.touchNode(nodeId)))

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

    const transaction = <A, E>(f: (txStore: DesignStore.Store) => Effect.Effect<A, E>) =>
      use((state) => state.store.transaction(f))

    const handoffToPlan = Effect.fn("Design.handoffToPlan")((input: {
      diffAnalysis: PlanHandoff.PlanHandoffPayload["diffAnalysis"]
      designGraphSummary: string
    }) => Effect.succeed(PlanHandoff.build(input)))

    const getCurrentVersion = Effect.fn("Design.getCurrentVersion")(() => use((state) => state.versionSync.getCurrentVersion()))
    const bumpVersion = Effect.fn("Design.bumpVersion")((source: VersionSync.GraphVersion["source"]) =>
      use((state) =>
        Effect.gen(function* () {
          const version = yield* state.versionSync.bumpVersion(source)
          const events = yield* state.eventLog.list()
          const event = events[events.length - 1]
          if (event?.eventType === "graph_version_bumped") {
            yield* persistMutation(event)
          }
          return version
        }),
      ),
    )

    const parseEdgeKey = (key: string): [string, string] => {
      const parts = key.split("::")
      return [parts[0], parts[1]]
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    const isUuid = (value: string): boolean => UUID_REGEX.test(value)

    const applyRawDelta = Effect.fn("Design.applyRawDelta")(
      (delta: GraphAgentTypes.GraphDelta, source: DesignTypes.VersionBumpSource = "chat-agent") =>
      use((state) =>
        state.store.transaction((txStore) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis

            const edgeReferencedIds = new Set<string>()
            for (const edge of delta.addEdges ?? []) {
              edgeReferencedIds.add(edge.leftNodeId)
              edgeReferencedIds.add(edge.rightNodeId)
            }
            for (const update of delta.updateEdges ?? []) {
              edgeReferencedIds.add(update.leftNodeId)
              edgeReferencedIds.add(update.rightNodeId)
            }
            for (const key of delta.deleteEdgeKeys ?? []) {
              const [left, right] = parseEdgeKey(key)
              edgeReferencedIds.add(left)
              edgeReferencedIds.add(right)
            }

            const addNodeIds = new Set(
              (delta.addNodes ?? []).map((node) => node.id).filter((id): id is string => id !== undefined),
            )

            const tempIdMap = new Map<string, string>()
            for (const id of edgeReferencedIds) {
              if (isUuid(id)) continue
              if (addNodeIds.has(id)) {
                tempIdMap.set(id, crypto.randomUUID())
              }
            }

            const addNodes: Array<GraphAgentTypes.NodeInput> = []
            for (const node of delta.addNodes ?? []) {
              const originalId = node.id
              const id =
                originalId === undefined
                  ? crypto.randomUUID()
                  : tempIdMap.get(originalId) ?? originalId
              addNodes.push({
                ...node,
                id,
                kind: node.kind ?? "node",
                aliases: node.aliases ?? [],
                defaultSemantics: node.defaultSemantics ?? "",
                connectedEdges: node.connectedEdges ?? [],
                createdAt: node.createdAt ?? now,
                updatedAt: node.updatedAt ?? now,
                retired: node.retired ?? false,
              })
            }

            const resolveNodeId = (id: string): string => tempIdMap.get(id) ?? id

            const events: DesignTypes.EventNode[] = []
            for (const node of addNodes) {
              const created = yield* state.graph.createNode({
                id: node.id,
                name: node.name,
                contextId: node.contextId,
                kind: node.kind,
                defaultSemantics: node.defaultSemantics,
                aliases: node.aliases ? [...node.aliases] : [],
                connectedEdges: node.connectedEdges ? [...node.connectedEdges] : [],
                createdAt: node.createdAt,
                updatedAt: node.updatedAt,
                retired: node.retired,
              })
              events.push(
                yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [created.id] }),
              )
            }
            for (const update of delta.updateNodes ?? []) {
              yield* state.graph.updateNode(update.id, update.patch)
              events.push(
                yield* state.eventLog.append({ eventType: "node_updated", affectedNodeIds: [update.id] }),
              )
            }
            for (const id of delta.deleteNodeIds ?? []) {
              yield* state.graph.deleteNode(id)
              events.push(
                yield* state.eventLog.append({ eventType: "node_deleted", affectedNodeIds: [id] }),
              )
            }
            for (const edge of delta.addEdges ?? []) {
              const leftNodeId = resolveNodeId(edge.leftNodeId)
              const rightNodeId = resolveNodeId(edge.rightNodeId)
              yield* state.graph.createEdge({
                leftNodeId,
                rightNodeId,
                prototypeId: edge.prototypeId,
                parameters: { ...(edge.parameters ?? {}) },
                createdAt: edge.createdAt ?? now,
                updatedAt: edge.updatedAt ?? now,
              })
              events.push(
                yield* state.eventLog.append({
                  eventType: "edge_created",
                  affectedNodeIds: [leftNodeId, rightNodeId],
                  affectedEdgeKeys: [DesignTypes.edgeKey(leftNodeId, rightNodeId)],
                }),
              )
            }
            for (const update of delta.updateEdges ?? []) {
              const leftNodeId = resolveNodeId(update.leftNodeId)
              const rightNodeId = resolveNodeId(update.rightNodeId)
              yield* state.graph.updateEdge(leftNodeId, rightNodeId, update.patch)
              events.push(
                yield* state.eventLog.append({
                  eventType: "edge_updated",
                  affectedNodeIds: [leftNodeId, rightNodeId],
                  affectedEdgeKeys: [DesignTypes.edgeKey(leftNodeId, rightNodeId)],
                }),
              )
            }
            for (const key of delta.deleteEdgeKeys ?? []) {
              const [left, right] = parseEdgeKey(key)
              const leftNodeId = resolveNodeId(left)
              const rightNodeId = resolveNodeId(right)
              yield* state.graph.deleteEdge(leftNodeId, rightNodeId)
              events.push(
                yield* state.eventLog.append({
                  eventType: "edge_deleted",
                  affectedNodeIds: [leftNodeId, rightNodeId],
                  affectedEdgeKeys: [DesignTypes.edgeKey(leftNodeId, rightNodeId)],
                }),
              )
            }
            const graphState = yield* state.graph.getState()
            yield* txStore.saveGraphState(graphState)
            for (const event of events) {
              yield* txStore.appendEvent(event)
            }
            yield* state.versionSync.bumpVersion(source)
          }),
        ),
      ),
    )

    const findContextByNameOrId = Effect.fn("Design.findContextByNameOrId")((nameOrId: string) =>
      use((state) =>
        Effect.gen(function* () {
          const contexts = yield* state.graph.listContexts()
          const byId = contexts.find((c) => c.id === nameOrId)
          if (byId) return byId
          return contexts.find((c) => c.name === nameOrId)
        }),
      ),
    )

    const findNodeByNameOrId = Effect.fn("Design.findNodeByNameOrId")((nameOrId: string) =>
      use((state) =>
        Effect.gen(function* () {
          const nodes = yield* state.graph.listNodes()
          const byId = nodes.find((n) => n.id === nameOrId)
          if (byId) return byId
          return nodes.find((n) => n.name === nameOrId || n.aliases.includes(nameOrId))
        }),
      ),
    )

    const listEdgesForNode = (nodeId: string) => use((state) => state.graph.listEdgesForNode(nodeId))

    const summarizeGraphState = Effect.fn("Design.summarizeGraphState")((state: DesignTypes.GraphState) =>
      Effect.succeed(
        `Design has ${state.contexts.length} contexts, ${state.nodes.length} nodes, ${state.edges.length} edges, ${state.prototypes.length} prototypes.`,
      ),
    )

    return Service.of({
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
      touchContext,
      touchNode,
      listNodes: () => use((state) => state.graph.listNodes()),
      listEdges: () => use((state) => state.graph.listEdges()),
      listEdgesForNode,
      listWorkingSet: () => use((state) => state.workingSet.list()),
      getState,
      init,
      transaction,
      handoffToPlan,
      applyRawDelta,
      getCurrentVersion,
      bumpVersion,
      isVisualEditorDirty: () => use((state) => state.versionSync.isVisualEditorDirty()),
      checkChatAgentSync: () => use((state) => state.versionSync.checkChatAgentSync()),
      getTemporaryWorkingSet: (sessionID: string) => use((state) => state.temporaryWorkingSet.get(sessionID)),
      addTemporaryWorkingSetEntry: (sessionID: string, entry: DesignTypes.WorkingSetEntry) =>
        use((state) => state.temporaryWorkingSet.addEntry(sessionID, entry)),
      addTemporaryWorkingSetEntries: (sessionID: string, entries: DesignTypes.WorkingSetEntry[]) =>
        use((state) => state.temporaryWorkingSet.addEntries(sessionID, entries)),
      expandTemporaryWorkingSetNode: (sessionID: string, nodeId: string) =>
        use((state) => state.temporaryWorkingSet.expandNode(sessionID, nodeId)),
      resetTemporaryWorkingSet: (sessionID: string) => use((state) => state.temporaryWorkingSet.reset(sessionID)),
      destroyTemporaryWorkingSet: (sessionID: string) => use((state) => state.temporaryWorkingSet.destroy(sessionID)),
      getChangeAccumulator: (sessionID: string) => use((state) => state.changeAccumulator.getPendingDelta(sessionID)),
      addAccumulatedNode: (sessionID: string, input: GraphAgentTypes.NodeInput) =>
        use((state) => state.changeAccumulator.addNode(sessionID, input)),
      updateAccumulatedNode: (sessionID: string, id: string, patch: Partial<GraphAgentTypes.NodeInput>) =>
        use((state) => state.changeAccumulator.updateNode(sessionID, id, patch)),
      deleteAccumulatedNode: (sessionID: string, id: string) =>
        use((state) => state.changeAccumulator.deleteNode(sessionID, id)),
      addAccumulatedEdge: (sessionID: string, input: GraphAgentTypes.EdgeInput) =>
        use((state) => state.changeAccumulator.addEdge(sessionID, input)),
      updateAccumulatedEdge: (
        sessionID: string,
        leftNodeId: string,
        rightNodeId: string,
        patch: Partial<GraphAgentTypes.EdgeInput>,
      ) => use((state) => state.changeAccumulator.updateEdge(sessionID, leftNodeId, rightNodeId, patch)),
      deleteAccumulatedEdge: (sessionID: string, leftNodeId: string, rightNodeId: string) =>
        use((state) => state.changeAccumulator.deleteEdge(sessionID, leftNodeId, rightNodeId)),
      applyAccumulatedChanges: (sessionID: string, options?: { source?: DesignTypes.VersionBumpSource }) =>
        use((state) =>
          Effect.gen(function* () {
            const delta = yield* state.changeAccumulator.apply(sessionID)
            yield* applyRawDelta(delta, options?.source)
          }),
        ),
      clearAccumulatedChanges: (sessionID: string) => use((state) => state.changeAccumulator.clear(sessionID)),
      getAccumulatedGraphState: (sessionID: string) => use((state) => state.changeAccumulator.getMergedState(sessionID)),
      findContextByNameOrId,
      findNodeByNameOrId,
      summarizeGraphState,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer().pipe(
    Layer.provide(DesignStore.defaultLayer),
    Layer.provide(TemporaryWorkingSet.defaultLayer),
    Layer.provide(ChangeAccumulator.defaultLayer),
  ),
)

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [DesignStore.node, TemporaryWorkingSet.node, ChangeAccumulator.node],
})

export * as Design from "./design"
