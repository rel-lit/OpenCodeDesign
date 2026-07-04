# Design 模式架构重写规范（第二版）

> 日期：2026-07-04
> 状态：规范 / 待实现
> 取代文档：
> - `2026-07-01-design-multi-agent-architecture.md`
> - `2026-07-03-design-tool-split-design.md`
> - `2026-07-04-graphagent-subagent-direction.md`
> - `2026-07-04-design-architecture-rewrite.md`

## 项目愿景

Design 模式不是让 LLM 直接管理一个图数据库。它是把**设计知识**以图的形式持久化，让 Agent 系统能够：

1. 记住用户和 Agent 在设计对话中形成的概念、关系、原则。
2. 在后续对话中召回相关知识，辅助理解用户意图。
3. 把设计意图转化为可执行的图变更。
4. 让设计过程对用户可见、可审计、可迭代。

**图是设计知识的载体，不是目的本身。**

ChatAgent 面向用户，负责对话、理解、决策。它不需要知道图中有哪些节点和边，它需要的是**设计认知**——即图所代表的设计意义。

GraphAgent 是 ChatAgent 的设计认知外脑。它是唯一能直接理解图、分析图、把图转译为设计语言的 Agent。

## 核心原则

1. **ChatAgent 不直接读图、不直接写图、不直接管理图。**
2. **所有图操作必须由 GraphAgent 发起或执行。**
3. **GraphAgent 返回给 ChatAgent 的永远是设计认知（自然语言 + 结构化洞察），不是原始图数据。**
4. **活跃工作集是 GraphAgent 的 Cache，由系统自动控制。**
5. **审批是系统级写入闸门，由 ChatAgent 作为编排层在父会话中驱动。**
6. **审批通过后，ChatAgent 用 GraphAgent 审批阶段附带的结构化 delta 调用执行模式，减少 LLM 理解差异的影响。**
7. **每次成功的图变更都产生逻辑版本，并刷新 ChatAgent 对设计的认知。**

## Agent 角色

### ChatAgent（Design 主 Agent）

- 唯一与用户对话的 Agent。
- 理解用户需求，引导设计讨论。
- 需要设计认知时，向 GraphAgent 提问。
- 想要修改设计时，用自然语言描述变更意图，交给 GraphAgent。
- 整合 SearchAgent 返回的项目/网络信息。
- 在实现阶段将设计交接给 Plan/Edit 模式。

### GraphAgent（Design 子 Agent）

- ChatAgent 的设计认知外脑。
- 运行在独立 subagent 会话中，过程对用户可见。
- 职责：
  1. **设计认知供给**：根据 ChatAgent 的问题，在图中分析相关概念，返回自然语言摘要和洞察。
  2. **设计分析**：检查命名冲突、关系合理性、原则一致性、可合并项、隐含关系等。
  3. **变更提案（judge 模式）**：把 ChatAgent 的自然语言意图转化为结构化图操作提案（含 GraphDelta），并解释设计理由。不执行写入。
  4. **执行写入（execute 模式）**：用户确认后，基于已审批的 GraphDelta 写入图数据库。
  5. **后置审查**：Visual Editor 直接保存后，审查改动并给出建议。

### GraphAgent 子职责

GraphAgent 是同一个 subagent（`design-graph`），但根据调用时的 `mode` 承担不同职责：

#### 1. 认知模式（`cognition`）

- 触发：ChatAgent 调用 `design_ask_graph`。
- 输入：自然语言问题 + 活跃工作集快照。
- 行为：读图、扩展临时工作集、分析相关概念、返回设计认知。
- 输出：`cognition` 类型结果，包含 `summary` 和 `insights`。

#### 2. 审批模式（`judge`）

- 触发：ChatAgent 调用 `design_request_change`。
- 输入：自然语言变更意图 + 活跃工作集快照 + 当前图版本。
- 行为：
  1. 读图分析。
  2. 把自然语言意图转化为结构化 GraphDelta。
  3. 检查冲突、重复、孤立、无效原型使用。
  4. 返回 `change-proposal` 类型结果，包含 `proposal`（含 `delta`）。
