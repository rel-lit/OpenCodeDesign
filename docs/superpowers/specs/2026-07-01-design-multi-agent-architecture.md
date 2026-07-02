# Design 多 Agent 架构设计

> 配套架构图：`2026-07-01-design-multi-agent-architecture-diagram.html`

## 背景

Design 模式已经从 JSON/JSONL 原型迁移到基于 SQLite 的持久化实现，并具备了完整的图 CRUD 工具集。当前 Design agent 是单一原生主代理，直接操作 `Design.Service` 暴露的工具。

为了让 Design 模式在 GUI 客户端中具备更强的可解释性、协作性和自治性，需要引入多 Agent 架构，将**对话引导**、**图操作执行**和**信息检索**拆分为不同职责的代理。

## 目标

- 明确 Design 模式下各 Agent 的职责边界。
- 消除用户输入中的指代歧义（如“这个节点”、“那个边”）。
- 支持用户通过可视化图编辑器直接修改图，并让系统自动理解改动意图。
- 让检索能力（项目阅读、联网搜索）成为可组合、可显式触发的子能力。
- 保证所有成功的图修改最终都经过 ChatAgent 决策和 GraphAgent 执行。

## 非目标

- 本次设计不实现完整的可视化图编辑器 UI，只定义编辑器与 Agent 系统的交互协议。
- 不替换现有的 `Design.Service` 和 SQLite 存储层，而是在其上叠加 Agent 编排层。

## 当前能力基线

- `Design.Service` 提供上下文、节点、边、关系原型的完整 CRUD。
- 21 个 `design_*` 工具已注册给 Design agent。
- 图状态按项目目录隔离，持久化在 `.opencode/design/design.sqlite`。
- 工作集用于跟踪当前活跃的上下文和节点。

## Agent 角色与边界

### ChatAgent（Design 主 Agent）

- **唯一与用户对话的 Agent**。
- 负责理解用户需求、引导设计、整合 SearchAgent 和 GraphAgent 返回的信息。需要检索时，先向 GraphAgent 请求基于当前活跃工作集的图摘要，再把图摘要和检索需求交给 SearchAgent。
- 所有图修改请求必须由 ChatAgent 提出，并以**一组操作**为单位经用户显式同意后才能写入数据库。
- 不直接调用 `Design.Service` 工具；通过调用 GraphAgent 来生成变更提案，由用户在审批面板点击确认后 GraphAgent 执行。
- 不负责组织 UI 展示；系统层会自动把预处理后的输入、GraphAgent 的驳回理由和变更提案以可折叠/可展开的形式展示给用户（这些属于固定流程触发，无需 LLM 参与）。

### GraphAgent（子 Agent）

- **图设计的共享分析引擎**，不直接面对用户。无论输入来自聊天、ChatAgent 的请求还是可视化编辑器保存，GraphAgent 执行的都是同一套设计分析逻辑。
- 负责：
  1. **设计分析**：基于系统提供的结构化辅助信息，再加上 LLM 判断，检查命名冲突、关系原型使用是否合理、节点所处上下文是否合适、是否遵循设计原则、是否存在可合并的相似节点、是否存在隐含关系、改动后图是否仍然合理等。系统层会预先运行可自动化的条件判断（如“冲突关系原型”检测），将结果以固定栏目格式填充到临时工作集的“系统分析区 > 冲突关系”等区域；GraphAgent 直接读取这些辅助栏目，降低 LLM 负担，但隐秘、非自动化可检测的内容仍由 LLM 自行发现。
  2. **图转自然语言**：把当前图、参考图或图的某一部分转换为 ChatAgent 易于理解的自然语言摘要（可带结构化标注）。流程为：GraphAgent 先基于接收到的临时工作集进行设计分析并**动态扩展临时工作集**，然后基于扩展后的临时工作集生成自然语言摘要。ChatAgent 可以主动向 GraphAgent 请求基于当前活跃工作集的图摘要。
  3. **输入预处理**：基于设计分析消歧、将图信息转译为自然语言，辅助 ChatAgent 理解用户输入。
  4. **生成变更提案**：接收 ChatAgent 的一组图操作请求，进行设计分析后返回结构化提案。如果发现问题，同时返回驳回理由和可选方案（强制执行、继续沟通、修订冲突）。
  5. **执行写入**：仅在用户在审批面板点击确认（或选择强制执行）后，将批准的整组提案写入数据库。执行写入阶段的确认粒度是“整组”：用户只能同意或拒绝整个操作组，不能单独挑选组内某个操作。如果用户想调整组内某个操作，应在提案阶段使用“修订”选项，让 ChatAgent 重新生成提案；修订后的提案再次进入审批面板。整组只包含一个 trivial 操作（如创建一个节点）时，用户仍对该整组进行一次性确认。
  6. **改动理解**：可视化编辑器手动保存后，基于改动 diff 进行设计分析，把发现的问题或完善建议交给 ChatAgent 引导用户进入下一轮设计循环。
