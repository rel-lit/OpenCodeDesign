# Design 子智能体会话 JSONL 轨迹日志规格

## 背景与问题

Design Mode v2 中，ChatAgent 通过 `task` 工具启动 `design-graph` / `design-search` 子智能体。子智能体的具体执行过程（调用哪些工具、生成了什么 Change Plan、如何请求用户审批、用户如何回答）发生在子会话中。

当前调试这些信息很困难：

- 桌面端 GUI 的 dev log 主要包含 renderer 警告，缺少服务端/智能体事件细节。
- 没有持久化的子智能体会话轨迹，无法事后复盘。
- 当 Visual Editor 同步、审批流程、Change Plan 展开等场景出现异常时，难以定位是服务端逻辑问题还是 UI 渲染问题。

因此需要给 design 子智能体会话增加服务端 JSONL 轨迹日志。

## 设计目标

- 自动记录 `design-graph` 和 `design-search` 子智能体会话的关键事件。
- 日志以 JSONL（每行一个 JSON 对象）格式写入 `.opencode/logs/sessions/<session-id>.jsonl`。
- 日志内容足够还原子智能体的执行过程，但不至于过大。
- 对正常执行性能影响最小（buffered 写入）。
- 不改动现有 EventV2 协议或 Session 持久化机制。

## 核心设计

### 触发条件

在 `TaskTool.execute` 中，当创建的子智能体会话满足以下条件时启用轨迹日志：

```ts
const LOGGED_SUBAGENTS = new Set(["design-graph", "design-search"])
if (LOGGED_SUBAGENTS.has(next.name)) {
  yield* enableSessionTrace(nextSession.id)
}
```

`next.name` 是子智能体 agent 名称（如 `"design-graph"`）。

### 日志文件路径

```
<worktree>/.opencode/logs/sessions/<session-id>.jsonl
```

例如：

```
D:\RLDemos\Test\OpenCodeD\.opencode\logs\sessions\ses_abc123.jsonl
```

### 记录的事件范围

只记录以下事件类型：

| 事件类型 | 说明 |
|---------|------|
| `message.updated` / `message.part.updated` | 子会话消息和 part 变化 |
| `question.asked` / `question.replied` / `question.rejected` | 用户审批流程 |
| `permission.asked` / `permission.replied` / `permission.rejected` | 权限请求 |
| `tool.*`（如 `tool.input`、`tool.result`） | 子智能体工具调用 |
| `session.error` | 子会话执行错误 |

不记录：

- `message.part.delta` 等流式增量事件（避免日志过大）
- 与当前子会话无关的全局事件

### 日志行格式

每行一个 JSON 对象：

```json
{
  "timestamp": "2026-07-04T12:34:56.789Z",
  "type": "message.part.updated",
  "sessionID": "ses_abc123",
  "parentSessionID": "ses_parent456",
  "agent": "design-graph",
  "data": {
    "partID": "pt_...",
    "tool": "design_define_concept",
    "state": { "status": "completed", "input": {...}, "output": "..." }
  }
}
```

字段说明：

- `timestamp`：ISO 8601 时间戳
- `type`：EventV2 事件类型
- `sessionID`：子智能体会话 ID
- `parentSessionID`：父会话 ID（从子会话 info 或 task metadata 获取）
- `agent`：子智能体 agent 名称
- `data`：事件 payload 的精简副本（去掉过大字段如完整文件内容）

### 写入机制

使用 buffered 写入：

1. 子智能体启动时，创建对应 sessionID 的 trace sink。
2. 订阅 `EventV2Bridge.listen()`，过滤 `event.data.sessionID === 子会话ID` 且类型在允许列表内的事件。
3. 事件进入内存队列。
4. 每收到一个事件立即追加到 buffer；当 buffer 满 N 条或超过 T 毫秒时 flush 到文件。
5. 子会话结束时（或实例 dispose 时），强制 flush 并关闭文件句柄。

