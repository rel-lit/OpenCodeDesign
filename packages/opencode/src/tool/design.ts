import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Design } from "@/design/design"
import { VersionSync } from "@/design/system/version-sync"
import { TaskTool } from "./task"
import { DesignTypes } from "@/design/core/types"
import * as GraphAgentTypes from "@/design/agent/types"
import { Question } from "@/question"

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
          const graphPrompt = yield* buildGraphAgentPrompt({ design, mode: "cognition", request: args.question, ctx })
          const result = yield* task.execute(
            {
              description: "Design cognition",
              subagent_type: "design-graph",
              prompt: graphPrompt,
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
  intent: Schema.String.annotate({
    description:
      "A concise 1-2 sentence design change intent. Keep it brief; the full user request is available to the subagent as context.",
  }),
})

const MAX_INTENT_PREVIEW_LENGTH = 80

function truncatePreview(text: string, maxLength: number) {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).replace(/\s+\S*$/, "") + "…"
}

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
          const graphPrompt = yield* buildGraphAgentPrompt({ design, mode: "judge", request: args.intent, ctx })
          const result = yield* task.execute(
            {
              description: truncatePreview(args.intent, MAX_INTENT_PREVIEW_LENGTH),
              subagent_type: "design-graph",
              prompt: graphPrompt,
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
          const graphPrompt = yield* buildGraphAgentPrompt({
            design,
            mode: "summarize",
            request: "Summarize the current design.",
            ctx,
          })
          const result = yield* task.execute(
            {
              description: "Design summary",
              subagent_type: "design-graph",
              prompt: graphPrompt,
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
  mode: "cognition" | "judge" | "summarize" | "review-save" | "refine"
  request: string
  ctx: Tool.Context
}): Effect.Effect<string> {
  return Effect.gen(function* () {
    const activeWs = yield* input.design.listWorkingSet()
    const version = yield* input.design.getCurrentVersion()

    const activeContexts = activeWs.filter((e) => e.type === "context").map((e) => e.name)
    const activeNodes = activeWs.filter((e) => e.type === "node").map((e) => e.name)

    const lines = [
      `mode: ${input.mode}`,
      `request: ${input.request}`,
      "",
      "Current active working set (loaded from long-term memory):",
      `  contexts: ${activeContexts.join(", ") || "none"}`,
      `  concepts: ${activeNodes.join(", ") || "none"}`,
      "",
      `Known design graph version: ${version.sequence}.`,
      "Read the full graph state only through the available design tools; it is not included in this prompt.",
    ]

    return lines.join("\n")
  })
}

const GetTemporaryWorkingSetParameters = Schema.Struct({})

export const DesignGetTemporaryWorkingSetTool = Tool.define(
  "design_get_temporary_working_set",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Get the current temporary working set for this subagent session."),
      parameters: GetTemporaryWorkingSetParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const ws = yield* design.getTemporaryWorkingSet(ctx.sessionID)
          const contextLines = ws.entries
            .filter((e) => e.type === "context")
            .map((e) => `- Context "${e.name}": ${e.briefSemantics || "no semantics"}`)
          const nodeLines = ws.entries
            .filter((e) => e.type === "node")
            .map((e) => `- Concept "${e.name}": ${e.briefSemantics || "no semantics"}`)
          const output =
            contextLines.length === 0 && nodeLines.length === 0
              ? "The temporary working set is empty."
              : ["Current temporary working set:", ...contextLines, ...nodeLines].join("\n")
          return {
            title: "Temporary working set",
            output,
            metadata: { entries: ws.entries },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ExpandNodeParameters = Schema.Struct({
  name_or_id: Schema.String.annotate({ description: "Concept name or ID whose neighbors should be returned" }),
})

export const DesignExpandNodeTool = Tool.define<
  typeof ExpandNodeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_expand_node",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Expand a concept and return its one-hop neighbors and edge semantics."),
      parameters: ExpandNodeParameters,
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
          const neighborEntries: GraphAgentTypes.WorkingSetEntry[] = []
          const lines: string[] = [`Concept: ${node.name} (${node.id})`, "Neighbors:"]

          for (const edge of edges) {
            const otherId = edge.leftNodeId === node.id ? edge.rightNodeId : edge.leftNodeId
            const other = state.nodes.find((n) => n.id === otherId)
            const prototype = state.prototypes.find((p) => p.id === edge.prototypeId)
            if (!other || !prototype) continue

            neighborEntries.push({
              id: other.id,
              name: other.name,
              type: "node",
              briefSemantics: other.defaultSemantics || "",
            })

            const relationSemantics = edge.parameters?.semantics
              ? ` (${edge.parameters.semantics as string})`
              : ""
            lines.push(
              `- ${node.name} --[${prototype.name}]${relationSemantics}--> ${other.name}`,
            )
            if (prototype.defaultSemantics) {
              lines.push(`  prototype semantics: ${prototype.defaultSemantics}`)
            }
          }

          if (neighborEntries.length > 0) {
            yield* design.addTemporaryWorkingSetEntries(ctx.sessionID, neighborEntries)
          }

          return {
            title: `Expanded ${node.name}`,
            output: lines.join("\n"),
            metadata: { nodeId: node.id, neighborCount: neighborEntries.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const SearchGraphParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Name or alias to search for" }),
})

export const DesignSearchGraphTool = Tool.define<
  typeof SearchGraphParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_search_graph",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Search the design graph by concept or context name/alias."),
      parameters: SearchGraphParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          const matchedNodes = state.nodes.filter(
            (n) => n.name === args.query || n.aliases.includes(args.query),
          )
          const matchedContexts = state.contexts.filter(
            (c) => c.name === args.query,
          )

          const entries: GraphAgentTypes.WorkingSetEntry[] = []
          const lines: string[] = []

          for (const ctx of matchedContexts) {
            entries.push({
              id: ctx.id,
              name: ctx.name,
              type: "context",
              briefSemantics: ctx.semantics || "",
            })
            lines.push(`- Context "${ctx.name}": ${ctx.semantics || "no semantics"}`)
          }

          for (const node of matchedNodes) {
            entries.push({
              id: node.id,
              name: node.name,
              type: "node",
              briefSemantics: node.defaultSemantics || "",
            })
            lines.push(`- Concept "${node.name}" (${node.id}): ${node.defaultSemantics || "no semantics"}`)
          }

          if (entries.length > 0) {
            yield* design.addTemporaryWorkingSetEntries(ctx.sessionID, entries)
          }

          return {
            title: `Search results for "${args.query}"`,
            output: lines.join("\n") || "No matches.",
            metadata: { matchCount: entries.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const GetStateSummaryParameters = Schema.Struct({})

export const DesignGetStateSummaryTool = Tool.define<
  typeof GetStateSummaryParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_get_state_summary",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Get a high-level summary of the design graph size."),
      parameters: GetStateSummaryParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          return {
            title: "Design graph summary",
            output: yield* design.summarizeGraphState(state),
            metadata: {},
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
          const context = state.contexts.find((c) => c.id === node.contextId)
          const edges = state.edges.filter((e) => e.leftNodeId === node.id || e.rightNodeId === node.id)
          const related = edges.map((e) => {
            const otherId = e.leftNodeId === node.id ? e.rightNodeId : e.leftNodeId
            const other = state.nodes.find((n) => n.id === otherId)
            const prototype = state.prototypes.find((p) => p.id === e.prototypeId)
            const relationSemantics = e.parameters?.semantics
              ? ` (${e.parameters.semantics as string})`
              : ""
            return `${other?.name ?? otherId} --[${prototype?.name ?? e.prototypeId}]${relationSemantics}-->`
          })
          const lines = [
            `Concept: ${node.name} (${node.id})`,
            `Context: ${context?.name ?? node.contextId}`,
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
          const lines = prototypes.map((p) => `- ${p.name}: ${p.defaultSemantics || "no semantics"}`)
          return {
            title: "Relation prototypes",
            output: lines.join("\n") || "No prototypes.",
            metadata: { count: prototypes.length },
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
          yield* design.addTemporaryWorkingSetEntry(ctx.sessionID, {
            id: context.id,
            name: context.name,
            type: "context",
            briefSemantics: context.semantics || "",
          })
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
          yield* design.addTemporaryWorkingSetEntry(ctx.sessionID, {
            id: `tmp-${args.name}`,
            name: args.name,
            type: "node",
            briefSemantics: args.semantics || "",
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
          yield* design.addTemporaryWorkingSetEntries(ctx.sessionID, [
            {
              id: fromNode.id,
              name: fromNode.name,
              type: "node",
              briefSemantics: fromNode.defaultSemantics || "",
            },
            {
              id: toNode.id,
              name: toNode.name,
              type: "node",
              briefSemantics: toNode.defaultSemantics || "",
            },
          ])
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

const FinalizeChangeParameters = Schema.Struct({})

export const DesignFinalizeChangeTool = Tool.define<
  typeof FinalizeChangeParameters,
  Record<string, unknown>,
  Design.Service | Question.Service
>(
  "design_finalize_change",
  Effect.gen(function* () {
    const design = yield* Design.Service
    const question = yield* Question.Service
    return {
      description: designToolDescription(
        "Present all pending design changes to the user for final approval. The tool automatically applies the changes if the user agrees, discards them if the user abandons, or returns for further refinement.",
      ),
      parameters: FinalizeChangeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
          const pending = yield* design.getChangeAccumulator(ctx.sessionID)
          const summary = yield* design.summarizeGraphState(state)
          const details = yield* formatPendingDelta(state, pending)

          const approvalQuestion = {
            header: "Finalize design changes",
            question: `[design-finalize] ## 待提交变更摘要\n${summary}\n\n## 变更详情\n${details || "无具体变更"}`,
            options: [
              { label: "Approve", description: "Apply all pending changes" },
              { label: "Abandon", description: "Discard all pending changes" },
              { label: "Revise", description: "I need to refine some details" },
            ],
            custom: true,
          }

          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [approvalQuestion],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const choice = answers[0]
          if (!choice || choice.length === 0) {
            return {
              title: "No response",
              output: "User did not provide a response. Please ask again.",
              metadata: { pending },
            }
          }

          const label = choice[0]
          const baseMetadata = {
            questions: [approvalQuestion],
            answers,
          }

          if (label === "Approve") {
            yield* design.applyAccumulatedChanges(ctx.sessionID, { source: "graph-agent" })
            const version = yield* design.getCurrentVersion()
            return {
              title: "Changes applied",
              output: "All pending changes have been applied to the design graph.",
              metadata: { ...baseMetadata, result: "applied", version: version.sequence, applied: true },
            }
          }

          if (label === "Abandon") {
            yield* design.clearAccumulatedChanges(ctx.sessionID)
            return {
              title: "Changes abandoned",
              output: "All pending changes have been discarded.",
              metadata: { ...baseMetadata, result: "abandoned", abandoned: true },
            }
          }

          const revisionText = choice.slice(1).join(" ").trim()
          return {
            title: "Revision requested",
            output: revisionText
              ? `Please refine the changes based on: ${revisionText}`
              : "Please specify how to refine the changes.",
            metadata: { ...baseMetadata, result: "revision", revision: true, revisionText },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const RequestApprovalParameters = Schema.Struct({
  summary: Schema.String.annotate({ description: "Concise Markdown summary of the proposed change plan" }),
  warnings: Schema.optional(Schema.String).annotate({
    description: "Optional Markdown warnings or issues discovered during analysis",
  }),
  has_issues: Schema.optional(Schema.Boolean).annotate({
    description: "Whether the plan has obvious issues that justify a Force option",
  }),
})

export const DesignRequestApprovalTool = Tool.define<
  typeof RequestApprovalParameters,
  Record<string, unknown>,
  Design.Service | Question.Service
>(
  "design_request_approval",
  Effect.gen(function* () {
    const question = yield* Question.Service
    return {
      description: designToolDescription(
        "Present the first-stage design change plan to the user for approval. Use this instead of the generic question tool for design approvals.",
      ),
      parameters: RequestApprovalParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const bodyLines = ["## 变更计划", args.summary]
          if (args.warnings?.trim()) {
            bodyLines.push("", "## 需要注意的问题", args.warnings)
          }

          const options = args.has_issues
            ? [
                { label: "Force", description: "Proceed and rationalize details autonomously" },
                { label: "Revise", description: "I need to modify the plan" },
                { label: "Reject", description: "Abandon this change" },
              ]
            : [
                { label: "Approve", description: "Proceed with this change plan" },
                { label: "Revise", description: "I need to modify the plan" },
                { label: "Reject", description: "Abandon this change" },
              ]

          const approvalQuestion = {
            header: "设计变更审批",
            question: `[design-approval] ${bodyLines.join("\n")}`,
            options,
            custom: true,
          }

          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [approvalQuestion],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const choice = answers[0]
          if (!choice || choice.length === 0) {
            return {
              title: "No response",
              output: "User did not provide a response. Please ask again.",
              metadata: {},
            }
          }

          const label = choice[0]
          const revisionText = choice.slice(1).join(" ").trim()
          const baseMetadata = {
            questions: [approvalQuestion],
            answers,
          }

          if (label === "Approve" || label === "Force") {
            return {
              title: label === "Force" ? "Force approved" : "Approved",
              output: `User ${label === "Force" ? "force-approved" : "approved"} the change plan.`,
              metadata: { ...baseMetadata, result: label.toLowerCase() },
            }
          }

          if (label === "Reject") {
            return {
              title: "Rejected",
              output: "User rejected the change plan.",
              metadata: { ...baseMetadata, result: "reject" },
            }
          }

          return {
            title: "Revision requested",
            output: revisionText
              ? `Please revise the change plan based on: ${revisionText}`
              : "Please specify how to revise the change plan.",
            metadata: { ...baseMetadata, result: "revise", revisionText },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function formatPendingDelta(state: DesignTypes.GraphState, delta: GraphAgentTypes.GraphDelta): Effect.Effect<string> {
  return Effect.gen(function* () {
    const nodeName = (id: string) => state.nodes.find((n) => n.id === id || n.name === id || n.aliases.includes(id))?.name ?? id

    const contextName = (id: string) => state.contexts.find((c) => c.id === id || c.name === id)?.name ?? id

    const prototypeName = (id: string) => state.prototypes.find((p) => p.id === id || p.name === id)?.name ?? id

    const lines: string[] = []

    for (const node of delta.addNodes ?? []) {
      const ctx = contextName(node.contextId)
      lines.push(`- 新增概念：${node.name}（上下文：${ctx}）`)
    }

    for (const update of delta.updateNodes ?? []) {
      const name = nodeName(update.id)
      const fields = Object.keys(update.patch ?? {})
      const detail = fields.length ? `（更新字段：${fields.join("、")}）` : ""
      lines.push(`- 更新概念：${name}${detail}`)
    }

    for (const id of delta.deleteNodeIds ?? []) {
      const name = nodeName(id)
      lines.push(`- 删除概念：${name}`)
    }

    for (const edge of delta.addEdges ?? []) {
      const left = nodeName(edge.leftNodeId)
      const right = nodeName(edge.rightNodeId)
      const proto = prototypeName(edge.prototypeId)
      lines.push(`- 新增关系：${left} --[${proto}]--> ${right}`)
    }

    for (const update of delta.updateEdges ?? []) {
      const left = nodeName(update.leftNodeId)
      const right = nodeName(update.rightNodeId)
      const fields = Object.keys(update.patch ?? {})
      const detail = fields.length ? `（更新字段：${fields.join("、")}）` : ""
      lines.push(`- 更新关系：${left} <-> ${right}${detail}`)
    }

    for (const key of delta.deleteEdgeKeys ?? []) {
      const ids = key.split("::")
      if (ids.length === 2) {
        lines.push(`- 删除关系：${nodeName(ids[0]!)} <-> ${nodeName(ids[1]!)}`)
      } else {
        lines.push(`- 删除关系：${key}`)
      }
    }

    return lines.join("\n")
  })
}

export const ChatAgentDesignTools = [
  DesignAskGraphTool,
  DesignRequestChangeTool,
  DesignSummarizeDesignTool,
  DesignSearchProjectTool,
  DesignSearchWebTool,
]

export const GraphAgentDesignTools = {
  DesignGetTemporaryWorkingSetTool,
  DesignExpandNodeTool,
  DesignSearchGraphTool,
  DesignGetStateSummaryTool,
  DesignGetContextTool,
  DesignGetConceptTool,
  DesignListPrototypesTool,
  DesignDefineContextTool,
  DesignDefineConceptTool,
  DesignRefineConceptTool,
  DesignWithdrawConceptTool,
  DesignRelateConceptsTool,
  DesignWithdrawRelationTool,
  DesignDefineRelationPrototypeTool,
  DesignRequestApprovalTool,
  DesignFinalizeChangeTool,
}