- **两种职责模式**：
    - **前置写入锁（Pre-write Gate）**：ChatAgent 发起的图修改必须先经 GraphAgent 生成提案、用户在审批面板确认，GraphAgent 才能执行写入。
    - **后置审查器（Post-write Reviewer）**：可视化编辑器的手动保存会直接写入数据库；GraphAgent 在写入完成后基于 diff 进行审查，把发现的问题或完善建议交给 ChatAgent。
  - 对 ChatAgent 发起的写操作，GraphAgent 是必经的执行者；对可视化编辑器的直接写入，GraphAgent 是事后审查者。

### SearchAgent（子 Agent）

- **信息检索与分析专员**。
- 权限：项目文件读取、`grep`/`glob`、联网搜索、网页抓取。
- 触发方式：
  - 进入 Design 模式时，系统自动触发一次项目阅读。
  - ChatAgent 可以显式调用以进行联网搜索或重新阅读项目。
- 输入：
  - **当前图摘要**：由 ChatAgent 从 GraphAgent 获取（基于当前活跃工作集）。
  - **检索需求**：ChatAgent 明确的检索意图（如“寻找类似的聚合关系设计”、“对比项目实现与当前设计”）。
- 职责：
  - 根据检索需求搜索互联网和/或项目代码。
  - 自行完成参考设计与当前图的对比分析。
  - 收集项目方向、参考信息、相似设计方案等。
  - 将所有结果总结为自然语言报告交给 ChatAgent。
  - 当 ChatAgent 需要进入实现阶段时，提供**当前设计与项目实现的差异分析**，作为 Plan 模式的输入。
- 不直接修改图。

## 系统层预处理

系统层只做廉价、确定性的预处理，不调用 LLM：

1. **@ 引用展开**：识别用户输入中的 `@Identifier` 或 `@节点名`，将其展开为对应图实体的摘要。
2. **临时工作集构建（初始）**：
   - 对于聊天输入：根据 @ 引用、当前活跃工作集、输入关键词计算临时节点/上下文集合；包含显式涉及的节点、这些节点的直接相邻边、活跃节点等。
   - 对于 ChatAgent 的图操作请求：以 LLM 一次响应中连续调用的多个 `design_*` 工具为一组，为整组操作构建临时工作集；包含操作直接涉及的节点/边、它们的直接邻接边/节点、当前活跃工作集等。
   - 对于可视化编辑器：以用户一次手动保存产生的完整 diff 为基础构建临时工作集；包含 diff 中涉及的节点/边、它们的直接邻接元素、当前活跃工作集等。
   - 系统层无法一次性构建出完全合适的完整临时工作集，因此 GraphAgent 在分析过程中可以**动态扩展**临时工作集（例如沿着关系向外扩展、加入相关上下文）。
3. **阈值判断**：根据临时工作集大小、输入长度、是否包含图操作关键词等启发式规则，决定是否将输入交给 GraphAgent 预处理。
4. **处理后输入展示**：无论是否经过 GraphAgent，最终提交给 ChatAgent 的文本都会以可折叠形式展示给用户，让用户知道自己的输入被处理成了什么。

系统层不判断用户意图，不决定是否修改图。

## 数据模型

### 活跃管理工作集（Active Working Set）

- 持久化在 SQLite 中。
- 用户在 GUI 侧边栏可见，可手动增删。
- 影响引用解析的默认上下文和默认节点。

### 临时工作集（Temporary Working Set）

- 每次请求时由系统层计算，不持久化。
- 包含本次输入中显式或隐式涉及的节点、上下文、边。
- 作为 GraphAgent 的输入上下文，帮助限定分析范围。

## 同步与认知一致性

### LLM 认知过期机制

- ChatAgent 和 GraphAgent 都不能依赖过期的图状态进行决策。
- 每次 GraphAgent 执行写入（前置写入锁模式）或完成后置审查（后置审查器模式）后，系统必须同步刷新 ChatAgent 的上下文：
  - 更新 ChatAgent 可读取的当前活跃工作集。
  - 提供最新图摘要或变更摘要。
  - 标记本次修改的版本/序列号，使 ChatAgent 明确知道自己看到的是第几次修改后的状态。
