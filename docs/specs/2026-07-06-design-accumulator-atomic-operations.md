# Design 缓冲区原子化提交与可撤销操作规格

> 日期：2026-07-06
> 状态：规范 / 待实现

## 背景与问题

当前 Design 模式的写入工具存在不一致：

1. **部分写操作直接持久化到图**：`design_define_relation_prototype` 直接调用 `Design.createPrototype`，立即写入数据库，不经过 accumulator。
2. **部分写操作进入 accumulator**：context、concept、edge 的增删改通过 `ChangeAccumulator` 累积，等待终稿审批。
3. **accumulator 没有操作历史**：`ChangeAccumulator` 只维护一个扁平的 `GraphDelta`，无法按单次操作撤销。

这导致：
- 终稿审批的 "Abandon" 无法撤回已直接持久化的 prototype。
- 用户在终稿选择 "Revise" 时，GraphAgent 无法精确撤回 accumulator 中的某次操作（例如"关系原型太多"时只能删边，不能删 prototype，因为 prototype 没进 accumulator）。
- 所有修改不是原子化的，用户拒绝或放弃变更时，设计图可能处于部分修改状态。

## 设计目标

- **所有会修改设计图的操作都必须先进入 accumulator**，只有终稿审批用户点击 Approve 后才原子化提交到数据库。
- **accumulator 维护可操作、可查询、可撤销的操作日志**。
- **查询工具返回操作列表**，GraphAgent 可以随时查看当前 accumulator 中的待提交操作。
- **撤销工具按 operation ID 精确移除 accumulator 中的某次操作**。
- **提交操作是原子的**：终稿 Approve 时一次性 apply，终稿 Abandon 时一次性清空，不存在中间落库状态。

## 核心原则

| 原则 | 说明 |
|---|---|
| 写操作一律缓冲 | 任何修改设计图的操作都不直接落库 |
| 操作可查询 | GraphAgent 可以列出 accumulator 中的操作 |
| 操作可撤销 | GraphAgent 可以按 ID 撤销 accumulator 中的操作 |
| 依赖受限 | 撤销一个操作时，如果存在依赖它的后续操作，默认拒绝并提示 |
| 原子提交 | 只有终稿 Approve 才把所有缓冲操作持久化 |
| 原子放弃 | 终稿 Abandon 时清空所有缓冲操作，数据库不受影响 |

## 操作类型

accumulator 支持的操作类型：

| 类型 | 对应工具 | 说明 |
|---|---|---|
| `create_context` | `design_define_context` | 新增限界上下文 |
| `create_node` | `design_define_concept` | 新增概念 |
| `update_node` | `design_refine_concept` | 更新概念 |
| `delete_node` | `design_withdraw_concept` | 删除概念 |
| `create_edge` | `design_relate_concepts` | 新增关系 |
| `update_edge` | `design_relate_concepts`（更新） | 更新关系 |
| `delete_edge` | `design_withdraw_relation` | 删除关系 |
| `create_prototype` | `design_define_relation_prototype` | 新增关系原型 |
| `update_prototype` | `design_define_relation_prototype`（同名更新） | 更新关系原型 |

未来可扩展：
- `delete_context`
- `delete_prototype`
- `update_context`

## 后端设计

### `ChangeAccumulator` 重构

当前接口：

```ts
export interface Interface {
  readonly getPendingDelta: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly addNode: (sessionID: string, input: GraphAgentTypes.NodeInput) => Effect.Effect<void>
  readonly updateNode: (sessionID: string, id: string, patch: Partial<GraphAgentTypes.NodeInput>) => Effect.Effect<void>
  readonly deleteNode: (sessionID: string, id: string) => Effect.Effect<void>
  readonly addEdge: (sessionID: string, input: GraphAgentTypes.EdgeInput) => Effect.Effect<void>
  readonly updateEdge: (sessionID: string, leftNodeId: string, rightNodeId: string, patch: Partial<GraphAgentTypes.EdgeInput>) => Effect.Effect<void>
  readonly deleteEdge: (sessionID: string, leftNodeId: string, rightNodeId: string) => Effect.Effect<void>
  readonly apply: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly clear: (sessionID: string) => Effect.Effect<void>
  readonly getMergedState: (sessionID: string) => Effect.Effect<DesignTypes.GraphState>
}
```

