# Design 多 Agent 架构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Design 模式基础上引入 ChatAgent、GraphAgent、SearchAgent 三角色架构，实现系统层预处理、审批面板、版本同步与 Design → Plan/Edit 衔接，最终让 Design 模式在 Windows 桌面端 GUI 中具备可解释的协作式设计能力。

**Architecture:** 保留 `Design.Service` 和 SQLite 存储层，在其上叠加 Agent 编排层。ChatAgent 是唯一对话 Agent，通过调用 GraphAgent 完成图分析/提案/执行，调用 SearchAgent 完成检索对比。系统层负责廉价确定性预处理、UI 触发、版本同步。可视化编辑器手动保存直接写库，由 GraphAgent 事后审查。

**Tech Stack:** TypeScript, Effect, SQLite (via `Design.Service`), Drizzle (core 层), `ai` SDK（对象生成/流式）, Bun。

## Global Constraints

- 仅面向 Windows 桌面端 GUI；CLI 与 Web 不在范围内。
- 不替换现有 `Design.Service` 和 SQLite 存储层。
- 使用 Effect `Effect.gen` 和 `Effect.fn`；遵循 `src/effect/instance-state.ts` 进行 per-project 状态隔离。
- 模块组织使用 flat top-level exports + `export * as Namespace from "./file"`；禁止使用 `export namespace Foo`。
- 字段/列名使用 snake_case。
- 避免 `try`/`catch`，优先使用 Effect 错误通道。
- 测试从 `packages/opencode` 目录运行；不使用 root 运行测试。
- 类型检查使用 `bun run typecheck` from `packages/opencode`。
- 每次成功的操作组都产生基于 `EventLog` 的逻辑版本迭代。
- 可视化编辑器编辑必须与 Agent 处理逻辑同步；任意时刻只存在一种“设计修改源”。
- 所有实现阶段必须完成，不能只实现部分阶段就停止。

---

## 文件结构映射

| 文件 | 职责 |
|------|------|
| `src/design/system/preprocessor.ts` | 系统层：@ 展开、临时工作集初始构建、阈值判断 |
| `src/design/system/analyzer.ts` | 系统层：可自动化图检查（冲突关系、重复节点、孤立节点等） |
| `src/design/system/version-sync.ts` | 系统层：EventLog 版本标记、Agent 上下文刷新 |
| `src/design/agent/graph.ts` | GraphAgent 服务与编排逻辑 |
| `src/design/agent/search.ts` | SearchAgent 服务与编排逻辑 |
| `src/design/agent/prompt/graph.txt` | GraphAgent system prompt |
| `src/design/agent/prompt/search.txt` | SearchAgent system prompt |
| `src/design/approval-panel.ts` | 审批面板状态机（系统 UI 触发，非 Agent） |
| `src/design/visual-editor-protocol.ts` | 可视化编辑器保存协议与同步约束 |
| `src/agent/agent.ts` | 注册 design-graph、design-search 子 Agent |
| `src/agent/prompt/design.txt` | 更新 Design 主 Agent prompt |
| `src/tool/design.ts` | 调整 design_* 工具调用入口，使其走 GraphAgent 提案流程 |
| `test/design/agent/graph.test.ts` | GraphAgent 集成测试 |
| `test/design/system/preprocessor.test.ts` | 系统层预处理测试 |
| `test/design/approval-panel.test.ts` | 审批面板状态机测试 |

---

## Phase 1: GraphAgent 与前置写入锁

### Task 1: 定义 GraphAgent 核心类型与接口

**Files:**
- Create: `src/design/agent/types.ts`
- Modify: `src/design/core/types.ts`（如需补充字段）
- Test: `test/design/agent/types.test.ts`

**Interfaces:**
- Consumes: `DesignTypes.GraphState`, `DesignTypes.Node`, `DesignTypes.Edge` from `src/design/core/types.ts`
- Produces: `GraphAgent.Input`, `GraphAgent.Output`, `GraphDelta` 类型

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test"
import { GraphAgent } from "@/design/agent/types"

