### Task 5: Rewrite `Design.Service` as per-instance facade

**Files:**
- Modify: `packages/opencode/src/design/design.ts`
- Create: `packages/opencode/test/design/design.test.ts`

**Interfaces:**
- Consumes: `GraphEngine.Interface`, `WorkingSet.Interface`, `EventLog.Interface` (all created via factories), `DesignStore.Service`.
- Produces: `Design.Service` with the same public methods as today, but backed by per-instance state and transactional SQLite persistence.

**Why:** This is the central change. Design state becomes project-scoped, loads from SQLite during instance startup, and persists mutations transactionally.

- [ ] **Step 1: Define per-instance state shape and rewrite `Design.Service`**

Modify `packages/opencode/src/design/design.ts`:

```typescript
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { GraphEngine } from "./core/graph"
import { WorkingSet } from "./core/working-set"
import { EventLog } from "./core/event-log"
import { DesignTypes } from "./core/types"
import { DesignStore } from "./store/store"

export interface Interface {
  readonly createContext: GraphEngine.Interface["createContext"]
  readonly createNode: GraphEngine.Interface["createNode"]
  readonly createEdge: GraphEngine.Interface["createEdge"]
  readonly resolveReference: WorkingSet.Interface["resolveReference"]
  readonly listNodes: GraphEngine.Interface["listNodes"]
  readonly listEdges: GraphEngine.Interface["listEdges"]
  readonly listWorkingSet: WorkingSet.Interface["list"]
  readonly getState: () => Effect.Effect<DesignTypes.GraphState>
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Design") {}

type DesignState = {
  readonly graph: GraphEngine.Interface
  readonly workingSet: WorkingSet.Interface
  readonly eventLog: EventLog.Interface
  readonly store: DesignStore.Store
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const designState = yield* InstanceState.make<DesignState>(
      Effect.fn("Design.state")(function* () {
        const designStore = yield* DesignStore.Service
        const store = designStore.store

    const loaded = yield* store.loadGraphState()

    const graph = yield* GraphEngine.makeEngine
    const workingSet = yield* WorkingSet.makeWorkingSet(20)(graph)
    const eventLog = yield* EventLog.makeEventLog

    if (loaded.nodes.length > 0 || loaded.contexts.length > 0) {
      for (const ctx of loaded.contexts) {
        yield* graph.createContext({ id: ctx.id, name: ctx.name, semantics: ctx.semantics })
      }
      for (const proto of loaded.prototypes) {
        yield* graph.createPrototype({
          id: proto.id,
          name: proto.name,
          defaultSemantics: proto.defaultSemantics,
          parameterSchema: proto.parameterSchema,
        })
      }
      for (const node of loaded.nodes) {
        yield* graph.createNode({
          id: node.id,
          name: node.name,
          contextId: node.contextId,
          defaultSemantics: node.defaultSemantics,
          aliases: [...node.aliases],
        })
      }
          for (const edge of loaded.edges) {
            yield* graph.createEdge({
              leftNodeId: edge.leftNodeId,
              rightNodeId: edge.rightNodeId,
              prototypeId: edge.prototypeId,
              parameters: { ...edge.parameters },
            })
          }
          for (const event of loaded.eventLog.events) {
            yield* eventLog.append({
              id: event.id,
              eventType: event.eventType,
              affectedNodeIds: [...event.affectedNodeIds],
              affectedEdgeKeys: [...event.affectedEdgeKeys],
              reason: event.reason,
              rollbackTarget: event.rollbackTarget,
            })
          }
        }

        return { graph, workingSet, eventLog, store }
      }),
    )

    const use = <A>(select: (state: DesignState) => Effect.Effect<A>) =>
      Effect.gen(function* () {
        const state = yield* InstanceState.get(designState)
        return yield* select(state)
      })

    const persistMutation = (event: DesignTypes.EventNode) =>
      use((state) =>
        state.store.transaction((txStore) =>
          Effect.gen(function* () {
            const graphState = yield* state.graph.getState()
            yield* txStore.saveGraphState(graphState)
            yield* txStore.appendEvent(event)
          }),
        ),
      )

    // Note: graph/eventLog mutations happen before persistMutation. If the SQLite transaction
    // fails, the in-memory state will have changed while the SQLite state has not. For this
    // milestone we accept that divergence; a future iteration can move mutations inside the
    // transaction or add explicit rollback of in-memory state.

    const createContext = (input: Parameters<GraphEngine.Interface["createContext"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const ctx = yield* state.graph.createContext(input)
          const event = yield* state.eventLog.append({ eventType: "context_created", affectedNodeIds: [], affectedEdgeKeys: [] })
          yield* state.workingSet.activateContext(ctx.id)
          yield* persistMutation(event)
          return ctx
        }),
      )

    const createNode = (input: Parameters<GraphEngine.Interface["createNode"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const node = yield* state.graph.createNode(input)
          const event = yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [node.id] })
          yield* state.workingSet.activateNode(node.id)
          yield* persistMutation(event)
          return node
        }),
      )

    const createEdge = (input: Parameters<GraphEngine.Interface["createEdge"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const edge = yield* state.graph.createEdge(input)
          const event = yield* state.eventLog.append({
            eventType: "edge_created",
            affectedNodeIds: [edge.leftNodeId, edge.rightNodeId],
            affectedEdgeKeys: [DesignTypes.edgeKey(edge.leftNodeId, edge.rightNodeId)],
          })
          yield* Effect.all([state.workingSet.activateNode(edge.leftNodeId), state.workingSet.activateNode(edge.rightNodeId)])
          yield* persistMutation(event)
          return edge
        }),
      )

    const resolveReference = (input: Parameters<WorkingSet.Interface["resolveReference"]>[0]) =>
      use((state) =>
        Effect.gen(function* () {
          const result = yield* state.workingSet.resolveReference(input)
          if (result.action === "created") {
            const event = yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [result.nodeId] })
            yield* persistMutation(event)
          }
          return result
        }),
      )

    const getState = () =>
      use((state) =>
        Effect.gen(function* () {
          const [nodes, edges, prototypes, contexts] = yield* Effect.all([
            state.graph.listNodes(),
            state.graph.listEdges(),
            state.graph.listPrototypes(),
            state.graph.listContexts(),
          ])
          const ws = yield* state.workingSet.state()
          const events = yield* state.eventLog.list()
          return {
            nodes,
            edges,
            prototypes,
            contexts,
            workingSet: ws,
            eventLog: { events },
          }
        }),
      )

    const init = () =>
      Effect.gen(function* () {
        yield* InstanceState.get(designState)
        yield* Effect.logInfo("design state initialized")
      })

    return Service.of({
      createContext,
      createNode,
      createEdge,
      resolveReference,
      listNodes: () => use((state) => state.graph.listNodes()),
      listEdges: () => use((state) => state.graph.listEdges()),
      listWorkingSet: () => use((state) => state.workingSet.list()),
      getState,
      init,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(DesignStore.defaultLayer))

export const stateRef = designState

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [DesignStore.node],
})

export * as Design from "./design"
```

