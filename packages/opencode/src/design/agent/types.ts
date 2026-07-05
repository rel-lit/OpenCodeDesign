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

export interface ChangePlan {
  intent: string
  rationale: string
  summary: string
  concepts?: Array<{
    action: "create" | "update" | "withdraw"
    name: string
    context: string
    kind?: string
    key_semantics?: string
  }>
  relations?: Array<{
    action: "create" | "update" | "withdraw"
    from: string
    to: string
    relation: string
    key_semantics?: string
  }>
  contexts?: Array<{
    action: "create"
    name: string
    key_semantics?: string
  }>
  prototypes?: Array<{
    action: "create" | "update"
    name: string
    key_semantics?: string
  }>
}

export interface Input {
  mode: "cognition" | "judge" | "refine" | "summarize" | "review-save"
  request: string
  source: "chat" | "visual-editor"
  userInput: string
  temporaryWorkingSet: TemporaryWorkingSet
  activeWorkingSet: ActiveWorkingSet
  graphState: DesignTypes.GraphState
  knownVersion?: number
  changePlan?: ChangePlan
  force?: boolean
  visualEditorDelta?: GraphDelta
}

export interface Insight {
  kind: "concept" | "relation" | "principle" | "warning" | "suggestion"
  subject?: string
  description: string
  references?: string[]
}

export interface Output {
  type: "cognition" | "change-applied" | "abandoned" | "rejected" | "needs-clarification"
  summary: string
  insights?: Insight[]
  proposal?: {
    intent: string
    rationale: string
    warnings: Array<{
      code: string
      message: string
      nodeId?: string
      edgeKey?: string
    }>
    affectedNodes: string[]
    affectedEdges: string[]
    plan: ChangePlan
  }
  appliedChange?: {
    version: number
    affectedNodes: string[]
    affectedEdges: string[]
    affectedContexts: string[]
    summary: string
  }
  questions?: string[]
}

export * as GraphAgent from "./types"
