# Design 修改缓冲区与原子提交规格（v2）

> 日期：2026-07-06
> 状态：规范 / 讨论中

## 上次讨论后的修正

1. **不再使用 "ChangeAccumulator" 名称**，改为 **"Design Change Buffer"（设计修改缓冲区）** 或简称 **"Buffer"**。
2. **GraphDelta 不再与操作日志直接关联**。GraphDelta 只是提交前由操作日志派生出来的最终差异视图，不是缓冲区的内部模型。
3. **只有用户同意（终稿 Approve）后真正提交的修改才会被记录到设计图历史和事件日志中**。缓冲区中的操作在被提交前可以随意撤销，提交后不可单独删除某一条。

## 核心原则

| 原则 | 说明 |
|---|---|
| 写操作一律缓冲 | 任何修改设计图的操作都进入 Design Change Buffer，不直接落库 |
| 操作可查询 | GraphAgent 可以列出缓冲区中的操作 |
| 操作可撤销 | GraphAgent 可以按 ID 撤销缓冲区中的操作 |
| 撤销受依赖限制 | 存在依赖时拒绝撤销，提示先撤销依赖 |
| 原子提交 | 只有终稿 Approve 才把所有缓冲操作一次性持久化 |
| 原子放弃 | 终稿 Abandon 时清空缓冲区，数据库不受影响 |
| 提交后不可单独回滚 | 已提交的修改进入设计图历史，只能通过新的变更反向操作 |

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

## 缓冲区内部模型

```ts
export interface BufferOperation {
  id: string
  type: "create_context" | "create_node" | "update_node" | "delete_node" |
         "create_edge" | "update_edge" | "delete_edge" |
         "create_prototype" | "update_prototype"
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

- `listOperations`：返回当前缓冲区中的操作列表。
- `addOperation`：向缓冲区添加一个操作，返回带 ID 的操作。
- `undoOperation`：按 ID 撤销缓冲区中的操作。如果存在依赖，返回错误。
- `getDelta`：从当前有效操作派生出 `GraphDelta`，仅用于展示终稿差异，**不作为内部状态存储**。
- `apply`：提交缓冲区中的所有有效操作，返回派生的 `GraphDelta`，然后清空缓冲区。
- `clear`：清空缓冲区。
- `getMergedState`：把缓冲区中的有效操作重放到当前图状态上，生成预览状态。

## GraphDelta 的定位

`GraphDelta` 只是提交前/提交时的**派生视图**，用途：
1. `design_finalize_change` 展示终稿差异。
2. `applyRawDelta` 接收并持久化。

它不是缓冲区的内部模型，也不单独持久化。缓冲区内部只存 `BufferOperation[]`。

## 提交后的不可变历史

一旦 `bufferApply` 被调用：
- 所有操作一次性写入图引擎。
- 每个操作产生对应的事件日志条目（`node_created`、`edge_created`、`prototype_created` 等）。
- 版本号 bump。
- 缓冲区清空。
- 之后不能单独删除某条已提交的操作，只能通过新的变更反向操作（例如再次创建、更新、删除）。

这与数据库事务一致：提交后的记录只能通过新事务修改。

## 依赖检查规则（保持不变）

| 被撤销操作 | 依赖该操作的后续操作示例 | 处理方式 |
|---|---|---|
| `create_node A` | `create_edge A->B`、`update_node A`、`delete_node A` | 拒绝撤销，提示先撤销依赖 |
| `create_context C` | `create_node` 引用了 C | 拒绝撤销，提示先撤销依赖 |
| `create_prototype P` | `create_edge` 使用了 P | 拒绝撤销，提示先撤销依赖 |
| `create_edge A->B` | 无 | 允许撤销 |
| `delete_node A` | 无 | 允许撤销 |

## 工具命名调整

| 旧工具名 | 新工具名 |
|---|---|
| `design_get_change_accumulator`（如果有） | 删除 |
| 新增 | `design_list_buffer_operations` |
| 新增 | `design_undo_buffer_operation` |

其他写工具名保持不变，但内部改为向 buffer 添加 operation。

## 建议与待讨论问题

1. **撤销时是否支持 CASCADE？**
   - 当前规格默认 RESTRICT。
   - 可以考虑给 `design_undo_buffer_operation` 增加 `cascade: boolean` 参数，让用户/GraphAgent 选择级联撤销依赖操作。

2. **已提交操作的反向操作**
   - 如果用户提交后想"撤回"某个 prototype，本质上需要新的 `withdraw_prototype` 工具。
   - 这属于提交后的修改，不走 buffer，而是作为新的 change request。

3. **context 的删除**
   - 当前没有 `design_withdraw_context`。
   - 如果 context 被持久化后又想删除，需要新增工具。

4. **prototype 的删除**
   - 当前没有 `design_withdraw_relation_prototype`。
   - buffer 阶段可以撤销 `create_prototype` 操作。
   - 持久化后如果想删除，需要新增 `design_withdraw_relation_prototype` 工具，遵循 RESTRICT/CASCADE 语义。

5. **GraphAgent 细化策略**
   - 有了 buffer 和 undo 后， refine 阶段可以更灵活：
     - 用户提到"关系原型太多"，GraphAgent 可以先 list buffer，找到多余 prototype，检查依赖，undo 相关 edge，再 undo prototype。

6. **并发问题**
   - 同一 session 的 buffer 是单线程的，由子代理独占。
   - 如果未来支持多个并行的 design change request，需要 session 隔离。

## 下一步待确认

- 是否采用 `DesignChangeBuffer` 命名？
- 是否支持 `cascade` 撤销？
- 是否需要现在实现持久化后的 `withdraw_context` / `withdraw_relation_prototype`？
- 是否保留旧的 accumulator API 作为过渡，还是直接替换？
