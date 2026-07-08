# Design Change Buffer 重构方向（完整版）

> 日期：2026-07-06
> 状态：已决策，待实现

## 一、目标

把所有会修改设计图的操作统一纳入 **Design Change Buffer（修改缓冲区）**，只有终稿审批用户点击 Approve 后才原子化提交到数据库。

核心要求：

- 写操作一律缓冲，不直接落库。
- 缓冲区维护可操作、可查询、可撤销的操作日志。
- `GraphDelta` 只是缓冲区派生出的提交视图，不是内部模型。
- 读工具只针对已持久化图；buffer 中待提交的操作直接通过 `design_list_buffer_operations` 查看，不再提供合并后的设计图预览。
- 终稿 Approve 时原子提交，Abandon 时原子清空。
- 提交后的修改不可单独回滚，只能通过新的变更反向操作。

## 二、命名调整

| 旧命名 | 新命名 |
|---|---|
| `ChangeAccumulator` | `DesignChangeBuffer` |
| `accumulator` | `buffer` |
| `addAccumulatedNode` / `updateAccumulatedNode` / `deleteAccumulatedNode` | `bufferAddOperation` |
| `addAccumulatedEdge` / `updateAccumulatedEdge` / `deleteAccumulatedEdge` | `bufferAddOperation` |
| `getChangeAccumulator` / `getPendingDelta` | `bufferGetDelta` |
| `applyAccumulatedChanges` | `bufferApply` |
| `clearAccumulatedChanges` | `bufferClear` |
| `getAccumulatedGraphState` | `bufferGetMergedState` |

## 三、两个层面的操作

### 3.1 内容操作（Content Operation）

描述“用户希望设计图变成什么样”，进入 `Design Change Buffer`，终稿 Approve 后写入数据库。

| 类型 | 对应工具 | 含义 |
|---|---|---|
| `create_context` | `design_define_context` | 新增限界上下文 |
| `update_context` | `design_update_context` | 更新限界上下文 |
| `delete_context` | `design_withdraw_context` | 删除限界上下文 |
| `create_node` | `design_define_concept` | 新增概念 |
| `update_node` | `design_refine_concept` | 更新概念 |
| `delete_node` | `design_withdraw_concept` | 删除概念 |
| `create_edge` | `design_relate_concepts` | 新增关系（无向） |
| `update_edge` | `design_relate_concepts`（同名更新） | 更新关系 |
| `delete_edge` | `design_withdraw_relation` | 删除关系 |
| `create_prototype` | `design_define_relation_prototype` | 新增关系原型 |
| `update_prototype` | `design_define_relation_prototype`（同名更新） | 更新关系原型 |
| `delete_prototype` | `design_withdraw_relation_prototype` | 删除关系原型 |

**重名规则**：
- context 的 name 全局唯一。
- concept 的 name 在 context 内唯一；不同 context 下允许同名。
- prototype 的 name 全局唯一。

**删除约束**：
- `delete_context`：若 context 仍包含 concept，拒绝。
- `delete_node`：自动级联删除相关 edge，不允许 dangling edge。
- `delete_prototype`：若仍被 edge 使用，拒绝（RESTRICT）。

### 3.2 缓冲区控制操作（Buffer Control Operation）

管理缓冲区本身，不进入缓冲区，也不直接修改数据库。

| 工具 | 含义 |
|---|---|
| `design_list_buffer_operations` | 查看当前缓冲区中的内容操作列表 |
| `design_undo_buffer_operation` | 按 operation ID 移除一条内容操作 |

`design_undo_buffer_operation` 参数：

```ts
{
  operation_id: string
  cascade?: boolean  // 默认 false
}
```

依赖规则：

| 被撤销操作 | 依赖它的后续操作 |
|---|---|
| `create_context` | `create_node` 引用该 context |
| `create_node` | `create_edge` / `update_edge` / `delete_edge` 引用该 node |
| `create_prototype` | `create_edge` / `update_edge` 使用该 prototype |
| `update_context` | 无（ID 不可修改，改名不影响依赖） |
| `update_node` | 无（ID 不可修改，改名/改语义不影响依赖） |
| `update_prototype` | 无（ID 不可修改，改名/改语义不影响依赖） |
| 删除类操作 | 不被其他操作依赖 |

- `cascade: true`：级联撤销所有依赖操作（含间接依赖）。
- `cascade: false`：拒绝撤销并返回 `blockedBy` 列表。

