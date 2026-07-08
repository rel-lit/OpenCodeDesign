# Design 模式架构重写规范

> 日期：2026-07-04
> 状态：规范 / 待实现
> 取代文档：
> - `2026-07-01-design-multi-agent-architecture.md`（概念正确但实现被带偏）
> - `2026-07-03-design-tool-split-design.md`（部分完成，但 GraphAgent 未真正 subagent 化）
> - `2026-07-04-graphagent-subagent-direction.md`（作者受错误实现误导，方向 A1 错误）

## 背景：当前实现为什么错了

当前代码在 `packages/opencode/src/design` 中实现了一套“看起来像”多 Agent 架构的东西，但它不是原始设计。问题如下：

1. **`GraphAgent` 是内部 Effect Service，不是原生 subagent。**
   - `Design.proposeChanges` 同步调用 `GraphAgent.analyze` 和 `GraphAgent.execute`。
   - 桌面端 GUI 看不到 GraphAgent 的 reasoning、读图验证、工具调用过程。
   - 违反原始架构中 "ChatAgent 通过 task 调用 GraphAgent" 的设计。

2. **`Design.proposeChanges` 承担了 orchestrator 角色。**
   - 它内部调用 LLM、驱动内存中的 approval panel、执行写入。
   - 原始架构中它只是系统层的轻量入口，真正 orchestration 应在 ChatAgent/Subagent 之间。

3. **审批面板是内存状态机，不是系统 UI。**
   - `approval-panel.ts` 被 `Design.proposeChanges` 直接操作。
   - 原始架构中审批面板是系统 UI 组件，由 GraphAgent 输出触发，通过 `Question.Service`/`Permission.Service` 阻塞会话。

4. **ChatAgent 仍被教导调用 `design_propose_change(delta)` 后等待工具结果。**
   - 这在底层实现上是内部 Service 调用，不是 subagent 调用。
   - A2 下 ChatAgent 仍调用 `design_propose_change(delta)`，但该工具底层必须调用 `task(design-graph)`。

5. **`GraphAgent.execute` 直接调用 `Design.applyRawDelta`，没有使用内部工具层。**
   - 2026-07-03 工具分层 spec 要求 GraphAgent 内部通过 `design_create_node` 等工具执行，但当前代码绕过了它们。
   - `GraphAgentDesignTools` 只在测试中被引用，未在执行路径中使用。

6. **GraphAgent 输入仍是预加载大 JSON。**
   - 当前 `GraphAgent.analyze` 接收完整 `graphState`。
   - 作为 subagent，它应自己调用读工具查询图状态。

7. **系统层预处理不完整。**
   - `preprocessor.ts` 只做 @ 引用展开和文本拼接。
   - 缺少临时工作集构建、阈值判断、系统辅助分析区生成、处理后输入展示。

8. **测试全部基于错误实现。**
   - 大量测试在 mock `GraphAgent.Service` 的 `analyze`/`execute`。
   - 改为 subagent 后，这些测试要重写为验证 `task` 调用、子会话输出、question/permission 事件。

## 目标

1. 让 `design-graph` 成为真正的 OpenCode subagent，运行在独立子会话中。
2. 让 GraphAgent 的分析、提案、审批请求、执行写入过程对桌面端 GUI 用户可见。
3. 让 `design_propose_change(delta)` 成为系统层触发 `task(design-graph)` 的入口。
4. 让审批面板通过 `Question.Service` 或 `Permission.Service` 实现，而不是内存状态机。
5. 让 GraphAgent 自己调用读工具获取图状态，而不是依赖父 agent 预加载。
6. 保留 SQLite/EventLog/WorkingSet/版本同步底层不变。
7. 保留 Visual Editor 直接保存路径不变（仍走 `Design.applyRawDelta`，GraphAgent 事后审查）。

## 非目标