- **不执行写入，也不直接向用户提问。**

#### 3. 执行模式（`execute`）

- 触发：ChatAgent 在父会话审批通过后调用 `design_execute_change(proposal.delta)`。
- 输入：已经审批通过的结构化 GraphDelta。
- 行为：
  1. 基于给定的 delta 调用写工具（仍然需要 LLM 进行工具调用决策，但不再重新理解意图或生成新设计）。
  2. 通过 `Design.applyRawDelta` 写入数据库。
  3. bump version。
- 输出：`change-applied` 类型结果。

#### 4. 摘要模式（`summarize`）

- 触发：ChatAgent 调用 `design_summarize_design`。
- 输入：活跃工作集快照。
- 行为：基于活跃工作集生成自然语言摘要。
- 输出：`cognition` 类型结果，摘要形式。

#### 5. 审查模式（`review-save`）

- 触发：Visual Editor 保存后，系统通知 ChatAgent，ChatAgent 调用 `design_ask_graph`。
- 输入：保存产生的 diff + 保存后图状态。
- 行为：审查改动，返回设计建议。
- 输出：`cognition` 类型结果。

### GraphAgent 权限

GraphAgent subagent 拥有所有设计图工具的权限，包括读工具和写工具：

```typescript
const designGraphPermissions = Permission.fromConfig({
  "*": "deny",

  // 读工具
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

  // 写工具
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

  // 引用解析
  design_resolve_reference: "allow",

  // 向用户提问（GraphAgent 各模式均不直接使用；审批问题由 ChatAgent 根据 GraphAgent 返回值在父会话中发起）
  question: "allow",
})
```

注意：禁止 `task`（防止递归）和 `todowrite`。`design_execute_change` 的 delta 来自 `design_request_change` 的审批结果，不是自然语言。

### SearchAgent（检索子 Agent）

- 接收 ChatAgent 的检索意图 + 当前设计摘要（由 GraphAgent 生成）。
- 搜索项目代码、网络资源，完成对比分析。
- 返回自然语言报告，不直接修改图。

## 活跃工作集：Cache 模型

活跃工作集是 GraphAgent 分析图时的"工作内存"，类似 CPU Cache。

```
活跃工作集 = LRU Cache
- capacity: 20（可配置）
- line: 一个上下文或节点
- 命中: 被查询、被修改、被扩展到的节点/上下文
- prefetch: 激活一个节点时，连带激活其相邻节点和所属上下文
- 淘汰: 超出容量时，淘汰最近最少使用的
- 写策略: 无需写回，因为激活状态只影响分析焦点，不改变图本身
```

### 触发激活的事件

1. 用户输入中提到 `@节点名` / `@上下文名`。
2. ChatAgent 向 GraphAgent 请求某个主题的认知。
3. GraphAgent 在分析中读取或修改了某节点。
4. GraphAgent 沿着关系扩展分析时遇到相邻节点。
5. Visual Editor 当前选中的节点/上下文。
6. SearchAgent 返回的差异分析中提到的节点。

### 系统自动控制

- 活跃工作集由系统层维护，不是 ChatAgent 的工具。
- ChatAgent 不需要知道活跃工作集的内容。
- GraphAgent 可以看到当前活跃工作集，作为分析的初始 Cache。
- 用户输入被解析后，其中涉及的概念、@ 引用、关键词会触发对应图节点的调用/激活，导致活跃工作集变化。
- 用户可以在 GUI 侧边栏看到活跃工作集，但不需要手动管理；手动调整只作为 Cache 初始状态的补充信号。

## ChatAgent 工具集（重新设计）

ChatAgent 只应该有"向专业 subagent 发请求"的工具，不应该有直接操作图的工具。

