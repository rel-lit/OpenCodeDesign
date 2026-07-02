# Design 多 Agent 架构设计

> 配套架构图：`2026-07-01-design-multi-agent-architecture-diagram.html`

## 背景

Design 模式已经从 JSON/JSONL 原型迁移到基于 SQLite 的持久化实现，并具备了完整的图 CRUD 工具集。当前 Design agent 是单一原生主代理，直接操作 `Design.Service` 暴露的工具。

为了让 Design 模式在 **Windows 桌面端 GUI 客户端** 中具备更强的可解释性、协作性和自治性，需要引入多 Agent 架构，将**对话引导**、**图操作执行**和**信息检索**拆分为不同职责的代理。CLI 与 Web 版本不在本次设计范围内；可视化图编辑器也只在桌面端 GUI 场景下有意义。

## 目标

- 明确 Design 模式下各 Agent 的职责边界。
- 消除用户输入中的指代歧义（如“这个节点”、“那个边”）。
- 支持用户通过可视化图编辑器直接修改图，并让系统自动理解改动意图。
- 让检索能力（项目阅读、联网搜索）成为可组合、可显式触发的子能力。
- 保证所有成功的图修改最终都经过 ChatAgent 决策和 GraphAgent 执行或审查。

## 非目标与项目范围

- 本次设计不实现完整的可视化图编辑器 UI，只定义编辑器与 Agent 系统的交互协议。
- 不替换现有的 `Design.Service` 和 SQLite 存储层，而是在其上叠加 Agent 编排层。
- 不面向 CLI 与 Web；所有交互假设为桌面端 GUI。
- 不面向 macOS/Linux；构建与运行假设为 Windows x64。

## 当前能力基线

- `Design.Service` 提供上下文、节点、边、关系原型的完整 CRUD。
- 21 个 `design_*` 工具已注册给 Design agent。
- 图状态按项目目录隔离，持久化在 `.opencode/design/design.sqlite`。
- 工作集用于跟踪当前活跃的上下文和节点。
- `EventLog` 记录所有图变更事件，可作为逻辑版本来源。

## 架构总览

```
用户 / GUI
  ├─→ 系统层：预处理、工作集、UI 展示、版本同步
  │     ├─→ ChatAgent（唯一对话 Agent）
  │     │     ├─→ GraphAgent（图分析 / 提案 / 执行 / 审查）
  │     │     │     └─→ Design DB（SQLite）
  │     │     ├─→ SearchAgent（检索 + 对比分析）
  │     │     │     ├─→ 项目文件
  │     │     │     └─→ 互联网
  │     │     └─→ Plan/Edit 模式（实现阶段）
  │     └─→ 审批面板（系统 UI，写入闸门）
  └─→ 可视化编辑器（手动保存直接写 DB）
```

关键原则：

1. **审批面板是 Design DB 写入的闸门**（可视化编辑器手动保存除外）。
2. **GraphAgent 不直接面对用户**；用户交互由 ChatAgent、审批面板或系统 UI 完成。
3. **系统层负责廉价确定性工作**；LLM 只负责需要理解、判断、生成的部分。
4. **ChatAgent 是所有跨 Agent 协作的 orchestrator**。
5. **每次图变更都产生逻辑版本**，并强制同步给 ChatAgent，避免认知过期。

## Agent 角色与边界

### ChatAgent（Design 主 Agent）

- **唯一与用户对话的 Agent**。
- 负责理解用户需求、引导设计、整合 SearchAgent 和 GraphAgent 返回的信息。
- 所有图修改请求必须由 ChatAgent 提出，并以**一组操作**为单位经用户显式同意后才能写入数据库。
- 不直接调用 `Design.Service` 工具；通过调用 GraphAgent 来生成变更提案，由用户在审批面板点击确认后 GraphAgent 执行。
- **不负责固定 UI 展示**：系统层会自动把预处理后的输入、GraphAgent 的驳回理由和变更提案以可折叠/可展开的形式展示给用户（这些属于固定流程触发，无需 LLM 参与）。ChatAgent 只负责生成需要 LLM 理解后才能产生的对话内容。

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

## 系统层