1. 不替换 `Design.Service` 和 SQLite 存储层。
2. 不面向 CLI/Web/macOS/Linux；只聚焦 Windows x64 桌面端 GUI。
3. 不实现完整的可视化图编辑器 UI，只定义编辑器与 Agent 系统的交互协议。
4. 不立即引入后台/并发 subagent；默认前台同步。
5. 不改 SearchAgent 的职责边界。

## 关键设计决策

### 决策 1：方向 A2 —— GraphAgent 是完整 Subagent

- `design-graph` subagent 在独立子会话中完成：**分析 → 提案 → 用户确认 → 执行写入 → 返回结果**。
- ChatAgent  orchestrates：决定调用 `design_propose_change(delta)`，然后解释结果。
- `design_propose_change` 是系统层入口，封装 delta 并启动 subagent。

### 决策 2：`design_propose_change` 的精确定位

- **对 ChatAgent 可见**：ChatAgent prompt 仍然教 LLM 调用 `design_propose_change(delta)`。
- **对系统层**：`design_propose_change` 工具内部不调用 LLM，而是构造 prompt 并调用 `task({ subagent_type: "design-graph", ... })`。
- **对 GraphAgent**：subagent 收到 prompt，分析 delta，请求用户确认，执行写入，返回结构化结果。
- 这意味着 ChatAgent prompt 可以基本保持不变，但底层实现彻底换成 subagent。

### 决策 3：审批面板通过 `Question.Service` 实现

- GraphAgent subagent 内部调用 `question.ask` 请求用户确认。
- `question.ask` 通过 EventV2 发布 `question.asked` 事件。
- 桌面端 `SessionComposerState` 从 sync 数据中发现待处理问题。
- `sessionTreeRequest` 向上遍历父会话链，把子会话的 question 显示到父会话 composer。
- 用户在父会话 dock 面板中回答，子会话的 `Deferred` 被 resolve，GraphAgent 继续执行。

### 决策 4：GraphAgent 内部工具权限

- `design-graph` subagent 的 permission 精确控制：
  - **允许**：所有读工具（`design_get_state`, `design_list_*`, `design_get_*`, `design_find_*`, `design_show_working_set`）。
  - **允许**：所有内部写工具（`design_create_*`, `design_update_*`, `design_delete_*`）。
  - **禁止**：`design_propose_change`（防止递归）、`design_resolve_reference`（会隐式创建节点，破坏审批边界）、`task`（防止无限 subagent 递归）、`todowrite`。
- ChatAgent 的 permission：
  - **允许**：读工具、`design_resolve_reference`、`design_propose_change`。
  - **禁止**：所有直接写工具（`design_create_*`, `design_update_*`, `design_delete_*`）。

### 决策 5：GraphAgent 自己查询图状态

- Subagent prompt 不再携带完整 `graphState`。
- Prompt 只携带：用户原始请求、proposed delta、known version、active working set summary。
- Subagent 使用读工具按需查询图状态。
- 临时工作集由系统层构建后作为提示传入，但 subagent 可以动态扩展（通过读工具查询相关节点/边）。

### 决策 6：保留 `Design.applyRawDelta` 作为唯一 DB 写入口

- GraphAgent subagent 内部写工具底层仍走 `Design.applyRawDelta`。
- `applyRawDelta` 保持事务性、自动补全系统字段、替换临时 ID。
- 不允许任何工具直接调用 `GraphEngine` 写接口。

### 决策 7：删除 `GraphAgent.Service` 的 `analyze`/`execute` 接口

- 改为 subagent 后，`GraphAgent.Service` 不再需要。
- `Design.proposeChanges` 简化为：调用 `task(design-graph)` 并返回子会话结果。
- 或者保留 `Design.proposeChanges` 作为兼容包装，但内部必须是 `task` 调用。

## Agent 架构

