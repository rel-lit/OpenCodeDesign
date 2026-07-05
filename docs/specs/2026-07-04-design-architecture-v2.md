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
5. **审批是系统级写入闸门，由 GraphAgent subagent 在子会话中发起；question 事件会自动冒泡到父会话 composer，用户在父会话中作答。**
6. **设计变更审批分为两个阶段：初稿审批（judge）确定变更方向，细化模式（refine）通过 Question 面板逐个敲定细节，终稿提交工具在用户同意后自动提交所有临时变更。**
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
  3. **变更提案与初稿审批（judge 模式）**：把 ChatAgent 的自然语言意图转化为 Change Plan，在子会话中调用审批面板请求用户对变更方向的确认；根据用户选择进入细化、终止或重新分析。
  4. **细化与终稿提交（refine 模式 + 终稿提交工具）**：基于已审批的 Change Plan，通过 Question 面板逐个敲定细节，累积到临时 accumulator，最后通过终稿提交工具请求用户确认并自动落库。
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
  2. 把自然语言意图转化为**变更计划（Change Plan）**——只描述核心设计决策，不展开完整节点/边字段。
  3. 检查冲突、重复、孤立、无效原型使用，并判断是否存在明显问题。
  4. 调用审批面板（`question.ask`）向用户展示变更分析并请求审批。根据是否存在明显问题，提供互斥的"同意变更"或"强行变更"选项。
  5. 根据用户回答：
     - **同意变更**：进入 `refine` 模式，通过 Question 面板逐个敲定细节。
     - **强行变更**：进入 `refine` 模式，但 GraphAgent 在后续细化中被授权自主合理化方案，不反复征求用户意见。
     - **拒绝变更**：终止子 Agent，返回 `rejected` 及 GraphAgent 提供的分析文本；ChatAgent 据此引导用户重新讨论，直到可以发起下一次审批。
     - **修订变更**：基于用户输入的修改建议重新分析，再次调用初稿审批面板。

#### 3. 细化模式（`refine`）

- 触发：由 `judge` 模式在子会话内部调用。初稿审批通过后进入细化阶段。
- 输入：已经审批通过的变更计划（Change Plan）。
- 行为：
  1. 基于已审批的计划，在子会话中通过 Question 面板逐个细节询问用户：
     - 确定每个概念的具体名称、语义描述、别名。
     - 确定每条关系的原型、参数、语义描述。
     - 确定是否需要新建上下文或关系原型。
  2. 每个细节确定后，调用语义化写工具把细节变成图变更，并累积到子会话私有的临时 accumulator。
  3. 所有细节敲定后，调用终稿提交工具，向用户展示所有待提交变更的具体细节。
  4. 根据用户回答：
     - **同意**：工具自动提交临时 accumulator 中所有变更，成功后 bump 版本，返回 `change-applied` 及变更说明文本。
     - **废弃变更，选择退出**：终止子 Agent，返回 `abandoned` 及 GraphAgent 提供的变更细节；临时 accumulator 被丢弃。
     - **修订**：用户必须填写修订内容，提交后 GraphAgent 继续通过 Question 面板敲定修订细节，然后再次调用终稿提交工具。
- 输出：`change-applied` 或 `abandoned` 类型结果。

**为什么分计划、细化和终稿确认**

