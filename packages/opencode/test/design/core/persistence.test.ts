import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { testEffect } from "../../lib/effect"
import { TestInstance } from "../../fixture/fixture"
import { Persistence } from "../../../src/design/core/persistence"
import { DesignTypes } from "../../../src/design/core/types"

const it = testEffect(Persistence.defaultLayer)

describe("Persistence", () => {
  it.instance("saves and loads graph state", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service
      const state: DesignTypes.GraphState = {
        nodes: [],
        edges: [],
        prototypes: [],
        contexts: [],
        workingSet: { activeContextIds: [], activeNodeIds: [], capacity: 20 },
        eventLog: { events: [] },
      }
      yield* persistence.save(state)
      const loaded = yield* persistence.load()
      expect(loaded).toEqual(state)
    }),
  )

  it.instance("appends events to events.jsonl", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service
      const event: DesignTypes.EventNode = {
        id: "evt-1",
        name: "node-created",
        contextId: "event-log",
        aliases: [],
        defaultSemantics: "",
        connectedEdges: [],
        createdAt: 1,
        updatedAt: 1,
        retired: false,
        eventType: "node_created",
        timestamp: 1,
        affectedNodeIds: ["node-1"],
        affectedEdgeKeys: [],
      }
      yield* persistence.appendEvent(event)
      yield* persistence.appendEvent({ ...event, id: "evt-2" })
      const test = yield* TestInstance
      const file = Bun.file(path.join(test.directory, ".opencode/design/events.jsonl"))
      const text = yield* Effect.promise(() => file.text())
      const lines = text.trim().split("\n")
      expect(lines.length).toBe(2)
      expect(JSON.parse(lines[0]).id).toBe("evt-1")
      expect(JSON.parse(lines[1]).id).toBe("evt-2")
    }),
  )
})
