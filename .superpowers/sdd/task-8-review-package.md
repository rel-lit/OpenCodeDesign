# Review Package: Task 8

## Commits

`
acd5cc347 chore(design): remove legacy JSON/JSONL persistence
`

## Stat

`
 packages/opencode/src/design/core/persistence.ts   | 75 ----------------------
 packages/opencode/src/design/index.ts              |  1 -
 .../opencode/test/design/core/persistence.test.ts  | 58 -----------------
 3 files changed, 134 deletions(-)
`

## Diff

`diff
diff --git a/packages/opencode/src/design/core/persistence.ts b/packages/opencode/src/design/core/persistence.ts
deleted file mode 100644
index caac5936a..000000000
--- a/packages/opencode/src/design/core/persistence.ts
+++ /dev/null
@@ -1,75 +0,0 @@
-import { Context, Effect, Layer } from "effect"
-import { LayerNode } from "@opencode-ai/core/effect/layer-node"
-import fs from "fs/promises"
-import path from "path"
-import { DesignTypes } from "./types"
-import { InstanceState } from "@/effect/instance-state"
-
-export interface Interface {
-  readonly save: (state: DesignTypes.GraphState) => Effect.Effect<void>
-  readonly load: () => Effect.Effect<DesignTypes.GraphState | undefined>
-  readonly appendEvent: (event: DesignTypes.EventNode) => Effect.Effect<void>
-}
-
-export class Service extends Context.Service<Service, Interface>()("@opencode/DesignPersistence") {}
-
-const GRAPH_FILE = "graph.json"
-const EVENTS_FILE = "events.jsonl"
-const DESIGN_DIR = ".opencode/design"
-
-const paths = Effect.gen(function* () {
-  const instance = yield* InstanceState.context
-  const designDir = path.join(instance.directory, DESIGN_DIR)
-  const graphPath = path.join(designDir, GRAPH_FILE)
-  const eventsPath = path.join(designDir, EVENTS_FILE)
-  return { designDir, graphPath, eventsPath }
-})
-
-const ensureDir = (designDir: string) =>
-  Effect.gen(function* () {
-    const dir = Bun.file(designDir)
-    const exists = yield* Effect.promise(() => dir.exists())
-    if (!exists) {
-      yield* Effect.promise(() => fs.mkdir(designDir, { recursive: true }))
-    }
-  })
-
-export const layer = Layer.effect(
-  Service,
-  Effect.gen(function* () {
-    const save = Effect.fn("Persistence.save")(function* (state) {
-      const { designDir, graphPath } = yield* paths
-      yield* ensureDir(designDir)
-      const data = JSON.stringify(state, null, 2)
-      yield* Effect.promise(() => Bun.write(graphPath, data))
-    })
-
-    const load = Effect.fn("Persistence.load")(function* () {
-      const { graphPath } = yield* paths
-      const file = Bun.file(graphPath)
-      const exists = yield* Effect.promise(() => file.exists())
-      if (!exists) return undefined
-      const text = yield* Effect.promise(() => file.text())
-      return JSON.parse(text) as DesignTypes.GraphState
-    })
-
-    const appendEvent = Effect.fn("Persistence.appendEvent")(function* (event) {
-      const { designDir, eventsPath } = yield* paths
-      yield* ensureDir(designDir)
-      const line = JSON.stringify(event) + "\n"
-      yield* Effect.promise(() => fs.appendFile(eventsPath, line))
-    })
-
-    return Service.of({ save, load, appendEvent })
-  }),
-)
-
-export const defaultLayer = layer
-
-export const node = LayerNode.make({
-  service: Service,
-  layer: defaultLayer,
-  deps: [],
-})
-
-export * as Persistence from "./persistence"
diff --git a/packages/opencode/src/design/index.ts b/packages/opencode/src/design/index.ts
index 991e1f5e9..f68d2b9b0 100644
--- a/packages/opencode/src/design/index.ts
+++ b/packages/opencode/src/design/index.ts
@@ -1,6 +1,5 @@
 export * as Design from "./design"
 export * as GraphEngine from "./core/graph"
 export * as WorkingSet from "./core/working-set"
 export * as EventLog from "./core/event-log"
-export * as Persistence from "./core/persistence"
 export * as DesignTypes from "./core/types"
diff --git a/packages/opencode/test/design/core/persistence.test.ts b/packages/opencode/test/design/core/persistence.test.ts
deleted file mode 100644
index b5d4b655a..000000000
--- a/packages/opencode/test/design/core/persistence.test.ts
+++ /dev/null
@@ -1,58 +0,0 @@
-import { describe, expect } from "bun:test"
-import { Effect } from "effect"
-import path from "path"
-import { testEffect } from "../../lib/effect"
-import { TestInstance } from "../../fixture/fixture"
-import { Persistence } from "../../../src/design/core/persistence"
-import { DesignTypes } from "../../../src/design/core/types"
-
-const it = testEffect(Persistence.defaultLayer)
-
-describe("Persistence", () => {
-  it.instance("saves and loads graph state", () =>
-    Effect.gen(function* () {
-      const persistence = yield* Persistence.Service
-      const state: DesignTypes.GraphState = {
-        nodes: [],
-        edges: [],
-        prototypes: [],
-        contexts: [],
-        workingSet: { activeContextIds: [], activeNodeIds: [], capacity: 20 },
-        eventLog: { events: [] },
-      }
-      yield* persistence.save(state)
-      const loaded = yield* persistence.load()
-      expect(loaded).toEqual(state)
-    }),
-  )
-
-  it.instance("appends events to events.jsonl", () =>
-    Effect.gen(function* () {
-      const persistence = yield* Persistence.Service
-      const event: DesignTypes.EventNode = {
-        id: "evt-1",
-        name: "node-created",
-        contextId: "event-log",
-        aliases: [],
-        defaultSemantics: "",
-        connectedEdges: [],
-        createdAt: 1,
-        updatedAt: 1,
-        retired: false,
-        eventType: "node_created",
-        timestamp: 1,
-        affectedNodeIds: ["node-1"],
-        affectedEdgeKeys: [],
-      }
-      yield* persistence.appendEvent(event)
-      yield* persistence.appendEvent({ ...event, id: "evt-2" })
-      const test = yield* TestInstance
-      const file = Bun.file(path.join(test.directory, ".opencode/design/events.jsonl"))
-      const text = yield* Effect.promise(() => file.text())
-      const lines = text.trim().split("\n")
-      expect(lines.length).toBe(2)
-      expect(JSON.parse(lines[0]).id).toBe("evt-1")
-      expect(JSON.parse(lines[1]).id).toBe("evt-2")
-    }),
-  )
-})
`