| 工具名 | 作用 | 底层实现 |
|---|---|---|
| `design_ask_graph` | 向 GraphAgent 请求设计认知。例如："当前设计如何理解空间维度？" | `task({ subagent_type: "design-graph" })`，mode=`cognition` |
| `design_request_change` | 用自然语言描述变更意图。例如："我觉得空间维度应该划分为前方、侧翼、后方" | `task({ subagent_type: "design-graph" })`，mode=`judge` |
| `design_execute_change` | 执行已审批的图变更。传入的是 judge 模式返回的结构化 delta。 | `task({ subagent_type: "design-graph" })`，mode=`execute` |
| `design_summarize_design` | 请求 GraphAgent 返回当前设计的自然语言摘要 | `task({ subagent_type: "design-graph" })`，mode=`summarize` |
| `design_search_project` | 请求 SearchAgent 检索项目并对比设计 | `task({ subagent_type: "design-search" })` |
| `design_search_web` | 请求 SearchAgent 联网搜索 | `task({ subagent_type: "design-search" })` |
| `design_transition_to_plan` | 触发 Design → Plan 模式切换 | 系统层处理 |

### 明确删除的工具

以下当前存在的工具不应再暴露给 ChatAgent：

- `design_get_state`
- `design_list_contexts`, `design_get_context`
- `design_list_nodes`, `design_get_node`, `design_find_nodes_by_name`
- `design_list_edges`
- `design_list_prototypes`, `design_get_prototype`
- `design_show_working_set`
- `design_activate_context`, `design_activate_node`
- `design_resolve_reference`
- `design_propose_change`（被 `design_request_change` 取代）
- 所有 `design_create_*` / `design_update_*` / `design_delete_*`（本来就不应给 ChatAgent）

## GraphAgent 输入

GraphAgent 作为 subagent，接收一个自然语言请求 + 系统层提供的上下文。

```typescript
interface DesignGraphSubagentInput {
  // 请求类型，决定 GraphAgent 以什么模式工作
  mode: "cognition" | "judge" | "execute" | "summarize" | "review-save"

  // ChatAgent 的自然语言请求
  request: string

  // 当前活跃工作集（Cache 快照）
  activeWorkingSet: {
    contextIds: string[]
    nodeIds: string[]
    capacity: number
  }

  // 当前已知图版本
  // 用于检测 GraphAgent 读图期间图是否被其他来源修改
  knownVersion?: number

  // 仅在 execute / review-save 模式下需要
  proposedChange?: GraphDelta

  // 仅在 review-save 模式下需要
  visualEditorDelta?: GraphDelta
}
```

### 不同模式说明

| 模式 | 触发方式 | GraphAgent 行为 |
|---|---|---|
| `cognition` | `design_ask_graph` | 分析问题，在图中寻找相关概念，返回设计认知 |
| `judge` | `design_request_change` | 把自然语言意图转成结构化变更提案（含 delta），不执行 |
| `execute` | `design_execute_change(delta)` | 基于已审批的 delta 调用写工具执行变更 |
| `summarize` | `design_summarize_design` | 基于活跃工作集生成自然语言摘要 |
| `review-save` | Visual Editor 保存后 | 审查已发生的改动，返回建议 |

## GraphAgent 输出

GraphAgent 返回的是设计认知，不是原始图数据。

```typescript
interface DesignGraphSubagentOutput {
  type:
    | "cognition"           // 返回设计认知
    | "change-proposal"     // 返回变更提案，等待确认
    | "change-applied"      // 已执行变更
    | "rejected"            // 请求被拒绝或不可行
    | "needs-clarification" // 需要用户澄清

  // 面向 ChatAgent 的自然语言摘要
  summary: string

  // 结构化洞察，便于 ChatAgent 引用
  insights?: Array<{
    kind: "concept" | "relation" | "principle" | "warning" | "suggestion"
    subject?: string        // 概念名/节点名
    description: string     // 描述
    references?: string[]   // 引用的节点 ID（GraphAgent 内部使用，ChatAgent 不需要理解）
  }>

  // judge 模式返回的结构化提案
  proposal?: {
    intent: string          // 设计意图
    rationale: string       // 设计理由
    warnings: Array<{
      code: string
      message: string
      nodeId?: string
      edgeKey?: string
    }>
    affectedNodes: string[]
    affectedEdges: string[]
    delta: GraphDelta       // 已审批通过的结构化 delta，execute 模式直接使用
  }

  // 需要澄清的问题
  questions?: string[]
}
```

