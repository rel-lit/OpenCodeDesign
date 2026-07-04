# Design 工具分层与整组提交实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将图修改工具拆分为 ChatAgent 的 `design_propose_change(delta)` 整组提交入口和 GraphAgent 内部 DB 工具，消除连续请求的单操作审批问题。

**Architecture:** ChatAgent 只读图、管理工作集、通过 `design_propose_change` 提交结构化 GraphDelta；系统层构建上下文后交给 GraphAgent 分析；审批面板确认后 GraphAgent 调用 `Design.applyRawDelta` 统一写库。所有 DB 写操作下沉到 `applyRawDelta`，避免双工具语义漂移。

**Tech Stack:** TypeScript, Effect, Bun, SQLite (via `DesignStore`)

## Global Constraints

- 不写 `export namespace Foo`；使用 `export * as Foo from "./foo"`。
- `bun run typecheck` 必须从 `packages/opencode` 目录运行，不能直接用 `tsc`。
- `bun test` 必须从 `packages/opencode` 目录运行。
- 所有写 DB 操作必须走 `Design.applyRawDelta` 单一入口。
- ChatAgent 不能持有图修改工具（create/update/delete/retire）。
- GraphDelta 中 ChatAgent 不能提供系统字段（`id`, `createdAt`, `updatedAt`, `connectedEdges`, `retired`）。

---

## File Map

| 文件 | 责任 |
|---|---|
| `packages/opencode/src/design/agent/types.ts` | `GraphDelta` 类型，允许节点/边缺省系统字段 |
| `packages/opencode/src/design/core/types.ts` | `Node`/`Edge` 类型（不变，但 `applyRawDelta` 使用 Partial 输入） |
| `packages/opencode/src/design/design.ts` | `applyRawDelta` 支持自动补全字段、生成 UUID、替换临时 ID 引用 |
| `packages/opencode/src/tool/design.ts` | 新增 `design_propose_change`；移除 ChatAgent 写工具注册；保留 GraphAgent 内部写工具定义 |
| `packages/opencode/src/tool/registry.ts` | ChatAgent 工具列表只注册读 + propose_change |
| `packages/opencode/src/design/agent/graph.ts` | `execute` 调用 `applyRawDelta`，不直接写 DB |
| `packages/opencode/src/agent/prompt/design.txt` | 重写 ChatAgent prompt：只通过 propose_change 整组提交 |
| `packages/opencode/src/design/agent/prompt/graph.txt` | 聚焦 GraphAgent 评估 + 执行角色 |
| `packages/opencode/test/design/design.test.ts` | 测试 `applyRawDelta` 自动补全和临时 ID 替换 |
| `packages/opencode/test/tool/design.test.ts` | 测试 `design_propose_change` 端到端流程 |
| `packages/opencode/test/design/agent/graph.test.ts` | 测试 GraphAgent execute 缺省字段路径 |

---

## Task 1: Adjust `GraphDelta` type to allow omitted system fields

**Files:**
- Modify: `packages/opencode/src/design/agent/types.ts`

**Interfaces:**
- Consumes: `DesignTypes.Node`, `DesignTypes.Edge` from `packages/opencode/src/design/core/types.ts`
- Produces: `GraphDelta` interface where `addNodes`/`addEdges` items can omit system fields

- [ ] **Step 1: Write the failing test**

Create `packages/opencode/test/design/agent/types.test.ts` if not exists, add test asserting that a `GraphDelta` with minimal node/edge fields is type-valid.

```typescript
import { describe, expect, it } from "bun:test"
import type { GraphDelta } from "@/design/agent/types"

describe("GraphDelta type", () => {
  it("accepts minimal addNodes and addEdges", () => {
    const delta: GraphDelta = {
      addNodes: [{ name: "UserService", contextId: "ctx-core", id: "new-user" }],
      addEdges: [{ leftNodeId: "new-user", rightNodeId: "order-service", prototypeId: "uses" }],
    }
    expect(delta.addNodes).toHaveLength(1)
    expect(delta.addEdges).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/design/agent/types.test.ts`