```
用户 / GUI
  │
  ├─→ 系统层：预处理、工作集、UI 展示、版本同步
  │     │
  │     ├─→ ChatAgent（唯一对话 Agent）
  │     │     │
  │     │     ├─→ 读图工具 / 工作集工具 / design_resolve_reference
  │     │     │
  │     │     └─→ design_propose_change(delta)  ──┐
  │     │                                          │
  │     └─→ 审批面板（系统 UI，Question.Service 驱动）
  │                ▲                               │
  │                │                               │
  └─→ 可视化编辑器（手动保存直接写 DB）            │
                                                   │
                                                   ▼
                                        task({ subagent_type: "design-graph" })
                                                   │
                                                   ▼
                                        design-graph Subagent Session
                                                   │
                                        ├─→ reasoning / 读图验证
                                        ├─→ question.ask("是否应用此 delta？")
                                        ├─→ 用户确认后执行内部写工具
                                        ├─→ Design.applyRawDelta(delta)
                                        ├─→ bump version
                                        └─→ 返回结构化结果
                                                   │
                                                   ▼
                                        ChatAgent 解析结果并回复用户
```

## 工具分层（重写）

### ChatAgent 可用工具

| 工具名 | 类型 | 说明 |
|---|---|---|
| `design_propose_change` | 写入口 | 提交整组图修改意图；底层启动 `design-graph` subagent |
| `design_get_state` | 读 | 获取完整图状态 |
| `design_list_contexts` | 读 | 列出上下文 |
| `design_get_context` | 读 | 获取单个上下文 |
| `design_list_nodes` | 读 | 列出节点 |
| `design_get_node` | 读 | 获取单个节点 |
| `design_find_nodes_by_name` | 读 | 按名称搜索节点 |
| `design_list_edges` | 读 | 列出边 |
| `design_list_prototypes` | 读 | 列出关系原型 |
| `design_get_prototype` | 读 | 获取单个原型 |
| `design_resolve_reference` | 辅助 | 按名称解析或自动创建节点（此工具会写 DB，但属于引用消歧的廉价操作，ChatAgent 可用） |
| `design_show_working_set` | 读 | 查看当前工作集 |
| `design_activate_context` | 工作集 | 激活上下文 |
| `design_activate_node` | 工作集 | 激活节点 |

### design-graph Subagent 可用工具

| 工具名 | 类型 | 说明 |
|---|---|---|
| `design_get_state` | 读 | 验证时查询完整图状态 |
| `design_list_contexts` | 读 | |
| `design_get_context` | 读 | |
| `design_list_nodes` | 读 | |
| `design_get_node` | 读 | |
| `design_find_nodes_by_name` | 读 | |
| `design_list_edges` | 读 | |
| `design_list_prototypes` | 读 | |
| `design_get_prototype` | 读 | |
| `design_show_working_set` | 读 | |
| `design_create_context` | 写 | 仅在 subagent 执行阶段使用 |
| `design_update_context` | 写 | 仅在 subagent 执行阶段使用 |
| `design_create_node` | 写 | 仅在 subagent 执行阶段使用 |
| `design_update_node` | 写 | 仅在 subagent 执行阶段使用 |
| `design_retire_node` | 写 | 仅在 subagent 执行阶段使用 |
| `design_delete_node` | 写 | 仅在 subagent 执行阶段使用 |
| `design_create_edge` | 写 | 仅在 subagent 执行阶段使用 |
| `design_update_edge` | 写 | 仅在 subagent 执行阶段使用 |
| `design_delete_edge` | 写 | 仅在 subagent 执行阶段使用 |
| `design_create_prototype` | 写 | 仅在 subagent 执行阶段使用 |
| `question` | 系统 | 请求用户确认 |

**禁止给 design-graph subagent 的工具**：
- `design_propose_change`（防止递归）
- `design_resolve_reference`（避免隐式创建节点绕过审批）
- `task`（防止无限 subagent 递归）
- `todowrite`
- 所有文件/代码工具（`read`, `edit`, `write`, `bash`, `grep`, `glob` 等）

## 数据流

### 正常图修改流程（ChatAgent 发起）