### 示例：空间维度认知请求

**ChatAgent 调用 `design_ask_graph`，请求：**

```
用户提到"空间维度"，请分析当前设计中与此相关的设计认知。
```

**GraphAgent 返回：**

```json
{
  "type": "cognition",
  "summary": "当前设计中，'方向'被认为应该'有意义'。'意义'与'小数值'相关，而'小数值'的描述强调'清晰可感，影响有意义'。基于此，空间维度可以按'方向有意义'这一原则划分为前方、侧翼、后方。",
  "insights": [
    {
      "kind": "concept",
      "subject": "方向",
      "description": "方向应该有意义，不只是几何方向"
    },
    {
      "kind": "relation",
      "subject": "意义",
      "description": "意义与小数值相关联"
    },
    {
      "kind": "principle",
      "subject": "空间维度",
      "description": "可以按方向有意义的原则，将空间划分为前方、侧翼、后方",
      "references": ["node-direction", "node-meaning", "node-small-value"]
    }
  ]
}
```

ChatAgent 收到后，用自然语言向用户解释，不需要知道节点 ID。

## 数据流

### 设计认知请求

```
用户："我们考虑一下空间维度"
  → ChatAgent：用户想讨论空间维度，我没有相关认知
    → ChatAgent 调用 design_ask_graph("用户提到空间维度，请分析相关设计认知")
      → 系统层：构建临时工作集（从活跃工作集 + @引用开始）
        → task({ subagent_type: "design-graph", mode: "cognition" })
          → design-graph subagent 读取图，动态扩展临时工作集
            → 发现 方向 → 意义 → 小数值 的关联
              → 返回 cognition 输出
                → ChatAgent 解释给用户
                  → 用户继续对话
```

### 设计变更请求

```
用户："空间维度可以按前后左右来设计吗？"
  → ChatAgent：用户想修改设计
    → ChatAgent 调用 design_request_change("将空间维度按方向有意义的原则划分为前方、侧翼、后方")
      → 系统层：构建临时工作集
        → task({ subagent_type: "design-graph", mode: "judge" })
          → GraphAgent 审批模式分析意图
            → 生成结构化 delta + 设计理由
              → 返回 change-proposal
                → ChatAgent 在父会话展示审批面板
                  → 用户选择 "重新设计"
                    → ChatAgent 与用户沟通，重新生成意图
                    → 再次调用 design_request_change
                  → 用户选择 "同意"
                    → ChatAgent 调用 design_execute_change(proposal.delta)
                      → task({ subagent_type: "design-graph", mode: "execute" })
                        → GraphAgent 执行模式
                          → 基于 delta 调用写工具
                            → Design.applyRawDelta(delta)
                              → bump version
                                → 返回 change-applied
                                  → ChatAgent 总结结果
```

### 图摘要请求

```
ChatAgent 调用 design_summarize_design()
  → task({ subagent_type: "design-graph", mode: "summarize" })
    → GraphAgent 基于活跃工作集生成自然语言摘要
      → 返回给 ChatAgent
```

### Visual Editor 保存后审查

```
用户在 Visual Editor 修改并保存
  → 系统层直接写 DB
    → 系统层通知 ChatAgent 有未审查变更
      → ChatAgent 调用 design_ask_graph("审查最近的 Visual Editor 保存")
        → task({ subagent_type: "design-graph", mode: "review-save" })
          → GraphAgent 审查改动
            → 返回设计建议
              → ChatAgent 与用户讨论
```

