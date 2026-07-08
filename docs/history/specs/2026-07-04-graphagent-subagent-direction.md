# GraphAgent 改进方向：从内部 Service 到原生 Subagent

> 日期：2026-07-04
> 关联文档：
> - `2026-07-01-design-multi-agent-architecture.md`
> - `2026-07-03-design-tool-split-design.md`
> - `../notes/opencode-understanding.md`
> 状态：方向研究 / 待实现

## 背景

当前 GraphAgent 是一个内部 Effect Service（`packages/opencode/src/design/agent/graph.ts`），由 `Design.proposeChanges` 同步调用：

```
Design.proposeChanges(delta)
  ├─→ GraphAgent.analyze(input)   // 内部 LLM 调用
  ├─→ 审批面板（可选）
  └─→ GraphAgent.execute(proposal) // 直接 applyRawDelta
```

这种架构在功能上已经跑通，但有一个根本问题：**GraphAgent 的分析过程、工具调用过程、reasoning 内容对桌面端 GUI 用户完全不可见**。用户只能看到 `design_propose_change` 工具返回的最终 summary，无法审查 GraphAgent 为什么这样改、改了哪些中间步骤、有没有调用其他工具。

OpenCode 提供的官方机制是让 agent 成为 `mode: "subagent"`，通过 `task` 工具调用。Subagent 运行在独立子会话中，所有输出自动持久化并同步到 GUI。

本 spec 研究如何将 GraphAgent 从内部 Service 改造为原生 Subagent，同时保持 Design 模式的权限边界和审批语义。

## 当前实现的问题

### 1. 过程不可见

`GraphAgent.analyze` 和 `execute` 都不产生 Session Part。桌面端时间线里只有一个 `design_propose_change` 的 tool part，显示：

```
Change proposal
<summary>
```

用户无法展开看到：
- GraphAgent 的 reasoning
- GraphAgent 是否调用了读工具验证图状态
- GraphAgent 对冲突/重复/孤立的分析细节
- 最终 delta 是如何被修正的

### 2. 权限边界不清晰

当前 GraphAgent 是内部 Service，没有独立权限。它的能力等于调用它的 ChatAgent 的能力。这意味着：

- 如果 ChatAgent 能写 DB，GraphAgent 也能写。
- 无法单独限制 GraphAgent 只能做分析、不能写 DB。
- 无法让 GraphAgent 拥有读工具（如 `design_get_state`、`design_list_nodes`）而 ChatAgent 没有。

### 3. 审批与执行耦合

当前 `Design.proposeChanges` 自己创建 approval panel、等待用户确认、然后调用 `GraphAgent.execute`。审批逻辑和 GraphAgent 执行逻辑都挤在 `Design.Service` 里：

```ts
const proposal = yield* graphAgent.analyze(input)
if (proposal.type !== "change-proposal") return proposal
const approvalPanel = panel ?? makeApprovalPanel?.()
if (approvalPanel) {
  approvalPanel.propose(proposal)
  const approved = yield* approvalPanel.awaitConfirmation()
  return yield* graphAgent.execute(approved)
}
return yield* graphAgent.execute(proposal)
```

如果 GraphAgent 是 subagent，审批流程应该由 ChatAgent 在**子会话结果返回后**触发，而不是在 `Design.Service` 内部硬编码。

### 4. 结果格式脆弱

当前 `GraphAgent.analyze` 返回 `GraphAgentTypes.Output` 对象，由 `generateObject` 直接解析。这个对象要承载：
- 自然语言 summary
- warnings / suggestions
- affected nodes / edges
- questions
- delta

所有信息都塞进一个 schema，扩展性差，也不容易在 GUI 中分块展示。

### 5. 临时工作集传递不自然

当前 `proposeChanges` 把整个 `graphState` 和临时工作集打包进 `GraphAgentTypes.Input`。这要求 ChatAgent 在调用 `design_propose_change` 之前，系统已经构建好了完整输入。

如果 GraphAgent 是 subagent，它应该能自己调用读工具查询图状态，而不是依赖父 agent 预加载所有上下文。