```
1. 用户："把 UserService 和 OrderService 连起来"

2. ChatAgent 调用读工具确认节点存在

3. ChatAgent 组装 GraphDelta：
   {
     "addEdges": [{
       "leftNodeId": "node-user",
       "rightNodeId": "node-order",
       "prototypeId": "depend"
     }]
   }

4. ChatAgent 调用 design_propose_change({ delta })

5. design_propose_change 工具内部：
   - 记录当前 known version
   - 调用 task({
       subagent_type: "design-graph",
       description: "Evaluate design change",
       prompt: "User request: ...\nProposed delta: ...\nKnown version: ..."
     })

6. design-graph subagent 启动，进入独立子会话

7. Subagent 读取图状态（design_get_state / design_get_node）

8. Subagent 分析 delta，判断：
   - 是否合法
   - 是否有冲突/重复/孤立
   - 是否需要用户确认

9. Subagent 调用 question.ask：
   {
     "questions": [{
       "header": "Apply design change",
       "question": "Add edge UserService --[depend]--> OrderService?",
       "options": [
         { "label": "Apply", "description": "Apply this change" },
         { "label": "Reject", "description": "Reject this change" },
         { "label": "Force", "description": "Apply despite warnings" }
       ]
     }]
   }

10. 桌面端 composer 显示 question dock（来自子会话，但显示在父会话）

11. 用户选择 "Apply"

12. Subagent 继续执行：
    - 调用 design_create_edge（或等价的内部执行路径）
    - 底层走 Design.applyRawDelta
    - bump version

13. Subagent 返回最终 text part：
    {
      "type": "change-applied",
      "summary": "Added edge UserService --[depend]--> OrderService.",
      "affectedNodes": ["node-user", "node-order"],
      "affectedEdges": ["node-user::node-order"],
      "delta": { ... }
    }

14. design_propose_change 工具返回结果给 ChatAgent

15. ChatAgent 向用户总结结果
```

### 被拒绝/需要澄清的流程

```
9. Subagent 发现 delta 有问题：
   - 调用 question.ask 提供选项：
     * "Revise"（返回 ChatAgent 重新生成 delta）
     * "Force apply"（强制执行）
     * "Cancel"（取消）

10. 用户选择 "Revise"

11. Subagent 返回最终 text part：
    {
      "type": "rejected",
      "summary": "Cannot add edge because OrderService already has an edge to UserService.",
      "warnings": [{
        "code": "DUPLICATE_EDGE",
        "message": "Edge already exists",
        "edgeKey": "node-order::node-user"
      }]
    }

12. ChatAgent 收到 rejected，与用户沟通并重新生成 delta
```

### Visual Editor 保存流程（不变）

```
用户在可视化编辑器修改并手动保存
  → 直接写入 Design DB（raw save）
    → 系统层通知 ChatAgent 有未审查变更
      → ChatAgent 调用 task({ subagent_type: "design-graph", prompt: "审查这次保存..." })
        → Subagent 分析改动，返回审查结果
          → ChatAgent 引导用户进入下一轮设计循环
```

## 审批面板机制

### 不使用内存状态机

- 删除 `approval-panel.ts` 中的 `Interface.propose` / `confirm` / `force` / `reject` / `awaitConfirmation`。
- 保留 `State` 类型作为系统 UI 展示状态的描述，但不由 `Design.Service` 驱动。

### 使用 `Question.Service`

- GraphAgent subagent 内部调用 `question` 工具（或直接使用 `Question.Service.ask`）。
- `question.ask` 阻塞子会话，直到用户回答。
- 答案格式：选中选项的 `label` 数组。

### 问题设计

每个 design change 使用一个 `question` 请求，选项包括：

| 选项 | 行为 |
|---|---|
| `apply` | 执行 delta |
| `reject` | 取消，返回 rejected |
| `force` | 忽略警告，执行 delta |
| `revise` | 返回 rejected，让 ChatAgent 重新生成 |

如果只有一个简单确认，可以简化为 `apply` / `reject`。

## 权限设计

### design-graph subagent 权限

