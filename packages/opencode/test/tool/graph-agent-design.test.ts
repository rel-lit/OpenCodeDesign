import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer, Queue } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import { GraphAgentDesignTools } from "../../src/tool/design"
import { DesignGetContextTool, DesignGetConceptTool, DesignListPrototypesTool } from "../../src/tool/design"
import { Tool } from "@/tool/tool"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "../../src/session/schema"
import { testInstanceStoreLayer, provideInstanceEffect, TestInstance } from "../fixture/fixture"
import { InstanceStore } from "../../src/project/instance-store"
import { Question } from "../../src/question"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { GraphAgent } from "../../src/design/agent/types"

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

const provideDesign = LayerNode.compile(
  LayerNode.group([
    Truncate.node,
    Agent.node,
    Design.node,
    Question.node,
    EventV2Bridge.node,
  ]),
)

const pendingQuestion = Effect.fn("GraphAgentDesignTest.pendingQuestion")(function* (question: Question.Interface) {
  const events = yield* EventV2Bridge.Service
  const asked = yield* Queue.unbounded<void>()
  const off = yield* events.listen((event) => {
    if (event.type === Question.Event.Asked.type) Queue.offerUnsafe(asked, undefined)
    return Effect.void
  })
  yield* Effect.addFinalizer(() => off)

  for (;;) {
    const items = yield* question.list()
    const item = items[0]
    if (item) return item
    yield* Queue.take(asked).pipe(Effect.timeout("2 seconds"))
  }
})

const findAccumulatedNodeIdByName = (design: Design.Interface, sessionID: string, name: string) =>
  Effect.gen(function* () {
    const operations = yield* design.bufferListOperations(sessionID)
    const op = operations.find(
      (o) =>
        o.type === "create_node" &&
        ((o.payload as { name?: string }).name === name ||
          (o.payload as { aliases?: string[] }).aliases?.includes(name)),
    )
    const id = (op?.payload as { id?: string }).id
    if (!id) throw new Error(`Node not found: ${name}`)
    return id
  })

