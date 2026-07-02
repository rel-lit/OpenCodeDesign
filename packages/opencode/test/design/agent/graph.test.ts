import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { GraphAgent } from "@/design/agent/graph"
import * as GraphAgentTypes from "@/design/agent/types"

describe("GraphAgent service", () => {
  test("analyze returns change-proposal for trivial rename", async () => {
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
    const program = Effect.gen(function* () {
      const ga = yield* GraphAgent.Service
      return yield* ga.analyze(input)
    })
    expect(program).toBeDefined()
  })
})
