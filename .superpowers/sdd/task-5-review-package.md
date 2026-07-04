# Review Package: Task 5 (including all fixes)

## Commits

`
199fbceca fix(design): wrap public methods in Effect.fn for tracing
860fd733b refactor(design): address Task 5 re-review quality issues
821be6d88 fix(design): remove mutable stateRef export and reload via InstanceStore
0dcda8dff feat(design): make Design.Service per-instance and SQLite-backed
`

## Stat

`
 .superpowers/sdd/task-5-report.md            | 219 ++++++++++++++++++++++++++
 packages/opencode/src/design/design.ts       | 221 ++++++++++++++++++---------
 packages/opencode/test/design/design.test.ts |  37 +++++
 3 files changed, 408 insertions(+), 69 deletions(-)
`

## Diff

`diff
diff --git a/.superpowers/sdd/task-5-report.md b/.superpowers/sdd/task-5-report.md
new file mode 100644
index 000000000..9e75b237e
--- /dev/null
+++ b/.superpowers/sdd/task-5-report.md
@@ -0,0 +1,219 @@
+# Task 5 Report: Rewrite `Design.Service` as per-instance facade
+
+## What was implemented
+
+Rewrote `packages/opencode/src/design/design.ts` so `Design.Service` becomes a per-instance facade backed by SQLite via `DesignStore`.
+
+Key changes:
+- `Design.Service` now uses `InstanceState.make<DesignState>` to create one private `{ graph, workingSet, eventLog, store }` tuple per project directory.
+- On instance startup, the service loads the previously persisted graph state from SQLite and re-hydrates the in-memory `GraphEngine`, `WorkingSet`, and `EventLog`.
+- Every mutating operation (`createContext`, `createNode`, `createEdge`, `resolveReference`) appends an event and then calls `persistMutation`, which runs `store.transaction` to save the graph state and append the event atomically.
+- Removed the old `save`/`load` methods from the public interface and replaced them with `init()`.
+- `Design.defaultLayer` now provides `DesignStore.defaultLayer` instead of the old `GraphEngine`/`WorkingSet`/`EventLog`/`Persistence` layers.
+- `Design.node` dependency list updated to `[DesignStore.node]`.
+- Exported `Design.stateRef` so tests can invalidate per-instance state.
+
+Note: the brief placed `yield* DesignStore.Service` inside the `InstanceState.make` initializer. To satisfy Effect's requirement tracking, the `DesignStore.Service` is yielded at the layer level and captured in the initializer closure. This keeps the `InstanceState`'s requirement set to `Scope.Scope` only, so the public `Design.Service` methods do not leak the `DesignStore` dependency.
+
+## Files changed
+
+- `packages/opencode/src/design/design.ts` (rewritten)
+- `packages/opencode/test/design/design.test.ts` (new integration test)
+
+## What was tested
+
+Created `packages/opencode/test/design/design.test.ts` with one integration test:
+- Creates a context, two nodes, and an edge.
+- Verifies two nodes exist.
+- Invalidates `Design.stateRef` to simulate a reload.
+- Re-acquires `Design.Service`, calls `init()`.
+- Verifies both nodes and the edge are restored from SQLite.
+
+### Test results
+
+```
+bun test test/design/design.test.ts
+ 1 pass
+ 0 fail
+```
+
+Full design suite:
+
+```
+bun test test/design
+ 24 pass
+ 0 fail
+```
+
+Package-wide typecheck:
+
+```
+bun typecheck
+(no errors)
+```
+
+## Self-review findings
+
+- All spec requirements implemented.
+- Typecheck is clean.
+- All design tests pass.
+- The mutable module-level `stateRef` works for the current single-test usage but could race if multiple test files concurrently build `Design.defaultLayer` and access `Design.stateRef`. This is acceptable for the current milestone because only the new test uses it, and the assignment/use are sequential within each test's Effect fiber.
+- The integration test verifies real SQLite persistence, not mocked behavior.
+
+## Concerns
+
+- `Design.stateRef` is a mutable module-level export. It is intended only for tests and should not be used from production code.
+- If a SQLite transaction fails after the in-memory graph has been mutated, the in-memory state and SQLite state will diverge. This matches the note in the brief and is accepted for this milestone.
+
+---
+
+# Task 5 Fix Report: Remove mutable `stateRef` export
+
+## What was fixed
+
+Removed the mutable module-level `stateRef` export from `packages/opencode/src/design/design.ts` and updated the integration test to verify SQLite persistence through `InstanceStore.reload` instead.
+
+Key changes:
+- Removed `export let stateRef: InstanceState.InstanceState<DesignState, never, Scope.Scope>` from `design.ts`.
+- Removed the `stateRef = designState` assignment inside the layer generator.
+- Updated `packages/opencode/test/design/design.test.ts` to:
+  - Yield `TestInstance` to obtain the temporary directory.
+  - Yield `InstanceStore.Service` and call `store.reload({ directory: test.directory })` to dispose and recreate the instance.
+  - Re-acquire `Design.Service`, call `init()`, and verify restored nodes and edges.
+  - Add an explicit assertion that restored node IDs match the original IDs.
+
+## Files changed
+
+- `packages/opencode/src/design/design.ts`
+- `packages/opencode/test/design/design.test.ts`
+- `.superpowers/sdd/task-5-report.md` (this report)
+
+## Test results
+
+```
+bun test test/design/design.test.ts
+ 1 pass
+ 0 fail
+ 4 expect() calls
+```
+
+## Typecheck results
+
+```
+bun typecheck
+$ tsgo --noEmit
+(no errors)
+```
+
+## Issues or concerns
+
+None. The persistence test still exercises real SQLite reload behavior without exposing a mutable module-level handle.
+
+---
+
+# Task 5 Second Fix Report: Quality issues from re-review
+
+## What was fixed
+
+Addressed one Important and two Minor quality issues in `packages/opencode/src/design/design.ts`:
+
+1. **Removed unnecessary `as DesignState` type assertion** (Important)
+   - Location: `packages/opencode/src/design/design.ts:87`
+   - Changed `return { graph, workingSet, eventLog, store } as DesignState` to `return { graph, workingSet, eventLog, store }`.
+   - The object literal already satisfies `DesignState`; the cast only masked potential future type mismatches.
+
+2. **Wrapped `init` in `Effect.fn`** (Minor)
+   - Location: `packages/opencode/src/design/design.ts:179-183`
+   - Changed `const init = () => Effect.gen(function* () { ... })` to `const init = Effect.fn("Design.init")(function* () { ... })`.
+   - Aligns with the project's Effect rules for named/traced effects.
+
+3. **Used `import type` for `Scope`** (Minor)
+   - Location: `packages/opencode/src/design/design.ts:1`
+   - Split `import { Context, Effect, Layer, Scope } from "effect"` into `import { Context, Effect, Layer } from "effect"` and `import type { Scope } from "effect"`.
+   - `Scope` is only used as a type argument to `InstanceState.make`, so it should be a type-only import.
+
+## Files changed
+
+- `packages/opencode/src/design/design.ts`
+- `.superpowers/sdd/task-5-report.md` (this report)
+
+## Test results
+
+```
+bun test test/design/design.test.ts
+bun test v1.3.14 (0d9b296a)
+
+test\design\design.test.ts:
+(pass) Design.Service > persists nodes and edges across reload [82.24ms]
+
+ 1 pass
+ 0 fail
+ 4 expect() calls
+Ran 1 test across 1 file. [2.29s]
+```
+
+## Typecheck results
+
+```
+bun typecheck
+$ tsgo --noEmit
+```
+
+## Issues or concerns
+
+None. All requested quality fixes are applied, tests pass, and typecheck is clean.
+
+---
+
+# Task 5 Third Fix Report: Named effects for public methods
+
+## What was fixed
+
+Addressed the Important observability/style issue found in the final Task 5 re-review for `packages/opencode/src/design/design.ts`:
+
+Public methods and `persistMutation` were anonymous `Effect.gen` blocks. The project's AGENTS.md Effect rules require `Effect.fn("Domain.method")` for named/traced effects.
+
+Wrapped each of the following in `Effect.fn("Design.<name>")`:
+
+- `persistMutation` → `Effect.fn("Design.persistMutation")`
+- `createContext` → `Effect.fn("Design.createContext")`
+- `createNode` → `Effect.fn("Design.createNode")`
+- `createEdge` → `Effect.fn("Design.createEdge")`
+- `resolveReference` → `Effect.fn("Design.resolveReference")`
+- `getState` → `Effect.fn("Design.getState")`
+
+`init` was already wrapped as `Effect.fn("Design.init")` in the previous fix and was left unchanged.
+
+Signatures and behavior are identical; only naming/tracing was added. The closures capturing `use`, `designState`, and `persistMutation` continue to work unchanged.
+
+## Files changed
+
+- `packages/opencode/src/design/design.ts`
+- `.superpowers/sdd/task-5-report.md` (this report)
+
+## Test results
+
+```
+bun test test/design/design.test.ts
+bun test v1.3.14 (0d9b296a)
+
+test\design\design.test.ts:
+(pass) Design.Service > persists nodes and edges across reload [86.68ms]
+
+ 1 pass
+ 0 fail
+ 4 expect() calls
+Ran 1 test across 1 file. [2.64s]
+```
+
+## Typecheck results
+
+```
+bun typecheck
+$ tsgo --noEmit
+(no errors)
+```
+
+## Issues or concerns
+
+None. All public Design methods are now named/traced effects, tests pass, and typecheck is clean.
diff --git a/packages/opencode/src/design/design.ts b/packages/opencode/src/design/design.ts
index cb69b31bf..ac717f70d 100644
--- a/packages/opencode/src/design/design.ts
+++ b/packages/opencode/src/design/design.ts
@@ -1,130 +1,213 @@
 import { Context, Effect, Layer } from "effect"
+import type { Scope } from "effect"
 import { LayerNode } from "@opencode-ai/core/effect/layer-node"
+import { InstanceState } from "@/effect/instance-state"
 import { GraphEngine } from "./core/graph"
 import { WorkingSet } from "./core/working-set"
 import { EventLog } from "./core/event-log"
-import { Persistence } from "./core/persistence"
 import { DesignTypes } from "./core/types"
+import { DesignStore } from "./store/store"
 
 export interface Interface {
   readonly createContext: GraphEngine.Interface["createContext"]
   readonly createNode: GraphEngine.Interface["createNode"]
   readonly createEdge: GraphEngine.Interface["createEdge"]
   readonly resolveReference: WorkingSet.Interface["resolveReference"]
   readonly listNodes: GraphEngine.Interface["listNodes"]
   readonly listEdges: GraphEngine.Interface["listEdges"]
   readonly listWorkingSet: WorkingSet.Interface["list"]
   readonly getState: () => Effect.Effect<DesignTypes.GraphState>
-  readonly save: () => Effect.Effect<void>
-  readonly load: () => Effect.Effect<void>
+  readonly init: () => Effect.Effect<void>
 }
 
 export class Service extends Context.Service<Service, Interface>()("@opencode/Design") {}
 
+type DesignState = {
+  readonly graph: GraphEngine.Interface
+  readonly workingSet: WorkingSet.Interface
+  readonly eventLog: EventLog.Interface
+  readonly store: DesignStore.Store
+}
+
 export const layer = Layer.effect(
   Service,
   Effect.gen(function* () {
-    const graph = yield* GraphEngine.Service
-    const workingSet = yield* WorkingSet.Service
-    const eventLog = yield* EventLog.Service
-    const persistence = yield* Persistence.Service
-
-    const getState = Effect.fn("Design.getState")(function* () {
-      const [nodes, edges, prototypes, contexts] = yield* Effect.all([
-        graph.listNodes(),
-        graph.listEdges(),
-        graph.listPrototypes(),
-        graph.listContexts(),
-      ])
-      const ws = yield* workingSet.state()
-      const events = yield* eventLog.list()
-      return {
-        nodes,
-        edges,
-        prototypes,
-        contexts,
-        workingSet: ws,
-        eventLog: { events },
-      }
-    })
+    const designStore = yield* DesignStore.Service
 
-    const save = Effect.fn("Design.save")(function* () {
-      const state = yield* getState()
-      yield* persistence.save(state)
-    })
+    const designState = yield* InstanceState.make<DesignState, never, Scope.Scope>(
+      Effect.fn("Design.state")(function* () {
+        const store = designStore.store
 
-    const load = Effect.fn("Design.load")(function* () {
-      const loaded = yield* persistence.load()
-      if (!loaded) return
-      // In first milestone, loaded state is not restored into in-memory engine.
-      // Restoration will be implemented in P2.
-      yield* Effect.log("Loaded design state (restoration deferred to P2)")
-    })
+        const loaded = yield* store.loadGraphState()
 
-    const persistMutation = Effect.fn("Design.persistMutation")(function* (event: DesignTypes.EventNode) {
-      yield* persistence.appendEvent(event)
-      yield* save()
-    })
+        const graph = yield* GraphEngine.makeEngine()
+        const workingSet = yield* WorkingSet.makeWorkingSet(20)(graph)
+        const eventLog = yield* EventLog.makeEventLog()
 
-    return Service.of({
-      createContext: (input) =>
+        if (loaded.nodes.length > 0 || loaded.contexts.length > 0) {
+          for (const ctx of loaded.contexts) {
+            yield* graph.createContext({ id: ctx.id, name: ctx.name, semantics: ctx.semantics })
+          }
+          for (const proto of loaded.prototypes) {
+            yield* graph.createPrototype({
+              id: proto.id,
+              name: proto.name,
+              defaultSemantics: proto.defaultSemantics,
+              parameterSchema: proto.parameterSchema,
+            })
+          }
+          for (const node of loaded.nodes) {
+            yield* graph.createNode({
+              id: node.id,
+              name: node.name,
+              contextId: node.contextId,
+              defaultSemantics: node.defaultSemantics,
+              aliases: [...node.aliases],
+            })
+          }
+          for (const edge of loaded.edges) {
+            yield* graph.createEdge({
+              leftNodeId: edge.leftNodeId,
+              rightNodeId: edge.rightNodeId,
+              prototypeId: edge.prototypeId,
+              parameters: { ...edge.parameters },
+            })
+          }
+          for (const event of loaded.eventLog.events) {
+            yield* eventLog.append({
+              id: event.id,
+              eventType: event.eventType,
+              affectedNodeIds: [...event.affectedNodeIds],
+              affectedEdgeKeys: [...event.affectedEdgeKeys],
+              reason: event.reason,
+              rollbackTarget: event.rollbackTarget,
+            })
+          }
+        }
+
+        return { graph, workingSet, eventLog, store }
+      }),
+    )
+
+    const use = <A, E>(select: (state: DesignState) => Effect.Effect<A, E>) =>
+      Effect.gen(function* () {
+        const state = yield* InstanceState.get(designState)
+        return yield* select(state)
+      })
+
+    const persistMutation = Effect.fn("Design.persistMutation")((event: DesignTypes.EventNode) =>
+      use((state) =>
+        state.store.transaction((txStore) =>
+          Effect.gen(function* () {
+            const graphState = yield* state.graph.getState()
+            yield* txStore.saveGraphState(graphState)
+            yield* txStore.appendEvent(event)
+          }),
+        ),
+      ),
+    )
+
+    const createContext = Effect.fn("Design.createContext")((input: Parameters<GraphEngine.Interface["createContext"]>[0]) =>
+      use((state) =>
         Effect.gen(function* () {
-          const ctx = yield* graph.createContext(input)
-          const event = yield* eventLog.append({ eventType: "context_created", affectedNodeIds: [], affectedEdgeKeys: [] })
-          yield* workingSet.activateContext(ctx.id)
+          const ctx = yield* state.graph.createContext(input)
+          const event = yield* state.eventLog.append({ eventType: "context_created", affectedNodeIds: [], affectedEdgeKeys: [] })
+          yield* state.workingSet.activateContext(ctx.id)
           yield* persistMutation(event)
           return ctx
         }),
-      createNode: (input) =>
+      ),
+    )
+
+    const createNode = Effect.fn("Design.createNode")((input: Parameters<GraphEngine.Interface["createNode"]>[0]) =>
+      use((state) =>
         Effect.gen(function* () {
-          const node = yield* graph.createNode(input)
-          const event = yield* eventLog.append({ eventType: "node_created", affectedNodeIds: [node.id] })
-          yield* workingSet.activateNode(node.id)
+          const node = yield* state.graph.createNode(input)
+          const event = yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [node.id] })
+          yield* state.workingSet.activateNode(node.id)
           yield* persistMutation(event)
           return node
         }),
-      createEdge: (input) =>
+      ),
+    )
+
+    const createEdge = Effect.fn("Design.createEdge")((input: Parameters<GraphEngine.Interface["createEdge"]>[0]) =>
+      use((state) =>
         Effect.gen(function* () {
-          const edge = yield* graph.createEdge(input)
-          const event = yield* eventLog.append({
+          const edge = yield* state.graph.createEdge(input)
+          const event = yield* state.eventLog.append({
             eventType: "edge_created",
             affectedNodeIds: [edge.leftNodeId, edge.rightNodeId],
             affectedEdgeKeys: [DesignTypes.edgeKey(edge.leftNodeId, edge.rightNodeId)],
           })
-          yield* Effect.all([workingSet.activateNode(edge.leftNodeId), workingSet.activateNode(edge.rightNodeId)])
+          yield* Effect.all([state.workingSet.activateNode(edge.leftNodeId), state.workingSet.activateNode(edge.rightNodeId)])
           yield* persistMutation(event)
           return edge
         }),
-      resolveReference: (input) =>
+      ),
+    )
+
+    const resolveReference = Effect.fn("Design.resolveReference")((input: Parameters<WorkingSet.Interface["resolveReference"]>[0]) =>
+      use((state) =>
         Effect.gen(function* () {
-          const result = yield* workingSet.resolveReference(input)
+          const result = yield* state.workingSet.resolveReference(input)
           if (result.action === "created") {
-            const event = yield* eventLog.append({ eventType: "node_created", affectedNodeIds: [result.nodeId] })
+            const event = yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [result.nodeId] })
             yield* persistMutation(event)
           }
           return result
         }),
-      listNodes: graph.listNodes,
-      listEdges: graph.listEdges,
-      listWorkingSet: workingSet.list,
+      ),
+    )
+
+    const getState = Effect.fn("Design.getState")(() =>
+      use((state) =>
+        Effect.gen(function* () {
+          const [nodes, edges, prototypes, contexts] = yield* Effect.all([
+            state.graph.listNodes(),
+            state.graph.listEdges(),
+            state.graph.listPrototypes(),
+            state.graph.listContexts(),
+          ])
+          const ws = yield* state.workingSet.state()
+          const events = yield* state.eventLog.list()
+          return {
+            nodes,
+            edges,
+            prototypes,
+            contexts,
+            workingSet: ws,
+            eventLog: { events },
+          }
+        }),
+      ),
+    )
+
+    const init = Effect.fn("Design.init")(function* () {
+      yield* InstanceState.get(designState)
+      yield* Effect.logInfo("design state initialized")
+    })
+
+    return Service.of({
+      createContext,
+      createNode,
+      createEdge,
+      resolveReference,
+      listNodes: () => use((state) => state.graph.listNodes()),
+      listEdges: () => use((state) => state.graph.listEdges()),
+      listWorkingSet: () => use((state) => state.workingSet.list()),
       getState,
-      save,
-      load,
+      init,
     })
   }),
 )
 
-export const defaultLayer = layer.pipe(
-  Layer.provide(WorkingSet.defaultLayer),
-  Layer.provide(GraphEngine.defaultLayer),
-  Layer.provide(EventLog.defaultLayer),
-  Layer.provide(Persistence.defaultLayer),
-)
+export const defaultLayer = layer.pipe(Layer.provide(DesignStore.defaultLayer))
 
 export const node = LayerNode.make({
   service: Service,
   layer: defaultLayer,
-  deps: [GraphEngine.node, WorkingSet.node, EventLog.node, Persistence.node],
+  deps: [DesignStore.node],
 })
 
 export * as Design from "./design"
diff --git a/packages/opencode/test/design/design.test.ts b/packages/opencode/test/design/design.test.ts
new file mode 100644
index 000000000..fabc90b8b
--- /dev/null
+++ b/packages/opencode/test/design/design.test.ts
@@ -0,0 +1,37 @@
+import { describe, expect } from "bun:test"
+import { Effect } from "effect"
+import { testEffect } from "../lib/effect"
+import { Design } from "../../src/design/design"
+import { InstanceStore } from "../../src/project/instance-store"
+import { TestInstance } from "../fixture/fixture"
+
+const it = testEffect(Design.defaultLayer)
+
+describe("Design.Service", () => {
+  it.instance("persists nodes and edges across reload", () =>
+    Effect.gen(function* () {
+      const test = yield* TestInstance
+      const design = yield* Design.Service
+      yield* design.init()
+
+      const ctx = yield* design.createContext({ name: "战斗系统" })
+      const ship = yield* design.createNode({ name: "船", contextId: ctx.id })
+      const hp = yield* design.createNode({ name: "生命值", contextId: ctx.id })
+      yield* design.createEdge({ leftNodeId: ship.id, rightNodeId: hp.id, prototypeId: "aggregate", parameters: {} })
+
+      const before = yield* design.listNodes()
+      expect(before.length).toBe(2)
+
+      const store = yield* InstanceStore.Service
+      yield* store.reload({ directory: test.directory })
+      const reloaded = yield* Design.Service
+      yield* reloaded.init()
+
+      const after = yield* reloaded.listNodes()
+      expect(after.map((n) => n.id)).toEqual([ship.id, hp.id])
+      expect(after.length).toBe(2)
+      const edges = yield* reloaded.listEdges()
+      expect(edges.length).toBe(1)
+    }),
+  )
+})
`
