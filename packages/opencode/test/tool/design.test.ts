import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import {
  DesignCreateContextTool,
  DesignCreateEdgeTool,
  DesignCreateNodeTool,
  DesignListNodesTool,
  DesignResolveReferenceTool,
} from "../../src/tool/design"
import { Tool } from "@/tool/tool"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "../../src/session/schema"

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

const it = testEffect(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, Design.defaultLayer))

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
})
