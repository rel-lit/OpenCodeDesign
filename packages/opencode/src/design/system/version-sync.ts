import { Context, Effect, Layer } from "effect"
import { EventLog } from "../core/event-log"

export interface GraphVersion {
  sequence: number
  timestamp: number
  source: "chat-agent" | "visual-editor"
}

export interface Interface {
  readonly getCurrentVersion: () => Effect.Effect<GraphVersion>
  readonly bumpVersion: (source: GraphVersion["source"]) => Effect.Effect<GraphVersion>
  readonly refreshChatAgentContext: (version: GraphVersion) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignVersionSync") {}

export const make = (eventLog: EventLog.Interface): Interface => {
  const getCurrentVersion = Effect.fn("VersionSync.getCurrentVersion")(function* () {
    const events = yield* eventLog.list()
    const sequence = events.length
    const last = events[events.length - 1]
    const lastSource = (last as { source?: GraphVersion["source"] } | undefined)?.source
    return {
      sequence,
      timestamp: last?.timestamp ?? Date.now(),
      source: lastSource ?? "chat-agent",
    }
  })

  const bumpVersion = Effect.fn("VersionSync.bumpVersion")(function* (source) {
    const current = yield* getCurrentVersion()
    const next: GraphVersion = {
      sequence: current.sequence + 1,
      timestamp: Date.now(),
      source,
    }
    yield* refreshChatAgentContext(next)
    return next
  })

  const refreshChatAgentContext = Effect.fn("VersionSync.refreshChatAgentContext")(function* (_version) {
    return yield* Effect.void
  })

  return { getCurrentVersion, bumpVersion, refreshChatAgentContext }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const eventLog = yield* EventLog.Service
    return Service.of(make(eventLog))
  }),
)

export const defaultLayer = layer.pipe(Layer.provideMerge(EventLog.defaultLayer))

export * as VersionSync from "./version-sync"