```typescript
const designGraphPermissions = Permission.fromConfig({
  // 默认全部拒绝
  "*": "deny",

  // 允许读图
  design_get_state: "allow",
  design_list_contexts: "allow",
  design_get_context: "allow",
  design_list_nodes: "allow",
  design_get_node: "allow",
  design_find_nodes_by_name: "allow",
  design_list_edges: "allow",
  design_list_prototypes: "allow",
  design_get_prototype: "allow",
  design_show_working_set: "allow",

  // 允许内部写工具
  design_create_context: "allow",
  design_update_context: "allow",
  design_create_node: "allow",
  design_update_node: "allow",
  design_retire_node: "allow",
  design_delete_node: "allow",
  design_create_edge: "allow",
  design_update_edge: "allow",
  design_delete_edge: "allow",
  design_create_prototype: "allow",

  // 允许向用户提问
  question: "allow",
})
```

注意：还需要合并 defaults 中的 `external_directory` 等规则，但写代码工具保持 deny。

### ChatAgent（design）权限

```typescript
const designChatPermissions = Permission.fromConfig({
  // 允许读图
  design_get_state: "allow",
  design_list_contexts: "allow",
  design_get_context: "allow",
  design_list_nodes: "allow",
  design_get_node: "allow",
  design_find_nodes_by_name: "allow",
  design_list_edges: "allow",
  design_list_prototypes: "allow",
  design_get_prototype: "allow",
  design_show_working_set: "allow",

  // 允许工作集和引用解析
  design_resolve_reference: "allow",
  design_activate_context: "allow",
  design_activate_node: "allow",

  // 允许提交变更意图
  design_propose_change: "allow",

  // 禁止所有直接写工具
  design_create_context: "deny",
  design_update_context: "deny",
  design_create_node: "deny",
  design_update_node: "deny",
  design_retire_node: "deny",
  design_delete_node: "deny",
  design_create_edge: "deny",
  design_update_edge: "deny",
  design_delete_edge: "deny",
  design_create_prototype: "deny",
})
```

### task 工具权限

- ChatAgent 必须被允许 `task` 权限中的 `design-graph` pattern。
- 默认 ruleset 中 `task: "allow"` 或 `task: { "design-graph": "allow" }`。

## 接口约定

### Subagent 输入（prompt 内容）

```typescript
interface DesignGraphSubagentPrompt {
  // 用户原始请求（经过系统层预处理后）
  userInput: string

  // ChatAgent 提出的完整 GraphDelta
  proposedDelta: GraphDelta

  // 当前已知图版本号，用于检测过期
  knownVersion?: number

  // 当前活跃工作集摘要
  activeWorkingSet: {
    contextIds: string[]
    nodeIds: string[]
    capacity: number
  }

  // 临时工作集（系统层构建的初始上下文）
  temporaryWorkingSet: TemporaryWorkingSet
}
```

### Subagent 输出（最终 text part 内容）

```typescript
interface DesignGraphSubagentOutput {
  type: "change-proposal" | "change-applied" | "rejected" | "needs-clarification"
  summary: string
  delta?: GraphDelta
  warnings?: Array<{
    code: string
    message: string
    nodeId?: string
    edgeKey?: string
  }>
  suggestions?: Array<{
    action: string
    reason: string
  }>
  questions?: string[]
  affectedNodes?: string[]
  affectedEdges?: string[]
}
```

注意：
- `change-proposal` 表示 subagent 已准备好执行，等待用户确认（实际上 subagent 内部会调用 `question.ask`）。
- `change-applied` 表示用户已确认并执行成功。
- `rejected` 表示被 subagent 拒绝或用户选择取消/修订。
- `needs-clarification` 表示需要用户补充信息。

### design_propose_change 返回值

```typescript
interface DesignProposeChangeResult {
  title: string
  output: string
  metadata: {
    subagentSessionID: string
    result: DesignGraphSubagentOutput
  }
}
```

## 系统层预处理（需要补齐）

### 1. @ 引用展开

已实现，但需要扩展：
- 支持 `@节点名`、 `@节点ID`、 `@上下文名`。
- 展开后注入节点/上下文摘要。

### 2. 临时工作集构建

