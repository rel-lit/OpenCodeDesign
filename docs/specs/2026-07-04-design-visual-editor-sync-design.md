# Visual Editor 同步状态重构规格

## 背景与问题

当前 Design Mode v2 的 Visual Editor 同步状态由 `VersionSync` 服务维护，使用两个内存变量：

- `visualEditorDirty`
- `chatAgentContextVersion`

这带来几个问题：

1. **状态不是持久的**：如果实例状态重建（如服务重启、重新初始化），dirty 状态会丢失。
2. **读取工具也被阻塞**：`design_ask_graph` 和 `design_summarize_design` 在执行前调用了 `checkChatAgentSync()`。按 v2 架构，这些读取工具本应作为"重新认知图"的入口，却被同步检查错误地阻止了。
3. **读取工具不重置同步状态**：即使 `design_ask_graph` 成功执行，`visualEditorDirty` 仍然为 true，ChatAgent 后续还是无法修改图。
4. **错误信息自相矛盾**：错误提示建议"调用 design_ask_graph/design_summarize_design 来同步"，但这两个工具自己也被 `checkChatAgentSync` 阻塞。

## 设计目标

- 让 Visual Editor 同步状态基于 `eventLog` 中的 `graph_version_bumped` 事件推导，而不是内存变量。
- 读取工具（`design_ask_graph`、`design_summarize_design`）不再被同步检查阻塞，并在成功后标记 ChatAgent 已同步。
- 写入工具（`design_request_change`）在修改图之前仍然检查同步状态，未同步时返回清晰的错误。
- 删除无实际作用的 `refreshChatAgentContext` 方法，保持架构清晰。

## 核心设计

### 状态推导规则

`VersionSync` 从 `EventLog` 读取所有 `graph_version_bumped` 事件，按顺序得到版本历史：

```
sequence: 1, source: "chat-agent"
sequence: 2, source: "visual-editor"
sequence: 3, source: "chat-agent"
sequence: 4, source: "visual-editor"
```

定义：

- `isVisualEditorDirty()`：最新一个 version bump 的 `source === "visual-editor"`
- `checkChatAgentSync()`：找到最后一个 `source === "chat-agent"` 的 version；如果当前最新 version 的 sequence 比它大，说明之后有 Visual Editor 修改，返回 `StaleContextError`

### 工具行为调整

| 工具 | 调整前 | 调整后 |
|------|--------|--------|
| `design_ask_graph` | 先调用 `checkChatAgentSync`，可能被阻塞 | 不调用 `checkChatAgentSync`；子智能体成功后调用 `bumpVersion("chat-agent")` |
| `design_summarize_design` | 先调用 `checkChatAgentSync`，可能被阻塞 | 不调用 `checkChatAgentSync`；子智能体成功后调用 `bumpVersion("chat-agent")` |
| `design_request_change` | 先调用 `checkChatAgentSync` | 保持 `checkChatAgentSync` |
| `design_search_project` | 无 checkSync | 不变 |
| `design_search_web` | 无 checkSync | 不变 |

### 读取工具同步时机

读取工具在子智能体返回结果后、向 ChatAgent 返回结果前，调用 `design.bumpVersion("chat-agent")`。

原因：此时 ChatAgent 已经通过子智能体"看到"了最新图状态，因此可以认为 ChatAgent 上下文已同步。

### 删除 `refreshChatAgentContext`

当前 `refreshChatAgentContext` 只是记录一条 log：

```ts
const refreshChatAgentContext = Effect.fn("VersionSync.refreshChatAgentContext")(function* (version) {
  yield* Effect.logInfo("refreshing chat agent context", version)
})
```

没有外部调用者，也没有实际副作用。本次重构直接删除：

- `VersionSync.Interface.refreshChatAgentContext`
- `VersionSync.make` 中的 `refreshChatAgentContext` 函数
- `VersionSync.bumpVersion` 中对 `refreshChatAgentContext` 的调用
- `Design.Interface.refreshChatAgentContext`
- `Design.Service` 中的 `refreshChatAgentContext` 方法

## 接口变更

### `VersionSync.Interface`

移除 `refreshChatAgentContext`：

```ts
export interface Interface {
  readonly getCurrentVersion: () => Effect.Effect<GraphVersion>
  readonly bumpVersion: (source: GraphVersion["source"]) => Effect.Effect<GraphVersion>
  readonly isVisualEditorDirty: () => Effect.Effect<boolean>
  readonly markVisualEditorDirty: () => Effect.Effect<void>
  readonly clearVisualEditorDirty: () => Effect.Effect<void>
  readonly checkChatAgentSync: () => Effect.Effect<void, StaleContextError>
}
```

