import { describe, expect, test } from "bun:test"
import { DesignTypes } from "../../../src/design/core/types"
import { expandAtReferences } from "../../../src/design/system/preprocessor"

describe("expandAtReferences", () => {
  test("expands @UserService to node summary", () => {
    const graphState: DesignTypes.GraphState = {
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
      contexts: [{ id: "ctx-core", name: "core", semantics: "", nodeIds: [] }],
      edges: [],
      prototypes: [],
      workingSet: { activeContextIds: [], activeNodeIds: [], capacity: 0 },
      eventLog: { events: [] },
    }
    const result = expandAtReferences("修改 @UserService 的依赖", graphState)
    expect(result).toContain("UserService（节点 ID: node-5")
  })
})