当前缺失。需要实现：
- 根据 @ 引用、当前活跃工作集、输入关键词计算临时节点/上下文集合。
- 包含显式涉及节点、直接相邻边、活跃节点。
- 对 ChatAgent 发起的整组操作，以一次响应中的连续 `design_*` 调用归为一组。

### 3. 阈值判断

当前缺失。需要实现：
- 根据临时工作集大小、输入长度、是否包含图操作关键词决定是否交给 GraphAgent 预处理。

### 4. 系统辅助分析区

当前 `SystemAnalyzer` 存在但只在 `preprocessInput` 中被调用。需要：
- 在构建临时工作集时并行运行自动化检查。
- 填充 `conflictingRelations`、`duplicateNodeCandidates`、`orphanNodes`、`invalidPrototypeUsage`。

### 5. 处理后输入展示

当前 `Preprocessor.buildProcessedText` 已实现基础版本。需要：
- 以可折叠形式展示给用户。
- 展示 enriched summary 和系统分析结果。

## 验证策略：真实 GUI 测试 + 结构化日志

由于 Design 模式涉及 subagent 生命周期、跨会话 question 事件、桌面端 dock 渲染等复杂交互，mock 单元测试在此阶段误导性极高。本规范采用**真实 GUI 测试 + 结构化日志分析**作为主要验证手段。

### OpenCode 日志机制

OpenCode 基于 Effect Logger 实现原生日志：

- 默认写入文件：`%XDG_DATA_HOME%/opencode/log/opencode.log`
  - Windows 上通常为 `%LOCALAPPDATA%/opencode/log/opencode.log`
- 环境变量 `OPENCODE_PRINT_LOGS=1`：同时输出到 stderr（桌面端 devtools 可见）。
- 环境变量 `OPENCODE_LOG_LEVEL`：控制级别，`DEBUG` / `INFO` / `WARN` / `ERROR`，默认 `INFO`。
- 日志 API：`Effect.logInfo("message", { ... })`、`Effect.logDebug`、`Effect.logWarning`、`Effect.logError`。
- 桌面端 GUI 菜单：Help → Export Logs 可直接导出日志文件。

### 日志插入点

在改造过程中，必须在以下边界点插入结构化日志，以便通过真实运行观察流程：

| 位置 | 日志内容 | 目的 |
|---|---|---|
| `design_propose_change` 工具入口 | `design.propose_change.start delta=...` | 确认 ChatAgent 提交了正确的 delta |
| `design_propose_change` 调用 `task` 前 | `design.propose_change.launch_subagent subagent_type=design-graph` | 确认 subagent 被启动 |
| `task` 工具内部 | `task.subagent.created parentSessionID=... childSessionID=... agent=design-graph` | 确认子会话创建成功 |
| `design-graph` subagent 开始 | `design-graph.subagent.start promptLength=... knownVersion=...` | 确认 subagent 收到输入 |
| subagent 调用读工具 | `design-graph.read tool=... args=...` | 确认 subagent 自己查询图状态 |
| subagent 分析完成 | `design-graph.analysis.done type=... warnings=N affectedNodes=...` | 确认分析结果 |
| subagent 调用 `question.ask` | `design-graph.question.ask options=...` | 确认审批请求发出 |
| `Question.Service` 收到回答 | `design-graph.question.replied answer=...` | 确认用户选择被传递 |
| subagent 调用写工具 | `design-graph.write tool=...` | 确认执行阶段开始 |
| `Design.applyRawDelta` | `design.applyRawDelta addNodes=N updateNodes=N addEdges=M ...` | 确认 DB 写入内容 |
| 版本同步 | `design.version.bumped sequence=N source=chat-agent` | 确认版本更新 |
| subagent 返回结果 | `design-graph.subagent.output type=... summary=...` | 确认结果返回父会话 |
| Visual Editor 保存路径 | `design.visual_editor.save delta=...` | 确认直接保存路径不变 |

### 测试执行方式