系统层只做廉价、确定性的预处理、协调和 UI 触发，不调用 LLM。

### 1. @ 引用展开

识别用户输入中的 `@Identifier` 或 `@节点名`，将其展开为对应图实体的摘要。

```typescript
// 展开前
"请修改 @UserService 和 @OrderService 之间的关系"

// 展开后（系统层生成，交给 GraphAgent 或 ChatAgent）
"请修改 @UserService（节点 ID: node-1，类型: service，上下文: core）和 @OrderService（节点 ID: node-2，类型: service，上下文: core）之间的关系"
```

### 2. 临时工作集构建（初始）

临时工作集是本次请求的分析上下文，**不持久化**，每次请求由系统层计算后交给 GraphAgent。

构建规则：

- **对于聊天输入**：根据 @ 引用、当前活跃工作集、输入关键词计算临时节点/上下文集合；包含显式涉及的节点、这些节点的直接相邻边、活跃节点等。
- **对于 ChatAgent 的图操作请求**：以 LLM 一次响应中连续调用的多个 `design_*` 工具为一组，为整组操作构建临时工作集；包含操作直接涉及的节点/边、它们的直接邻接边/节点、当前活跃工作集等。
- **对于可视化编辑器**：以用户一次手动保存产生的完整 diff 为基础构建临时工作集；包含 diff 中涉及的节点/边、它们的直接邻接元素、当前活跃工作集等。

系统层无法一次性构建出完全合适的完整临时工作集，因此 GraphAgent 在分析过程中可以**动态扩展**临时工作集（例如沿着关系向外扩展、加入相关上下文）。

### 3. 阈值判断

根据临时工作集大小、输入长度、是否包含图操作关键词等启发式规则，决定是否将输入交给 GraphAgent 预处理。

### 4. 处理后输入展示

无论是否经过 GraphAgent，最终提交给 ChatAgent 的文本都会以可折叠形式展示给用户，让用户知道自己的输入被处理成了什么。

### 5. 系统辅助分析区

系统层在构建临时工作集时，会并行运行可自动化的图检查，把结果填充到临时工作集的 `systemAnalysis` 区域，供 GraphAgent 直接读取。

```typescript
{
  systemAnalysis: {
    conflictingRelations: Array<{
      edgeKey: string;          // 冲突边标识
      reason: string;           // 冲突原因，如“双向关联违反原型约束”
      severity: "error" | "warning";
    }>;
    duplicateNodeCandidates: Array<{
      nodeIds: string[];        // 可能重复的节点 ID 列表
      similarityScore: number;  // 相似度分数
    }>;
    orphanNodes: string[];      // 孤立节点 ID 列表
    invalidPrototypeUsage: Array<{
      edgeKey: string;
      prototypeId: string;
      reason: string;
    }>;
  }
}
```

### 6. 版本同步

系统层负责在每次图变更后，把最新版本号、活跃工作集、图摘要同步给 ChatAgent，防止 LLM 基于过期状态做决策。

## 数据模型

### 活跃管理工作集（Active Working Set）

- 持久化在 SQLite 中。
- 用户在 GUI 侧边栏可见，可手动增删。
- 影响引用解析的默认上下文和默认节点。
- 在 Chat 过程中动态变化；GraphAgent 的图摘要请求基于当前活跃工作集。

```typescript
interface ActiveWorkingSet {
  contextIds: string[];   // 当前活跃的上下文 ID
  nodeIds: string[];      // 当前活跃的节点 ID
  capacity: number;       // 最大容量，超出时按 LRU 或用户优先级淘汰
}
```

### 临时工作集（Temporary Working Set）

- 每次请求时由系统层计算，不持久化。
- 包含本次输入中显式或隐式涉及的节点、上下文、边。
- 作为 GraphAgent 的输入上下文，帮助限定分析范围。
- GraphAgent 可在分析过程中动态扩展。

