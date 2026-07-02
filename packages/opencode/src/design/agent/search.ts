import { Context, Effect, Layer } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
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
  readonly readProject: (graphSummary: string) => Effect.Effect<Output>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignSearchAgent") {}
export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const search = Effect.fn("SearchAgent.search")(
      (input: Input): Effect.Effect<Output> => {
        return Effect.succeed({
          summaryReport: `Search result for: ${input.retrievalRequirements}`,
        })
      },
    )
    const readProject = Effect.fn("SearchAgent.readProject")(
      (graphSummary: string): Effect.Effect<Output> => {
        return Effect.succeed({ summaryReport: "Project read placeholder" })
      },
    )
    return Service.of({ search, readProject })
  }),
)

export * as SearchAgent from "./search"
