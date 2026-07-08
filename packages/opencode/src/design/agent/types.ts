import { DesignTypes } from "@/design/core/types"

export interface WorkingSetEntry {
  id: string
  name: string
  type: "context" | "node"
  briefSemantics: string
}

export type BufferOperationType =
  | "create_context"
  | "update_context"
  | "delete_context"
  | "create_node"
  | "update_node"
  | "delete_node"
  | "create_edge"
  | "update_edge"
  | "delete_edge"
  | "create_prototype"
  | "update_prototype"
  | "delete_prototype"

export interface BufferOperation {
  id: string
  type: BufferOperationType
  description: string
  payload: unknown
}

export interface GraphDelta {
  addContexts?: Array<{ id: string; name: string; semantics?: string }>
  updateContexts?: Array<{ id: string; patch: { name?: string; semantics?: string } }>
  deleteContextIds?: string[]
  addNodes?: NodeInput[]
  updateNodes?: Array<{ id: string; patch: Partial<NodeInput> }>
  deleteNodeIds?: string[]
  addEdges?: EdgeInput[]
  updateEdges?: Array<{ leftNodeId: string; rightNodeId: string; patch: Partial<EdgeInput> }>
  deleteEdgeKeys?: string[]
  addPrototypes?: Array<{ id: string; name: string; defaultSemantics?: string; parameterSchema?: Record<string, unknown> }>
  updatePrototypes?: Array<{
    id: string
    patch: { name?: string; defaultSemantics?: string; parameterSchema?: Record<string, unknown> }
  }>
  deletePrototypeIds?: string[]
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
    left: string
    right: string
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
  mode: "cognition" | "change" | "summarize" | "review-save"
  request: string
  source: "chat" | "visual-editor"
  userInput: string
  activeWorkingSet: WorkingSetEntry[]
  knownVersion?: number
  visualEditorDelta?: GraphDelta
}

export interface Insight {
  kind: "concept" | "relation" | "principle" | "warning" | "suggestion"
  subject?: string
  description: string
  references?: string[]
}

export interface Output {
  type: "cognition" | "change-applied" | "change-forced" | "abandoned" | "rejected"
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
    affectedPrototypes: string[]
    operations: BufferOperation[]
    summary: string
  }
  questions?: string[]
}

export * as GraphAgent from "./types"