## 工具实现细节

### `design_ask_graph`

```typescript
interface DesignAskGraphParameters {
  question: string  // ChatAgent 的自然语言问题
}
```

实现：

```typescript
execute: (args, ctx) =>
  Effect.gen(function* () {
    const activeWs = yield* getActiveWorkingSet()
    const prompt = buildGraphAgentPrompt({
      mode: "cognition",
      request: args.question,
      activeWorkingSet: activeWs,
      knownVersion: yield* getCurrentVersion(),
    })
    const result = yield* taskTool.execute({
      subagent_type: "design-graph",
      description: "Design cognition",
      prompt,
    }, ctx)
    const output = parseGraphAgentOutput(result.output)
    return {
      title: "Design cognition",
      output: output.summary,
      metadata: { output },
    }
  })
```

### `design_request_change`

```typescript
interface DesignRequestChangeParameters {
  intent: string  // 自然语言变更意图
}
```

实现：

```typescript
execute: (args, ctx) =>
  Effect.gen(function* () {
    const activeWs = yield* getActiveWorkingSet()
    const prompt = buildGraphAgentPrompt({
      mode: "judge",
      request: args.intent,
      activeWorkingSet: activeWs,
      knownVersion: yield* getCurrentVersion(),
    })
    const result = yield* taskTool.execute({
      subagent_type: "design-graph",
      description: "Design change proposal",
      prompt,
    }, ctx)
    const output = parseGraphAgentOutput(result.output)
    return {
      title: "Design change proposal",
      output: output.summary,
      metadata: { output },
    }
  })
```

### `design_summarize_design`

```typescript
interface DesignSummarizeDesignParameters {}
```

实现类似，mode 为 `summarize`。

## 审批机制

审批是**系统级写入闸门**，由 ChatAgent 作为编排层在**父会话**中驱动。

### 审批流程

1. ChatAgent 调用 `design_request_change(intent)`。
2. GraphAgent 以 `judge` 模式分析意图，返回 `change-proposal`，其中包含结构化 `proposal.delta`。
3. ChatAgent 根据返回的 `proposal` 在父会话通过 `question.ask` 发起审批面板，展示 `proposal.intent` 和 `proposal.rationale`。
4. 用户选择：
   - **Apply**：ChatAgent 调用 `design_execute_change(proposal.delta)`，进入 GraphAgent `execute` 模式。
   - **Reject**：ChatAgent 向用户说明变更被拒绝。
   - **Revise**：ChatAgent 继续与用户沟通，重新生成意图，再次调用 `design_request_change`。

### 为什么 GraphAgent 不直接提问

- v2 架构中，GraphAgent 只负责返回设计认知和结构化提案，不直接驱动用户界面。
- ChatAgent 作为编排层，根据 GraphAgent 返回的 `proposal` 决定如何与用户交互。
- 这样审批面板的问题内容、选项、展示方式由 ChatAgent 控制，更灵活，也符合原始架构中"审批面板是系统 UI"的定位。

### 问题设计

```typescript
{
  questions: [{
    header: "Apply design change",
    question: proposal.intent + "\n\n" + proposal.rationale,
    options: [
      { label: "Apply", description: "Apply this design change" },
      { label: "Reject", description: "Reject this design change" },
      { label: "Revise", description: "Let me revise the request" }
    ],
    custom: true  // 允许用户输入修改意见
  }]
}
```

### 执行模式说明

- 执行模式接收已经审批通过的结构化 delta。
- 执行模式仍然需要 LLM 进行工具调用决策（决定调用哪些设计工具以及调用顺序）。
- 但执行模式不再重新理解意图或生成新的设计，而是基于已审批的 delta 进行工具调用。
- 这样可以减少 LLM 理解差异对执行结果的影响，但不能完全消除。

## 权限设计

### design-graph subagent 权限

