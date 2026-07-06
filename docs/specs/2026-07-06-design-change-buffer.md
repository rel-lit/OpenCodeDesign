# Design 修改缓冲区与原子提交规格

> 日期：2026-07-06
> 状态：规范 / 讨论中

## 背景与问题

当前 Design 模式的写入工具存在不一致：

1. **部分写操作直接持久化到图**：`design_define_relation_prototype` 直接调用 `Design.createPrototype`，立即写入数据库，不经过缓冲区。
2. **部分写操作进入缓冲区**：context、concept、edge 的增删改通过 `ChangeAccumulator` 累积，等待终稿审批。
3. **缓冲区没有操作历史**：`ChangeAccumulator` 只维护一个扁平的 `GraphDelta`，无法按单次操作撤销。

这导致：
- 终稿审批的 "Abandon" 无法撤回已直接持久化的 prototype。
- 用户在终稿选择 "Revise" 时，GraphAgent 无法精确撤回缓冲区中的某次操作（例如"关系原型太多"时只能删边，不能删 prototype，因为 prototype 没进缓冲区）。
- 所有修改不是原子化的，用户拒绝或放弃变更时，设计图可能处于部分修改状态。

## 设计目标

- **所有会修改设计图的操作都必须先进入 Design Change Buffer（修改缓冲区）**，只有终稿审批用户点击 Approve 后才原子化提交到数据库。
- **缓冲区维护可操作、可查询、可撤销的操作日志**。
- **GraphDelta 只是缓冲区派生出的提交视图**，不是缓冲区内部模型。
- **查询工具返回操作列表**，GraphAgent 可以随时查看当前缓冲区中的待提交操作。
- **撤销工具按 operation ID 精确移除缓冲区中的某次操作**。
- **提交操作是原子的**：终稿 Approve 时一次性 apply，终稿 Abandon 时一次性清空，不存在中间落库状态。
- **提交后的修改不可单独删除**：已提交的修改进入设计图历史，只能通过新的变更反向操作。

## 核心原则

| 原则 | 说明 |
|---|---|
| 写操作一律缓冲 | 任何修改设计图的操作都不直接落库 |
| 操作可查询 | GraphAgent 可以列出缓冲区中的操作 |
| 操作可撤销 | GraphAgent 可以按 ID 撤销缓冲区中的操作 |
| 依赖受限 | 撤销一个操作时，如果存在依赖它的后续操作，默认拒绝并提示 |
| 原子提交 | 只有终稿 Approve 才把所有缓冲操作持久化 |
| 原子放弃 | 终稿 Abandon 时清空所有缓冲操作，数据库不受影响 |
| 提交后不可单独回滚 | 已提交的修改进入设计图历史，只能通过新的变更反向操作 |

## 两个层面的操作

必须区分以下两个层面：

### 层面 1：对设计图的内容操作（Content Operation）

这些操作描述的是"用户希望设计图变成什么样"。它们进入 `Design Change Buffer`，终稿 Approve 后才会真正写入数据库。

| 类型 | 对应工具 | 含义 |
|---|---|---|
| `create_context` | `design_define_context` | 设计图中新增一个限界上下文 |
| `update_context` | （未来） | 设计图中更新一个限界上下文 |
| `delete_context` | （未来） | 设计图中删除一个限界上下文 |
| `create_node` | `design_define_concept` | 设计图中新增一个概念 |
| `update_node` | `design_refine_concept` | 设计图中更新一个概念 |
| `delete_node` | `design_withdraw_concept` | 设计图中删除一个概念 |
| `create_edge` | `design_relate_concepts` | 设计图中新增一条关系 |
| `update_edge` | `design_relate_concepts`（更新） | 设计图中更新一条关系 |
| `delete_edge` | `design_withdraw_relation` | 设计图中删除一条关系 |
| `create_prototype` | `design_define_relation_prototype` | 设计图中新增一个关系原型 |
| `update_prototype` | `design_define_relation_prototype`（同名更新） | 设计图中更新一个关系原型 |
| `delete_prototype` | （未来） | 设计图中删除一个关系原型 |

