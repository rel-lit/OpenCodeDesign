# OpenCode Design 第一阶段实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenCode 中新增原生 Design Agent，实现 Core 层图引擎与 7 个基础图操作工具，使用户可通过对话创建节点和边。

**Architecture:** 基于 OpenCode Fork，在 `packages/opencode/src/design/` 下构建独立的图引擎 Core（节点/边/上下文/工作集/事件日志），通过 `Tool.define` 注册 7 个 `design_*` 工具，在 `agent.ts` 中注册 Design Agent。Core 逻辑不依赖具体关系原型语义，Extension 层仅预留接口。

**Tech Stack:** TypeScript 5.8, Effect, Bun, OpenCode 内部 Tool/Agent/Permission 机制。

## Global Constraints

- 使用 `Effect.gen(function* () { ... })` 组合 Effect。
- 使用 `Effect.fn("Domain.method")` 命名带追踪的 Effect。
- 模块底部使用 self-reexport：`export * as Design from "./design"`。
- 不使用 star imports，不使用别名导入。
- 文件 I/O 优先使用 `Bun.file()` / `Bun.write()`。
- 测试在 `packages/opencode` 目录下运行：`bun test` 或 `bun typecheck`。
- 不修改 OpenCode 核心 Effect 调度、Build/Plan Agent 逻辑。
- Design Agent 禁止 `read`/`grep`/`glob`/`bash`/`edit`/`write`/`apply_patch`。

---

## File Structure

```
packages/opencode/src/design/
├── core/
│   ├── types.ts          # Node, Edge, RelationPrototype, BoundedContext, WorkingSet, EventLog Schema
│   ├── graph.ts          # GraphEngine：节点/边/上下文/原型的增删改查
│   ├── working-set.ts    # WorkingSet 管理（LRU、多上下文）
│   ├── event-log.ts      # EventLog（事件节点、回滚）
│   └── persistence.ts    # graph.json / events.jsonl 读写
├── design.ts             # Design Service：组合 Core + 持久化
└── index.ts              # barrel，导出 Design 命名空间

packages/opencode/src/tool/design.ts           # 7 个 design_* 工具
packages/opencode/src/tool/registry.ts         # 注册 Design 工具
packages/opencode/src/session/prompt/design.txt # Design Agent 系统提示词
packages/opencode/src/agent/agent.ts           # 注册 Design Agent

packages/opencode/test/design/core/graph.test.ts
packages/opencode/test/tool/design.test.ts
```

---

## Task 1: Design Core Types

**Files:**
- Create: `packages/opencode/src/design/core/types.ts`
- Test: `packages/opencode/test/design/core/types.test.ts`（可选，类型测试可合并到 graph.test.ts）

**Interfaces:**
- Produces: `Node`, `Edge`, `RelationPrototype`, `BoundedContext`, `WorkingSet`, `EventLog`, `EventNode` 类型与 Schema。

- [x] **Step 1: Write types.ts**

```typescript
import { Schema } from "effect"

export const Node = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  aliases: Schema.Array(Schema.String),
  contextId: Schema.String,
  defaultSemantics: Schema.String,
  connectedEdges: Schema.Array(Schema.Struct({
    leftNodeId: Schema.String,
    rightNodeId: Schema.String,
    prototypeId: Schema.String,
  })),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  retired: Schema.Boolean,
})
export type Node = Schema.Schema.Type<typeof Node>

export const EdgeParameters = Schema.Record(Schema.String, Schema.Unknown)
export type EdgeParameters = Schema.Schema.Type<typeof EdgeParameters>

export const Edge = Schema.Struct({
  leftNodeId: Schema.String,
  rightNodeId: Schema.String,
  prototypeId: Schema.String,
  parameters: EdgeParameters,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type Edge = Schema.Schema.Type<typeof Edge>

export const RelationPrototype = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  defaultSemantics: Schema.String,
  parameterSchema: Schema.Record(Schema.String, Schema.Unknown),
})
export type RelationPrototype = Schema.Schema.Type<typeof RelationPrototype>

export const BoundedContext = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  semantics: Schema.String,
  nodeIds: Schema.Array(Schema.String),
})
export type BoundedContext = Schema.Schema.Type<typeof BoundedContext>

export const WorkingSet = Schema.Struct({
  activeContextIds: Schema.Array(Schema.String),
  activeNodeIds: Schema.Array(Schema.String),
  capacity: Schema.Number,
})
export type WorkingSet = Schema.Schema.Type<typeof WorkingSet>

export const EventType = Schema.Literals(
  "node_created",
  "node_updated",
  "node_retired",
  "node_deleted",
  "edge_created",
  "edge_updated",
  "edge_deleted",
  "prototype_created",
  "prototype_updated",
  "context_created",
  "context_updated",
  "working_set_changed",
  "event_rollback",
)
export type EventType = Schema.Schema.Type<typeof EventType>

export const EventNode = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  contextId: Schema.Literal("event-log"),
  aliases: Schema.Array(Schema.String),
  defaultSemantics: Schema.String,
  connectedEdges: Schema.Array(Schema.Struct({
    leftNodeId: Schema.String,
    rightNodeId: Schema.String,
    prototypeId: Schema.String,
  })),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  retired: Schema.Boolean,
  eventType: EventType,
  timestamp: Schema.Number,
  affectedNodeIds: Schema.Array(Schema.String),
  affectedEdgeKeys: Schema.Array(Schema.String),
  rollbackTarget: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
})
export type EventNode = Schema.Schema.Type<typeof EventNode>

export const EventLog = Schema.Struct({
  events: Schema.Array(EventNode),
})
export type EventLog = Schema.Schema.Type<typeof EventLog>

export const GraphState = Schema.Struct({
  nodes: Schema.Array(Node),
  edges: Schema.Array(Edge),
  prototypes: Schema.Array(RelationPrototype),
  contexts: Schema.Array(BoundedContext),
  workingSet: WorkingSet,
  eventLog: EventLog,
})
export type GraphState = Schema.Schema.Type<typeof GraphState>

export const edgeKey = (leftNodeId: string, rightNodeId: string): string =>
  leftNodeId < rightNodeId ? `${leftNodeId}::${rightNodeId}` : `${rightNodeId}::${leftNodeId}`

export * as DesignTypes from "./types"
```

- [x] **Step 2: Run typecheck**

```bash
cd packages/opencode
bun typecheck
```

Expected: PASS

- [x] **Step 3: Commit**

