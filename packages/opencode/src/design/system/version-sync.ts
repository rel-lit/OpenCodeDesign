import { Context, Effect, Layer, Schema } from "effect"
import { EventLog } from "../core/event-log"
import { DesignTypes } from "../core/types"

export class StaleContextError extends Schema.TaggedErrorClass<StaleContextError>()(
  "DesignStaleContextError",
  {
    message: Schema.String,
  },
) {}

export interface GraphVersion {
  sequence: number
  timestamp: number
  source: DesignTypes.VersionBumpSource
}

export interface Interface {
  readonly getCurrentVersion: () => Effect.Effect<GraphVersion>
  readonly bumpVersion: (source: GraphVersion["source"]) => Effect.Effect<GraphVersion>
  readonly isVisualEditorDirty: () => Effect.Effect<boolean>
  readonly markVisualEditorDirty: () => Effect.Effect<void>
  readonly clearVisualEditorDirty: () => Effect.Effect<void>
  readonly checkChatAgentSync: () => Effect.Effect<void, StaleContextError>
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
    return next
  })

  const isVisualEditorDirty = Effect.fnUntraced(function* () {
    const current = yield* getCurrentVersion()
    return current.source === "visual-editor"
  })

  const markVisualEditorDirty = Effect.fnUntraced(function* () {
    yield* bumpVersion("visual-editor")
  })

  const clearVisualEditorDirty = Effect.fnUntraced(function* () {
    yield* bumpVersion("chat-agent")
  })

  const checkChatAgentSync = Effect.fn("VersionSync.checkChatAgentSync")(function* () {
    const events = yield* eventLog.list()
    const versionEvents = events.filter((e): e is DesignTypes.EventNode & { source: DesignTypes.VersionBumpSource } =>
      e.eventType === "graph_version_bumped" && e.source !== undefined
    )
    const latest = versionEvents[versionEvents.length - 1]
    const lastChatAgent = versionEvents.findLast((e) => e.source === "chat-agent")
    const stale = latest !== undefined && (lastChatAgent === undefined || latest.timestamp > lastChatAgent.timestamp)
    if (stale) {
      return yield* new StaleContextError({
        message:
          "The design graph has been modified by the Visual Editor since the last sync. Call design_ask_graph or design_summarize_design to sync before modifying the graph.",
      })
    }
    return undefined
  })

  return {
    getCurrentVersion,
    bumpVersion,
    isVisualEditorDirty,
    markVisualEditorDirty,
    clearVisualEditorDirty,
    checkChatAgentSync,
  }
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