**关键**：`delete_context`、`delete_node`、`delete_edge`、`delete_prototype` 等内容操作，表示的是**设计图层面的删除意图**。它们进入缓冲区，不会立即删除数据库中的任何内容。

### 层面 2：对缓冲区的控制操作（Buffer Control Operation）

这些操作不描述设计图变更，只管理缓冲区本身。它们**不会**进入缓冲区作为内容操作，而是直接作用于缓冲区的操作列表。

| 工具 | 含义 |
|---|---|
| `design_list_buffer_operations` | 查看当前缓冲区中的内容操作列表 |
| `design_undo_buffer_operation` | 从缓冲区中移除某条内容操作 |

**关键**：`design_undo_buffer_operation` 不是设计图变更。它只是把缓冲区里的一条**待执行计划**移除。例如：
- 缓冲区里有内容操作 `delete_context "战斗系统"`（表示用户希望删除这个 context）
- GraphAgent 调用 `design_undo_buffer_operation({ operation_id: "op-1" })`
- 结果是缓冲区里不再有 `delete_context "战斗系统"` 这条待执行计划
- 数据库中的 "战斗系统" context 完全没有被触碰

> **重要区分**：
> - `delete_context` / `delete_node` / `delete_edge` / `delete_prototype` 等内容操作，表示**设计图层面的删除意图**，会进入缓冲区等待提交。
> - `design_undo_buffer_operation` 是缓冲区控制工具，表示**撤回缓冲区里的一条待执行计划**，不进入缓冲区，也不会直接修改数据库。

## 命名调整

| 旧命名 | 新命名 |
|---|---|
| `ChangeAccumulator` | `DesignChangeBuffer` |
| `accumulator` | `buffer` |
| `addAccumulatedNode` | `bufferAddOperation` |
| `getPendingDelta` | `bufferGetDelta` |
| `applyAccumulatedChanges` | `bufferApply` |
| `clearAccumulatedChanges` | `bufferClear` |
| `getAccumulatedGraphState` | `bufferGetMergedState` |

## 操作类型

### 内容操作（Content Operation）

缓冲区支持的内容操作类型：

| 类型 | 对应工具 | 说明 |
|---|---|---|
| `create_context` | `design_define_context` | 设计图中新增限界上下文 |
| `create_node` | `design_define_concept` | 设计图中新增概念 |
| `update_node` | `design_refine_concept` | 设计图中更新概念 |
| `delete_node` | `design_withdraw_concept` | 设计图中删除概念 |
| `create_edge` | `design_relate_concepts` | 设计图中新增关系 |
| `update_edge` | `design_relate_concepts`（更新） | 设计图中更新关系 |
| `delete_edge` | `design_withdraw_relation` | 设计图中删除关系 |
| `create_prototype` | `design_define_relation_prototype` | 设计图中新增关系原型 |
| `update_prototype` | `design_define_relation_prototype`（同名更新） | 设计图中更新关系原型 |

未来可扩展：
- `update_context`
- `delete_context`
- `delete_prototype`

### 缓冲区控制操作（Buffer Control Operation）

这些操作不进入缓冲区，只用于管理缓冲区本身：

| 工具 | 说明 |
|---|---|
| `design_list_buffer_operations` | 查看当前缓冲区中的内容操作列表 |
| `design_undo_buffer_operation` | 从缓冲区中移除某条内容操作 |

## 后端设计

### `DesignChangeBuffer` 接口

```ts
export interface BufferOperation {
  id: string
  // 内容操作类型：描述设计图将如何变更
  type:
    | "create_context" | "update_context" | "delete_context"
    | "create_node" | "update_node" | "delete_node"
    | "create_edge" | "update_edge" | "delete_edge"
    | "create_prototype" | "update_prototype" | "delete_prototype"
  description: string
  payload: unknown
}

export interface DesignChangeBuffer {
  readonly listOperations: (sessionID: string) => Effect.Effect<BufferOperation[]>
  readonly addOperation: (sessionID: string, operation: Omit<BufferOperation, "id">) => Effect.Effect<BufferOperation>
  readonly undoOperation: (sessionID: string, operationId: string) => Effect.Effect<void, BufferError>
  readonly getDelta: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly apply: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly clear: (sessionID: string) => Effect.Effect<void>
  readonly getMergedState: (sessionID: string) => Effect.Effect<DesignTypes.GraphState>
}
```