```bash
git add packages/opencode/src/design/core/types.ts
git commit -m "feat(design): add core type schemas"
```

---

## Task 2: GraphEngine

**Files:**
- Create: `packages/opencode/src/design/core/graph.ts`
- Test: `packages/opencode/test/design/core/graph.test.ts`

**Interfaces:**
- Consumes: `DesignTypes.Node`, `DesignTypes.Edge`, etc.
- Produces: `GraphEngine` service with `createNode`, `updateNode`, `createContext`, `createEdge`, `getEdge`, `listNodes`, `listEdges` 等方法。

- [x] **Step 1: Write failing test**

```typescript
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../../lib/effect"
import { GraphEngine } from "../../../src/design/core/graph"

const it = testEffect(GraphEngine.defaultLayer)

describe("GraphEngine", () => {
  it.effect("creates a node", () =>
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      const node = yield* graph.createNode({
        name: "船",
        contextId: "ctx-battle",
        defaultSemantics: "水上交通工具",
      })
      expect(node.name).toBe("船")
      expect(node.contextId).toBe("ctx-battle")
      expect(node.retired).toBe(false)
    }),
  )

  it.effect("enforces one edge per node pair", () =>
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      const ship = yield* graph.createNode({ name: "船", contextId: "ctx-battle", defaultSemantics: "" })
      const hp = yield* graph.createNode({ name: "生命值", contextId: "ctx-battle", defaultSemantics: "" })
      yield* graph.createEdge({ leftNodeId: ship.id, rightNodeId: hp.id, prototypeId: "aggregate", parameters: {} })
      const second = yield* graph.createEdge({
        leftNodeId: ship.id,
        rightNodeId: hp.id,
        prototypeId: "associate",
        parameters: {},
      })
      const all = yield* graph.listEdges()
      expect(all.length).toBe(1)
      expect(second.prototypeId).toBe("associate")
    }),
  )
})
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd packages/opencode
bun test test/design/core/graph.test.ts
```

Expected: FAIL (module not found)

- [x] **Step 3: Implement graph.ts**

```typescript
import { Context, Effect, Schema } from "effect"
import { DesignTypes } from "./types"

export interface Interface {
  readonly createNode: (input: {
    name: string
    contextId: string
    defaultSemantics?: string
    aliases?: string[]
  }) => Effect.Effect<DesignTypes.Node>
  readonly updateNode: (id: string, input: Partial<Omit<DesignTypes.Node, "id" | "createdAt">>) => Effect.Effect<DesignTypes.Node>
  readonly retireNode: (id: string, retired: boolean) => Effect.Effect<DesignTypes.Node>
  readonly deleteNode: (id: string) => Effect.Effect<void>
  readonly getNode: (id: string) => Effect.Effect<DesignTypes.Node | undefined>
  readonly listNodes: () => Effect.Effect<DesignTypes.Node[]>
  readonly findNodesByName: (name: string, contextId?: string) => Effect.Effect<DesignTypes.Node[]>

  readonly createContext: (input: {
    id?: string
    name: string
    semantics?: string
  }) => Effect.Effect<DesignTypes.BoundedContext>
  readonly getContext: (id: string) => Effect.Effect<DesignTypes.BoundedContext | undefined>
  readonly listContexts: () => Effect.Effect<DesignTypes.BoundedContext[]>

  readonly createPrototype: (input: {
    id?: string
    name: string
    defaultSemantics?: string
    parameterSchema?: Record<string, unknown>
  }) => Effect.Effect<DesignTypes.RelationPrototype>
  readonly getPrototype: (id: string) => Effect.Effect<DesignTypes.RelationPrototype | undefined>
  readonly listPrototypes: () => Effect.Effect<DesignTypes.RelationPrototype[]>

  readonly createEdge: (input: Omit<DesignTypes.Edge, "createdAt" | "updatedAt">) => Effect.Effect<DesignTypes.Edge>
  readonly updateEdge: (leftNodeId: string, rightNodeId: string, input: Partial<Pick<DesignTypes.Edge, "prototypeId" | "parameters">>) => Effect.Effect<DesignTypes.Edge>
  readonly deleteEdge: (leftNodeId: string, rightNodeId: string) => Effect.Effect<void>
  readonly getEdge: (leftNodeId: string, rightNodeId: string) => Effect.Effect<DesignTypes.Edge | undefined>
  readonly listEdges: () => Effect.Effect<DesignTypes.Edge[]>
  readonly listEdgesForNode: (nodeId: string) => Effect.Effect<DesignTypes.Edge[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignGraphEngine") {}

const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let state: DesignTypes.GraphState = {
      nodes: [],
      edges: [],
      prototypes: [],
      contexts: [],
      workingSet: { activeContextIds: [], activeNodeIds: [], capacity: 20 },
      eventLog: { events: [] },
    }

    const now = () => Date.now()

    const createNode = Effect.fn("GraphEngine.createNode")(function* (input) {
      const node: DesignTypes.Node = {
        id: makeId("node"),
        name: input.name,
        aliases: input.aliases ?? [],
        contextId: input.contextId,
        defaultSemantics: input.defaultSemantics ?? "",
        connectedEdges: [],
        createdAt: now(),
        updatedAt: now(),
        retired: false,
      }
      state.nodes.push(node)
      const ctx = state.contexts.find((c) => c.id === input.contextId)
      if (ctx) ctx.nodeIds.push(node.id)
      return node
    })

    const getNode = Effect.fnUntraced(function* (id: string) {
      return state.nodes.find((n) => n.id === id)
    })

    const listNodes = Effect.fnUntraced(function* () {
      return [...state.nodes]
    })

    const findNodesByName = Effect.fn("GraphEngine.findNodesByName")(function* (name, contextId) {
      return state.nodes.filter((n) => {
        const matchName = n.name === name || n.aliases.includes(name)
        if (!matchName) return false
        if (contextId && n.contextId !== contextId) return false
        return true
      })
    })

    const createContext = Effect.fn("GraphEngine.createContext")(function* (input) {
      const ctx: DesignTypes.BoundedContext = {
        id: input.id ?? makeId("ctx"),
        name: input.name,
        semantics: input.semantics ?? "",
        nodeIds: [],
      }
      state.contexts.push(ctx)
      return ctx
    })

    const getContext = Effect.fnUntraced(function* (id: string) {
      return state.contexts.find((c) => c.id === id)
    })

    const listContexts = Effect.fnUntraced(function* () {
      return [...state.contexts]
    })

    const createPrototype = Effect.fn("GraphEngine.createPrototype")(function* (input) {
      const proto: DesignTypes.RelationPrototype = {
        id: input.id ?? makeId("proto"),
        name: input.name,
        defaultSemantics: input.defaultSemantics ?? "",
        parameterSchema: input.parameterSchema ?? {},
      }
      state.prototypes.push(proto)
      return proto
    })

    const getPrototype = Effect.fnUntraced(function* (id: string) {
      return state.prototypes.find((p) => p.id === id)
    })

    const listPrototypes = Effect.fnUntraced(function* () {
      return [...state.prototypes]
    })

    const getEdge = Effect.fnUntraced(function* (leftNodeId: string, rightNodeId: string) {
      const key = DesignTypes.edgeKey(leftNodeId, rightNodeId)
      return state.edges.find((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) === key)
    })

    const listEdges = Effect.fnUntraced(function* () {
      return [...state.edges]
    })

    const listEdgesForNode = Effect.fn("GraphEngine.listEdgesForNode")(function* (nodeId) {
      return state.edges.filter((e) => e.leftNodeId === nodeId || e.rightNodeId === nodeId)
    })

    const createEdge = Effect.fn("GraphEngine.createEdge")(function* (input) {
      const key = DesignTypes.edgeKey(input.leftNodeId, input.rightNodeId)
      const existingIndex = state.edges.findIndex((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) === key)
      const edge: DesignTypes.Edge = {
        leftNodeId: input.leftNodeId,
        rightNodeId: input.rightNodeId,
        prototypeId: input.prototypeId,
        parameters: input.parameters ?? {},
        createdAt: now(),
        updatedAt: now(),
      }

      if (existingIndex >= 0) {
        state.edges[existingIndex] = edge
      } else {
        state.edges.push(edge)
        const left = state.nodes.find((n) => n.id === input.leftNodeId)
        const right = state.nodes.find((n) => n.id === input.rightNodeId)
        if (left) left.connectedEdges.push({ leftNodeId: input.leftNodeId, rightNodeId: input.rightNodeId, prototypeId: input.prototypeId })
        if (right) right.connectedEdges.push({ leftNodeId: input.leftNodeId, rightNodeId: input.rightNodeId, prototypeId: input.prototypeId })
      }

      return edge
    })

    const updateEdge = Effect.fn("GraphEngine.updateEdge")(function* (leftNodeId, rightNodeId, input) {
      const edge = yield* getEdge(leftNodeId, rightNodeId)
      if (!edge) return yield* Effect.fail(new Error(`Edge not found: ${leftNodeId} <-> ${rightNodeId}`))
      if (input.prototypeId !== undefined) edge.prototypeId = input.prototypeId
      if (input.parameters !== undefined) edge.parameters = input.parameters
      edge.updatedAt = now()
      return edge
    })

    const deleteEdge = Effect.fn("GraphEngine.deleteEdge")(function* (leftNodeId, rightNodeId) {
      const key = DesignTypes.edgeKey(leftNodeId, rightNodeId)
      state.edges = state.edges.filter((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) !== key)
      for (const node of state.nodes) {
        node.connectedEdges = node.connectedEdges.filter((e) => DesignTypes.edgeKey(e.leftNodeId, e.rightNodeId) !== key)
      }
    })

    return Service.of({
      createNode,
      updateNode: Effect.fn("GraphEngine.updateNode")(function* (id, input) {
        const node = state.nodes.find((n) => n.id === id)
        if (!node) return yield* Effect.fail(new Error(`Node not found: ${id}`))
        Object.assign(node, input, { updatedAt: now() })
        return node
      }),
      retireNode: Effect.fn("GraphEngine.retireNode")(function* (id, retired) {
        const node = state.nodes.find((n) => n.id === id)
        if (!node) return yield* Effect.fail(new Error(`Node not found: ${id}`))
        node.retired = retired
        node.updatedAt = now()
        return node
      }),
      deleteNode: Effect.fn("GraphEngine.deleteNode")(function* (id) {
        state.nodes = state.nodes.filter((n) => n.id !== id)
        state.edges = state.edges.filter((e) => e.leftNodeId !== id && e.rightNodeId !== id)
        for (const ctx of state.contexts) {
          ctx.nodeIds = ctx.nodeIds.filter((nid) => nid !== id)
        }
      }),
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
    })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [],
})

export * as GraphEngine from "./graph"
```

