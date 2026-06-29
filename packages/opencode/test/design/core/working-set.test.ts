import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../../lib/effect"
import { WorkingSet } from "../../../src/design/core/working-set"
import { GraphEngine } from "../../../src/design/core/graph"

const it = testEffect(Layer.merge(WorkingSet.defaultLayer, GraphEngine.defaultLayer))

describe("WorkingSet", () => {
  it.effect("auto-creates node when reference not found", () =>
    Effect.gen(function* () {
      const ws = yield* WorkingSet.Service
      const graph = yield* GraphEngine.Service
      const result = yield* ws.resolveReference({ reference: "foo" })
      expect(result.action).toBe("created")
      const node = yield* graph.getNode(result.nodeId)
      expect(node?.name).toBe("foo")
    }),
  )

  it.effect("respects capacity and drops oldest", () =>
    Effect.gen(function* () {
      const ws = yield* WorkingSet.Service
      const graph = yield* GraphEngine.Service
      for (let i = 0; i < 25; i++) {
        const result = yield* ws.resolveReference({ reference: `node-${i}` })
        yield* ws.activateNode(result.nodeId)
      }
      const state = yield* ws.state()
      expect(state.activeNodeIds.length).toBe(20)
    }),
  )
})