```typescript
const designGraphPermissions = Permission.fromConfig({
  "*": "deny",

  // 允许直接调用 Design.Service 工具（GraphAgent 内部使用）
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
  design_resolve_reference: "allow",

  // 允许向用户提问
  question: "allow",
})
```

注意：仍然禁止 `task`（防止递归）和 `todowrite`。

### ChatAgent（design）权限

```typescript
const designChatPermissions = Permission.fromConfig({
  // ChatAgent 只能向 subagent 发请求
  design_ask_graph: "allow",
  design_request_change: "allow",
  design_summarize_design: "allow",
  design_search_project: "allow",
  design_search_web: "allow",
  design_transition_to_plan: "allow",

  // 所有直接图工具都禁止
  design_get_state: "deny",
  design_list_contexts: "deny",
  design_get_context: "deny",
  design_list_nodes: "deny",
  design_get_node: "deny",
  design_find_nodes_by_name: "deny",
  design_list_edges: "deny",
  design_list_prototypes: "deny",
  design_get_prototype: "deny",
  design_show_working_set: "deny",
  design_activate_context: "deny",
  design_activate_node: "deny",
  design_resolve_reference: "deny",
  design_propose_change: "deny",
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

注意：ChatAgent 必须被允许 `task` 以调用 subagent。

## 系统层职责

### 1. 构建临时工作集

每次向 GraphAgent 发起请求前，系统层根据以下信息构建初始临时工作集：

- 当前活跃工作集（Cache 快照）
- 用户输入中的 @ 引用
- ChatAgent 请求中的关键词

临时工作集交给 GraphAgent 作为初始 Cache。GraphAgent 可以在分析中动态扩展。

### 2. 注入系统辅助分析

在临时工作集构建后，运行自动化检查：

- 冲突关系检测
- 重复节点候选
- 孤立节点
- 无效原型使用

结果填充到 `systemAnalysis` 区域，供 GraphAgent 读取。

### 3. @ 引用展开

识别用户输入中的 `@Identifier` 或 `@节点名`，展开为节点摘要。

### 4. 阈值判断

决定是否将输入交给 GraphAgent 预处理。例如：

- 输入中包含图相关关键词 → 交给 GraphAgent
- 输入过短且没有 @ 引用 → 直接给 ChatAgent
- 活跃工作集为空且输入不含设计关键词 → 直接给 ChatAgent

### 5. 版本同步

每次图变更后：

- bump 版本。
- 更新活跃工作集（根据变更自动激活相关节点）。
- 清除 Visual Editor 脏标记（如果存在）。
- 通知 ChatAgent 设计已更新。

### 6. 处理后输入展示

把经过系统层处理后的用户输入以可折叠形式展示给用户。

## 与 Visual Editor 的关系

Visual Editor 仍然直接写 DB（raw save），因为 GUI 操作本身已是用户意图的直接表达。

保存后：

1. 系统层直接写 DB。
2. 系统层设置**脏标记**（`visual_editor_dirty`），表示设计图自 ChatAgent 上次认知刷新后已被修改。
3. 在新一轮 ChatAgent 提示词中注入脏标记，提醒 ChatAgent 当前设计认知可能过期。
4. ChatAgent 调用 `design_ask_graph` 或 `design_summarize_design` 重新建立对图设计的认知。
5. GraphAgent 在 `review-save` 或 `summarize` 模式下分析，返回最新设计状态和建议。
6. ChatAgent 与用户讨论是否需要进一步调整。

## 日志插入点

由于本架构涉及 subagent 调用、question 事件、版本同步等复杂交互，采用真实 GUI 测试 + 结构化日志验证。

| 位置 | 日志 |
|---|---|
| `design_ask_graph` 入口 | `design.ask_graph.start question=...` |
| `design_request_change` 入口 | `design.request_change.start intent=...` |
| `design_summarize_design` 入口 | `design.summarize_design.start` |
| `design_execute_change` 入口 | `design.execute_change.start deltaKeys=...` |
| 启动 subagent | `design.subagent.launch mode=... subagent_type=design-graph` |
| subagent 收到 prompt | `design-graph.subagent.start mode=... activeNodes=N` |
| subagent 读图 | `design-graph.read tool=... args=...` |
| subagent 扩展工作集 | `design-graph.workset.expand addedNodes=... reason=...` |
| subagent 调用 question | `design-graph.question.ask options=...` |
| subagent 执行写工具 | `design-graph.write tool=...` |
| `applyRawDelta` | `design.applyRawDelta addNodes=N addEdges=M ...` |
| 版本 bump | `design.version.bumped sequence=N source=...` |
| subagent 返回 | `design-graph.subagent.output type=... summary=...` |
| 活跃工作集更新 | `design.workset.updated activeNodes=N` |

## 实现路线图

### 阶段 1：清理 ChatAgent 工具

1. 从 `ToolRegistry` 中删除所有面向 ChatAgent 的旧 design 工具。
2. 删除 `src/tool/design.ts` 中的 ChatAgent 工具定义。
3. 保留 `Design.Service` 方法不变（底层仍可用）。
4. 保留 `GraphAgentDesignTools` 或等价的内部工具集（供 GraphAgent subagent 使用）。

### 阶段 2：新增 ChatAgent 工具

1. 实现 `design_ask_graph`。
2. 实现 `design_request_change`。
3. 实现 `design_summarize_design`。
4. 实现 `design_search_project` / `design_search_web`（复用 SearchAgent）。
5. 在 `ToolRegistry` 中注册新工具。

### 阶段 3：重写 design-graph subagent

1. 重写 `src/design/agent/prompt/graph.txt`：
   - 明确 subagent 是 ChatAgent 的设计认知外脑。
   - 说明四种工作模式。
   - 说明可用工具集。
   - 强制最终输出为 JSON。

2. 调整 `design-graph` 权限：允许所有 `Design.Service` 读/写工具和 `question`。

3. 实现 subagent 内部逻辑：
   - 解析 prompt 中的 mode。
   - `cognition` 模式：读图、扩展工作集、返回洞察。
   - `judge` 模式：把自然语言意图转成结构化 delta + 设计理由，不执行。
   - `execute` 模式：基于已审批的 delta 调用写工具执行。
   - `summarize` 模式：基于工作集生成摘要。
   - `review-save` 模式：审查 Visual Editor diff。

### 阶段 4：接入系统层预处理

1. 实现临时工作集自动构建。
2. 实现活跃工作集 Cache 自动管理。
3. 完善系统辅助分析。
4. 实现 @ 引用展开和阈值判断。
5. 接入版本同步。

### 阶段 5：Visual Editor 保存后审查

1. Visual Editor 保存后调用 `Design.applyRawDelta`。
2. 系统层通知 ChatAgent。
3. ChatAgent 自动调用 `design_ask_graph` 让 GraphAgent 审查。

### 阶段 6：测试

1. 删除基于错误实现的 mock 测试。
2. 用真实 GUI 测试 + 日志验证主要流程。
3. 在关键流程稳定后，补充端到端自动化测试。

### 阶段 7：验证

1. `bun run typecheck`
2. `bun test test/design`（重写后）
3. `bun test test/tool/design.test.ts`（重写后）
4. `bun run build --single`
5. 真实 GUI 测试

## 已知未完全实现 / 后续任务

### 指代消解与模糊引用解析

当前 v2 规范假设系统层预处理足够：@ 引用展开、关键词匹配、活跃工作集命中。

但原始架构要求更深入的消歧能力，这些应该最终交给 GraphAgent：

1. **无 @ 的模糊概念引用**：用户说"方向"但没有 @，图中存在"方向"节点。系统层可能无法识别，需要 GraphAgent 根据对话上下文判断是否应纳入临时工作集。
2. **指代消解**：用户说"这个""那个""它"等。系统层无法确定指代对象，需要 GraphAgent 结合活跃工作集和最近讨论主题推断。
3. **隐式关联扩展**：用户提到一个概念，GraphAgent 应该能发现图中与之语义相关但未显式提及的节点。

实现路径：
- 短期：系统层做基础 @ 展开 + 关键词匹配。
- 中期：GraphAgent 在 `cognition` 和 `propose-change` 模式下，分析请求文本，主动搜索可能相关的节点并动态扩展工作集。
- 长期：引入对话状态追踪，让 GraphAgent 维护当前讨论焦点，提升指代消解准确率。

本任务不阻塞 v2 的主要架构回归，但应在 ChatAgent/GraphAgent 基础流程跑通后优先补充。

## ChatAgent Prompt 关键段落

```
You are the Design agent for OpenCode Design.