## 目标

1. **让 GraphAgent 工作过程在 GUI 中可见**。
2. **让 GraphAgent 拥有独立权限和工具集**。
3. **把审批流程从 `Design.Service` 解耦到 ChatAgent / 子会话结果处理中**。
4. **保持 chat-initiated 图修改必须经过显式用户批准**。
5. **保持 GraphAgent 是图 DB 写的唯一执行者**。
6. **让临时工作集和图状态查询由 GraphAgent 自己完成**。

## 非目标

- 不改 Visual Editor 的直接保存路径（仍走 `Design.applyRawDelta`，GraphAgent 事后审查）。
- 不改 SearchAgent 的职责边界。
- 不改 SQLite/EventLog/版本同步底层。
- 不立即实现后台/并发 subagent（先用前台同步模式）。

## 推荐方向：方向 A — GraphAgent 作为原生 Subagent

### 高层架构

```
ChatAgent（主会话，可见）
  │
  ├─→ 读图 / 工作集 / resolve reference
  │
  └─→ task({ subagent_type: "design-graph", prompt: "..." })
            │
            ▼
      子会话：design-graph（独立标签页，用户可见）
            │
            ├─→ reasoning / tool calls / 读图验证
            ├─→ question.ask 请求用户确认（若需要）
            │
            └─→ 最终 text part：结构化 JSON proposal
            │
            ▼
      ChatAgent 解析子会话返回的 proposal
            │
            ▼
      若用户已批准：ChatAgent 调用 design_propose_change(delta)
                    │
                    ▼
              GraphAgent.execute? 不再需要 —— applyRawDelta 即可
```

注意：这里有两种子模式，需要选择其一。

### 子方向 A1：Subagent 只返回 delta proposal，审批和执行在父会话

```
ChatAgent
  └─→ task("design-graph", "分析这个变更意图并返回结构化 delta")
         └─→ design-graph 子会话分析、验证、返回 JSON delta
ChatAgent
  └─→ question.ask({ 是否应用此 delta？ })
  └─→ design_propose_change(delta)  // 父会话直接执行 applyRawDelta
```

优点：
- 审批面板在主会话，状态集中。
- ChatAgent 控制是否执行，符合当前 `design_propose_change` 语义。
- 子 agent 没有写 DB 权限，权限边界最清晰。

缺点：
- 用户需要在子会话看分析，再回到父会话审批，体验略分裂。
- 如果 delta 需要多轮澄清，要在父/子会话之间来回。

### 子方向 A2：Subagent 内部完成审批并返回执行结果

```
ChatAgent
  └─→ task("design-graph", "分析、请求用户确认、并执行此 delta")
         └─→ design-graph 子会话分析
         └─→ question.ask({ 是否应用？ })
         └─→ design_propose_change 或 GraphAgent 内部工具执行
         └─→ 返回执行结果给父会话
```

优点：
- 子会话是完整的工作单元，闭环可见。
- 适合复杂变更的多轮澄清。

缺点：
- 审批状态分散在子会话。
- 子 agent 需要被授予 `design_propose_change` 或内部写工具权限，增加了权限泄漏风险。
- 父 agent 对最终是否写入的控制变弱。

**推荐 A1**。理由：
- 与现有 `design_propose_change` 工具语义一致。
- 写 DB 的权限保留在父 agent（ChatAgent），但 ChatAgent 只能通过 `design_propose_change` 写，而 `design_propose_change` 内部仍然经过 GraphAgent execute。
- 等等——如果 A1 里 `design_propose_change` 仍调用内部 GraphAgent.execute，那 GraphAgent 仍是内部 Service。

这里需要澄清一个关键点。

## 关键设计决策

### 决策 1：Subagent 是替代 GraphAgent.analyze，还是替代整个 GraphAgent？

方案 A：Subagent 只替代 `analyze`

```
ChatAgent
  └─→ task("design-graph")  // subagent 做分析，返回 proposal
ChatAgent
  └─→ design_propose_change(delta)  // 内部 GraphAgent.execute 执行
```