新接口：

```ts
export interface Operation {
  id: string
  type: "create_context" | "create_node" | "update_node" | "delete_node" |
         "create_edge" | "update_edge" | "delete_edge" |
         "create_prototype" | "update_prototype"
  description: string
  payload: unknown
}

export interface Interface {
  readonly listOperations: (sessionID: string) => Effect.Effect<Operation[]>
  readonly addOperation: (sessionID: string, operation: Omit<Operation, "id">) => Effect.Effect<Operation>
  readonly undoOperation: (sessionID: string, operationId: string) => Effect.Effect<void, AccumulatorError>
  readonly getPendingDelta: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly apply: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly clear: (sessionID: string) => Effect.Effect<void>
  readonly getMergedState: (sessionID: string) => Effect.Effect<DesignTypes.GraphState>
}
```

实现要点：
- 内部维护 `Map<sessionID, Operation[]>`。
- `getPendingDelta` 从当前有效操作列表派生 `GraphDelta`。
- `undoOperation` 检查依赖关系：
  - 如果存在后续操作依赖该操作，返回 `AccumulatorError` 并说明依赖。
  - 否则从列表中移除该操作。
- `apply` 返回当前有效操作派生的 `GraphDelta`，并清空该 session 的操作列表。
- `clear` 清空该 session 的操作列表。

### 依赖检查规则

| 被撤销操作 | 依赖该操作的后续操作示例 | 处理方式 |
|---|---|---|
| `create_node A` | `create_edge A->B`、`update_node A`、`delete_node A` | 拒绝撤销，提示先撤销依赖 |
| `create_context C` | `create_node` 引用了 C | 拒绝撤销，提示先撤销依赖 |
| `create_prototype P` | `create_edge` 使用了 P | 拒绝撤销，提示先撤销依赖 |
| `create_edge A->B` | 无（边不会被其他操作依赖） | 允许撤销 |
| `delete_node A` | 无 | 允许撤销 |

### `Design.Service` 更新

移除直接持久化的 prototype 创建，改为 accumulator 操作：

```ts
readonly addAccumulatedOperation: (sessionID: string, operation: Omit<GraphAgentTypes.Operation, "id">) => Effect.Effect<GraphAgentTypes.Operation>
readonly listAccumulatedOperations: (sessionID: string) => Effect.Effect<GraphAgentTypes.Operation[]>
readonly undoAccumulatedOperation: (sessionID: string, operationId: string) => Effect.Effect<void, AccumulatorError>
```

逐步移除旧的 `addAccumulatedNode` / `updateAccumulatedNode` 等方法，或保留作为 `addOperation` 的便捷封装。

### 工具更新

#### `design_define_relation_prototype`

从直接持久化改为 accumulator：

```ts
const proto = yield* design.addAccumulatedOperation(ctx.sessionID, {
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

统一改为 `addAccumulatedOperation`，不再直接调用 `Design.createNode` / `createEdge` 等。

### 新增工具

#### `design_list_accumulated_operations`

返回当前 accumulator 中的所有待提交操作：

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

#### `design_undo_operation`

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

### `applyAccumulatedChanges` 原子提交

终稿审批 Approve 时：

1. 从 accumulator 获取当前有效操作列表。
2. 派生 `GraphDelta`。
3. 在数据库事务中执行 `applyRawDelta`。
4. 清空 accumulator。
5. 返回成功。

终稿审批 Abandon 时：

1. 清空 accumulator。
2. 数据库不受影响。
3. 返回成功。

## 前端设计

无变化。终稿审批面板继续展示 `design_finalize_change` 的内容。

## Prompt 更新

### `packages/opencode/src/design/agent/prompt/graph.txt`

1. 明确所有写工具都进入 accumulator，不立即落库。
2. 新增 `design_list_accumulated_operations` 到可用工具列表。
3. 新增 `design_undo_operation` 到可用工具列表。
4. refine 阶段说明：
   - 每次写工具调用都会向 accumulator 添加一个 operation。
   - 可以通过 `design_list_accumulated_operations` 查看当前所有待提交操作。
   - 如果需要撤回某个操作，使用 `design_undo_operation({ operation_id })`。
   - 如果存在依赖，先撤销依赖操作。
5. 终稿阶段说明：
   - Approve 时所有 accumulator 操作原子提交。
   - Abandon 时所有 accumulator 操作清空，数据库不受影响。

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
  operations: Operation[]
  summary: string
}
```

