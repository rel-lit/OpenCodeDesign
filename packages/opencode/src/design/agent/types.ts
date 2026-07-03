import { DesignTypes } from "@/design/core/types"

export interface TemporaryWorkingSet {
  contextIds: string[]
  nodeIds: string[]
  edgeKeys: string[]
  systemAnalysis: {
    conflictingRelations: Array<{
      edgeKey: string
      reason: string
      severity: "error" | "warning"
    }>
    duplicateNodeCandidates: Array<{ nodeIds: string[]; similarityScore: number }>
    orphanNodes: string[]
    invalidPrototypeUsage: Array<{ edgeKey: string; prototypeId: string; reason: string }>
  }
  expandedByGraphAgent: {
    contextIds: string[]
    nodeIds: string[]
    edgeKeys: string[]
    reason: string
  }
}

export interface ActiveWorkingSet {
  contextIds: string[]
  nodeIds: string[]
  capacity: number
}

export interface GraphDelta {
  addNodes?: NodeInput[]
  updateNodes?: Array<{ id: string; patch: Partial<NodeInput> }>
  deleteNodeIds?: string[]
  addEdges?: EdgeInput[]
  updateEdges?: Array<{ leftNodeId: string; rightNodeId: string; patch: Partial<EdgeInput> }>
  deleteEdgeKeys?: string[]
}

export interface NodeInput
  extends Omit<
      DesignTypes.Node,
      | "id"
      | "kind"
      | "aliases"
      | "defaultSemantics"
      | "connectedEdges"
      | "createdAt"
      | "updatedAt"
      | "retired"
    >,
    Partial<
      Pick<
        DesignTypes.Node,
        | "id"
        | "kind"
        | "aliases"
        | "defaultSemantics"
        | "connectedEdges"
        | "createdAt"
        | "updatedAt"
        | "retired"
      >
    > {}

export interface EdgeInput
  extends Omit<DesignTypes.Edge, "parameters" | "createdAt" | "updatedAt">,
    Partial<Pick<DesignTypes.Edge, "parameters" | "createdAt" | "updatedAt">> {}

export interface Input {
  source: "chat" | "visual-editor"
  userInput: string
  temporaryWorkingSet: TemporaryWorkingSet
  activeWorkingSet: ActiveWorkingSet
  graphState: DesignTypes.GraphState
  proposedChange?: GraphDelta
  knownVersion?: number
}

export interface Output {
  type: "enriched-input" | "graph-summary" | "change-proposal" | "change-applied" | "rejected"
  summary: string
  structured?: {
    warnings?: Array<{ code: string; message: string; nodeId?: string; edgeKey?: string }>
    suggestions?: Array<{ action: string; reason: string }>
  }
  affectedNodes?: string[]
  affectedEdges?: string[]
  questions?: string[]
  delta?: GraphDelta
}

export * as GraphAgent from "./types"