```typescript
interface TemporaryWorkingSet {
  contextIds: string[];     // 本次涉及的上下文 ID
  nodeIds: string[];        // 本次涉及的节点 ID
  edgeKeys: string[];       // 本次涉及的边标识
  // 系统辅助分析结果
  systemAnalysis: {
    conflictingRelations: Array<{
      edgeKey: string;
      reason: string;
      severity: "error" | "warning";
    }>;
    duplicateNodeCandidates: Array<{
      nodeIds: string[];
      similarityScore: number;
    }>;
    orphanNodes: string[];
    invalidPrototypeUsage: Array<{
      edgeKey: string;
      prototypeId: string;
      reason: string;
    }>;
  };
  // 扩展记录：GraphAgent 在分析过程中加入的节点/边
  expandedByGraphAgent: {
    contextIds: string[];
    nodeIds: string[];
    edgeKeys: string[];
    reason: string;          // GraphAgent 为什么要扩展，用于可解释性
  };
}
```

### 变更描述（GraphDelta）

用于在 Agent 之间传递待应用或已应用的图变更：

```typescript
interface GraphDelta {
  addNodes?: DesignTypes.Node[];       // 待新增节点
  updateNodes?: Array<{                // 待更新节点
    id: string;                        // 节点 ID
    patch: Partial<DesignTypes.Node>;  // 节点字段变更
  }>;
  deleteNodeIds?: string[];            // 待删除节点 ID
  addEdges?: DesignTypes.Edge[];       // 待新增边
  updateEdges?: Array<{                // 待更新边
    leftNodeId: string;                // 左节点 ID
    rightNodeId: string;               // 右节点 ID
    patch: Partial<DesignTypes.Edge>;  // 边字段变更
  }>;
  deleteEdgeKeys?: string[];           // 待删除边标识
}
```

### 版本标记（Version Marker）

- 每次成功的操作组（无论来自 ChatAgent 审批还是可视化编辑器手动保存）都会使数据库的图状态产生一次逻辑版本迭代。
- 版本信息从 `EventLog` 导出：每个持久化事件对应一个单调递增的序列号（或时间戳），可作为图的“修改版本”。

```typescript
interface GraphVersion {
  sequence: number;       // EventLog 事件序列号
  timestamp: number;      // 事件时间戳
  source: "chat-agent" | "visual-editor";  // 变更来源
}
```

## 同步与认知一致性

### LLM 认知过期机制

- ChatAgent 和 GraphAgent 都不能依赖过期的图状态进行决策。
- 每次 GraphAgent 执行写入（前置写入锁模式）或完成后置审查（后置审查器模式）后，系统必须同步刷新 ChatAgent 的上下文：
  - 更新 ChatAgent 可读取的当前活跃工作集。
  - 提供最新图摘要或变更摘要。
  - 标记本次修改的版本/序列号，使 ChatAgent 明确知道自己看到的是第几次修改后的状态。
- 如果 ChatAgent 在下一次响应前感知到图已被修改（例如用户在可视化编辑器手动保存），必须先重新向 GraphAgent 请求最新图摘要，再基于最新状态回应用户。

### 版本同步触发点

1. GraphAgent 执行完整组写入后。
2. GraphAgent 完成可视化编辑器保存的后置审查后。
3. 用户手动修改活跃工作集后。
4. 用户在可视化编辑器手动保存后（即使 GraphAgent 审查尚未完成，也应先通知 ChatAgent 有未审查变更）。

## 流程设计

### 1. 聊天输入流程

```
用户输入
  → 系统层：@ 引用展开 + 临时工作集（初始）+ 阈值判断
    → 阈值触发 → GraphAgent：设计分析 / 消歧 / 图转自然语言
      → 系统层：生成“处理后输入”文本
        → 展示给用户（可折叠）
          → ChatAgent
    → 未触发 → 系统层：生成“处理后输入”文本
      → 展示给用户（可折叠）
        → ChatAgent
```

**数据传递示例：**

