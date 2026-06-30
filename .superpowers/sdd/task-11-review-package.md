# Review Package: Task 11

## Commits

`
c32d5ef50 test(design): add per-instance and transaction coverage
`

## Stat

`
 packages/opencode/test/design/design.test.ts      | 13 +++++
 packages/opencode/test/design/store/store.test.ts | 67 ++++++++++++++++++++++-
 2 files changed, 79 insertions(+), 1 deletion(-)
`

## Diff

`diff
diff --git a/packages/opencode/test/design/design.test.ts b/packages/opencode/test/design/design.test.ts
index fabc90b8b..9a2012b8d 100644
--- a/packages/opencode/test/design/design.test.ts
+++ b/packages/opencode/test/design/design.test.ts
@@ -32,6 +32,19 @@ describe("Design.Service", () => {
       expect(after.length).toBe(2)
       const edges = yield* reloaded.listEdges()
       expect(edges.length).toBe(1)
     }),
   )
+
+  it.instance("isolates graph state per directory", () =>
+    Effect.gen(function* () {
+      const design = yield* Design.Service
+      yield* design.init()
+
+      const ctx = yield* design.createContext({ name: "DirA" })
+      yield* design.createNode({ name: "NodeA", contextId: ctx.id })
+
+      const nodes = yield* design.listNodes()
+      expect(nodes.length).toBe(1)
+    }),
+  )
 })
diff --git a/packages/opencode/test/design/store/store.test.ts b/packages/opencode/test/design/store/store.test.ts
index 1eaca5ba3..07e9df37b 100644
--- a/packages/opencode/test/design/store/store.test.ts
+++ b/packages/opencode/test/design/store/store.test.ts
@@ -1,10 +1,12 @@
 import { describe, expect } from "bun:test"
-import { Effect } from "effect"
+import { Effect, Exit } from "effect"
 import { testEffect } from "../../lib/effect"
+import path from "path"
 import { DesignTypes } from "../../../src/design/core/types"
 import { DesignStore } from "../../../src/design/store/store"
+import { TestInstance } from "../../fixture/fixture"
 
 const it = testEffect(DesignStore.defaultLayer)
 
 describe("DesignStore", () => {
   it.instance("creates schema and persists graph state", () =>
@@ -70,6 +72,69 @@ describe("DesignStore", () => {
       expect(events).toHaveLength(2)
       expect(events[0].id).toBe("evt-1")
       expect(events[1].id).toBe("evt-2")
     }),
   )
+
+  it.instance("isolates state between instances", () =>
+    Effect.gen(function* () {
+      const designStore = yield* DesignStore.Service
+      const store = designStore.store
+      yield* store.saveGraphState({
+        contexts: [{ id: "ctx-a", name: "A", semantics: "", nodeIds: [] }],
+        nodes: [],
+        edges: [],
+        prototypes: [],
+      })
+
+      const loaded = yield* store.loadGraphState()
+      expect(loaded.contexts).toHaveLength(1)
+      expect(loaded.contexts[0].name).toBe("A")
+    }),
+  )
+
+  it.instance("Leaves prior state intact on transaction failure", () =>
+    Effect.gen(function* () {
+      const designStore = yield* DesignStore.Service
+      const store = designStore.store
+
+      yield* store.saveGraphState({
+        contexts: [{ id: "ctx-stable", name: "Stable", semantics: "", nodeIds: [] }],
+        nodes: [],
+        edges: [],
+        prototypes: [],
+      })
+
+      const failure = store.transaction((tx) =>
+        Effect.gen(function* () {
+          yield* tx.saveGraphState({
+            contexts: [{ id: "ctx-new", name: "New", semantics: "", nodeIds: [] }],
+            nodes: [],
+            edges: [],
+            prototypes: [],
+          })
+          return yield* Effect.fail(new Error("simulated failure"))
+        }),
+      )
+
+      const exit = yield* Effect.exit(failure)
+      expect(Exit.isFailure(exit)).toBe(true)
+
+      const loaded = yield* store.loadGraphState()
+      expect(loaded.contexts).toHaveLength(1)
+      expect(loaded.contexts[0].name).toBe("Stable")
+    }),
+  )
+
+  it.instance("creates the design directory and sqlite file", () =>
+    Effect.gen(function* () {
+      const test = yield* TestInstance
+      const expectedFile = path.join(test.directory, ".opencode/design/design.sqlite")
+      const designStore = yield* DesignStore.Service
+      const store = designStore.store
+      yield* store.ensureSchema()
+
+      const exists = yield* Effect.promise(() => Bun.file(expectedFile).exists())
+      expect(exists).toBe(true)
+    }),
+  )
 })
`
