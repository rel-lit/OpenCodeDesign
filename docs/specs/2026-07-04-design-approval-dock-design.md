# Design Approval Dock 设计规格

## 背景与问题

当前 Design Mode v2 的审批流程复用了通用的 `SessionQuestionDock`（问题面板）。GraphAgent 在 `judge` 模式下调用 `question.ask` 展示变更计划（Change Plan），用户在父会话的 question dock 中选择选项。

这个方案能工作，但存在明显体验缺口：

1. **Change Plan 是 Markdown 格式的结构化文本**，而 `SessionQuestionDock` 把问题文本当普通文本渲染，列表、代码块、标题等格式丢失。
2. **审批交互语义不足**：`SessionQuestionDock` 的核心交互是"从选项中选择/自定义回答"，它把自定义输入当作一个选项（radio/checkbox）来呈现。设计审批需要的是"应用 / 需要修改 / 拒绝"三个显式动作，并且"需要修改"应该是一个可折叠的多行文本区，而不是一个选项。
3. **视觉语义不清晰**：用户难以一眼看出这是一个"设计图变更审批"，而不是普通的问题调查。

因此需要新增一个专门的 **Design Approval Dock**。它将复用 `DockPrompt` 通用容器和 `Question.Service` 协议，但重新编排 UI，不再沿用 `SessionQuestionDock` 的选项列表逻辑。

## 设计目标

- 不修改通用 `SessionQuestionDock`，避免影响所有 question 工具的使用场景。
- 新增独立的 `SessionDesignApprovalDock`，结构与 `SessionQuestionDock` 类似，但针对审批场景优化。
- Change Plan 文本使用 Markdown 渲染。
- 提供三个明确操作：**应用（Apply）**、**需要修改（Revise）**、**拒绝（Reject）**。
- "需要修改" 展开一个多行文本输入框，用户填写修改意见后提交。
- 复用现有的 `Question.Service` 协议，不需要新增后端事件类型。
- 面板能被会话树冒泡机制正确识别和显示（子智能体的审批请求能显示在父会话）。

## 方案概述

### 核心思路

Design Approval Dock 仍然基于 `question.ask` 事件和 `Question.Service` 的 `reply/reject` API。区别在于前端渲染和交互方式：

- **识别方式**：通过 question request 的 metadata 或 header 标记这是一个设计审批请求。
- **渲染方式**：用 Markdown 组件渲染 `question` 字段里的 Change Plan。
- **交互方式**：用三个显式按钮替代选项列表，Revise 的回答通过 custom answer 提交。

### 复用点（直接照搬 `SessionQuestionDock` 的已有实现）

| 功能 | 来源 | 是否复用 |
|------|------|---------|
| `DockPrompt` 容器外壳、动画、定位 | `session-permission-dock.tsx` / `session-question-dock.tsx` | ✅ 直接复用 |
| `useMutation` + SDK `question.reply/reject` | `session-question-dock.tsx` 的 `replyMutation` / `rejectMutation` | ✅ 照搬模式 |
| 响应中状态防止重复提交 | `session-permission-dock.tsx` 的 `responding` prop | ✅ 照搬模式 |
| 内容区最大高度计算（避免遮挡消息） | `session-question-dock.tsx` 的 `measure()` | ✅ 照搬 |
| textarea 自动增高 | `session-question-dock.tsx` 的 `resizeInput()` | ✅ 照搬 |
| 错误提示 | `showToast` 模式 | ✅ 照搬 |

### 不沿用 `SessionQuestionDock` 的地方

- **不渲染 `options` 列表**：审批面板不需要 radio/checkbox 选项。
- **不使用多问题 tab 进度**：设计审批通常只有一个问题（即 Change Plan），不需要 `questions[]` 的 stepper。
- **自定义输入不是选项**：`SessionQuestionDock` 把 custom 输入嵌入到选项列表里；审批面板把 revise 输入区放在 Markdown 内容下方，作为显式动作的一部分。
- **问题文本使用 Markdown 渲染**：不再使用 `{question()?.question}` 纯文本输出。

### 为什么选择复用 Question 协议而不是 Permission 协议