```typescript
// 1. 用户输入原始文本
"把这个节点改名" // 用户可能正看着某个节点

// 2. 系统层构建临时工作集（初始）并交给 GraphAgent
{
  source: "chat",
  userInput: "把这个节点改名",          // 原始输入
  temporaryWorkingSet: {
    contextIds: ["ctx-core"],
    nodeIds: ["node-5"],                // 通过活跃工作集推断的当前焦点节点
    edgeKeys: [],
    systemAnalysis: { /* 自动化分析结果 */ },
    expandedByGraphAgent: { /* 初始为空 */ }
  },
  activeWorkingSet: {
    contextIds: ["ctx-core"],
    nodeIds: ["node-5", "node-1"],
    capacity: 10
  },
  graphState: { /* 当前完整图状态（按需子集） */ },
  proposedChange: undefined
}

// 3. GraphAgent 返回 enriched 输入
{
  type: "enriched-input",
  summary: "用户希望将当前焦点节点 node-5（UserService）重命名为 UserServiceV2。",
  structured: { targetNodeId: "node-5", suggestedName: "UserServiceV2" },
  affectedNodes: ["node-5"],
  affectedEdges: [],
  questions: [] // 若有歧义则返回问题
}

// 4. 系统层把 enriched 输入渲染为“处理后输入”文本并展示
// 例如：
// "[处理后输入] 将当前焦点节点 UserService（node-5）重命名为 UserServiceV2"

// 5. ChatAgent 收到 enriched 输入后决定下一步
```

### 2. 图修改流程（ChatAgent 发起）

```
ChatAgent 提出一组图操作请求
  → 系统层：构建临时工作集（初始）+ 系统辅助分析
    → GraphAgent：设计分析 + 动态扩展临时工作集
      → 返回变更提案（含警告/冲突/驳回理由）
        → 系统层：在审批面板展示提案
          → 用户显式同意
            → GraphAgent 执行整组写入 → Design DB
              → 系统层：同步最新版本/活跃工作集/图摘要给 ChatAgent
          → 用户拒绝 / 要求修订
            → ChatAgent 继续沟通 → 重新生成提案
          → 用户选择强制执行
            → GraphAgent 按原请求执行整组写入 → Design DB
              → 系统层：同步最新版本/活跃工作集/图摘要给 ChatAgent
```

**数据传递示例：**

```typescript
// 1. ChatAgent 在一轮响应中连续调用 design_* 工具，系统层归为一组
// 例如：
// design_create_node({ name: "UserServiceV2", contextId: "ctx-core" })
// design_update_edge({ leftNodeId: "node-1", rightNodeId: "new-node-1", label: "uses" })

// 2. 系统层构建 GraphAgent 输入
{
  source: "chat",
  userInput: "将 UserService 拆分出新服务 UserServiceV2，并让 OrderService 依赖它",
  temporaryWorkingSet: {
    contextIds: ["ctx-core"],
    nodeIds: ["node-1", "node-5"],        // OrderService, UserService
    edgeKeys: ["node-1->node-5"],         // OrderService -> UserService
    systemAnalysis: { /* 冲突检测等 */ },
    expandedByGraphAgent: { /* 初始为空 */ }
  },
  activeWorkingSet: {
    contextIds: ["ctx-core"],
    nodeIds: ["node-1", "node-5"],
    capacity: 10
  },
  graphState: { /* 当前图状态 */ },
  proposedChange: {
    addNodes: [{ id: "new-node-1", name: "UserServiceV2", contextId: "ctx-core", kind: "service" }],
    updateEdges: [
      { leftNodeId: "node-1", rightNodeId: "node-5", patch: { label: "uses-v2" } },
      { leftNodeId: "node-1", rightNodeId: "new-node-1", patch: { label: "uses" } }
    ]
  }
}

// 3. GraphAgent 分析后返回变更提案
{
  type: "change-proposal",
  summary: "建议新增 UserServiceV2 服务节点，并调整 OrderService 到 UserService 的依赖关系。注意：原边 label 从 'uses' 改为 'uses-v2' 可能引入歧义。",
  structured: {
    warnings: [
      { code: "AMBIGUOUS_LABEL", message: "'uses-v2' 不是已注册关系原型", edgeKey: "node-1->node-5" }
    ]
  },
  affectedNodes: ["node-1", "node-5", "new-node-1"],
  affectedEdges: ["node-1->node-5", "node-1->new-node-1"],
  questions: [],
  delta: {
    addNodes: [{ id: "new-node-1", name: "UserServiceV2", contextId: "ctx-core", kind: "service" }],
    updateEdges: [
      { leftNodeId: "node-1", rightNodeId: "node-5", patch: { label: "uses-v2" } },
      { leftNodeId: "node-1", rightNodeId: "new-node-1", patch: { label: "uses" } }
    ]
  }
}

// 4. 系统层在审批面板展示提案；用户在面板中选择
//    - 同意：GraphAgent 执行 delta 写入 DB
//    - 修订：返回 ChatAgent，由 ChatAgent 重新生成新的 proposedChange
//    - 强制执行：GraphAgent 按原 proposedChange 写入 DB

// 5. GraphAgent 执行写入后返回
{
  type: "change-applied",
  summary: "已成功新增 UserServiceV2 节点并更新依赖关系。",
  affectedNodes: ["node-1", "node-5", "new-node-1"],
  affectedEdges: ["node-1->node-5", "node-1->new-node-1"],
  delta: { /* 实际应用的变更 */ }
}

// 6. 系统层同步最新状态给 ChatAgent
{
  version: { sequence: 42, timestamp: 1719900000000, source: "chat-agent" },
  activeWorkingSet: { /* 已更新 */ },
  graphSummary: "当前图包含 UserService、UserServiceV2、OrderService ..."
}
```

