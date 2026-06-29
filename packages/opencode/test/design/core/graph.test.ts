import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../../lib/effect"
import { GraphEngine } from "../../../src/design/core/graph"

const it = testEffect(GraphEngine.defaultLayer)

describe("GraphEngine", () => {
  it.effect("creates a node", () =>
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      const node = yield* graph.createNode({
        name: "船",
        contextId: "ctx-battle",
        defaultSemantics: "水上交通工具",
      })
      expect(node.name).toBe("船")
      expect(node.contextId).toBe("ctx-battle")
      expect(node.retired).toBe(false)
    }),
  )

  it.effect("enforces one edge per node pair", () =>
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      const ship = yield* graph.createNode({ name: "船", contextId: "ctx-battle", defaultSemantics: "" })
      const hp = yield* graph.createNode({ name: "生命值", contextId: "ctx-battle", defaultSemantics: "" })
      yield* graph.createEdge({ leftNodeId: ship.id, rightNodeId: hp.id, prototypeId: "aggregate", parameters: {} })
      const second = yield* graph.createEdge({
        leftNodeId: ship.id,
        rightNodeId: hp.id,
        prototypeId: "associate",
        parameters: {},
      })
      const all = yield* graph.listEdges()
      expect(all.length).toBe(1)
      expect(second.prototypeId).toBe("associate")
    }),
  )

  it.effect("updates and retrieves a node", () =>
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      const node = yield* graph.createNode({ name: "船", contextId: "ctx-battle", defaultSemantics: "" })
      const updated = yield* graph.updateNode(node.id, { defaultSemantics: "水上交通工具" })
      expect(updated.defaultSemantics).toBe("水上交通工具")
      const found = yield* graph.getNode(node.id)
      expect(found).toBeDefined()
      expect(found?.name).toBe("船")
    }),
  )

  it.effect("retires and deletes a node", () =>
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      const node = yield* graph.createNode({ name: "船", contextId: "ctx-battle", defaultSemantics: "" })
      yield* graph.retireNode(node.id, true)
      const retired = yield* graph.getNode(node.id)
      expect(retired?.retired).toBe(true)
      yield* graph.deleteNode(node.id)
      const gone = yield* graph.getNode(node.id)
      expect(gone).toBeUndefined()
    }),
  )

  it.effect("creates bounded contexts", () =>
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      const ctx = yield* graph.createContext({ id: "ctx-battle", name: "战斗系统" })
      expect(ctx.id).toBe("ctx-battle")
      const found = yield* graph.getContext("ctx-battle")
      expect(found?.name).toBe("战斗系统")
      const all = yield* graph.listContexts()
      expect(all.length).toBe(1)
    }),
  )

  it.effect("creates relation prototypes", () =>
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      const proto = yield* graph.createPrototype({ id: "aggregate", name: "聚合" })
      expect(proto.id).toBe("aggregate")
      const all = yield* graph.listPrototypes()
      expect(all.length).toBe(1)
    }),
  )

  it.effect("updates and deletes edges", () =>
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      const ship = yield* graph.createNode({ name: "船", contextId: "ctx-battle", defaultSemantics: "" })
      const hp = yield* graph.createNode({ name: "生命值", contextId: "ctx-battle", defaultSemantics: "" })
      yield* graph.createEdge({ leftNodeId: ship.id, rightNodeId: hp.id, prototypeId: "aggregate", parameters: {} })
      const updated = yield* graph.updateEdge(ship.id, hp.id, { parameters: { 上限: 1000 } })
      expect(updated.parameters).toEqual({ 上限: 1000 })
      yield* graph.deleteEdge(ship.id, hp.id)
      const all = yield* graph.listEdges()
      expect(all.length).toBe(0)
    }),
  )

  it.effect("lists edges for a node", () =>
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      const ship = yield* graph.createNode({ name: "船", contextId: "ctx-battle", defaultSemantics: "" })
      const hp = yield* graph.createNode({ name: "生命值", contextId: "ctx-battle", defaultSemantics: "" })
      const armor = yield* graph.createNode({ name: "护甲", contextId: "ctx-battle", defaultSemantics: "" })
      yield* graph.createEdge({ leftNodeId: ship.id, rightNodeId: hp.id, prototypeId: "aggregate", parameters: {} })
      yield* graph.createEdge({ leftNodeId: ship.id, rightNodeId: armor.id, prototypeId: "aggregate", parameters: {} })
      const edges = yield* graph.listEdgesForNode(ship.id)
      expect(edges.length).toBe(2)
    }),
  )

  it.effect("finds nodes by name or alias", () =>
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      yield* graph.createNode({ name: "船", contextId: "ctx-battle", aliases: ["战船"], defaultSemantics: "" })
      const byName = yield* graph.findNodesByName("船")
      expect(byName.length).toBe(1)
      const byAlias = yield* graph.findNodesByName("战船")
      expect(byAlias.length).toBe(1)
      const byContext = yield* graph.findNodesByName("船", "ctx-battle")
      expect(byContext.length).toBe(1)
    }),
  )
})
