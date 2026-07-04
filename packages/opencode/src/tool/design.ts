import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Design } from "@/design/design"
import { VersionSync } from "@/design/system/version-sync"
import { TaskTool } from "./task"
import { Agent } from "@/agent/agent"
import { Truncate } from "./truncate"
import { DesignTypes } from "@/design/core/types"
import * as GraphAgentTypes from "@/design/agent/types"

const designToolDescription = (description: string) =>
  `${description} (Design graph semantic tool; only the design-graph subagent may use this.)`
const chatToolDescription = (description: string) => `${description} (Design mode ChatAgent tool.)`

const AskGraphParameters = Schema.Struct({
  question: Schema.String.annotate({ description: "A design question for the design-graph subagent" }),
})

export const DesignAskGraphTool = Tool.define(
  "design_ask_graph",
  Effect.gen(function* () {
    const task = yield* Tool.init(yield* TaskTool)
    const design = yield* Design.Service
    return {
      description: chatToolDescription(
        "Ask the design-graph subagent for design cognition about the current design graph.",
      ),
      parameters: AskGraphParameters,
      execute: (args: Schema.Schema.Type<typeof AskGraphParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const result = yield* task.execute(
            {
              description: "Design cognition",
              subagent_type: "design-graph",
              prompt: yield* buildGraphAgentPrompt({ design, mode: "cognition", request: args.question, ctx }),
            },
            ctx,
          )
          yield* design.bumpVersion("chat-agent")
          return {
            title: "Design cognition",
            output: result.output,
            metadata: {
              ...result.metadata,
              subagent_type: "design-graph",
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)

const RequestChangeParameters = Schema.Struct({
  intent: Schema.String.annotate({ description: "Natural-language design change intent" }),
})

export const DesignRequestChangeTool = Tool.define(
  "design_request_change",
  Effect.gen(function* () {
    const task = yield* Tool.init(yield* TaskTool)
    const design = yield* Design.Service
    return {
      description: chatToolDescription(
        "Request a design change. The design-graph subagent will analyze the graph, build a Change Plan, ask the user for approval, and execute the change if approved.",
      ),
      parameters: RequestChangeParameters,
      execute: (args: Schema.Schema.Type<typeof RequestChangeParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const sync = yield* design.checkChatAgentSync().pipe(
            Effect.catchTag("DesignStaleContextError" as const, (error) => Effect.succeed(error)),
          )
          if (sync instanceof VersionSync.StaleContextError) {
            return {
              title: "Design sync required",
              output: sync.message,
              metadata: { syncRequired: true } as Record<string, unknown>,
            }
          }
          const result = yield* task.execute(
            {
              description: "Design change request",
              subagent_type: "design-graph",
              prompt: yield* buildGraphAgentPrompt({ design, mode: "judge", request: args.intent, ctx }),
            },
            ctx,
          )
          return {
            title: "Design change request",
            output: result.output,
            metadata: {
              ...result.metadata,
              subagent_type: "design-graph",
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)

const SummarizeDesignParameters = Schema.Struct({})

export const DesignSummarizeDesignTool = Tool.define(
  "design_summarize_design",
  Effect.gen(function* () {
    const task = yield* Tool.init(yield* TaskTool)
    const design = yield* Design.Service
    return {
      description: chatToolDescription(
        "Ask the design-graph subagent for a natural-language summary of the current design.",
      ),
      parameters: SummarizeDesignParameters,
      execute: (args: Schema.Schema.Type<typeof SummarizeDesignParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const result = yield* task.execute(
            {
              description: "Design summary",
              subagent_type: "design-graph",
              prompt: yield* buildGraphAgentPrompt({
                design,
                mode: "summarize",
                request: "Summarize the current design.",
                ctx,
              }),
            },
            ctx,
          )
          yield* design.bumpVersion("chat-agent")
          return {
            title: "Design summary",
            output: result.output,
            metadata: {
              ...result.metadata,
              subagent_type: "design-graph",
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)

const SearchProjectParameters = Schema.Struct({
  intent: Schema.String.annotate({ description: "What to search for in the project and how it relates to the design" }),
})

export const DesignSearchProjectTool = Tool.define(
  "design_search_project",
  Effect.gen(function* () {
    const task = yield* Tool.init(yield* TaskTool)
    return {
      description: chatToolDescription(
        "Ask the design-search subagent to read the project and compare it with the current design.",
      ),
      parameters: SearchProjectParameters,
      execute: (args: Schema.Schema.Type<typeof SearchProjectParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const result = yield* task.execute(
            {
              description: "Design project search",
              subagent_type: "design-search",
              prompt: args.intent,
            },
            ctx,
          )
          return {
            title: "Design project search",
            output: result.output,
            metadata: {
              ...result.metadata,
              subagent_type: "design-search",
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)

const SearchWebParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Web search query" }),
})

export const DesignSearchWebTool = Tool.define(
  "design_search_web",
  Effect.gen(function* () {
    const task = yield* Tool.init(yield* TaskTool)
    return {
      description: chatToolDescription(
        "Ask the design-search subagent to search the web for relevant design references.",
      ),
      parameters: SearchWebParameters,
      execute: (args: Schema.Schema.Type<typeof SearchWebParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const result = yield* task.execute(
            {
              description: "Design web search",
              subagent_type: "design-search",
              prompt: `Search the web for: ${args.query}`,
            },
            ctx,
          )
          return {
            title: "Design web search",
            output: result.output,
            metadata: {
              ...result.metadata,
              subagent_type: "design-search",
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)

function buildGraphAgentPrompt(input: {
  design: Design.Interface
  mode: "cognition" | "judge" | "summarize" | "review-save"
  request: string
  ctx: Tool.Context
}): Effect.Effect<string> {
  return Effect.gen(function* () {
    const activeWs = yield* input.design.listWorkingSet()
    const graphState = yield* input.design.getState()
    const version = yield* input.design.getCurrentVersion()
    const temporaryWorkingSet = yield* input.design.getTemporaryWorkingSet(input.ctx.sessionID)
    return JSON.stringify({
      mode: input.mode,
      request: input.request,
      source: "chat" as const,
      userInput: input.request,
      activeWorkingSet: {
        contextIds: activeWs.contextIds,
        nodeIds: activeWs.nodeIds,
        capacity: graphState.workingSet?.capacity ?? 20,
      },
      temporaryWorkingSet,
      graphState: {
        contexts: graphState.contexts,
        nodes: graphState.nodes,
        edges: graphState.edges,
        prototypes: graphState.prototypes,
      },
      knownVersion: version.sequence,
    })
  })
}

const WorksetGetParameters = Schema.Struct({})

export const DesignWorksetGetTool = Tool.define(
  "design_workset_get",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Get the current temporary working set for this subagent session."),
      parameters: WorksetGetParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const ws = yield* design.getTemporaryWorkingSet(ctx.sessionID)
          return {
            title: "Temporary working set",
            output: `Contexts: ${ws.contextIds.join(", ") || "none"}\nNodes: ${ws.nodeIds.join(", ") || "none"}`,
            metadata: { contextIds: ws.contextIds, nodeIds: ws.nodeIds, capacity: ws.capacity },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const WorksetAddParameters = Schema.Struct({
  nodeIds: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Node IDs to add" }),
  contextIds: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Context IDs to add" }),
})

export const DesignWorksetAddTool = Tool.define<
  typeof WorksetAddParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_workset_add",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Add nodes and/or contexts to the temporary working set."),
      parameters: WorksetAddParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          yield* design.updateTemporaryWorkingSet(ctx.sessionID, {
            addNodeIds: args.nodeIds ?? [],
            addContextIds: args.contextIds ?? [],
          })
          return {
            title: "Added to working set",
            output: `Added nodes: ${(args.nodeIds ?? []).join(", ") || "none"}; contexts: ${(args.contextIds ?? []).join(", ") || "none"}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const WorksetRemoveParameters = Schema.Struct({
  nodeIds: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Node IDs to remove" }),
  contextIds: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Context IDs to remove" }),
})

export const DesignWorksetRemoveTool = Tool.define<
  typeof WorksetRemoveParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_workset_remove",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Remove nodes and/or contexts from the temporary working set."),
      parameters: WorksetRemoveParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          yield* design.updateTemporaryWorkingSet(ctx.sessionID, {
            removeNodeIds: args.nodeIds ?? [],
            removeContextIds: args.contextIds ?? [],
          })
          return {
            title: "Removed from working set",
            output: `Removed nodes: ${(args.nodeIds ?? []).join(", ") || "none"}; contexts: ${(args.contextIds ?? []).join(", ") || "none"}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const WorksetExpandParameters = Schema.Struct({
  nodeId: Schema.String.annotate({ description: "Node ID whose neighbors should be added" }),
})

export const DesignWorksetExpandTool = Tool.define<
  typeof WorksetExpandParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_workset_expand",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Expand the temporary working set with a node's neighbors."),
      parameters: WorksetExpandParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          yield* design.expandTemporaryWorkingSet(ctx.sessionID, args.nodeId)
          return {
            title: "Expanded working set",
            output: `Expanded around node ${args.nodeId}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const GetDesignParameters = Schema.Struct({})

export const DesignGetDesignTool = Tool.define<
  typeof GetDesignParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_get_design",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Get a semantic overview of the current design graph."),
      parameters: GetDesignParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          const summary = yield* design.summarizeGraphState(state)
          return {
            title: "Design overview",
            output: summary,
            metadata: { state },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const GetContextParameters = Schema.Struct({
  name_or_id: Schema.String.annotate({ description: "Context name or ID" }),
})

export const DesignGetContextTool = Tool.define<
  typeof GetContextParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_get_context",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Get a bounded context and its concepts."),
      parameters: GetContextParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          const context = state.contexts.find((c) => c.id === args.name_or_id || c.name === args.name_or_id)
          if (!context) {
            return { title: "Context not found", output: `No context matching "${args.name_or_id}"`, metadata: {} }
          }
          const contextNodes = state.nodes.filter((n) => n.contextId === context.id)
          const lines = [
            `Context: ${context.name} (${context.id})`,
            `Semantics: ${context.semantics || "none"}`,
            "Concepts:",
            ...contextNodes.map((n) => `- ${n.name} (${n.id})`),
          ]
          return {
            title: `Context ${context.name}`,
            output: lines.join("\n"),
            metadata: { context, nodes: contextNodes },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const GetConceptParameters = Schema.Struct({
  name_or_id: Schema.String.annotate({ description: "Concept name or ID" }),
})

export const DesignGetConceptTool = Tool.define<
  typeof GetConceptParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_get_concept",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Get a concept's semantics, relations, and neighboring concepts."),
      parameters: GetConceptParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          const node = state.nodes.find(
            (n) => n.id === args.name_or_id || n.name === args.name_or_id || n.aliases.includes(args.name_or_id),
          )
          if (!node) {
            return { title: "Concept not found", output: `No concept matching "${args.name_or_id}"`, metadata: {} }
          }
          const edges = state.edges.filter((e) => e.leftNodeId === node.id || e.rightNodeId === node.id)
          const related = edges.map((e) => {
            const otherId = e.leftNodeId === node.id ? e.rightNodeId : e.leftNodeId
            const other = state.nodes.find((n) => n.id === otherId)
            return `${other?.name ?? otherId} via ${e.prototypeId}`
          })
          const lines = [
            `Concept: ${node.name} (${node.id})`,
            `Kind: ${node.kind}`,
            `Aliases: ${node.aliases.join(", ") || "none"}`,
            `Semantics: ${node.defaultSemantics || "none"}`,
            "Relations:",
            ...related.map((r) => `- ${r}`),
          ]
          return {
            title: `Concept ${node.name}`,
            output: lines.join("\n"),
            metadata: { node, edges },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const FindConceptsParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Name, alias, or semantic search query" }),
})

export const DesignFindConceptsTool = Tool.define<
  typeof FindConceptsParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_find_concepts",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Find concepts by name, alias, or semantics."),
      parameters: FindConceptsParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          const nodes = state.nodes.filter(
            (n) => n.name === args.query || n.aliases.includes(args.query) || n.defaultSemantics.includes(args.query),
          )
          const lines = nodes.map((n) => `- ${n.name} (${n.id}) [ctx: ${n.contextId}]`)
          return {
            title: `Concept search: "${args.query}"`,
            output: lines.join("\n") || "No matching concepts.",
            metadata: { count: nodes.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const GetRelationsParameters = Schema.Struct({
  concept_id: Schema.String.annotate({ description: "Concept ID" }),
})

export const DesignGetRelationsTool = Tool.define<
  typeof GetRelationsParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_get_relations",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Get all relations for a concept."),
      parameters: GetRelationsParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          const edges = state.edges.filter((e) => e.leftNodeId === args.concept_id || e.rightNodeId === args.concept_id)
          const lines = edges.map(
            (e) =>
              `- ${e.leftNodeId} --[${e.prototypeId}]--> ${e.rightNodeId} (${JSON.stringify(e.parameters ?? {})})`,
          )
          return {
            title: "Relations",
            output: lines.join("\n") || "No relations.",
            metadata: { count: edges.length },
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
      description: designToolDescription("List all relation prototypes."),
      parameters: ListPrototypesParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const prototypes = yield* design.listPrototypes()
          const lines = prototypes.map((p) => `- ${p.name} (${p.id}): ${p.defaultSemantics || "no semantics"}`)
          return {
            title: "Relation prototypes",
            output: lines.join("\n") || "No prototypes.",
            metadata: { count: prototypes.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ResolveReferenceParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Concept name, alias, or partial reference to resolve" }),
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
      description: designToolDescription("Resolve a fuzzy reference to the best matching concept or context."),
      parameters: ResolveReferenceParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const result = yield* design.resolveReference({ reference: args.query })
          return {
            title: `Resolved "${args.query}"`,
            output: `${result.action === "created" ? "Created" : "Matched"} ${result.fullName} (${result.nodeId})`,
            metadata: { action: result.action, nodeId: result.nodeId, fullName: result.fullName },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const DefineContextParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "Context name" }),
  semantics: Schema.optional(Schema.String).annotate({ description: "Context semantics" }),
})

export const DesignDefineContextTool = Tool.define<
  typeof DefineContextParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_define_context",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Define a new bounded context."),
      parameters: DefineContextParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const context = yield* design.createContext({ name: args.name, semantics: args.semantics })
          return {
            title: `Defined context ${context.name}`,
            output: `Context ${context.name} (${context.id})`,
            metadata: { contextId: context.id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const DefineConceptParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "Concept name" }),
  context: Schema.String.annotate({ description: "Context name or ID" }),
  kind: Schema.optional(Schema.String).annotate({ description: "Concept kind" }),
  semantics: Schema.optional(Schema.String).annotate({ description: "Detailed semantic description" }),
  aliases: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Alternative names" }),
})

export const DesignDefineConceptTool = Tool.define<
  typeof DefineConceptParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_define_concept",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Define a new concept in a context."),
      parameters: DefineConceptParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const context = yield* design.findContextByNameOrId(args.context)
          if (!context) {
            return { title: "Context not found", output: `No context matching "${args.context}"`, metadata: {} }
          }
          yield* design.addAccumulatedNode(ctx.sessionID, {
            name: args.name,
            contextId: context.id,
            kind: args.kind,
            defaultSemantics: args.semantics,
            aliases: args.aliases,
          })
          return {
            title: `Defined concept ${args.name}`,
            output: `Concept ${args.name} queued in context ${context.name}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const RefineConceptParameters = Schema.Struct({
  concept: Schema.String.annotate({ description: "Concept name or ID" }),
  semantics: Schema.optional(Schema.String).annotate({ description: "Updated semantic description" }),
  aliases: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Updated aliases" }),
  kind: Schema.optional(Schema.String).annotate({ description: "Updated kind" }),
})

export const DesignRefineConceptTool = Tool.define<
  typeof RefineConceptParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_refine_concept",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Refine an existing concept's semantics, aliases, or kind."),
      parameters: RefineConceptParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          const node = state.nodes.find(
            (n) => n.id === args.concept || n.name === args.concept || n.aliases.includes(args.concept),
          )
          if (!node) {
            return { title: "Concept not found", output: `No concept matching "${args.concept}"`, metadata: {} }
          }
          const patch: Record<string, unknown> = {}
          if (args.semantics !== undefined) patch.defaultSemantics = args.semantics
          if (args.aliases !== undefined) patch.aliases = [...args.aliases]
          if (args.kind !== undefined) patch.kind = args.kind
          yield* design.updateAccumulatedNode(ctx.sessionID, node.id, patch as Partial<GraphAgentTypes.NodeInput>)
          return {
            title: `Refined concept ${node.name}`,
            output: `Concept ${node.name} (${node.id}) queued for update`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const WithdrawConceptParameters = Schema.Struct({
  concept: Schema.String.annotate({ description: "Concept name or ID" }),
  cascade: Schema.optional(Schema.Boolean).annotate({ description: "Whether to also delete connected edges" }),
})

export const DesignWithdrawConceptTool = Tool.define<
  typeof WithdrawConceptParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_withdraw_concept",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Withdraw (delete) a concept from the design graph."),
      parameters: WithdrawConceptParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          const node = state.nodes.find(
            (n) => n.id === args.concept || n.name === args.concept || n.aliases.includes(args.concept),
          )
          if (!node) {
            return { title: "Concept not found", output: `No concept matching "${args.concept}"`, metadata: {} }
          }
          if (args.cascade) {
            const edges = state.edges.filter((e) => e.leftNodeId === node.id || e.rightNodeId === node.id)
            for (const edge of edges) {
              yield* design.deleteAccumulatedEdge(ctx.sessionID, edge.leftNodeId, edge.rightNodeId)
            }
          }
          yield* design.deleteAccumulatedNode(ctx.sessionID, node.id)
          return {
            title: `Withdrew concept ${node.name}`,
            output: `Concept ${node.name} (${node.id}) queued for removal.`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const RelateConceptsParameters = Schema.Struct({
  from: Schema.String.annotate({ description: "Source concept name or ID" }),
  to: Schema.String.annotate({ description: "Target concept name or ID" }),
  relation: Schema.String.annotate({ description: "Relation prototype name or ID" }),
  semantics: Schema.optional(Schema.String).annotate({ description: "Relation semantics override" }),
  constraints: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({ description: "Relation parameters" }),
})

export const DesignRelateConceptsTool = Tool.define<
  typeof RelateConceptsParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_relate_concepts",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Create or update a relation between two concepts."),
      parameters: RelateConceptsParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          const fromNode = state.nodes.find(
            (n) => n.id === args.from || n.name === args.from || n.aliases.includes(args.from),
          )
          if (!fromNode) {
            return { title: "Source concept not found", output: `No concept matching "${args.from}"`, metadata: {} }
          }
          const toNode = state.nodes.find(
            (n) => n.id === args.to || n.name === args.to || n.aliases.includes(args.to),
          )
          if (!toNode) {
            return { title: "Target concept not found", output: `No concept matching "${args.to}"`, metadata: {} }
          }
          const prototypes = yield* design.listPrototypes()
          const prototype = prototypes.find((p) => p.id === args.relation || p.name === args.relation)
          if (!prototype) {
            return { title: "Prototype not found", output: `No prototype matching "${args.relation}"`, metadata: {} }
          }
          const parameters: Record<string, unknown> = { ...(args.constraints ?? {}) }
          if (args.semantics !== undefined) parameters.semantics = args.semantics
          yield* design.addAccumulatedEdge(ctx.sessionID, {
            leftNodeId: fromNode.id,
            rightNodeId: toNode.id,
            prototypeId: prototype.id,
            parameters,
          })
          return {
            title: "Related concepts",
            output: `${fromNode.name} --[${prototype.name}]--> ${toNode.name} queued`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const WithdrawRelationParameters = Schema.Struct({
  from: Schema.String.annotate({ description: "Source concept name or ID" }),
  to: Schema.String.annotate({ description: "Target concept name or ID" }),
})

export const DesignWithdrawRelationTool = Tool.define<
  typeof WithdrawRelationParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_withdraw_relation",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Withdraw (delete) a relation between two concepts."),
      parameters: WithdrawRelationParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          const fromNode = state.nodes.find(
            (n) => n.id === args.from || n.name === args.from || n.aliases.includes(args.from),
          )
          if (!fromNode) {
            return { title: "Source concept not found", output: `No concept matching "${args.from}"`, metadata: {} }
          }
          const toNode = state.nodes.find(
            (n) => n.id === args.to || n.name === args.to || n.aliases.includes(args.to),
          )
          if (!toNode) {
            return { title: "Target concept not found", output: `No concept matching "${args.to}"`, metadata: {} }
          }
          yield* design.deleteAccumulatedEdge(ctx.sessionID, fromNode.id, toNode.id)
          return {
            title: "Withdrew relation",
            output: `${fromNode.name} <-> ${toNode.name} queued for removal`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const DefineRelationPrototypeParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "Prototype name" }),
  semantics: Schema.optional(Schema.String).annotate({ description: "Default semantics" }),
  constraints: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({ description: "Parameter schema" }),
})

export const DesignDefineRelationPrototypeTool = Tool.define<
  typeof DefineRelationPrototypeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_define_relation_prototype",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Define a new relation prototype."),
      parameters: DefineRelationPrototypeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const proto = yield* design.createPrototype({
            name: args.name,
            defaultSemantics: args.semantics,
            parameterSchema: args.constraints,
          })
          return {
            title: `Defined prototype ${proto.name}`,
            output: `Prototype ${proto.name} (${proto.id})`,
            metadata: { prototypeId: proto.id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ApplyChangesParameters = Schema.Struct({})

export const DesignApplyChangesTool = Tool.define<
  typeof ApplyChangesParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_apply_changes",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Apply all queued graph changes in this subagent session."),
      parameters: ApplyChangesParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          yield* design.applyAccumulatedChanges(ctx.sessionID)
          return {
            title: "Changes applied",
            output: "All queued changes have been applied to the design graph.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ClearChangesParameters = Schema.Struct({})

export const DesignClearChangesTool = Tool.define<
  typeof ClearChangesParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_clear_changes",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Discard all queued graph changes in this subagent session."),
      parameters: ClearChangesParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          yield* design.clearAccumulatedChanges(ctx.sessionID)
          return {
            title: "Changes cleared",
            output: "All queued changes have been discarded.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const ChatAgentDesignTools = [
  DesignAskGraphTool,
  DesignRequestChangeTool,
  DesignSummarizeDesignTool,
  DesignSearchProjectTool,
  DesignSearchWebTool,
]

export const GraphAgentDesignTools = {
  DesignResolveReferenceTool,
  DesignGetDesignTool,
  DesignGetContextTool,
  DesignGetConceptTool,
  DesignFindConceptsTool,
  DesignGetRelationsTool,
  DesignListPrototypesTool,
  DesignDefineContextTool,
  DesignDefineConceptTool,
  DesignRefineConceptTool,
  DesignWithdrawConceptTool,
  DesignRelateConceptsTool,
  DesignWithdrawRelationTool,
  DesignDefineRelationPrototypeTool,
  DesignWorksetGetTool,
  DesignWorksetAddTool,
  DesignWorksetRemoveTool,
  DesignWorksetExpandTool,
  DesignApplyChangesTool,
  DesignClearChangesTool,
}
