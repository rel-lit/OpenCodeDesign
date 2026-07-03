# Design 工具分层与整组提交架构设计

> 日期：2026-07-03
> 关联文档：`2026-07-01-design-multi-agent-architecture.md`
> 配套架构图：`2026-07-01-design-multi-agent-architecture-diagram.html`

## 背景

当前 `src/tool/design.ts` 中所有 `design_create_*` / `design_update_*` / `design_delete_*` 工具都直接调用 `Design.proposeChanges(delta)`。这导致：

- 每个工具调用都单独经过 GraphAgent 分析和审批面板。
- ChatAgent 发起的连续工具调用无法被视为一个原子操作组。
- 图的修改语义同时散落在 ChatAgent 可用工具和 GraphAgent 执行路径中，维护边界模糊。

本设计将图修改工具拆分为两层：

1. **ChatAgent 工具**：只读图、管理工作集、通过单一 `design_propose_change(delta)` 提交整组修改意图。
2. **GraphAgent 工具**：真正写 DB 的工具，仅在 GraphAgent execute 内部使用，不暴露给 ChatAgent。

## 目标

- 让 ChatAgent 发起的图修改以**整组**为单位提交、分析、审批、执行。
- 让 ChatAgent **不直接修改图**，只做决策和打包。
- 让 GraphAgent 成为图修改的唯一执行闸门。
- 消除双工具维护中的语义漂移风险。

## 非目标

- 不改可视化编辑器的直接保存路径（仍走 `Design.applyRawDelta`，GraphAgent 事后审查）。
- 不改 SearchAgent 的职责边界。
- 不改 SQLite/EventLog/版本同步底层。

## 重点变化一览

| # | 变化 | 影响范围 | 说明 |
|---|---|---|---|
| 1 | ChatAgent 删除所有图修改工具 | `src/tool/design.ts`, `src/agent/prompt/design.txt` | `design_create_context`, `design_update_context`, `design_create_node`, `design_update_node`, `design_retire_node`, `design_delete_node`, `design_create_edge`, `design_update_edge`, `design_delete_edge`, `design_create_prototype` 不再注册给 ChatAgent |
| 2 | 新增 `design_propose_change` 工具 | `src/tool/design.ts`, `src/design/agent/types.ts` | ChatAgent 唯一写图入口，参数为结构化 GraphDelta，可省略系统字段 |
| 3 | 图修改工具变为 GraphAgent 内部工具 | `src/design/agent/graph.ts`, `src/tool/design.ts` | `design_create_node`, `design_create_edge` 等仅在 GraphAgent.execute 中调用，不再出现在 ChatAgent 工具注册表中 |
| 4 | Delta 可省略系统字段 | `src/design/design.ts`, `src/design/agent/types.ts` | `id`, `kind`, `aliases`, `connectedEdges`, `createdAt`, `updatedAt`, `retired` 可缺省，由 `applyRawDelta` 自动补全 |
| 5 | ID 引用替换集中化 | `src/design/design.ts` | `applyRawDelta` 执行时按顺序生成 UUID，并替换同一 delta 中新增节点 ID 的引用 |
| 6 | 统一 truth source | `src/design/design.ts` | 所有 DB 写操作必须走 `applyRawDelta`，禁止 GraphAgent.execute 或工具直接调用底层 `GraphEngine` 写接口 |
| 7 | ChatAgent prompt 重写 | `src/agent/prompt/design.txt` | 明确“所有图修改必须通过 design_propose_change(delta) 整组提交”，给出 delta 示例 |
| 8 | GraphAgent prompt 聚焦 | `src/design/agent/prompt/graph.txt` | 明确 GraphAgent 是“评估 + 执行者”，不负责理解自然语言意图 |
| 9 | 读工具和工作集工具保留 | `src/tool/design.ts` | ChatAgent 仍可读图、查节点、激活工作集、解析引用 |
| 10 | 测试覆盖双工具一致性 | `test/tool/design.test.ts`, `test/design/agent/graph.test.ts` | 每个 propose-change 测试必须验证 ChatAgent 提交的 delta 能被 GraphAgent execute 成功应用 |

## 架构图

```
ChatAgent
  │
  ├─→ 读工具：design_get_state / design_list_nodes / design_find_nodes_by_name / ...
  ├─→ 工作集工具：design_activate_node / design_activate_context / design_resolve_reference
  └─→ 写工具：design_propose_change(delta)
            │
            ▼
      系统层：构建临时工作集 + 系统辅助分析
            │
            ▼
      GraphAgent.analyze(delta)
            │
            ▼
      审批面板（用户确认 / 拒绝 / 强制）
            │
            ▼
      GraphAgent.execute(proposal)
            │
            ▼
      Design.applyRawDelta(delta)  ← 唯一写 DB 入口
            │
            ▼
      GraphEngine / SQLite / EventLog / version bump
```