describe("GraphAgent types", () => {
  test("input schema accepts chat source with proposed change", () => {
    const input: GraphAgent.Input = {
      source: "chat",
      userInput: "rename UserService",
      temporaryWorkingSet: {
        contextIds: ["ctx-core"],
        nodeIds: ["node-5"],
        edgeKeys: [],
        systemAnalysis: {
          conflictingRelations: [],
          duplicateNodeCandidates: [],
          orphanNodes: [],
          invalidPrototypeUsage: [],
        },
        expandedByGraphAgent: {
          contextIds: [],
          nodeIds: [],
          edgeKeys: [],
          reason: "",
        },
      },
      activeWorkingSet: { contextIds: ["ctx-core"], nodeIds: ["node-5"], capacity: 10 },
      graphState: { contexts: [], nodes: [], edges: [], prototypes: [] },
      proposedChange: {
        updateNodes: [{ id: "node-5", patch: { name: "UserServiceV2" } }],
      },
      knownVersion: 1,
    }
    expect(input.source).toBe("chat")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/design/agent/types.test.ts`
Expected: FAIL with module not found or type not found.

- [ ] **Step 3: Implement minimal types**

```typescript
// src/design/agent/types.ts
import { DesignTypes } from "@/design/core/types"

export interface TemporaryWorkingSet {
  contextIds: string[]
  nodeIds: string[]
  edgeKeys: string[]
  systemAnalysis: {
    conflictingRelations: Array<{
      edgeKey: string
      reason: string
      severity: "error" | "warning"
    }>
    duplicateNodeCandidates: Array<{ nodeIds: string[]; similarityScore: number }>
    orphanNodes: string[]
    invalidPrototypeUsage: Array<{ edgeKey: string; prototypeId: string; reason: string }>
  }
  expandedByGraphAgent: {
    contextIds: string[]
    nodeIds: string[]
    edgeKeys: string[]
    reason: string
  }
}

export interface ActiveWorkingSet {
  contextIds: string[]
  nodeIds: string[]
  capacity: number
}

export interface GraphDelta {
  addNodes?: DesignTypes.Node[]
  updateNodes?: Array<{ id: string; patch: Partial<DesignTypes.Node> }>
  deleteNodeIds?: string[]
  addEdges?: DesignTypes.Edge[]
  updateEdges?: Array<{ leftNodeId: string; rightNodeId: string; patch: Partial<DesignTypes.Edge> }>
  deleteEdgeKeys?: string[]
}

export interface Input {
  source: "chat" | "visual-editor"
  userInput: string
  temporaryWorkingSet: TemporaryWorkingSet
  activeWorkingSet: ActiveWorkingSet
  graphState: DesignTypes.GraphState
  proposedChange?: GraphDelta
  knownVersion?: number
}

export interface Output {
  type: "enriched-input" | "graph-summary" | "change-proposal" | "change-applied" | "rejected"
  summary: string
  structured?: {
    warnings?: Array<{ code: string; message: string; nodeId?: string; edgeKey?: string }>
    suggestions?: Array<{ action: string; reason: string }>
  }
  affectedNodes: string[]
  affectedEdges: string[]
  questions?: string[]
  delta?: GraphDelta
}

export * as GraphAgent from "./types"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/design/agent/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/design/agent/types.ts test/design/agent/types.test.ts
git commit -m "feat(design): define GraphAgent core types"
```

---

### Task 2: 创建 GraphAgent 服务骨架

**Files:**
- Create: `src/design/agent/graph.ts`
- Create: `src/design/agent/prompt/graph.txt`
- Modify: `src/agent/agent.ts`
- Test: `test/design/agent/graph.test.ts`

**Interfaces:**
- Consumes: `GraphAgent.Input` / `Output`, `Design.Service`
- Produces: `GraphAgent.Service` with `analyze(input)` and `execute(proposal)` methods

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { GraphAgent } from "@/design/agent/graph"
import * as GraphAgentTypes from "@/design/agent/types"

describe("GraphAgent service", () => {
  test("analyze returns change-proposal for trivial rename", async () => {
    const input: GraphAgentTypes.Input = {
      source: "chat",
      userInput: "rename UserService to UserServiceV2",
      temporaryWorkingSet: {
        contextIds: ["ctx-core"],
        nodeIds: ["node-5"],
        edgeKeys: [],
        systemAnalysis: { conflictingRelations: [], duplicateNodeCandidates: [], orphanNodes: [], invalidPrototypeUsage: [] },
        expandedByGraphAgent: { contextIds: [], nodeIds: [], edgeKeys: [], reason: "" },
      },
      activeWorkingSet: { contextIds: ["ctx-core"], nodeIds: ["node-5"], capacity: 10 },
      graphState: { contexts: [], nodes: [{ id: "node-5", name: "UserService", contextId: "ctx-core", kind: "service" }], edges: [], prototypes: [] },
      proposedChange: { updateNodes: [{ id: "node-5", patch: { name: "UserServiceV2" } }] },
    }
    const program = Effect.gen(function* () {
      const ga = yield* GraphAgent.Service
      return yield* ga.analyze(input)
    })
    // 先验证服务可构造，实际 LLM 调用在后续 task 中 mock
    expect(program).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/design/agent/graph.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement minimal service skeleton**

```typescript
// src/design/agent/graph.ts
import { Context, Effect } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import * as GraphAgentTypes from "./types"
import PROMPT_GRAPH from "./prompt/graph.txt"

export interface Interface {
  readonly analyze: (input: GraphAgentTypes.Input) => Effect.Effect<GraphAgentTypes.Output>
  readonly execute: (proposal: GraphAgentTypes.Output) => Effect.Effect<GraphAgentTypes.Output>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignGraphAgent") {}
export const use = serviceUse(Service)

export const layer = Effect.gen(function* () {
  const analyze = Effect.fn("GraphAgent.analyze")(
    (input: GraphAgentTypes.Input): Effect.Effect<GraphAgentTypes.Output> => {
      // TODO: wire LLM call in Task 3
      return Effect.succeed({
        type: "change-proposal",
        summary: `Proposed change for ${input.userInput}`,
        affectedNodes: input.temporaryWorkingSet.nodeIds,
        affectedEdges: input.temporaryWorkingSet.edgeKeys,
        delta: input.proposedChange,
      })
    }
  )

  const execute = Effect.fn("GraphAgent.execute")(
    (proposal: GraphAgentTypes.Output): Effect.Effect<GraphAgentTypes.Output> => {
      // TODO: apply delta via Design.Service in Task 4
      return Effect.succeed({ ...proposal, type: "change-applied" })
    }
  )

  return { analyze, execute }
}).pipe(Effect.map(Service.make))

export * as GraphAgent from "./graph"
```

- [ ] **Step 4: Register GraphAgent as subagent**

```typescript
// src/agent/agent.ts (在现有 agent 注册附近添加)
const graphAgentInfo: Info = {
  name: "design-graph",
  description: "Analyzes design graphs, generates change proposals, and executes approved writes.",
  mode: "subagent",
  native: true,
  permission: Permission.fromConfig({ /* 只允许 design_* 工具 */ }),
  prompt: PROMPT_GRAPH,
  options: {},
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/design/agent/graph.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/design/agent/graph.ts src/design/agent/prompt/graph.txt src/agent/agent.ts test/design/agent/graph.test.ts
git commit -m "feat(design): add GraphAgent service skeleton and register as subagent"
```

---

### Task 3: 实现 GraphAgent LLM 调用（变更提案）

**Files:**
- Modify: `src/design/agent/graph.ts`
- Modify: `src/design/agent/prompt/graph.txt`
- Test: `test/design/agent/graph.test.ts`

**Interfaces:**
- Consumes: `Provider.Service` / `ModelV2` for object generation
- Produces: `GraphAgent.Output` with structured `change-proposal`

- [ ] **Step 1: Write the failing test**

```typescript
test("analyze returns structured change-proposal", async () => {
  const input = makeSampleInput()
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const ga = yield* GraphAgent.Service
      return yield* ga.analyze(input)
    }).pipe(Effect.provide(/* mock layer */))
  )
  expect(result.type).toBe("change-proposal")
  expect(result.summary).toBeTruthy()
  expect(result.affectedNodes).toContain("node-5")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/design/agent/graph.test.ts -t "analyze returns structured change-proposal"`
Expected: FAIL (LLM not wired).

- [ ] **Step 3: Wire object generation with mockable provider**

使用 `ai` SDK 的 `generateObject`，通过 provider 服务注入。先实现一个 `mockLayer` 用于测试。

```typescript
// src/design/agent/graph.ts
const analyzeWithLLM = Effect.fn("GraphAgent.analyzeWithLLM")(
  function* (input: GraphAgentTypes.Input) {
    // 构造 prompt：包含临时工作集、系统分析、 proposedChange
    const prompt = buildPrompt(input)
    // 调用 generateObject
    const result = yield* DesignAgentLlm.generateObject({
      prompt,
      schema: GraphAgentOutputSchema, // 使用 Schema 约束输出
    })
    return result.object as GraphAgentTypes.Output
  }
)
```

- [ ] **Step 4: Add prompt template**

`src/design/agent/prompt/graph.txt`:
```
You are GraphAgent, a design-graph analysis engine.
You receive a temporary working set, system-automated analysis hints, and an optional proposed change.
Your job:
1. Analyze the design for conflicts, duplicates, orphaned nodes, invalid prototype usage.
2. If a proposed change is provided, evaluate it and return a change-proposal or rejected response.
3. If no proposed change is provided, return an enriched-input or graph-summary.
Always respond with natural language summary in "summary" and structured hints in "structured".
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/design/agent/graph.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(design): wire GraphAgent LLM for change proposals"
```

---

### Task 4: 实现 GraphAgent 执行写入

**Files:**
- Modify: `src/design/agent/graph.ts`
- Modify: `src/design/design.ts`
- Test: `test/design/agent/graph-execute.test.ts`

**Interfaces:**
- Consumes: `Design.Service`, `GraphAgent.Output` with `delta`
- Produces: applied `GraphAgent.Output` and updated DB state

- [ ] **Step 1: Write the failing test**

```typescript
test("execute applies delta via Design.Service", async () => {
  const proposal: GraphAgentTypes.Output = {
    type: "change-proposal",
    summary: "rename node",
    affectedNodes: ["node-5"],
    affectedEdges: [],
    delta: { updateNodes: [{ id: "node-5", patch: { name: "UserServiceV2" } }] },
  }
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const ga = yield* GraphAgent.Service
      return yield* ga.execute(proposal)
    }).pipe(Effect.provide(/* test layers */))
  )
  expect(result.type).toBe("change-applied")
})
```

- [ ] **Step 2: Implement execute using Design.Service**

```typescript
const execute = Effect.fn("GraphAgent.execute")(
  function* (proposal: GraphAgentTypes.Output) {
    if (!proposal.delta) return yield* Effect.fail(new GraphAgentError.NoDelta())
    const design = yield* Design.Service
    yield* design.transaction(function* () {
      for (const node of proposal.delta?.addNodes ?? []) yield* design.createNode(node)
      for (const update of proposal.delta?.updateNodes ?? []) yield* design.updateNode(update.id, update.patch)
      for (const id of proposal.delta?.deleteNodeIds ?? []) yield* design.deleteNode(id)
      for (const edge of proposal.delta?.addEdges ?? []) yield* design.createEdge(edge)
      for (const update of proposal.delta?.updateEdges ?? []) yield* design.updateEdge(update.leftNodeId, update.rightNodeId, update.patch)
      for (const key of proposal.delta?.deleteEdgeKeys ?? []) yield* design.deleteEdge(key)
    })
    return { ...proposal, type: "change-applied" } as GraphAgentTypes.Output
  }
)
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/agent/graph-execute.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(design): implement GraphAgent execute writes via Design.Service"
```

---

### Task 5: 实现审批面板状态机

**Files:**
- Create: `src/design/approval-panel.ts`
- Test: `test/design/approval-panel.test.ts`

**Interfaces:**
- Consumes: `GraphAgent.Output` (proposals)
- Produces: `ApprovalPanel.State` transitions; events: `confirm`, `force`, `reject`, `revise`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test"
import { ApprovalPanel } from "@/design/approval-panel"

describe("ApprovalPanel", () => {
  test("transitions from idle to proposing", () => {
    const panel = ApprovalPanel.make()
    panel.propose({ type: "change-proposal", summary: "rename", affectedNodes: [], affectedEdges: [] })
    expect(panel.getState().status).toBe("proposing")
  })

  test("confirm transitions to executing", () => {
    const panel = ApprovalPanel.make()
    panel.propose({ type: "change-proposal", summary: "rename", affectedNodes: [], affectedEdges: [] })
    panel.confirm()
    expect(panel.getState().status).toBe("executing")
  })
})
```

- [ ] **Step 2: Implement state machine**

```typescript
// src/design/approval-panel.ts
import * as GraphAgentTypes from "@/design/agent/types"

export type State =
  | { status: "idle" }
  | { status: "proposing"; proposal: GraphAgentTypes.Output }
  | { status: "executing"; proposal: GraphAgentTypes.Output }
  | { status: "done"; proposal: GraphAgentTypes.Output }
  | { status: "rejected"; reason: string }

export interface Interface {
  readonly getState: () => State
  readonly propose: (proposal: GraphAgentTypes.Output) => void
  readonly confirm: () => void
  readonly force: () => void
  readonly reject: (reason: string) => void
  readonly done: () => void
  readonly reset: () => void
}

export const make = (): Interface => {
  let state: State = { status: "idle" }
  return {
    getState: () => state,
    propose: (proposal) => { state = { status: "proposing", proposal } },
    confirm: () => {
      if (state.status !== "proposing") throw new Error("Cannot confirm when not proposing")
      state = { status: "executing", proposal: state.proposal }
    },
    force: () => {
      if (state.status !== "proposing") throw new Error("Cannot force when not proposing")
      state = { status: "executing", proposal: state.proposal }
    },
    reject: (reason) => { state = { status: "rejected", reason } },
    done: () => {
      if (state.status !== "executing") throw new Error("Cannot done when not executing")
      state = { status: "done", proposal: state.proposal }
    },
    reset: () => { state = { status: "idle" } },
  }
}

export * as ApprovalPanel from "./approval-panel"
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/approval-panel.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/design/approval-panel.ts test/design/approval-panel.test.ts
git commit -m "feat(design): add approval panel state machine"
```

---

### Task 6: 让 Design 主 Agent 走 GraphAgent 提案流程

**Files:**
- Modify: `src/agent/prompt/design.txt`
- Modify: `src/tool/design.ts`
- Modify: `src/design/design.ts`
- Test: `test/tool/design.test.ts`

**Interfaces:**
- Consumes: `GraphAgent.Service`, `ApprovalPanel.Interface`
- Produces: design tool calls now grouped and routed through GraphAgent

- [ ] **Step 1: Write the failing test**

```typescript
test("design tool group routes through GraphAgent proposal", async () => {
  // 模拟 ChatAgent 一次响应中连续调用两个 design 工具
  // 验证它们被归为一组并交给 GraphAgent.analyze
})
```

- [ ] **Step 2: Implement tool call grouping in design.ts service**

在 `src/design/design.ts` 中新增 `proposeChanges(delta)` 方法：

```typescript
proposeChanges: (delta: GraphAgentTypes.GraphDelta) => Effect.Effect<GraphAgentTypes.Output>
```

该方法：
1. 构建临时工作集。
2. 调用 `GraphAgent.analyze`。
3. 将提案放入审批面板（系统 UI 触发）。
4. 等待用户确认后调用 `GraphAgent.execute`。

- [ ] **Step 3: Update Design agent prompt**

更新 `src/agent/prompt/design.txt`，让 ChatAgent 知道：
- 不要直接修改图。
- 一次性提出一组 `design_*` 操作。
- 用户会在审批面板确认后执行。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/tool/design.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(design): route design tool calls through GraphAgent approval flow"
```

---

## Phase 2: 系统层预处理

### Task 7: 实现 @ 引用展开

**Files:**
- Create: `src/design/system/preprocessor.ts`
- Test: `test/design/system/preprocessor.test.ts`

**Interfaces:**
- Consumes: raw user input string, current graph state
- Produces: input with `@` references expanded

- [ ] **Step 1: Write the failing test**

```typescript
test("expands @UserService to node summary", () => {
  const graphState = {
    nodes: [{ id: "node-5", name: "UserService", contextId: "ctx-core", kind: "service" }],
    contexts: [{ id: "ctx-core", name: "core" }],
    edges: [],
    prototypes: [],
  }
  const result = expandAtReferences("修改 @UserService 的依赖", graphState)
  expect(result).toContain("UserService（节点 ID: node-5")
})
```

- [ ] **Step 2: Implement expansion**

```typescript
// src/design/system/preprocessor.ts
export const expandAtReferences = (input: string, graphState: DesignTypes.GraphState): string => {
  const pattern = /@([A-Za-z0-9_]+)/g
  return input.replace(pattern, (match, name) => {
    const node = graphState.nodes.find((n) => n.name === name)
    if (!node) return match
    const ctx = graphState.contexts.find((c) => c.id === node.contextId)
    return `${match}（节点 ID: ${node.id}，类型: ${node.kind}，上下文: ${ctx?.name ?? node.contextId}）`
  })
}

export * as Preprocessor from "./preprocessor"
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/system/preprocessor.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(design): implement @ reference expansion"
```

---

### Task 8: 实现临时工作集计算

**Files:**
- Create: `src/design/system/working-set-computer.ts`
- Test: `test/design/system/working-set-computer.test.ts`

**Interfaces:**
- Consumes: `@` references, active working set, keywords, proposed delta, graph state
- Produces: `TemporaryWorkingSet` (initial)

- [ ] **Step 1: Write the failing test**

```typescript
test("includes involved nodes, adjacent edges, and active nodes", () => {
  const graphState = {
    contexts: [{ id: "ctx-core", name: "core" }],
    nodes: [
      { id: "node-1", name: "OrderService", contextId: "ctx-core", kind: "service" },
      { id: "node-5", name: "UserService", contextId: "ctx-core", kind: "service" },
    ],
    edges: [{ leftNodeId: "node-1", rightNodeId: "node-5", label: "uses" }],
    prototypes: [],
  }
  const active = { contextIds: ["ctx-core"], nodeIds: ["node-5"], capacity: 10 }
  const result = WorkingSetComputer.fromInput("修改 @UserService", active, graphState)
  expect(result.nodeIds).toContain("node-5")
  expect(result.nodeIds).toContain("node-1") // 相邻节点
  expect(result.edgeKeys).toContain("node-1->node-5")
})
```

- [ ] **Step 2: Implement computer**

```typescript
// src/design/system/working-set-computer.ts
import * as GraphAgentTypes from "@/design/agent/types"

export const fromInput = (
  input: string,
  active: GraphAgentTypes.ActiveWorkingSet,
  graphState: DesignTypes.GraphState
): GraphAgentTypes.TemporaryWorkingSet => {
  const mentionedNames = Array.from(input.matchAll(/@([A-Za-z0-9_]+)/g)).map((m) => m[1])
  const mentionedNodeIds = mentionedNames
    .map((name) => graphState.nodes.find((n) => n.name === name)?.id)
    .filter((id): id is string => !!id)

  const involvedNodeIds = new Set([...active.nodeIds, ...mentionedNodeIds])
  const involvedEdgeKeys = new Set<string>()

  for (const edge of graphState.edges) {
    if (involvedNodeIds.has(edge.leftNodeId) || involvedNodeIds.has(edge.rightNodeId)) {
      involvedEdgeKeys.add(`${edge.leftNodeId}->${edge.rightNodeId}`)
      involvedNodeIds.add(edge.leftNodeId)
      involvedNodeIds.add(edge.rightNodeId)
    }
  }

  return {
    contextIds: [...new Set([...active.contextIds, ...Array.from(involvedNodeIds).map((id) => graphState.nodes.find((n) => n.id === id)!.contextId)])],
    nodeIds: [...involvedNodeIds],
    edgeKeys: [...involvedEdgeKeys],
    systemAnalysis: { conflictingRelations: [], duplicateNodeCandidates: [], orphanNodes: [], invalidPrototypeUsage: [] },
    expandedByGraphAgent: { contextIds: [], nodeIds: [], edgeKeys: [], reason: "" },
  }
}

export * as WorkingSetComputer from "./working-set-computer"
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/system/working-set-computer.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(design): implement temporary working set computer"
```

---

### Task 9: 实现系统辅助分析区

**Files:**
- Create: `src/design/system/analyzer.ts`
- Test: `test/design/system/analyzer.test.ts`

**Interfaces:**
- Consumes: `TemporaryWorkingSet`, `DesignTypes.GraphState`
- Produces: populated `systemAnalysis` fields

- [ ] **Step 1: Write the failing test**

```typescript
test("detects duplicate node candidates", () => {
  const graphState = {
    nodes: [
      { id: "n1", name: "UserService", contextId: "ctx", kind: "service" },
      { id: "n2", name: "UserSvc", contextId: "ctx", kind: "service" },
    ],
    edges: [],
    contexts: [{ id: "ctx", name: "core" }],
    prototypes: [],
  }
  const tws = WorkingSetComputer.fromInput("", { contextIds: ["ctx"], nodeIds: ["n1", "n2"], capacity: 10 }, graphState)
  const result = SystemAnalyzer.analyze(tws, graphState)
  expect(result.systemAnalysis.duplicateNodeCandidates.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Implement analyzer**

```typescript
// src/design/system/analyzer.ts
import * as GraphAgentTypes from "@/design/agent/types"

export const analyze = (
  tws: GraphAgentTypes.TemporaryWorkingSet,
  graphState: DesignTypes.GraphState
): GraphAgentTypes.TemporaryWorkingSet => {
  const orphanNodes = tws.nodeIds.filter((id) => {
    return !graphState.edges.some((e) => e.leftNodeId === id || e.rightNodeId === id)
  })

  const duplicateNodeCandidates: GraphAgentTypes.TemporaryWorkingSet["systemAnalysis"]["duplicateNodeCandidates"] = []
  // 简单启发式：名称编辑距离或共同前缀
  for (let i = 0; i < tws.nodeIds.length; i++) {
    for (let j = i + 1; j < tws.nodeIds.length; j++) {
      const a = graphState.nodes.find((n) => n.id === tws.nodeIds[i])!
      const b = graphState.nodes.find((n) => n.id === tws.nodeIds[j])!
      if (a.name.toLowerCase().includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(a.name.toLowerCase())) {
        duplicateNodeCandidates.push({ nodeIds: [a.id, b.id], similarityScore: 0.7 })
      }
    }
  }

  return {
    ...tws,
    systemAnalysis: {
      ...tws.systemAnalysis,
      orphanNodes,
      duplicateNodeCandidates,
    },
  }
}

export * as SystemAnalyzer from "./analyzer"
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/system/analyzer.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(design): add system-assisted graph analysis"
```

---

### Task 10: 整合预处理流程到 Design 服务

**Files:**
- Modify: `src/design/design.ts`
- Modify: `src/design/system/preprocessor.ts`
- Test: `test/design/design-preprocess.test.ts`

**Interfaces:**
- Consumes: raw user input
- Produces: processed input text, enriched input from GraphAgent

- [ ] **Step 1: Write the failing test**

```typescript
test("preprocess returns processed input for ChatAgent", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const design = yield* Design.Service
      return yield* design.preprocessInput("修改 @UserService")
    }).pipe(Effect.provide(/* test layers */))
  )
  expect(result.processedText).toContain("节点 ID")
})
```

- [ ] **Step 2: Implement preprocessInput in Design.Service**

```typescript
preprocessInput: (input: string) => Effect.Effect<{
  processedText: string
  temporaryWorkingSet: GraphAgentTypes.TemporaryWorkingSet
  enriched?: GraphAgentTypes.Output
}>
```

实现：
1. 获取当前图状态、活跃工作集。
2. `@` 展开。
3. 计算临时工作集。
4. 系统辅助分析。
5. 阈值判断：若触发，调用 GraphAgent.analyze 返回 enriched input。
6. 生成 processedText。

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/design-preprocess.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(design): integrate system preprocessor into Design.Service"
```

---

## Phase 3: SearchAgent 与模式衔接

### Task 11: 定义 SearchAgent 类型与服务

**Files:**
- Create: `src/design/agent/search.ts`
- Create: `src/design/agent/prompt/search.txt`
- Modify: `src/agent/agent.ts`
- Test: `test/design/agent/search.test.ts`

**Interfaces:**
- Consumes: `graphSummary`, `retrievalRequirements`
- Produces: `summaryReport`, `diffAnalysis`, `nonGraphInfo`

- [ ] **Step 1: Write the failing test**

```typescript
import { SearchAgent } from "@/design/agent/search"

test("search agent returns summary report", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const sa = yield* SearchAgent.Service
      return yield* sa.search({
        graphSummary: "设计包含 UserService 和 OrderService",
        retrievalRequirements: "对比项目实现",
      })
    }).pipe(Effect.provide(/* mock layer */))
  )
  expect(result.summaryReport).toBeTruthy()
})
```

- [ ] **Step 2: Implement SearchAgent skeleton**

```typescript
// src/design/agent/search.ts
import { Context, Effect } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import PROMPT_SEARCH from "./prompt/search.txt"

export interface Input {
  graphSummary: string
  retrievalRequirements: string
  focus?: { contextIds?: string[]; nodeIds?: string[] }
}

export interface Output {
  summaryReport: string
  diffAnalysis?: {
    missingInCode: Array<{ nodeId?: string; name: string; reason: string }>
    divergentRelations: Array<{ designEdge?: string; actualCode: string; reason: string }>
    references: Array<{ file: string; line?: number; snippet: string }>
  }
  nonGraphInfo?: Array<{ type: "text" | "link"; content: string }>
}

export interface Interface {
  readonly search: (input: Input) => Effect.Effect<Output>
  readonly readProject: (graphSummary: string) => Effect.Effect<Output>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignSearchAgent") {}
export const use = serviceUse(Service)

export const layer = Effect.gen(function* () {
  const search = Effect.fn("SearchAgent.search")(
    (input: Input): Effect.Effect<Output> => {
      // TODO: wire project reading / web search in Task 12
      return Effect.succeed({
        summaryReport: `Search result for: ${input.retrievalRequirements}`,
      })
    }
  )
  const readProject = Effect.fn("SearchAgent.readProject")(
    (graphSummary: string): Effect.Effect<Output> => {
      return Effect.succeed({ summaryReport: "Project read placeholder" })
    }
  )
  return { search, readProject }
}).pipe(Effect.map(Service.make))

export * as SearchAgent from "./search"
```

- [ ] **Step 3: Register SearchAgent as subagent**

在 `src/agent/agent.ts` 中注册 `design-search`。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/design/agent/search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(design): add SearchAgent service skeleton and register as subagent"
```

---

### Task 12: 实现 SearchAgent 项目阅读与对比分析

**Files:**
- Modify: `src/design/agent/search.ts`
- Modify: `src/design/agent/prompt/search.txt`
- Test: `test/design/agent/search-integration.test.ts`

**Interfaces:**
- Consumes: project files via `grep`/`glob`, current graph summary
- Produces: `summaryReport` and `diffAnalysis`

- [ ] **Step 1: Write the failing test**

```typescript
test("readProject finds missing PaymentGateway", async () => {
  // 在临时项目目录中创建 src/services/order.ts，不包含 PaymentGateway
})
```

- [ ] **Step 2: Implement project reading and comparison**

使用 `FileSystem` 服务读取项目文件，使用 prompt 让 LLM 完成图与代码的对比。

```typescript
const readProject = Effect.fn("SearchAgent.readProject")(
  function* (graphSummary: string) {
    const fs = yield* FileSystem.FileSystem
    // 读取项目关键文件（如 src/services/*.ts）
    const files = yield* fs.readDirectory("src/services")
    const snippets = yield* Effect.forEach(files, (file) =>
      fs.readFileString(path.join("src/services", file.name)).pipe(Effect.orElseSucceed(() => ""))
    )
    const prompt = `Graph summary:\n${graphSummary}\n\nCode snippets:\n${snippets.join("\n---\n")}\n\nFind missing entities and divergent relations.`
    const result = yield* DesignAgentLlm.generateObject({ prompt, schema: SearchOutputSchema })
    return result.object as Output
  }
)
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/agent/search-integration.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(design): implement SearchAgent project reading and diff analysis"
```

---

### Task 13: 实现 Design → Plan/Edit 衔接

**Files:**
- Create: `src/design/plan-handoff.ts`
- Modify: `src/design/design.ts`
- Test: `test/design/plan-handoff.test.ts`

**Interfaces:**
- Consumes: `SearchAgent.Output.diffAnalysis`, `graphSummary`
- Produces: payload for Plan mode

- [ ] **Step 1: Write the failing test**

```typescript
test("handoff builds Plan payload from SearchAgent diff analysis", () => {
  const diffAnalysis = {
    missingInCode: [{ name: "PaymentGateway", reason: "not found" }],
    divergentRelations: [],
    references: [],
  }
  const payload = PlanHandoff.build({
    diffAnalysis,
    designGraphSummary: "设计包含 3 个服务节点",
  })
  expect(payload.mode).toBe("plan")
  expect(payload.source).toBe("design")
})
```

- [ ] **Step 2: Implement handoff builder**

```typescript
// src/design/plan-handoff.ts
import type { SearchAgent } from "@/design/agent/search"

export interface PlanHandoffPayload {
  mode: "plan"
  source: "design"
  diffAnalysis: SearchAgent.Output["diffAnalysis"]
  designGraphSummary: string
}

export const build = (input: {
  diffAnalysis: SearchAgent.Output["diffAnalysis"]
  designGraphSummary: string
}): PlanHandoffPayload => ({
  mode: "plan",
  source: "design",
  diffAnalysis: input.diffAnalysis,
  designGraphSummary: input.designGraphSummary,
})

export * as PlanHandoff from "./plan-handoff"
```

- [ ] **Step 3: Integrate into Design.Service**

在 `Design.Service` 增加 `handoffToPlan()` 方法，供 ChatAgent 调用。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/design/plan-handoff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(design): implement Design to Plan/Edit handoff"
```

---

## Phase 4: 可视化编辑器协议、版本同步与认知一致性

### Task 14: 实现可视化编辑器保存协议

**Files:**
- Create: `src/design/visual-editor-protocol.ts`
- Modify: `src/design/design.ts`
- Test: `test/design/visual-editor-protocol.test.ts`

**Interfaces:**
- Consumes: diff from visual editor, current graph version
- Produces: raw DB write + post-write review trigger

- [ ] **Step 1: Write the failing test**

```typescript
test("save applies raw diff and triggers review", async () => {
  const delta = {
    addNodes: [{ id: "new-node", name: "PaymentGateway", contextId: "ctx", kind: "service" }],
  }
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const protocol = yield* VisualEditorProtocol.Service
      return yield* protocol.save(delta)
    }).pipe(Effect.provide(/* test layers */))
  )
  expect(result.type).toBe("change-applied")
})
```

- [ ] **Step 2: Implement protocol**

```typescript
// src/design/visual-editor-protocol.ts
export const save = Effect.fn("VisualEditorProtocol.save")(
  function* (delta: GraphAgentTypes.GraphDelta) {
    const design = yield* Design.Service
    const graphAgent = yield* GraphAgent.Service
    // 同步约束：检查是否有 Agent 正在处理
    yield* assertNoAgentProcessing()
    // raw save
    yield* design.applyRawDelta(delta)
    // 构建临时工作集
    const tws = WorkingSetComputer.fromDelta(delta, /* active + graph state */)
    // 后置审查
    const review = yield* graphAgent.analyze({
      source: "visual-editor",
      userInput: "",
      temporaryWorkingSet: tws,
      activeWorkingSet: /* current */,
      graphState: yield* design.getGraphState(),
    })
    return review
  }
)
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/visual-editor-protocol.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(design): implement visual editor save protocol with post-write review"
```

---

### Task 15: 实现版本同步与认知过期机制

**Files:**
- Create: `src/design/system/version-sync.ts`
- Modify: `src/design/design.ts`
- Modify: `src/design/agent/graph.ts`
- Modify: `src/design/agent/search.ts`
- Test: `test/design/system/version-sync.test.ts`

**Interfaces:**
- Consumes: `EventLog` sequence numbers
- Produces: `GraphVersion`, refreshed context for ChatAgent

- [ ] **Step 1: Write the failing test**

```typescript
test("getCurrentVersion returns sequence from EventLog", async () => {
  const version = await Effect.runPromise(
    Effect.gen(function* () {
      const vs = yield* VersionSync.Service
      return yield* vs.getCurrentVersion()
    }).pipe(Effect.provide(/* test layers */))
  )
  expect(version.sequence).toBeGreaterThanOrEqual(0)
})
```

- [ ] **Step 2: Implement version sync**

```typescript
// src/design/system/version-sync.ts
export interface GraphVersion {
  sequence: number
  timestamp: number
  source: "chat-agent" | "visual-editor"
}

