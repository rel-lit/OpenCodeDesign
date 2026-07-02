import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { DesignTypes } from "./types"

export interface Interface {
  readonly append: (input: {
    id?: string
    eventType: DesignTypes.EventType
    affectedNodeIds?: string[]
    affectedEdgeKeys?: string[]
    reason?: string
    rollbackTarget?: string
    source?: DesignTypes.VersionBumpSource
  }) => Effect.Effect<DesignTypes.EventNode>
  readonly rollbackTo: (eventId: string) => Effect.Effect<DesignTypes.EventNode, Error>
  readonly list: () => Effect.Effect<DesignTypes.EventNode[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignEventLog") {}

const makeId = () => `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export const makeEventLog = Effect.fn("EventLog.make")(function* () {
  let events: DesignTypes.EventNode[] = []

  const append = Effect.fn("EventLog.append")(function* (input) {
    const event: DesignTypes.EventNode = {
      id: input.id ?? makeId(),
      name: input.eventType,
      contextId: "event-log",
      aliases: [],
      defaultSemantics: "",
      connectedEdges: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      retired: false,
      eventType: input.eventType,
      timestamp: Date.now(),
      affectedNodeIds: input.affectedNodeIds ?? [],
      affectedEdgeKeys: input.affectedEdgeKeys ?? [],
      reason: input.reason,
      rollbackTarget: input.rollbackTarget,
      source: input.source,
    }
    events.push(event)
    return event
  })

  const rollbackTo = Effect.fn("EventLog.rollbackTo")(function* (eventId) {
    const index = events.findIndex((e) => e.id === eventId)
    if (index < 0) return yield* Effect.fail(new Error(`Event not found: ${eventId}`))
    events = events.slice(0, index + 1)
    return yield* append({
      eventType: "event_rollback",
      rollbackTarget: eventId,
      reason: `Rolled back to event ${eventId}`,
    })
  })

  const list = Effect.fnUntraced(function* () {
    return [...events]
  })

  return { append, rollbackTo, list } satisfies Interface
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const log = yield* makeEventLog()
    return Service.of(log)
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [],
})

export * as EventLog from "./event-log"
