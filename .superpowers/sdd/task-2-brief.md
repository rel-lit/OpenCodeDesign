### Task 2: Refactor `WorkingSet` into a reusable factory

**Files:**
- Modify: `packages/opencode/src/design/core/working-set.ts`

**Interfaces:**
- Consumes: `GraphEngine.Interface` instance (passed to factory).
- Produces: exported `makeWorkingSet(graph: GraphEngine.Interface, capacity?: number)` factory returning `Effect.Effect<WorkingSet.Interface>`.

**Why:** `WorkingSet` depends on `GraphEngine`. In the per-instance world, the working set for a project must talk to that same project's graph engine. A factory that receives the graph instance avoids global coupling.

- [ ] **Step 1: Extract factory**

Change the current `make = (capacity = 20) => Layer.effect(...)` into a pure factory:

```typescript
export const makeWorkingSet = (capacity = 20) =>
  Effect.fn("WorkingSet.make")(function* (graph: GraphEngine.Interface) {
    let workingSet: DeepMutable<DesignTypes.WorkingSet> = {
      activeContextIds: [],
      activeNodeIds: [],
      capacity,
    }

    // move state, list, activateContext, forgetContext, activateNode, forgetNode, resolveReference here

    return {
      activateNode,
      forgetNode,
      activateContext,
      forgetContext,
      resolveReference,
      list,
      state,
    } satisfies WorkingSet.Interface
  })
```

- [ ] **Step 2: Rewrite global `WorkingSet.Service` layer**

```typescript
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const graph = yield* GraphEngine.Service
    const ws = yield* makeWorkingSet(20)(graph)
    return Service.of(ws)
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(GraphEngine.defaultLayer))
```

- [ ] **Step 3: Verify `WorkingSet` tests still pass**

Run:
```bash
cd packages/opencode
bun test test/design/core/working-set.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/design/core/working-set.ts
git commit -m "refactor(design): extract WorkingSet factory"
```

---