| 维度 | Question 协议 | Permission 协议 |
|------|--------------|----------------|
| 支持自定义文本回复 | ✅ `custom: true` | ❌ 只有 once/always/reject |
| 支持多选项展示 | ✅ | ❌ |
| 已有子会话冒泡 | ✅ | ✅ |
| 语义匹配度 | 需要用户审阅方案后做决定 | 偏工具权限授权 |

设计审批需要用户可能给出结构化反馈（"把 A 改成 B"），Question 协议的 custom answer 更适合。Permission 协议缺少自由文本输入。

## 识别设计审批请求

### 方案 A：通过 `header` 约定识别（推荐）

GraphAgent 调用 `question.ask` 时，把 `header` 设为一个固定前缀：

```json
{
  "header": "[design-approval] 设计变更审批",
  "question": "... Change Plan Markdown ...",
  "options": [
    { "label": "应用", "description": "按此方案执行变更" },
    { "label": "拒绝", "description": "不执行任何变更" }
  ],
  "custom": true
}
```

前端通过 `header.startsWith("[design-approval]")` 判断使用 Design Approval Dock 还是普通 Question Dock。

**优点**：
- 不改动 schema。
- 兼容旧客户端：旧客户端会按普通 question 渲染，功能仍然可用。

**缺点**：
- 依赖字符串约定，略显隐式。

### 方案 B：通过 `metadata` 识别

在 `QuestionInfo` 的 `metadata` 里加一个字段：

```json
{
  "metadata": { "designApproval": true }
}
```

**优点**：更结构化。

**缺点**：需要改 schema（`QuestionInfo` 已有 `metadata` 字段，类型是 `Record<string, any>`，所以不需要改 schema，但客户端需要约定 key）。

### 最终选择

**方案 A（header 前缀）作为最小可行方案**，同时保留方案 B 的 metadata 约定作为未来扩展。前端优先匹配 header 前缀，匹配失败则回退到普通 question dock。

## UI 设计

### 组件结构

```tsx
// packages/app/src/pages/session/composer/session-design-approval-dock.tsx

export function SessionDesignApprovalDock(props: {
  request: QuestionRequest
  responding: boolean
  onResponseSubmit: () => void
}) { ... }
```

与 `SessionPermissionDock` 的 props 风格保持一致：接收 `request` 和 `responding` 状态，以及提交后的回调。

### 布局

```
┌─────────────────────────────────────┐
│ 🤖 来自 design-graph 子智能体        │  ← header
├─────────────────────────────────────┤
│ ### 变更意图                         │  ← children
│ 为游戏增加"玩家背包"概念...          │
│                                     │
│ ### 新增概念                         │
│ - 玩家背包（PlayerInventory）        │
│ - 物品槽（ItemSlot）                 │
│                                     │
│ [需要修改 ▼]                         │
│ ┌─────────────────────────────────┐ │
│ │ 请把"物品槽"改为"装备槽"，并... │ │  ← 可折叠输入框
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ [  拒绝  ] [ 需要修改 ] [  应用  ]   │  ← footer
└─────────────────────────────────────┘
```

### 复用点（直接照搬 `SessionQuestionDock` 的已有实现）

| 功能 | 来源 | 是否复用 |
|------|------|---------|
| `DockPrompt` 容器外壳、动画、定位 | `session-permission-dock.tsx` / `session-question-dock.tsx` | ✅ 直接复用 |
| `useMutation` + SDK `question.reply/reject` | `session-question-dock.tsx` 的 `replyMutation` / `rejectMutation` | ✅ 照搬模式 |
| 响应中状态防止重复提交 | `session-permission-dock.tsx` 的 `responding` prop | ✅ 照搬模式 |
| 内容区最大高度计算（避免遮挡消息） | `session-question-dock.tsx` 的 `measure()` | ✅ 照搬 |
| textarea 自动增高 | `session-question-dock.tsx` 的 `resizeInput()` | ✅ 照搬 |
| 错误提示 | `showToast` 模式 | ✅ 照搬 |

### 不沿用 `SessionQuestionDock` 的地方

