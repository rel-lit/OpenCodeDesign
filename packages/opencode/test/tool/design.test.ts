import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import { DesignTypes } from "../../src/design/core/types"
import * as GraphAgentTypes from "../../src/design/agent/types"
import { GraphAgent } from "../../src/design/agent/graph"
import { DesignStore } from "../../src/design/store/store"
import { ApprovalPanel } from "../../src/design/approval-panel"
import {
  DesignActivateContextTool,
  DesignActivateNodeTool,
  DesignCreateContextTool,
  DesignCreateEdgeTool,
  DesignCreateNodeTool,
  DesignCreatePrototypeTool,
  DesignDeleteEdgeTool,
  DesignDeleteNodeTool,
  DesignFindNodesByNameTool,
  DesignGetContextTool,
  DesignGetNodeTool,
  DesignGetPrototypeTool,
  DesignGetStateTool,
  DesignListContextsTool,
  DesignListEdgesTool,
  DesignListNodesTool,
  DesignListPrototypesTool,
  DesignResolveReferenceTool,
  DesignRetireNodeTool,
  DesignShowWorkingSetTool,
  DesignUpdateContextTool,
  DesignUpdateEdgeTool,
  DesignUpdateNodeTool,
} from "../../src/tool/design"
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

describe("Design tools", () => {
  it.instance("create_context and create_node", () =>
    Effect.gen(function* () {
      const ctxTool = yield* DesignCreateContextTool
      const nodeTool = yield* DesignCreateNodeTool
      const ctx = makeCtx()

      const ctxResult = yield* (yield* Tool.init(ctxTool)).execute({ name: "战斗系统" }, ctx)
      const contextId = ctxResult.metadata.contextId as string

      const nodeResult = yield* (yield* Tool.init(nodeTool)).execute({ name: "船", contextId }, ctx)
      expect(nodeResult.output).toContain("船")
    }),
  )

  it.instance("resolve_reference auto-creates missing concept", () =>
    Effect.gen(function* () {
      const tool = yield* DesignResolveReferenceTool
      const ctx = makeCtx()
      const result = yield* (yield* Tool.init(tool)).execute({ reference: "生命值" }, ctx)
      expect(result.metadata.action).toBe("created")
    }),
  )

  it.instance("create_edge links two nodes", () =>
    Effect.gen(function* () {
      const resolveTool = yield* DesignResolveReferenceTool
      const edgeTool = yield* DesignCreateEdgeTool
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

  it.instance("list_nodes returns created nodes", () =>
    Effect.gen(function* () {
      const resolveTool = yield* DesignResolveReferenceTool
      const listTool = yield* DesignListNodesTool
      const ctx = makeCtx()

      yield* (yield* Tool.init(resolveTool)).execute({ reference: "船" }, ctx)
      const result = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(result.output).toContain("船")
      expect(result.metadata.count).toBe(1)
    }),
  )

  it.instance("context CRUD", () =>
    Effect.gen(function* () {
      const createTool = yield* DesignCreateContextTool
      const listTool = yield* DesignListContextsTool
      const getTool = yield* DesignGetContextTool
      const updateTool = yield* DesignUpdateContextTool
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
      const ctxTool = yield* DesignCreateContextTool
      const nodeTool = yield* DesignCreateNodeTool
      const getTool = yield* DesignGetNodeTool
      const updateTool = yield* DesignUpdateNodeTool
      const retireTool = yield* DesignRetireNodeTool
      const deleteTool = yield* DesignDeleteNodeTool
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
      const edgeTool = yield* DesignCreateEdgeTool
      const updateTool = yield* DesignUpdateEdgeTool
      const deleteTool = yield* DesignDeleteEdgeTool
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
      const createTool = yield* DesignCreatePrototypeTool
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

  it.instance("working set activation", () =>
    Effect.gen(function* () {
      const ctxTool = yield* DesignCreateContextTool
      const nodeTool = yield* DesignCreateNodeTool
      const activateCtxTool = yield* DesignActivateContextTool
      const activateNodeTool = yield* DesignActivateNodeTool
      const showTool = yield* DesignShowWorkingSetTool
      const ctx = makeCtx()

      const c = yield* (yield* Tool.init(ctxTool)).execute({ name: "系统" }, ctx)
      const contextId = c.metadata.contextId as string

      const node = yield* (yield* Tool.init(nodeTool)).execute({ name: "船", contextId }, ctx)
      const nodeId = node.metadata.nodeId as string

      yield* (yield* Tool.init(activateCtxTool)).execute({ contextId }, ctx)
      yield* (yield* Tool.init(activateNodeTool)).execute({ nodeId }, ctx)

      const showResult = yield* (yield* Tool.init(showTool)).execute({}, ctx)
      expect(showResult.output).toContain(contextId)
      expect(showResult.output).toContain(nodeId)
    }),
  )

  it.instance("get_state returns full graph", () =>
    Effect.gen(function* () {
      const resolveTool = yield* DesignResolveReferenceTool
      const stateTool = yield* DesignGetStateTool
      const ctx = makeCtx()

      yield* (yield* Tool.init(resolveTool)).execute({ reference: "船" }, ctx)
      const result = yield* (yield* Tool.init(stateTool)).execute({}, ctx)
      expect((result.metadata.state as DesignTypes.GraphState).nodes.length).toBe(1)
    }),
  )

  it.instance("proposeChanges routes multi-operation delta through GraphAgent analyze and execute after approval", () =>
    Effect.gen(function* () {
      const analyzed: GraphAgentTypes.Input[] = []
      const executed: GraphAgentTypes.Output[] = []

      const trackingMockGraphAgent = GraphAgent.Service.of({
        analyze: (input) => {
          analyzed.push(input)
          return Effect.succeed({
            type: "change-proposal" as const,
            summary: "multi-op",
            affectedNodes: ["node-existing", "node-new"],
            affectedEdges: [],
            delta: input.proposedChange,
          })
        },
        execute: (proposal) => {
          executed.push(proposal)
          return Effect.succeed({ ...proposal, type: "change-applied" as const })
        },
      })

      const trackingLayer = Design.layer({ makeApprovalPanel: autoConfirmPanel }).pipe(
        Layer.provide(DesignStore.defaultLayer),
        Layer.provide(Layer.succeed(GraphAgent.Service, trackingMockGraphAgent)),
      )

      const result = yield* Effect.gen(function* () {
        const design = yield* Design.Service
        yield* design.createContext({ id: "ctx-core", name: "Core" })
        yield* design.createNode({ id: "node-existing", name: "Existing", contextId: "ctx-core" })

        const delta: GraphAgentTypes.GraphDelta = {
          addNodes: [{
            id: "node-new",
            name: "NewNode",
            contextId: "ctx-core",
            kind: "node",
            aliases: [],
            defaultSemantics: "",
            connectedEdges: [],
            createdAt: 0,
            updatedAt: 0,
            retired: false,
          }],
          updateNodes: [{ id: "node-existing", patch: { name: "Renamed" } }],
        }

        return yield* design.proposeChanges(delta)
      }).pipe(Effect.provide(trackingLayer))

      expect(analyzed.length).toBe(1)
      expect(analyzed[0].proposedChange).toEqual({
        addNodes: [{
          id: "node-new",
          name: "NewNode",
          contextId: "ctx-core",
          kind: "node",
          aliases: [],
          defaultSemantics: "",
          connectedEdges: [],
          createdAt: 0,
          updatedAt: 0,
          retired: false,
        }],
        updateNodes: [{ id: "node-existing", patch: { name: "Renamed" } }],
      })
      expect(executed.length).toBe(1)
      expect(executed[0].type).toBe("change-proposal")
      expect(result.type).toBe("change-applied")
    }),
  )

  it.instance("create_node tool bumps graph version via proposeChanges", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const ctxTool = yield* DesignCreateContextTool
      const nodeTool = yield* DesignCreateNodeTool
      const ctx = makeCtx()

      const ctxResult = yield* (yield* Tool.init(ctxTool)).execute({ name: "VersionCtx" }, ctx)
      const contextId = ctxResult.metadata.contextId as string

      const before = yield* design.getCurrentVersion()

      yield* (yield* Tool.init(nodeTool)).execute({ name: "VersionNode", contextId }, ctx)

      const after = yield* design.getCurrentVersion()
      expect(after.sequence).toBe(before.sequence + 1)
    }),
  )
})
