import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import { DesignStore } from "../../src/design/store/store"
import { InstanceStore } from "../../src/project/instance-store"
import { TestInstance } from "../fixture/fixture"
import type { BufferOperation } from "../../src/design/agent/types"

const testLayer = Design.layer().pipe(Layer.provide(DesignStore.defaultLayer))

const it = testEffect(testLayer)

const sessionID = "test-session"

const addAndApply = (design: Design.Interface, operations: Array<Omit<BufferOperation, "id">>) =>
  Effect.gen(function* () {
    for (const op of operations) {
      yield* design.bufferAddOperation(sessionID, op)
    }
    yield* design.bufferApply(sessionID)
  })

const createContext = (design: Design.Interface, name: string, id?: string) =>
  Effect.gen(function* () {
    const contextId = id ?? crypto.randomUUID()
    yield* addAndApply(design, [
      {
        type: "create_context",
        description: `Create context ${name}`,
        payload: { id: contextId, name },
      },
    ])
    const ctx = yield* design.getContext(contextId)
    if (!ctx) throw new Error(`Context ${name} not found after apply`)
    return ctx
  })

const createNode = (design: Design.Interface, name: string, contextId: string, id?: string) =>
  Effect.gen(function* () {
    const nodeId = id ?? crypto.randomUUID()
    yield* addAndApply(design, [
      {
        type: "create_node",
        description: `Create concept ${name}`,
        payload: { id: nodeId, name, contextId },
      },
    ])
    const node = yield* design.getNode(nodeId)
    if (!node) throw new Error(`Node ${name} not found after apply`)
    return node
  })

const createEdge = (design: Design.Interface, leftNodeId: string, rightNodeId: string, prototypeId: string) =>
  addAndApply(design, [
    {
      type: "create_edge",
      description: `Create relation`,
      payload: { leftNodeId, rightNodeId, prototypeId, parameters: {} },
    },
  ])

describe("Design.Service", () => {
  it.instance("persists nodes and edges across reload", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const design = yield* Design.Service
      yield* design.init()

      const ctx = yield* createContext(design, "战斗系统")
      const ship = yield* createNode(design, "船", ctx.id)
      const hp = yield* createNode(design, "生命值", ctx.id)
      yield* createEdge(design, ship.id, hp.id, "aggregate")

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

      const ctx = yield* createContext(design, "DirA")
      yield* createNode(design, "NodeA", ctx.id)

      const nodes = yield* design.listNodes()
      expect(nodes.length).toBe(1)
    }),
  )

  it.instance("applyRawDelta auto-fills system fields and replaces temporary node ids", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.init()
      const ctx = yield* createContext(design, "Fill", "ctx-fill")

      yield* design.applyRawDelta({
        addNodes: [
          { name: "NoId", contextId: ctx.id },
          { id: "temp-1", name: "Temp", contextId: ctx.id },
        ],
        addEdges: [{ leftNodeId: "temp-1", rightNodeId: "temp-1", prototypeId: "self" }],
      })

      const nodes = yield* design.listNodes()
      expect(nodes.length).toBe(2)

      const noId = nodes.find((n) => n.name === "NoId")
      expect(noId).toBeDefined()
      expect(noId!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect(noId!.kind).toBe("node")
      expect(noId!.aliases).toEqual([])
      expect(noId!.defaultSemantics).toBe("")
      expect(noId!.connectedEdges).toEqual([])
      expect(noId!.createdAt).toBeGreaterThan(0)
      expect(noId!.updatedAt).toBeGreaterThan(0)
      expect(noId!.retired).toBe(false)

      const temp = nodes.find((n) => n.name === "Temp")
      expect(temp).toBeDefined()
      expect(temp!.id).not.toBe("temp-1")
      expect(temp!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

      const edges = yield* design.listEdges()
      expect(edges.length).toBe(1)
      expect(edges[0]!.leftNodeId).toBe(temp!.id)
      expect(edges[0]!.rightNodeId).toBe(temp!.id)
      expect(edges[0]!.parameters).toEqual({})
      expect(edges[0]!.createdAt).toBeGreaterThan(0)
      expect(edges[0]!.updatedAt).toBeGreaterThan(0)
    }),
  )

  it.instance("checkChatAgentSync fails after visual editor version bump", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.init()
      yield* createContext(design, "Core", "ctx-core")
      yield* design.bumpVersion("visual-editor")

      const exit = yield* Effect.exit(design.checkChatAgentSync())
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
