import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import { GraphAgentDesignTools } from "../../src/tool/design"
import {
  DesignFindNodesByNameTool,
  DesignGetContextTool,
  DesignGetNodeTool,
  DesignGetPrototypeTool,
  DesignListContextsTool,
  DesignListEdgesTool,
  DesignListNodesTool,
  DesignListPrototypesTool,
  DesignResolveReferenceTool,
} from "../../src/tool/design"
import { DesignStore } from "../../src/design/store/store"
import { ApprovalPanel } from "../../src/design/approval-panel"
import { GraphAgent } from "../../src/design/agent/graph"
import { Tool } from "@/tool/tool"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "../../src/session/schema"

const autoConfirmPanel = (): ApprovalPanel.Interface => {
  const panel = ApprovalPanel.make()
  const originalPropose = panel.propose
  return {
    ...panel,
    propose: (proposal) => {
      originalPropose(proposal)
      panel.confirm()
    },
  }
}

const mockGraphAgentLayer = Layer.succeed(
  GraphAgent.Service,
  GraphAgent.Service.of({
    analyze: (input) =>
      Effect.succeed({
        type: "change-proposal" as const,
        summary: "proposed",
        affectedNodes: [],
        affectedEdges: [],
        delta: input.proposedChange,
      }),
    execute: (proposal) =>
      Effect.gen(function* () {
        const design = yield* Design.Service
        const delta = proposal.delta
        if (!delta) return { ...proposal, type: "change-applied" as const }
        yield* design.applyRawDelta(delta)
        yield* design.bumpVersion("chat-agent")
        return { ...proposal, type: "change-applied" as const }
      }),
  }),
)

const testDesignLayer = Design.layer({ makeApprovalPanel: autoConfirmPanel }).pipe(
  Layer.provide(DesignStore.defaultLayer),
  Layer.provide(mockGraphAgentLayer),
)

const makeCtx = () => ({
  sessionID: SessionID.descending(),
  messageID: MessageID.ascending(),
  agent: "design",
  abort: new AbortController().signal,
  messages: [],
  metadata() {
    return Effect.void
  },
  ask() {
    return Effect.void
  },
})

const it = testEffect(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, testDesignLayer))

