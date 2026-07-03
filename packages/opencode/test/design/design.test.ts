import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import { DesignAgentLlm } from "../../src/design/agent/llm"
import { GraphAgent } from "../../src/design/agent/graph"
import * as GraphAgentTypes from "../../src/design/agent/types"
import { DesignStore } from "../../src/design/store/store"
import { InstanceStore } from "../../src/project/instance-store"
import { TestInstance } from "../fixture/fixture"
import { ApprovalPanel } from "../../src/design/approval-panel"

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

  it.instance("proposeChanges executes delta and bumps version", () =>
    Effect.gen(function* () {
      const calls = { analyzed: [] as GraphAgentTypes.Input[], executed: [] as GraphAgentTypes.Output[] }
      const mockGraphAgent = GraphAgent.Service.of({
        analyze: (input) => {
          calls.analyzed.push(input)
          return Effect.succeed({
            type: "change-proposal" as const,
            summary: "regression proposal",
            affectedNodes: input.proposedChange?.updateNodes?.map((n) => n.id) ?? [],
            affectedEdges: [],
            delta: input.proposedChange,
          })
        },
        execute: (proposal) =>
          Effect.gen(function* () {
            calls.executed.push(proposal)
            const design = yield* Design.Service
            const delta = proposal.delta
            if (!delta) return { ...proposal, type: "change-applied" as const }
            yield* design.applyRawDelta(delta)
            yield* design.bumpVersion("chat-agent")
            return { ...proposal, type: "change-applied" as const }
          }),
      })

      const regressionLayer = Design.layer({ makeApprovalPanel: autoConfirmPanel }).pipe(
        Layer.provide(DesignStore.defaultLayer),
        Layer.provide(Layer.succeed(GraphAgent.Service, mockGraphAgent)),
      )

      return yield* Effect.gen(function* () {
        const design = yield* Design.Service
        yield* design.init()
        const ctx = yield* design.createContext({ id: "ctx-regression", name: "Regression" })
        yield* design.createNode({ id: "node-r", name: "Before", contextId: ctx.id })

        const before = yield* design.getCurrentVersion()

        const result = yield* design.proposeChanges({
          updateNodes: [{ id: "node-r", patch: { name: "After" } }],
        })

        expect(result.type).toBe("change-applied")
        expect(calls.executed.length).toBe(1)
        const node = yield* design.getNode("node-r")
        expect(node?.name).toBe("After")

        const after = yield* design.getCurrentVersion()
        expect(after.sequence).toBe(before.sequence + 1)
      }).pipe(Effect.provide(regressionLayer))
    }),
  )

  it.instance("proposeChanges auto-approves when no panel is injected", () =>
    Effect.gen(function* () {
      const calls = { executed: [] as GraphAgentTypes.Output[] }
      const mockGraphAgent = GraphAgent.Service.of({
        analyze: (input) =>
          Effect.succeed({
            type: "change-proposal" as const,
            summary: "auto-approve",
            affectedNodes: [],
            affectedEdges: [],
            delta: input.proposedChange,
          }),
        execute: (proposal) =>
          Effect.gen(function* () {
            calls.executed.push(proposal)
            const design = yield* Design.Service
            const delta = proposal.delta
            if (!delta) return { ...proposal, type: "change-applied" as const }
            yield* design.applyRawDelta(delta)
            yield* design.bumpVersion("chat-agent")
            return { ...proposal, type: "change-applied" as const }
          }),
      })

      const autoApproveLayer = Design.layer().pipe(
        Layer.provide(DesignStore.defaultLayer),
        Layer.provide(Layer.succeed(GraphAgent.Service, mockGraphAgent)),
      )

      return yield* Effect.gen(function* () {
        const design = yield* Design.Service
        yield* design.init()
        const ctx = yield* design.createContext({ id: "ctx-auto", name: "Auto" })
        yield* design.createNode({ id: "node-auto", name: "Before", contextId: ctx.id })

        const result = yield* design.proposeChanges({
          updateNodes: [{ id: "node-auto", patch: { name: "After" } }],
        })

        expect(result.type).toBe("change-applied")
        expect(calls.executed.length).toBe(1)
        const node = yield* design.getNode("node-auto")
        expect(node?.name).toBe("After")
      }).pipe(Effect.provide(autoApproveLayer))
    }),
  )

  it.instance("applyRawDelta auto-fills system fields and replaces temporary node ids", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.init()
      const ctx = yield* design.createContext({ id: "ctx-fill", name: "Fill" })

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
})
