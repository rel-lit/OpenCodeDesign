import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../../lib/effect"
import { EventLog } from "../../../src/design/core/event-log"

const it = testEffect(EventLog.defaultLayer)

describe("EventLog", () => {
  it.effect("appends and lists events", () =>
    Effect.gen(function* () {
      const log = yield* EventLog.Service
      yield* log.append({ eventType: "node_created", affectedNodeIds: ["n1"] })
      yield* log.append({ eventType: "edge_created", affectedEdgeKeys: ["n1::n2"] })
      const events = yield* log.list()
      expect(events.length).toBe(2)
    }),
  )

  it.effect("rolls back to event", () =>
    Effect.gen(function* () {
      const log = yield* EventLog.Service
      const first = yield* log.append({ eventType: "node_created" })
      yield* log.append({ eventType: "edge_created" })
      yield* log.rollbackTo(first.id)
      const events = yield* log.list()
      expect(events.length).toBe(2)
      expect(events[1].eventType).toBe("event_rollback")
    }),
  )

  it.effect("preserves supplied event id", () =>
    Effect.gen(function* () {
      const log = yield* EventLog.Service
      const event = yield* log.append({ id: "restored-123", eventType: "node_created" })
      expect(event.id).toBe("restored-123")
      const events = yield* log.list()
      expect(events[0].id).toBe("restored-123")
    }),
  )
})
