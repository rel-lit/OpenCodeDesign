import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import { GraphAgentDesignTools } from "../../src/tool/design"
import {
  DesignFindConceptsTool,
  DesignGetContextTool,
  DesignGetConceptTool,
  DesignGetRelationsTool,
  DesignListPrototypesTool,
  DesignResolveReferenceTool,
} from "../../src/tool/design"
import { DesignStore } from "../../src/design/store/store"
import { Tool } from "@/tool/tool"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "../../src/session/schema"
import { testInstanceStoreLayer } from "../fixture/fixture"

const testDesignLayer = Design.layer().pipe(Layer.provide(DesignStore.defaultLayer))

const makeCtx = () => ({
  sessionID: SessionID.descending(),
  messageID: MessageID.ascending(),
  agent: "design-graph",
  abort: new AbortController().signal,
  messages: [],
  metadata() {
    return Effect.void
  },
  ask() {
    return Effect.void
  },
})

const it = testEffect(testInstanceStoreLayer)

const provideDesign = Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, testDesignLayer)

const findAccumulatedNodeIdByName = (design: Design.Interface, sessionID: string, name: string) =>
  Effect.gen(function* () {
    const state = yield* design.getAccumulatedGraphState(sessionID)
    const node = state.nodes.find((n) => n.name === name || n.aliases.includes(name))
    if (!node) throw new Error(`Node not found: ${name}`)
    return node.id
  })

