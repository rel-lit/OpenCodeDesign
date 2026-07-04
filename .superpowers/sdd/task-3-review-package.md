# Review Package: Task 3

## Commits

`
792aa9ac6 refactor(design): extract EventLog factory
`

## Stat

`
 packages/opencode/src/design/core/event-log.ts     | 82 ++++++++++++----------
 .../opencode/test/design/core/event-log.test.ts    | 10 +++
 2 files changed, 54 insertions(+), 38 deletions(-)
`

## Diff

`diff
diff --git a/packages/opencode/src/design/core/event-log.ts b/packages/opencode/src/design/core/event-log.ts
index 9b7ad2556..018b36e69 100644
--- a/packages/opencode/src/design/core/event-log.ts
+++ b/packages/opencode/src/design/core/event-log.ts
@@ -1,73 +1,79 @@
 import { Context, Effect, Layer } from "effect"
 import { LayerNode } from "@opencode-ai/core/effect/layer-node"
 import { DesignTypes } from "./types"
 
 export interface Interface {
   readonly append: (input: {
+    id?: string
     eventType: DesignTypes.EventType
     affectedNodeIds?: string[]
     affectedEdgeKeys?: string[]
     reason?: string
     rollbackTarget?: string
   }) => Effect.Effect<DesignTypes.EventNode>
   readonly rollbackTo: (eventId: string) => Effect.Effect<DesignTypes.EventNode, Error>
   readonly list: () => Effect.Effect<DesignTypes.EventNode[]>
 }
 
 export class Service extends Context.Service<Service, Interface>()("@opencode/DesignEventLog") {}
 
 const makeId = () => `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
 
-export const layer = Layer.effect(
-  Service,
-  Effect.gen(function* () {
-    let events: DesignTypes.EventNode[] = []
+export const makeEventLog = Effect.fn("EventLog.make")(function* () {
+  let events: DesignTypes.EventNode[] = []
 
-    const append = Effect.fn("EventLog.append")(function* (input) {
-      const event: DesignTypes.EventNode = {
-        id: makeId(),
-        name: input.eventType,
-        contextId: "event-log",
-        aliases: [],
-        defaultSemantics: "",
-        connectedEdges: [],
-        createdAt: Date.now(),
-        updatedAt: Date.now(),
-        retired: false,
-        eventType: input.eventType,
-        timestamp: Date.now(),
-        affectedNodeIds: input.affectedNodeIds ?? [],
-        affectedEdgeKeys: input.affectedEdgeKeys ?? [],
-        reason: input.reason,
-        rollbackTarget: input.rollbackTarget,
-      }
-      events.push(event)
-      return event
-    })
+  const append = Effect.fn("EventLog.append")(function* (input) {
+    const event: DesignTypes.EventNode = {
+      id: input.id ?? makeId(),
+      name: input.eventType,
+      contextId: "event-log",
+      aliases: [],
+      defaultSemantics: "",
+      connectedEdges: [],
+      createdAt: Date.now(),
+      updatedAt: Date.now(),
+      retired: false,
+      eventType: input.eventType,
+      timestamp: Date.now(),
+      affectedNodeIds: input.affectedNodeIds ?? [],
+      affectedEdgeKeys: input.affectedEdgeKeys ?? [],
+      reason: input.reason,
+      rollbackTarget: input.rollbackTarget,
+    }
+    events.push(event)
+    return event
+  })
 
-    const rollbackTo = Effect.fn("EventLog.rollbackTo")(function* (eventId) {
-      const index = events.findIndex((e) => e.id === eventId)
-      if (index < 0) return yield* Effect.fail(new Error(`Event not found: ${eventId}`))
-      events = events.slice(0, index + 1)
-      return yield* append({
-        eventType: "event_rollback",
-        rollbackTarget: eventId,
-        reason: `Rolled back to event ${eventId}`,
-      })
+  const rollbackTo = Effect.fn("EventLog.rollbackTo")(function* (eventId) {
+    const index = events.findIndex((e) => e.id === eventId)
+    if (index < 0) return yield* Effect.fail(new Error(`Event not found: ${eventId}`))
+    events = events.slice(0, index + 1)
+    return yield* append({
+      eventType: "event_rollback",
+      rollbackTarget: eventId,
+      reason: `Rolled back to event ${eventId}`,
     })
+  })
 
-    const list = Effect.fnUntraced(function* () {
-      return [...events]
-    })
+  const list = Effect.fnUntraced(function* () {
+    return [...events]
+  })
 
-    return Service.of({ append, rollbackTo, list })
+  return { append, rollbackTo, list } satisfies Interface
+})
+
+export const layer = Layer.effect(
+  Service,
+  Effect.gen(function* () {
+    const log = yield* makeEventLog()
+    return Service.of(log)
   }),
 )
 
 export const defaultLayer = layer
 
 export const node = LayerNode.make({
   service: Service,
   layer: defaultLayer,
   deps: [],
 })
diff --git a/packages/opencode/test/design/core/event-log.test.ts b/packages/opencode/test/design/core/event-log.test.ts
index 40e071f36..fcb50f2cd 100644
--- a/packages/opencode/test/design/core/event-log.test.ts
+++ b/packages/opencode/test/design/core/event-log.test.ts
@@ -20,11 +20,21 @@ describe("EventLog", () => {
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
+
+  it.effect("preserves supplied event id", () =>
+    Effect.gen(function* () {
+      const log = yield* EventLog.Service
+      const event = yield* log.append({ id: "restored-123", eventType: "node_created" })
+      expect(event.id).toBe("restored-123")
+      const events = yield* log.list()
+      expect(events[0].id).toBe("restored-123")
+    }),
+  )
 })
`