describe("GraphAgent internal design tools", () => {
  it.instance("define_context and define_concept", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const searchTool = yield* GraphAgentDesignTools.DesignSearchGraphTool
      const ctx = makeCtx()

      const ctxResult = yield* (yield* Tool.init(ctxTool)).execute({ name: "战斗系统" }, ctx)
      const contextId = ctxResult.metadata.contextId as string

      const nodeResult = yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)
      expect(nodeResult.output).toContain("船")

      yield* design.bufferApply(ctx.sessionID)

      const searchResult = yield* (yield* Tool.init(searchTool)).execute({ query: "船" }, ctx)
      expect(searchResult.metadata.matchCount).toBe(1)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("search_graph adds matches to temporary working set", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const searchTool = yield* GraphAgentDesignTools.DesignSearchGraphTool
      const twsTool = yield* GraphAgentDesignTools.DesignGetTemporaryWorkingSetTool
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string
      yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)

      yield* design.bufferApply(ctx.sessionID)

      yield* (yield* Tool.init(searchTool)).execute({ query: "船" }, ctx)
      const tws = yield* (yield* Tool.init(twsTool)).execute({}, ctx)
      expect(tws.output).toContain("船")
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("expand_node returns neighbors and updates working set", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const protoTool = yield* GraphAgentDesignTools.DesignDefineRelationPrototypeTool
      const relateTool = yield* GraphAgentDesignTools.DesignRelateConceptsTool
      const expandTool = yield* GraphAgentDesignTools.DesignExpandNodeTool
      const twsTool = yield* GraphAgentDesignTools.DesignGetTemporaryWorkingSetTool
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string
      yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)
      yield* (yield* Tool.init(nodeTool)).execute({ name: "海", context: contextId }, ctx)
      yield* (yield* Tool.init(protoTool)).execute({ name: "关联" }, ctx)

      yield* (yield* Tool.init(relateTool)).execute({ left: "船", right: "海", relation: "关联" }, ctx)

      yield* design.bufferApply(ctx.sessionID)

      const expandResult = yield* (yield* Tool.init(expandTool)).execute({ name_or_id: "船" }, ctx)
      expect(expandResult.output).toContain("海")
      const tws = yield* (yield* Tool.init(twsTool)).execute({}, ctx)
      expect(tws.output).toContain("海")
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("context create and get", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const createTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const getTool = yield* DesignGetContextTool
      const ctx = makeCtx()

      const created = yield* (yield* Tool.init(createTool)).execute({ name: "战斗系统" }, ctx)
      const contextId = created.metadata.contextId as string

      yield* design.bufferApply(ctx.sessionID)

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
      const searchTool = yield* GraphAgentDesignTools.DesignSearchGraphTool
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string

      yield* (yield* Tool.init(nodeTool)).execute(
        { name: "船", context: contextId, aliases: ["飞船"] },
        ctx,
      )
      const nodeId = yield* findAccumulatedNodeIdByName(design, ctx.sessionID, "船")

      yield* design.bufferApply(ctx.sessionID)

      const getResult = yield* (yield* Tool.init(getTool)).execute({ name_or_id: nodeId }, ctx)
      expect(getResult.output).toContain("飞船")

      const updateResult = yield* (yield* Tool.init(updateTool)).execute(
        { concept: nodeId, semantics: "玩家载具" },
        ctx,
      )
      expect(updateResult.output).toContain("queued for update")

      yield* design.bufferApply(ctx.sessionID)

      const getAfterUpdate = yield* (yield* Tool.init(getTool)).execute({ name_or_id: nodeId }, ctx)
      expect(getAfterUpdate.output).toContain("玩家载具")

      const searchResult = yield* (yield* Tool.init(searchTool)).execute({ query: "飞船" }, ctx)
      expect(searchResult.metadata.matchCount).toBe(1)

      yield* (yield* Tool.init(deleteTool)).execute({ concept: nodeId, cascade: true }, ctx)

      yield* design.bufferApply(ctx.sessionID)

      const getAfterDelete = yield* (yield* Tool.init(getTool)).execute({ name_or_id: nodeId }, ctx)
      expect(getAfterDelete.output).toContain("No concept")
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("relation update and delete", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const protoTool = yield* GraphAgentDesignTools.DesignDefineRelationPrototypeTool
      const relateTool = yield* GraphAgentDesignTools.DesignRelateConceptsTool
      const deleteTool = yield* GraphAgentDesignTools.DesignWithdrawRelationTool
      const getTool = yield* DesignGetConceptTool
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string
      yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)
      yield* (yield* Tool.init(nodeTool)).execute({ name: "生命值", context: contextId }, ctx)
      yield* (yield* Tool.init(protoTool)).execute({ name: "aggregate" }, ctx)

      yield* (yield* Tool.init(relateTool)).execute(
        { left: "船", right: "生命值", relation: "aggregate" },
        ctx,
      )

      yield* design.bufferApply(ctx.sessionID)

      const updateResult = yield* (yield* Tool.init(relateTool)).execute(
        { left: "船", right: "生命值", relation: "aggregate", constraints: { max: 100 } },
        ctx,
      )
      expect(updateResult.output).toContain("aggregate")

      yield* design.bufferApply(ctx.sessionID)

      yield* (yield* Tool.init(deleteTool)).execute({ left: "船", right: "生命值" }, ctx)

      yield* design.bufferApply(ctx.sessionID)

      const getResult = yield* (yield* Tool.init(getTool)).execute({ name_or_id: "船" }, ctx)
      expect(getResult.output).toContain("Relations:")
      expect(getResult.output).not.toContain("生命值")
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("prototype create and list", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const createTool = yield* GraphAgentDesignTools.DesignDefineRelationPrototypeTool
      const listTool = yield* DesignListPrototypesTool
      const ctx = makeCtx()

      const created = yield* (yield* Tool.init(createTool)).execute(
        { name: "组合" },
        ctx,
      )
      const prototypeId = created.metadata.prototypeId as string

      yield* design.bufferApply(ctx.sessionID)

      const listResult = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(listResult.output).toContain("组合")
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("temporary working set initializes from active set", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const twsTool = yield* GraphAgentDesignTools.DesignGetTemporaryWorkingSetTool
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string
      yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)
      yield* design.bufferApply(ctx.sessionID)

      const tws = yield* (yield* Tool.init(twsTool)).execute({}, ctx)
      expect(tws.output).toContain("系统")
      expect(tws.output).toContain("船")
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("finalize change applies accumulated changes on approve", () =>
    Effect.gen(function* () {
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const finalizeTool = yield* GraphAgentDesignTools.DesignFinalizeChangeTool
      const ctx = makeCtx()
      const design = yield* Design.Service
      const question = yield* Question.Service

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string
      yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)

      const fiber = yield* (yield* Tool.init(finalizeTool)).execute({}, ctx).pipe(Effect.forkScoped)
      const item = yield* pendingQuestion(question)
      expect(item.questions[0]?.question).toContain("[design-finalize]")
      yield* question.reply({ requestID: item.id, answers: [["Approve"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.applied).toBe(true)
      expect(result.metadata.result).toBe("applied")
      expect(Array.isArray(result.metadata.questions)).toBe(true)
      expect(Array.isArray(result.metadata.answers)).toBe(true)

      const nodes = yield* design.listNodes()
      expect(nodes.some((n) => n.name === "船")).toBe(true)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("finalize change abandons accumulated changes", () =>
    Effect.gen(function* () {
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const finalizeTool = yield* GraphAgentDesignTools.DesignFinalizeChangeTool
      const ctx = makeCtx()
      const design = yield* Design.Service
      const question = yield* Question.Service

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string
      yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)

      const fiber = yield* (yield* Tool.init(finalizeTool)).execute({}, ctx).pipe(Effect.forkScoped)
      const item = yield* pendingQuestion(question)
      yield* question.reply({ requestID: item.id, answers: [["Abandon"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.abandoned).toBe(true)

      const nodes = yield* design.listNodes()
      expect(nodes.some((n) => n.name === "船")).toBe(false)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("finalize change returns revision signal", () =>
    Effect.gen(function* () {
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const finalizeTool = yield* GraphAgentDesignTools.DesignFinalizeChangeTool
      const ctx = makeCtx()
      const question = yield* Question.Service

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string
      yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)

      const fiber = yield* (yield* Tool.init(finalizeTool)).execute({}, ctx).pipe(Effect.forkScoped)
      const item = yield* pendingQuestion(question)
      yield* question.reply({ requestID: item.id, answers: [["Revise", "add more semantics"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.revision).toBe(true)
      expect(result.metadata.revisionText).toBe("add more semantics")
      expect(result.metadata.result).toBe("revision")
      expect(Array.isArray(result.metadata.questions)).toBe(true)
      expect(Array.isArray(result.metadata.answers)).toBe(true)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("request approval returns metadata for first-stage approval", () =>
    Effect.gen(function* () {
      const approvalTool = yield* GraphAgentDesignTools.DesignRequestApprovalTool
      const ctx = makeCtx()
      const question = yield* Question.Service

      const fiber = yield* (yield* Tool.init(approvalTool))
        .execute({ summary: "新增船战系统核心概念" }, ctx)
        .pipe(Effect.forkScoped)
      const item = yield* pendingQuestion(question)
      expect(item.questions[0]?.question).toContain("[design-approval]")
      yield* question.reply({ requestID: item.id, answers: [["Approve"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.result).toBe("approve")
      expect(Array.isArray(result.metadata.questions)).toBe(true)
      expect(Array.isArray(result.metadata.answers)).toBe(true)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("request approval uses force option when has_issues is true", () =>
    Effect.gen(function* () {
      const approvalTool = yield* GraphAgentDesignTools.DesignRequestApprovalTool
      const ctx = makeCtx()
      const question = yield* Question.Service

      const fiber = yield* (yield* Tool.init(approvalTool))
        .execute({ summary: "有问题的变更", warnings: "发现孤立节点", has_issues: true }, ctx)
        .pipe(Effect.forkScoped)
      const item = yield* pendingQuestion(question)
      expect(item.questions[0]?.options.some((o) => o.label === "Force")).toBe(true)
      yield* question.reply({ requestID: item.id, answers: [["Force"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.result).toBe("force")
    }).pipe(Effect.provide(provideDesign)),
  )

  test("output type accepts change-forced", () => {
    const output: GraphAgent.Output = {
      type: "change-forced",
      summary: "用户强制推进后应用了变更",
      appliedChange: {
        version: 1,
        affectedNodes: ["节点 A"],
        affectedEdges: [],
        affectedContexts: ["上下文 A"],
        affectedPrototypes: [],
        operations: [],
        summary: "在 Force 模式下过滤了矛盾边后应用",
      },
    }
    expect(output.type).toBe("change-forced")
  })

  test("output type rejects obsolete needs-clarification", () => {
    const output = {
      type: "needs-clarification" as unknown as GraphAgent.Output["type"],
      summary: "不应被接受",
    } as GraphAgent.Output
    expect(output.type).not.toBe("change-applied" as const)
    expect(output.type).not.toBe("change-forced" as const)
  })

  it.instance("apply and clear queued changes via service", () =>
    Effect.gen(function* () {
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const searchTool = yield* GraphAgentDesignTools.DesignSearchGraphTool
      const ctx = makeCtx()
      const design = yield* Design.Service

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string

      yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)

      yield* design.bufferApply(ctx.sessionID)

      const before = yield* (yield* Tool.init(searchTool)).execute({ query: "船" }, ctx)
      expect(before.metadata.matchCount).toBe(1)

      const nodes = yield* design.listNodes()
      expect(nodes.some((n) => n.name === "船")).toBe(true)

      yield* (yield* Tool.init(nodeTool)).execute({ name: "生命值", context: contextId }, ctx)
      yield* design.bufferClear(ctx.sessionID)

      const afterClear = yield* (yield* Tool.init(searchTool)).execute({ query: "生命值" }, ctx)
      expect(afterClear.metadata.matchCount).toBe(0)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("relate_concepts treats edge as undirected and updates pending edge", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const protoTool = yield* GraphAgentDesignTools.DesignDefineRelationPrototypeTool
      const relateTool = yield* GraphAgentDesignTools.DesignRelateConceptsTool
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string
      yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)
      yield* (yield* Tool.init(nodeTool)).execute({ name: "海", context: contextId }, ctx)
      yield* (yield* Tool.init(protoTool)).execute({ name: "关联" }, ctx)

      yield* (yield* Tool.init(relateTool)).execute({ left: "船", right: "海", relation: "关联" }, ctx)
      yield* (yield* Tool.init(relateTool)).execute({ left: "海", right: "船", relation: "关联" }, ctx)

      const operations = yield* design.bufferListOperations(ctx.sessionID)
      const createEdgeOps = operations.filter((o) => o.type === "create_edge")
      const updateEdgeOps = operations.filter((o) => o.type === "update_edge")
      expect(createEdgeOps.length).toBe(1)
      expect(updateEdgeOps.length).toBe(1)

      yield* design.bufferApply(ctx.sessionID)
      const state = yield* design.getState()
      expect(state.edges.length).toBe(1)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("finalize change resolves pending node names after partial edge undo", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
      const protoTool = yield* GraphAgentDesignTools.DesignDefineRelationPrototypeTool
      const relateTool = yield* GraphAgentDesignTools.DesignRelateConceptsTool
      const undoTool = yield* GraphAgentDesignTools.DesignUndoBufferOperationTool
      const finalizeTool = yield* GraphAgentDesignTools.DesignFinalizeChangeTool
      const question = yield* Question.Service
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string
      yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)
      yield* (yield* Tool.init(nodeTool)).execute({ name: "海", context: contextId }, ctx)
      yield* (yield* Tool.init(protoTool)).execute({ name: "关联" }, ctx)

      yield* (yield* Tool.init(relateTool)).execute({ left: "船", right: "海", relation: "关联" }, ctx)
      const second = yield* (yield* Tool.init(relateTool)).execute({ left: "海", right: "船", relation: "关联" }, ctx)

      yield* (yield* Tool.init(undoTool)).execute({ operation_id: second.metadata.operationId as string }, ctx)

      const fiber = yield* (yield* Tool.init(finalizeTool)).execute({}, ctx).pipe(Effect.forkScoped)
      const item = yield* pendingQuestion(question)
      const questionText = item.questions[0]?.question ?? ""
      expect(questionText).toContain("船")
      expect(questionText).toContain("海")
      expect(questionText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)

      yield* question.reply({ requestID: item.id, answers: [["Abandon"]] })
      yield* Fiber.join(fiber)
    }).pipe(Effect.provide(provideDesign)),
  )

  it.instance("active working set persists across instance disposal", () =>
    Effect.gen(function* () {
      const testInstance = yield* TestInstance
      const directory = testInstance.directory

      const designLayer = LayerNode.compile(Design.node)
      const designLayerLive = Layer.merge(designLayer, Layer.succeed(Agent.Service, yield* Agent.Service))

      const first = yield* provideInstanceEffect(directory)(
        Effect.gen(function* () {
          const design = yield* Design.Service
          const ctxTool = yield* GraphAgentDesignTools.DesignDefineContextTool
          const nodeTool = yield* GraphAgentDesignTools.DesignDefineConceptTool
          const ctx = makeCtx()

          const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
          const contextId = c.metadata.contextId as string
          yield* (yield* Tool.init(nodeTool)).execute({ name: "船", context: contextId }, ctx)
          yield* design.bufferApply(ctx.sessionID)

          const ws = yield* design.listWorkingSet()
          expect(ws.some((e) => e.name === "船" && e.type === "node")).toBe(true)
          return ws
        }).pipe(Effect.provide(designLayerLive)),
      )

      yield* InstanceStore.Service.use((store) => store.disposeDirectory(directory))

      const restored = yield* provideInstanceEffect(directory)(
        Effect.gen(function* () {
          const design = yield* Design.Service
          return yield* design.listWorkingSet()
        }).pipe(Effect.provide(designLayerLive)),
      )

      expect(restored.some((e) => e.name === "船" && e.type === "node")).toBe(true)
      expect(restored.some((e) => e.name === "系统" && e.type === "context")).toBe(true)
    }).pipe(Effect.provide(provideDesign)),
  )
})