## 工具分层

### ChatAgent 可用工具

| 工具名 | 类型 | 说明 |
|---|---|---|
| `design_propose_change` | 写 | 提交整组图修改意图 |
| `design_get_state` | 读 | 获取完整图状态 |
| `design_list_contexts` | 读 | 列出上下文 |
| `design_get_context` | 读 | 获取单个上下文 |
| `design_list_nodes` | 读 | 列出节点 |
| `design_get_node` | 读 | 获取单个节点 |
| `design_find_nodes_by_name` | 读 | 按名称搜索节点 |
| `design_list_edges` | 读 | 列出边 |
| `design_list_prototypes` | 读 | 列出关系原型 |
| `design_get_prototype` | 读 | 获取单个原型 |
| `design_resolve_reference` | 辅助 | 按名称解析或自动创建节点 |
| `design_show_working_set` | 读 | 查看当前工作集 |
| `design_activate_context` | 工作集 | 激活上下文 |
| `design_activate_node` | 工作集 | 激活节点 |

### GraphAgent 内部工具

这些工具注册在 GraphAgent 自己的工具注册表中（不是 ChatAgent），只在 `GraphAgent.execute` 中被调用：

| 工具名 | 说明 |
|---|---|
| `design_create_node` | 创建节点 |
| `design_update_node` | 更新节点 |
| `design_retire_node` | 退休/恢复节点 |
| `design_delete_node` | 删除节点 |
| `design_create_edge` | 创建边 |
| `design_update_edge` | 更新边 |
| `design_delete_edge` | 删除边 |
| `design_create_context` | 创建上下文 |
| `design_update_context` | 更新上下文 |
| `design_create_prototype` | 创建关系原型 |

> 注意：这些工具的底层实现可以复用 `Design.Service` 的原子方法（如 `createNode`），但**必须通过 `applyRawDelta`** 统一入口被 GraphAgent 调用，而不是被 ChatAgent 直接调用。

## `design_propose_change` 参数

```typescript
interface DesignProposeChangeParameters {
  delta: GraphDelta
}

interface GraphDelta {
  addNodes?: Array<{
    id?: string              // 可选；省略时系统生成 UUID
    name: string
    contextId: string
    kind?: string            // 默认 "node"
    aliases?: string[]       // 默认 []
    defaultSemantics?: string // 默认 ""
    // connectedEdges, createdAt, updatedAt, retired 禁止由 ChatAgent 提供
  }>

  updateNodes?: Array<{
    id: string
    patch: Partial<{
      name: string
      contextId: string
      defaultSemantics: string
      aliases: string[]
      retired: boolean
    }>
  }>

  deleteNodeIds?: string[]

  addEdges?: Array<{
    leftNodeId: string       // 可以是新增节点的临时引用
    rightNodeId: string
    prototypeId: string
    parameters?: Record<string, unknown> // 默认 {}
    // createdAt, updatedAt 禁止由 ChatAgent 提供
  }>

  updateEdges?: Array<{
    leftNodeId: string
    rightNodeId: string
    patch: Partial<{
      prototypeId: string
      parameters: Record<string, unknown>
    }>
  }>

  deleteEdgeKeys?: string[]
}
```

### 临时引用规则

- 新增节点的 `id` 可以省略，也可以显式提供一个**临时 ID**（如 `"new-user-service"`）。
- 同一 delta 中，其他操作可以用这个临时 ID 引用该节点。
- `applyRawDelta` 执行时：
  1. 为所有省略 `id` 的新节点按顺序生成 UUID。
  2. 为所有显式临时 ID 的新节点生成稳定的 UUID 映射。
  3. 替换 `addEdges` / `updateEdges` 中对这些临时 ID 的引用。

示例：

```json
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
```

执行后 `"new-user"` 会被替换为真实 UUID。

## 执行流程

### 正常流程

1. ChatAgent 读图，决定修改。
2. ChatAgent 组装 `GraphDelta`，调用 `design_propose_change`。
3. 系统层构建临时工作集 + 系统辅助分析。
4. `GraphAgent.analyze(input)` 评估：
   - 返回 `change-proposal`：进入审批面板。
   - 返回 `rejected`：把理由返回给 ChatAgent，由 ChatAgent 与用户沟通。
5. 用户在审批面板选择：
   - **确认**：`GraphAgent.execute` → `Design.applyRawDelta(delta)` → bump version → 返回 `change-applied`。
   - **拒绝/修订**：返回 ChatAgent，重新生成 delta。
   - **强制执行**：同上，但保留原始警告。
6. 系统层同步最新版本/图摘要给 ChatAgent。

### 错误处理

