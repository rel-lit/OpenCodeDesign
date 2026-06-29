import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Design } from "@/design/design"

const ResolveReferenceParameters = Schema.Struct({
  reference: Schema.String.annotate({ description: "The concept name or alias to resolve" }),
  contextId: Schema.optional(Schema.String).annotate({
    description: "Optional context ID to disambiguate the reference",
  }),
})

export const DesignResolveReferenceTool = Tool.define<
  typeof ResolveReferenceParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_resolve_reference",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Resolve a concept reference. If the concept does not exist, create it automatically.",
      parameters: ResolveReferenceParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const result = yield* design.resolveReference(args)
          return {
            title: `Resolved ${args.reference}`,
            output: `${result.action === "created" ? "Created" : "Matched"} node ${result.fullName} (${result.nodeId})`,
            metadata: { action: result.action, nodeId: result.nodeId, fullName: result.fullName },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const CreateContextParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The context name" }),
  semantics: Schema.optional(Schema.String).annotate({ description: "Description of the context's semantics" }),
})

export const DesignCreateContextTool = Tool.define<
  typeof CreateContextParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_create_context",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Create a new bounded context for grouping semantically related nodes.",
      parameters: CreateContextParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const context = yield* design.createContext({
            name: args.name,
            semantics: args.semantics,
          })
          return {
            title: `Created context ${context.name}`,
            output: `Context ${context.name} (${context.id})`,
            metadata: { contextId: context.id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const CreateNodeParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The node's referential name" }),
  contextId: Schema.String.annotate({ description: "ID of the bounded context" }),
  defaultSemantics: Schema.optional(Schema.String).annotate({ description: "Default semantic description" }),
  aliases: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Alternative names" }),
})

export const DesignCreateNodeTool = Tool.define<
  typeof CreateNodeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_create_node",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Create a new node explicitly.",
      parameters: CreateNodeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const node = yield* design.createNode({
            name: args.name,
            contextId: args.contextId,
            defaultSemantics: args.defaultSemantics,
            aliases: args.aliases ? [...args.aliases] : undefined,
          })
          return {
            title: `Created node ${node.name}`,
            output: `Node ${node.name} (${node.id}) in context ${node.contextId}`,
            metadata: { nodeId: node.id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const CreateEdgeParameters = Schema.Struct({
  leftNodeId: Schema.String.annotate({ description: "ID of the left node" }),
  rightNodeId: Schema.String.annotate({ description: "ID of the right node" }),
  prototypeId: Schema.String.annotate({ description: "ID of the relation prototype" }),
  parameters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Edge parameters including semantics overrides",
  }),
})

export const DesignCreateEdgeTool = Tool.define<
  typeof CreateEdgeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_create_edge",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Create or update an edge between two nodes. Only one edge can exist between a node pair.",
      parameters: CreateEdgeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const edge = yield* design.createEdge({
            leftNodeId: args.leftNodeId,
            rightNodeId: args.rightNodeId,
            prototypeId: args.prototypeId,
            parameters: args.parameters ?? {},
          })
          return {
            title: `Created edge`,
            output: `Edge ${edge.leftNodeId} --[${edge.prototypeId}]--> ${edge.rightNodeId}`,
            metadata: { leftNodeId: edge.leftNodeId, rightNodeId: edge.rightNodeId, prototypeId: edge.prototypeId },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ListNodesParameters = Schema.Struct({})

export const DesignListNodesTool = Tool.define<
  typeof ListNodesParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_list_nodes",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "List all nodes in the design graph.",
      parameters: ListNodesParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const nodes = yield* design.listNodes()
          const lines = nodes.map((n) => `- ${n.name} (${n.id}) [ctx: ${n.contextId}]${n.retired ? " [retired]" : ""}`)
          return {
            title: "Nodes",
            output: lines.join("\n") || "No nodes yet.",
            metadata: { count: nodes.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ListEdgesParameters = Schema.Struct({})

export const DesignListEdgesTool = Tool.define<
  typeof ListEdgesParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_list_edges",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "List all edges in the design graph.",
      parameters: ListEdgesParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const edges = yield* design.listEdges()
          const lines = edges.map((e) => `- ${e.leftNodeId} --[${e.prototypeId}]--> ${e.rightNodeId}`)
          return {
            title: "Edges",
            output: lines.join("\n") || "No edges yet.",
            metadata: { count: edges.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ShowWorkingSetParameters = Schema.Struct({})

export const DesignShowWorkingSetTool = Tool.define<
  typeof ShowWorkingSetParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_show_working_set",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Show the current working set of active nodes and contexts.",
      parameters: ShowWorkingSetParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const ws = yield* design.listWorkingSet()
          return {
            title: "Working Set",
            output: `Active contexts: ${ws.contextIds.join(", ") || "none"}\nActive nodes: ${ws.nodeIds.join(", ") || "none"}`,
            metadata: ws,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