- 图是高级文档，节点和边包含大量自然语言描述、语义约束、别名等信息。
- 初稿审批时用户只能也没必要审完整 delta；审的是"要不要做这个设计方向"。
- 细化阶段通过 Question 面板逐个敲定具体字段，确保图的质量。
- 终稿审批让用户在变更真正落库前再次确认所有细节，避免误操作。
- 临时 accumulator 保证所有变更要么整体提交，要么整体丢弃。

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
  design_get_design: "allow",
  design_get_context: "allow",
  design_get_concept: "allow",
  design_find_concepts: "allow",
  design_get_relations: "allow",
  design_list_prototypes: "allow",

  // 写工具（语义化）
  design_define_context: "allow",
  design_define_concept: "allow",
  design_refine_concept: "allow",
  design_withdraw_concept: "allow",
  design_relate_concepts: "allow",
  design_withdraw_relation: "allow",
  design_define_relation_prototype: "allow",

  // 引用解析
  design_resolve_reference: "allow",

  // 临时工作集工具（子 Agent 私有）
  design_workset_get: "allow",
  design_workset_add: "allow",
  design_workset_remove: "allow",
  design_workset_expand: "allow",

  // 向用户提问（judge 模式用 question.ask 发起审批）
  question: "allow",
})
```

注意：禁止 `task`（防止递归）和 `todowrite`。

### SearchAgent（检索子 Agent）

- 接收 ChatAgent 的检索意图 + 当前设计摘要（由 GraphAgent 生成）。
- 搜索项目代码、网络资源，完成对比分析。
- 返回自然语言报告，不直接修改图。

## 活跃工作集与临时工作集

### 活跃工作集（Active Working Set）

活跃工作集是系统层维护的共享 Cache，所有 Agent 都能**直接查询**，但只能**间接修改**（通过读图、改图、@引用等行为触发系统层更新）。

```
活跃工作集 = 系统共享 LRU Cache
- capacity: 20（可配置）
- line: 一个上下文或节点
- 命中: 被查询、被修改、被扩展到的节点/上下文
- prefetch: 激活一个节点时，连带激活其相邻节点和所属上下文
- 淘汰: 超出容量时，淘汰最近最少使用的
- 写策略: 由系统层自动维护，Agent 不直接写入
```

#### 触发激活的事件

1. 用户输入中提到 `@节点名` / `@上下文名`。
2. ChatAgent 向 GraphAgent 请求某个主题的认知。
3. GraphAgent 在分析中读取或修改了某节点。
4. GraphAgent 沿着关系扩展分析时遇到相邻节点。
5. Visual Editor 当前选中的节点/上下文。
6. SearchAgent 返回的差异分析中提到的节点。

#### Agent 对活跃工作集的使用

- ChatAgent 不需要知道活跃工作集的内容。
- GraphAgent 可以通过工具查询当前活跃工作集，作为分析的初始 Cache。
- 活跃工作集是**共享状态**：当 GraphAgent 执行写入后，系统层会立即更新活跃工作集，所有后续 Agent 都能看到最新焦点。
- 用户可以在 GUI 侧边栏看到活跃工作集，但不需要手动管理；手动调整只作为 Cache 初始状态的补充信号。

### 临时工作集（Temporary Working Set）

临时工作集是**GraphAgent subagent 会话私有的工作变量**，由 GraphAgent 通过工具控制和查询，不是 prompt 中的死内容。

- 子 Agent 启动时，系统层把当前活跃工作集的快照复制为临时工作集的初始值。
- GraphAgent 在子会话中通过工具扩展、收缩、查询临时工作集。
- 临时工作集只存在于子 Agent 生命周期内，子 Agent 终止后丢弃。
- 它不直接写回活跃工作集；但子 Agent 中的读图/改图行为会间接影响系统层的活跃工作集。

GraphAgent 工具示例：

| 工具名 | 作用 |
|---|---|
| `design_workset_get` | 查询当前临时工作集中的节点/上下文 |
| `design_workset_add(nodes, contexts)` | 把节点/上下文加入临时工作集 |
| `design_workset_remove(nodes, contexts)` | 从临时工作集移除 |
| `design_workset_expand(node)` | 把一个节点的相邻节点加入临时工作集 |

ChatAgent 只应该有"向专业 subagent 发请求"的工具，不应该有直接操作图的工具。

| 工具名 | 作用 | 底层实现 |
|---|---|---|
| `design_ask_graph` | 向 GraphAgent 请求设计认知。例如："当前设计如何理解空间维度？" | `task({ subagent_type: "design-graph" })`，mode=`cognition` |
| `design_request_change` | 用自然语言描述变更意图。subagent 会分析、生成 Change Plan、向用户请示，并在用户同意后自动执行写入。 | `task({ subagent_type: "design-graph" })`，mode=`judge` |
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
- 所有语义化 GraphAgent 工具也不暴露给 ChatAgent（`design_define_*`, `design_refine_*`, `design_withdraw_*`, `design_get_design`, `design_find_concepts`, `design_get_relations` 等）

## GraphAgent 输入

GraphAgent 作为 subagent，接收一个自然语言请求 + 系统层提供的上下文。

```typescript
interface DesignGraphSubagentInput {
  // 请求类型，决定 GraphAgent 以什么模式工作
  mode: "cognition" | "judge" | "refine" | "summarize" | "review-save"

  // ChatAgent 的自然语言请求
  request: string

  // 当前活跃工作集快照（系统共享 Cache 的只读副本）
  activeWorkingSet: {
    contextIds: string[]
    nodeIds: string[]
    capacity: number
  }

  // 当前已知图版本
  // 用于检测 GraphAgent 读图期间图是否被其他来源修改
  knownVersion?: number

  // judge 模式内部切 refine 模式时传递已批准的 Change Plan
  changePlan?: ChangePlan

