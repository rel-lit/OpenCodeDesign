import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { testEffect } from "../../lib/effect"
import path from "path"
import { DesignTypes } from "../../../src/design/core/types"
import { DesignStore } from "../../../src/design/store/store"
import { TestInstance } from "../../fixture/fixture"

const it = testEffect(DesignStore.defaultLayer)

describe("DesignStore", () => {
  it.instance("creates schema and persists graph state", () =>
    Effect.gen(function* () {
      const designStore = yield* DesignStore.Service
      const store = designStore.store

      const state = {
        contexts: [{ id: "ctx-1", name: "战斗系统", semantics: "", nodeIds: [] }],
        nodes: [
          {
            id: "node-1",
            name: "船",
            aliases: ["战船"],
            contextId: "ctx-1",
            defaultSemantics: "水上交通工具",
            connectedEdges: [],
            createdAt: 1,
            updatedAt: 1,
            retired: false,
          },
        ],
        edges: [],
        prototypes: [{ id: "aggregate", name: "聚合", defaultSemantics: "", parameterSchema: {} }],
      }

      yield* store.saveGraphState(state)
      const loaded = yield* store.loadGraphState()

      expect(loaded.contexts).toHaveLength(1)
      expect(loaded.nodes).toHaveLength(1)
      expect(loaded.nodes[0].name).toBe("船")
      expect(loaded.nodes[0].aliases).toEqual(["战船"])
      expect(loaded.prototypes).toHaveLength(1)
    }),
  )

  it.instance("appends and lists events", () =>
    Effect.gen(function* () {
      const designStore = yield* DesignStore.Service
      const store = designStore.store

      const event: DesignTypes.EventNode = {
        id: "evt-1",
        name: "node_created",
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

      yield* store.appendEvent(event)
      yield* store.appendEvent({ ...event, id: "evt-2" })
      const events = yield* store.listEvents()

      expect(events).toHaveLength(2)
      expect(events[0].id).toBe("evt-1")
      expect(events[1].id).toBe("evt-2")
    }),
  )

  it.instance("isolates state between instances", () =>
    Effect.gen(function* () {
      const designStore = yield* DesignStore.Service
      const store = designStore.store
      yield* store.saveGraphState({
        contexts: [{ id: "ctx-a", name: "A", semantics: "", nodeIds: [] }],
        nodes: [],
        edges: [],
        prototypes: [],
      })

      const loaded = yield* store.loadGraphState()
      expect(loaded.contexts).toHaveLength(1)
      expect(loaded.contexts[0].name).toBe("A")
    }),
  )

  it.instance("Leaves prior state intact on transaction failure", () =>
    Effect.gen(function* () {
      const designStore = yield* DesignStore.Service
      const store = designStore.store

      yield* store.saveGraphState({
        contexts: [{ id: "ctx-stable", name: "Stable", semantics: "", nodeIds: [] }],
        nodes: [],
        edges: [],
        prototypes: [],
      })

      const failure = store.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.saveGraphState({
            contexts: [{ id: "ctx-new", name: "New", semantics: "", nodeIds: [] }],
            nodes: [],
            edges: [],
            prototypes: [],
          })
          return yield* Effect.fail(new Error("simulated failure"))
        }),
      )

      const exit = yield* Effect.exit(failure)
      expect(Exit.isFailure(exit)).toBe(true)

      const loaded = yield* store.loadGraphState()
      expect(loaded.contexts).toHaveLength(1)
      expect(loaded.contexts[0].name).toBe("Stable")
    }),
  )

  it.instance("creates the design directory and sqlite file", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const expectedFile = path.join(test.directory, ".opencode/design/design.sqlite")
      const designStore = yield* DesignStore.Service
      const store = designStore.store
      yield* store.ensureSchema()

      const exists = yield* Effect.promise(() => Bun.file(expectedFile).exists())
      expect(exists).toBe(true)
    }),
  )
})