推荐参数：

- buffer 大小：32 条
- flush 间隔：500ms
- 使用 `Bun.write(path, content, { createPath: true })` 或 `fs.appendFile`

### 生命周期

- trace sink 跟随子会话创建而创建，跟随子会话结束/实例 dispose 而关闭。
- 使用 `Effect.addFinalizer` 在实例关闭时 flush 剩余日志。
- 不需要跨实例保留 buffer。

## 需要改动的文件

### 新增文件

- `packages/opencode/src/design/system/session-trace.ts`
  - `SessionTrace` 服务：管理单个子智能体会话的 trace sink。
  - `SessionTraceLog` 服务：管理日志文件写入、buffer、flush。

### 修改文件

- `packages/opencode/src/tool/task.ts`
  - 在子智能体创建后，判断 agent 名称是否为 design 相关，调用 `SessionTrace.enable(sessionID, { agent, parentSessionID })`。

- `packages/opencode/src/design/design.ts`
  - 在 `InstanceState.make` 中初始化 `SessionTraceLog` 服务（或者让它作为独立服务通过 InstanceState 创建）。

### 不修改的文件

- `packages/opencode/src/event-v2-bridge.ts`：只订阅事件，不改动发布逻辑。
- `packages/opencode/src/session/session.ts`：不改动 Session 持久化。
- `packages/schema`：不新增 schema。

## 与现有日志系统的关系

- 这是独立的轨迹日志，与 OpenCode 的常规应用日志（通过 `Effect.log*`）分离。
- 目标是为开发者/高级用户提供一个可按会话回放的事件轨迹，而不是聚合错误统计。

## 测试策略

1. **单元测试**：
   - 模拟 EventV2 事件流，验证 buffer flush 后文件内容正确。
   - 验证只记录允许列表内的事件类型。
   - 验证非 design 子智能体不会创建 trace 文件。

2. **集成测试**：
   - 调用 `design_ask_graph` 或 `design_request_change`，确认 `.opencode/logs/sessions/<session-id>.jsonl` 生成。
   - 验证文件包含 `question.asked` 事件（如果触发审批）。

3. **真实 GUI 测试**：
   - 触发一次 design 变更审批，检查生成的 JSONL 是否能还原完整流程。

## 边界情况

- **事件在 sink 创建前发生**：sink 在子会话创建后立即启用，理论上不会遗漏关键事件。如果仍有遗漏，可通过 Session 持久化数据补全。
- **多个 design 子智能体并发**：每个 sessionID 有独立文件，互不干扰。
- **实例重启**：trace buffer 丢失，但已 flush 到文件的部分保留。
- **日志目录不可写**：记录 warning log，不影响子智能体执行。

## 隐私与安全

- 日志写入项目本地 `.opencode` 目录，不上传到任何服务端。
- 可能包含用户输入的设计意图，因此不离开本地 worktree。
- 未来如需共享日志，应由用户手动导出。

## 后续扩展

- 未来可以扩展 `LOGGED_SUBAGENTS` 配置，让用户选择哪些子智能体需要记录轨迹。
- 未来可以按日期轮转日志文件，避免单文件过大。
- 未来可以提供一个 CLI/UI 工具读取 JSONL 并生成可读时间线。

## 决策总结

| 决策 | 选择 |
|------|------|
| 记录对象 | `design-graph` 和 `design-search` 子智能体会话 |
| 日志格式 | JSONL |
| 日志路径 | `<worktree>/.opencode/logs/sessions/<session-id>.jsonl` |
| 记录事件 | message/part update、question/permission、tool、session.error |
| 不记录 | message.part.delta 等流式增量 |
| 写入方式 | buffered，32 条或 500ms flush |
| 启用位置 | `TaskTool.execute` 中按 agent 名称判断 |
| 文件句柄生命周期 | 子会话创建到结束/实例 dispose |
| 隐私 | 仅本地存储 |