- 如果 ChatAgent 在下一次响应前感知到图已被修改（例如用户在可视化编辑器手动保存），必须先重新向 GraphAgent 请求最新图摘要，再基于最新状态回应用户。

### 变更版本标记

- 每次成功的操作组（无论来自 ChatAgent 审批还是可视化编辑器手动保存）都会使数据库的图状态产生一次逻辑版本迭代。
- 版本信息从 `EventLog` 导出：每个持久化事件对应一个单调递增的序列号（或时间戳），可作为图的“修改版本”。
- Agent 上下文中携带最近一次可见的版本号；当系统检测到当前版本高于 Agent 上下文版本时，强制刷新 Agent 对图的认知。

### 变更描述（GraphDelta）

用于在 Agent 之间传递待应用或已应用的图变更：

```typescript
{
  addNodes?: DesignTypes.Node[],
  updateNodes?: { id: string; patch: Partial<DesignTypes.Node> }[],
  deleteNodeIds?: string[],
  addEdges?: DesignTypes.Edge[],
  updateEdges?: { leftNodeId: string; rightNodeId: string; patch: Partial<DesignTypes.Edge> }[],
  deleteEdgeKeys?: string[]
}
```

## 流程设计

### 1. 聊天输入流程

```
用户输入
  → 系统层：@ 引用展开 + 临时工作集 + 阈值判断
    → 阈值触发 → GraphAgent：设计分析 / 消歧 / 图转自然语言
      → ChatAgent
    → 未触发 → ChatAgent
```

系统预处理后的版本（包括展开的 @ 引用、临时工作集）以可折叠形式展示给用户，默认折叠。ChatAgent 收到 enriched 输入后，决定如何回应。如需检索，先向 GraphAgent 请求当前图的摘要（基于活跃工作集），再把图摘要和检索需求一起交给 SearchAgent；如需图操作，进入图修改流程。GraphAgent 在预处理阶段同样会进行设计层面的分析，把可能的关系冲突、聚合建议等信息一并呈现给 ChatAgent。

### 2. 图修改流程（ChatAgent 发起）

```
ChatAgent 提出一组图操作请求
  → 系统层构建临时工作集
    → GraphAgent：设计分析
      → 返回变更提案
        → ChatAgent 向用户展示提案
          → 用户显式同意
            → GraphAgent 执行写入 → Design DB
          → 用户拒绝 / 要求修订
            → ChatAgent 继续沟通 → 重新生成提案
          → 用户选择强制执行
            → GraphAgent 按原请求执行 → Design DB
```

GraphAgent 对整组请求进行设计分析（冲突、聚合、上下文合理性等），然后返回结构化变更提案。ChatAgent 把提案和任何警告/冲突展示在审批面板中。用户在审批面板中点击确认，或选择：
- **同意**：GraphAgent 执行整组写入。
- **拒绝/修订**：ChatAgent 继续沟通，重新生成提案。
- **强制执行**：忽略 GraphAgent 的警告，按原请求执行整组写入。

**最终成功的图修改路径必须是：ChatAgent → GraphAgent → 用户在审批面板显式同意 → Design 数据库。审批粒度与 GraphAgent 收到的操作组一致。**

### 3. 可视化编辑器保存流程

```
用户在可视化编辑器修改并手动保存
  → 直接写入 Design 数据库（raw save，保存即视为用户同意）
    → 系统层构建临时工作集（基于改动 diff）
      → GraphAgent：设计分析 / 理解改动意图
        → ChatAgent：询问用户为什么修改、如何对齐、如何完善
          → 进入下一次 Design 循环
```

可视化编辑器中的修改会先直接保存到数据库，保证用户操作的即时反馈。在这个场景下，**手动保存动作本身即视为用户对本次改动的显式同意**。保存后系统计算改动 diff，由 GraphAgent 进行与 ChatAgent 请求修改时相同的设计分析（冲突、聚合、上下文合理性等），再把发现的问题或完善建议交给 ChatAgent，由 ChatAgent 向用户提问（例如“你为什么这样改？”、“这个改动和当前设计是否一致？”、“接下来是否要补充相关节点？”），从而推进下一轮设计讨论。

可视化编辑器不实现自动保存，以减少与手动保存之间的行为差异和认知负担。

### 4. 检索流程

