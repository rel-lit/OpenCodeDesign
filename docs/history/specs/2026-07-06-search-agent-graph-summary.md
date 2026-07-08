# SearchAgent 图摘要注入规格

## 日期

2026-07-06

## 背景

`design-search` 子代理原本被设计为**被动接收者**：它接收 `graphSummary`、`retrievalRequirements` 和可选 `focus`，然后读取项目代码或网络资料，产出设计与实现之间的差异分析。

当前实现偏离了该设计：`design_search_project` 和 `design_search_web` 只向子代理传递一句 raw intent/query，不携带任何图摘要。`SearchAgent.Service` 及其 `readProject` 方法虽然已定义，但悬空未被调用。

本规格说明如何恢复并完善原本设计。

## 代理职责边界

| 代理 | 职责 | 是否可读取设计图 |
|---|---|---|
| `design-graph` | 维护设计图，提供认知、变更、摘要 | 是 |
| `design-search` | 拿到图摘要后，对比代码库或网络资料 | 否 |
| `design` (ChatAgent) | 编排者：决定何时对比、准备图摘要、调用 SearchAgent | 通过子代理工具间接使用 |

保持该边界：**SearchAgent 不直接调用任何 design 图工具**。所有图信息由调用方注入。

## 输入输出契约

### `design_search_project` 工具参数

```ts
{
  intent: string;                              // 必填：搜索方向，例如"检查设计中定义的概念是否在代码里实现"
  graph_summary?: string;                      // 可选：覆盖自动生成的图摘要
  focus?: {
    contexts?: string[];                       // 上下文名称或 ID 列表
    concepts?: string[];                       // 概念名称或 ID 列表
  };
}
```

### `design_search_web` 工具参数

```ts
{
  query: string;                               // 必填：网络搜索主题
  graph_summary?: string;                      // 可选：覆盖自动生成的图摘要
  focus?: {
    contexts?: string[];
    concepts?: string[];
  };
}
```

### 自动图摘要

### 自动图摘要（通过 GraphAgent）

如果调用方没有提供 `graph_summary`，`design_search_project`/`design_search_web` 工具**不直接读取设计图服务**，而是先调用 `design-graph` 子代理获取图分析：

1. **无 `focus` 时**：调用 GraphAgent 的 summarize 模式，获取当前全图自然语言摘要。
2. **有 `focus` 时**：调用 GraphAgent 的 cognition 模式，把 `focus` 转换为具体问题：
   - `focus.contexts` → "请分析上下文 `\u003ccontext\u003e` 中的概念及其关系"
   - `focus.concepts` → "请分析概念 `\u003cconcept\u003e` 及其一跳邻居"
   - 两者同时提供时 → 组合为"请分析上下文 `\u003ccontext\u003e` 中概念 `\u003cconcept\u003e` 及其相关关系"

GraphAgent 返回的自然语言分析文本作为 `graph_summary` 注入 SearchAgent prompt。

调用方始终可以通过显式提供 `graph_summary` 跳过 GraphAgent 调用。

### 传给 SearchAgent 的 prompt 格式

```
## Graph Summary
<自动或用户提供的图摘要>

## Retrieval Requirements
<intent 或 query>

## Focus (optional)
<contexts: ...>
<concepts: ...>
```

SearchAgent 的系统 prompt 将按此格式说明输入结构。

### SearchAgent 输出

保持现有 `Output` 结构不变：

```ts
{
  summaryReport: string;
  diffAnalysis?: {
    missingInCode: Array<{ nodeId?: string; name: string; reason: string }>;
    divergentRelations: Array<{ designEdge?: string; actualCode: string; reason: string }>;
    references: Array<{ file: string; line?: number; snippet: string }>;
  };
  nonGraphInfo?: Array<{ type: "text" | "link"; content: string }>;
}
```

## 实现计划

### 1. 扩展工具参数

修改 `packages/opencode/src/tool/design.ts`：

- `SearchProjectParameters` 增加 `graph_summary`、`focus`
- `SearchWebParameters` 增加 `graph_summary`、`focus`

### 2. 实现自动摘要和聚焦

新增内部 helper：

```ts
function buildGraphSummary(
  task: TaskTool.Interface,
  ctx: Tool.Context,
  graphSummary?: string,
  focus?: { contexts?: string[]; concepts?: string[] }
): Effect.Effect<string>
```

行为：
- 若 `graph_summary` 已提供，直接返回。
- 否则调用 `design-graph` 子代理：
  - 无 `focus` 时使用 summarize 模式
  - 有 `focus` 时使用 cognition 模式，把 focus 转成自然语言询问

### 3. 更新 SearchAgent prompt

修改 `packages/opencode/src/design/agent/prompt/search.txt`：

- 明确输入包含 `## Graph Summary` 和 `## Retrieval Requirements`
- 说明如果提供了 `## Focus`，GraphAgent 已经据此生成摘要，SearchAgent 应基于该摘要分析
- 保持输出 schema 要求不变

### 4. 更新 ChatAgent 设计提示

修改 `packages/opencode/src/agent/prompt/design.txt`：

- 说明 `design_search_project` 会自动调用 GraphAgent 生成当前设计摘要
- 说明可以使用 `focus` 让 GraphAgent 聚焦到特定上下文或概念
- 提醒用户如无特殊需要，只需提供 `intent`

### 5. 激活 `SearchAgent.readProject`

`SearchAgent.Service.readProject` 当前悬空。处理方式：

- 保持 `design_search_project` 使用 `TaskTool` 调用 `design-search` subagent，因为 `TaskTool` 已处理 session 父子关系、权限、tracing。
- 在 `design_search_project` 工具内构造符合 `readProject` 输入契约的 prompt，即 `graphSummary + retrievalRequirements + focus`。
- `SearchAgent.readProject` 保留作为直接程序调用入口，供未来非子代理场景使用。

### 6. 测试

新增测试到 `packages/opencode/test/tool/graph-agent-design.test.ts` 或新建 `packages/opencode/test/tool/search-agent.test.ts`：

- `design_search_project` 自动携带图摘要
- `focus.contexts` 会缩小摘要范围
- `focus.concepts` 会保留目标概念及一跳邻居
- `graph_summary` 覆盖会跳过自动生成
- SearchAgent 输出包含 `summaryReport`

## 不做的范围

- 不给 SearchAgent 分配任何 design 图工具权限。
- 不改 `design-graph` 子代理的职责。
- 不改 `SearchAgent.Output` schema。
- 不引入网络搜索具体实现（`design_search_web` 仍只传递 prompt，具体 web 搜索由子代理使用已授权的 `websearch`/`webfetch` 工具完成）。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 图摘要过大超出上下文窗口 | 先复用 `Truncate.Service` 或 `design.summarizeGraphState()` 的摘要能力；未来可添加摘要截断策略 |
| focus 解析失败 | 若名称/ID 找不到，回退到全图摘要并记录 warning |
| SearchAgent 仍然自行去读图 | 保持权限 deny 所有 `design_*` 工具给 `design-search`；测试验证 prompt 中已包含所需信息 |

## 相关文件

- `packages/opencode/src/tool/design.ts`
- `packages/opencode/src/design/agent/search.ts`
- `packages/opencode/src/design/agent/prompt/search.txt`
- `packages/opencode/src/agent/prompt/design.txt`
- `packages/opencode/test/tool/graph-agent-design.test.ts` 或新建 `packages/opencode/test/tool/search-agent.test.ts`
- `docs/specs/2026-07-06-search-agent-graph-summary.md`（本文档）
