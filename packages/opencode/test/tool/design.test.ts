import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
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
  DesignFindNodesByNameTool,
  DesignGetContextTool,
  DesignGetNodeTool,
  DesignGetPrototypeTool,
  DesignGetStateTool,
  DesignListContextsTool,
  DesignListEdgesTool,
  DesignListNodesTool,
  DesignListPrototypesTool,
  DesignProposeChangeTool,
  DesignResolveReferenceTool,
  DesignShowWorkingSetTool,
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

const makeNodeDelta = (contextId: string, name: string, id: string): GraphAgentTypes.GraphDelta => ({
  addNodes: [{
    id,
    name,
    contextId,
    kind: "node",
    aliases: [],
    defaultSemantics: "",
  }],
})

  it.instance("propose_change rejects unknown delta field names", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const tool = yield* DesignProposeChangeTool
      const ctx = makeCtx()

      yield* design.createContext({ id: "ctx-core", name: "Core" })

      const exit = yield* Effect.exit((yield* Tool.init(tool)).execute(
        { delta: { edges: [{ leftNodeId: "a", rightNodeId: "b", prototypeId: "depend" }] } as unknown as GraphAgentTypes.GraphDelta },
        ctx,
      ))

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.instance("propose_change accepts only exact delta field names", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const tool = yield* DesignProposeChangeTool
      const listTool = yield* DesignListNodesTool
      const ctx = makeCtx()

      yield* design.createContext({ id: "ctx-core", name: "Core" })

      yield* (yield* Tool.init(tool)).execute(
        { delta: { addNodes: [{ name: "InventoryService", contextId: "ctx-core", id: "inv" }] } },
        ctx,
      )

      const result = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(result.output).toContain("InventoryService")
    }),
  )