### 3. 可视化编辑器保存流程

```
用户在可视化编辑器修改并手动保存
  → 直接写入 Design 数据库（raw save，保存即视为用户同意）
    → 系统层：构建临时工作集（基于改动 diff）+ 通知 ChatAgent 有未审查变更
      → GraphAgent：设计分析 / 理解改动意图（后置审查器模式）
        → ChatAgent：询问用户为什么修改、如何对齐、如何完善
          → 进入下一次 Design 循环
```

**数据传递示例：**

```typescript
// 1. 用户在可视化编辑器完成修改并手动保存
//    系统层直接把 diff 写入 DB

// 2. 系统层从 DB 读取 diff，构建临时工作集并通知 ChatAgent
{
  type: "visual-editor-change",
  version: { sequence: 43, timestamp: 1719900100000, source: "visual-editor" },
  delta: {
    addNodes: [{ id: "new-node-2", name: "PaymentGateway", contextId: "ctx-core", kind: "service" }],
    addEdges: [{ leftNodeId: "node-1", rightNodeId: "new-node-2", label: "uses" }]
  },
  temporaryWorkingSet: {
    contextIds: ["ctx-core"],
    nodeIds: ["node-1", "new-node-2"],
    edgeKeys: ["node-1->new-node-2"],
    systemAnalysis: { /* 自动化分析 */ },
    expandedByGraphAgent: { /* 初始为空 */ }
  }
}

// 3. ChatAgent 收到通知后，把 diff 和临时工作集交给 GraphAgent 审查
{
  source: "visual-editor",
  userInput: "", // 可视化编辑器保存没有自然语言输入
  temporaryWorkingSet: { /* 同上 */ },
  activeWorkingSet: { /* 当前活跃工作集 */ },
  graphState: { /* 保存后的图状态 */ },
  proposedChange: undefined // 不是提案，是已发生的改动
}

// 4. GraphAgent 返回审查结果
{
  type: "change-applied", // 或 "post-write-review"
  summary: "检测到新增 PaymentGateway 节点，OrderService 已依赖该节点。建议确认 PaymentGateway 是否需要与 UserService 建立反向依赖。",
  affectedNodes: ["node-1", "new-node-2"],
  affectedEdges: ["node-1->new-node-2"],
  questions: ["PaymentGateway 是否也需要依赖 UserService？"]
}

// 5. ChatAgent 基于审查结果与用户对话，进入下一轮设计循环
```

**同步约束**：可视化编辑器的修改必须在没有任何 Agent 正在处理问题时进行。如果 ChatAgent、GraphAgent 或 SearchAgent 正在处理当前 Design 会话中的请求，系统必须等待其完成（或取消/阻塞），再允许用户通过可视化编辑器保存。本架构不考虑异步并发编辑场景；至少保证逻辑同步，即任意时刻只存在一种正在进行的“设计修改源”：要么是 ChatAgent 驱动的流程，要么是可视化编辑器的手动保存。