实现要点：
- 内部维护 `Map<sessionID, BufferOperation[]>`。
- `listOperations` 返回当前有效操作列表。
- `addOperation` 向缓冲区添加一个操作，返回带 ID 的操作。
- `undoOperation` 检查依赖关系：
  - 如果存在后续操作依赖该操作，返回 `BufferError` 并说明依赖。
  - 否则从列表中移除该操作。
- `getDelta` 从当前有效操作列表派生 `GraphDelta`，**仅用于展示/提交**，不作为内部状态存储。
- `apply` 返回当前有效操作派生的 `GraphDelta`，并清空该 session 的操作列表。
- `clear` 清空该 session 的操作列表。
- `getMergedState` 把缓冲区中的有效操作重放到当前图状态上，生成预览状态。

### 依赖检查规则

| 被撤销操作 | 依赖该操作的后续操作示例 | 处理方式 |
|---|---|---|
| `create_node A` | `create_edge A->B`、`update_node A`、`delete_node A` | 拒绝撤销，提示先撤销依赖 |
| `create_context C` | `create_node` 引用了 C | 拒绝撤销，提示先撤销依赖 |
| `create_prototype P` | `create_edge` 使用了 P | 拒绝撤销，提示先撤销依赖 |
| `create_edge A->B` | 无（边不会被其他操作依赖） | 允许撤销 |
| `delete_node A` | 无 | 允许撤销 |

### `Design.Service` 更新

移除直接持久化的 prototype 创建，改为缓冲区操作：

```ts
readonly bufferAddOperation: (sessionID: string, operation: Omit<GraphAgentTypes.BufferOperation, "id">) => Effect.Effect<GraphAgentTypes.BufferOperation>
readonly bufferListOperations: (sessionID: string) => Effect.Effect<GraphAgentTypes.BufferOperation[]>
readonly bufferUndoOperation: (sessionID: string, operationId: string) => Effect.Effect<void, BufferError>
readonly bufferGetDelta: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
readonly bufferApply: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
readonly bufferClear: (sessionID: string) => Effect.Effect<void>
readonly bufferGetMergedState: (sessionID: string) => Effect.Effect<DesignTypes.GraphState>
```

逐步移除旧的 `addAccumulatedNode` / `updateAccumulatedNode` 等方法。

### GraphDelta 的定位

`GraphDelta` 只是提交前/提交时的**派生视图**，用途：
1. `design_finalize_change` 展示终稿差异。
2. `applyRawDelta` 接收并持久化。

它不是缓冲区的内部模型，也不单独持久化。缓冲区内部只存 `BufferOperation[]`。

### 工具更新

#### `design_define_relation_prototype`

从直接持久化改为缓冲区：

```ts
const proto = yield* design.bufferAddOperation(ctx.sessionID, {
  type: "create_prototype",
  description: `Define relation prototype "${args.name}"`,
  payload: {
    name: args.name,
    defaultSemantics: args.semantics,
    parameterSchema: args.constraints,
  },
})
```

返回：

```ts
{
  title: `Defined prototype ${args.name}`,
  output: `Prototype ${args.name} queued for creation`,
  metadata: { operationId: proto.id },
}
```

#### 其他写工具

统一改为 `bufferAddOperation`，不再直接调用 `Design.createNode` / `createEdge` 等。

### 新增工具

#### `design_list_buffer_operations`

返回当前缓冲区中的所有待提交操作：

```ts
{
  operations: [
    { id: "op-1", type: "create_context", description: "Define context '影界行者'" },
    { id: "op-2", type: "create_node", description: "Define concept '影行者' in context '影界行者'" },
    { id: "op-3", type: "create_prototype", description: "Define relation prototype '穿梭于'" },
    { id: "op-4", type: "create_edge", description: "Relate '影行者' --[穿梭于]--> '影界'" },
  ]
}
```