describe("Design tools", () => {
  it.instance("propose_change creates nodes", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const tool = yield* DesignProposeChangeTool
      const listTool = yield* DesignListNodesTool
      const ctx = makeCtx()

      const context = yield* design.createContext({ id: "ctx-core", name: "Core" })

      yield* (yield* Tool.init(tool)).execute(
        { delta: makeNodeDelta(context.id, "船", "node-ship") },
        ctx,
      )

      const result = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(result.output).toContain("船")
      expect(result.metadata.count).toBe(1)
    }),
  )

  it.instance("propose_change updates and deletes nodes", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const tool = yield* DesignProposeChangeTool
      const getTool = yield* DesignGetNodeTool
      const ctx = makeCtx()

      yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* (yield* Tool.init(tool)).execute(
        { delta: makeNodeDelta("ctx-core", "船", "node-ship") },
        ctx,
      )

      yield* (yield* Tool.init(tool)).execute(
        { delta: { updateNodes: [{ id: "node-ship", patch: { name: "飞船" } }] } },
        ctx,
      )
      const updated = yield* (yield* Tool.init(getTool)).execute({ id: "node-ship" }, ctx)
      expect(updated.output).toContain("飞船")

      yield* (yield* Tool.init(tool)).execute(
        { delta: { deleteNodeIds: ["node-ship"] } },
        ctx,
      )
      const deleted = yield* (yield* Tool.init(getTool)).execute({ id: "node-ship" }, ctx)
      expect(deleted.output).toContain("No node")
    }),
  )

  it.instance("propose_change creates, updates and deletes edges", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const tool = yield* DesignProposeChangeTool
      const listTool = yield* DesignListEdgesTool
      const ctx = makeCtx()

      yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* (yield* Tool.init(tool)).execute(
        { delta: makeNodeDelta("ctx-core", "船", "node-ship") },
        ctx,
      )
      yield* (yield* Tool.init(tool)).execute(
        { delta: makeNodeDelta("ctx-core", "生命值", "node-hp") },
        ctx,
      )
      yield* (yield* Tool.init(tool)).execute(
        {
          delta: {
            addEdges: [{
              leftNodeId: "node-ship",
              rightNodeId: "node-hp",
              prototypeId: "aggregate",
              parameters: { max: 1000 },
            }],
          },
        },
        ctx,
      )

      const before = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(before.metadata.count).toBe(1)

      yield* (yield* Tool.init(tool)).execute(
        {
          delta: {
            updateEdges: [{
              leftNodeId: "node-ship",
              rightNodeId: "node-hp",
              patch: { parameters: { max: 2000 } },
            }],
          },
        },
        ctx,
      )

      yield* (yield* Tool.init(tool)).execute(
        { delta: { deleteEdgeKeys: ["node-ship::node-hp"] } },
        ctx,
      )
      const after = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(after.metadata.count).toBe(0)
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

  it.instance("context get and list", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const listTool = yield* DesignListContextsTool
      const getTool = yield* DesignGetContextTool
      const ctx = makeCtx()

      const created = yield* design.createContext({ id: "ctx-battle", name: "战斗系统" })

      const listResult = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(listResult.output).toContain("战斗系统")

      const getResult = yield* (yield* Tool.init(getTool)).execute({ id: created.id }, ctx)
      expect(getResult.output).toContain(created.id)
    }),
  )

  it.instance("node get and find", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const tool = yield* DesignProposeChangeTool
      const getTool = yield* DesignGetNodeTool
      const findTool = yield* DesignFindNodesByNameTool
      const ctx = makeCtx()

      yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* (yield* Tool.init(tool)).execute(
        { delta: makeNodeDelta("ctx-core", "船", "node-ship") },
        ctx,
      )

      const getResult = yield* (yield* Tool.init(getTool)).execute({ id: "node-ship" }, ctx)
      expect(getResult.output).toContain("船")

      const findResult = yield* (yield* Tool.init(findTool)).execute({ name: "船" }, ctx)
      expect(findResult.metadata.count).toBe(1)
    }),
  )

  it.instance("prototype get and list", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const listTool = yield* DesignListPrototypesTool
      const getTool = yield* DesignGetPrototypeTool
      const ctx = makeCtx()

      const created = yield* design.createPrototype({ id: "compose", name: "组合" })

      const listResult = yield* (yield* Tool.init(listTool)).execute({}, ctx)
      expect(listResult.output).toContain("组合")

      const getResult = yield* (yield* Tool.init(getTool)).execute({ id: created.id }, ctx)
      expect(getResult.output).toContain(created.id)
    }),
  )

  it.instance("working set activation", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const tool = yield* DesignProposeChangeTool
      const activateCtxTool = yield* DesignActivateContextTool
      const activateNodeTool = yield* DesignActivateNodeTool
      const showTool = yield* DesignShowWorkingSetTool
      const ctx = makeCtx()

      yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* (yield* Tool.init(tool)).execute(
        { delta: makeNodeDelta("ctx-core", "船", "node-ship") },
        ctx,
      )

      yield* (yield* Tool.init(activateCtxTool)).execute({ contextId: "ctx-core" }, ctx)
      yield* (yield* Tool.init(activateNodeTool)).execute({ nodeId: "node-ship" }, ctx)

      const showResult = yield* (yield* Tool.init(showTool)).execute({}, ctx)
      expect(showResult.output).toContain("ctx-core")
      expect(showResult.output).toContain("node-ship")
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

  it.instance("propose_change tool bumps graph version", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const tool = yield* DesignProposeChangeTool
      const ctx = makeCtx()

      yield* design.createContext({ id: "ctx-version", name: "VersionCtx" })

      const before = yield* design.getCurrentVersion()

      yield* (yield* Tool.init(tool)).execute(
        { delta: makeNodeDelta("ctx-version", "VersionNode", "node-version") },
        ctx,
      )

      const after = yield* design.getCurrentVersion()
      expect(after.sequence).toBe(before.sequence + 1)
    }),
  )
})
