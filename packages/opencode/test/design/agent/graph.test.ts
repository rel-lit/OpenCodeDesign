import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { GraphAgent } from "@/design/agent/graph"
import { DesignAgentLlm } from "@/design/agent/llm"
import * as GraphAgentTypes from "@/design/agent/types"
import { testEffect } from "../../lib/effect"

const makeSampleInput = (): GraphAgentTypes.Input => ({
  source: "chat",
  userInput: "rename UserService to UserServiceV2",
  temporaryWorkingSet: {
    contextIds: ["ctx-core"],
    nodeIds: ["node-5"],
    edgeKeys: [],
    systemAnalysis: { conflictingRelations: [], duplicateNodeCandidates: [], orphanNodes: [], invalidPrototypeUsage: [] },
    expandedByGraphAgent: { contextIds: [], nodeIds: [], edgeKeys: [], reason: "" },
  },
  activeWorkingSet: { contextIds: ["ctx-core"], nodeIds: ["node-5"], capacity: 10 },
  graphState: {
    contexts: [],
    nodes: [{
      id: "node-5",
      name: "UserService",
      aliases: [],
      contextId: "ctx-core",
      kind: "service",
      defaultSemantics: "",
      connectedEdges: [],
      createdAt: 0,
      updatedAt: 0,
      retired: false,
    }],
    edges: [],
    prototypes: [],
  },
  proposedChange: { updateNodes: [{ id: "node-5", patch: { name: "UserServiceV2" } }] },
})

const mockLlmLayer = Layer.succeed(
  DesignAgentLlm.Service,
  DesignAgentLlm.Service.of({
    generateObject: () =>
      Effect.succeed({
        object: {
          type: "change-proposal",
          summary: "LLM-generated summary for rename",
          affectedNodes: ["node-5"],
          affectedEdges: [],
          delta: { updateNodes: [{ id: "node-5", patch: { name: "UserServiceV2" } }] },
        },
      }),
  }),
)

const it = testEffect(GraphAgent.layer.pipe(Layer.provide(mockLlmLayer)))

describe("GraphAgent service", () => {
  it.effect("analyze returns structured change-proposal", () =>
    Effect.gen(function* () {
      const input = makeSampleInput()
      const ga = yield* GraphAgent.Service
      const output = yield* ga.analyze(input)

      expect(output.type).toBe("change-proposal")
      expect(output.summary).toBe("LLM-generated summary for rename")
      expect(output.affectedNodes).toContain("node-5")
      expect(output.affectedEdges).toEqual([])
      expect(output.delta).toEqual(input.proposedChange)
    }),
  )
})
