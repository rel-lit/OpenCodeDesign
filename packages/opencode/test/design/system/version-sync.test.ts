import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { testEffect } from "../../lib/effect"
import { EventLog } from "../../../src/design/core/event-log"
import { VersionSync } from "../../../src/design/system/version-sync"

const it = testEffect(VersionSync.defaultLayer)

describe("VersionSync", () => {
  it.effect("getCurrentVersion returns default version when no bump events exist", () =>
    Effect.gen(function* () {
      const vs = yield* VersionSync.Service
      const version = yield* vs.getCurrentVersion()
      expect(version.sequence).toBe(0)
      expect(version.source).toBe("chat-agent")
      expect(version.timestamp).toBeGreaterThanOrEqual(0)
    }),
  )

  it.effect("bumpVersion appends a durable event and returns incremented sequence with source", () =>
    Effect.gen(function* () {
      const eventLog = yield* EventLog.Service
      const vs = yield* VersionSync.Service
      yield* eventLog.append({ eventType: "node_created" })
      yield* eventLog.append({ eventType: "edge_created" })

      const bumped = yield* vs.bumpVersion("visual-editor")
      expect(bumped.sequence).toBe(1)
      expect(bumped.source).toBe("visual-editor")
      expect(bumped.timestamp).toBeGreaterThan(0)

      const current = yield* vs.getCurrentVersion()
      expect(current.sequence).toBe(1)
      expect(current.source).toBe("visual-editor")

      const events = yield* eventLog.list()
      const versionEvents = events.filter((e) => e.eventType === "graph_version_bumped")
      expect(versionEvents.length).toBe(1)
      expect(versionEvents[0].source).toBe("visual-editor")
    }),
  )

  it.effect("bumpVersion increments sequence across multiple calls", () =>
    Effect.gen(function* () {
      const vs = yield* VersionSync.Service
      const first = yield* vs.bumpVersion("chat-agent")
      const second = yield* vs.bumpVersion("chat-agent")
      expect(second.sequence).toBe(first.sequence + 1)
    }),
  )

  it.effect("isVisualEditorDirty is true after visual-editor bump and false after chat-agent bump", () =>
    Effect.gen(function* () {
      const vs = yield* VersionSync.Service
      expect(yield* vs.isVisualEditorDirty()).toBe(false)
      yield* vs.bumpVersion("visual-editor")
      expect(yield* vs.isVisualEditorDirty()).toBe(true)
      yield* vs.bumpVersion("chat-agent")
      expect(yield* vs.isVisualEditorDirty()).toBe(false)
    }),
  )

  it.effect("checkChatAgentSync fails after visual-editor bump and passes after chat-agent bump", () =>
    Effect.gen(function* () {
      const vs = yield* VersionSync.Service
      yield* vs.checkChatAgentSync()
      yield* vs.bumpVersion("visual-editor")
      const staleExit = yield* Effect.exit(vs.checkChatAgentSync())
      expect(Exit.isFailure(staleExit)).toBe(true)
      yield* vs.bumpVersion("chat-agent")
      yield* vs.checkChatAgentSync()
    }),
  )

  it.effect("state is derived from event log and survives service reconstruction", () =>
    Effect.gen(function* () {
      const eventLog = yield* EventLog.Service
      const vs = yield* VersionSync.Service
      yield* vs.bumpVersion("visual-editor")
      const events = yield* eventLog.list()
      const fresh = VersionSync.make(eventLog)
      expect(yield* fresh.isVisualEditorDirty()).toBe(true)
      const current = yield* fresh.getCurrentVersion()
      expect(current.source).toBe("visual-editor")
      const versionEvents = events.filter((e) => e.eventType === "graph_version_bumped")
      expect(versionEvents.length).toBe(1)
    }),
  )
})