Your job is to talk with the user about the design of their project. You do NOT directly read or modify the design graph.

Instead, you have specialized subagents:
- `design_ask_graph`: Ask the design-graph subagent for design cognition. Use this when you need to understand what the current design means.
- `design_request_change`: Ask the design-graph subagent to propose a design change. Describe the change in natural language. The subagent will return a structured proposal; you must then ask the user for approval before calling `design_execute_change`.
- `design_execute_change`: Execute an already-approved design change. Only call this after the user has approved a proposal returned by `design_request_change`.
- `design_summarize_design`: Ask the design-graph subagent for a summary of the current design.
- `design_search_project`: Ask the search subagent to read the project and compare it with the design.
- `design_search_web`: Ask the search subagent to search the web for relevant design references.

The design graph is maintained by the design-graph subagent. It will analyze the graph, find relevant concepts, check for conflicts, propose changes, and execute changes after user approval.

When the user talks about design concepts, always use `design_ask_graph` to get the current design cognition before responding.

When the user wants to change the design, use `design_request_change` to get a proposal, then present the proposal to the user. If the user approves, call `design_execute_change` with the delta from the proposal.
```

## design-graph Subagent Prompt 关键段落

```
You are design-graph, the design cognition subagent.

You maintain a semantic graph of design knowledge on behalf of the Design agent. The graph is a better form of design documentation.

