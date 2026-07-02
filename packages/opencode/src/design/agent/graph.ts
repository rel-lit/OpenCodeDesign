import { Context, Effect, Layer } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import * as GraphAgentTypes from "./types"

export interface Interface {
  readonly analyze: (input: GraphAgentTypes.Input) => Effect.Effect<GraphAgentTypes.Output>
  readonly execute: (proposal: GraphAgentTypes.Output) => Effect.Effect<GraphAgentTypes.Output>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignGraphAgent") {}
export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const analyze = Effect.fn("GraphAgent.analyze")(
      (input: GraphAgentTypes.Input): Effect.Effect<GraphAgentTypes.Output> => {
        return Effect.succeed({
          type: "change-proposal",
          summary: `Proposed change for ${input.userInput}`,
          affectedNodes: input.temporaryWorkingSet.nodeIds,
          affectedEdges: input.temporaryWorkingSet.edgeKeys,
          delta: input.proposedChange,
        })
      }
    )

    const execute = Effect.fn("GraphAgent.execute")(
      (proposal: GraphAgentTypes.Output): Effect.Effect<GraphAgentTypes.Output> => {
        return Effect.succeed({ ...proposal, type: "change-applied" })
      }
    )

    return Service.of({ analyze, execute })
  }),
)

export const defaultLayer = layer

export * as GraphAgent from "./graph"
