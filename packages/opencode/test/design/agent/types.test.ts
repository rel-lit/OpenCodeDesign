import { describe, expect, test } from "bun:test"
import { GraphAgent } from "@/design/agent/types"

describe("GraphAgent types", () => {
  test("input schema accepts change mode with known version", () => {
    const input: GraphAgent.Input = {
      mode: "change",
      request: "rename UserService",
      source: "chat",
      userInput: "rename UserService",
      activeWorkingSet: [
        { id: "ctx-core", name: "Core", type: "context", briefSemantics: "" },
        { id: "node-5", name: "UserService", type: "node", briefSemantics: "" },
      ],
      knownVersion: 1,
    }
    expect(input.source).toBe("chat")
    expect(input.mode).toBe("change")
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