#### `design_undo_buffer_operation`

参数：

```ts
{
  operation_id: string
}
```

行为：
- 如果该 operation 存在依赖，返回错误：
  ```ts
  {
    title: "Cannot undo operation",
    output: "Operation 'op-3' is referenced by later operations: op-4. Undo those first.",
    metadata: { blockedBy: ["op-4"] }
  }
  ```
- 否则移除该 operation，返回成功。

### `bufferApply` 原子提交

终稿审批 Approve 时：

1. 从缓冲区获取当前有效操作列表。
2. 派生 `GraphDelta`。
3. 在数据库事务中执行 `applyRawDelta`。
4. 为每个操作追加事件日志条目（`node_created`、`edge_created`、`prototype_created` 等）。
5. bump 版本号。
6. 清空缓冲区。
7. 返回成功。

终稿审批 Abandon 时：

1. 清空缓冲区。
2. 数据库不受影响。
3. 返回成功。

## 前端设计

无变化。终稿审批面板继续展示 `design_finalize_change` 的内容。

## Prompt 更新

### `packages/opencode/src/design/agent/prompt/graph.txt`

1. 明确所有写工具都进入 Design Change Buffer，不立即落库。
2. 新增 `design_list_buffer_operations` 到可用工具列表。
3. 新增 `design_undo_buffer_operation` 到可用工具列表。
4. refine 阶段说明：
   - 每次写工具调用都会向缓冲区添加一个 operation。
   - 可以通过 `design_list_buffer_operations` 查看当前所有待提交操作。
   - 如果需要撤回某个操作，使用 `design_undo_buffer_operation({ operation_id })`。
   - 如果存在依赖，先撤销依赖操作。
5. 终稿阶段说明：
   - Approve 时所有缓冲区操作原子提交。
   - Abandon 时所有缓冲区操作清空，数据库不受影响。
   - 提交后的操作不可单独回滚。

## 输出类型

终稿 Approve 后仍然返回 `"change-applied"` 或 `"change-forced"`。

`appliedChange` 中增加 `operations` 字段，列出实际提交的操作：

```ts
appliedChange: {
  version: number
  affectedNodes: string[]
  affectedEdges: string[]
  affectedContexts: string[]
  affectedPrototypes: string[]
  operations: BufferOperation[]
  summary: string
}
```

## 需要改动的文件

### 后端

- `packages/opencode/src/design/agent/types.ts`
  - 新增 `BufferOperation` 接口。
  - `GraphDelta` 保持不变，仅作为派生视图。

- `packages/opencode/src/design/system/change-accumulator.ts`
  - 重命名为 `design-change-buffer.ts`。
  - 重构为 `DesignChangeBuffer`。
  - 实现 `listOperations`、`addOperation`、`undoOperation`、`getDelta`。

- `packages/opencode/src/design/design.ts`
  - 新增 `bufferAddOperation`、`bufferListOperations`、`bufferUndoOperation`、`bufferGetDelta`、`bufferApply`、`bufferClear`、`bufferGetMergedState`。
  - 移除旧的 accumulator 方法。
  - `createPrototype` 不再被 GraphAgent 工具直接调用。

- `packages/opencode/src/tool/design.ts`
  - 所有写工具改为 `bufferAddOperation`。
  - `design_define_relation_prototype` 改为缓冲区。
  - 新增 `DesignListBufferOperationsTool`。
  - 新增 `DesignUndoBufferOperationTool`。
  - 更新 `GraphAgentDesignTools` 导出。

- `packages/opencode/src/agent/agent.ts`
  - 新增工具的权限：`design_list_buffer_operations: "allow"`、`design_undo_buffer_operation: "allow"`。

### Prompt

- `packages/opencode/src/design/agent/prompt/graph.txt`
  - 更新可用工具列表。
  - 更新 refine 阶段工作流。
  - 更新终稿阶段工作流。

### 测试