可视化编辑器不实现自动保存，以减少与手动保存之间的行为差异和认知负担。

### 4. 检索流程

```
进入 Design 模式 或 ChatAgent 需要检索
  → ChatAgent 向 GraphAgent 请求当前图摘要（基于当前活跃工作集）
    → SearchAgent 接收 {graphSummary, retrievalRequirements}
      → SearchAgent：项目阅读 / 联网搜索
        → SearchAgent 自行完成参考设计与当前图的对比分析
          → 收集项目方向、参考信息、相似设计方案
            → 总结报告 → ChatAgent
            → 差异分析 → Plan/Edit 模式（当需要进入实现阶段时）
```

**数据传递示例：**

```typescript
// 1. ChatAgent 请求 GraphAgent 提供图摘要
{
  source: "chat",
  userInput: "帮我看看当前设计的项目实现差异",
  temporaryWorkingSet: { /* 基于活跃工作集 */ },
  activeWorkingSet: { /* 当前活跃工作集 */ },
  graphState: { /* 当前图状态 */ },
  proposedChange: undefined
}

// 2. GraphAgent 返回图摘要
{
  type: "graph-summary",
  summary: "当前设计包含 core 上下文中的 3 个服务节点：UserService、OrderService、PaymentGateway。UserService 被 OrderService 和 PaymentGateway 依赖。",
  affectedNodes: ["node-1", "node-5", "new-node-2"],
  affectedEdges: ["node-1->node-5", "node-1->new-node-2"]
}

// 3. ChatAgent 调用 SearchAgent
{
  graphSummary: "当前设计包含 core 上下文中的 3 个服务节点...",  // 来自 GraphAgent
  retrievalRequirements: "对比项目代码实现与当前设计，找出实现中缺少或偏离设计的部分"  // ChatAgent 明确意图
}

// 4. SearchAgent 返回结果
{
  summaryReport: "项目代码中已存在 user-service 和 order-service，但缺少 PaymentGateway；OrderService 直接调用 UserService 的内部方法，违反了当前设计的依赖方向。",
  diffAnalysis: {
    missingInCode: ["PaymentGateway"],
    divergentRelations: [
      { designEdge: "node-1->node-5", actualCode: "OrderService 直接调用 UserService 内部方法" }
    ],
    references: [
      { file: "src/services/order.ts", line: 42, snippet: "..." }
    ]
  }
}

// 5. ChatAgent 使用 summaryReport 与用户沟通；
//    当用户决定进入实现阶段时，ChatAgent 将 diffAnalysis 交给 Plan 模式
```

### 5. 模式切换与 Plan/Edit 衔接

```
ChatAgent 需要进入实现阶段
  → ChatAgent 请求 SearchAgent 进行差异分析（当前设计 vs 项目实现）
    → SearchAgent 返回差异分析报告
      → ChatAgent 将差异分析报告交给 Plan 模式
        → 用户退出 Design 模式，进入 Plan/Edit 流程
          → Plan 基于差异分析设计修改计划
```

**数据传递示例：**

```typescript
// 1. ChatAgent 把 SearchAgent 返回的 diffAnalysis 交给 Plan 模式
{
  mode: "plan",
  source: "design",
  diffAnalysis: {
    missingInCode: ["PaymentGateway"],
    divergentRelations: [
      { designEdge: "node-1->node-5", actualCode: "OrderService 直接调用 UserService 内部方法" }
    ],
    references: [/* ... */]
  },
  designGraphSummary: "当前设计包含 core 上下文中的 3 个服务节点..."
}

// 2. Plan 模式接管后续代码修改计划与执行
```

## 接口约定

### GraphAgent 输入