- 子会话可见的是分析过程。
- DB 写仍由内部 Service 执行，保持原子性和一致性。
- 实现改动最小。

方案 B：Subagent 替代完整 GraphAgent（分析 + 执行）

```
ChatAgent
  └─→ task("design-graph")  // subagent 分析、请求确认、执行
         └─→ 子会话里直接 applyRawDelta
```

- 子会话可见完整生命周期。
- 但子 agent 必须有写 DB 权限。
- 审批状态在子会话，和当前架构差异大。

**推荐方案 A**：Subagent 替代 `GraphAgent.analyze`，执行仍由内部 `Design.applyRawDelta` 完成。

理由：
1. `applyRawDelta` 是事务性的、和 `Design.Service` 紧耦合的，不应拆到子会话中。
2. 审批面板最好挂在主会话，用户的主交互上下文不变。
3. 子 agent 只需要读工具 + 返回 JSON，权限最小化。

但方案 A 仍有一个问题：如果 `GraphAgent.execute` 保留为内部 Service，那它就不是 subagent。我们需要把 `analyze` 部分做成 subagent，但保留 `execute` 部分为内部 Service。

这正是本 spec 的推荐：**把 GraphAgent 拆分为两个角色**：

- **GraphAnalyzer（subagent）**：负责分析、验证、生成 proposal。运行在子会话中，可见。
- **GraphExecutor（内部 Service）**：负责在 `Design.proposeChanges` 中执行批准的 delta。不可见，但受控。

### 决策 2：Subagent 的输入应该是什么？

当前 `GraphAgent.analyze` 输入是一个大 JSON：

```ts
interface Input {
  source: "chat" | "visual-editor"
  userInput: string
  temporaryWorkingSet: TemporaryWorkingSet
  activeWorkingSet: ActiveWorkingSet
  graphState: DesignTypes.GraphState
  proposedChange?: GraphDelta
  knownVersion?: number
}
```

如果改为 subagent，输入应该更轻量。Subagent 应该自己用读工具查图状态，而不是让父 agent 预加载。

推荐 subagent prompt 输入：

```
User request: <自然语言描述用户想做什么>
Proposed delta (optional): <ChatAgent 已经组装好的 GraphDelta JSON>
Known version: <可选，用于版本同步>

You have access to design read tools. Use them to inspect the graph before making judgments.
```

Subagent 自己调用：
- `design_get_state`
- `design_list_nodes`
- `design_find_nodes_by_name`
- `design_list_edges`
- `design_list_prototypes`
- `design_show_working_set`

它不应该有：
- `design_propose_change`
- `design_create_*` / `design_update_*` / `design_delete_*`
- `design_resolve_reference`（这个会隐式创建节点，需要排除）
- `task`（防止递归）

### 决策 3：Subagent 的输出格式

必须返回结构化 JSON，方便父 agent 解析。建议 schema：

```ts
interface GraphAnalyzerOutput {
  type: "change-proposal" | "rejected" | "needs-clarification"
  summary: string
  delta?: GraphDelta
  warnings: Array<{
    code: string
    message: string
    nodeId?: string
    edgeKey?: string
  }>
  suggestions: Array<{
    action: string
    reason: string
  }>
  questions?: string[]
  affectedNodes?: string[]
  affectedEdges?: string[]
}
```

返回方式：作为子会话最终 `type: "text"` part 的内容。父 agent 解析 JSON。

注意：当前 `task.ts` 取结果的方式是：

```ts
return result.parts.findLast((item) => item.type === "text")?.text ?? ""
```

所以 subagent 必须在最后一条 text part 里输出完整 JSON。可以在 system prompt 中强制要求：

> Your final message must be a single JSON object matching the schema above. Do not include markdown code blocks or explanatory text before or after the JSON.

### 决策 4：审批流程放在哪里？

推荐放在**父会话 ChatAgent** 中：