## 需要改动的文件

### 后端

- `packages/opencode/src/design/agent/types.ts`
  - 新增 `Operation` 接口。
  - 更新 `GraphDelta`（可选，保持兼容性）。

- `packages/opencode/src/design/system/change-accumulator.ts`
  - 重构为操作日志模型。
  - 实现 `listOperations`、`addOperation`、`undoOperation`。

- `packages/opencode/src/design/design.ts`
  - 新增 `addAccumulatedOperation`、`listAccumulatedOperations`、`undoAccumulatedOperation`。
  - 移除或重构旧的 accumulator 方法。
  - `createPrototype` 不再被 GraphAgent 工具直接调用。

- `packages/opencode/src/tool/design.ts`
  - 所有写工具改为 `addAccumulatedOperation`。
  - `design_define_relation_prototype` 改为 accumulator。
  - 新增 `DesignListAccumulatedOperationsTool`。
  - 新增 `DesignUndoOperationTool`。
  - 更新 `GraphAgentDesignTools` 导出。

- `packages/opencode/src/agent/agent.ts`
  - 新增工具的权限：`design_list_accumulated_operations: "allow"`、`design_undo_operation: "allow"`。

### Prompt

- `packages/opencode/src/design/agent/prompt/graph.txt`
  - 更新可用工具列表。
  - 更新 refine 阶段工作流。
  - 更新终稿阶段工作流。

### 测试

- `packages/opencode/test/tool/graph-agent-design.test.ts`
  - 验证 `design_define_relation_prototype` 进入 accumulator 不直接落库。
  - 验证 `design_list_accumulated_operations` 返回操作列表。
  - 验证 `design_undo_operation` 撤销操作。
  - 验证依赖检查。
  - 验证 `design_finalize_change` Approve 后原子提交。

## 关键约束

- 所有写操作必须进 accumulator，不能直接落库。
- accumulator 操作必须有唯一 ID。
- 撤销操作必须检查依赖。
- 只有 `design_finalize_change` Approve 时才真正修改数据库。
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
          → accumulator: [create_context "战斗系统"]
        → design_define_concept({ name: "船", context: "战斗系统" })
          → accumulator: [..., create_node "船"]
        → design_define_relation_prototype({ name: "属于" })
          → accumulator: [..., create_prototype "属于"]
        → design_relate_concepts({ from: "船", to: "战斗系统", relation: "属于" })
          → accumulator: [..., create_edge 船--[属于]-->战斗系统]
        → 用户说"关系原型太多了"
        → design_list_accumulated_operations
          → 返回所有操作
        → design_undo_operation({ operation_id: "属于"的ID })
          → 失败：因为 create_edge 依赖 create_prototype "属于"
        → design_undo_operation({ operation_id: create_edge 的 ID })
          → 成功
        → design_undo_operation({ operation_id: "属于"的ID })
          → 成功
      → 阶段 4：design_finalize_change
        → 用户选择 Approve
          → 原子提交 accumulator 中剩余操作
          → 返回 change-applied
```

## 决策总结

| 决策 | 选择 |
|---|---|
| 写操作是否直接落库 | 否，全部进 accumulator |
| accumulator 模型 | 操作日志，支持 list/undo |
| prototype 创建方式 | 进 accumulator |
| 撤销依赖策略 | 默认 RESTRICT，提示先撤销依赖 |
| 提交方式 | 终稿 Approve 时原子化 apply |
| 放弃方式 | 终稿 Abandon 时清空 accumulator |
| 是否影响输出类型 | 否，但 `appliedChange` 增加 operations 字段 |

## 相关文档

- `docs/specs/2026-07-06-design-unified-change-mode.md`：统一 change mode 工作流，本规格是其细化。
- `docs/specs/2026-07-06-design-change-forced-output.md`：change-forced 输出类型。
- `docs/specs/2026-07-06-design-approval-timeline-rendering.md`：审批时间线渲染。