Expected: FAIL with type error because `addNodes` currently requires full `DesignTypes.Node`.

- [ ] **Step 3: Modify `GraphDelta` interface**

Replace the `GraphDelta` block in `packages/opencode/src/design/agent/types.ts`:

```typescript
export interface NodeInput {
  id?: string
  name: string
  contextId: string
  kind?: string
  aliases?: string[]
  defaultSemantics?: string
}

export interface EdgeInput {
  leftNodeId: string
  rightNodeId: string
  prototypeId: string
  parameters?: Record<string, unknown>
}

export interface GraphDelta {
  addNodes?: NodeInput[]
  updateNodes?: Array<{ id: string; patch: Partial<DesignTypes.Node> }>
  deleteNodeIds?: string[]
  addEdges?: EdgeInput[]
  updateEdges?: Array<{ leftNodeId: string; rightNodeId: string; patch: Partial<DesignTypes.Edge> }>
  deleteEdgeKeys?: string[]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/design/agent/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/design/agent/types.ts packages/opencode/test/design/agent/types.test.ts
git commit -m "feat(design): allow GraphDelta to omit system fields"
```

---

## Task 2: Update `applyRawDelta` to auto-fill fields and resolve temporary IDs

**Files:**
- Modify: `packages/opencode/src/design/design.ts`

**Interfaces:**
- Consumes: `GraphDelta` from Task 1
- Produces: `applyRawDelta` that accepts `GraphDelta` and handles missing `id`/`createdAt`/`updatedAt`/`kind`/`aliases`/`connectedEdges`/`retired`, plus temporary ID replacement

- [ ] **Step 1: Write failing tests**

Add to `packages/opencode/test/design/design.test.ts`:

```typescript
describe("Design.Service applyRawDelta", () => {
  it("auto-fills system fields for new nodes and edges", () =>
    runTest(Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* design.applyRawDelta({
        addNodes: [{ name: "UserService", contextId: "ctx-core" }],
      })
      const nodes = yield* design.listNodes()
      expect(nodes).toHaveLength(1)
      expect(nodes[0].name).toBe("UserService")
      expect(nodes[0].id).toBeDefined()
      expect(nodes[0].kind).toBe("node")
      expect(nodes[0].aliases).toEqual([])
      expect(nodes[0].retired).toBe(false)
    })))

  it("replaces temporary node IDs in edges", () =>
    runTest(Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* design.createNode({ id: "order-service", name: "OrderService", contextId: "ctx-core", kind: "node" })
      yield* design.applyRawDelta({
        addNodes: [{ name: "UserService", contextId: "ctx-core", id: "new-user" }],
        addEdges: [{ leftNodeId: "new-user", rightNodeId: "order-service", prototypeId: "uses" }],
      })
      const edges = yield* design.listEdges()
      expect(edges).toHaveLength(1)
      expect(edges[0].leftNodeId).not.toBe("new-user")
      expect(edges[0].leftNodeId).toMatch(/^[0-9a-f-]{36}$/)
      expect(edges[0].rightNodeId).toBe("order-service")
    })))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/design/design.test.ts`
Expected: FAIL because current `applyRawDelta` expects full `DesignTypes.Node`/`DesignTypes.Edge`.

- [ ] **Step 3: Implement `applyRawDelta` auto-fill logic**

Modify `packages/opencode/src/design/design.ts`:

1. Replace the `applyRawDelta` implementation with a version that:
   - Builds a temporary ID → real UUID map for `addNodes`.
   - For each added node without `id`, generate a UUID and assign it.
   - For each added node, default `kind` to `"node"`, `aliases` to `[]`, `defaultSemantics` to `""`, `connectedEdges` to `[]`, `retired` to `false`, `createdAt`/`updatedAt` to current timestamp.
   - Resolve `leftNodeId`/`rightNodeId` in edges through the temporary ID map.
   - Default edge `parameters` to `{}`, `createdAt`/`updatedAt` to current timestamp.

Key code shape:

```typescript
const applyRawDelta = Effect.fn("Design.applyRawDelta")((delta: GraphAgentTypes.GraphDelta) =>
  use((state) =>
    state.store.transaction((txStore) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const idMap = new Map<string, string>()
        const events: DesignTypes.EventNode[] = []

        for (const node of delta.addNodes ?? []) {
          const id = node.id ?? crypto.randomUUID()
          if (node.id) idMap.set(node.id, id)
          yield* state.graph.createNode({
            id,
            name: node.name,
            contextId: node.contextId,
            kind: node.kind ?? "node",
            defaultSemantics: node.defaultSemantics ?? "",
            aliases: node.aliases ? [...node.aliases] : [],
          })
          events.push(
            yield* state.eventLog.append({ eventType: "node_created", affectedNodeIds: [id] }),
          )
        }

        const resolveId = (raw: string) => idMap.get(raw) ?? raw

        for (const update of delta.updateNodes ?? []) {
          yield* state.graph.updateNode(update.id, update.patch)
          events.push(
            yield* state.eventLog.append({ eventType: "node_updated", affectedNodeIds: [update.id] }),
          )
        }

        for (const id of delta.deleteNodeIds ?? []) {
          yield* state.graph.deleteNode(id)
          events.push(
            yield* state.eventLog.append({ eventType: "node_deleted", affectedNodeIds: [id] }),
          )
        }

        for (const edge of delta.addEdges ?? []) {
          const leftNodeId = resolveId(edge.leftNodeId)
          const rightNodeId = resolveId(edge.rightNodeId)
          yield* state.graph.createEdge({
            leftNodeId,
            rightNodeId,
            prototypeId: edge.prototypeId,
            parameters: { ...(edge.parameters ?? {}) },
          })
          events.push(
            yield* state.eventLog.append({
              eventType: "edge_created",
              affectedNodeIds: [leftNodeId, rightNodeId],
              affectedEdgeKeys: [DesignTypes.edgeKey(leftNodeId, rightNodeId)],
            }),
          )
        }

        for (const update of delta.updateEdges ?? []) {
          yield* state.graph.updateEdge(update.leftNodeId, update.rightNodeId, update.patch)
          events.push(
            yield* state.eventLog.append({
              eventType: "edge_updated",
              affectedNodeIds: [update.leftNodeId, update.rightNodeId],
              affectedEdgeKeys: [DesignTypes.edgeKey(update.leftNodeId, update.rightNodeId)],
            }),
          )
        }

        for (const key of delta.deleteEdgeKeys ?? []) {
          const [leftNodeId, rightNodeId] = parseEdgeKey(key)
          yield* state.graph.deleteEdge(leftNodeId, rightNodeId)
          events.push(
            yield* state.eventLog.append({
              eventType: "edge_deleted",
              affectedNodeIds: [leftNodeId, rightNodeId],
              affectedEdgeKeys: [DesignTypes.edgeKey(leftNodeId, rightNodeId)],
            }),
          )
        }

        const graphState = yield* state.graph.getState()
        yield* txStore.saveGraphState(graphState)
        for (const event of events) {
          yield* txStore.appendEvent(event)
        }
      }),
    ),
  ),
)
```