describe("GraphAgent internal design tools", () => {
  it.instance("define_context and define_concept", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const findTool = yield* DesignFindConceptsTool
      const ctx = makeCtx()

      const ctxResult = yield* (yield* Tool.init(ctxTool)).execute({ name: "战斗系统" }, ctx)
      const contextId = ctxResult.metadata.contextId as string

      const nodeResult = yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)
      expect(nodeResult.output).toContain("船")

      const findResult = yield* (yield* Tool.init(findTool)).execute({ query: "船" }, ctx)
      expect(findResult.metadata.count).toBe(1)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("relate_concepts links two concepts", () =>
    Effect.gen(function* () {
      const resolveTool = yield* DesignResolveReferenceTool
      const relateTool = yield* GraphAgentDesignTools.DesignRelateConceptsTool
      const ctx = makeCtx()

      const ship = yield* (yield* Tool.init(resolveTool)).execute({ query: "船" }, ctx)
      const hp = yield* (yield* Tool.init(resolveTool)).execute({ query: "生命值" }, ctx)

      const edgeResult = yield* (yield* Tool.init(relateTool)).execute(
        {
          from: ship.metadata.nodeId as string,
          to: hp.metadata.nodeId as string,
          relation: "aggregate",
          constraints: { 上限: 1000 },
        },
        ctx,
      )
      expect(edgeResult.output).toContain("aggregate")
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("context create and get", () =>
    Effect.gen(function* () {
      const createTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const getTool = yield* DesignGetContextTool
      const ctx = makeCtx()

      const created = yield* (yield* Tool.init(createTool)).execute({ name: "战斗系统" }, ctx)
      const contextId = created.metadata.contextId as string

      const getResult = yield* (yield* Tool.init(getTool)).execute({ name_or_id: contextId }, ctx)
      expect(getResult.output).toContain("战斗系统")
      expect(getResult.output).toContain(contextId)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("concept CRUD including delete", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const getTool = yield* DesignGetConceptTool
      const updateTool = yield* GraphAgentDesignTools.DesignRefineConceptTool
      const deleteTool = yield* GraphAgentDesignTools.DesignWithdrawConceptTool
      const findTool = yield* DesignFindConceptsTool
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string

      yield* (yield* Tool.init(nodeTool)).execute(
        { name: "船", context: contextId, aliases: ["飞船"] },
        ctx,
      )
      const nodeId = yield* findAccumulatedNodeIdByName(design, ctx.sessionID, "船")

      const getResult = yield* (yield* Tool.init(getTool)).execute({ name_or_id: nodeId }, ctx)
      expect(getResult.output).toContain("飞船")

      const updateResult = yield* (yield* Tool.init(updateTool)).execute(
        { concept: nodeId, semantics: "玩家载具" },
        ctx,
      )
      expect(updateResult.output).toContain("queued for update")

      const getAfterUpdate = yield* (yield* Tool.init(getTool)).execute({ name_or_id: nodeId }, ctx)
      expect(getAfterUpdate.output).toContain("玩家载具")

      const findResult = yield* (yield* Tool.init(findTool)).execute({ query: "飞船" }, ctx)
      expect(findResult.metadata.count).toBe(1)

      yield* (yield* Tool.init(deleteTool)).execute({ concept: nodeId, cascade: true }, ctx)
      const getAfterDelete = yield* (yield* Tool.init(getTool)).execute({ name_or_id: nodeId }, ctx)
      expect(getAfterDelete.output).toContain("No concept")
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("relation update and delete", () =>
    Effect.gen(function* () {
      const resolveTool = yield* DesignResolveReferenceTool
      const relateTool = yield* GraphAgentDesignTools.DesignRelateConceptsTool
      const deleteTool = yield* GraphAgentDesignTools.DesignWithdrawRelationTool
      const listTool = yield* DesignGetRelationsTool
      const ctx = makeCtx()

      const ship = yield* (yield* Tool.init(resolveTool)).execute({ query: "船" }, ctx)
      const hp = yield* (yield* Tool.init(resolveTool)).execute({ query: "生命值" }, ctx)
      const from = ship.metadata.nodeId as string
      const to = hp.metadata.nodeId as string

      yield* (yield* Tool.init(relateTool)).execute(
        { from, to, relation: "aggregate" },
        ctx,
      )

      const updateResult = yield* (yield* Tool.init(relateTool)).execute(
        { from, to, relation: "aggregate", constraints: { max: 100 } },
        ctx,
      )
      expect(updateResult.output).toContain("aggregate")

      yield* (yield* Tool.init(deleteTool)).execute({ from, to }, ctx)
      const listResult = yield* (yield* Tool.init(listTool)).execute({ concept_id: from }, ctx)
      expect(listResult.metadata.count).toBe(0)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("prototype create and list", () =>
    Effect.gen(function* () {
      const createTool = yield* GraphAgentDesignTools.DesignDefineRelationPrototypeTool
      const listTool = yield* DesignListPrototypesTool
      const ctx = makeCtx()

      const created = yield* (yield* Tool.init(createTool)).execute(
        { name: "组合" },
        ctx,
      )
      const prototypeId = created.metadata.prototypeId as string

      const listResult = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(listResult.output).toContain("组合")
      expect(listResult.output).toContain(prototypeId)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("temporary working set tools", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const addTool = yield* GraphAgentDesignTools.DesignWorksetAddTool
      const removeTool = yield* GraphAgentDesignTools.DesignWorksetRemoveTool
      const getTool = yield* GraphAgentDesignTools.DesignWorksetGetTool
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string

      yield* (yield* Tool.init(nodeTool)).execute(
        { name: "船", context: contextId },
        ctx,
      )
      const nodeId = yield* findAccumulatedNodeIdByName(design, ctx.sessionID, "船")

      yield* (yield* Tool.init(addTool)).execute({ nodeIds: [nodeId], contextIds: [contextId] }, ctx)
      const getResult = yield* (yield* Tool.init(getTool)).execute({}, ctx)
      expect(getResult.metadata.nodeIds).toContain(nodeId)
      expect(getResult.metadata.contextIds).toContain(contextId)

      yield* (yield* Tool.init(removeTool)).execute({ nodeIds: [nodeId] }, ctx)
      const afterRemove = yield* (yield* Tool.init(getTool)).execute({}, ctx)
      expect(afterRemove.metadata.nodeIds).not.toContain(nodeId)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("apply and clear queued changes", () =>
    Effect.gen(function* () {
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const applyTool = yield* GraphAgentDesignTools.DesignApplyChangesTool
      const clearTool = yield* GraphAgentDesignTools.DesignClearChangesTool
      const findTool = yield* DesignFindConceptsTool
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string

      yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)

      const before = yield* (yield* Tool.init(findTool)).execute({ query: "船" }, ctx)
      expect(before.metadata.count).toBe(1)

      yield* (yield* Tool.init(applyTool)).execute({}, ctx)

      const design = yield* Design.Service
      const nodes = yield* design.listNodes()
      expect(nodes.some((n) => n.name === "船")).toBe(true)

      yield* (yield* Tool.init(nodeTool)).execute({ name: "生命值", context: contextId }, ctx)
      yield* (yield* Tool.init(clearTool)).execute({}, ctx)

      const afterClear = yield* (yield* Tool.init(findTool)).execute({ query: "生命值" }, ctx)
      expect(afterClear.metadata.count).toBe(0)
    }).pipe(Effect.provide(provideDesign)),
  )
})