- [x] **Step 4: Run tests**

```bash
cd packages/opencode
bun test test/design/core/graph.test.ts
```

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/opencode/src/design/core/graph.ts packages/opencode/test/design/core/graph.test.ts
git commit -m "feat(design): add graph engine with node and edge management"
```

---

## Task 3: WorkingSet

**Files:**
- Create: `packages/opencode/src/design/core/working-set.ts`
- Test: `packages/opencode/test/design/core/working-set.test.ts`

**Interfaces:**
- Consumes: `DesignTypes.WorkingSet`, `DesignTypes.Node`, `GraphEngine`.
- Produces: `WorkingSetManager` service with `activateNode`, `forgetNode`, `activateContext`, `forgetContext`, `resolveReference`, `list` 等方法。

- [x] **Step 1: Write working-set.ts**

```typescript
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { DesignTypes } from "./types"
import { GraphEngine } from "./graph"

export interface Interface {
  readonly activateNode: (nodeId: string) => Effect.Effect<void>
  readonly forgetNode: (nodeId: string) => Effect.Effect<void>
  readonly activateContext: (contextId: string) => Effect.Effect<void>
  readonly forgetContext: (contextId: string) => Effect.Effect<void>
  readonly resolveReference: (input: {
    reference: string
    contextId?: string
  }) => Effect.Effect<{ nodeId: string; action: "matched" | "created"; fullName: string }>
  readonly list: () => Effect.Effect<{ nodeIds: string[]; contextIds: string[] }>
  readonly state: () => Effect.Effect<DesignTypes.WorkingSet>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignWorkingSet") {}

export const make = (capacity = 20) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const graph = yield* GraphEngine.Service
      let workingSet: DesignTypes.WorkingSet = {
        activeContextIds: [],
        activeNodeIds: [],
        capacity,
      }

      const state = Effect.fnUntraced(function* () {
        return workingSet
      })

      const list = Effect.fnUntraced(function* () {
        return {
          nodeIds: [...workingSet.activeNodeIds],
          contextIds: [...workingSet.activeContextIds],
        }
      })