## 四、读工具与 buffer 查询分离

### 4.1 读工具（只读，仅针对已持久化图）

| 类别 | 工具 |
|---|---|
| 发现类 | `design_get_temporary_working_set`、`design_search_graph`、`design_expand_node`、`design_list_prototypes` |
| 单个 get | `design_get_context`、`design_get_concept`、`design_get_relation`、`design_get_prototype`、`design_expand_node_focused`、`design_get_state_summary` |

原则：
- 概要中保留自身 ID，外部引用 ID 替换为名称。
- 关系输出格式由工具自动处理为 `A --[prototype]-- B`，不暴露方向给 GraphAgent。
- 不反映 buffer 中的待提交内容。

### 4.2 buffer 查询工具

| 工具 | 输出 |
|---|---|
| `design_list_buffer_operations` | 操作列表 |

读工具只针对已持久化图；buffer 中待提交的操作直接通过 `design_list_buffer_operations` 查看，不再提供合并后的设计图预览。

## 五、审批流程

### 5.1 初稿审批：`design_request_approval`

- 通过 `Question.Service.ask` 发送 question，前缀 `[design-approval]`。
- 客户端识别前缀，渲染专用 design approval dock 面板。
- 选项：
  - 无问题：`Approve`、`Revise`、`Reject`
  - 有问题：`Force`、`Revise`、`Reject`
- 返回 `metadata.result`：`approve` / `force` / `revise` / `reject`。

### 5.2 终稿审批：`design_finalize_change`

- 通过 `Question.Service.ask` 发送 question，前缀 `[design-finalize]`。
- 选项：`Approve`、`Abandon`、`Revise`。
- 用户选择 Approve 后，执行提交前一致性检查：
  1. 所有 `create_node` 引用的 context 存在。
  2. 所有 edge 的 from/to node 存在。
  3. 所有 edge 的 prototype 存在。
  4. 无重名 context；同一 context 内无重名 concept。
  5. 无对同一实体的重复创建（包括持久化图中已存在、却在 buffer 中删除后重建）。
  6. `delete_node` 已自动处理相关 edge。
- 检查通过后，在数据库事务中原子执行：
  1. 从缓冲区获取操作列表。
  2. 派生 `GraphDelta`。
  3. 执行 `applyRawDelta`。
  4. 追加事件日志条目。
  5. bump 版本号。
  6. 清空缓冲区。
- 用户选择 Abandon 时，仅清空缓冲区，数据库不受影响。

## 六、输出约定

### 6.1 内容写工具返回值

所有内容写工具返回：

```ts
{
  title: string
  output: string
  metadata: {
    operationId: string
    operationType: BufferOperationType
  }
}
```

示例：

```ts
// 创建 edge
{
  title: "Related concepts",
  output: "船 --[装备]-- 武器 queued",
  metadata: { operationId: "op-xxx", operationType: "create_edge" }
}

// 更新 edge
{
  title: "Related concepts",
  output: "船 --[装备]-- 武器 updated",
  metadata: { operationId: "op-yyy", operationType: "update_edge" }
}

// 创建 prototype
{
  title: "Defined prototype 装备",
  output: "Prototype 装备 queued for creation",
  metadata: { operationId: "op-xxx", operationType: "create_prototype" }
}

// 更新 prototype
{
  title: "Defined prototype 装备",
  output: "Prototype 装备 updated",
  metadata: { operationId: "op-yyy", operationType: "update_prototype" }
}
```

### 6.2 终稿输出类型

终稿 Approve 后返回：

- 阶段 2 为 Approve → `"change-applied"`
- 阶段 2 为 Force → `"change-forced"`

`appliedChange` 结构：

```ts
{
  version: number
  affectedNodes: string[]
  affectedEdges: string[]
  affectedContexts: string[]
  affectedPrototypes: string[]
  operations: BufferOperation[]
  summary: string
}
```

## 七、后端接口

### 7.1 `DesignChangeBuffer`

```ts
export interface BufferOperation {
  id: string
  type: BufferOperationType
  description: string
  payload: unknown
}

export interface DesignChangeBuffer {
  readonly listOperations: (sessionID: string) => Effect.Effect<BufferOperation[]>
  readonly addOperation: (sessionID: string, operation: Omit<BufferOperation, "id">) => Effect.Effect<BufferOperation>
  readonly undoOperation: (sessionID: string, operationId: string, cascade?: boolean) => Effect.Effect<void, BufferError>
  readonly getDelta: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly apply: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
  readonly clear: (sessionID: string) => Effect.Effect<void>
}
```

