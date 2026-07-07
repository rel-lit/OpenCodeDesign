import { Clock, Context, Effect, Layer } from "effect"
import type { Scope } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Project } from "@opencode-ai/schema/project"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { InstanceRef } from "@/effect/instance-ref"
import { registerBeforeDisposer } from "@/effect/instance-registry"
import { GraphEngine } from "./core/graph"
import { WorkingSet } from "./core/working-set"
import { EventLog } from "./core/event-log"
import { DesignTypes } from "./core/types"
import { DesignStore } from "./store/store"
import * as GraphAgentTypes from "./agent/types"
import { VersionSync } from "./system/version-sync"
import { TemporaryWorkingSet } from "./system/temporary-working-set"
import { DesignChangeBuffer } from "./system/design-change-buffer"
import { PlanHandoff } from "./plan-handoff"
import { Provider } from "@/provider/provider"

export interface Interface {
  readonly listContexts: GraphEngine.Interface["listContexts"]
  readonly getContext: GraphEngine.Interface["getContext"]
  readonly getNode: GraphEngine.Interface["getNode"]
  readonly findNodesByName: GraphEngine.Interface["findNodesByName"]
  readonly listNodes: GraphEngine.Interface["listNodes"]
  readonly listEdges: GraphEngine.Interface["listEdges"]
  readonly listPrototypes: GraphEngine.Interface["listPrototypes"]
  readonly getPrototype: GraphEngine.Interface["getPrototype"]
  readonly touchContext: WorkingSet.Interface["touchContext"]
  readonly touchNode: WorkingSet.Interface["touchNode"]
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
  readonly bufferAddOperation: DesignChangeBuffer.Interface["addOperation"]
  readonly bufferListOperations: DesignChangeBuffer.Interface["listOperations"]
  readonly bufferUndoOperation: DesignChangeBuffer.Interface["undoOperation"]
  readonly bufferGetDelta: DesignChangeBuffer.Interface["getDelta"]
  readonly bufferApply: (
    sessionID: string,
    options?: { source?: DesignTypes.VersionBumpSource },
  ) => Effect.Effect<void, GraphEngine.GraphEngineError>
  readonly bufferClear: DesignChangeBuffer.Interface["clear"]
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
  readonly changeBuffer: DesignChangeBuffer.Interface
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
        const workingSetEntries = yield* store.loadWorkingSet()

        const graph = yield* GraphEngine.makeEngine()
        const workingSet = yield* WorkingSet.makeWorkingSet(20, workingSetEntries)(graph)
        const eventLog = yield* EventLog.makeEventLog()
        const versionSync = VersionSync.make(eventLog)
        const temporaryWorkingSet = TemporaryWorkingSet.make(graph, workingSet)
        const changeBuffer = DesignChangeBuffer.make(graph)

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

