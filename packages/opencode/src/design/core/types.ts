import { Schema } from "effect"

export const Node = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  aliases: Schema.Array(Schema.String),
  contextId: Schema.String,
  defaultSemantics: Schema.String,
  connectedEdges: Schema.Array(Schema.Struct({
    leftNodeId: Schema.String,
    rightNodeId: Schema.String,
    prototypeId: Schema.String,
  })),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  retired: Schema.Boolean,
})
export type Node = Schema.Schema.Type<typeof Node>

export const EdgeParameters = Schema.Record(Schema.String, Schema.Unknown)
export type EdgeParameters = Schema.Schema.Type<typeof EdgeParameters>

export const Edge = Schema.Struct({
  leftNodeId: Schema.String,
  rightNodeId: Schema.String,
  prototypeId: Schema.String,
  parameters: EdgeParameters,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type Edge = Schema.Schema.Type<typeof Edge>

export const RelationPrototype = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  defaultSemantics: Schema.String,
  parameterSchema: Schema.Record(Schema.String, Schema.Unknown),
})
export type RelationPrototype = Schema.Schema.Type<typeof RelationPrototype>

export const BoundedContext = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  semantics: Schema.String,
  nodeIds: Schema.Array(Schema.String),
})
export type BoundedContext = Schema.Schema.Type<typeof BoundedContext>

export const WorkingSet = Schema.Struct({
  activeContextIds: Schema.Array(Schema.String),
  activeNodeIds: Schema.Array(Schema.String),
  capacity: Schema.Number,
})
export type WorkingSet = Schema.Schema.Type<typeof WorkingSet>

export const EventType = Schema.Literals([
  "node_created",
  "node_updated",
  "node_retired",
  "node_unretired",
  "node_deleted",
  "edge_created",
  "edge_updated",
  "edge_deleted",
  "prototype_created",
  "prototype_updated",
  "context_created",
  "context_updated",
  "working_set_changed",
  "event_rollback",
])
export type EventType = Schema.Schema.Type<typeof EventType>

export const EventNode = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  contextId: Schema.Literal("event-log"),
  aliases: Schema.Array(Schema.String),
  defaultSemantics: Schema.String,
  connectedEdges: Schema.Array(Schema.Struct({
    leftNodeId: Schema.String,
    rightNodeId: Schema.String,
    prototypeId: Schema.String,
  })),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  retired: Schema.Boolean,
  eventType: EventType,
  timestamp: Schema.Number,
  affectedNodeIds: Schema.Array(Schema.String),
  affectedEdgeKeys: Schema.Array(Schema.String),
  rollbackTarget: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
})
export type EventNode = Schema.Schema.Type<typeof EventNode>

export const EventLog = Schema.Struct({
  events: Schema.Array(EventNode),
})
export type EventLog = Schema.Schema.Type<typeof EventLog>

export const GraphState = Schema.Struct({
  nodes: Schema.Array(Node),
  edges: Schema.Array(Edge),
  prototypes: Schema.Array(RelationPrototype),
  contexts: Schema.Array(BoundedContext),
  workingSet: Schema.optional(WorkingSet),
  eventLog: Schema.optional(EventLog),
})
export type GraphState = Schema.Schema.Type<typeof GraphState>

export const edgeKey = (leftNodeId: string, rightNodeId: string): string =>
  leftNodeId < rightNodeId ? `${leftNodeId}::${rightNodeId}` : `${rightNodeId}::${leftNodeId}`

export * as DesignTypes from "./types"