  // 仅在 review-save 模式下需要
  visualEditorDelta?: GraphDelta
}
```

### 不同模式说明

| 模式 | 触发方式 | GraphAgent 行为 |
|---|---|---|
| `cognition` | `design_ask_graph` | 分析问题，在图中寻找相关概念，返回设计认知 |
| `judge` | `design_request_change` | 把自然语言意图转成 Change Plan，调用审批面板请求用户对变更方向的确认 |
| `refine` | `judge` 模式内部调用 | 基于已审批的 Change Plan，通过 Question 面板敲定细节并累积到临时 accumulator |
| `summarize` | `design_summarize_design` | 基于活跃工作集生成自然语言摘要 |
| `review-save` | Visual Editor 保存后 | 审查已发生的改动，返回建议 |

## GraphAgent 输出

GraphAgent 返回的是设计认知，不是原始图数据。

```typescript
interface DesignGraphSubagentOutput {
  type:
    | "cognition"           // 返回设计认知
    | "change-applied"      // refine 模式终稿确认后已执行变更
    | "abandoned"           // 用户在终稿审批阶段废弃变更，子 Agent 已终止
    | "rejected"            // 用户在初稿审批阶段拒绝变更，子 Agent 已终止
    | "needs-clarification" // 用户在初稿审批阶段要求修订，子 Agent 已终止

  // 面向 ChatAgent 的自然语言摘要
  summary: string

  // 结构化洞察，便于 ChatAgent 引用
  insights?: Array<{
    kind: "concept" | "relation" | "principle" | "warning" | "suggestion"
    subject?: string        // 概念名/节点名
    description: string     // 描述
    references?: string[]   // 引用的节点 ID（GraphAgent 内部使用，ChatAgent 不需要理解）
  }>

  // judge 模式内部使用：把已生成的 Change Plan 传给 refine 模式
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
    plan: ChangePlan        // 已审批通过的变更计划，refine 模式基于此展开细节
  }

  // 当 type 为 change-applied 时，返回已应用变更的摘要，用于同步活跃工作集和 ChatAgent 认知
  appliedChange?: {
    version: number
    affectedNodes: string[]
    affectedEdges: string[]
    affectedContexts: string[]
    summary: string
  }

  // 当 GraphAgent 认为信息不足、需要 ChatAgent 向用户追问时填写
  questions?: string[]
}
```

输出类型说明：

- `cognition`：返回设计认知。如果 `questions` 非空，ChatAgent 应先回答这些问题或向用户澄清，再继续。
- `change-applied`：初稿审批通过并经过细化后，终稿提交工具成功提交所有临时变更。`appliedChange` 字段携带变更摘要，系统层据此更新活跃工作集，ChatAgent 据此刷新认知。
- `abandoned`：用户在终稿审批阶段选择废弃变更，子 Agent 已终止，返回值包含 GraphAgent 提供的变更细节。
- `rejected`：用户在初稿审批阶段拒绝变更，子 Agent 已终止，返回值包含 GraphAgent 提供的分析文本。
- `needs-clarification`：用户在初稿审批阶段要求修订，子 Agent 已终止，附带用户修改意见。ChatAgent 继续与用户沟通，重新生成意图后再次调用 `design_request_change(newIntent)` 发起新一轮审批。

`proposal` 字段不返回给 ChatAgent；它只在 judge 模式内部切 refine 模式时传递已批准的 Change Plan。

### 变更计划（Change Plan）

Change Plan 是 judge 模式的输出，只描述核心设计决策，不展开完整字段。

```typescript
interface ChangePlan {
  // 原始变更意图（来自 ChatAgent 的自然语言描述）
  intent: string

  // 为什么这个变更是合理的
  rationale: string

  // 核心设计决策摘要
  summary: string

  // 新增/修改/撤回的概念（只给名称和所属上下文）
  concepts?: Array<{
    action: "create" | "update" | "withdraw"
    name: string
    context: string
    kind?: string
    key_semantics?: string  // 关键语义，不是完整描述
  }>

  // 新增/修改的关系（只给两端和关系类型）
  relations?: Array<{
    action: "create" | "update" | "withdraw"
    from: string
    to: string
    relation: string
    key_semantics?: string
  }>

  // 需要新建的上下文
  contexts?: Array<{
    action: "create"
    name: string
    key_semantics?: string
  }>

