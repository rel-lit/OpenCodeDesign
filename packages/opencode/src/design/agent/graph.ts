import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { DesignTypes } from "@/design/core/types"
import { Provider } from "@/provider/provider"
import { Context, Effect, Layer, Schema } from "effect"
import { DesignAgentLlm } from "./llm"
import * as GraphAgentTypes from "./types"
import { Design } from "@/design/design"
import { GraphEngine } from "@/design/core/graph"

import PROMPT_GRAPH from "./prompt/graph.txt"

export class NoDeltaError extends Schema.TaggedErrorClass<NoDeltaError>()("GraphAgent.NoDeltaError", {}) {}

const PatchNodeSchema = Schema.Record(Schema.String, Schema.Unknown)
const PatchEdgeSchema = Schema.Record(Schema.String, Schema.Unknown)

const GraphDeltaSchema = Schema.Struct({
  addNodes: Schema.optional(Schema.Array(DesignTypes.Node)),
  updateNodes: Schema.optional(Schema.Array(Schema.Struct({
    id: Schema.String,
    patch: PatchNodeSchema,
  }))),
  deleteNodeIds: Schema.optional(Schema.Array(Schema.String)),
  addEdges: Schema.optional(Schema.Array(DesignTypes.Edge)),
  updateEdges: Schema.optional(Schema.Array(Schema.Struct({
    leftNodeId: Schema.String,
    rightNodeId: Schema.String,
    patch: PatchEdgeSchema,
  }))),
  deleteEdgeKeys: Schema.optional(Schema.Array(Schema.String)),
})

const OutputSchema = Schema.Struct({
  type: Schema.Literals(["enriched-input", "graph-summary", "change-proposal", "change-applied", "rejected"]),
  summary: Schema.String,
  structured: Schema.optional(Schema.Struct({
    warnings: Schema.optional(Schema.Array(Schema.Struct({
      code: Schema.String,
      message: Schema.String,
      nodeId: Schema.optional(Schema.String),
      edgeKey: Schema.optional(Schema.String),
    }))),
    suggestions: Schema.optional(Schema.Array(Schema.Struct({
      action: Schema.String,
      reason: Schema.String,
    }))),
  })),
  affectedNodes: Schema.Array(Schema.String),
  affectedEdges: Schema.Array(Schema.String),
  questions: Schema.optional(Schema.Array(Schema.String)),
  delta: Schema.optional(GraphDeltaSchema),
})

export interface Interface {
  readonly analyze: (
    input: GraphAgentTypes.Input,
  ) => Effect.Effect<GraphAgentTypes.Output, DesignAgentLlm.GenerateObjectError | Provider.DefaultModelError>
  readonly execute: (proposal: GraphAgentTypes.Output) => Effect.Effect<GraphAgentTypes.Output, NoDeltaError | GraphEngine.GraphEngineError, Design.Service>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignGraphAgent") {}
export const use = serviceUse(Service)

const buildPrompt = (input: GraphAgentTypes.Input) =>
  `${PROMPT_GRAPH}\n\nAnalyze the following design graph input and respond with the structured JSON described above.\n\n${JSON.stringify(input, null, 2)}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const llm = yield* DesignAgentLlm.Service

    const analyze = Effect.fn("GraphAgent.analyze")(
      function* (input: GraphAgentTypes.Input) {
        const prompt = buildPrompt(input)
        const result = yield* llm.generateObject({ prompt, schema: OutputSchema })
        return result.object as GraphAgentTypes.Output
      },
    )

    const execute = Effect.fn("GraphAgent.execute")(
      function* (proposal: GraphAgentTypes.Output) {
        if (!proposal.delta) return yield* new NoDeltaError()
        const design = yield* Design.Service
        yield* design.applyRawDelta(proposal.delta)
        yield* design.bumpVersion("chat-agent")
        return { ...proposal, type: "change-applied" as const }
      },
    )

    return Service.of({ analyze, execute })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(DesignAgentLlm.defaultLayer))

export * as GraphAgent from "./graph"