describe("GraphAgent internal design tools", () => {
  it.instance("create_context and create_node", () =>
    Effect.gen(function* () {
      const ctxTool = yield* GraphAgentDesignTools.DesignCreateContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignCreateNodeTool
      const ctx = makeCtx()

      const ctxResult = yield* (yield* Tool.init(ctxTool)).execute({ name: "战斗系统" }, ctx)
      const contextId = ctxResult.metadata.contextId as string

      const nodeResult = yield* (yield* Tool.init(nodeTool)).execute({ name: "船", contextId }, ctx)
      expect(nodeResult.output).toContain("船")
    }),
  )

  it.instance("create_edge links two nodes", () =>
    Effect.gen(function* () {
      const resolveTool = yield* DesignResolveReferenceTool
      const edgeTool = yield* GraphAgentDesignTools.DesignCreateEdgeTool
      const ctx = makeCtx()

      const ship = yield* (yield* Tool.init(resolveTool)).execute({ reference: "船" }, ctx)
      const hp = yield* (yield* Tool.init(resolveTool)).execute({ reference: "生命值" }, ctx)

      const edgeResult = yield* (yield* Tool.init(edgeTool)).execute(
        {
          leftNodeId: ship.metadata.nodeId as string,
          rightNodeId: hp.metadata.nodeId as string,
          prototypeId: "aggregate",
          parameters: { 上限: 1000 },
        },
        ctx,
      )
      expect(edgeResult.output).toContain("aggregate")
    }),
  )

  it.instance("context CRUD", () =>
    Effect.gen(function* () {
      const createTool = yield* GraphAgentDesignTools.DesignCreateContextTool
      const listTool = yield* DesignListContextsTool
      const getTool = yield* DesignGetContextTool
      const updateTool = yield* GraphAgentDesignTools.DesignUpdateContextTool
      const ctx = makeCtx()

      const created = yield* (yield* Tool.init(createTool)).execute({ name: "战斗系统" }, ctx)
      const contextId = created.metadata.contextId as string

      const listResult = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(listResult.output).toContain("战斗系统")

      const getResult = yield* (yield* Tool.init(getTool)).execute({ id: contextId }, ctx)
      expect(getResult.output).toContain(contextId)

      const updateResult = yield* (yield* Tool.init(updateTool)).execute({ id: contextId, name: "战斗核心" }, ctx)
      expect(updateResult.output).toContain("战斗核心")
    }),
  )

  it.instance("node CRUD including retire and delete", () =>
    Effect.gen(function* () {
      const ctxTool = yield* GraphAgentDesignTools.DesignCreateContextTool
      const nodeTool = yield* GraphAgentDesignTools.DesignCreateNodeTool
      const getTool = yield* DesignGetNodeTool
      const updateTool = yield* GraphAgentDesignTools.DesignUpdateNodeTool
      const retireTool = yield* GraphAgentDesignTools.DesignRetireNodeTool
      const deleteTool = yield* GraphAgentDesignTools.DesignDeleteNodeTool
      const findTool = yield* DesignFindNodesByNameTool
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string

      const node = yield* (yield* Tool.init(nodeTool)).execute(
        { name: "船", contextId, aliases: ["飞船"] },
        ctx,
      )
      const nodeId = node.metadata.nodeId as string

      const getResult = yield* (yield* Tool.init(getTool)).execute({ id: nodeId }, ctx)
      expect(getResult.output).toContain("飞船")

      const updateResult = yield* (yield* Tool.init(updateTool)).execute(
        { id: nodeId, defaultSemantics: "玩家载具" },
        ctx,
      )
      expect(updateResult.output).toContain("玩家载具")

      const findResult = yield* (yield* Tool.init(findTool)).execute({ name: "飞船" }, ctx)
      expect(findResult.metadata.count).toBe(1)

      yield* (yield* Tool.init(retireTool)).execute({ id: nodeId, retired: true }, ctx)
      const getAfterRetire = yield* (yield* Tool.init(getTool)).execute({ id: nodeId }, ctx)
      expect((getAfterRetire.metadata.node as { retired: boolean }).retired).toBe(true)

      yield* (yield* Tool.init(deleteTool)).execute({ id: nodeId }, ctx)
      const getAfterDelete = yield* (yield* Tool.init(getTool)).execute({ id: nodeId }, ctx)
      expect(getAfterDelete.output).toContain("No node")
    }),
  )

  it.instance("edge update and delete", () =>
    Effect.gen(function* () {
      const resolveTool = yield* DesignResolveReferenceTool
      const edgeTool = yield* GraphAgentDesignTools.DesignCreateEdgeTool
      const updateTool = yield* GraphAgentDesignTools.DesignUpdateEdgeTool
      const deleteTool = yield* GraphAgentDesignTools.DesignDeleteEdgeTool
      const listTool = yield* DesignListEdgesTool
      const ctx = makeCtx()

      const ship = yield* (yield* Tool.init(resolveTool)).execute({ reference: "船" }, ctx)
      const hp = yield* (yield* Tool.init(resolveTool)).execute({ reference: "生命值" }, ctx)
      const leftNodeId = ship.metadata.nodeId as string
      const rightNodeId = hp.metadata.nodeId as string

      yield* (yield* Tool.init(edgeTool)).execute(
        { leftNodeId, rightNodeId, prototypeId: "aggregate" },
        ctx,
      )

      const updateResult = yield* (yield* Tool.init(updateTool)).execute(
        { leftNodeId, rightNodeId, parameters: { max: 100 } },
        ctx,
      )
      expect(updateResult.output).toContain("aggregate")

      yield* (yield* Tool.init(deleteTool)).execute({ leftNodeId, rightNodeId }, ctx)
      const listResult = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(listResult.metadata.count).toBe(0)
    }),
  )

  it.instance("prototype CRUD", () =>
    Effect.gen(function* () {
      const createTool = yield* GraphAgentDesignTools.DesignCreatePrototypeTool
      const listTool = yield* DesignListPrototypesTool
      const getTool = yield* DesignGetPrototypeTool
      const ctx = makeCtx()

      const created = yield* (yield* Tool.init(createTool)).execute(
        { id: "compose", name: "组合" },
        ctx,
      )
      const prototypeId = created.metadata.prototypeId as string

      const listResult = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(listResult.output).toContain("组合")

      const getResult = yield* (yield* Tool.init(getTool)).execute({ id: prototypeId }, ctx)
      expect(getResult.output).toContain(prototypeId)
    }),
  )
})
