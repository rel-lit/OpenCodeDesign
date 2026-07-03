import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Design } from "@/design/design"
import { GraphAgent } from "@/design/agent/graph"
import { DesignAgentLlm } from "@/design/agent/llm"
import { DesignStore } from "@/design/store/store"
import { DesignTypes } from "@/design/core/types"
import * as GraphAgentTypes from "@/design/agent/types"
import { testEffect } from "../../lib/effect"

const mockLlmLayer = Layer.succeed(
  DesignAgentLlm.Service,
  DesignAgentLlm.Service.of({
    generateObject: () => Effect.succeed({ object: {} }),
  }),
)

const graphAgentLayer = GraphAgent.layer.pipe(Layer.provide(mockLlmLayer))

const designLayer = Design.layer().pipe(
  Layer.provide(DesignStore.defaultLayer),
  Layer.provide(graphAgentLayer),
)

const testLayer = Layer.merge(designLayer, graphAgentLayer)

const it = testEffect(testLayer)

describe("GraphAgent execute", () => {
  it.instance("applies a node update via Design.Service", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* design.createNode({ id: "node-5", name: "UserService", contextId: "ctx-core" })

      const proposal: GraphAgentTypes.Output = {
        type: "change-proposal",
        summary: "rename node",
        affectedNodes: ["node-5"],
        affectedEdges: [],
        delta: { updateNodes: [{ id: "node-5", patch: { name: "UserServiceV2" } }] },
      }

      const ga = yield* GraphAgent.Service
      const result = yield* ga.execute(proposal)

      expect(result.type).toBe("change-applied")
      const node = yield* design.getNode("node-5")
      expect(node?.name).toBe("UserServiceV2")
    }),
  )

  it.instance("applies mixed delta operations", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* design.createNode({ id: "node-a", name: "A", contextId: "ctx-core" })
      yield* design.createNode({ id: "node-b", name: "B", contextId: "ctx-core" })

      const nodeCId = crypto.randomUUID()
      const proposal: GraphAgentTypes.Output = {
        type: "change-proposal",
        summary: "mixed changes",
        affectedNodes: ["node-a", "node-b", nodeCId],
        affectedEdges: [],
        delta: {
          addNodes: [{
            id: nodeCId,
            name: "C",
            contextId: "ctx-core",
            kind: "node",
            aliases: [],
            defaultSemantics: "",
            connectedEdges: [],
            createdAt: 0,
            updatedAt: 0,
            retired: false,
          }],
          updateNodes: [{ id: "node-a", patch: { name: "A2" } }],
          addEdges: [{
            leftNodeId: "node-a",
            rightNodeId: nodeCId,
            prototypeId: "proto-1",
            parameters: {},
            createdAt: 0,
            updatedAt: 0,
          }],
          deleteNodeIds: ["node-b"],
        },
      }

      const ga = yield* GraphAgent.Service
      const result = yield* ga.execute(proposal)

      expect(result.type).toBe("change-applied")
      const nodeA = yield* design.getNode("node-a")
      expect(nodeA?.name).toBe("A2")
      const nodeC = yield* design.getNode(nodeCId)
      expect(nodeC?.name).toBe("C")
      expect(yield* design.getNode("node-b")).toBeUndefined()
      const edges = yield* design.listEdges()
      expect(edges.length).toBe(1)
      expect(edges[0].leftNodeId).toBe("node-a")
      expect(edges[0].rightNodeId).toBe(nodeCId)
    }),
  )

  it.instance("deletes an edge by key", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* design.createNode({ id: "node-x", name: "X", contextId: "ctx-core" })
      yield* design.createNode({ id: "node-y", name: "Y", contextId: "ctx-core" })
      yield* design.createEdge({
        leftNodeId: "node-x",
        rightNodeId: "node-y",
        prototypeId: "proto-1",
        parameters: {},
      })

      const proposal: GraphAgentTypes.Output = {
        type: "change-proposal",
        summary: "delete edge",
        affectedNodes: [],
        affectedEdges: [DesignTypes.edgeKey("node-x", "node-y")],
        delta: {
          deleteEdgeKeys: [DesignTypes.edgeKey("node-x", "node-y")],
        },
      }

      const ga = yield* GraphAgent.Service
      const result = yield* ga.execute(proposal)

      expect(result.type).toBe("change-applied")
      expect((yield* design.listEdges()).length).toBe(0)
    }),
  )

  it.instance("applies a minimal delta with only user fields", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.createContext({ id: "ctx-core", name: "Core" })

      const proposal: GraphAgentTypes.Output = {
        type: "change-proposal",
        summary: "minimal delta",
        affectedNodes: ["node-b"],
        affectedEdges: [],
        delta: {
          addNodes: [{ id: "node-b", name: "B", contextId: "ctx-core" }],
        },
      }

      const ga = yield* GraphAgent.Service
      const result = yield* ga.execute(proposal)

      expect(result.type).toBe("change-applied")
      const nodeB = yield* design.getNode("node-b")
      expect(nodeB?.name).toBe("B")
      expect(nodeB?.kind).toBe("node")
      expect(nodeB?.aliases).toEqual([])
      expect(nodeB?.defaultSemantics).toBe("")
      expect(nodeB?.retired).toBe(false)
    }),
  )

  it.instance("fails when proposal has no delta", () =>
    Effect.gen(function* () {
      const ga = yield* GraphAgent.Service
      const error = yield* ga.execute({
        type: "change-proposal",
        summary: "no delta",
        affectedNodes: [],
        affectedEdges: [],
      }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(GraphAgent.NoDeltaError)
    }),
  )

  it.instance("forwards kind when creating a node", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.createContext({ id: "ctx-core", name: "Core" })

      const proposal: GraphAgentTypes.Output = {
        type: "change-proposal",
        summary: "create node with kind",
        affectedNodes: ["node-svc"],
        affectedEdges: [],
        delta: {
          addNodes: [{
            id: "node-svc",
            name: "UserService",
            contextId: "ctx-core",
            kind: "service",
            aliases: [],
            defaultSemantics: "",
            connectedEdges: [],
            createdAt: 0,
            updatedAt: 0,
            retired: false,
          }],
        },
      }

      const ga = yield* GraphAgent.Service
      const result = yield* ga.execute(proposal)

      expect(result.type).toBe("change-applied")
      const node = yield* design.getNode("node-svc")
      expect(node?.kind).toBe("service")
    }),
  )

  it.instance("applies kind patch when updating a node", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* design.createNode({ id: "node-x", name: "X", contextId: "ctx-core" })

      const proposal: GraphAgentTypes.Output = {
        type: "change-proposal",
        summary: "update kind",
        affectedNodes: ["node-x"],
        affectedEdges: [],
        delta: { updateNodes: [{ id: "node-x", patch: { kind: "entity" } }] },
      }

      const ga = yield* GraphAgent.Service
      const result = yield* ga.execute(proposal)

      expect(result.type).toBe("change-applied")
      const node = yield* design.getNode("node-x")
      expect(node?.kind).toBe("entity")
    }),
  )
})