        return { graph, workingSet, eventLog, versionSync, store, temporaryWorkingSet, changeBuffer }
      }),
    )

    const saveWorkingSet = Effect.fn("Design.saveWorkingSet")(() =>
      use((state) =>
        Effect.gen(function* () {
          const entries = yield* state.workingSet.list()
          yield* state.store.saveWorkingSet(entries)
        }),
      ),
    )

    const saveWorkingSetIfPossible = Effect.fn("Design.saveWorkingSetIfPossible")(() =>
      Effect.gen(function* () {
        const ctx = yield* InstanceRef
        if (!ctx) return
        yield* saveWorkingSet()
      }),
    )

    const off = registerBeforeDisposer((directory) =>
      Effect.runPromise(
        saveWorkingSetIfPossible().pipe(
          Effect.provideService(DesignStore.Service, designStore),
          Effect.provideService(InstanceRef, {
            directory,
            worktree: directory,
            project: {
              id: Project.ID.global,
              worktree: directory,
              vcs: undefined,
              name: undefined,
              icon: undefined,
              commands: undefined,
              time: { created: 0, updated: 0, initialized: undefined },
              sandboxes: [],
            },
          } satisfies InstanceContext),
        ),
      ),
    )
    yield* Effect.addFinalizer(() => Effect.sync(off))

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* saveWorkingSetIfPossible().pipe(Effect.ignore)
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

    const getNode = Effect.fn("Design.getNode")((id: string) =>
      use((state) =>
        Effect.gen(function* () {
          const node = yield* state.graph.getNode(id)
          if (node) yield* state.workingSet.touchNode(node.id)
          return node
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
      listContexts,
      getContext,
      getNode,
      findNodesByName,
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
      bufferAddOperation: (sessionID: string, operation: Omit<GraphAgentTypes.BufferOperation, "id">) =>
        use((state) => state.changeBuffer.addOperation(sessionID, operation)),
      bufferListOperations: (sessionID: string) => use((state) => state.changeBuffer.listOperations(sessionID)),
      bufferUndoOperation: (sessionID: string, operationId: string, cascade?: boolean) =>
        use((state) => state.changeBuffer.undoOperation(sessionID, operationId, cascade)),
      bufferGetDelta: (sessionID: string) => use((state) => state.changeBuffer.getDelta(sessionID)),
      bufferApply: (sessionID: string, options?: { source?: DesignTypes.VersionBumpSource }) =>
        use((state) =>
          Effect.gen(function* () {
            const operations = yield* state.changeBuffer.listOperations(sessionID)
            yield* state.store.transaction((txStore) =>
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis
                const events: DesignTypes.EventNode[] = []

                for (const op of operations) {
                  switch (op.type) {
                    case "create_context": {
                      const payload = op.payload as { id: string; name: string; semantics?: string }
                      const created = yield* state.graph.createContext({
                        id: payload.id,
                        name: payload.name,
                        semantics: payload.semantics,
                      })
                      yield* state.workingSet.touchContext(created.id)
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "context_created",
                          affectedNodeIds: [created.id],
                        }),
                      )
                      break
                    }
                    case "update_context": {
                      const payload = op.payload as {
                        id: string
                        patch: { name?: string; semantics?: string }
                      }
                      yield* state.graph.updateContext(payload.id, payload.patch)
                      yield* state.workingSet.touchContext(payload.id)
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "context_updated",
                          affectedNodeIds: [payload.id],
                        }),
                      )
                      break
                    }
                    case "delete_context": {
                      const payload = op.payload as { id: string }
                      yield* state.graph.deleteContext(payload.id)
                      yield* state.workingSet.forgetContext(payload.id)
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "context_deleted",
                          affectedNodeIds: [payload.id],
                        }),
                      )
                      break
                    }
                    case "create_prototype": {
                      const payload = op.payload as {
                        id: string
                        name: string
                        defaultSemantics?: string
                        parameterSchema?: Record<string, unknown>
                      }
                      const created = yield* state.graph.createPrototype({
                        id: payload.id,
                        name: payload.name,
                        defaultSemantics: payload.defaultSemantics,
                        parameterSchema: payload.parameterSchema,
                      })
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "prototype_created",
                          affectedNodeIds: [created.id],
                        }),
                      )
                      break
                    }
                    case "update_prototype": {
                      const payload = op.payload as {
                        id: string
                        patch: {
                          name?: string
                          defaultSemantics?: string
                          parameterSchema?: Record<string, unknown>
                        }
                      }
                      yield* state.graph.updatePrototype(payload.id, payload.patch)
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "prototype_updated",
                          affectedNodeIds: [payload.id],
                        }),
                      )
                      break
                    }
                    case "delete_prototype": {
                      const payload = op.payload as { id: string }
                      yield* state.graph.deletePrototype(payload.id)
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "prototype_deleted",
                          affectedNodeIds: [payload.id],
                        }),
                      )
                      break
                    }
                  }
                }

                for (const op of operations) {
                  switch (op.type) {
                    case "create_node": {
                      const payload = op.payload as GraphAgentTypes.NodeInput
                      const created = yield* state.graph.createNode({
                        id: payload.id ?? crypto.randomUUID(),
                        name: payload.name,
                        contextId: payload.contextId,
                        kind: payload.kind,
                        defaultSemantics: payload.defaultSemantics,
                        aliases: payload.aliases ? [...payload.aliases] : undefined,
                        connectedEdges: payload.connectedEdges ? [...payload.connectedEdges] : undefined,
                        createdAt: payload.createdAt ?? now,
                        updatedAt: payload.updatedAt ?? now,
                        retired: payload.retired,
                      })
                      yield* state.workingSet.touchNode(created.id)
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "node_created",
                          affectedNodeIds: [created.id],
                        }),
                      )
                      break
                    }
                    case "update_node": {
                      const payload = op.payload as {
                        id: string
                        patch: Partial<GraphAgentTypes.NodeInput>
                      }
                      yield* state.graph.updateNode(payload.id, payload.patch)
                      yield* state.workingSet.touchNode(payload.id)
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "node_updated",
                          affectedNodeIds: [payload.id],
                        }),
                      )
                      break
                    }
                    case "delete_node": {
                      const payload = op.payload as { id: string }
                      yield* state.graph.deleteNode(payload.id)
                      yield* state.workingSet.forgetNode(payload.id)
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "node_deleted",
                          affectedNodeIds: [payload.id],
                        }),
                      )
                      break
                    }
                    case "create_edge": {
                      const payload = op.payload as GraphAgentTypes.EdgeInput
                      yield* state.graph.createEdge({
                        leftNodeId: payload.leftNodeId,
                        rightNodeId: payload.rightNodeId,
                        prototypeId: payload.prototypeId,
                        parameters: { ...(payload.parameters ?? {}) },
                        createdAt: payload.createdAt ?? now,
                        updatedAt: payload.updatedAt ?? now,
                      })
                      yield* state.workingSet.touchNode(payload.leftNodeId)
                      yield* state.workingSet.touchNode(payload.rightNodeId)
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "edge_created",
                          affectedNodeIds: [payload.leftNodeId, payload.rightNodeId],
                          affectedEdgeKeys: [
                            DesignTypes.edgeKey(payload.leftNodeId, payload.rightNodeId),
                          ],
                        }),
                      )
                      break
                    }
                    case "update_edge": {
                      const payload = op.payload as {
                        leftNodeId: string
                        rightNodeId: string
                        patch: Partial<GraphAgentTypes.EdgeInput>
                      }
                      yield* state.graph.updateEdge(payload.leftNodeId, payload.rightNodeId, payload.patch)
                      yield* state.workingSet.touchNode(payload.leftNodeId)
                      yield* state.workingSet.touchNode(payload.rightNodeId)
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "edge_updated",
                          affectedNodeIds: [payload.leftNodeId, payload.rightNodeId],
                          affectedEdgeKeys: [
                            DesignTypes.edgeKey(payload.leftNodeId, payload.rightNodeId),
                          ],
                        }),
                      )
                      break
                    }
                    case "delete_edge": {
                      const payload = op.payload as { leftNodeId: string; rightNodeId: string }
                      yield* state.graph.deleteEdge(payload.leftNodeId, payload.rightNodeId)
                      yield* state.workingSet.touchNode(payload.leftNodeId)
                      yield* state.workingSet.touchNode(payload.rightNodeId)
                      events.push(
                        yield* state.eventLog.append({
                          eventType: "edge_deleted",
                          affectedNodeIds: [payload.leftNodeId, payload.rightNodeId],
                          affectedEdgeKeys: [
                            DesignTypes.edgeKey(payload.leftNodeId, payload.rightNodeId),
                          ],
                        }),
                      )
                      break
                    }
                  }
                }

                const graphState = yield* state.graph.getState()
                yield* txStore.saveGraphState(graphState)
                for (const event of events) {
                  yield* txStore.appendEvent(event)
                }
              }),
            )
            yield* state.versionSync.bumpVersion(options?.source ?? "graph-agent")
            yield* state.changeBuffer.clear(sessionID)
          }),
        ),
      bufferClear: (sessionID: string) => use((state) => state.changeBuffer.clear(sessionID)),
      findContextByNameOrId,
      findNodeByNameOrId,
      summarizeGraphState,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer().pipe(
    Layer.provide(LayerNode.compile(DesignStore.node)),
    Layer.provide(LayerNode.compile(TemporaryWorkingSet.node)),
    Layer.provide(LayerNode.compile(DesignChangeBuffer.node)),
  ),
)

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [DesignStore.node, TemporaryWorkingSet.node, DesignChangeBuffer.node],
})

export * as Design from "./design"