Add `Clock` import from `effect` if not already imported.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/design/design.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/design/design.ts packages/opencode/test/design/design.test.ts
git commit -m "feat(design): applyRawDelta auto-fills fields and resolves temp IDs"
```

---

## Task 3: Add `design_propose_change` tool and remove ChatAgent write tools from registry

**Files:**
- Modify: `packages/opencode/src/tool/design.ts`
- Modify: `packages/opencode/src/tool/registry.ts`

**Interfaces:**
- Consumes: `Design.proposeChanges(delta)` from `packages/opencode/src/design/design.ts`
- Produces: `DesignProposeChangeTool` exported from `src/tool/design.ts`; ChatAgent registry only includes read/working-set/propose tools

- [ ] **Step 1: Write failing test**

Update `packages/opencode/test/tool/design.test.ts` to test `design_propose_change`:

```typescript
it("propose_change submits a delta and applies it after approval", () =>
  runTest(Effect.gen(function* () {
    const design = yield* Design.Service
    yield* design.createContext({ id: "ctx", name: "Core" })
    yield* design.createNode({ id: "order", name: "OrderService", contextId: "ctx", kind: "node" })

    const tool = yield* DesignProposeChangeTool
    const result = yield* tool.execute({
      delta: {
        addNodes: [{ name: "UserService", contextId: "ctx", id: "new-user" }],
        addEdges: [{ leftNodeId: "new-user", rightNodeId: "order", prototypeId: "uses" }],
      },
    }, defaultCtx)

    expect(result.title).toContain("Created")
    const nodes = yield* design.listNodes()
    const edges = yield* design.listEdges()
    expect(nodes.some((n) => n.name === "UserService")).toBe(true)
    expect(edges).toHaveLength(1)
  })))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/tool/design.test.ts`
Expected: FAIL because `DesignProposeChangeTool` does not exist.

- [ ] **Step 3: Add `design_propose_change` tool and adjust existing write tools**

In `packages/opencode/src/tool/design.ts`:

1. Add new schema and tool at the top of the file after imports:

```typescript
const ProposeChangeParameters = Schema.Struct({
  delta: Schema.Struct({
    addNodes: Schema.optional(Schema.Array(Schema.Struct({
      id: Schema.optional(Schema.String),
      name: Schema.String,
      contextId: Schema.String,
      kind: Schema.optional(Schema.String),
      aliases: Schema.optional(Schema.Array(Schema.String)),
      defaultSemantics: Schema.optional(Schema.String),
    }))),
    updateNodes: Schema.optional(Schema.Array(Schema.Struct({
      id: Schema.String,
      patch: Schema.Record(Schema.String, Schema.Unknown),
    }))),
    deleteNodeIds: Schema.optional(Schema.Array(Schema.String)),
    addEdges: Schema.optional(Schema.Array(Schema.Struct({
      leftNodeId: Schema.String,
      rightNodeId: Schema.String,
      prototypeId: Schema.String,
      parameters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }))),
    updateEdges: Schema.optional(Schema.Array(Schema.Struct({
      leftNodeId: Schema.String,
      rightNodeId: Schema.String,
      patch: Schema.Record(Schema.String, Schema.Unknown),
    }))),
    deleteEdgeKeys: Schema.optional(Schema.Array(Schema.String)),
  }),
})

export const DesignProposeChangeTool = Tool.define<
  typeof ProposeChangeParameters,
  Record<string, unknown>,
  Design.Service
