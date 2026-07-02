import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../../lib/effect"
import { EventLog } from "../../../src/design/core/event-log"
import { VersionSync } from "../../../src/design/system/version-sync"

const it = testEffect(VersionSync.defaultLayer)

describe("VersionSync", () => {
  it.effect("getCurrentVersion returns sequence from EventLog", () =>
    Effect.gen(function* () {
      const vs = yield* VersionSync.Service
      const version = yield* vs.getCurrentVersion()
      expect(version.sequence).toBe(0)
      expect(version.source).toBe("chat-agent")
      expect(version.timestamp).toBeGreaterThanOrEqual(0)
    }),
  )

  it.effect("bumpVersion returns incremented sequence with source", () =>
    Effect.gen(function* () {
      const eventLog = yield* EventLog.Service
      const vs = yield* VersionSync.Service
      yield* eventLog.append({ eventType: "node_created" })
      yield* eventLog.append({ eventType: "edge_created" })
      const version = yield* vs.bumpVersion("visual-editor")
      expect(version.sequence).toBe(3)
      expect(version.source).toBe("visual-editor")
      expect(version.timestamp).toBeGreaterThan(0)
    }),
  )
})
