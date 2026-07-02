import { describe, expect, test } from "bun:test"
import { DesignTypes } from "@/design/core/types"
import { SystemAnalyzer } from "@/design/system/analyzer"
import { WorkingSetComputer } from "@/design/system/working-set-computer"

describe("SystemAnalyzer", () => {
  test("detects duplicate node candidates", () => {
    const graphState: DesignTypes.GraphState = {
      nodes: [
        {
          id: "n1",
          name: "UserService",
          aliases: [],
          contextId: "ctx",
          kind: "service",
          defaultSemantics: "",
          connectedEdges: [],
          createdAt: 0,
          updatedAt: 0,
          retired: false,
        },
        {
          id: "n2",
          name: "UserSvc",
          aliases: [],
          contextId: "ctx",
          kind: "service",
          defaultSemantics: "",
          connectedEdges: [],
          createdAt: 0,
          updatedAt: 0,
          retired: false,
        },
      ],
      edges: [],
      contexts: [{ id: "ctx", name: "core", semantics: "", nodeIds: [] }],
      prototypes: [],
    }
    const tws = WorkingSetComputer.fromInput(
      "",
      { contextIds: ["ctx"], nodeIds: ["n1", "n2"], capacity: 10 },
      graphState,
    )
    const result = SystemAnalyzer.analyze(tws, graphState)
    expect(result.systemAnalysis.duplicateNodeCandidates.length).toBeGreaterThan(0)
  })

  test("detects orphan nodes", () => {
    const graphState: DesignTypes.GraphState = {
      nodes: [
        {
          id: "n1",
          name: "OrderService",
          aliases: [],
          contextId: "ctx",
          kind: "service",
          defaultSemantics: "",
          connectedEdges: [],
          createdAt: 0,
          updatedAt: 0,
          retired: false,
        },
        {
          id: "n2",
          name: "UserService",
          aliases: [],
          contextId: "ctx",
          kind: "service",
          defaultSemantics: "",
          connectedEdges: [],
          createdAt: 0,
          updatedAt: 0,
          retired: false,
        },
        {
          id: "n3",
          name: "OrphanNode",
          aliases: [],
          contextId: "ctx",
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
          leftNodeId: "n1",
          rightNodeId: "n2",
          prototypeId: "proto-uses",
          parameters: {},
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      contexts: [{ id: "ctx", name: "core", semantics: "", nodeIds: [] }],
      prototypes: [],
    }
    const tws = WorkingSetComputer.fromInput(
      "",
      { contextIds: ["ctx"], nodeIds: ["n1", "n2", "n3"], capacity: 10 },
      graphState,
    )
    const result = SystemAnalyzer.analyze(tws, graphState)
    expect(result.systemAnalysis.orphanNodes).toEqual(["n3"])
  })
})