Note: `GraphEngine.makeEngine`, `WorkingSet.makeWorkingSet`, and `EventLog.makeEventLog` are the factories created in Tasks 1-3. `graph.getState` must be added to `GraphEngine.Interface` (it returns the raw graph subset of `GraphState`); if it does not exist, add it as a helper that returns `{ nodes, edges, prototypes, contexts }`.

- [ ] **Step 2: Write integration test for `Design.Service` persistence**

Create `packages/opencode/test/design/design.test.ts`:

```typescript
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { InstanceState } from "../../../src/effect/instance-state"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"

const it = testEffect(Design.defaultLayer)

describe("Design.Service", () => {
  it.instance("persists nodes and edges across reload", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.init()

      const ctx = yield* design.createContext({ name: "战斗系统" })
      const ship = yield* design.createNode({ name: "船", contextId: ctx.id })
      const hp = yield* design.createNode({ name: "生命值", contextId: ctx.id })
      yield* design.createEdge({ leftNodeId: ship.id, rightNodeId: hp.id, prototypeId: "aggregate", parameters: {} })

      const before = yield* design.listNodes()
      expect(before.length).toBe(2)

      // Simulate reload: invalidate instance state, then re-init
      yield* InstanceState.invalidate(Design.stateRef)
      const reloaded = yield* Design.Service
      yield* reloaded.init()

      const after = yield* reloaded.listNodes()
      expect(after.length).toBe(2)
      const edges = yield* reloaded.listEdges()
      expect(edges.length).toBe(1)
    }),
  )
})
```

Note: `Design.stateRef` is exported so tests can invalidate per-instance state. Do not use it from production code.

- [ ] **Step 3: Run the test**

```bash
cd packages/opencode
bun test test/design/design.test.ts
```

Expected: persistence test passes.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/design/design.ts packages/opencode/test/design/design.test.ts
git commit -m "feat(design): make Design.Service per-instance and SQLite-backed"
```

---
