import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import { DesignAgentLlm } from "../../src/design/agent/llm"
import { GraphAgent } from "../../src/design/agent/graph"
import { DesignStore } from "../../src/design/store/store"
import { InstanceStore } from "../../src/project/instance-store"
import { TestInstance } from "../fixture/fixture"

const mockLlmLayer = Layer.succeed(
  DesignAgentLlm.Service,
  DesignAgentLlm.Service.of({
    generateObject: () => Effect.succeed({ object: {} }),
  }),
)

const mockGraphAgentLayer = GraphAgent.layer.pipe(Layer.provide(mockLlmLayer))

const testLayer = Design.layer().pipe(
  Layer.provide(DesignStore.defaultLayer),
  Layer.provide(mockGraphAgentLayer),
)

const it = testEffect(testLayer)

describe("Design.Service", () => {
  it.instance("persists nodes and edges across reload", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const design = yield* Design.Service
      yield* design.init()

      const ctx = yield* design.createContext({ name: "战斗系统" })
      const ship = yield* design.createNode({ name: "船", contextId: ctx.id })
      const hp = yield* design.createNode({ name: "生命值", contextId: ctx.id })
      yield* design.createEdge({ leftNodeId: ship.id, rightNodeId: hp.id, prototypeId: "aggregate", parameters: {} })

      const before = yield* design.listNodes()
      expect(before.length).toBe(2)

      const store = yield* InstanceStore.Service
      yield* store.reload({ directory: test.directory })
      const reloaded = yield* Design.Service
      yield* reloaded.init()

      const after = yield* reloaded.listNodes()
      expect(after.map((n) => n.id)).toEqual([ship.id, hp.id])
      expect(after.length).toBe(2)
      const edges = yield* reloaded.listEdges()
      expect(edges.length).toBe(1)
    }),
  )

  it.instance("isolates graph state per directory", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.init()

      const ctx = yield* design.createContext({ name: "DirA" })
      yield* design.createNode({ name: "NodeA", contextId: ctx.id })

      const nodes = yield* design.listNodes()
      expect(nodes.length).toBe(1)
    }),
  )
})