```typescript
interface GraphAgentInput {
  // 输入来源，决定 GraphAgent 以哪种职责模式工作
  source: "chat" | "visual-editor";

  // 预处理后的用户自然语言输入；可视化编辑器场景可为空字符串
  userInput: string;

  // 本次请求的临时工作集（系统层构建初始，GraphAgent 可动态扩展）
  temporaryWorkingSet: {
    contextIds: string[];     // 本次涉及的上下文 ID 列表
    nodeIds: string[];        // 本次涉及的节点 ID 列表
    edgeKeys: string[];       // 本次涉及的边标识列表
    systemAnalysis: {         // 系统层自动化分析结果
      conflictingRelations: Array<{
        edgeKey: string;      // 冲突边标识
        reason: string;       // 冲突原因
        severity: "error" | "warning";
      }>;
      duplicateNodeCandidates: Array<{
        nodeIds: string[];    // 可能重复的节点 ID 列表
        similarityScore: number;
      }>;
      orphanNodes: string[];  // 孤立节点 ID 列表
      invalidPrototypeUsage: Array<{
        edgeKey: string;
        prototypeId: string;
        reason: string;
      }>;
    };
    expandedByGraphAgent: {   // GraphAgent 动态扩展记录
      contextIds: string[];
      nodeIds: string[];
      edgeKeys: string[];
      reason: string;          // 扩展原因
    };
  };

  // 当前活跃工作集（持久化，影响默认引用解析）
  activeWorkingSet: {
    contextIds: string[];     // 活跃上下文 ID 列表
    nodeIds: string[];        // 活跃节点 ID 列表
    capacity: number;         // 容量上限
  };

  // 当前完整图状态（按需子集；GraphAgent 需要时可请求完整图）
  graphState: DesignTypes.GraphState;

  // ChatAgent 提出的变更（仅 chat 流程、且是提案请求时携带）
  proposedChange?: GraphDelta;

  // 当前已知的图版本号；GraphAgent 可据此判断输入是否过期
  knownVersion?: number;
}
```

### GraphAgent 输出

```typescript
interface GraphAgentOutput {
  // 输出类型，决定下游如何处理
  type:
    | "enriched-input"    // 聊天输入 enrichment
    | "graph-summary"     // 图转自然语言摘要
    | "change-proposal"   // 变更提案（chat 流程）
    | "change-applied"    // 已执行写入（chat 执行后 / 可视化编辑器审查后）
    | "rejected";         // 提案被驳回

  // 自然语言摘要（核心，ChatAgent 直接阅读）
  summary: string;

  // 可选的结构化标注，便于 ChatAgent 快速定位或系统层渲染审批面板
  structured?: {
    warnings?: Array<{
      code: string;         // 警告代码
      message: string;      // 警告消息
      nodeId?: string;      // 相关节点 ID
      edgeKey?: string;     // 相关边标识
    }>;
    suggestions?: Array<{
      action: string;       // 建议动作
      reason: string;       // 建议原因
    }>;
  };

  // 受影响的节点和边 ID
  affectedNodes: string[];
  affectedEdges: string[];

  // 需要用户澄清的问题（若有）
  questions?: string[];

  // 实际应用或建议的变更
  delta?: GraphDelta;
}
```

### SearchAgent 输入

```typescript
interface SearchAgentInput {
  // 当前图的自然语言摘要（由 ChatAgent 从 GraphAgent 获取）
  graphSummary: string;

  // ChatAgent 明确的检索意图
  retrievalRequirements: string;

  // 可选：ChatAgent 希望重点关注的上下文或节点
  focus?: {
    contextIds?: string[];
    nodeIds?: string[];
  };
}
```

### SearchAgent 输出

```typescript
interface SearchAgentOutput {
  // 面向 ChatAgent 的自然语言总结报告
  summaryReport: string;

  // 当前设计与项目实现的结构化差异分析（供 Plan 模式使用）
  diffAnalysis?: {
    missingInCode: Array<{            // 设计中有但代码中缺失的实体
      nodeId?: string;                // 对应节点 ID
      name: string;                   // 实体名称
      reason: string;                 // 为什么认为缺失
    }>;
    divergentRelations: Array<{       // 实现与设计不符的关系
      designEdge?: string;            // 设计中的边标识
      actualCode: string;             // 代码中的实际情况
      reason: string;
    }>;
    references: Array<{               // 参考来源
      file: string;                   // 文件路径
      line?: number;                  // 行号
      snippet: string;                // 代码片段或摘要
    }>;
  };

  // 非图信息：设计方向文本、参考链接等
  nonGraphInfo?: Array<{
    type: "text" | "link";
    content: string;
  }>;
}
```

