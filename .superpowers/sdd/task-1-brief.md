### Task 1: Refactor `GraphEngine` into a reusable factory

**Files:**
- Modify: `packages/opencode/src/design/core/graph.ts`

**Interfaces:**
- Consumes: nothing (pure in-memory graph logic).
- Produces: exported `makeEngine` factory returning `Effect.Effect<GraphEngine.Interface>`; `GraphEngine.Service` becomes a global wrapper that delegates to a single internal engine instance.

**Why:** `Design.Service` must own a private `GraphEngine` instance per project. Extracting a factory lets both the legacy global service and the new per-instance `Design.Service` share the same implementation without either knowing about SQLite.

- [ ] **Step 1: Extract factory from current implementation**

Replace the inline mutable state and method definitions with an exported `makeEngine` function that returns an object matching `GraphEngine.Interface`.

First update `GraphEngine.Interface` to accept an optional `id` in `createNode` and expose `getState`:

```typescript
export interface Interface {
  readonly createNode: (input: {
    id?: string
    name: string
    contextId: string
    defaultSemantics?: string
    aliases?: string[]
  }) => Effect.Effect<DesignTypes.Node>
  // ... existing methods ...
  readonly getState: () => Effect.Effect<{
    nodes: DesignTypes.Node[]
    edges: DesignTypes.Edge[]
    prototypes: DesignTypes.RelationPrototype[]
    contexts: DesignTypes.BoundedContext[]
  }>
}
```

Then extract the factory:

```typescript
export const makeEngine = Effect.fn("GraphEngine.make")(function* () {
  let state: MutableState = {
    nodes: [],
    edges: [],
    prototypes: [],
    contexts: [],
    workingSet: { activeContextIds: [], activeNodeIds: [], capacity: 20 },
    eventLog: { events: [] },
  }

  const now = () => Date.now()

  // Move createNode, getNode, listNodes, findNodesByName,
  // createContext, getContext, listContexts,
  // createPrototype, getPrototype, listPrototypes,
  // createEdge, updateEdge, deleteEdge, getEdge, listEdges, listEdgesForNode
  // here as local functions, exactly as they are today, operating on `state`.

  const getState = Effect.fnUntraced(function* () {
    return {
      nodes: [...state.nodes],
      edges: [...state.edges],
      prototypes: [...state.prototypes],
      contexts: [...state.contexts],
    }
  })

  return {
    createNode,
    updateNode,
    retireNode,
    deleteNode,
    getNode,
    listNodes,
    findNodesByName,
    createContext,
    getContext,
    listContexts,
    createPrototype,
    getPrototype,
    listPrototypes,
    createEdge,
    updateEdge,
    deleteEdge,
    getEdge,
    listEdges,
    listEdgesForNode,
    getState,
  } satisfies GraphEngine.Interface
})
```

- [ ] **Step 2: Rewrite `GraphEngine.Service` as a global wrapper over the factory**

```typescript
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const engine = yield* makeEngine
    return Service.of(engine)
  }),
)
```

Inside the moved `createNode` implementation, use `id: input.id ?? makeId("node")` so that restored nodes keep their original IDs.

- [ ] **Step 3: Verify `GraphEngine` tests still pass**

Run:
```bash
cd packages/opencode
bun test test/design/core/graph.test.ts
```

Expected: all tests pass with no changes to test files.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/design/core/graph.ts
git commit -m "refactor(design): extract GraphEngine factory"
```

---
