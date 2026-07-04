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
  readonly refreshChatAgentContext: (version: GraphVersion) => Effect.Effect<void>
  readonly isVisualEditorDirty: () => Effect.Effect<boolean>
  readonly markVisualEditorDirty: () => Effect.Effect<void>
  readonly clearVisualEditorDirty: () => Effect.Effect<void>
  readonly checkChatAgentSync: () => Effect.Effect<void, StaleContextError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignVersionSync") {}

export const make = (eventLog: EventLog.Interface): Interface => {
  let visualEditorDirty = false
  let chatAgentContextVersion: GraphVersion | undefined

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
    if (source === "visual-editor") {
      visualEditorDirty = true
    }
    if (source === "chat-agent") {
      visualEditorDirty = false
      chatAgentContextVersion = next
    }
    yield* refreshChatAgentContext(next)
    return next
  })

  const refreshChatAgentContext = Effect.fn("VersionSync.refreshChatAgentContext")(function* (version) {
    yield* Effect.logInfo("refreshing chat agent context", version)
  })

  const isVisualEditorDirty = Effect.fnUntraced(function* () {
    return visualEditorDirty
  })

  const markVisualEditorDirty = Effect.fnUntraced(function* () {
    visualEditorDirty = true
  })

  const clearVisualEditorDirty = Effect.fnUntraced(function* () {
    visualEditorDirty = false
  })

  const checkChatAgentSync = Effect.fn("VersionSync.checkChatAgentSync")(function* () {
    if (visualEditorDirty) {
      return yield* new StaleContextError({
        message:
          "The design graph has been modified by the Visual Editor since the last sync. Ask the user about the design change or call design_ask_graph/design_summarize_design to sync before modifying the graph.",
      })
    }
    return undefined
  })

  return {
    getCurrentVersion,
    bumpVersion,
    refreshChatAgentContext,
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
