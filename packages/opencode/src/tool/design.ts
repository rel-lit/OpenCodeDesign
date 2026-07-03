import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Design } from "@/design/design"
import * as GraphAgentTypes from "@/design/agent/types"
import { DesignTypes } from "@/design/core/types"

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
      description:
        "Resolve a concept reference by name or alias. If it does not exist, create it automatically in the active or default context. Use this as the default way to mention concepts.",
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
      description:
        "Create a new bounded context for grouping semantically related nodes. Every node must belong to exactly one context.",
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

const ListContextsParameters = Schema.Struct({})

export const DesignListContextsTool = Tool.define<
  typeof ListContextsParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_list_contexts",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "List all bounded contexts in the design graph.",
      parameters: ListContextsParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const contexts = yield* design.listContexts()
          const lines = contexts.map((c) => `- ${c.name} (${c.id})${c.semantics ? `: ${c.semantics}` : ""}`)
          return {
            title: "Contexts",
            output: lines.join("\n") || "No contexts yet.",
            metadata: { count: contexts.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const GetContextParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "ID of the bounded context" }),
})

export const DesignGetContextTool = Tool.define<typeof GetContextParameters, Record<string, unknown>, Design.Service>(
  "design_get_context",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Get a bounded context by ID.",
      parameters: GetContextParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const context = yield* design.getContext(args.id)
          if (!context) {
            return { title: "Context not found", output: `No context with ID ${args.id}`, metadata: {} }
          }
          return {
            title: `Context ${context.name}`,
            output: `ID: ${context.id}\nName: ${context.name}\nSemantics: ${context.semantics}`,
            metadata: { context },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const UpdateContextParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "ID of the bounded context" }),
  name: Schema.optional(Schema.String).annotate({ description: "New context name" }),
  semantics: Schema.optional(Schema.String).annotate({ description: "New semantics description" }),
})

export const DesignUpdateContextTool = Tool.define<
  typeof UpdateContextParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_update_context",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Update the name or semantics of a bounded context.",
      parameters: UpdateContextParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const context = yield* design.updateContext(args.id, {
            name: args.name,
            semantics: args.semantics,
          })
          return {
            title: `Updated context ${context.name}`,
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
      description:
        "Create a new node explicitly in a specific context. Prefer design_resolve_reference unless you need exact control over context or aliases.",
      parameters: CreateNodeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const nodeId = crypto.randomUUID()
          const delta: GraphAgentTypes.GraphDelta = {
            addNodes: [{
              id: nodeId,
              name: args.name,
              contextId: args.contextId,
              kind: "node",
              aliases: args.aliases ? [...args.aliases] : [],
              defaultSemantics: args.defaultSemantics ?? "",
              connectedEdges: [],
              createdAt: 0,
              updatedAt: 0,
              retired: false,
            }],
          }
          const result = yield* design.proposeChanges(delta)
          const created = result.delta?.addNodes?.[0]
          return {
            title: `Created node ${created?.name ?? args.name}`,
            output: `Node ${created?.name ?? args.name} (${created?.id ?? nodeId}) in context ${args.contextId}`,
            metadata: { nodeId: created?.id ?? nodeId },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const GetNodeParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "ID of the node" }),
})

export const DesignGetNodeTool = Tool.define<typeof GetNodeParameters, Record<string, unknown>, Design.Service>(
  "design_get_node",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Get a node by ID.",
      parameters: GetNodeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const node = yield* design.getNode(args.id)
          if (!node) {
            return { title: "Node not found", output: `No node with ID ${args.id}`, metadata: {} }
          }
          return {
            title: `Node ${node.name}`,
            output: `ID: ${node.id}\nName: ${node.name}\nAliases: ${node.aliases.join(", ") || "none"}\nContext: ${node.contextId}\nSemantics: ${node.defaultSemantics}`,
            metadata: { node },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const UpdateNodeParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "ID of the node" }),
  name: Schema.optional(Schema.String).annotate({ description: "New node name" }),
  defaultSemantics: Schema.optional(Schema.String).annotate({ description: "New semantic description" }),
  aliases: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "New list of aliases" }),
  contextId: Schema.optional(Schema.String).annotate({ description: "ID of a different context to move the node to" }),
})

export const DesignUpdateNodeTool = Tool.define<
  typeof UpdateNodeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_update_node",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Update a node's name, semantics, aliases, or context.",
      parameters: UpdateNodeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const patch = {} as Record<string, unknown>
          if (args.name !== undefined) patch.name = args.name
          if (args.defaultSemantics !== undefined) patch.defaultSemantics = args.defaultSemantics
          if (args.aliases !== undefined) patch.aliases = [...args.aliases]
          if (args.contextId !== undefined) patch.contextId = args.contextId
          const delta: GraphAgentTypes.GraphDelta = {
            updateNodes: [{ id: args.id, patch: patch as Partial<DesignTypes.Node> }],
          }
          const result = yield* design.proposeChanges(delta)
          const updated = result.delta?.updateNodes?.[0]
          const semanticsPart = updated?.patch.defaultSemantics ? `; semantics: ${updated.patch.defaultSemantics}` : ""
          return {
            title: `Updated node ${updated?.patch.name ?? args.id}`,
            output: `Node ${updated?.patch.name ?? args.id} (${args.id})${semanticsPart}`,
            metadata: { nodeId: args.id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const RetireNodeParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "ID of the node" }),
  retired: Schema.Boolean.annotate({ description: "True to retire, false to unretire" }),
})

