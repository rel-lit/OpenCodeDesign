import { describe, expect, test } from "bun:test"
import { DesignTypes } from "@/design/core/types"
import { WorkingSetComputer } from "@/design/system/working-set-computer"

describe("WorkingSetComputer", () => {
  test("includes involved nodes, adjacent edges, and active nodes", () => {
    const graphState: DesignTypes.GraphState = {
      contexts: [{ id: "ctx-core", name: "core", semantics: "", nodeIds: [] }],
      nodes: [
        {
          id: "node-1",
          name: "OrderService",
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
        },
      ],
      edges: [
        {
          leftNodeId: "node-1",
          rightNodeId: "node-5",
          prototypeId: "proto-uses",
          parameters: {},
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      prototypes: [],
    }
    const active = { contextIds: ["ctx-core"], nodeIds: ["node-5"], capacity: 10 }
    const result = WorkingSetComputer.fromInput("修改 @UserService", active, graphState)
    expect(result.nodeIds).toContain("node-5")
    expect(result.nodeIds).toContain("node-1")
    expect(result.edgeKeys).toContain("node-1->node-5")
  })
})