1. ChatAgent 调用 `task("design-graph")`。
2. 拿到返回的 JSON proposal。
3. 如果 `type === "change-proposal"`：
   - ChatAgent 渲染 summary + warnings + affected nodes/edges。
   - ChatAgent 调用 `question.ask({ 是否应用此 delta？ })`。
   - 如果用户确认：ChatAgent 调用 `design_propose_change(delta)`。
   - `design_propose_change` 内部不再调用 LLM，直接走 `Design.applyRawDelta`（因为 subagent 已经分析过了）。
4. 如果 `type === "rejected"`：ChatAgent 把理由告诉用户，结束。
5. 如果 `type === "needs-clarification"`：ChatAgent 把 questions 抛给用户，结束。

这意味着 `design_propose_change` 的行为需要变化：
- 当前：调用 `GraphAgent.analyze` + 审批面板 + `GraphAgent.execute`。
- 新：直接执行 delta（可能做轻量校验），不再调用 LLM。

或者保留两种模式：
- `design_propose_change(delta, { analyzed: false })`：走完整分析 + 审批。
- `design_propose_change(delta, { analyzed: true })`：跳过分析，直接执行。

更简单的做法：subagent 直接返回一个可以直接执行的 `delta`，`design_propose_change` 信任它并直接 applyRawDelta。

### 决策 5：GraphAgent 内部 Service 是否保留？

保留 `GraphAgent.Service`，但简化其职责：

```ts
export interface Interface {
  // 内部路径：visual editor 直接保存后的事后审查
  readonly analyze: (...) => Effect.Effect<Output, ...>
  readonly execute: (proposal: Output) => Effect.Effect<Output, ...>
}
```

新增：

```ts
export interface AnalyzerSubagent {
  readonly run: (input: { userInput: string; proposedDelta?: GraphDelta }) => Effect.Effect<GraphAnalyzerOutput, ...>
}
```

这个 `AnalyzerSubagent` 通过 `task` 工具实现，不是直接 Service。

### 决策 6：Visual Editor 路径是否受影响？

当前 Visual Editor 直接保存走的是 `Design.applyRawDelta`，不涉及 `GraphAgent.analyze`（或只在保存后异步审查）。这个路径不变。

如果未来要让 Visual Editor 的修改也经过 subagent 分析，可以让 Visual Editor 后端调用 `task("design-graph")`，但这属于后续增强。

## 推荐架构（最终版）