>(
  "design_propose_change",
  Effect.gen(function* () {
    const design = yield* Design.Service
    return {
      description:
        "Submit a complete set of design graph changes as a single batch. The delta can omit system fields like node IDs and timestamps; the system will auto-fill them. All changes are analyzed by GraphAgent and require user approval before being applied.",
      parameters: ProposeChangeParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const result = yield* design.proposeChanges(args.delta)
          return {
            title: result.type === "change-applied" ? "Changes applied" : `Proposal: ${result.type}`,
            output: result.summary,
            metadata: { type: result.type, delta: result.delta },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
```

2. Keep the existing write tool definitions (`DesignCreateNodeTool`, `DesignCreateEdgeTool`, etc.) but do NOT export them from this file for registry use. Instead, add a new named export section at the bottom:

```typescript
export const GraphAgentDesignTools = {
  DesignCreateContextTool,
  DesignUpdateContextTool,
  DesignCreateNodeTool,
  DesignUpdateNodeTool,
  DesignRetireNodeTool,
  DesignDeleteNodeTool,
  DesignCreateEdgeTool,
  DesignUpdateEdgeTool,
  DesignDeleteEdgeTool,
  DesignCreatePrototypeTool,
}
```

- [ ] **Step 4: Update registry to only expose read/propose tools to ChatAgent**

In `packages/opencode/src/tool/registry.ts`:

1. Remove imports of ChatAgent write tools:

```typescript
import {
  DesignActivateContextTool,
  DesignActivateNodeTool,
  DesignFindNodesByNameTool,
  DesignGetContextTool,
  DesignGetNodeTool,
  DesignGetPrototypeTool,
  DesignGetStateTool,
  DesignListContextsTool,
  DesignListEdgesTool,
  DesignListNodesTool,
  DesignListPrototypesTool,
  DesignProposeChangeTool,
  DesignResolveReferenceTool,
  DesignShowWorkingSetTool,
} from "./design"
```

2. Remove `yield*` of write tools and remove them from the `tool` object and `builtin` array.
3. Add `designProposeChange = yield* DesignProposeChangeTool` and register `tool.design_propose_change`.

The `builtin` array should contain only:

- `tool.design_propose_change`
- `tool.design_resolve_reference`
- `tool.design_list_contexts`
- `tool.design_get_context`
- `tool.design_list_nodes`
- `tool.design_get_node`
- `tool.design_find_nodes_by_name`
- `tool.design_list_edges`
- `tool.design_list_prototypes`
- `tool.design_get_prototype`
- `tool.design_show_working_set`
- `tool.design_activate_context`
- `tool.design_activate_node`
- `tool.design_get_state`

- [ ] **Step 5: Run tests**

Run: `bun test test/tool/design.test.ts`
Expected: PASS (after updating tests to use propose_change)

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/tool/design.ts packages/opencode/src/tool/registry.ts packages/opencode/test/tool/design.test.ts
git commit -m "feat(design): add propose_change tool and remove write tools from ChatAgent registry"
```

---

## Task 4: Ensure GraphAgent.execute uses `applyRawDelta` only

**Files:**
- Modify: `packages/opencode/src/design/agent/graph.ts`

**Interfaces:**
- Consumes: `Design.applyRawDelta`, `Design.bumpVersion`
- Produces: `GraphAgent.execute` that delegates all writes to `applyRawDelta`

- [ ] **Step 1: Inspect current `execute`**

Current `execute` already calls `design.applyRawDelta(proposal.delta)` and then `design.bumpVersion("chat-agent")`. Verify no direct `GraphEngine` calls remain.

- [ ] **Step 2: If direct calls exist, replace with `applyRawDelta`**

No code change expected unless direct calls are found. Ensure the function is:

```typescript
const execute = Effect.fn("GraphAgent.execute")(
  function* (proposal: GraphAgentTypes.Output) {
    if (!proposal.delta) return yield* new NoDeltaError()
    const design = yield* Design.Service
    yield* design.applyRawDelta(proposal.delta)
    yield* design.bumpVersion("chat-agent")
    return { ...proposal, type: "change-applied" as const }
  },
)
```

- [ ] **Step 3: Add/update test**

In `packages/opencode/test/design/agent/graph.test.ts` ensure there is a test for execute with minimal delta:

```typescript
it("execute applies a minimal delta through applyRawDelta", () =>
  Effect.gen(function* () {
    const design = yield* Design.Service
    yield* design.createContext({ id: "ctx", name: "Core" })
    const agent = yield* GraphAgent.Service
    const result = yield* agent.execute({
      type: "change-proposal",
      summary: "add user service",
      delta: {
        addNodes: [{ name: "UserService", contextId: "ctx" }],
      },
    })
    expect(result.type).toBe("change-applied")
    const nodes = yield* design.listNodes()
    expect(nodes.some((n) => n.name === "UserService")).toBe(true)
  }).pipe(Effect.provide(Design.defaultLayer), Effect.runPromise))
```

- [ ] **Step 4: Run tests**

Run: `bun test test/design/agent/graph.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/design/agent/graph.ts packages/opencode/test/design/agent/graph.test.ts
git commit -m "refactor(design): GraphAgent execute delegates to applyRawDelta"
```

---

## Task 5: Rewrite ChatAgent prompt

**Files:**
- Modify: `packages/opencode/src/agent/prompt/design.txt`

**Interfaces:**
- Produces: Updated prompt text

- [ ] **Step 1: Replace the prompt content**

Rewrite `packages/opencode/src/agent/prompt/design.txt` to:

1. Remove mentions of direct mutation tools (`design_create_node`, `design_create_edge`, etc.).
2. State that all graph modifications must go through `design_propose_change({ delta })`.
3. Include a delta example.
4. Keep read/working-set tool descriptions.

Example structure:

```
You are the Design agent for OpenCode Design. Your purpose is to help the user build and evolve a semantic design graph through conversation.

The design graph is made of nodes, edges, bounded contexts, relation prototypes, and a working set.

Core principles:
1. You do NOT read, edit, write, or execute code files. You only operate on the design graph.
2. You cannot modify the graph directly. All changes must be submitted as a single batch through design_propose_change({ delta }).
3. The delta describes everything you want to change in this turn. You can omit system fields such as node IDs, createdAt, updatedAt, connectedEdges, and retired. Use temporary IDs for new nodes you need to reference later in the same delta.
4. Start from context. Ensure a bounded context exists before creating nodes.
5. Resolve references with design_resolve_reference when the user mentions a concept.
6. Only one edge may exist between two nodes.
7. Keep the working set useful with design_activate_context and design_activate_node.
8. Every successful batch produces a version bump and is recorded in the event log.

Example delta:
{
  "delta": {
    "addNodes": [
      { "name": "UserService", "contextId": "ctx-core", "id": "new-user" }
    ],
    "addEdges": [
      { "leftNodeId": "new-user", "rightNodeId": "order-service", "prototypeId": "uses" }
    ]
  }
}

Tool usage guide:
- design_propose_change: submit a complete batch of graph changes.
- design_resolve_reference: default for any concept the user mentions.
- design_list_contexts / design_get_context: browse contexts.
- design_list_nodes / design_get_node / design_find_nodes_by_name: inspect nodes.
- design_list_edges: inspect relationships.
- design_list_prototypes / design_get_prototype: inspect relation types.
- design_activate_context / design_activate_node / design_show_working_set: manage working set.
- design_get_state: retrieve full graph.

When the user asks for the current design, use design_get_state or the relevant list tools. Confirm results briefly, then ask what to do next.
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/agent/prompt/design.txt
git commit -m "docs(design): rewrite ChatAgent prompt for propose_change workflow"
```

---

## Task 6: Update GraphAgent prompt

**Files:**
- Modify: `packages/opencode/src/design/agent/prompt/graph.txt`

**Interfaces:**
- Produces: Updated prompt text

- [ ] **Step 1: Add role focus**

Ensure the prompt clearly states GraphAgent does not interpret open-ended intent and only evaluates the provided GraphDelta.

Append or integrate:

```
You do not interpret open-ended user intent. The delta you receive is the exact proposal to evaluate.

Return one of:
- "change-proposal" with the same or corrected delta
- "rejected" with a clear reason

After user confirmation, the execute path will apply the delta through Design.applyRawDelta.
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/design/agent/prompt/graph.txt
git commit -m "docs(design): focus GraphAgent prompt on delta evaluation and execution"
```

---

## Task 7: Run full verification

**Files:**
- All modified files

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run design tests**

Run: `bun test test/design`
Expected: PASS

- [ ] **Step 3: Run tool tests**

Run: `bun test test/tool/design.test.ts`
Expected: PASS

- [ ] **Step 4: Run build**

Run: `bun run build --single`
Expected: PASS

- [ ] **Step 5: Final commit if any fixes**

If any fixes were needed, commit them with appropriate conventional commit messages.

---

## Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| ChatAgent 删除图修改工具 | Task 3 |
| 新增 `design_propose_change` | Task 3 |
| GraphAgent 独占 DB 写工具 | Task 3, Task 4 |
| Delta 可省略系统字段 | Task 1, Task 2 |
| ID 引用替换集中化 | Task 2 |
| 统一 truth source (`applyRawDelta`) | Task 2, Task 4 |
| ChatAgent prompt 重写 | Task 5 |
| GraphAgent prompt 聚焦 | Task 6 |
| 测试覆盖双工具一致性 | Task 2, Task 3, Task 4 |

## Placeholder Scan

No TBD/TODO/fill-in-details remain. Every step includes exact file paths, code, commands, and expected outputs.