      const activateContext = Effect.fn("WorkingSet.activateContext")(function* (contextId) {
        if (!workingSet.activeContextIds.includes(contextId)) {
          workingSet.activeContextIds.unshift(contextId)
        }
      })

      const forgetContext = Effect.fn("WorkingSet.forgetContext")(function* (contextId) {
        workingSet.activeContextIds = workingSet.activeContextIds.filter((id) => id !== contextId)
      })

      const activateNode = Effect.fn("WorkingSet.activateNode")(function* (nodeId) {
        workingSet.activeNodeIds = workingSet.activeNodeIds.filter((id) => id !== nodeId)
        workingSet.activeNodeIds.unshift(nodeId)
        if (workingSet.activeNodeIds.length > workingSet.capacity) {
          workingSet.activeNodeIds = workingSet.activeNodeIds.slice(0, workingSet.capacity)
        }
        const node = yield* graph.getNode(nodeId)
        if (node) yield* activateContext(node.contextId)
      })

      const forgetNode = Effect.fn("WorkingSet.forgetNode")(function* (nodeId) {
        workingSet.activeNodeIds = workingSet.activeNodeIds.filter((id) => id !== nodeId)
      })

      const fullName = (node: DesignTypes.Node, context: DesignTypes.BoundedContext): string => {
        const parts: string[] = []
        parts.push(context.name)
        parts.push(node.name)
        return parts.join("+")
      }

      const resolveReference = Effect.fn("WorkingSet.resolveReference")(function* (input) {
        const contexts = yield* graph.listContexts()
        const nodes = yield* graph.listNodes()

        const candidates = nodes.filter((n) => {
          const nameMatch = n.name === input.reference || n.aliases.includes(input.reference)
          if (!nameMatch) return false
          if (input.contextId && n.contextId !== input.contextId) return false
          return true
        })

        if (candidates.length === 1) {
          const node = candidates[0]
          yield* activateNode(node.id)
          const ctx = contexts.find((c) => c.id === node.contextId)
          return {
            nodeId: node.id,
            action: "matched" as const,
            fullName: ctx ? fullName(node, ctx) : node.name,
          }
        }

        if (candidates.length > 1) {
          return yield* Effect.fail(
            new Error(
              `Ambiguous reference "${input.reference}". Candidates: ${candidates
                .map((n) => {
                  const ctx = contexts.find((c) => c.id === n.contextId)
                  return ctx ? fullName(n, ctx) : n.name
                })
                .join(", ")}`,
            ),
          )
        }

        // No match: auto-create in default or hinted context
        let contextId = input.contextId
        if (!contextId) {
          const active = workingSet.activeContextIds[0]
          if (active) {
            contextId = active
          } else {
            const defaultCtx = yield* graph.createContext({ name: "默认上下文", semantics: "自动创建的默认上下文" })
            contextId = defaultCtx.id
            yield* activateContext(contextId)
          }
        }

        const node = yield* graph.createNode({
          name: input.reference,
          contextId,
          defaultSemantics: "",
        })
        yield* activateNode(node.id)
        const ctx = contexts.find((c) => c.id === node.contextId) ?? (yield* graph.getContext(contextId))
        return {
          nodeId: node.id,
          action: "created" as const,
          fullName: ctx ? fullName(node, ctx) : node.name,
        }
      })

      return Service.of({
        activateNode,
        forgetNode,
        activateContext,
        forgetContext,
        resolveReference,
        list,
        state,
      })
    }),
  )

export const layer = make()
export const defaultLayer = layer.pipe(Layer.provide(GraphEngine.defaultLayer))

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [GraphEngine.node],
})

export * as WorkingSet from "./working-set"
```

- [x] **Step 2: Write test**

```typescript
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../../lib/effect"
import { WorkingSet } from "../../../src/design/core/working-set"
import { GraphEngine } from "../../../src/design/core/graph"

const it = testEffect(WorkingSet.defaultLayer)

describe("WorkingSet", () => {
  it.effect("auto-creates node when reference not found", () =>
    Effect.gen(function* () {
      const ws = yield* WorkingSet.Service
      const graph = yield* GraphEngine.Service
      const result = yield* ws.resolveReference({ reference: "船" })
      expect(result.action).toBe("created")
      const node = yield* graph.getNode(result.nodeId)
      expect(node?.name).toBe("船")
    }),
  )

  it.effect("respects capacity and drops oldest", () =>
    Effect.gen(function* () {
      const ws = yield* WorkingSet.Service
      const graph = yield* GraphEngine.Service
      for (let i = 0; i < 25; i++) {
        const result = yield* ws.resolveReference({ reference: `node-${i}` })
        yield* ws.activateNode(result.nodeId)
      }
      const state = yield* ws.state()
      expect(state.activeNodeIds.length).toBe(20)
    }),
  )
})
```

- [x] **Step 3: Run tests**

```bash
cd packages/opencode
bun test test/design/core/working-set.test.ts
```

Expected: PASS

- [x] **Step 4: Commit**

```bash
git add packages/opencode/src/design/core/working-set.ts packages/opencode/test/design/core/working-set.test.ts
git commit -m "feat(design): add working set manager with LRU and reference resolution"
```

---

## Task 4: EventLog

**Files:**
- Create: `packages/opencode/src/design/core/event-log.ts`
- Test: `packages/opencode/test/design/core/event-log.test.ts`

**Interfaces:**
- Consumes: `DesignTypes.EventNode`, `DesignTypes.EventType`.
- Produces: `EventLog` service with `append`, `rollbackTo`, `list` 方法。

- [x] **Step 1: Implement event-log.ts**

```typescript
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { DesignTypes } from "./types"