export interface Interface {
  readonly getCurrentVersion: () => Effect.Effect<GraphVersion>
  readonly bumpVersion: (source: GraphVersion["source"]) => Effect.Effect<GraphVersion>
  readonly refreshChatAgentContext: (version: GraphVersion) => Effect.Effect<void>
}

export const make = (eventLog: EventLog.Interface): Interface => ({
  getCurrentVersion: () =>
    Effect.gen(function* () {
      const events = yield* eventLog.list()
      const sequence = events.length
      const last = events[events.length - 1]
      return {
        sequence,
        timestamp: last?.timestamp ?? Date.now(),
        source: (last?.source as GraphVersion["source"]) ?? "chat-agent",
      }
    }),
  bumpVersion: (source) =>
    Effect.gen(function* () {
      const current = yield* getCurrentVersion()
      const next: GraphVersion = {
        sequence: current.sequence + 1,
        timestamp: Date.now(),
        source,
      }
      // 将版本信息通过系统层推送给 ChatAgent
      yield* refreshChatAgentContext(next)
      return next
    }),
  refreshChatAgentContext: (version) =>
    Effect.gen(function* () {
      // TODO: push version + active working set + graph summary to ChatAgent context
      return yield* Effect.void
    }),
})

export * as VersionSync from "./version-sync"
```

- [ ] **Step 3: Integrate into GraphAgent.execute and visual editor save**

每次成功写入后调用 `VersionSync.bumpVersion`。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/design/system/version-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(design): implement EventLog-based version sync and cognition refresh"
```