1. 在桌面端 GUI 中打开一个测试项目。
2. 切换到 design agent。
3. 执行一个会触发图修改的对话，例如：
   - `"创建一个 Core 上下文"`
   - `"在 Core 上下文中创建 UserService 节点"`
   - `"把 UserService 和 OrderService 用 depend 关系连起来"`
4. 观察：
   - 是否出现 `design-graph` 子会话标签页。
   - composer 是否出现 question dock。
   - 用户确认后图是否更新。
5. 测试后导出日志并转述关键日志行。

### 为什么不用 mock

- mock 会隐藏 subagent 生命周期问题。
- mock 无法验证 question/permission 事件是否真正传播到父会话 composer。
- mock 会让测试作者继续维护错误的心智模型。
- 真实日志 + 人工确认是当前阶段最有效的验证方式。

### 何时恢复自动化测试

在以下里程碑达成后，再编写稳定的端到端自动化测试：

1. `design-graph` 真正成为 subagent 并通过 `task` 调用。
2. question/permission 事件在桌面端 GUI 正确渲染。
3. `Design.applyRawDelta` 作为唯一 DB 写入口稳定运行。
4. 审批选项（apply/reject/force/revise）语义确定。

## 实现路线图

### 阶段 1：移除错误实现的 orchestration 层

1. 删除 `Design.proposeChanges` 中的 LLM 调用和 approval panel 驱动逻辑。
2. 删除 `GraphAgent.Service` 的 `analyze`/`execute` 接口（或标记为废弃）。
3. 删除 `approval-panel.ts` 中的状态机方法，只保留 `State` 类型定义。
4. 移除 `src/tool/design.ts` 中的 `GraphAgentDesignTools` 导出（subagent 通过权限获得工具）。

### 阶段 2：改造 design_propose_change 为 subagent 触发器

1. `design_propose_change` 工具内部构造 prompt。
2. 调用 `task({ subagent_type: "design-graph", ... })`。
3. 解析子会话最终 text part 为 `DesignGraphSubagentOutput`。
4. 返回结果给 ChatAgent。

### 阶段 3：重写 design-graph subagent

1. 重写 `src/design/agent/prompt/graph.txt`：
   - 明确 subagent 角色：分析、请求确认、执行。
   - 说明可用工具集。
   - 强制最终输出为 JSON。

2. 调整 `design-graph` 权限：
   - 允许读工具和内部写工具。
   - 禁止 `design_propose_change`、`design_resolve_reference`、`task`。

3. 实现 subagent 内部流程：
   - 读取图状态。
   - 分析 delta。
   - 调用 `question.ask`。
   - 执行 delta（通过内部写工具 → `applyRawDelta`）。
   - 返回 JSON。

### 阶段 4：补齐系统层预处理

1. 实现临时工作集构建。
2. 实现阈值判断。
3. 完善系统辅助分析区。
4. 完善处理后输入展示。

### 阶段 5：重写测试

1. 删除所有 mock `GraphAgent.Service` 的测试。
2. 新增测试：
   - `design_propose_change` 启动 subagent。
   - subagent 读取图状态并返回 proposal。
   - subagent 调用 `question.ask` 后执行写入。
   - 父会话 composer 能显示子会话的 question。
   - 权限测试验证 ChatAgent 没有直接写工具。
   - Visual Editor 保存后审查流程。

### 阶段 6：验证

