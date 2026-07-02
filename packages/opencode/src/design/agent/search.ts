import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Provider } from "@/provider/provider"
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { DesignAgentLlm } from "./llm"
import PROMPT_SEARCH from "./prompt/search.txt"

export interface Input {
  graphSummary: string
  retrievalRequirements: string
  focus?: { contextIds?: string[]; nodeIds?: string[] }
}

export interface Output {
  summaryReport: string
  diffAnalysis?: {
    missingInCode: Array<{ nodeId?: string; name: string; reason: string }>
    divergentRelations: Array<{ designEdge?: string; actualCode: string; reason: string }>
    references: Array<{ file: string; line?: number; snippet: string }>
  }
  nonGraphInfo?: Array<{ type: "text" | "link"; content: string }>
}

export interface Interface {
  readonly search: (input: Input) => Effect.Effect<Output>
  readonly readProject: (graphSummary: string) => Effect.Effect<Output, Provider.DefaultModelError, FileSystem.FileSystem | Path.Path>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignSearchAgent") {}
export const use = serviceUse(Service)

const MissingEntitySchema = Schema.Struct({
  nodeId: Schema.optional(Schema.String),
  name: Schema.String,
  reason: Schema.String,
})

const DivergentRelationSchema = Schema.Struct({
  designEdge: Schema.optional(Schema.String),
  actualCode: Schema.String,
  reason: Schema.String,
})

const ReferenceSchema = Schema.Struct({
  file: Schema.String,
  line: Schema.optional(Schema.Number),
  snippet: Schema.String,
})

const SearchOutputSchema = Schema.Struct({
  summaryReport: Schema.String,
  diffAnalysis: Schema.optional(
    Schema.Struct({
      missingInCode: Schema.Array(MissingEntitySchema),
      divergentRelations: Schema.Array(DivergentRelationSchema),
      references: Schema.Array(ReferenceSchema),
    }),
  ),
  nonGraphInfo: Schema.optional(
    Schema.Array(
      Schema.Struct({
        type: Schema.Literals(["text", "link"]),
        content: Schema.String,
      }),
    ),
  ),
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const llm = yield* DesignAgentLlm.Service

    const search = Effect.fn("SearchAgent.search")(
      (input: Input): Effect.Effect<Output> => {
        return Effect.succeed({
          summaryReport: `Search result for: ${input.retrievalRequirements}`,
        })
      },
    )

    const readProject = Effect.fn("SearchAgent.readProject")(
      function* (graphSummary: string) {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const servicesDir = path.resolve("src/services")
        const files = yield* fs.readDirectory(servicesDir).pipe(Effect.orElseSucceed(() => [] as Array<string>))
        const snippets = yield* Effect.forEach(files, (file) =>
          fs.readFileString(path.join(servicesDir, file)).pipe(Effect.orElseSucceed(() => "")),
        )
        const prompt = `${PROMPT_SEARCH}\n\nGraph summary:\n${graphSummary}\n\nCode snippets:\n${snippets.join("\n---\n")}\n\nFind missing entities and divergent relations.`
        const result = yield* llm.generateObject({ prompt, schema: SearchOutputSchema })
        return result.object as Output
      },
    )

    return Service.of({ search, readProject })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(DesignAgentLlm.defaultLayer),
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
)

export * as SearchAgent from "./search"
