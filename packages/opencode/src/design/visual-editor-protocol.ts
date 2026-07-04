import { Context, Effect, Layer, Ref, Schema } from "effect"
import type { Scope } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Design } from "@/design/design"
import { GraphEngine } from "@/design/core/graph"
import * as GraphAgentTypes from "@/design/agent/types"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export class VisualEditorProtocolError extends Schema.TaggedErrorClass<VisualEditorProtocolError>()(
  "VisualEditorProtocolError",
  {
    message: Schema.String,
  },
) {}

export interface Interface {
  readonly save: (delta: GraphAgentTypes.GraphDelta) => Effect.Effect<
    { summary: string; version: number },
    VisualEditorProtocolError | GraphEngine.GraphEngineError,
    Scope.Scope
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/VisualEditorProtocol") {}

type ProtocolState = {
  readonly processing: Ref.Ref<boolean>
}

export const layer = () =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
    const design = yield* Design.Service

    const protocolState = yield* InstanceState.make<ProtocolState, never, Scope.Scope>(
      Effect.fn("VisualEditorProtocol.state")(function* () {
        return {
          processing: yield* Ref.make(false),
        }
      }),
    )

      const getProcessing = Effect.fn("VisualEditorProtocol.getProcessing")(function* () {
        const state = yield* InstanceState.get(protocolState)
        return yield* Ref.get(state.processing)
      })

      const setProcessing = (value: boolean) =>
        Effect.gen(function* () {
          const state = yield* InstanceState.get(protocolState)
          yield* Ref.set(state.processing, value)
        })

      const assertNoAgentProcessing = Effect.fn("VisualEditorProtocol.assertNoAgentProcessing")(function* () {
        const processing = yield* getProcessing()
        if (processing) {
          return yield* new VisualEditorProtocolError({ message: "Another agent is already processing" })
        }
      })

      const save = Effect.fn("VisualEditorProtocol.save")(function* (delta: GraphAgentTypes.GraphDelta) {
        yield* assertNoAgentProcessing()
        yield* setProcessing(true)

        return yield* Effect.gen(function* () {
          yield* design.applyRawDelta(delta, "visual-editor")
          const version = yield* design.bumpVersion("visual-editor")
          const state = yield* design.getState()
          return {
            summary: `Visual editor saved ${state.nodes.length} nodes, ${state.edges.length} edges, ${state.contexts.length} contexts.`,
            version: version.sequence,
          }
        }).pipe(Effect.ensuring(setProcessing(false)))
      })

      return Service.of({ save })
    }),
  )

export const defaultLayer = layer()

export * as VisualEditorProtocol from "./visual-editor-protocol"