```
进入 Design 模式 或 ChatAgent 需要检索
  → 向 GraphAgent 请求当前图摘要（基于当前活跃工作集）
    → SearchAgent 接收 {graphSummary, retrievalRequirements}
      → SearchAgent：项目阅读 / 联网搜索
        → SearchAgent 自行完成参考设计与当前图的对比分析
          → 收集项目方向、参考信息、相似设计方案
            → 总结报告 → ChatAgent
```

SearchAgent 不修改图。它总是带着“当前图长什么样”和“要检索什么”这两个明确输入去工作，避免在未知工作集的情况下进行图对比。

### 5. 模式切换与 Plan/Edit 衔接

```
ChatAgent 需要进入实现阶段
  → ChatAgent 请求 SearchAgent 进行差异分析（当前设计 vs 项目实现）
    → SearchAgent 返回差异分析报告
      → ChatAgent 将差异分析报告交给 Plan 模式
        → 用户退出 Design 模式，进入 Plan/Edit 流程
          → Plan 基于差异分析设计修改计划
```

Design 模式负责“要做什么”和“设计成什么样”；当需要把设计落地为代码修改时，由 ChatAgent 主动触发 SearchAgent 的差异分析，并把差异分析结果作为 Plan 模式的输入。用户退出 Design 模式后，后续代码实现流程由 Plan/Edit 模式接管。

## 接口约定

### GraphAgent 输入

```typescript
{
  source: "chat" | "visual-editor",
  userInput: string,           // 预处理后的用户输入
  temporaryWorkingSet: {
    contextIds: string[],
    nodeIds: string[],
    edgeKeys: string[]
  },
  activeWorkingSet: {
    contextIds: string[],
    nodeIds: string[],
    capacity: number
  },
  graphState: DesignTypes.GraphState,  // 当前完整图状态（按需子集）
  proposedChange?: GraphDelta          // ChatAgent 提出的变更（仅 chat 流程）
}
```

### GraphAgent 输出

```typescript
{
  type: "enriched-input" | "graph-summary" | "change-proposal" | "change-applied" | "rejected",
  summary: string,             // 自然语言摘要（核心，ChatAgent 直接阅读）
  structured?: object,         // 可选的结构化标注，便于 ChatAgent 快速定位
  affectedNodes: string[],
  affectedEdges: string[],
  questions?: string[],        // 需要澄清的问题
  delta?: GraphDelta           // 实际应用或建议的变更
}
```

`summary` 是 ChatAgent 可直接使用的自然语言，不需要再解析图关系。

## 错误处理与用户控制

- GraphAgent 驳回请求时，必须给出可被 ChatAgent 转达的自然语言理由，并向用户展示三个选项：
  1. **强制执行**：忽略警告，按原请求执行。
  2. **继续沟通**：ChatAgent 与用户进一步讨论，寻找不冲突的方案。
  3. **修订冲突**：用户修改输入或图后重新提交。
- 所有由 ChatAgent 发起的图数据库写入必须以整组操作为单位经用户在审批面板显式同意；可视化编辑器的手动保存视为用户同意。
- 系统层预处理失败（如 @ 引用不存在）时，直接提示用户，不进入 Agent 流程。
- 所有对 `Design.Service` 的写操作必须通过事务；失败时由 GraphAgent 捕获并返回错误摘要。

## 测试策略

- 单元测试：系统层阈值判断、临时工作集计算、@ 引用展开。
- 集成测试：GraphAgent 对 ChatAgent 请求的驳回/执行流程。
- E2E 测试：可视化编辑器手动保存 → 数据库更新 → GraphAgent 分析 → ChatAgent 引导下一轮讨论。
- 权限测试：SearchAgent 的读写权限边界。

## 待实现拆分建议

1. **阶段一**：在 Design 主 Agent 中引入 GraphAgent 作为子 Agent，处理 ChatAgent 发起的图操作请求。
2. **阶段二**：增加系统层预处理（@ 引用、临时工作集、阈值），让 GraphAgent 参与输入 enrichment。
3. **阶段三**：接入 SearchAgent，实现进入 Design 模式时的自动项目阅读和显式联网搜索。
4. **阶段四**：定义可视化编辑器与 Agent 系统的交互协议，实现保存后的改动分析流。

## 相关文件

- `docs/superpowers/specs/2026-07-01-design-multi-agent-architecture-diagram.html`
- `packages/opencode/src/design/design.ts`
- `packages/opencode/src/design/core/types.ts`
- `packages/opencode/src/agent/agent.ts`
- `packages/opencode/src/agent/prompt/design.txt`
- `packages/opencode/src/tool/design.ts`
- `packages/opencode/src/tool/registry.ts`