export const DesignRetireNodeTool = Tool.define<
  typeof RetireNodeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_retire_node",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Mark a node as retired (or unretire it). Retired nodes stay in the graph but are excluded from active design work.",
      parameters: RetireNodeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const delta: GraphAgentTypes.GraphDelta = {
            updateNodes: [{ id: args.id, patch: { retired: args.retired } }],
          }
          const result = yield* design.proposeChanges(delta)
          const updated = result.delta?.updateNodes?.[0]
          const retired = updated?.patch.retired ?? args.retired
          return {
            title: `${retired ? "Retired" : "Unretired"} node ${args.id}`,
            output: `Node ${args.id}`,
            metadata: { nodeId: args.id, retired },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const DeleteNodeParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "ID of the node" }),
})

export const DesignDeleteNodeTool = Tool.define<
  typeof DeleteNodeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_delete_node",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Permanently delete a node and all its connected edges. Use with caution.",
      parameters: DeleteNodeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const delta: GraphAgentTypes.GraphDelta = { deleteNodeIds: [args.id] }
          yield* design.proposeChanges(delta)
          return {
            title: "Deleted node",
            output: `Node ${args.id} and its connected edges removed.`,
            metadata: { nodeId: args.id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const FindNodesByNameParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "Name or alias to search for" }),
  contextId: Schema.optional(Schema.String).annotate({ description: "Optional context ID to limit the search" }),
})