export interface Interface {
  readonly append: (input: {
    eventType: DesignTypes.EventType
    affectedNodeIds?: string[]
    affectedEdgeKeys?: string[]
    reason?: string
    rollbackTarget?: string
  }) => Effect.Effect<DesignTypes.EventNode>
  readonly rollbackTo: (eventId: string) => Effect.Effect<DesignTypes.EventNode>
  readonly list: () => Effect.Effect<DesignTypes.EventNode[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignEventLog") {}

const makeId = () => `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let events: DesignTypes.EventNode[] = []

    const append = Effect.fn("EventLog.append")(function* (input) {
      const event: DesignTypes.EventNode = {
        id: makeId(),
        name: input.eventType,
        contextId: "event-log",
        aliases: [],
        defaultSemantics: "",
        connectedEdges: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        retired: false,
        eventType: input.eventType,
        timestamp: Date.now(),
        affectedNodeIds: input.affectedNodeIds ?? [],
        affectedEdgeKeys: input.affectedEdgeKeys ?? [],
        reason: input.reason,
        rollbackTarget: input.rollbackTarget,
      }
      events.push(event)
      return event
    })

    const rollbackTo = Effect.fn("EventLog.rollbackTo")(function* (eventId) {
      const index = events.findIndex((e) => e.id === eventId)
      if (index < 0) return yield* Effect.fail(new Error(`Event not found: ${eventId}`))
      events = events.slice(0, index + 1)
      return yield* append({
        eventType: "event_rollback",
        rollbackTarget: eventId,
        reason: `Rolled back to event ${eventId}`,
      })
    })

    const list = Effect.fnUntraced(function* () {
      return [...events]
    })

    return Service.of({ append, rollbackTo, list })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [],
})

export * as EventLog from "./event-log"
```

- [x] **Step 2: Write test**

```typescript
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
})
```

- [x] **Step 3: Run tests**

```bash
cd packages/opencode
bun test test/design/core/event-log.test.ts
```

Expected: PASS

- [x] **Step 4: Commit**

```bash
git add packages/opencode/src/design/core/event-log.ts packages/opencode/test/design/core/event-log.test.ts
git commit -m "feat(design): add immutable event log with rollback"
```

---

## Task 5: Persistence

**Files:**
- Create: `packages/opencode/src/design/core/persistence.ts`
- Test: `packages/opencode/test/design/core/persistence.test.ts`

**Interfaces:**
- Consumes: `DesignTypes.GraphState`.
- Produces: `Persistence` service with `save`, `load`, `appendEvent` 方法。

- [x] **Step 1: Implement persistence.ts**

```typescript
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { DesignTypes } from "./types"
import { InstanceState } from "@/effect/instance-state"

export interface Interface {
  readonly save: (state: DesignTypes.GraphState) => Effect.Effect<void>
  readonly load: () => Effect.Effect<DesignTypes.GraphState | undefined>
  readonly appendEvent: (event: DesignTypes.EventNode) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignPersistence") {}

const GRAPH_FILE = "graph.json"
const EVENTS_FILE = "events.jsonl"
const DESIGN_DIR = ".opencode/design"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    const designDir = path.join(instance.worktree, DESIGN_DIR)
    const graphPath = path.join(designDir, GRAPH_FILE)
    const eventsPath = path.join(designDir, EVENTS_FILE)

    const ensureDir = Effect.fn("Persistence.ensureDir")(function* () {
      const dir = Bun.file(designDir)
      const exists = yield* Effect.promise(() => dir.exists())
      if (!exists) {
        yield* Effect.promise(() => Bun.write(path.join(designDir, ".keep"), ""))
      }
    })

    const save = Effect.fn("Persistence.save")(function* (state) {
      yield* ensureDir
      const data = JSON.stringify(state, null, 2)
      yield* Effect.promise(() => Bun.write(graphPath, data))
    })

    const load = Effect.fn("Persistence.load")(function* () {
      const file = Bun.file(graphPath)
      const exists = yield* Effect.promise(() => file.exists())
      if (!exists) return undefined
      const text = yield* Effect.promise(() => file.text())
      return JSON.parse(text) as DesignTypes.GraphState
    })

    const appendEvent = Effect.fn("Persistence.appendEvent")(function* (event) {
      yield* ensureDir
      const line = JSON.stringify(event) + "\n"
      const file = Bun.file(eventsPath)
      const existing = (yield* Effect.promise(() => file.exists())) ? yield* Effect.promise(() => file.text()) : ""
      yield* Effect.promise(() => Bun.write(eventsPath, existing + line))
    })

    return Service.of({ save, load, appendEvent })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [],
})

export * as Persistence from "./persistence"
```

- [x] **Step 2: Write persistence test**

```typescript
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../../lib/effect"
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
})
```

- [x] **Step 3: Commit

```bash
git add packages/opencode/src/design/core/persistence.ts packages/opencode/test/design/core/persistence.test.ts
git commit -m "feat(design): add json/jsonl persistence layer"
```

---

## Task 6: Design Service

**Files:**
- Create: `packages/opencode/src/design/design.ts`
- Create: `packages/opencode/src/design/index.ts`

**Interfaces:**
- Consumes: `GraphEngine`, `WorkingSet`, `EventLog`, `Persistence`.
- Produces: `Design` service exposing high-level operations used by tools.

- [x] **Step 1: Implement design.ts**

```typescript
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { GraphEngine } from "./core/graph"
import { WorkingSet } from "./core/working-set"
import { EventLog } from "./core/event-log"
import { Persistence } from "./core/persistence"
import { DesignTypes } from "./core/types"

export interface Interface {
  readonly createContext: GraphEngine.Interface["createContext"]
  readonly createNode: GraphEngine.Interface["createNode"]
  readonly createEdge: GraphEngine.Interface["createEdge"]
  readonly resolveReference: WorkingSet.Interface["resolveReference"]
  readonly listNodes: GraphEngine.Interface["listNodes"]
  readonly listEdges: GraphEngine.Interface["listEdges"]
  readonly listWorkingSet: WorkingSet.Interface["list"]
  readonly getState: () => Effect.Effect<DesignTypes.GraphState>
  readonly save: () => Effect.Effect<void>
  readonly load: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Design") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const graph = yield* GraphEngine.Service
    const workingSet = yield* WorkingSet.Service
    const eventLog = yield* EventLog.Service
    const persistence = yield* Persistence.Service

    const getState = Effect.fn("Design.getState")(function* () {
      const [nodes, edges, prototypes, contexts] = yield* Effect.all([
        graph.listNodes(),
        graph.listEdges(),
        graph.listPrototypes(),
        graph.listContexts(),
      ])
      const ws = yield* workingSet.state()
      const events = yield* eventLog.list()
      return {
        nodes,
        edges,
        prototypes,
        contexts,
        workingSet: ws,
        eventLog: { events },
      }
    })

    const save = Effect.fn("Design.save")(function* () {
      const state = yield* getState()
      yield* persistence.save(state)
    })

    const load = Effect.fn("Design.load")(function* () {
      const loaded = yield* persistence.load()
      if (!loaded) return
      // In first milestone, loaded state is not restored into in-memory engine.
      // Restoration will be implemented in P2.
      yield* Effect.log("Loaded design state (restoration deferred to P2)")
    })

    return Service.of({
      createContext: (input) =>
        Effect.gen(function* () {
          const ctx = yield* graph.createContext(input)
          yield* eventLog.append({ eventType: "context_created", affectedNodeIds: [], affectedEdgeKeys: [] })
          yield* workingSet.activateContext(ctx.id)
          return ctx
        }),
      createNode: (input) =>
        Effect.gen(function* () {
          const node = yield* graph.createNode(input)
          yield* eventLog.append({ eventType: "node_created", affectedNodeIds: [node.id] })
          yield* workingSet.activateNode(node.id)
          return node
        }),
      createEdge: (input) =>
        Effect.gen(function* () {
          const edge = yield* graph.createEdge(input)
          yield* eventLog.append({
            eventType: "edge_created",
            affectedNodeIds: [edge.leftNodeId, edge.rightNodeId],
            affectedEdgeKeys: [DesignTypes.edgeKey(edge.leftNodeId, edge.rightNodeId)],
          })
          yield* Effect.all([workingSet.activateNode(edge.leftNodeId), workingSet.activateNode(edge.rightNodeId)])
          return edge
        }),
      resolveReference: workingSet.resolveReference,
      listNodes: graph.listNodes,
      listEdges: graph.listEdges,
      listWorkingSet: workingSet.list,
      getState,
      save,
      load,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(WorkingSet.defaultLayer),
  Layer.provide(GraphEngine.defaultLayer),
  Layer.provide(EventLog.defaultLayer),
  Layer.provide(Persistence.defaultLayer),
)

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [GraphEngine.node, WorkingSet.node, EventLog.node, Persistence.node],
})

export * as Design from "./design"
```

- [x] **Step 2: Implement index.ts**

```typescript
export * as Design from "./design"
export * as GraphEngine from "./core/graph"
export * as WorkingSet from "./core/working-set"
export * as EventLog from "./core/event-log"
export * as Persistence from "./core/persistence"
export * as DesignTypes from "./core/types"
```

- [x] **Step 3: Commit**

```bash
git add packages/opencode/src/design/design.ts packages/opencode/src/design/index.ts
git commit -m "feat(design): add design service composing core engine"
```

---

## Task 7: Design Tools (Part 1)

**Files:**
- Create: `packages/opencode/src/tool/design.ts`
- Modify: `packages/opencode/src/tool/registry.ts`

**Interfaces:**
- Consumes: `Design.Service`.
- Produces: `DesignResolveReferenceTool`, `DesignCreateContextTool`, `DesignCreateNodeTool` Tool.Info objects.

- [x] **Step 1: Create design.ts with first three tools**

```typescript
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Design } from "@/design/design"

export const DesignResolveReferenceTool = Tool.define(
  "design_resolve_reference",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Resolve a concept reference. If the concept does not exist, create it automatically.",
      parameters: Schema.Struct({
        reference: Schema.String.annotate({ description: "The concept name or alias to resolve" }),
        contextId: Schema.optional(Schema.String).annotate({
          description: "Optional context ID to disambiguate the reference",
        }),
      }),
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const result = yield* design.resolveReference(args)
          return {
            title: `Resolved ${args.reference}`,
            output: `${result.action === "created" ? "Created" : "Matched"} node ${result.fullName} (${result.nodeId})`,
            metadata: { action: result.action, nodeId: result.nodeId, fullName: result.fullName },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const DesignCreateContextTool = Tool.define(
  "design_create_context",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Create a new bounded context for grouping semantically related nodes.",
      parameters: Schema.Struct({
        name: Schema.String.annotate({ description: "The context name" }),
        semantics: Schema.optional(Schema.String).annotate({ description: "Description of the context's semantics" }),
      }),
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const context = yield* design.createContext({
            name: args.name,
            semantics: args.semantics,
          })
          return {
            title: `Created context ${context.name}`,
            output: `Context ${context.name} (${context.id})`,
            metadata: { contextId: context.id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const DesignCreateNodeTool = Tool.define(
  "design_create_node",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Create a new node explicitly.",
      parameters: Schema.Struct({
        name: Schema.String.annotate({ description: "The node's referential name" }),
        contextId: Schema.String.annotate({ description: "ID of the bounded context" }),
        defaultSemantics: Schema.optional(Schema.String).annotate({ description: "Default semantic description" }),
        aliases: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Alternative names" }),
      }),
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const node = yield* design.createNode({
            name: args.name,
            contextId: args.contextId,
            defaultSemantics: args.defaultSemantics,
            aliases: args.aliases,
          })
          return {
            title: `Created node ${node.name}`,
            output: `Node ${node.name} (${node.id}) in context ${node.contextId}`,
            metadata: { nodeId: node.id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
```

- [x] **Step 2: Commit partial tools**

```bash
git add packages/opencode/src/tool/design.ts
git commit -m "feat(design): add resolve_reference, create_context, create_node tools"
```

---

## Task 8: Design Tools (Part 2)

**Files:**
- Modify: `packages/opencode/src/tool/design.ts`
- Modify: `packages/opencode/src/tool/registry.ts`

**Interfaces:**
- Produces: `DesignCreateEdgeTool`, `DesignListNodesTool`, `DesignListEdgesTool`, `DesignShowWorkingSetTool`.

- [x] **Step 1: Add remaining tools to design.ts**

Append to `packages/opencode/src/tool/design.ts`:

```typescript
export const DesignCreateEdgeTool = Tool.define(
  "design_create_edge",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Create or update an edge between two nodes. Only one edge can exist between a node pair.",
      parameters: Schema.Struct({
        leftNodeId: Schema.String.annotate({ description: "ID of the left node" }),
        rightNodeId: Schema.String.annotate({ description: "ID of the right node" }),
        prototypeId: Schema.String.annotate({ description: "ID of the relation prototype" }),
        parameters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
          description: "Edge parameters including semantics overrides",
        }),
      }),
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const edge = yield* design.createEdge({
            leftNodeId: args.leftNodeId,
            rightNodeId: args.rightNodeId,
            prototypeId: args.prototypeId,
            parameters: args.parameters ?? {},
          })
          return {
            title: `Created edge`,
            output: `Edge ${edge.leftNodeId} --[${edge.prototypeId}]--> ${edge.rightNodeId}`,
            metadata: { leftNodeId: edge.leftNodeId, rightNodeId: edge.rightNodeId, prototypeId: edge.prototypeId },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const DesignListNodesTool = Tool.define(
  "design_list_nodes",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "List all nodes in the design graph.",
      parameters: Schema.Struct({}),
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const nodes = yield* design.listNodes()
          const lines = nodes.map((n) => `- ${n.name} (${n.id}) [ctx: ${n.contextId}]${n.retired ? " [retired]" : ""}`)
          return {
            title: "Nodes",
            output: lines.join("\n") || "No nodes yet.",
            metadata: { count: nodes.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const DesignListEdgesTool = Tool.define(
  "design_list_edges",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "List all edges in the design graph.",
      parameters: Schema.Struct({}),
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const edges = yield* design.listEdges()
          const lines = edges.map((e) => `- ${e.leftNodeId} --[${e.prototypeId}]--> ${e.rightNodeId}`)
          return {
            title: "Edges",
            output: lines.join("\n") || "No edges yet.",
            metadata: { count: edges.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const DesignShowWorkingSetTool = Tool.define(
  "design_show_working_set",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description: "Show the current working set of active nodes and contexts.",
      parameters: Schema.Struct({}),
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const ws = yield* design.listWorkingSet()
          return {
            title: "Working Set",
            output: `Active contexts: ${ws.contextIds.join(", ") || "none"}\nActive nodes: ${ws.nodeIds.join(", ") || "none"}`,
            metadata: ws,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
```

- [x] **Step 2: Register tools in registry.ts**

Modify `packages/opencode/src/tool/registry.ts`:

1. Add imports near the top:

```typescript
import { Design } from "@/design/design"
import {
  DesignCreateContextTool,
  DesignCreateEdgeTool,
  DesignCreateNodeTool,
  DesignListEdgesTool,
  DesignListNodesTool,
  DesignResolveReferenceTool,
  DesignShowWorkingSetTool,
} from "./design"
```

2. After `const agent = yield* Agent.Service`, initialize design tools:

```typescript
const designResolveReference = yield* DesignResolveReferenceTool
const designCreateContext = yield* DesignCreateContextTool
const designCreateNode = yield* DesignCreateNodeTool
const designCreateEdge = yield* DesignCreateEdgeTool
const designListNodes = yield* DesignListNodesTool
const designListEdges = yield* DesignListEdgesTool
const designShowWorkingSet = yield* DesignShowWorkingSetTool
```

3. In the `Effect.all` block, add:

```typescript
design_resolve_reference: Tool.init(designResolveReference),
design_create_context: Tool.init(designCreateContext),
design_create_node: Tool.init(designCreateNode),
design_create_edge: Tool.init(designCreateEdge),
design_list_nodes: Tool.init(designListNodes),
design_list_edges: Tool.init(designListEdges),
design_show_working_set: Tool.init(designShowWorkingSet),
```

4. In the `builtin` array, add the design tools:

```typescript
builtin: [
  ...
  tool.design_resolve_reference,
  tool.design_create_context,
  tool.design_create_node,
  tool.design_create_edge,
  tool.design_list_nodes,
  tool.design_list_edges,
  tool.design_show_working_set,
],
```

5. Provide `Design.defaultLayer` in `defaultLayer` pipe:

```typescript
export const defaultLayer = Layer.suspend(() =>
  layer
    .pipe(
      ...
      Layer.provide(Truncate.defaultLayer),
      Layer.provide(Design.defaultLayer), // add this line
    )
    .pipe(...),
)
```

Also add `Design.node` to the imports and the `node` deps array in `registry.ts`:

```typescript
import { Design } from "@/design/design"

export const node = LayerNode.make({
  service: Service,
  layer: layer.pipe(Layer.provide(Ripgrep.defaultLayer)),
  deps: [
    ...
    Design.node, // add this
  ],
})
```

- [x] **Step 3: Commit**

```bash
git add packages/opencode/src/tool/design.ts packages/opencode/src/tool/registry.ts
git commit -m "feat(design): register all seven design tools"
```

---

## Task 9: Design Agent and System Prompt

**Files:**
- Create: `packages/opencode/src/session/prompt/design.txt`
- Modify: `packages/opencode/src/agent/agent.ts`

**Interfaces:**
- Produces: registered `design` Agent with appropriate permissions and prompt.

- [x] **Step 1: Create design.txt**

```text
You are the Design agent for OpenCode Design. Your purpose is to help the user build and evolve a semantic design graph through conversation.

The design graph consists of:
- Nodes: named design concepts (e.g., "Ship", "Health")
- Edges: relationships between nodes, instantiated from relation prototypes (e.g., "aggregate")
- Bounded Contexts: semantic scopes that group related nodes
- Working Set: the currently active nodes and contexts, used for disambiguation
- Event Log: an immutable record of every change, supporting rollback

Core principles:
1. Design is the subject, code is derivative. You do NOT read, edit, write, or execute files. You only operate on the design graph.
2. When the user mentions a concept, resolve it. If it does not exist, create it automatically.
3. Only one edge may exist between two nodes. To change a relationship, update the existing edge.
4. A node belongs to exactly one bounded context. Use contexts to group semantically related concepts.
5. The working set tracks active concepts. Referenced nodes are activated automatically.

Before creating nodes, ensure a bounded context exists. If none exists, create one with an appropriate name.

When the user describes a relationship (e.g., "A has B", "A is part of B"), use the create_edge tool with the "aggregate" prototype unless another prototype is clearly more appropriate.

Always confirm the result of your operations briefly, then ask what the user wants to do next.
```

- [x] **Step 2: Import prompt in agent.ts**

Add to imports in `packages/opencode/src/agent/agent.ts`:

```typescript
import PROMPT_DESIGN from "./prompt/design.txt"
```

- [x] **Step 3: Register design agent**

In the `agents` record in `packages/opencode/src/agent/agent.ts`, add after `plan`:

```typescript
design: {
  name: "design",
  description: "Design mode. Operates on a semantic graph of nodes, edges, and bounded contexts.",
  options: {},
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      question: "allow",
      read: "deny",
      grep: "deny",
      glob: "deny",
      bash: "deny",
      edit: "deny",
      write: "deny",
      apply_patch: "deny",
      task: "deny",
      design_resolve_reference: "allow",
      design_create_context: "allow",
      design_create_node: "allow",
      design_create_edge: "allow",
      design_list_nodes: "allow",
      design_list_edges: "allow",
      design_show_working_set: "allow",
    }),
    user,
  ),
  mode: "primary",
  native: true,
  prompt: PROMPT_DESIGN,
},
```

- [x] **Step 4: Commit**

```bash
git add packages/opencode/src/session/prompt/design.txt packages/opencode/src/agent/agent.ts
git commit -m "feat(design): register design agent with prompt and permissions"
```

---

## Task 10: Tool Tests

**Files:**
- Create: `packages/opencode/test/tool/design.test.ts`

**Interfaces:**
- Consumes: `Design` tools.
- Produces: passing tests for each design tool.

- [x] **Step 1: Write design.test.ts**

```typescript
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import {
  DesignCreateContextTool,
  DesignCreateEdgeTool,
  DesignCreateNodeTool,
  DesignListNodesTool,
  DesignResolveReferenceTool,
  DesignShowWorkingSetTool,
} from "../../src/tool/design"
import { Tool } from "@/tool/tool"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "../../src/session/schema"

const makeCtx = () => ({
  sessionID: SessionID.descending(),
  messageID: MessageID.ascending(),
  agent: "design",
  abort: new AbortController().signal,
  messages: [],
  metadata() {
    return Effect.void
  },
  ask() {
    return Effect.void
  },
})

const it = testEffect(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, Design.defaultLayer))

describe("Design tools", () => {
  it.effect("create_context and create_node", () =>
    Effect.gen(function* () {
      const ctxTool = yield* DesignCreateContextTool
      const nodeTool = yield* DesignCreateNodeTool
      const ctx = makeCtx()

      const ctxResult = yield* (yield* Tool.init(ctxTool)).execute({ name: "战斗系统" }, ctx)
      const contextId = ctxResult.metadata.contextId

      const nodeResult = yield* (yield* Tool.init(nodeTool)).execute(
        { name: "船", contextId },
        ctx,
      )
      expect(nodeResult.output).toContain("船")
    }),
  )

  it.effect("resolve_reference auto-creates missing concept", () =>
    Effect.gen(function* () {
      const tool = yield* DesignResolveReferenceTool
      const ctx = makeCtx()
      const result = yield* (yield* Tool.init(tool)).execute({ reference: "生命值" }, ctx)
      expect(result.metadata.action).toBe("created")
    }),
  )

  it.effect("create_edge links two nodes", () =>
    Effect.gen(function* () {
      const resolveTool = yield* DesignResolveReferenceTool
      const edgeTool = yield* DesignCreateEdgeTool
      const ctx = makeCtx()

      const ship = yield* (yield* Tool.init(resolveTool)).execute({ reference: "船" }, ctx)
      const hp = yield* (yield* Tool.init(resolveTool)).execute({ reference: "生命值" }, ctx)

      const edgeResult = yield* (yield* Tool.init(edgeTool)).execute(
        {
          leftNodeId: ship.metadata.nodeId,
          rightNodeId: hp.metadata.nodeId,
          prototypeId: "aggregate",
          parameters: { 上限: 1000 },
        },
        ctx,
      )
      expect(edgeResult.output).toContain("aggregate")
    }),
  )
})
```

- [x] **Step 2: Run tests**

```bash
cd packages/opencode
bun test test/tool/design.test.ts
```

Expected: PASS

- [x] **Step 3: Commit**

```bash
git add packages/opencode/test/tool/design.test.ts
git commit -m "test(design): add design tool integration tests"
```

---

## Task 11: Verification and Typecheck

**Files:** None (verification task).

- [x] **Step 1: Run full typecheck**

```bash
cd packages/opencode
bun typecheck
```

Expected: PASS (or only pre-existing errors unrelated to design code).

- [x] **Step 2: Run design-related tests**

```bash
cd packages/opencode
bun test test/design test/tool/design.test.ts
```

Expected: PASS

- [x] **Step 3: Manual smoke test (optional but recommended)**

Build OpenCode and start the TUI:

```bash
cd packages/opencode
bun run build
bun run opencode
```

In the TUI:
1. Press Tab until the footer shows `design` mode.
2. Type: `创建战斗系统上下文`
3. Observe LLM calls `design_create_context`.
4. Type: `创建一个名为“船”的节点`
5. Observe LLM calls `design_create_node`.
6. Type: `船有生命值，上限 1000`
7. Observe LLM calls `design_resolve_reference` and `design_create_edge`.

- [x] **Step 4: Final commit**

```bash
git commit --allow-empty -m "chore(design): complete first milestone - design mode core and tools"
```

---

## Self-Review

**Spec coverage:**
- ✅ Node/Edge/Context/Prototype/WorkingSet/EventLog Core elements → Tasks 1-6
- ✅ LLM-driven reference resolution → Task 3 + `design_resolve_reference` tool
- ✅ Edge uniqueness constraint → Task 2 + Task 7
- ✅ Design Agent with no file access → Task 9
- ✅ 7 first-phase tools → Tasks 7-8
- ✅ Persistence → Task 5
- ✅ Extension layer预留 → not implemented in P1, Core is decoupled

**Placeholder scan:**
- No TBD/TODO in plan steps.
- All code blocks contain concrete implementations.

**Type consistency:**
- `DesignTypes.edgeKey` used consistently across graph.ts, design.ts, tools.
- `DesignTypes.Node` / `DesignTypes.Edge` schemas match service method signatures.

**Known limitation:**
- `persistence.ts` state restoration on `load()` is deferred to P2; first milestone only saves state.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-29-design-mode.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach would you like?

---

## 完成记录

**完成时间**：2026-06-30

**最终验证二进制**：`packages/opencode/dist/opencode-windows-x64/bin/opencode.exe` 版本 `0.0.0-dev-202606291914`

**测试状态**：

- Design 相关单元测试：24 个全部通过
- Design 源码 typecheck：通过（仅存在与本次实现无关的预有 `test/session/prompt.test.ts` 错误）
- 端到端验证：在干净目录下运行 `--agent design`，通过对话成功创建 context、node、edge，并生成 `graph.json` 与 `events.jsonl`

**关键修复**（本次里程碑提交）：

- TUI spinner 注册修复：`packages/opencode/src/cli/cmd/run.ts`
- 构建 splitting 关闭：`packages/opencode/script/build.ts`
- Design service 注入：`packages/opencode/src/effect/app-runtime.ts`
- mutation 自动持久化：`packages/opencode/src/design/design.ts`
- 文档更新：`docs/superpowers/specs/2026-06-29-design-mode-design.md`、`docs/superpowers/plans/2026-06-29-design-mode.md`

**P2 方向**：

1. 启动时从 `graph.json` / `events.jsonl` 恢复状态
2. 将 `Design.Service` 改为按实例（directory）隔离
3. 补齐剩余原子工具（update/retire/delete）
4. 引入 Extension 层原型处理器