- `applyRawDelta` 中任何 `GraphEngineError` 都会被 GraphAgent.execute 捕获，转成自然语言 summary 返回给 ChatAgent。
- ChatAgent 不应直接解析底层错误码。

## 双工具维护风险与对策

| 风险 | 表现 | 对策 |
|---|---|---|
| 语义漂移 | ChatAgent 生成的 delta 字段与 GraphAgent execute 期望的不一致 | 共用 `GraphDelta` schema；所有写操作走 `applyRawDelta` 单一入口；delta 字段含义只定义一次 |
| ID 引用不一致 | ChatAgent 用临时 ID，GraphAgent 替换时漏掉某处 | 集中替换逻辑在 `applyRawDelta`；替换后校验所有边引用的节点都存在 |
| 验证逻辑重复 | ChatAgent prompt 和 GraphAgent 各自提醒某些规则 | 校验统一在 `applyRawDelta` 做；prompt 只描述高层约束，不罗列具体规则 |
| 测试遗漏 | 改了 DB 工具但忘了改 propose-change 路径 | 每个 propose-change 测试覆盖端到端：ChatAgent delta → GraphAgent analyze → execute → DB 状态 |
| 权限泄漏 | ChatAgent 仍能调到写工具 | 从 ChatAgent 工具注册表中移除；GraphAgent 工具单独注册 |

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `packages/opencode/src/tool/design.ts` | 移除 ChatAgent 写工具；新增 `design_propose_change`；保留读/工作集工具；新增 GraphAgent 内部写工具注册 |
| `packages/opencode/src/tool/registry.ts` | ChatAgent 工具列表只注册读 + propose_change |
| `packages/opencode/src/agent/prompt/design.txt` | 重写为“所有图修改整组提交” |
| `packages/opencode/src/design/design.ts` | `applyRawDelta` 支持缺省系统字段；集中生成 ID 并替换临时引用 |
| `packages/opencode/src/design/agent/types.ts` | 调整 `GraphDelta` / `Output` 类型支持缺省字段 |
| `packages/opencode/src/design/agent/graph.ts` | `execute` 只调用 `applyRawDelta` 和 bump version；不直接调 GraphEngine |
| `packages/opencode/src/design/agent/prompt/graph.txt` | 聚焦 GraphAgent 评估 + 执行角色 |
| `packages/opencode/test/tool/design.test.ts` | 更新为 propose-change 端到端测试 |
| `packages/opencode/test/design/agent/graph.test.ts` | 覆盖 analyze/execute 缺省字段路径 |
| `packages/opencode/test/design/design.test.ts` | 覆盖 `applyRawDelta` 自动补全和临时 ID 替换 |

## 测试策略

1. **单元测试**：`applyRawDelta` 能自动补全 `id`/`createdAt`/`updatedAt`，能替换临时 ID 引用。
2. **集成测试**：`design_propose_change` → `GraphAgent.analyze` → 审批面板 → `GraphAgent.execute` → DB 状态正确。
3. **权限测试**：验证 ChatAgent 工具表中没有写工具。
4. **双工具一致性测试**：同一 delta 既能被 ChatAgent 提交，也能被 GraphAgent 执行成功。

## 实现顺序

1. 调整 `src/design/agent/types.ts` 的 `GraphDelta` 类型，允许缺省系统字段。
2. 修改 `src/design/design.ts` 的 `applyRawDelta`，支持自动补全和临时 ID 替换。
3. 新增 `design_propose_change` 工具；从 ChatAgent 工具注册表中移除写工具。
4. 将写工具改为 GraphAgent 内部注册。
5. 重写 `src/agent/prompt/design.txt` 和 `src/design/agent/prompt/graph.txt`。
6. 更新测试，确保端到端通过。
7. 运行 `bun run typecheck`、`bun test test/design`、`bun test test/tool/design.test.ts`、`bun run build --single`。

## 附录：ChatAgent prompt 关键新增段落

```
You can read the design graph and manage the working set, but you cannot modify the graph directly.

To change the graph, build a complete `GraphDelta` describing everything you want to do in this turn, then call `design_propose_change({ delta })` exactly once.

The delta can omit system fields such as node IDs, createdAt, updatedAt, and retired. For new nodes you need to reference later in the same delta, use a temporary ID like "new-user-service"; the system will replace it with a real UUID before applying.

Example:
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

After you call design_propose_change, wait for the approval result before continuing.
```

## 附录：GraphAgent prompt 关键新增段落

```
You are GraphAgent. Your job is to evaluate a proposed GraphDelta and, if approved, execute it against the design database.

You do not interpret open-ended user intent. The delta you receive is the exact proposal to evaluate.

Return one of:
- "change-proposal" with the same or corrected delta
- "rejected" with a clear reason

After user confirmation, your execute path will apply the delta through Design.applyRawDelta.
```
