import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Design } from "@/design/design"
import { VersionSync } from "@/design/system/version-sync"
import { TaskTool } from "./task"
import { Agent } from "@/agent/agent"
import { Truncate } from "./truncate"
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
          const result = yield* task.execute(
            {
              description: truncatePreview(args.intent, MAX_INTENT_PREVIEW_LENGTH),
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

    const contextName = (id: string) =>
      Effect.gen(function* () {
        const ctx = yield* input.design.findContextByNameOrId(id)
        return ctx?.name ?? id
      })

    const nodeName = (id: string) =>
      Effect.gen(function* () {
        const node = yield* input.design.findNodeByNameOrId(id)
        return node?.name ?? id
      })

    const prototypeName = (id: string) =>
      Effect.gen(function* () {
        const proto = yield* input.design.getPrototype(id)
        return proto?.name ?? id
      })

    const namedActiveContexts = yield* Effect.all(activeWs.contextIds.map(contextName))
    const namedActiveNodes = yield* Effect.all(activeWs.nodeIds.map(nodeName))
    const namedTemporaryContexts = yield* Effect.all(temporaryWorkingSet.contextIds.map(contextName))
    const namedTemporaryNodes = yield* Effect.all(temporaryWorkingSet.nodeIds.map(nodeName))

    const contexts = yield* Effect.all(
      graphState.contexts.map((ctx) =>
        Effect.gen(function* () {
          const nodeNames = yield* Effect.all(ctx.nodeIds.map(nodeName))
          return {
            ...ctx,
            nodeIds: ctx.nodeIds.map((id, i) => `${nodeNames[i]} (${id})`),
          }
        }),
      ),
    )

    const nodes = yield* Effect.all(
      graphState.nodes.map((node) =>
        Effect.gen(function* () {
          const ctx = yield* contextName(node.contextId)
          return {
            ...node,
            contextId: `${ctx} (${node.contextId})`,
          }
        }),
      ),
    )

    const edges = yield* Effect.all(
      graphState.edges.map((edge) =>
        Effect.gen(function* () {
          const [left, right, proto] = yield* Effect.all([
            nodeName(edge.leftNodeId),
            nodeName(edge.rightNodeId),
            prototypeName(edge.prototypeId),
          ])
          return {
            ...edge,
            leftNodeId: `${left} (${edge.leftNodeId})`,
            rightNodeId: `${right} (${edge.rightNodeId})`,
            prototypeId: `${proto} (${edge.prototypeId})`,
          }
        }),
      ),
    )

    const prototypes = yield* Effect.all(
      graphState.prototypes.map((proto) =>
        Effect.succeed({
          ...proto,
          id: `${proto.name} (${proto.id})`,
        }),
      ),
    )

    return JSON.stringify({
      mode: input.mode,
      request: input.request,
      source: "chat" as const,
      userInput: input.request,
      activeWorkingSet: {
        contextIds: activeWs.contextIds.map((id, i) => `${namedActiveContexts[i]} (${id})`),
        nodeIds: activeWs.nodeIds.map((id, i) => `${namedActiveNodes[i]} (${id})`),
        capacity: graphState.workingSet?.capacity ?? 20,
      },
      temporaryWorkingSet: {
        ...temporaryWorkingSet,
        contextIds: temporaryWorkingSet.contextIds.map((id, i) => `${namedTemporaryContexts[i]} (${id})`),
        nodeIds: temporaryWorkingSet.nodeIds.map((id, i) => `${namedTemporaryNodes[i]} (${id})`),
      },
      graphState: {
        contexts,
        nodes,
        edges,
        prototypes,
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
          const details = yield* formatPendingDelta(design, pending)

          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                header: "Finalize design changes",
                question: `[design-finalize] ## 待提交变更摘要\n${summary}\n\n## 变更详情\n${details || "无具体变更"}`,
                options: [
                  { label: "Approve", description: "Apply all pending changes" },
                  { label: "Abandon", description: "Discard all pending changes" },
                  { label: "Revise", description: "I need to refine some details" },
                ],
                custom: true,
              },
            ],
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

          if (label === "Approve") {
            yield* design.applyAccumulatedChanges(ctx.sessionID, { source: "graph-agent" })
            const version = yield* design.getCurrentVersion()
            return {
              title: "Changes applied",
              output: "All pending changes have been applied to the design graph.",
              metadata: { version: version.sequence, applied: true },
            }
          }

          if (label === "Abandon") {
            yield* design.clearAccumulatedChanges(ctx.sessionID)
            return {
              title: "Changes abandoned",
              output: "All pending changes have been discarded.",
              metadata: { abandoned: true },
            }
          }

          const revisionText = choice.slice(1).join(" ").trim()
          return {
            title: "Revision requested",
            output: revisionText
              ? `Please refine the changes based on: ${revisionText}`
              : "Please specify how to refine the changes.",
            metadata: { revision: true, revisionText },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function formatPendingDelta(design: Design.Interface, delta: GraphAgentTypes.GraphDelta): Effect.Effect<string> {
  return Effect.gen(function* () {
    const nodeName = (id: string) =>
      Effect.gen(function* () {
        const node = yield* design.findNodeByNameOrId(id)
        return node?.name ?? id
      })

    const contextName = (id: string) =>
      Effect.gen(function* () {
        const ctx = yield* design.findContextByNameOrId(id)
        return ctx?.name ?? id
      })

    const prototypeName = (id: string) =>
      Effect.gen(function* () {
        const proto = yield* design.getPrototype(id)
        return proto?.name ?? id
      })

    const lines: string[] = []

    for (const node of delta.addNodes ?? []) {
      const ctx = yield* contextName(node.contextId)
      lines.push(`- 新增概念：${node.name}（上下文：${ctx}）`)
    }

    for (const update of delta.updateNodes ?? []) {
      const name = yield* nodeName(update.id)
      const fields = Object.keys(update.patch ?? {})
      const detail = fields.length ? `（更新字段：${fields.join("、")}）` : ""
      lines.push(`- 更新概念：${name}${detail}`)
    }

    for (const id of delta.deleteNodeIds ?? []) {
      const name = yield* nodeName(id)
      lines.push(`- 删除概念：${name}`)
    }

    for (const edge of delta.addEdges ?? []) {
      const [left, right, proto] = yield* Effect.all([
        nodeName(edge.leftNodeId),
        nodeName(edge.rightNodeId),
        prototypeName(edge.prototypeId),
      ])
      lines.push(`- 新增关系：${left} --[${proto}]--> ${right}`)
    }

    for (const update of delta.updateEdges ?? []) {
      const [left, right] = yield* Effect.all([
        nodeName(update.leftNodeId),
        nodeName(update.rightNodeId),
      ])
      const fields = Object.keys(update.patch ?? {})
      const detail = fields.length ? `（更新字段：${fields.join("、")}）` : ""
      lines.push(`- 更新关系：${left} <-> ${right}${detail}`)
    }

    for (const key of delta.deleteEdgeKeys ?? []) {
      const ids = key.split("::")
      if (ids.length === 2) {
        const [left, right] = yield* Effect.all([nodeName(ids[0]!), nodeName(ids[1]!)])
        lines.push(`- 删除关系：${left} <-> ${right}`)
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
  DesignFinalizeChangeTool,
}