export const DesignFindNodesByNameTool = Tool.define<
  typeof FindNodesByNameParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_find_nodes_by_name",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Find nodes by name or alias, optionally restricted to a context.",
      parameters: FindNodesByNameParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const nodes = yield* design.findNodesByName(args.name, args.contextId)
          const lines = nodes.map((n) => `- ${n.name} (${n.id}) [ctx: ${n.contextId}]`)
          return {
            title: `Search results for "${args.name}"`,
            output: lines.join("\n") || "No matching nodes.",
            metadata: { count: nodes.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const CreateEdgeParameters = Schema.Struct({
  leftNodeId: Schema.String.annotate({ description: "ID of the left/source node" }),
  rightNodeId: Schema.String.annotate({ description: "ID of the right/target node" }),
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
      description:
        "Create or replace an edge between two nodes. Only one edge can exist between a node pair. Use the 'aggregate' prototype for whole-part relationships unless another prototype is clearly more appropriate.",
      parameters: CreateEdgeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const delta: GraphAgentTypes.GraphDelta = {
            addEdges: [{
              leftNodeId: args.leftNodeId,
              rightNodeId: args.rightNodeId,
              prototypeId: args.prototypeId,
              parameters: args.parameters ?? {},
              createdAt: 0,
              updatedAt: 0,
            }],
          }
          const result = yield* design.proposeChanges(delta)
          const edge = result.delta?.addEdges?.[0]
          return {
            title: `Created edge`,
            output: `Edge ${edge?.leftNodeId ?? args.leftNodeId} --[${edge?.prototypeId ?? args.prototypeId}]--> ${edge?.rightNodeId ?? args.rightNodeId}`,
            metadata: {
              leftNodeId: edge?.leftNodeId ?? args.leftNodeId,
              rightNodeId: edge?.rightNodeId ?? args.rightNodeId,
              prototypeId: edge?.prototypeId ?? args.prototypeId,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const UpdateEdgeParameters = Schema.Struct({
  leftNodeId: Schema.String.annotate({ description: "ID of the left/source node" }),
  rightNodeId: Schema.String.annotate({ description: "ID of the right/target node" }),
  prototypeId: Schema.optional(Schema.String).annotate({ description: "New relation prototype ID" }),
  parameters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "New edge parameters",
  }),
})

export const DesignUpdateEdgeTool = Tool.define<
  typeof UpdateEdgeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_update_edge",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Update the prototype or parameters of an existing edge.",
      parameters: UpdateEdgeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const patch = {} as Record<string, unknown>
          if (args.prototypeId !== undefined) patch.prototypeId = args.prototypeId
          if (args.parameters !== undefined) patch.parameters = args.parameters
          const delta: GraphAgentTypes.GraphDelta = {
            updateEdges: [{
              leftNodeId: args.leftNodeId,
              rightNodeId: args.rightNodeId,
              patch: patch as Partial<DesignTypes.Edge>,
            }],
          }
          yield* design.proposeChanges(delta)
          const edges = yield* design.listEdges()
          const edge = edges.find(
            (e) => e.leftNodeId === args.leftNodeId && e.rightNodeId === args.rightNodeId,
          )
          return {
            title: `Updated edge`,
            output: `Edge ${args.leftNodeId} --[${edge?.prototypeId ?? args.prototypeId}]--> ${args.rightNodeId}`,
            metadata: {
              leftNodeId: args.leftNodeId,
              rightNodeId: args.rightNodeId,
              prototypeId: edge?.prototypeId ?? args.prototypeId,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const DeleteEdgeParameters = Schema.Struct({
  leftNodeId: Schema.String.annotate({ description: "ID of the left/source node" }),
  rightNodeId: Schema.String.annotate({ description: "ID of the right/target node" }),
})

export const DesignDeleteEdgeTool = Tool.define<
  typeof DeleteEdgeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_delete_edge",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Delete an edge between two nodes.",
      parameters: DeleteEdgeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const delta: GraphAgentTypes.GraphDelta = {
            deleteEdgeKeys: [DesignTypes.edgeKey(args.leftNodeId, args.rightNodeId)],
          }
          yield* design.proposeChanges(delta)
          return {
            title: "Deleted edge",
            output: `Edge ${args.leftNodeId} <-> ${args.rightNodeId} removed.`,
            metadata: { leftNodeId: args.leftNodeId, rightNodeId: args.rightNodeId },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const CreatePrototypeParameters = Schema.Struct({
  id: Schema.optional(Schema.String).annotate({ description: "Optional explicit prototype ID" }),
  name: Schema.String.annotate({ description: "Prototype display name" }),
  defaultSemantics: Schema.optional(Schema.String).annotate({ description: "Default meaning of this relation" }),
  parameterSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Schema for edge parameters",
  }),
})

export const DesignCreatePrototypeTool = Tool.define<
  typeof CreatePrototypeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_create_prototype",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description:
        "Create a new relation prototype (e.g., aggregate, compose, depend, inherit). Prototypes define the types of edges you can draw between nodes.",
      parameters: CreatePrototypeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const proto = yield* design.createPrototype({
            id: args.id,
            name: args.name,
            defaultSemantics: args.defaultSemantics,
            parameterSchema: args.parameterSchema,
          })
          return {
            title: `Created prototype ${proto.name}`,
            output: `Prototype ${proto.name} (${proto.id})`,
            metadata: { prototypeId: proto.id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ListPrototypesParameters = Schema.Struct({})

export const DesignListPrototypesTool = Tool.define<
  typeof ListPrototypesParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_list_prototypes",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "List all relation prototypes available in the design graph.",
      parameters: ListPrototypesParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const prototypes = yield* design.listPrototypes()
          const lines = prototypes.map((p) => `- ${p.name} (${p.id})`)
          return {
            title: "Prototypes",
            output: lines.join("\n") || "No prototypes yet.",
            metadata: { count: prototypes.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const GetPrototypeParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "ID of the prototype" }),
})

export const DesignGetPrototypeTool = Tool.define<
  typeof GetPrototypeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_get_prototype",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Get a relation prototype by ID.",
      parameters: GetPrototypeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const proto = yield* design.getPrototype(args.id)
          if (!proto) {
            return { title: "Prototype not found", output: `No prototype with ID ${args.id}`, metadata: {} }
          }
          return {
            title: `Prototype ${proto.name}`,
            output: `ID: ${proto.id}\nName: ${proto.name}\nSemantics: ${proto.defaultSemantics}`,
            metadata: { prototype: proto },
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

const ActivateContextParameters = Schema.Struct({
  contextId: Schema.String.annotate({ description: "ID of the context to activate" }),
})

export const DesignActivateContextTool = Tool.define<
  typeof ActivateContextParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_activate_context",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Activate a context in the working set. New references without an explicit context will prefer the most recently activated context.",
      parameters: ActivateContextParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          yield* design.activateContext(args.contextId)
          return {
            title: "Activated context",
            output: `Context ${args.contextId} is now active in the working set.`,
            metadata: { contextId: args.contextId },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ActivateNodeParameters = Schema.Struct({
  nodeId: Schema.String.annotate({ description: "ID of the node to activate" }),
})

export const DesignActivateNodeTool = Tool.define<
  typeof ActivateNodeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_activate_node",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Activate a node in the working set.",
      parameters: ActivateNodeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          yield* design.activateNode(args.nodeId)
          return {
            title: "Activated node",
            output: `Node ${args.nodeId} is now active in the working set.`,
            metadata: { nodeId: args.nodeId },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const GetStateParameters = Schema.Struct({})

export const DesignGetStateTool = Tool.define<
  typeof GetStateParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_get_state",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Get the full current design graph state (contexts, nodes, edges, prototypes, working set, event log).",
      parameters: GetStateParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getState()
          return {
            title: "Design state",
            output: `Contexts: ${state.contexts.length}\nNodes: ${state.nodes.length}\nEdges: ${state.edges.length}\nPrototypes: ${state.prototypes.length}\nEvents: ${state.eventLog?.events.length ?? 0}`,
            metadata: { state },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