- **不渲染 `options` 列表**：审批面板不需要 radio/checkbox 选项。
- **不使用多问题 tab 进度**：设计审批通常只有一个问题（即 Change Plan），不需要 `questions[]` 的 stepper。
- **自定义输入不是选项**：`SessionQuestionDock` 把 custom 输入嵌入到选项列表里；审批面板把 revise 输入区放在 Markdown 内容下方，作为显式动作的一部分。
- **问题文本使用 Markdown 渲染**：不再使用 `{question()?.question}` 纯文本输出。

### Header

- 左侧显示图标（如 `git-branch` 或自定义设计图标）和标题："设计变更审批"。
- 右侧可选显示子智能体来源："来自 design-graph"。
- 实现风格参考 `SessionPermissionDock` 的 header：一行图标 + 标题，不引入复杂进度指示器。

### Content

- 使用已有的 `Markdown` 组件渲染 `question` 字段。
- 如果内容过长，区域内部可滚动。直接复用 `SessionQuestionDock` 的 `measure()` 逻辑计算最大高度，但无需处理多问题的进度条。

### Revise 输入区

- 默认折叠，只显示 "需要修改" 按钮。
- 点击 "需要修改" 后，按钮下方展开一个 `<textarea>`，同时按钮变为 "提交修改意见"。
- 输入框 placeholder："请描述你希望如何修改这个方案..."
- 支持多行，自动增高。直接复用 `SessionQuestionDock` 的 `resizeInput()` 实现。

### Footer 按钮

从左到右：

1. **拒绝**（ghost 样式）：调用 `client.question.reject()`。
2. **需要修改**（secondary 样式）：
   - 如果输入框未展开，点击后展开输入框。
   - 如果输入框已展开且为空，提示需要填写内容。
   - 如果输入框已展开且有内容，调用 `client.question.reply()`，答案为 `["revise", inputText]`。
3. **应用**（primary 样式）：调用 `client.question.reply()`，答案为 `["apply"]`。

> 注：使用 `["apply"]` 和 `["revise", "..."]` 作为 answer 数组，GraphAgent 后端按约定解析。普通 question 的 answer 是选项 label 数组，这里把 label 当作命令 token。
>
> 按钮文案：
> - "应用" / "Apply" → 新增 i18n key `session.designApproval.action.apply`
> - "需要修改" / "Revise" → 新增 i18n key `session.designApproval.action.revise`
> - "拒绝" / "Reject" → 新增 i18n key `session.designApproval.action.reject`
> - 标题 "设计变更审批" / "Design change approval" → 新增 i18n key `session.designApproval.title`
> - 子智能体来源提示 "来自 design-graph" → 新增 i18n key `session.designApproval.source`（带 `agent` 参数）
> - 输入框 placeholder → 新增 i18n key `session.designApproval.revisePlaceholder`
>
> 新 key 至少需要加到 `en.ts` 和 `zh.ts`；其他语言可由后续 parity test 提醒补充。

## 与 GraphAgent 的协议

### GraphAgent 发起审批

在 `judge` 模式下，GraphAgent 构造 question 时：

```json
{
  "header": "[design-approval] 设计变更审批",
  "question": "## 变更意图\n...\n## 新增概念\n...",
  "options": [
    { "label": "应用", "description": "按此方案执行设计变更" },
    { "label": "拒绝", "description": "放弃本次变更" }
  ],
  "custom": true,
  "metadata": { "designApproval": true }
}
```

### GraphAgent 解析回答

收到 answer 后：

- `answers[0][0] === "apply"` → 内部切换到 `execute` 模式执行变更。
- `answers[0][0] === "revise"` → 提取 `answers[0][1]` 作为用户修改意见，返回 `type: "needs-clarification"` 给 ChatAgent。
- question rejected → 返回 `type: "rejected"`。

> 为了向后兼容，也支持传统的 label 回答：`["应用"]` 视为 apply，`["拒绝"]` 视为 reject，自定义文本视为 revise。

## 需要改动的文件

### 新增文件

- `packages/app/src/pages/session/composer/session-design-approval-dock.tsx`
  - 新的审批面板组件。
  - 参考 `SessionQuestionDock.tsx` 的容器用法、`measure()`、`resizeInput()`、`useMutation` 模式。
  - 参考 `SessionPermissionDock.tsx` 的 header 风格、`responding` prop 和 footer 按钮排列。

### 修改文件