实现要点：
- 内部维护 `Map<sessionID, BufferOperation[]>`。
- `addOperation` 向列表追加，返回带 ID 的操作。
- `undoOperation` 检查依赖；`cascade: true` 时递归撤销依赖操作。
- `getDelta` 从当前操作列表派生 `GraphDelta`，仅用于展示/提交。
- `apply` 返回 `GraphDelta` 并清空列表。
- `clear` 清空列表。

### 7.2 `Design.Service` 新增方法

```ts
readonly bufferAddOperation: (sessionID: string, operation: Omit<BufferOperation, "id">) => Effect.Effect<BufferOperation>
readonly bufferListOperations: (sessionID: string) => Effect.Effect<BufferOperation[]>
readonly bufferUndoOperation: (sessionID: string, operationId: string, cascade?: boolean) => Effect.Effect<void, BufferError>
readonly bufferGetDelta: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
readonly bufferApply: (sessionID: string) => Effect.Effect<GraphAgentTypes.GraphDelta>
readonly bufferClear: (sessionID: string) => Effect.Effect<void>
```

逐步移除旧的 accumulator 方法。

## 八、工具更新清单

### 8.1 写工具统一改为 `bufferAddOperation`

- `design_define_context`
- `design_update_context`
- `design_withdraw_context`
- `design_define_concept`
- `design_refine_concept`
- `design_withdraw_concept`
- `design_relate_concepts`
- `design_withdraw_relation`
- `design_define_relation_prototype`
- `design_withdraw_relation_prototype`

`design_define_relation_prototype` 和 `design_withdraw_relation_prototype` 当前直接落库，必须改为缓冲。

### 8.2 新增 buffer 控制工具

- `design_list_buffer_operations`
- `design_undo_buffer_operation`

### 8.3 审批工具不变

- `design_request_approval`
- `design_finalize_change`

### 8.4 读工具不变

- `design_get_temporary_working_set`
- `design_search_graph`
- `design_expand_node`
- `design_list_prototypes`
- `design_get_context`
- `design_get_concept`
- `design_get_relation`
- `design_get_prototype`
- `design_expand_node_focused`
- `design_get_state_summary`

## 九、权限更新

`packages/opencode/src/agent/agent.ts`：

- GraphAgent 允许：`design_list_buffer_operations`、`design_undo_buffer_operation`。ChatAgent 继续被 deny 直接调用 design 图工具及 design 子代理。

## 十、Prompt 更新

`packages/opencode/src/design/agent/prompt/graph.txt`：

1. 所有写工具都进入 Design Change Buffer，不立即落库。
2. 读工具只反映已持久化图；buffer 中的待提交操作通过 `design_list_buffer_operations` 查看。
3. refine 阶段：
   - 每次写工具调用向缓冲区添加一个 operation。
   - 可通过 `design_undo_buffer_operation` 精确撤销。
   - 存在依赖时选择先撤销依赖，或使用 `cascade: true`。
4. 终稿阶段：
   - Approve 时原子提交。
   - Abandon 时清空缓冲区。
   - 提交后的修改不可单独回滚。

## 十一、测试重点

- `design_define_relation_prototype` 进入缓冲区，不直接落库。
- `design_withdraw_relation_prototype` 进入缓冲区。
- `design_list_buffer_operations` 返回正确操作列表。
- `design_undo_buffer_operation`：
  - 正常撤销。
  - 有依赖时拒绝（`cascade: false`）。
  - `cascade: true` 时级联撤销。
- `design_withdraw_concept` 自动级联删除相关 edge。
- `design_finalize_change` Approve 后原子提交。
- `design_finalize_change` Abandon 后缓冲区清空、数据库未变。
- 终稿一致性检查拦截重名、引用缺失、重复创建。

## 十二、相关文档

- `docs/specs/2026-07-06-design-tools-behavior.md`：工具完整行为、异常处理、读工具分层。
- `docs/specs/2026-07-06-design-unified-change-mode.md`：统一 change mode 工作流。
- `docs/specs/2026-07-06-design-change-forced-output.md`：change-forced 输出类型。
- `docs/specs/2026-07-06-design-approval-timeline-rendering.md`：审批时间线渲染。
