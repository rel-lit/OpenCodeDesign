import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Design } from "@/design/design"
import { VersionSync } from "@/design/system/version-sync"
import { DesignChangeBuffer } from "@/design/system/design-change-buffer"
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
          const graphPrompt = yield* buildGraphAgentPrompt({ design, mode: "change", request: args.intent, ctx })
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
  graph_summary: Schema.optional(Schema.String).annotate({
    description: "Optional precomputed design graph summary. If omitted, the design-graph subagent will generate one.",
  }),
  focus: Schema.optional(
    Schema.Struct({
      contexts: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Context names or IDs to focus on" }),
      concepts: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Concept names or IDs to focus on" }),
    }),
  ).annotate({ description: "Optional focus scope for the graph summary" }),
})

export const DesignSearchProjectTool = Tool.define(
  "design_search_project",
  Effect.gen(function* () {
    const task = yield* Tool.init(yield* TaskTool)
    const design = yield* Design.Service
    return {
      description: chatToolDescription(
        "Ask the design-search subagent to read the project and compare it with the current design.",
      ),
      parameters: SearchProjectParameters,
      execute: (args: Schema.Schema.Type<typeof SearchProjectParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const graphSummary = yield* buildGraphSummary({
            task,
            design,
            ctx,
            graphSummary: args.graph_summary,
            focus: args.focus,
          })
          const prompt = buildSearchAgentPrompt({
            graphSummary: graphSummary.output,
            retrievalRequirements: args.intent,
            focus: args.focus,
          })
          const result = yield* task.execute(
            {
              description: "Design project search",
              subagent_type: "design-search",
              prompt,
            },
            ctx,
          )
          return {
            title: "Design project search",
            output: result.output,
            metadata: {
              ...result.metadata,
              subagent_type: "design-search",
              ...(graphSummary.sessionId ? { graphSessionId: graphSummary.sessionId } : {}),
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)

const SearchWebParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Web search query" }),
  graph_summary: Schema.optional(Schema.String).annotate({
    description: "Optional precomputed design graph summary. If omitted, the design-graph subagent will generate one.",
  }),
  focus: Schema.optional(
    Schema.Struct({
      contexts: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Context names or IDs to focus on" }),
      concepts: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Concept names or IDs to focus on" }),
    }),
  ).annotate({ description: "Optional focus scope for the graph summary" }),
})

export const DesignSearchWebTool = Tool.define(
  "design_search_web",
  Effect.gen(function* () {
    const task = yield* Tool.init(yield* TaskTool)
    const design = yield* Design.Service
    return {
      description: chatToolDescription(
        "Ask the design-search subagent to search the web for relevant design references.",
      ),
      parameters: SearchWebParameters,
      execute: (args: Schema.Schema.Type<typeof SearchWebParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const graphSummary = yield* buildGraphSummary({
            task,
            design,
            ctx,
            graphSummary: args.graph_summary,
            focus: args.focus,
          })
          const prompt = buildSearchAgentPrompt({
            graphSummary: graphSummary.output,
            retrievalRequirements: `Search the web for: ${args.query}`,
            focus: args.focus,
          })
          const result = yield* task.execute(
            {
              description: "Design web search",
              subagent_type: "design-search",
              prompt,
            },
            ctx,
          )
          return {
            title: "Design web search",
            output: result.output,
            metadata: {
              ...result.metadata,
              subagent_type: "design-search",
              ...(graphSummary.sessionId ? { graphSessionId: graphSummary.sessionId } : {}),
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)

function buildGraphSummary(input: {
  task: { execute: (params: { description: string; subagent_type: string; prompt: string }, ctx: Tool.Context) => Effect.Effect<Tool.ExecuteResult> }
  design: Design.Interface
  ctx: Tool.Context
  graphSummary?: string
  focus?: { readonly contexts?: ReadonlyArray<string>; readonly concepts?: ReadonlyArray<string> }
}): Effect.Effect<{ output: string; sessionId?: string }> {
  return Effect.gen(function* () {
    if (input.graphSummary) return { output: input.graphSummary }

    const focusParts: string[] = []
    if (input.focus?.contexts && input.focus.contexts.length > 0) {
      focusParts.push(`contexts: ${input.focus.contexts.join(", ")}`)
    }
    if (input.focus?.concepts && input.focus.concepts.length > 0) {
      focusParts.push(`concepts: ${input.focus.concepts.join(", ")}`)
    }
    const request = focusParts.length > 0 ? `focus on ${focusParts.join("; ")}` : "Summarize the current design."

    const graphPrompt = yield* buildGraphAgentPrompt({
      design: input.design,
      mode: "summarize",
      request,
      ctx: input.ctx,
    })
    const result = yield* input.task.execute(
      {
        description: "Design summary for search",
        subagent_type: "design-graph",
        prompt: graphPrompt,
      },
      input.ctx,
    )
    return {
      output: result.output,
      sessionId: result.metadata.sessionId as string,
    }
  })
}

function buildSearchAgentPrompt(input: {
  graphSummary: string
  retrievalRequirements: string
  focus?: { readonly contexts?: ReadonlyArray<string>; readonly concepts?: ReadonlyArray<string> }
}): string {
  const focusParts: string[] = []
  if (input.focus?.contexts && input.focus.contexts.length > 0) {
    focusParts.push(`contexts: ${input.focus.contexts.join(", ")}`)
  }
  if (input.focus?.concepts && input.focus.concepts.length > 0) {
    focusParts.push(`concepts: ${input.focus.concepts.join(", ")}`)
  }
  const focusLine = focusParts.length > 0 ? `\n## Focus\n${focusParts.join("\n")}` : ""
  return `## Graph Summary\n${input.graphSummary}\n\n## Retrieval Requirements\n${input.retrievalRequirements}${focusLine}`
}

function buildGraphAgentPrompt(input: {
  design: Design.Interface
  mode: "cognition" | "change" | "summarize" | "review-save"
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

function findContextByNameOrIdWithBuffer(
  design: Design.Interface,
  sessionID: string,
  nameOrId: string,
): Effect.Effect<DesignTypes.BoundedContext | undefined> {
  return Effect.gen(function* () {
    const fromState = yield* design.findContextByNameOrId(nameOrId)
    if (fromState) return fromState
    const operations = yield* design.bufferListOperations(sessionID)
    const op = operations.find(
      (o) =>
        o.type === "create_context" &&
        ((o.payload as { id?: string }).id === nameOrId || (o.payload as { name: string }).name === nameOrId),
    )
    if (!op) return undefined
    const payload = op.payload as { id: string; name: string; semantics?: string }
    return { id: payload.id, name: payload.name, semantics: payload.semantics ?? "", nodeIds: [] }
  })
}

function findNodeByNameOrIdWithBuffer(
  design: Design.Interface,
  sessionID: string,
  nameOrId: string,
): Effect.Effect<DesignTypes.Node | undefined> {
  return Effect.gen(function* () {
    const fromState = yield* design.findNodeByNameOrId(nameOrId)
    if (fromState) return fromState
    const operations = yield* design.bufferListOperations(sessionID)
    const createOp = operations.find(
      (o) =>
        o.type === "create_node" &&
        ((o.payload as { id?: string }).id === nameOrId || (o.payload as { name: string }).name === nameOrId),
    )
    if (!createOp) return undefined
    const payload = createOp.payload as GraphAgentTypes.NodeInput & { id?: string }
    const context = yield* findContextByNameOrIdWithBuffer(design, sessionID, payload.contextId)
    return {
      id: payload.id ?? "",
      name: payload.name,
      aliases: payload.aliases ?? [],
      contextId: payload.contextId,
      kind: payload.kind ?? "node",
      defaultSemantics: payload.defaultSemantics ?? "",
      connectedEdges: payload.connectedEdges ?? [],
      createdAt: payload.createdAt ?? Date.now(),
      updatedAt: payload.updatedAt ?? Date.now(),
      retired: payload.retired ?? false,
    } as DesignTypes.Node
  })
}

function findPrototypeByNameOrIdWithBuffer(
  design: Design.Interface,
  sessionID: string,
  nameOrId: string,
): Effect.Effect<DesignTypes.RelationPrototype | undefined> {
  return Effect.gen(function* () {
    const prototypes = yield* design.listPrototypes()
    const fromState = prototypes.find((p) => p.id === nameOrId || p.name === nameOrId)
    if (fromState) return fromState
    const operations = yield* design.bufferListOperations(sessionID)
    const createOp = operations.find(
      (o) =>
        o.type === "create_prototype" &&
        ((o.payload as { id?: string }).id === nameOrId || (o.payload as { name: string }).name === nameOrId),
    )
    if (!createOp) return undefined
    const payload = createOp.payload as { id?: string; name: string; defaultSemantics?: string; parameterSchema?: Record<string, unknown> }
    return {
      id: payload.id ?? "",
      name: payload.name,
      defaultSemantics: payload.defaultSemantics ?? "",
      parameterSchema: payload.parameterSchema ?? {},
    }
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
          const state = yield* design.getState()
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
              `- ${node.name} --[${prototype.name}]${relationSemantics}-- ${other.name}`,
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
          const state = yield* design.getState()
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
          const state = yield* design.getState()
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
          const state = yield* design.getState()
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
          const state = yield* design.getState()
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
            return `${other?.name ?? otherId} --[${prototype?.name ?? e.prototypeId}]${relationSemantics}--`
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

const GetRelationParameters = Schema.Struct({
  left: Schema.String.annotate({ description: "Left concept name or ID (unordered endpoint)" }),
  right: Schema.String.annotate({ description: "Right concept name or ID (unordered endpoint)" }),
})

export const DesignGetRelationTool = Tool.define<
  typeof GetRelationParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_get_relation",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Get the full content of the relation between two concepts."),
      parameters: GetRelationParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getState()
          const leftNode = state.nodes.find(
            (n) => n.id === args.left || n.name === args.left || n.aliases.includes(args.left),
          )
          if (!leftNode) {
            return { title: "Left concept not found", output: `No concept matching "${args.left}"`, metadata: {} }
          }
          const rightNode = state.nodes.find(
            (n) => n.id === args.right || n.name === args.right || n.aliases.includes(args.right),
          )
          if (!rightNode) {
            return { title: "Right concept not found", output: `No concept matching "${args.right}"`, metadata: {} }
          }
          const edge = state.edges.find(
            (e) =>
              (e.leftNodeId === leftNode.id && e.rightNodeId === rightNode.id) ||
              (e.leftNodeId === rightNode.id && e.rightNodeId === leftNode.id),
          )
          if (!edge) {
            return {
              title: "Relation not found",
              output: `No relation between "${leftNode.name}" and "${rightNode.name}"`,
              metadata: {},
            }
          }
          const prototype = state.prototypes.find((p) => p.id === edge.prototypeId)
          const parameterLines = Object.entries(edge.parameters ?? {}).filter(([k]) => k !== "semantics").length
            ? ["Parameters:", ...Object.entries(edge.parameters!).filter(([k]) => k !== "semantics").map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)]
            : ["Parameters: none"]
          const lines = [
            `Relation: ${leftNode.name} --[${prototype?.name ?? edge.prototypeId}]-- ${rightNode.name}`,
            `Left: ${leftNode.name} (${leftNode.id})`,
            `Right: ${rightNode.name} (${rightNode.id})`,
            `Prototype: ${prototype?.name ?? edge.prototypeId} (${edge.prototypeId})`,
            `Semantics: ${(edge.parameters?.semantics as string | undefined) ?? prototype?.defaultSemantics ?? "none"}`,
            ...parameterLines,
          ]
          return {
            title: `Relation ${leftNode.name} -- ${rightNode.name}`,
            output: lines.join("\n"),
            metadata: { edge, leftNode, rightNode, prototype },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const GetPrototypeParameters = Schema.Struct({
  name_or_id: Schema.String.annotate({ description: "Prototype name or ID" }),
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
      description: designToolDescription("Get the full content of a relation prototype."),
      parameters: GetPrototypeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getState()
          const prototype = state.prototypes.find(
            (p) => p.id === args.name_or_id || p.name === args.name_or_id,
          )
          if (!prototype) {
            return { title: "Prototype not found", output: `No prototype matching "${args.name_or_id}"`, metadata: {} }
          }
          const schemaLines = Object.entries(prototype.parameterSchema ?? {}).length
            ? ["Parameter schema:", ...Object.entries(prototype.parameterSchema).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)]
            : ["Parameter schema: none"]
          const lines = [
            `Prototype: ${prototype.name} (${prototype.id})`,
            `Default semantics: ${prototype.defaultSemantics || "none"}`,
            ...schemaLines,
          ]
          return {
            title: `Prototype ${prototype.name}`,
            output: lines.join("\n"),
            metadata: { prototype },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ExpandNodeFocusedParameters = Schema.Struct({
  name_or_id: Schema.String.annotate({ description: "Concept name or ID to expand with full details" }),
})

export const DesignExpandNodeFocusedTool = Tool.define<
  typeof ExpandNodeFocusedParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_expand_node_focused",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Expand a concept and return full details of the center, neighbors, and relations."),
      parameters: ExpandNodeFocusedParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getState()
          const node = state.nodes.find(
            (n) => n.id === args.name_or_id || n.name === args.name_or_id || n.aliases.includes(args.name_or_id),
          )
          if (!node) {
            return { title: "Concept not found", output: `No concept matching "${args.name_or_id}"`, metadata: {} }
          }
          const context = state.contexts.find((c) => c.id === node.contextId)
          const edges = state.edges.filter((e) => e.leftNodeId === node.id || e.rightNodeId === node.id)
          const lines: string[] = [
            `Center: ${node.name} (${node.id})`,
            `Context: ${context?.name ?? node.contextId}`,
            `Kind: ${node.kind}`,
            `Aliases: ${node.aliases.join(", ") || "none"}`,
            `Semantics: ${node.defaultSemantics || "none"}`,
            "",
            "Neighbors:",
          ]
          for (const edge of edges) {
            const otherId = edge.leftNodeId === node.id ? edge.rightNodeId : edge.leftNodeId
            const other = state.nodes.find((n) => n.id === otherId)
            const prototype = state.prototypes.find((p) => p.id === edge.prototypeId)
            if (!other || !prototype) continue
            const otherContext = state.contexts.find((c) => c.id === other.contextId)
            lines.push("")
            lines.push(`Concept: ${other.name} (${other.id})`)
            lines.push(`Context: ${otherContext?.name ?? other.contextId}`)
            lines.push(`Kind: ${other.kind}`)
            lines.push(`Aliases: ${other.aliases.join(", ") || "none"}`)
            lines.push(`Semantics: ${other.defaultSemantics || "none"}`)
            lines.push("")
            lines.push(`Relation: ${node.name} --[${prototype.name}]-- ${other.name}`)
            lines.push(`Prototype: ${prototype.name} (${prototype.id})`)
            lines.push(`Semantics: ${(edge.parameters?.semantics as string | undefined) ?? prototype.defaultSemantics ?? "none"}`)
            for (const [k, v] of Object.entries(edge.parameters ?? {})) {
              if (k === "semantics") continue
              lines.push(`  ${k}: ${JSON.stringify(v)}`)
            }
          }
          return {
            title: `Focused expansion of ${node.name}`,
            output: lines.join("\n"),
            metadata: { nodeId: node.id, neighborCount: edges.length },
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
          const id = crypto.randomUUID()
          const op = yield* design.bufferAddOperation(ctx.sessionID, {
            type: "create_context",
            description: `Create context ${args.name}`,
            payload: { id, name: args.name, semantics: args.semantics },
          })
          yield* design.addTemporaryWorkingSetEntry(ctx.sessionID, {
            id,
            name: args.name,
            type: "context",
            briefSemantics: args.semantics || "",
          })
          return {
            title: `Defined context ${args.name}`,
            output: `Context ${args.name} queued`,
            metadata: { operationId: op.id, operationType: "create_context", contextId: id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const UpdateContextParameters = Schema.Struct({
  name_or_id: Schema.String.annotate({ description: "Context name or ID" }),
  name: Schema.optional(Schema.String).annotate({ description: "Updated context name" }),
  semantics: Schema.optional(Schema.String).annotate({ description: "Updated context semantics" }),
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
      description: designToolDescription("Update an existing bounded context."),
      parameters: UpdateContextParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getState()
          const context = state.contexts.find((c) => c.id === args.name_or_id || c.name === args.name_or_id)
          if (!context) {
            return { title: "Context not found", output: `No context matching "${args.name_or_id}"`, metadata: {} }
          }
          const patch: Record<string, unknown> = {}
          if (args.name !== undefined) patch.name = args.name
          if (args.semantics !== undefined) patch.semantics = args.semantics
          const op = yield* design.bufferAddOperation(ctx.sessionID, {
            type: "update_context",
            description: `Update context ${context.name}`,
            payload: { id: context.id, patch },
          })
          return {
            title: `Updated context ${context.name}`,
            output: `Context ${context.name} (${context.id}) queued for update`,
            metadata: { operationId: op.id, operationType: "update_context" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const WithdrawContextParameters = Schema.Struct({
  name_or_id: Schema.String.annotate({ description: "Context name or ID" }),
})

export const DesignWithdrawContextTool = Tool.define<
  typeof WithdrawContextParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_withdraw_context",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Withdraw (delete) a bounded context."),
      parameters: WithdrawContextParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getState()
          const context = state.contexts.find((c) => c.id === args.name_or_id || c.name === args.name_or_id)
          if (!context) {
            return { title: "Context not found", output: `No context matching "${args.name_or_id}"`, metadata: {} }
          }
          const childNodes = state.nodes.filter((n) => n.contextId === context.id)
          if (childNodes.length > 0) {
            const names = childNodes.map((n) => n.name).join(", ")
            return {
              title: "Context still contains concepts",
              output: `Context "${context.name}" still contains concepts: ${names}. Withdraw them first.`,
              metadata: { childNodeIds: childNodes.map((n) => n.id) },
            }
          }
          const op = yield* design.bufferAddOperation(ctx.sessionID, {
            type: "delete_context",
            description: `Delete context ${context.name}`,
            payload: { id: context.id },
          })
          return {
            title: `Withdrew context ${context.name}`,
            output: `Context ${context.name} (${context.id}) queued for removal`,
            metadata: { operationId: op.id, operationType: "delete_context" },
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
          const state = yield* design.getState()
          const context = yield* findContextByNameOrIdWithBuffer(design, ctx.sessionID, args.context)
          if (!context) {
            return { title: "Context not found", output: `No context matching "${args.context}"`, metadata: {} }
          }
          const operations = yield* design.bufferListOperations(ctx.sessionID)
          const pendingCreateNode = operations.find(
            (o) =>
              o.type === "create_node" &&
              (o.payload as { name: string; contextId: string }).name === args.name &&
              (o.payload as { name: string; contextId: string }).contextId === context.id,
          )
          if (pendingCreateNode) {
            return {
              title: "Concept already exists",
              output: `Concept '${args.name}' already exists in context '${context.name}'`,
              metadata: {},
            }
          }
          const existingNode = state.nodes.find(
            (n) => n.contextId === context.id && (n.name === args.name || n.aliases.includes(args.name)),
          )
          if (existingNode) {
            return {
              title: "Concept already exists",
              output: `Concept '${args.name}' already exists in context '${context.name}'`,
              metadata: {},
            }
          }
          const id = crypto.randomUUID()
          const op = yield* design.bufferAddOperation(ctx.sessionID, {
            type: "create_node",
            description: `Create concept ${args.name} in context ${context.name}`,
            payload: {
              id,
              name: args.name,
              contextId: context.id,
              kind: args.kind,
              defaultSemantics: args.semantics,
              aliases: args.aliases,
            },
          })
          yield* design.addTemporaryWorkingSetEntry(ctx.sessionID, {
            id,
            name: args.name,
            type: "node",
            briefSemantics: args.semantics || "",
          })
          return {
            title: `Defined concept ${args.name}`,
            output: `Concept ${args.name} queued in context ${context.name}`,
            metadata: { operationId: op.id, operationType: "create_node", nodeId: id },
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
          const state = yield* design.getState()
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
          const op = yield* design.bufferAddOperation(ctx.sessionID, {
            type: "update_node",
            description: `Update concept ${node.name}`,
            payload: { id: node.id, patch },
          })
          return {
            title: `Refined concept ${node.name}`,
            output: `Concept ${node.name} (${node.id}) queued for update`,
            metadata: { operationId: op.id, operationType: "update_node" },
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
          const state = yield* design.getState()
          const node = state.nodes.find(
            (n) => n.id === args.concept || n.name === args.concept || n.aliases.includes(args.concept),
          )
          if (!node) {
            return { title: "Concept not found", output: `No concept matching "${args.concept}"`, metadata: {} }
          }
          const edges = state.edges.filter((e) => e.leftNodeId === node.id || e.rightNodeId === node.id)
          if (args.cascade) {
            for (const edge of edges) {
              yield* design.bufferAddOperation(ctx.sessionID, {
                type: "delete_edge",
                description: `Delete edge ${edge.leftNodeId} -- ${edge.rightNodeId}`,
                payload: { leftNodeId: edge.leftNodeId, rightNodeId: edge.rightNodeId },
              })
            }
          }
          const op = yield* design.bufferAddOperation(ctx.sessionID, {
            type: "delete_node",
            description: `Delete concept ${node.name}`,
            payload: { id: node.id },
          })
          return {
            title: `Withdrew concept ${node.name}`,
            output: `Concept ${node.name} (${node.id}) queued for removal.${args.cascade ? ` ${edges.length} connected edge(s) queued for removal.` : ""}`,
            metadata: { operationId: op.id, operationType: "delete_node" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const RelateConceptsParameters = Schema.Struct({
  left: Schema.String.annotate({ description: "Left concept name or ID (unordered endpoint)" }),
  right: Schema.String.annotate({ description: "Right concept name or ID (unordered endpoint)" }),
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
          const state = yield* design.getState()
          const leftNode = yield* findNodeByNameOrIdWithBuffer(design, ctx.sessionID, args.left)
          if (!leftNode) {
            return { title: "Left concept not found", output: `No concept matching "${args.left}"`, metadata: {} }
          }
          const rightNode = yield* findNodeByNameOrIdWithBuffer(design, ctx.sessionID, args.right)
          if (!rightNode) {
            return { title: "Right concept not found", output: `No concept matching "${args.right}"`, metadata: {} }
          }
          const prototype = yield* findPrototypeByNameOrIdWithBuffer(design, ctx.sessionID, args.relation)
          if (!prototype) {
            return { title: "Prototype not found", output: `No prototype matching "${args.relation}"`, metadata: {} }
          }
          const parameters: Record<string, unknown> = { ...(args.constraints ?? {}) }
          if (args.semantics !== undefined) parameters.semantics = args.semantics
          const edgeKey = DesignTypes.edgeKey(leftNode.id, rightNode.id)

          const operations = yield* design.bufferListOperations(ctx.sessionID)
          const pendingEdge = operations.find(
            (o) =>
              (o.type === "create_edge" || o.type === "update_edge") &&
              DesignTypes.edgeKey(
                (o.payload as { leftNodeId: string; rightNodeId: string }).leftNodeId,
                (o.payload as { leftNodeId: string; rightNodeId: string }).rightNodeId,
              ) === edgeKey,
          )

          const existingEdge = state.edges.find(
            (e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) === edgeKey,
          )

          const op = pendingEdge
            ? yield* design.bufferAddOperation(ctx.sessionID, {
                type: "update_edge",
                description: `Update relation ${leftNode.name} --[${prototype.name}]-- ${rightNode.name}`,
                payload: {
                  leftNodeId: (pendingEdge.payload as { leftNodeId: string; rightNodeId: string }).leftNodeId,
                  rightNodeId: (pendingEdge.payload as { leftNodeId: string; rightNodeId: string }).rightNodeId,
                  patch: { prototypeId: prototype.id, parameters },
                },
              })
            : existingEdge
              ? yield* design.bufferAddOperation(ctx.sessionID, {
                  type: "update_edge",
                  description: `Update relation ${leftNode.name} --[${prototype.name}]-- ${rightNode.name}`,
                  payload: {
                    leftNodeId: existingEdge.leftNodeId,
                    rightNodeId: existingEdge.rightNodeId,
                    patch: { prototypeId: prototype.id, parameters },
                  },
                })
              : yield* design.bufferAddOperation(ctx.sessionID, {
                  type: "create_edge",
                  description: `Create relation ${leftNode.name} --[${prototype.name}]-- ${rightNode.name}`,
                  payload: {
                    leftNodeId: leftNode.id,
                    rightNodeId: rightNode.id,
                    prototypeId: prototype.id,
                    parameters,
                  },
                })
          yield* design.addTemporaryWorkingSetEntries(ctx.sessionID, [
            {
              id: leftNode.id,
              name: leftNode.name,
              type: "node",
              briefSemantics: leftNode.defaultSemantics || "",
            },
            {
              id: rightNode.id,
              name: rightNode.name,
              type: "node",
              briefSemantics: rightNode.defaultSemantics || "",
            },
          ])
          return {
            title: "Related concepts",
            output: `${leftNode.name} --[${prototype.name}]-- ${rightNode.name} queued`,
            metadata: { operationId: op.id, operationType: op.type },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const WithdrawRelationParameters = Schema.Struct({
  left: Schema.String.annotate({ description: "Left concept name or ID (unordered endpoint)" }),
  right: Schema.String.annotate({ description: "Right concept name or ID (unordered endpoint)" }),
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
          const state = yield* design.getState()
          const leftNode = state.nodes.find(
            (n) => n.id === args.left || n.name === args.left || n.aliases.includes(args.left),
          )
          if (!leftNode) {
            return { title: "Left concept not found", output: `No concept matching "${args.left}"`, metadata: {} }
          }
          const rightNode = state.nodes.find(
            (n) => n.id === args.right || n.name === args.right || n.aliases.includes(args.right),
          )
          if (!rightNode) {
            return { title: "Right concept not found", output: `No concept matching "${args.right}"`, metadata: {} }
          }
          const edgeKey = DesignTypes.edgeKey(leftNode.id, rightNode.id)
          const exists = state.edges.some((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) === edgeKey)
          if (!exists) {
            return {
              title: "Relation not found",
              output: `Edge ${leftNode.name}<->${rightNode.name} does not exist`,
              metadata: {},
            }
          }
          const op = yield* design.bufferAddOperation(ctx.sessionID, {
            type: "delete_edge",
            description: `Delete relation ${leftNode.name} -- ${rightNode.name}`,
            payload: { leftNodeId: leftNode.id, rightNodeId: rightNode.id },
          })
          return {
            title: "Withdrew relation",
            output: `${leftNode.name} -- ${rightNode.name} queued for removal`,
            metadata: { operationId: op.id, operationType: "delete_edge" },
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
          const prototypes = yield* design.listPrototypes()
          const existing = prototypes.find((p) => p.id === args.name || p.name === args.name)
          const id = existing ? existing.id : crypto.randomUUID()
          const op = existing
            ? yield* design.bufferAddOperation(ctx.sessionID, {
                type: "update_prototype",
                description: `Update prototype ${existing.name}`,
                payload: {
                  id: existing.id,
                  patch: {
                    name: args.name,
                    defaultSemantics: args.semantics,
                    parameterSchema: args.constraints,
                  },
                },
              })
            : yield* design.bufferAddOperation(ctx.sessionID, {
                type: "create_prototype",
                description: `Create prototype ${args.name}`,
                payload: {
                  id,
                  name: args.name,
                  defaultSemantics: args.semantics,
                  parameterSchema: args.constraints,
                },
              })
          return {
            title: `${existing ? "Updated" : "Defined"} prototype ${args.name}`,
            output: `Prototype ${args.name} queued`,
            metadata: { operationId: op.id, operationType: op.type, prototypeId: id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const WithdrawRelationPrototypeParameters = Schema.Struct({
  name_or_id: Schema.String.annotate({ description: "Relation prototype name or ID" }),
})

export const DesignWithdrawRelationPrototypeTool = Tool.define<
  typeof WithdrawRelationPrototypeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_withdraw_relation_prototype",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Withdraw (delete) a relation prototype."),
      parameters: WithdrawRelationPrototypeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* design.getState()
          const prototype = state.prototypes.find((p) => p.id === args.name_or_id || p.name === args.name_or_id)
          if (!prototype) {
            return { title: "Prototype not found", output: `No prototype matching "${args.name_or_id}"`, metadata: {} }
          }
          const usingEdges = state.edges.filter((e) => e.prototypeId === prototype.id)
          if (usingEdges.length > 0) {
            const edgeLines = usingEdges.map(
              (e) => `  ${e.leftNodeId} -- ${e.rightNodeId}`,
            )
            return {
              title: "Prototype in use",
              output: `Prototype "${prototype.name}" is used by ${usingEdges.length} edge(s) and cannot be withdrawn.\n${edgeLines.join("\n")}`,
              metadata: { edges: usingEdges },
            }
          }
          const op = yield* design.bufferAddOperation(ctx.sessionID, {
            type: "delete_prototype",
            description: `Delete prototype ${prototype.name}`,
            payload: { id: prototype.id },
          })
          return {
            title: `Withdrew prototype ${prototype.name}`,
            output: `Prototype ${prototype.name} (${prototype.id}) queued for removal`,
            metadata: { operationId: op.id, operationType: "delete_prototype" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ListBufferOperationsParameters = Schema.Struct({})

export const DesignListBufferOperationsTool = Tool.define<
  typeof ListBufferOperationsParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_list_buffer_operations",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("List all buffered design operations for this session."),
      parameters: ListBufferOperationsParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const operations = yield* design.bufferListOperations(ctx.sessionID)
          const lines = operations.map((op) => `- ${op.id}: ${op.type} - ${op.description}`)
          return {
            title: "Buffered operations",
            output: lines.join("\n") || "No buffered operations.",
            metadata: { operations },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const UndoBufferOperationParameters = Schema.Struct({
  operation_id: Schema.String.annotate({ description: "Operation ID to undo" }),
  cascade: Schema.optional(Schema.Boolean).annotate({ description: "Whether to also undo dependent operations" }),
})

export const DesignUndoBufferOperationTool = Tool.define<
  typeof UndoBufferOperationParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_undo_buffer_operation",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: designToolDescription("Undo a buffered design operation."),
      parameters: UndoBufferOperationParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const result = yield* design.bufferUndoOperation(ctx.sessionID, args.operation_id, args.cascade).pipe(
            Effect.matchEffect({
              onFailure: (error: DesignChangeBuffer.BufferError) =>
                Effect.succeed({
                  title: "Cannot undo operation",
                  output: error.message,
                  metadata: { blockedBy: error.blockedBy ?? [] },
                }),
              onSuccess: () =>
                Effect.succeed({
                  title: "Operation undone",
                  output: `Operation ${args.operation_id} has been removed from the buffer.`,
                  metadata: { operationId: args.operation_id, cascade: args.cascade ?? false },
                }),
            }),
          )
          return result
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
          const state = yield* design.getState()
          const operations = yield* design.bufferListOperations(ctx.sessionID)
          const pending = yield* design.bufferGetDelta(ctx.sessionID)
          const summary = yield* design.summarizeGraphState(state)
          const details = yield* formatPendingDelta(state, operations, pending)
          const errors = validatePendingOperations(state, operations)
          if (errors.length > 0) {
            return {
              title: "Pending changes inconsistent",
              output: errors.join("\n"),
              metadata: { errors, operations },
            }
          }

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
            let applyError: unknown
            yield* design.bufferApply(ctx.sessionID, { source: "graph-agent" }).pipe(
              Effect.catchTag("GraphEngineError", (error) =>
                Effect.sync(() => {
                  applyError = error
                }),
              ),
            )
            if (applyError) {
              return {
                title: "Apply failed",
                output: `Could not apply pending changes: ${applyError instanceof Error ? applyError.message : String(applyError)}`,
                metadata: { ...baseMetadata, result: "failed", error: applyError },
              }
            }
            const version = yield* design.getCurrentVersion()
            return {
              title: "Changes applied",
              output: "All pending changes have been applied to the design graph.",
              metadata: { ...baseMetadata, result: "applied", version: version.sequence, applied: true },
            }
          }

          if (label === "Abandon") {
            yield* design.bufferClear(ctx.sessionID)
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

function validatePendingOperations(
  state: DesignTypes.GraphState,
  operations: GraphAgentTypes.BufferOperation[],
): string[] {
  const errors: string[] = []

  const contextIds = new Set(state.contexts.map((c) => c.id))
  const contextNames = new Set(state.contexts.map((c) => c.name))
  const nodeIds = new Set(state.nodes.map((n) => n.id))
  const nodeNames = new Set(state.nodes.map((n) => n.name))
  const nodeAliases = new Set(state.nodes.flatMap((n) => n.aliases))
  const prototypeIds = new Set(state.prototypes.map((p) => p.id))
  const prototypeNames = new Set(state.prototypes.map((p) => p.name))
  const existingEdgeKeys = new Set(state.edges.map((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId)))

  const pendingContextIds = new Set<string>()
  const pendingContextNames = new Set<string>()
  const pendingNodeIds = new Set<string>()
  const pendingNodeNames = new Set<string>()
  const pendingPrototypeIds = new Set<string>()
  const pendingPrototypeNames = new Set<string>()
  const pendingEdgeKeys = new Set<string>()

  const nodeNameUsed = (name: string) => nodeNames.has(name) || pendingNodeNames.has(name) || nodeAliases.has(name)

  for (const op of operations) {
    switch (op.type) {
      case "create_context": {
        const payload = op.payload as { id?: string; name: string }
        if (payload.id) {
          if (contextIds.has(payload.id) || pendingContextIds.has(payload.id)) {
            errors.push(`create_context ${payload.name}: context id ${payload.id} already exists`)
          }
          pendingContextIds.add(payload.id)
        }
        if (contextNames.has(payload.name) || pendingContextNames.has(payload.name)) {
          errors.push(`create_context ${payload.name}: context name already exists`)
        }
        pendingContextNames.add(payload.name)
        break
      }
      case "create_node": {
        const payload = op.payload as GraphAgentTypes.NodeInput
        if (payload.id) {
          if (nodeIds.has(payload.id) || pendingNodeIds.has(payload.id)) {
            errors.push(`create_node ${payload.name}: node id ${payload.id} already exists`)
          }
          pendingNodeIds.add(payload.id)
        }
        if (nodeNameUsed(payload.name)) {
          errors.push(`create_node ${payload.name}: node name or alias already exists`)
        }
        pendingNodeNames.add(payload.name)
        for (const alias of payload.aliases ?? []) {
          if (nodeNameUsed(alias)) {
            errors.push(`create_node ${payload.name}: alias ${alias} already exists`)
          }
          pendingNodeNames.add(alias)
        }
        break
      }
      case "create_prototype": {
        const payload = op.payload as { id?: string; name: string }
        if (payload.id) {
          if (prototypeIds.has(payload.id) || pendingPrototypeIds.has(payload.id)) {
            errors.push(`create_prototype ${payload.name}: prototype id ${payload.id} already exists`)
          }
          pendingPrototypeIds.add(payload.id)
        }
        if (prototypeNames.has(payload.name) || pendingPrototypeNames.has(payload.name)) {
          errors.push(`create_prototype ${payload.name}: prototype name already exists`)
        }
        pendingPrototypeNames.add(payload.name)
        break
      }
      case "create_edge": {
        const payload = op.payload as GraphAgentTypes.EdgeInput
        const key = DesignTypes.edgeKey(payload.leftNodeId, payload.rightNodeId)
        if (existingEdgeKeys.has(key) || pendingEdgeKeys.has(key)) {
          errors.push(`create_edge ${key}: edge already exists`)
        }
        pendingEdgeKeys.add(key)
        break
      }
    }
  }

  for (const op of operations) {
    switch (op.type) {
      case "update_context": {
        const payload = op.payload as { id: string; patch: { name?: string; semantics?: string } }
        if (!contextIds.has(payload.id) && !pendingContextIds.has(payload.id)) {
          errors.push(`update_context ${payload.id}: context not found`)
        }
        if (payload.patch.name && (contextNames.has(payload.patch.name) || pendingContextNames.has(payload.patch.name))) {
          errors.push(`update_context ${payload.id}: name ${payload.patch.name} already exists`)
        }
        break
      }
      case "delete_context": {
        const payload = op.payload as { id: string }
        if (!contextIds.has(payload.id) && !pendingContextIds.has(payload.id)) {
          errors.push(`delete_context ${payload.id}: context not found`)
        }
        break
      }
      case "update_node": {
        const payload = op.payload as { id: string; patch: Partial<GraphAgentTypes.NodeInput> }
        if (!nodeIds.has(payload.id) && !pendingNodeIds.has(payload.id)) {
          errors.push(`update_node ${payload.id}: node not found`)
        }
        if (payload.patch.name && nodeNameUsed(payload.patch.name)) {
          errors.push(`update_node ${payload.id}: name ${payload.patch.name} already exists`)
        }
        for (const alias of payload.patch.aliases ?? []) {
          if (nodeNameUsed(alias)) {
            errors.push(`update_node ${payload.id}: alias ${alias} already exists`)
          }
        }
        if (payload.patch.contextId && !contextIds.has(payload.patch.contextId) && !pendingContextIds.has(payload.patch.contextId)) {
          errors.push(`update_node ${payload.id}: context ${payload.patch.contextId} not found`)
        }
        break
      }
      case "delete_node": {
        const payload = op.payload as { id: string }
        if (!nodeIds.has(payload.id) && !pendingNodeIds.has(payload.id)) {
          errors.push(`delete_node ${payload.id}: node not found`)
        }
        break
      }
      case "create_edge": {
        const payload = op.payload as GraphAgentTypes.EdgeInput
        if (!nodeIds.has(payload.leftNodeId) && !pendingNodeIds.has(payload.leftNodeId)) {
          errors.push(`create_edge ${payload.leftNodeId}: left node not found`)
        }
        if (!nodeIds.has(payload.rightNodeId) && !pendingNodeIds.has(payload.rightNodeId)) {
          errors.push(`create_edge ${payload.rightNodeId}: right node not found`)
        }
        if (!prototypeIds.has(payload.prototypeId) && !pendingPrototypeIds.has(payload.prototypeId)) {
          errors.push(`create_edge ${payload.prototypeId}: prototype not found`)
        }
        break
      }
      case "update_edge": {
        const payload = op.payload as { leftNodeId: string; rightNodeId: string; patch: Partial<GraphAgentTypes.EdgeInput> }
        const key = DesignTypes.edgeKey(payload.leftNodeId, payload.rightNodeId)
        if (!existingEdgeKeys.has(key)) {
          errors.push(`update_edge ${key}: edge not found`)
        }
        if (payload.patch.prototypeId && !prototypeIds.has(payload.patch.prototypeId) && !pendingPrototypeIds.has(payload.patch.prototypeId)) {
          errors.push(`update_edge ${key}: prototype ${payload.patch.prototypeId} not found`)
        }
        break
      }
      case "delete_edge": {
        const payload = op.payload as { leftNodeId: string; rightNodeId: string }
        const key = DesignTypes.edgeKey(payload.leftNodeId, payload.rightNodeId)
        if (!existingEdgeKeys.has(key)) {
          errors.push(`delete_edge ${key}: edge not found`)
        }
        break
      }
      case "update_prototype": {
        const payload = op.payload as { id: string; patch: { name?: string; defaultSemantics?: string; parameterSchema?: Record<string, unknown> } }
        if (!prototypeIds.has(payload.id) && !pendingPrototypeIds.has(payload.id)) {
          errors.push(`update_prototype ${payload.id}: prototype not found`)
        }
        if (payload.patch.name && (prototypeNames.has(payload.patch.name) || pendingPrototypeNames.has(payload.patch.name))) {
          errors.push(`update_prototype ${payload.id}: name ${payload.patch.name} already exists`)
        }
        break
      }
      case "delete_prototype": {
        const payload = op.payload as { id: string }
        if (!prototypeIds.has(payload.id) && !pendingPrototypeIds.has(payload.id)) {
          errors.push(`delete_prototype ${payload.id}: prototype not found`)
        }
        const usedBy = state.edges.filter((e) => e.prototypeId === payload.id)
        if (usedBy.length > 0) {
          errors.push(`delete_prototype ${payload.id}: prototype is used by ${usedBy.length} edge(s)`)
        }
        break
      }
    }
  }

  return errors
}

function formatPendingDelta(
  state: DesignTypes.GraphState,
  operations: GraphAgentTypes.BufferOperation[],
  delta: GraphAgentTypes.GraphDelta,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const pendingNodes = new Map<string, DesignTypes.Node>()
    const pendingContexts = new Map<string, DesignTypes.BoundedContext>()
    const pendingPrototypes = new Map<string, DesignTypes.RelationPrototype>()

    for (const op of operations) {
      switch (op.type) {
        case "create_context": {
          const payload = op.payload as { id: string; name: string; semantics?: string }
          pendingContexts.set(payload.id, {
            id: payload.id,
            name: payload.name,
            semantics: payload.semantics ?? "",
            nodeIds: [],
          })
          break
        }
        case "update_context": {
          const payload = op.payload as { id: string; patch: { name?: string; semantics?: string } }
          const existing = state.contexts.find((c) => c.id === payload.id)
          const pending = pendingContexts.get(payload.id)
          const base = pending ?? existing
          if (base) {
            pendingContexts.set(payload.id, {
              ...base,
              name: payload.patch.name ?? base.name,
              semantics: payload.patch.semantics ?? base.semantics,
            })
          }
          break
        }
        case "create_node": {
          const payload = op.payload as GraphAgentTypes.NodeInput & { id?: string }
          const id = payload.id ?? ""
          pendingNodes.set(id, {
            id,
            name: payload.name,
            aliases: payload.aliases ?? [],
            contextId: payload.contextId,
            kind: payload.kind ?? "node",
            defaultSemantics: payload.defaultSemantics ?? "",
            connectedEdges: payload.connectedEdges ?? [],
            createdAt: payload.createdAt ?? Date.now(),
            updatedAt: payload.updatedAt ?? Date.now(),
            retired: payload.retired ?? false,
          } as DesignTypes.Node)
          break
        }
        case "update_node": {
          const payload = op.payload as { id: string; patch: Partial<GraphAgentTypes.NodeInput> }
          const existing = state.nodes.find((n) => n.id === payload.id)
          const pending = pendingNodes.get(payload.id)
          const base = pending ?? existing
          if (base) {
            pendingNodes.set(payload.id, {
              ...base,
              name: payload.patch.name ?? base.name,
              aliases: payload.patch.aliases ?? base.aliases,
              contextId: payload.patch.contextId ?? base.contextId,
              kind: payload.patch.kind ?? base.kind,
              defaultSemantics: payload.patch.defaultSemantics ?? base.defaultSemantics,
              retired: payload.patch.retired ?? base.retired,
            })
          }
          break
        }
        case "create_prototype": {
          const payload = op.payload as { id: string; name: string; defaultSemantics?: string; parameterSchema?: Record<string, unknown> }
          pendingPrototypes.set(payload.id, {
            id: payload.id,
            name: payload.name,
            defaultSemantics: payload.defaultSemantics ?? "",
            parameterSchema: payload.parameterSchema ?? {},
          })
          break
        }
        case "update_prototype": {
          const payload = op.payload as { id: string; patch: { name?: string; defaultSemantics?: string; parameterSchema?: Record<string, unknown> } }
          const existing = state.prototypes.find((p) => p.id === payload.id)
          const pending = pendingPrototypes.get(payload.id)
          const base = pending ?? existing
          if (base) {
            pendingPrototypes.set(payload.id, {
              ...base,
              name: payload.patch.name ?? base.name,
              defaultSemantics: payload.patch.defaultSemantics ?? base.defaultSemantics,
              parameterSchema: payload.patch.parameterSchema ?? base.parameterSchema,
            })
          }
          break
        }
      }
    }

    const nodeName = (id: string) =>
      pendingNodes.get(id)?.name ??
      state.nodes.find((n) => n.id === id || n.name === id || n.aliases.includes(id))?.name ??
      id

    const contextName = (id: string) =>
      pendingContexts.get(id)?.name ?? state.contexts.find((c) => c.id === id || c.name === id)?.name ?? id

    const prototypeName = (id: string) =>
      pendingPrototypes.get(id)?.name ?? state.prototypes.find((p) => p.id === id || p.name === id)?.name ?? id

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
      lines.push(`- 新增关系：${left} --[${proto}]-- ${right}`)
    }

    for (const update of delta.updateEdges ?? []) {
      const left = nodeName(update.leftNodeId)
      const right = nodeName(update.rightNodeId)
      const fields = Object.keys(update.patch ?? {})
      const detail = fields.length ? `（更新字段：${fields.join("、")}）` : ""
      lines.push(`- 更新关系：${left} -- ${right}${detail}`)
    }

    for (const key of delta.deleteEdgeKeys ?? []) {
      const ids = key.split("::")
      if (ids.length === 2) {
        lines.push(`- 删除关系：${nodeName(ids[0]!)} -- ${nodeName(ids[1]!)}`)
      } else {
        lines.push(`- 删除关系：${key}`)
      }
    }

    return lines.join("\n")
  })
}

export const ChatAgentDesignTools = {
  DesignAskGraphTool,
  DesignRequestChangeTool,
  DesignSummarizeDesignTool,
  DesignSearchProjectTool,
  DesignSearchWebTool,
}

export const GraphAgentDesignTools = {
  DesignGetTemporaryWorkingSetTool,
  DesignExpandNodeTool,
  DesignSearchGraphTool,
  DesignGetStateSummaryTool,
  DesignGetContextTool,
  DesignGetConceptTool,
  DesignGetRelationTool,
  DesignGetPrototypeTool,
  DesignExpandNodeFocusedTool,
  DesignListPrototypesTool,
  DesignDefineContextTool,
  DesignUpdateContextTool,
  DesignWithdrawContextTool,
  DesignDefineConceptTool,
  DesignRefineConceptTool,
  DesignWithdrawConceptTool,
  DesignRelateConceptsTool,
  DesignWithdrawRelationTool,
  DesignDefineRelationPrototypeTool,
  DesignWithdrawRelationPrototypeTool,
  DesignListBufferOperationsTool,
  DesignUndoBufferOperationTool,
  DesignRequestApprovalTool,
  DesignFinalizeChangeTool,
}
