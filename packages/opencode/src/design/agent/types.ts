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
  addNodes?: DesignTypes.Node[]
  updateNodes?: Array<{ id: string; patch: Partial<DesignTypes.Node> }>
  deleteNodeIds?: string[]
  addEdges?: DesignTypes.Edge[]
  updateEdges?: Array<{ leftNodeId: string; rightNodeId: string; patch: Partial<DesignTypes.Edge> }>
  deleteEdgeKeys?: string[]
}

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
  affectedNodes: string[]
  affectedEdges: string[]
  questions?: string[]
  delta?: GraphDelta
}

export * as GraphAgent from "./types"
