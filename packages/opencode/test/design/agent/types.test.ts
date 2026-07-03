import { describe, expect, test } from "bun:test"
import { GraphAgent } from "@/design/agent/types"

describe("GraphAgent types", () => {
  test("input schema accepts chat source with proposed change", () => {
    const input: GraphAgent.Input = {
      source: "chat",
      userInput: "rename UserService",
      temporaryWorkingSet: {
        contextIds: ["ctx-core"],
        nodeIds: ["node-5"],
        edgeKeys: [],
        systemAnalysis: {
          conflictingRelations: [],
          duplicateNodeCandidates: [],
          orphanNodes: [],
          invalidPrototypeUsage: [],
        },
        expandedByGraphAgent: {
          contextIds: [],
          nodeIds: [],
          edgeKeys: [],
          reason: "",
        },
      },
      activeWorkingSet: { contextIds: ["ctx-core"], nodeIds: ["node-5"], capacity: 10 },
      graphState: { contexts: [], nodes: [], edges: [], prototypes: [] },
      proposedChange: {
        updateNodes: [{ id: "node-5", patch: { name: "UserServiceV2" } }],
      },
      knownVersion: 1,
    }
    expect(input.source).toBe("chat")
  })

  test("minimal GraphDelta omits system node and edge fields", () => {
    const delta: GraphAgent.GraphDelta = {
      addNodes: [{ name: "NewNode", contextId: "ctx", defaultSemantics: "" }],
      addEdges: [{ leftNodeId: "a", rightNodeId: "b", prototypeId: "p", parameters: {} }],
    }
    expect(delta.addNodes).toHaveLength(1)
    expect(delta.addEdges).toHaveLength(1)
  })
})