1. `bun run typecheck`
2. `bun test test/design`
3. `bun test test/tool/design.test.ts`
4. `bun run build --single`

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `packages/opencode/src/design/design.ts` | 简化 `proposeChanges` 为 subagent 调用包装；移除 GraphAgent 分析/执行耦合 |
| `packages/opencode/src/design/approval-panel.ts` | 删除状态机，保留状态类型 |
| `packages/opencode/src/design/agent/graph.ts` | 删除或重写；subagent 不再需要内部 Service 接口 |
| `packages/opencode/src/design/agent/prompt/graph.txt` | 重写为 subagent prompt |
| `packages/opencode/src/tool/design.ts` | `design_propose_change` 改为调用 `task`；删除 `GraphAgentDesignTools` 导出 |
| `packages/opencode/src/agent/agent.ts` | 调整 `design-graph` 权限；确保 ChatAgent 没有直接写工具 |
| `packages/opencode/src/agent/prompt/design.txt` | 明确 `design_propose_change` 是提交入口，subagent 会处理后续 |
| `packages/opencode/src/design/system/preprocessor.ts` | 扩展 @ 引用展开；补齐处理后输入展示 |
| `packages/opencode/src/design/system/working-set-computer.ts` | 实现临时工作集构建 |
| `packages/opencode/src/design/system/analyzer.ts` | 完善系统辅助分析区 |
| `packages/opencode/test/tool/design.test.ts` | 重写为 subagent 集成测试 |
| `packages/opencode/test/design/agent/graph.test.ts` | 删除或重写 |
| `packages/opencode/test/design/design.test.ts` | 重写 |
| `packages/opencode/test/design/e2e/multi-agent.test.ts` | 重写为真正的 subagent E2E |

## 测试策略

1. **Subagent 启动测试**：验证 `design_propose_change` 调用 `task` 并创建子会话。
2. **Subagent 工具权限测试**：验证 `design-graph` subagent 只能看到预期的读/写工具。
3. **Question 事件测试**：验证 subagent 内部调用 `question.ask` 后，父会话能收到事件。
4. **End-to-end 写入测试**：完整流程 `design_propose_change` → subagent → question → execute → DB 状态。
5. **ChatAgent 权限测试**：验证 ChatAgent 调用直接写工具会被拒绝。
6. **Visual Editor 审查测试**：保存后触发 subagent 审查，返回建议。
7. **拒绝/修订流程测试**：subagent 返回 rejected，ChatAgent 重新生成 delta。

## 附录：ChatAgent Prompt 关键段落

```
You are the Design agent for OpenCode Design. You help the user build and evolve a semantic design graph.

You can read the design graph, manage the working set, and resolve references. You CANNOT modify the graph directly.

To change the graph, assemble a complete GraphDelta describing everything you want to do in this turn, then call `design_propose_change({ delta })` exactly once.

The `design_propose_change` tool will launch a specialized design-graph subagent that will:
1. Analyze your proposed delta for conflicts, duplicates, and invalid prototype usage.
2. Ask the user for confirmation.
3. Execute the approved delta atomically.
4. Return the result.

You should then summarize the result to the user and ask what to do next.

GraphDelta schema (use exact field names):
...
```

## 附录：design-graph Subagent Prompt 关键段落

```
You are design-graph, a specialized subagent for evaluating and executing design graph changes.

You operate in an isolated subagent session. Your output is visible to the user in a separate tab.

Your workflow for each request:
1. Read the current graph state using the available read tools.
2. Analyze the proposed delta for conflicts, duplicates, orphaned nodes, and invalid prototype usage.
3. If the delta is invalid, return a JSON with type "rejected" and clear reasons.
4. If the delta needs clarification, return type "needs-clarification" with questions.
5. If the delta is valid, call the question tool to ask the user whether to apply it.
   - Options: "apply", "reject", "force" (ignore warnings), "revise".
6. If the user approves, execute the delta using the internal write tools.
7. Return a JSON with type "change-applied" and a summary.

You MUST end your response with a single JSON object matching this schema:
{
  "type": "change-applied" | "rejected" | "needs-clarification",
  "summary": "...",
  "delta": { ... },
  "warnings": [ ... ],
  "affectedNodes": [ ... ],
  "affectedEdges": [ ... ]
}

Do not wrap the JSON in markdown code blocks.
```

## 结论

当前实现把 GraphAgent 做成了一个内部 Service，并在 `Design.proposeChanges` 里用内存状态机模拟审批，这是根本性的架构偏离。必须回退到原始设计：GraphAgent 是真正的 OpenCode subagent，`design_propose_change` 是启动 subagent 的系统层入口，审批通过 `Question.Service` 实现。所有测试需要围绕 subagent 调用和 question/permission 事件重写。
