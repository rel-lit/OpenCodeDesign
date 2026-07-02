import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import { GraphAgent } from "../../src/design/agent/graph"
import { DesignStore } from "../../src/design/store/store"

const mockGraphAgentLayer = Layer.succeed(
  GraphAgent.Service,
  GraphAgent.Service.of({
    analyze: () =>
      Effect.succeed({
        type: "enriched-input" as const,
        summary: "补充：UserService 是核心服务",
        affectedNodes: ["node-user"],
        affectedEdges: [],
        structured: {
          suggestions: [{ action: "review", reason: "important" }],
        },
      }),
    execute: () => Effect.die(new Error("execute not expected")),
  }),
)

const designLayer = Design.layer().pipe(
  Layer.provide(DesignStore.defaultLayer),
  Layer.provide(mockGraphAgentLayer),
)

const it = testEffect(designLayer)

describe("Design.Service preprocessInput", () => {
  it.instance("returns processed input with expanded @ references and enriched output", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.init()

      const ctx = yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* design.createNode({ id: "node-user", name: "UserService", contextId: ctx.id })

      const result = yield* design.preprocessInput("修改 @UserService")

      expect(result.processedText).toContain("节点 ID")
      expect(result.temporaryWorkingSet.nodeIds).toContain("node-user")
      expect(result.enriched?.type).toBe("enriched-input")
      expect(result.enriched?.summary).toContain("UserService")
    }),
  )
})
