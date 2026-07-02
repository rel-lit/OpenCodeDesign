import { Context, Effect, Layer } from "effect"
import { EventLog } from "../core/event-log"
import { DesignTypes } from "../core/types"

export interface GraphVersion {
  sequence: number
  timestamp: number
  source: DesignTypes.VersionBumpSource
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
    const versionEvents = events.filter((e): e is DesignTypes.EventNode & { source: DesignTypes.VersionBumpSource } =>
      e.eventType === "graph_version_bumped" && e.source !== undefined
    )
    const latest = versionEvents[versionEvents.length - 1]
    if (latest === undefined) {
      return {
        sequence: 0,
        timestamp: Date.now(),
        source: "chat-agent" as const,
      }
    }
    return {
      sequence: versionEvents.length,
      timestamp: latest.timestamp,
      source: latest.source,
    }
  })

  const bumpVersion = Effect.fn("VersionSync.bumpVersion")(function* (source) {
    const current = yield* getCurrentVersion()
    const next: GraphVersion = {
      sequence: current.sequence + 1,
      timestamp: Date.now(),
      source,
    }
    yield* eventLog.append({ eventType: "graph_version_bumped", source })
    yield* refreshChatAgentContext(next)
    return next
  })

  const refreshChatAgentContext = Effect.fn("VersionSync.refreshChatAgentContext")(function* (version) {
    yield* Effect.logInfo("refreshing chat agent context", version)
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
