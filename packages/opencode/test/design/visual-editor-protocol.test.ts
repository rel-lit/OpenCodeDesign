import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import { DesignTypes } from "../../src/design/core/types"
import { DesignStore } from "../../src/design/store/store"
import { DesignAgentLlm } from "../../src/design/agent/llm"
import { GraphAgent } from "../../src/design/agent/graph"
import { WorkingSetComputer } from "../../src/design/system/working-set-computer"
import { VisualEditorProtocol } from "../../src/design/visual-editor-protocol"

const mockLlmLayer = Layer.succeed(
  DesignAgentLlm.Service,
  DesignAgentLlm.Service.of({
    generateObject: () => Effect.succeed({ object: {} }),
  }),
)

const graphAgentBaseLayer = GraphAgent.layer.pipe(Layer.provide(mockLlmLayer))

const mockGraphAgentLayer = Layer.succeed(
  GraphAgent.Service,
  GraphAgent.Service.of({
    analyze: () =>
      Effect.succeed({
        type: "change-applied",
        summary: "Visual editor changes reviewed",
        affectedNodes: ["new-node"],
        affectedEdges: [],
      }),
    execute: () => Effect.die("unexpected execute"),
  }),
)

const designLayer = Design.layer().pipe(
  Layer.provide(DesignStore.defaultLayer),
  Layer.provide(graphAgentBaseLayer),
)

const dependenciesLayer = Layer.merge(designLayer, mockGraphAgentLayer)

const testLayer = VisualEditorProtocol.layer().pipe(
  Layer.provideMerge(dependenciesLayer),
)

const it = testEffect(testLayer)

describe("VisualEditorProtocol", () => {
  it.instance("save applies raw diff and triggers review", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const protocol = yield* VisualEditorProtocol.Service
      yield* design.init()

      yield* design.createContext({ id: "ctx", name: "Core" })

      const delta = {
        addNodes: [
          {
            id: "new-node",
            name: "PaymentGateway",
            contextId: "ctx",
            kind: "service",
            defaultSemantics: "",
            aliases: [],
            connectedEdges: [],
            createdAt: 0,
            updatedAt: 0,
            retired: false,
          },
        ],
      }

      const result = yield* protocol.save(delta)
      expect(result.type).toBe("change-applied")

      const node = yield* design.getNode("new-node")
      expect(node).not.toBeUndefined()
      expect(node?.name).toBe("PaymentGateway")
    }),
  )

  it.instance("save appends audit events to EventLog", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const protocol = yield* VisualEditorProtocol.Service
      yield* design.init()

      yield* design.createContext({ id: "ctx-audit", name: "Audit" })

      const delta = {
        addNodes: [
          {
            id: "audit-node",
            name: "AuditNode",
            contextId: "ctx-audit",
            kind: "service",
            defaultSemantics: "",
            aliases: [],
            connectedEdges: [],
            createdAt: 0,
            updatedAt: 0,
            retired: false,
          },
        ],
      }

      yield* protocol.save(delta)

      const state = yield* design.getState()
      const events = state.eventLog?.events ?? []
      const eventTypes = events.map((event) => event.eventType)
      expect(eventTypes).toContain("node_created")
      expect(eventTypes).toContain("graph_version_bumped")
      const versionEvent = events.find((event) => event.eventType === "graph_version_bumped")
      expect(versionEvent?.source).toBe("visual-editor")
    }),
  )

  test("WorkingSetComputer.fromDelta includes nodes and edges from the delta", () => {
    const graphState: DesignTypes.GraphState = {
      contexts: [{ id: "ctx-core", name: "core", semantics: "", nodeIds: [] }],
      nodes: [
        {
          id: "node-a",
          name: "A",
          aliases: [],
          contextId: "ctx-core",
          kind: "service",
          defaultSemantics: "",
          connectedEdges: [],
          createdAt: 0,
          updatedAt: 0,
          retired: false,
        },
        {
          id: "node-b",
          name: "B",
          aliases: [],
          contextId: "ctx-core",
          kind: "service",
          defaultSemantics: "",
          connectedEdges: [],
          createdAt: 0,
          updatedAt: 0,
          retired: false,
        },
      ],
      edges: [
        {
          leftNodeId: "node-a",
          rightNodeId: "node-b",
          prototypeId: "proto-uses",
          parameters: {},
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      prototypes: [],
    }

    const active = { contextIds: ["ctx-core"], nodeIds: ["node-a"], capacity: 10 }
    const delta = {
      addNodes: [
        {
          id: "node-c",
          name: "C",
          contextId: "ctx-core",
          kind: "service",
          defaultSemantics: "",
          aliases: [],
          connectedEdges: [],
          createdAt: 0,
          updatedAt: 0,
          retired: false,
        },
      ],
      addEdges: [
        {
          leftNodeId: "node-b",
          rightNodeId: "node-c",
          prototypeId: "proto-uses",
          parameters: {},
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    }

    const result = WorkingSetComputer.fromDelta(delta, active, graphState)
    expect(result.nodeIds).toContain("node-a")
    expect(result.nodeIds).toContain("node-b")
    expect(result.nodeIds).toContain("node-c")
    expect(result.edgeKeys).toContain("node-a->node-b")
    expect(result.edgeKeys).toContain("node-b->node-c")
  })
})