Your users are:
1. ChatAgent: the main conversation agent. It does not read the graph directly. It asks you for design cognition.
2. System layer: it may ask you to review changes from the Visual Editor.

You work in one of these modes:
- cognition: Answer a design question by analyzing the graph. Return natural language insights.
- judge: Convert a natural language design intent into a structured change proposal (including a GraphDelta and rationale). Do NOT execute any writes.
- execute: Receive an already-approved GraphDelta and execute it using the design graph write tools.
- summarize: Generate a natural language summary of the current design based on the active working set.
- review-save: Review a diff from the Visual Editor and return suggestions.

You have access to all design graph tools. Use them to read and modify the graph as needed.

For judge mode:
1. Read the current graph state.
2. Build or extend the temporary working set.
3. Generate a GraphDelta that realizes the user's intent.
4. Check for conflicts, duplicates, orphaned nodes, and invalid prototype usage.
5. Return a JSON result with type "change-proposal". Include the delta in the proposal.

For execute mode:
1. Receive the approved GraphDelta.
2. Use the design graph write tools to execute the delta.
3. Bump the graph version.
4. Return a JSON result with type "change-applied".

Your final response must be a single JSON object matching the output schema. Do not wrap it in markdown.
```

## 结论

当前实现把图当成数据库让 ChatAgent 直接操作，这是根本性的方向错误。图是设计知识的载体，ChatAgent 只需要设计认知。GraphAgent 应该是运行在 subagent 中的设计认知外脑，负责读图、分析、生成洞察、执行变更。活跃工作集是 GraphAgent 的 Cache，由系统自动控制。所有 ChatAgent 的工具都应该重新设计为"向 subagent 发请求"，而不是直接操作图。
