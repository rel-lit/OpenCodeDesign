import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../../lib/effect"
import { WorkingSet } from "../../../src/design/core/working-set"
import { GraphEngine } from "../../../src/design/core/graph"

const it = testEffect(Layer.merge(WorkingSet.defaultLayer, GraphEngine.defaultLayer))

describe("WorkingSet", () => {
  it.effect("touches node and context entries", () =>
    Effect.gen(function* () {
      const ws = yield* WorkingSet.Service
      const graph = yield* GraphEngine.Service
      const ctx = yield* graph.createContext({ name: "Game" })
      const node = yield* graph.createNode({ name: "Player", contextId: ctx.id })
      yield* ws.touchNode(node.id)
      const entries = yield* ws.list()
      expect(entries.some((e) => e.type === "node" && e.id === node.id)).toBe(true)
      expect(entries.some((e) => e.type === "context" && e.id === ctx.id)).toBe(true)
    }),
  )

  it.effect("respects capacity and drops oldest nodes", () =>
    Effect.gen(function* () {
      const ws = yield* WorkingSet.Service
      const graph = yield* GraphEngine.Service
      const ctx = yield* graph.createContext({ name: "Game" })
      for (let i = 0; i < 25; i++) {
        const node = yield* graph.createNode({ name: `node-${i}`, contextId: ctx.id })
        yield* ws.touchNode(node.id)
      }
      const entries = yield* ws.list()
      const nodeEntries = entries.filter((e) => e.type === "node")
      expect(nodeEntries.length).toBe(20)
    }),
  )

  it.effect("evicts context only when it has no active nodes", () =>
    Effect.gen(function* () {
      const ws = yield* WorkingSet.Service
      const graph = yield* GraphEngine.Service
      const ctx = yield* graph.createContext({ name: "Game" })
      const node = yield* graph.createNode({ name: "Player", contextId: ctx.id })
      yield* ws.touchNode(node.id)
      yield* ws.forgetNode(node.id)
      const entries = yield* ws.list()
      expect(entries.some((e) => e.type === "context" && e.id === ctx.id)).toBe(false)
    }),
  )
})
