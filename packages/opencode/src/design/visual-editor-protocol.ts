import { Context, Effect, Layer, Ref, Schema } from "effect"
import type { Scope } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Design } from "@/design/design"
import { GraphAgent } from "@/design/agent/graph"
import { GraphEngine } from "@/design/core/graph"
import * as GraphAgentTypes from "@/design/agent/types"
import { WorkingSetComputer } from "@/design/system/working-set-computer"
import { Provider } from "@/provider/provider"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export class VisualEditorProtocolError extends Schema.TaggedErrorClass<VisualEditorProtocolError>()(
  "VisualEditorProtocolError",
  {
    message: Schema.String,
  },
) {}

export interface Interface {
  readonly save: (delta: GraphAgentTypes.GraphDelta) => Effect.Effect<
    GraphAgentTypes.Output,
    VisualEditorProtocolError | GraphEngine.GraphEngineError | Provider.DefaultModelError,
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
      const graphAgent = yield* GraphAgent.Service

      const protocolState = yield* InstanceState.make<ProtocolState>(
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
          yield* design.applyRawDelta(delta)
          yield* design.bumpVersion("visual-editor")
          const graphState = yield* design.getState()
          const activeWs = yield* design.listWorkingSet()
          const activeWorkingSet: GraphAgentTypes.ActiveWorkingSet = {
            contextIds: activeWs.contextIds,
            nodeIds: activeWs.nodeIds,
            capacity: graphState.workingSet?.capacity ?? 20,
          }
          const temporaryWorkingSet = WorkingSetComputer.fromDelta(delta, activeWorkingSet, graphState)
          return yield* graphAgent.analyze({
            source: "visual-editor",
            userInput: "",
            temporaryWorkingSet,
            activeWorkingSet,
            graphState,
            proposedChange: delta,
          })
        }).pipe(Effect.ensuring(setProcessing(false)))
      })

      return Service.of({ save })
    }),
  )

export const defaultLayer = layer()

export * as VisualEditorProtocol from "./visual-editor-protocol"