## 审批面板状态机

审批面板是系统 UI 组件，不是 Agent。它管理以下状态：

```typescript
type ApprovalPanelState =
  | { status: "idle" }                                    // 无待审批提案
  | { status: "proposing"; proposal: GraphAgentOutput }   // 展示 GraphAgent 变更提案
  | { status: "executing"; proposal: GraphAgentOutput }   // 用户已确认，GraphAgent 写入中
  | { status: "done"; proposal: GraphAgentOutput }        // 写入完成
  | { status: "rejected"; reason: string };               // 用户拒绝或要求修订
```

状态转换：

- `idle` → `proposing`：GraphAgent 返回 `change-proposal`。
- `proposing` → `executing`：用户点击“确认”或“强制执行”。
- `executing` → `done`：GraphAgent 成功执行写入。
- `executing` → `proposing`：写入失败，重新展示提案或错误。
- `proposing` → `rejected`：用户点击“拒绝/修订”。
- `rejected` → `idle`：ChatAgent 重新生成提案后，流程重新开始。

## 错误处理与用户控制

- GraphAgent 驳回请求时，必须给出可被 ChatAgent 转达的自然语言理由，并向用户展示三个选项：
  1. **强制执行**：忽略警告，按原请求执行。
  2. **继续沟通**：ChatAgent 与用户进一步讨论，寻找不冲突的方案。
  3. **修订冲突**：用户修改输入或图后重新提交。
- 所有由 ChatAgent 发起的图数据库写入必须以整组操作为单位经用户在审批面板显式同意；可视化编辑器的手动保存视为用户同意。
- 系统层预处理失败（如 @ 引用不存在）时，直接提示用户，不进入 Agent 流程。
- 所有对 `Design.Service` 的写操作必须通过事务；失败时由 GraphAgent 捕获并返回错误摘要。
- 当 Agent 上下文版本落后于当前数据库版本时，系统层必须暂停该 Agent 的响应流程，先刷新其认知，再继续。

## 测试策略

- 单元测试：系统层阈值判断、临时工作集计算、@ 引用展开、系统辅助分析区生成。
- 集成测试：GraphAgent 对 ChatAgent 请求的驳回/执行流程、审批面板状态机、版本同步机制。
- E2E 测试：可视化编辑器手动保存 → 数据库更新 → GraphAgent 分析 → ChatAgent 引导下一轮讨论。
- 权限测试：SearchAgent 的读写权限边界、GraphAgent 对 `Design.Service` 写权限的独占性。
- 认知一致性测试：模拟可视化编辑器保存后，验证 ChatAgent 不会基于过期图摘要回应用户。

## 待实现拆分建议

以下阶段用于**逐步实现**本架构，降低单次变更风险。所有阶段都必须完成；不允许只实现前几个阶段就停止。

1. **阶段一**：在 Design 主 Agent 中引入 GraphAgent 作为子 Agent，处理 ChatAgent 发起的图操作请求；实现审批面板状态机。
2. **阶段二**：增加系统层预处理（@ 引用、临时工作集、阈值、系统辅助分析区），让 GraphAgent 参与输入 enrichment。
3. **阶段三**：接入 SearchAgent，实现进入 Design 模式时的自动项目阅读和显式联网搜索；实现 Design → Plan/Edit 衔接。
4. **阶段四**：定义可视化编辑器与 Agent 系统的交互协议，实现保存后的改动分析流；实现版本同步与认知过期机制。

## 相关文件

- `docs/superpowers/specs/2026-07-01-design-multi-agent-architecture-diagram.html`
- `packages/opencode/src/design/design.ts`
- `packages/opencode/src/design/core/types.ts`
- `packages/opencode/src/design/core/event-log.ts`
- `packages/opencode/src/agent/agent.ts`
- `packages/opencode/src/agent/prompt/design.txt`
- `packages/opencode/src/tool/design.ts`
- `packages/opencode/src/tool/registry.ts`