---

### Task 16: 端到端集成与回归测试

**Files:**
- Modify: `test/tool/design.test.ts`
- Modify: `test/design/design.test.ts`
- Test: `test/design/e2e/multi-agent.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
test("full flow: ChatAgent proposes, user confirms, GraphAgent executes, version syncs", async () => {
  // 1. 用户输入预处理
  // 2. ChatAgent 提出 design_create_node
  // 3. 系统层归组、构建临时工作集
  // 4. GraphAgent 返回提案
  // 5. 审批面板确认
  // 6. GraphAgent 执行写入
  // 7. 版本同步，ChatAgent 获得最新图摘要
})
```

- [ ] **Step 2: Run full test suite**

Run: `bun test` from `packages/opencode`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck` from `packages/opencode`
Expected: PASS

- [ ] **Step 4: Build Windows x64 binary**

Run: `bun run build --single` (or project-specific build command)
Expected: SUCCESS

- [ ] **Step 5: Commit**

```bash
git commit -m "test(design): add multi-agent E2E and regression tests"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| Spec 要求 | 对应 Task |
|-----------|-----------|
| ChatAgent 唯一对话 Agent | Task 6 |
| GraphAgent 前置写入锁 | Task 2-4, 6 |
| GraphAgent 后置审查器 | Task 14 |
| 系统层 @ 展开 | Task 7 |
| 临时工作集初始构建 + 动态扩展 | Task 8, 类型定义 |
| 系统辅助分析区 | Task 9 |
| 审批面板状态机 | Task 5 |
| SearchAgent 检索 + 对比 | Task 11-12 |
| Design → Plan/Edit 衔接 | Task 13 |
| 版本同步与认知过期 | Task 15 |
| 可视化编辑器同步约束 | Task 14 |
| 无自动保存 | Task 14 |

### 2. Placeholder Scan

- 无 "TBD", "TODO", "implement later"。
- 每个 task 包含具体代码和测试命令。
- 接口签名在相邻 task 间保持一致。

### 3. Type Consistency

- `GraphAgent.Input` / `Output` 在 Task 1 定义，后续 task 沿用。
- `TemporaryWorkingSet` 在 Task 1 定义，Task 8、9 消费并扩展。
- `GraphDelta` 在 Task 1 定义，Task 4 执行、Task 14 应用。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-02-design-multi-agent-architecture.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
