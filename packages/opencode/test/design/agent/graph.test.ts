import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { GraphAgent } from "@/design/agent/graph"
import * as GraphAgentTypes from "@/design/agent/types"
import { testEffect } from "../../lib/effect"

const it = testEffect(GraphAgent.layer)

describe("GraphAgent service", () => {
  it.effect("analyze returns change-proposal for trivial rename", () =>
    Effect.gen(function* () {
      const input: GraphAgentTypes.Input = {
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
      }

      const ga = yield* GraphAgent.Service
      const output = yield* ga.analyze(input)

      expect(output.type).toBe("change-proposal")
      expect(output.summary).toContain("rename UserService to UserServiceV2")
      expect(output.affectedNodes).toEqual(["node-5"])
      expect(output.affectedEdges).toEqual([])
      expect(output.delta).toEqual(input.proposedChange)
    }),
  )
})