```
┌─────────────────────────────────────────────────────────────┐
│  ChatAgent Session（主会话，用户主要交互）                    │
│                                                              │
│  1. 用户："把 UserService 和 OrderService 连起来"            │
│  2. ChatAgent 组装 delta                                     │
│  3. ChatAgent 调用 task({ subagent_type: "design-graph" })   │
│     prompt 包含用户请求 + proposed delta                     │
│                                                              │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  design-graph Subagent Session（独立标签页，可见）            │
│                                                              │
│  - 读取 graph state                                          │
│  - 分析 delta 是否合法/冲突/重复                             │
│  - 返回结构化 JSON proposal                                  │
│                                                              │
│  工具：design_get_state, design_list_*, design_find_*        │
│  无：design_propose_change, 所有写工具                       │
│                                                              │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  ChatAgent 收到 proposal                                     │
│                                                              │
│  4. 如果 rejected：向用户说明原因                              │
│  5. 如果 change-proposal：                                    │
│     - 渲染 summary + warnings                                │
│     - 调用 question.ask("是否应用此变更？")                   │
│     - 用户确认后调用 design_propose_change(delta)            │
│                                                              │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  design_propose_change（内部执行，无 LLM）                    │
│                                                              │
│  6. 轻量校验 delta 字段                                       │
│  7. Design.applyRawDelta(delta)                              │
│  8. bump version                                             │
│  9. 返回执行结果                                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 权限设计

### design-graph subagent 权限

```ts
const graphAnalyzerPermissions = Permission.fromConfig({
  "*": "deny",
  read: "deny",
  grep: "deny",
  glob: "deny",
  bash: "deny",
  edit: "deny",
  write: "deny",
  task: "deny",
  question: "deny",
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
})
```

注意：`design_resolve_reference` 不给予，因为它会隐式创建节点。

### ChatAgent 权限

ChatAgent 保留 `design_propose_change` 和读/工作集工具，但没有直接写工具。

```ts
const chatAgentDesignPermissions = Permission.fromConfig({
  design_propose_change: "allow",
  design_resolve_reference: "allow",
  design_create_context: "deny",
  design_create_node: "deny",
  design_update_node: "deny",
  design_retire_node: "deny",
  design_delete_node: "deny",
  design_create_edge: "deny",
  design_update_edge: "deny",
  design_delete_edge: "deny",
  design_create_prototype: "deny",
  // ... 读工具 allow
})
```

## 实现步骤

1. **设计 subagent 输出 schema**：在 `src/design/agent/types.ts` 新增 `AnalyzerOutput`。
2. **重写 `design-graph` prompt**：聚焦为"分析 proposed delta 并返回 JSON"，移除执行相关描述。
3. **调整 `design-graph` 权限**：只保留读工具，移除所有写工具。
4. **改造 `Design.proposeChanges`**：
   - 移除 `GraphAgent.analyze` 调用。
   - 直接执行 delta（调用 `applyRawDelta` + bump version）。
   - 保留审批面板参数，但面板语义改为"执行前确认"而非"分析后确认"。
5. **改造 ChatAgent prompt**：
   - 说明"先调用 task(design-graph) 分析，再调用 design_propose_change 执行"。
   - 给出 subagent 输出格式说明。
6. **实现或调整 `task` 调用路径**：
   - 确认 `task` 工具能正确启动 `design-graph` subagent。
   - 确认 `task` 结果能被子会话最终 text part 捕获。
7. **更新测试**：
   - subagent 分析返回正确 JSON。
   - ChatAgent 解析 JSON 后调用 `design_propose_change`。
   - 权限测试验证 design-graph 没有写工具。
8. **验证**：
   - `bun run typecheck`
   - `bun test test/design`
   - `bun test test/tool/design.test.ts`
   - `bun run build --single`

## 风险与对策

| 风险 | 说明 | 对策 |
|---|---|---|
| Subagent 返回非 JSON | LLM 可能输出 markdown 或解释性文字 | system prompt 强制；schema 解析失败时让 ChatAgent 提示用户 |
| 多次往返延迟 | 分析 subagent + 父会话审批 + 执行 = 多轮 | 前台同步执行；未来可考虑后台 |
| 子会话权限过宽 | subagent 拿到写工具会直接写 DB | 严格 permission；测试验证工具列表 |
| 审批体验分裂 | 用户在子会话看分析，回父会话审批 | ChatAgent 在父会话清晰渲染 summary；子会话作为"详情"标签 |
| 旧路径兼容 | Visual Editor 仍走旧路径 | `applyRawDelta` 不变；`proposeChanges` 保留但简化 |

## 与之前 spec 的关系

- `2026-07-01-design-multi-agent-architecture.md`：定义了 ChatAgent/GraphAgent/SearchAgent 职责分工。本 spec 是在该框架下，把 GraphAgent 进一步升级为原生 subagent。
- `2026-07-03-design-tool-split-design.md`：把写工具拆到 GraphAgent 内部。本 spec 继承该拆分，但把 GraphAgent 的分析部分移出到 subagent，执行部分保留在内部 Service。

## 结论

推荐采用**方向 A1**：

- `design-graph` 作为原生 subagent，只负责分析 proposed delta 并返回结构化 proposal。
- ChatAgent 在父会话中根据 proposal 触发用户审批。
- 用户确认后，ChatAgent 调用 `design_propose_change(delta)`。
- `design_propose_change` 内部直接执行 `Design.applyRawDelta`，不再调用 LLM。

这样实现后：
- GraphAgent 的分析过程对用户可见（子会话标签页）。
- 权限边界清晰：subagent 只读，父 agent 只有整组提交入口。
- 审批流程集中在主会话，体验一致。
- 保留事务执行路径在 `Design.Service` 内部，不牺牲一致性。
