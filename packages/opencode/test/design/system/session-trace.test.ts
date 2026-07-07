import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { existsSync } from "node:fs"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../../lib/effect"
import { SessionTrace } from "../../../src/design/system/session-trace"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { TestInstance } from "../../fixture/fixture"

const testLayer = LayerNode.compile(
  LayerNode.group([SessionTrace.node, EventV2Bridge.node, Database.node]),
)

const it = testEffect(testLayer)

const TestToolResultEvent = EventV2.define({
  type: "tool.result",
  schema: {
    sessionID: Schema.String,
    output: Schema.String,
  },
})

const TestIgnoredEvent = EventV2.define({
  type: "custom.ignored",
  schema: {
    sessionID: Schema.String,
    payload: Schema.String,
  },
})

async function readTraceLog(directory: string, sessionID: string): Promise<string> {
  const filePath = `${directory}/.opencode/logs/sessions/${sessionID}.jsonl`
  return Bun.file(filePath).text()
}

describe("SessionTrace", () => {
  test("shouldTrace identifies design subagents", () => {
    expect(SessionTrace.shouldTrace("design-graph")).toBe(true)
    expect(SessionTrace.shouldTrace("design-search")).toBe(true)
    expect(SessionTrace.shouldTrace("build")).toBe(false)
    expect(SessionTrace.shouldTrace("general")).toBe(false)
  })

  it.instance("enable no-ops for non-traced agents", () =>
    Effect.gen(function* () {
      const trace = yield* SessionTrace.Service
      const test = yield* TestInstance
      yield* trace.enable({ sessionID: "session-a", agent: "build" })
      const logDirExists = yield* Effect.promise(() =>
        Bun.file(`${test.directory}/.opencode/logs/sessions/session-a.jsonl`).exists(),
      )
      expect(logDirExists).toBe(false)
    }),
  )

  it.instance("enable creates log directory for traced agents", () =>
    Effect.gen(function* () {
      const trace = yield* SessionTrace.Service
      const test = yield* TestInstance
      yield* trace.enable({ sessionID: "session-b", agent: "design-graph" })
      const logDir = `${test.directory}/.opencode/logs/sessions`
      const logDirExists = existsSync(logDir)
      expect(logDirExists).toBe(true)
    }),
  )

  it.instance("writes trace entries for logged event types", () =>
    Effect.gen(function* () {
      const trace = yield* SessionTrace.Service
      const events = yield* EventV2Bridge.Service
      const test = yield* TestInstance
      const sessionID = "session-c"
      const parentSessionID = "parent-c"

      yield* trace.enable({ sessionID, agent: "design-graph", parentSessionID })

      for (let i = 0; i < 32; i++) {
        yield* events.publish(TestToolResultEvent, {
          sessionID,
          output: `result-${i}`,
        })
      }

      const text = yield* Effect.promise(() => readTraceLog(test.directory, sessionID))
      const lines = text.trim().split("\n").filter(Boolean)
      expect(lines.length).toBe(32)

      const first = JSON.parse(lines[0]!)
      expect(first.type).toBe("tool.result")
      expect(first.sessionID).toBe(sessionID)
      expect(first.parentSessionID).toBe(parentSessionID)
      expect(first.agent).toBe("design-graph")
      expect(first.data.output).toBe("result-0")
      expect(typeof first.timestamp).toBe("string")
    }),
  )

  it.instance("ignores events for non-logged types", () =>
    Effect.gen(function* () {
      const trace = yield* SessionTrace.Service
      const events = yield* EventV2Bridge.Service
      const test = yield* TestInstance
      const sessionID = "session-d"

      yield* trace.enable({ sessionID, agent: "design-graph" })

      for (let i = 0; i < 32; i++) {
        yield* events.publish(TestIgnoredEvent, {
          sessionID,
          payload: `ignored-${i}`,
        })
      }

      const filePath = `${test.directory}/.opencode/logs/sessions/${sessionID}.jsonl`
      const fileExists = yield* Effect.promise(() => Bun.file(filePath).exists())
      expect(fileExists).toBe(false)
    }),
  )

  it.instance("truncates large output/text fields in trace data", () =>
    Effect.gen(function* () {
      const trace = yield* SessionTrace.Service
      const events = yield* EventV2Bridge.Service
      const test = yield* TestInstance
      const sessionID = "session-e"
      const bigText = "x".repeat(5000)

      yield* trace.enable({ sessionID, agent: "design-graph" })

      for (let i = 0; i < 32; i++) {
        yield* events.publish(TestToolResultEvent, {
          sessionID,
          output: bigText,
        })
      }

      const text = yield* Effect.promise(() => readTraceLog(test.directory, sessionID))
      expect(text.includes(bigText)).toBe(false)
      expect(text.includes("[truncated]")).toBe(true)
    }),
  )
})