  // 需要新建/修改的关系原型
  prototypes?: Array<{
    action: "create" | "update"
    name: string
    key_semantics?: string
  }>
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

## GraphAgent 工具集（重新设计）

GraphAgent 的工具面向**设计语义**，不是原始图数据操作。底层统一走 `Design.applyRawDelta`。

### 读工具

| 工具名 | 用途 |
|---|---|
| `design_get_design` | 获取当前设计的整体语义视图 |
| `design_get_context(name_or_id)` | 获取一个上下文及其概念 |
| `design_get_concept(name_or_id)` | 获取一个概念的语义、关系、邻近概念 |
| `design_find_concepts(query)` | 按名称/别名/语义搜索概念 |
| `design_get_relations(concept_id)` | 获取一个概念的关系 |
| `design_list_prototypes` | 列出关系原型 |
| `design_resolve_reference(query)` | 解析模糊引用，返回最可能匹配的节点/上下文 |

### 临时工作集工具（子 Agent 私有）

| 工具名 | 用途 |
|---|---|
| `design_workset_get` | 查询当前临时工作集中的节点/上下文 |
| `design_workset_add(nodes, contexts)` | 把节点/上下文加入临时工作集 |
| `design_workset_remove(nodes, contexts)` | 从临时工作集移除节点/上下文 |
| `design_workset_expand(node)` | 把一个节点的相邻节点加入临时工作集 |

### 写工具（语义化）

| 工具名 | 用途 |
|---|---|
| `design_define_context({ name, semantics })` | 定义新上下文 |
| `design_define_concept({ name, context, kind, semantics, aliases })` | 定义新概念 |
| `design_refine_concept({ concept, semantics, aliases, kind })` | 精炼/修改概念 |
| `design_withdraw_concept({ concept, cascade })` | 撤回概念 |
| `design_relate_concepts({ from, to, relation, semantics, constraints })` | 建立/修改关系 |
| `design_withdraw_relation({ from, to })` | 撤回关系 |
| `design_define_relation_prototype({ name, semantics, constraints })` | 定义关系原型 |

### 写工具与 delta 的关系

- refine 模式根据已审批的 Change Plan 调用这些语义化工具。
- 每个工具内部生成对应的 delta 片段。
- refine 模式维护一个待提交 delta accumulator。
- 所有细节敲定完成后，调用终稿提交工具向用户展示完整变更；用户同意后自动提交 accumulator。
- 提交成功后 bump version。

这样用户可以在 GraphAgent subagent 标签页中看到"定义概念 UserService"、"建立 UserService depends_on OrderService"等可读的执行步骤，而不是抽象的 delta 字段。

## 数据流

### 设计认知请求

```
用户："我们考虑一下空间维度"
  → ChatAgent：用户想讨论空间维度，我没有相关认知
    → ChatAgent 调用 design_ask_graph("用户提到空间维度，请分析相关设计认知")
      → 系统层：构建临时工作集（从活跃工作集快照复制）
        → task({ subagent_type: "design-graph", mode: "cognition" })
          → design-graph subagent 读取图，通过工具查询/扩展临时工作集
            → 发现 方向 → 意义 → 小数值 的关联
              → 返回 cognition 输出
                → ChatAgent 解释给用户
                  → 用户继续对话
```

### 设计变更请求

```
用户："空间维度可以按前后左右来设计吗？"
  → ChatAgent：用户想修改设计
    → ChatAgent 整理所有设计需求，调用 design_request_change("将空间维度按方向有意义的原则划分为前方、侧翼、后方。意图：... 方向：... 建议：... 细节：...")
      → 系统层：构建临时工作集（从活跃工作集快照复制）
        → task({ subagent_type: "design-graph", mode: "judge" })
          → GraphAgent 审批模式分析意图
            → 通过工具查询/扩展临时工作集
              → 生成 Change Plan + 分析说明
                → 调用审批面板（事件冒泡到父会话 composer）
                  → 用户在父会话 composer 中看到"同意变更 / 强行变更 / 修订变更 / 拒绝变更"
                    → 同意变更 / 强行变更：
                      → GraphAgent 内部转入 refine 模式
                        → 通过 Question 面板逐个敲定细节
                          → 调用语义化写工具
                            → 累积 delta 片段到临时 accumulator
                              → 调用终稿提交工具
                                → 用户在父会话 composer 中看到"同意 / 废弃变更，选择退出 / 修订"
                                  → 同意：
                                    → 终稿工具自动提交所有临时变更
                                      → bump version
                                        → 返回 change-applied（携带 appliedChange 摘要）
                                          → 系统层用 appliedChange 更新活跃工作集
                                            → ChatAgent 总结结果
                                  → 废弃变更，选择退出：
                                    → 终止 subagent
                                      → 返回 abandoned + 变更细节
                                        → ChatAgent 向用户说明变更已放弃
                                  → 修订：
                                    → 用户必须填写修订内容
                                      → GraphAgent 继续通过 Question 面板敲定修订细节
                                        → 再次调用终稿提交工具
                    → 拒绝变更：
                      → 终止 subagent
                        → 返回 rejected + GraphAgent 分析文本
                          → ChatAgent 向用户说明变更被拒绝，引导重新讨论
                            → 直到达成新意图，再次调用 design_request_change
                    → 修订变更：
                      → 用户填写/覆盖默认修订说明
                        → GraphAgent 基于修改建议重新分析
                          → 再次调用初稿审批面板
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
    // 子会话中的 question.ask 会自动冒泡到父会话 composer，
    // 用户在父会话作答后，子会话继续执行。
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
)
```

### 终稿提交工具

```typescript
interface DesignFinalizeChangeParameters {}
```

实现：

```typescript
execute: (args, ctx) =>
  Effect.gen(function* () {
    const state = yield* design.getAccumulatedGraphState(ctx.sessionID)
    const summary = yield* design.summarizeGraphState(state)
    // 向用户展示所有待提交变更细节
    const approved = yield* question.ask({
      header: "[design-approval] 设计变更终稿确认",
      question: "## 待提交变更详情\n" + summary,
      options: [
        { label: "同意", description: "提交所有变更" },
        { label: "废弃变更，选择退出", description: "放弃所有临时变更" },
        { label: "修订", description: "我需要修改某些细节" },
      ],
      custom: true, // 修订选项必填
      metadata: { designApproval: true, stage: "finalize" },
    })
    if (approved === "同意") {
      yield* design.applyAccumulatedChanges(ctx.sessionID)
      return {
        title: "Changes applied",
        output: "All changes have been applied to the design graph.",
      }
    }
    if (approved === "废弃变更，选择退出") {
      yield* design.clearAccumulatedChanges(ctx.sessionID)
      return {
        title: "Changes abandoned",
        output: "All pending changes have been discarded.",
      }
    }
    // "修订" 返回需要继续细化的信号
    return {
      title: "Revision requested",
      output: "Please provide revision details.",
      metadata: { revision: true },
    }
  })
```

该工具是 GraphAgent subagent 内部工具，不暴露给 ChatAgent。它在 refine 模式末尾被调用，负责把临时 accumulator 中的变更呈现给用户，并在用户同意后自动提交。

### `design_summarize_design`

```typescript
interface DesignSummarizeDesignParameters {}
```

实现类似，mode 为 `summarize`。

## 审批机制

审批是**系统级写入闸门**，由 **GraphAgent subagent 在子会话中发起**。OpenCode 的 `question.ask` 事件会自动从子会话冒泡到父会话 composer，因此用户在父会话 composer 中就能看到并回答子 Agent 提出的问题。

设计变更审批分为**两个阶段**：
1. **初稿审批（Judge）**：GraphAgent 根据 ChatAgent 传递的设计需求描述，分析整体意图、影响范围，向用户请求对变更方向的确认。
2. **终稿审批（Finalize）**：GraphAgent 在子会话中通过 Question 面板逐个敲定细节后，将所有待提交的变更累积在临时区，再向用户展示完整细节并请求最终确认。

两个阶段使用**同一个审批面板 GUI 组件/服务**，但由**不同的工具调用**触发。

### 阶段一：初稿审批（Judge）

1. ChatAgent 整理用户聊天中得到的所有设计需求，形成条理清晰的变更描述（包含意图、方向、建议、细节等）。
2. ChatAgent 调用 `design_request_change(intent)` 启动 `design-graph` subagent。
3. 系统层从活跃工作集快照复制初始临时工作集，并注入系统辅助分析。
4. GraphAgent 以 `judge` 模式分析意图，通过工具查询/扩展临时工作集，生成 Change Plan 与分析说明。
5. GraphAgent 在子会话中调用审批面板（`question.ask`），问题事件冒泡到父会话 composer。
6. 用户在父会话 composer 中看到审批面板，展示 GraphAgent 对变更的分析、Change Plan 摘要、可能的问题与警告。
7. 面板提供四个选项，但以下两类互斥：
   - **同意变更**：仅在 GraphAgent 未发现明显问题时出现。用户确认后进入阶段二细化。
   - **强行变更**：仅在 GraphAgent 发现明显问题时出现。用户认可变更方向，但授权 GraphAgent 在后续细化中自主合理化方案，不再反复征求用户意见。
   - **修订变更**：提供一个输入框，默认预填入一段基于用户视角的修订方向说明文本。用户可点击覆盖输入，提交后 GraphAgent 基于修改建议重新分析并再次调用初稿审批面板。
   - **拒绝变更**：终止子 Agent，返回 `rejected` 及 GraphAgent 提供的分析文本；ChatAgent 据此引导用户重新讨论。
8. 用户选择后需点击提交按钮确认。面板风格类似 Question 单选题面板，而非权限面板。

### 阶段二：细化与终稿审批（Refine + Finalize）

1. 初稿通过后，GraphAgent 进入细化模式，通过 **Question 面板**逐个细节询问用户，例如："‘船’的语义解释放什么内容？请选择已有选项或给出自己的看法。"
2. 每个细节确定后，GraphAgent 调用对应的图变更 Tool（`design_define_concept`、`design_relate_concepts` 等），变更被计入子会话私有的临时 accumulator，不立即写入数据库。
3. 所有细节敲定后、正式提交前，GraphAgent 调用**终稿提交工具**（与初稿审批共享同一 GUI 服务，但工具 ID 不同）。该工具展示所有临时区变更的具体细节。
4. 终稿面板选项：
   - **同意**：工具**自动提交**临时区所有变更，相当于内部调用 `design_apply_changes`。成功后 bump 版本，子代理返回 `change-applied` 及变更说明文本。
   - **废弃变更，选择退出**：终止子 Agent，返回 `abandoned` 及 GraphAgent 提供的变更细节；临时区变更被丢弃。
   - **修订**：输入框为必填项（终稿阶段不会预填入修订方向）。用户提交后，GraphAgent 继续通过 Question 面板敲定修订细节，然后再次调用终稿提交工具。
5. 用户选择后需点击提交按钮确认。

### 为什么由 GraphAgent 直接提问

- `sessionTreeRequest` 已确认子会话的 `question.ask` 会自动冒泡到父会话 composer。
- 审批问题和执行写入都围绕同一个 Change Plan，由 GraphAgent 自己控制可以减少跨 Agent 传递时的理解差异。
- ChatAgent 仍然是编排层：它决定何时调用 `design_request_change`，并在变更被拒绝、放弃或需要澄清时继续对话。
- 这样审批面板仍是系统 UI，只是驱动它的 Agent 是 GraphAgent 而非 ChatAgent。

### 问题设计（初稿审批）

```typescript
{
  questions: [{
    header: "[design-approval] 设计变更审批",
    question: "## 变更意图\n...\n## 分析说明\n...\n## 计划摘要\n...",
    options: [
      { label: "同意变更", description: "确认此变更方向并进入细节细化" },
      { label: "强行变更", description: "同意方向，授权 GraphAgent 自主合理化细节" },
      { label: "拒绝变更", description: "放弃本次变更" },
      { label: "修订变更", description: "我希望修改这个方案" }
    ],
    custom: true  // 允许用户输入修改意见
  }]
}
```

- 当 GraphAgent 未发现明显问题时，选项中只出现 **同意变更**，不出现 **强行变更**。
- 当 GraphAgent 发现明显问题时，选项中只出现 **强行变更**，不出现 **同意变更**。
- **修订变更**的输入框默认预填入基于用户视角的修订方向说明。

### 终稿提交工具设计

终稿提交工具本质上是一次 `question.ask`，但服务端会识别其 metadata 标记，在用户选择同意后自动执行临时区变更提交。

```typescript
{
  questions: [{
    header: "[design-approval] 设计变更终稿确认",
    question: "## 待提交变更详情\n...",
    options: [
      { label: "同意", description: "提交所有变更" },
      { label: "废弃变更，选择退出", description: "放弃所有临时变更" },
      { label: "修订", description: "我需要修改某些细节" }
    ],
    custom: true  // 修订选项必填
  }],
  metadata: { designApproval: true, stage: "finalize" }
}
```

- 用户选择 **同意** 后，服务端自动将临时 accumulator 中的变更通过 `Design.applyRawDelta` 提交。
- 用户选择 **废弃变更，选择退出** 后，临时 accumulator 被清空，子代理终止。
- 用户选择 **修订** 后，必须填写输入框内容；GraphAgent 读取后回到 Question 面板继续细化。

### 执行模式说明

- 执行模式接收已经审批通过的 Change Plan。
- 执行模式由 GraphAgent 在子会话内部调用，不需要 ChatAgent 再次发起 `task`。
- 执行模式仍然需要 LLM 进行工具调用决策（决定调用哪些设计工具以及调用顺序）。
- 但执行模式不再重新理解意图或生成新的设计，而是基于已审批的 Change Plan 进行工具调用。
- 这样可以减少 LLM 理解差异对执行结果的影响，但不能完全消除。
- 执行模式在展开细节前应重新检查图版本；若版本已变，应中止并返回 `needs-clarification`，由 ChatAgent 重新发起 `design_request_change`。

## 权限设计

### design-graph subagent 权限

```typescript
const designGraphPermissions = Permission.fromConfig({
  "*": "deny",

  // 读工具
  design_get_design: "allow",
  design_get_context: "allow",
  design_get_concept: "allow",
  design_find_concepts: "allow",
  design_get_relations: "allow",
  design_list_prototypes: "allow",

  // 写工具（语义化）
  design_define_context: "allow",
  design_define_concept: "allow",
  design_refine_concept: "allow",
  design_withdraw_concept: "allow",
  design_relate_concepts: "allow",
  design_withdraw_relation: "allow",
  design_define_relation_prototype: "allow",

  // 引用解析
  design_resolve_reference: "allow",

  // 临时工作集工具（子 Agent 私有）
  design_workset_get: "allow",
  design_workset_add: "allow",
  design_workset_remove: "allow",
  design_workset_expand: "allow",

  // 向用户提问（judge 模式发起审批）
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

  // 语义化 GraphAgent 工具也禁止给 ChatAgent
  design_define_context: "deny",
  design_define_concept: "deny",
  design_refine_concept: "deny",
  design_withdraw_concept: "deny",
  design_relate_concepts: "deny",
  design_withdraw_relation: "deny",
  design_define_relation_prototype: "deny",
  design_get_design: "deny",
  design_find_concepts: "deny",
  design_get_relations: "deny",
  design_resolve_reference: "deny",

  // 临时工作集工具也禁止给 ChatAgent
  design_workset_get: "deny",
  design_workset_add: "deny",
  design_workset_remove: "deny",
  design_workset_expand: "deny",
})
```

注意：ChatAgent 必须被允许 `task` 以调用 subagent。ChatAgent 不应显式 deny `question`，否则 GraphAgent 子 Agent 的 `question.ask` 会被父会话的 deny 规则继承而失效。

## 系统层职责

### 1. 构建临时工作集

每次向 GraphAgent 发起请求前，系统层根据当前活跃工作集的快照初始化临时工作集。

临时工作集的初始值 = 活跃工作集快照（节点 ID + 上下文 ID）。

系统层还会并行运行自动化检查（冲突关系、重复节点、孤立节点、无效原型使用），结果填充到 `systemAnalysis` 区域，供 GraphAgent 读取。

GraphAgent 在子会话中通过临时工作集工具查询、扩展、收缩该集合。

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
- 通知 ChatAgent 设计已更新（通过子 Agent 返回值中的 `appliedChange` 摘要，或系统事件）。

### 6. 处理后输入展示

把经过系统层处理后的用户输入以可折叠形式展示给用户。

## 与 Visual Editor 的关系

Visual Editor 仍然直接写 DB（raw save），因为 GUI 操作本身已是用户意图的直接表达。

保存后：

1. 系统层直接写 DB。
2. 系统层设置**脏标记**（`visual_editor_dirty`），表示设计图自 ChatAgent 上次认知刷新后已被修改。
3. 如果用户随后提到设计相关内容，ChatAgent 应主动调用 `design_ask_graph` 或 `design_summarize_design` 重新建立对图设计的认知。
4. 如果用户未主动提及，后续任何 GraphAgent 调用（如 `design_request_change`）都会因脏标记/版本不一致而失败，错误信息会提示 ChatAgent 先同步认知。ChatAgent 同步后脏标记清除，方可继续变更。
5. GraphAgent 在 `review-save` 或 `summarize` 模式下分析，返回最新设计状态和建议。
6. ChatAgent 与用户讨论是否需要进一步调整。

## 日志插入点

由于本架构涉及 subagent 调用、question 事件、版本同步等复杂交互，采用真实 GUI 测试 + 结构化日志验证。

| 位置 | 日志 |
|---|---|
| `design_ask_graph` 入口 | `design.ask_graph.start question=...` |
| `design_request_change` 入口 | `design.request_change.start intent=...` |
| `design_summarize_design` 入口 | `design.summarize_design.start` |
| subagent 内部 judge → refine 切换 | `design-graph.mode.switch from=judge to=refine` |
| 启动 subagent | `design.subagent.launch mode=... subagent_type=design-graph` |
| subagent 收到 prompt | `design-graph.subagent.start mode=... activeNodes=N` |
| subagent 读图 | `design-graph.read tool=... args=...` |
| subagent 扩展工作集 | `design-graph.workset.expand addedNodes=... reason=...` |
| subagent 调用 question（事件冒泡到父会话） | `design-graph.question.ask options=...` |
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
4. 保留语义化 GraphAgent 工具集（`design_define_*`、`design_refine_*`、`design_withdraw_*` 等，供 GraphAgent subagent 使用）。

### 阶段 2：新增 ChatAgent 工具

1. 实现 `design_ask_graph`。
2. 实现 `design_request_change`。
3. 实现 `design_summarize_design`。
4. 实现 `design_search_project` / `design_search_web`（复用 SearchAgent）。
5. 在 `ToolRegistry` 中注册新工具。
6. 实现临时工作集工具（`design_workset_get`、`design_workset_add`、`design_workset_remove`、`design_workset_expand`），供 GraphAgent subagent 在子会话中使用。

### 阶段 3：重写 design-graph subagent

1. 重写 `src/design/agent/prompt/graph.txt`：
   - 明确 subagent 是 ChatAgent 的设计认知外脑。
   - 说明五种工作模式（cognition、judge、refine、summarize、review-save）。
   - 说明 judge 模式的初稿审批面板交互（同意/强行/修订/拒绝）。
   - 说明 refine 模式的 Question 面板细节询问与终稿提交工具。
   - 说明可用工具集。
   - 强制最终输出为 JSON。

2. 调整 `design-graph` 权限：允许所有语义化设计图读/写工具和 `question`。

3. 实现 subagent 内部逻辑：
   - 解析 prompt 中的 mode。
   - `cognition` 模式：读图、扩展工作集、返回洞察。
   - `judge` 模式：把自然语言意图转成 Change Plan，调用审批面板请求对变更方向的确认；批准后内部进入 `refine` 模式。
   - `refine` 模式：基于已审批的 Change Plan，通过 Question 面板敲定细节，调用语义化写工具累积 delta，最后调用终稿提交工具请求用户确认并自动提交。
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
- `design_request_change`: Ask the design-graph subagent to propose and execute a design change. Describe the change in natural language. The subagent will analyze the graph, generate a Change Plan, ask the user for approval, and execute the change if approved. If the user rejects or asks to revise, the subagent will return a result so you can continue the conversation.
- `design_summarize_design`: Ask the design-graph subagent for a summary of the current design.
- `design_search_project`: Ask the search subagent to read the project and compare it with the design.
- `design_search_web`: Ask the search subagent to search the web for relevant design references.

The design graph is maintained by the design-graph subagent. It will analyze the graph, find relevant concepts, check for conflicts, propose changes, and execute changes after user approval.

When the user talks about design concepts, always use `design_ask_graph` to get the current design cognition before responding.

When the user wants to change the design, use `design_request_change`. The subagent will present the proposal to the user and execute it if approved. If the user rejects or asks to revise, continue the conversation based on the subagent's return value.
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
- judge: Convert a natural language design intent into a structured change plan (NOT a full delta). The plan describes core design decisions only. Then call the approval panel (`question.ask`) to request user confirmation on the change direction. If the user agrees or forces, internally transition to refine mode. If the user rejects or wants to revise, terminate the subagent and return the corresponding result to ChatAgent so it can guide the next round.
- refine: Receive an already-approved change plan. Expand the plan into detailed concept/relationship definitions by asking the user each specific detail through the Question panel. Each detail is written to a temporary accumulator via the semantic design tools. When all details are settled, call the finalize-change tool to present the full set of changes to the user. If the user agrees, the tool automatically commits the accumulator. If the user abandons, the accumulator is discarded. If the user revises, continue refining through the Question panel.
- summarize: Generate a natural language summary of the current design based on the active working set.
- review-save: Review a diff from the Visual Editor and return suggestions.

You have access to all design graph tools. Use them to read and modify the graph as needed.

For judge mode:
1. Read the current graph state.
2. Build or extend the temporary working set.
3. Generate a Change Plan that captures the core design decisions implied by the user's intent.
4. Check for conflicts, duplicates, orphaned nodes, and invalid prototype usage.
5. Decide whether there are obvious problems.
6. Call the approval panel (`question.ask`) to present the Change Plan and your analysis to the user. The panel will surface in the parent session composer automatically.
7. Wait for the user's answer.
8. If 同意变更 (Approve): internally transition to refine mode.
9. If 强行变更 (Force): internally transition to refine mode with the `force` flag set; you are authorized to rationalize details autonomously without repeatedly asking the user.
10. If 拒绝变更 (Reject): terminate the subagent and return a JSON result with type "rejected". Include your analysis text in `summary` so ChatAgent can guide the user.
11. If 修订变更 (Revise): read the user's revision text, re-analyze based on it, and call the approval panel again. If the user did not provide revision text, treat it as a no-op and ask again.

For refine mode:
1. Receive the approved Change Plan (and the optional `force` flag).
2. Ask the user each specific detail through the Question panel, e.g. "What should the semantic description of 'Ship' contain?".
3. For each settled detail, call the appropriate semantic design tool to add the change to the temporary accumulator.
4. When all details are settled, call the finalize-change tool to present the full pending changes to the user.
5. Wait for the user's answer.
6. If 同意 (Agree): the tool automatically commits all accumulated changes, bumps the graph version, and returns a JSON result with type "change-applied". Include `appliedChange` with the version, affected nodes/edges/contexts, and a human-readable summary.
7. If 废弃变更，选择退出 (Abandon): terminate the subagent and return a JSON result with type "abandoned". Include the details you previously showed to the user in `summary`.
8. If 修订 (Revise): the user must provide revision text. Read the text, then continue refining through the Question panel and call the finalize-change tool again.

Your final response must be a single JSON object matching the output schema. Do not wrap it in markdown.
```

## 结论

当前实现把图当成数据库让 ChatAgent 直接操作，这是根本性的方向错误。图是设计知识的载体，ChatAgent 只需要设计认知。GraphAgent 应该是运行在 subagent 中的设计认知外脑，负责读图、分析、生成洞察、执行变更。活跃工作集是 GraphAgent 的 Cache，由系统自动控制。所有 ChatAgent 的工具都应该重新设计为"向 subagent 发请求"，而不是直接操作图。