- `packages/opencode/test/tool/graph-agent-design.test.ts`
  - 验证 `design_define_relation_prototype` 进入缓冲区不直接落库。
  - 验证 `design_list_buffer_operations` 返回操作列表。
  - 验证 `design_undo_buffer_operation` 撤销操作。
  - 验证依赖检查。
  - 验证 `design_finalize_change` Approve 后原子提交。

## 关键约束

- 所有写操作必须进缓冲区，不能直接落库。
- 缓冲区操作必须有唯一 ID。
- 撤销操作必须检查依赖。
- 只有 `design_finalize_change` Approve 时才真正修改数据库。
- 提交后的操作不可单独回滚。
- 保持 `change-applied` / `change-forced` / `abandoned` / `rejected` 输出类型不变。

## 数据流示例

```
用户：设计一个船战系统
  → ChatAgent 调用 design_request_change
    → design-graph subagent (change 模式)
      → 阶段 1：分析、生成 Change Plan
      → 阶段 2：design_request_approval
        → 用户选择 Approve
      → 阶段 3：细化
        → design_define_context({ name: "战斗系统" })
          → buffer: [create_context "战斗系统"]
        → design_define_concept({ name: "船", context: "战斗系统" })
          → buffer: [..., create_node "船"]
        → design_define_relation_prototype({ name: "属于" })
          → buffer: [..., create_prototype "属于"]
        → design_relate_concepts({ from: "船", to: "战斗系统", relation: "属于" })
          → buffer: [..., create_edge 船--[属于]-->战斗系统]
        → 用户说"关系原型太多了"
        → design_list_buffer_operations
          → 返回所有操作
        → design_undo_buffer_operation({ operation_id: "属于"的ID })
          → 失败：因为 create_edge 依赖 create_prototype "属于"
        → design_undo_buffer_operation({ operation_id: create_edge 的 ID })
          → 成功
        → design_undo_buffer_operation({ operation_id: "属于"的ID })
          → 成功
      → 阶段 4：design_finalize_change
        → 用户选择 Approve
          → 原子提交缓冲区中剩余操作
          → 返回 change-applied
```

## 决策总结

| 决策 | 选择 |
|---|---|
| 写操作是否直接落库 | 否，全部进 Design Change Buffer |
| 缓冲区内部模型 | 操作日志 `BufferOperation[]` |
| GraphDelta 定位 | 派生提交视图，不是内部模型 |
| prototype 创建方式 | 进缓冲区 |
| 撤销依赖策略 | 默认 RESTRICT，提示先撤销依赖 |
| 提交方式 | 终稿 Approve 时原子化 apply |
| 放弃方式 | 终稿 Abandon 时清空缓冲区 |
| 提交后是否可回滚 | 否，只能通过新变更反向操作 |
| 是否影响输出类型 | 否，但 `appliedChange` 增加 operations 字段 |

## 待讨论问题

1. **撤销时是否支持 CASCADE？**
   - 当前规格默认 RESTRICT。
   - 可以考虑给 `design_undo_buffer_operation` 增加 `cascade: boolean` 参数。

2. **已提交操作的反向操作**
   - 如果用户提交后想"撤回"某个 prototype，需要新的 `withdraw_prototype` 工具。
   - 这属于提交后的修改，不走缓冲区，而是作为新的 change request。

3. **context 的删除**
   - 当前没有 `design_withdraw_context`。
   - 如果 context 被持久化后又想删除，需要新增工具。

4. **prototype 的删除**
   - 当前没有 `design_withdraw_relation_prototype`。
   - 缓冲区阶段可以撤销 `create_prototype` 操作。
   - 持久化后如果想删除，需要新增工具，遵循 RESTRICT/CASCADE 语义。

5. **并发问题**
   - 同一 session 的 buffer 是单线程的，由子代理独占。
   - 如果未来支持多个并行的 design change request，需要 session 隔离。

## 相关文档

- `docs/specs/2026-07-06-design-unified-change-mode.md`：统一 change mode 工作流，本规格是其细化。
- `docs/specs/2026-07-06-design-change-forced-output.md`：change-forced 输出类型。
- `docs/specs/2026-07-06-design-approval-timeline-rendering.md`：审批时间线渲染。