- `packages/app/src/pages/session/composer/session-composer-region.tsx`
  - 在 `SessionQuestionDock` 之前渲染 `SessionDesignApprovalDock`。
  - 当检测到 design-approval 请求时，优先显示专用面板。

- `packages/app/src/pages/session/composer/session-composer-state.ts`
  - 新增 `designApprovalRequest()` memo，从 `sync().data.question` 中识别 header 前缀或 metadata。
  - 新增 `designApprovalResponding()` memo 和 `designApprovalRespond()` 方法，风格与 `decide()` 一致。
  - 更新 `blocked()` 计算，使其考虑 design approval 请求。

- `packages/app/src/pages/session/composer/session-request-tree.ts`
  - 不需要修改，已有 `sessionQuestionRequest` 会自然遍历会话树。

- `packages/app/src/i18n/en.ts` 和 `packages/app/src/i18n/zh.ts`
  - 新增 `session.designApproval.*` 相关 key。

- `packages/opencode/src/design/agent/prompt/graph.txt`
  - 更新 `judge` 模式下的 `question.ask` 示例，使用新的 header 和选项约定。

### 不修改的文件

- `packages/session-ui/src/components/dock-prompt.tsx`：容器支持任意 `kind` 字符串，无需修改。
- `packages/opencode/src/question/index.ts`：协议不变。
- `packages/schema/src/v1/question.ts`：metadata 已存在，无需 schema 变更。
- `packages/app/src/pages/session/composer/session-question-dock.tsx`：不改动通用问题面板。

## 集成到 Composer Region

新的渲染顺序：

```tsx
<Show when={controller.state.designApprovalRequest()} keyed>
  {(request) => (
    <SessionDesignApprovalDock
      request={request}
      responding={controller.state.designApprovalResponding()}
      onResponseSubmit={controller.onResponseSubmit}
    />
  )}
</Show>

<Show when={controller.state.questionRequest()} keyed>
  {(request) => (
    <SessionQuestionDock request={request} onSubmit={controller.onResponseSubmit} />
  )}
</Show>
```

`designApprovalRequest()` 优先匹配，匹配到的请求不再进入 `questionRequest()`。

## 状态与响应处理

参考 `SessionPermissionDock` 的 `responding` 模式：

- `createSessionComposerController` 中新增 `designApprovalResponding()` memo 和 `designApprovalRespond()` 方法。
- 调用 `question.reply` 或 `question.reject` 时设置 `responding` 状态，防止重复提交。
- 错误时通过 `showToast` 提示。

## 测试策略

1. **组件级单元测试**（Vitest + SolidJS testing library）：
   - 渲染 `SessionDesignApprovalDock`，验证 Markdown 正确渲染。
   - 点击"需要修改"后输入框展开。
   - 点击"应用"调用 mock 的 `question.reply` 并传入 `["apply"]`。
   - 点击"拒绝"调用 mock 的 `question.reject`。

2. **状态选择测试**：
   - `sessionQuestionRequest` 或新的选择器能从 question 列表中正确识别 design-approval 请求。

3. **真实 GUI 测试**：
   - 在桌面端实际触发一次 `design_request_change`，确认：
     - 面板标题显示"设计变更审批"。
     - Change Plan 中的 Markdown 列表正确显示。
     - "需要修改"输入框能输入并提交。
     - 提交后子智能体正确切换到 execute 或返回 revise。

## 后续扩展

- 未来可把 header 前缀识别迁移为 schema 级字段（如 `QuestionInfo.kind: "design-approval"`）。
- 可在面板中展示受影响的概念/上下文小标签（从 metadata 传入）。
- 可与 Visual Editor dirty 状态联动，在面板标题提示"当前 Visual Editor 有未同步修改"。

## 决策总结

| 决策 | 选择 |
|------|------|
| 修改通用 question dock 还是新增面板 | **新增 `SessionDesignApprovalDock`** |
| 复用 Question 还是 Permission 协议 | **复用 Question 协议**（需要 custom answer） |
| 如何识别设计审批请求 | **header 前缀 `[design-approval]` + metadata fallback** |
| 操作按钮 | **拒绝 / 需要修改 / 应用** |
| Revise 意见如何传递 | **answer `["revise", "用户意见"]`** |
| Markdown 渲染 | **复用现有 `Markdown` 组件** |