`markVisualEditorDirty` / `clearVisualEditorDirty` 保留，但实现改为基于 event log 推导：

- `markVisualEditorDirty`：追加一个 `graph_version_bumped` 事件，`source: "visual-editor"`
- `clearVisualEditorDirty`：追加一个 `graph_version_bumped` 事件，`source: "chat-agent"`

> 注：也可以直接删除这两个方法，让调用方统一使用 `bumpVersion`。但考虑到 `VisualEditorProtocol.save` 已经调用 `bumpVersion("visual-editor")`，而读取工具调用 `bumpVersion("chat-agent")`，`mark/clear` 可能变得冗余。本次设计选择保留它们作为语义化的别名，内部都委托给 `bumpVersion`。

### `Design.Interface`

移除 `refreshChatAgentContext`。保留 `bumpVersion`、`isVisualEditorDirty`、`checkChatAgentSync`。

## 需要改动的文件

### 修改文件

- `packages/opencode/src/design/system/version-sync.ts`
  - 删除 `visualEditorDirty` 和 `chatAgentContextVersion` 内存变量。
  - 实现基于 event log 的 `getCurrentVersion`、`isVisualEditorDirty`、`checkChatAgentSync`。
  - 删除 `refreshChatAgentContext`。
  - `markVisualEditorDirty` / `clearVisualEditorDirty` 委托给 `bumpVersion`。

- `packages/opencode/src/design/design.ts`
  - 删除 `refreshChatAgentContext` 的暴露。

- `packages/opencode/src/tool/design.ts`
  - 从 `design_ask_graph` 和 `design_summarize_design` 中移除 `checkChatAgentSync` 调用。
  - 在它们成功返回前调用 `design.bumpVersion("chat-agent")`。
  - 更新 `design_request_change` 被阻塞时的错误提示，确保建议的工具确实可用。

- `packages/opencode/src/design/visual-editor-protocol.ts`
  - 检查是否还依赖 `markVisualEditorDirty` / `clearVisualEditorDirty`；如果只用 `bumpVersion`，则无需改动。

### 修改测试

- `test/design/visual-editor-protocol.test.ts`
  - 更新 sync 相关断言，验证基于 event log 的状态重建。
- `test/design/design.test.ts`
  - 更新 dirty/sync 相关测试。
- `test/design/e2e/multi-agent.test.ts`
  - 更新读取/写入工具与 sync 交互的测试。

## 测试策略

1. **状态持久化测试**：
   - 创建新的 `VersionSync` 实例（或重新初始化 `Design.Service`），验证 `isVisualEditorDirty()` 能从 event log 正确恢复。

2. **读取工具同步测试**：
   - Visual Editor 保存后，`isVisualEditorDirty()` 返回 true。
   - 调用 `design_ask_graph` 成功后，`isVisualEditorDirty()` 返回 false。
   - 调用 `design_summarize_design` 成功后，`isVisualEditorDirty()` 返回 false。

3. **写入工具阻塞测试**：
   - Visual Editor 保存后，`design_request_change` 返回 `Design sync required` 错误。
   - 调用 `design_ask_graph` 同步后，`design_request_change` 可以正常执行。

4. **删除 `refreshChatAgentContext` 测试**：
   - 确认没有测试依赖该方法。

## 边界情况

- **无 version 历史**：新实例首次调用 `checkChatAgentSync()` 应通过，因为没有 Visual Editor 修改。
- **连续多次 Visual Editor 保存**：最新 source 仍为 `visual-editor`，`isVisualEditorDirty()` 返回 true。
- **ChatAgent 写入后 Visual Editor 再保存**：`checkChatAgentSync()` 应检测到后续有 visual-editor bump，返回错误。
- **读取工具失败**：如果子智能体执行失败，不调用 `bumpVersion("chat-agent")`，dirty 状态保持。

## 决策总结

| 决策 | 选择 |
|------|------|
| 同步状态存储 | 基于 `eventLog` 的 `graph_version_bumped` 事件 |
| 读取工具是否阻塞 | 否 |
| 读取工具成功后是否标记同步 | 是，调用 `bumpVersion("chat-agent")` |
| 写入工具是否阻塞 | 是 |
| `refreshChatAgentContext` | 删除 |
| `mark/clearVisualEditorDirty` | 保留为语义化别名，内部委托 `bumpVersion` |
