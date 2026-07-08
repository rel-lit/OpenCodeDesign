# Design 审批时间线渲染统一规格

> 日期：2026-07-06
> 状态：规范 / 待实现

## 背景与问题

Design 模式的两阶段审批面板（初稿、终稿）在 composer dock 中已经能正常触发和交互。但审批交互结束后，子代理时间线中工具调用结果的渲染不一致：

- **初稿**：GraphAgent `change` 模式阶段 2 直接调用通用 `question` 工具，时间线显示为「问题 1 已回答」面板，可展开查看完整问题与答案。
- **终稿**：GraphAgent `change` 模式阶段 4 调用专用 `design_finalize_change` 工具，时间线显示为通用工具卡片「调用了 design_finalize_change」，问题和答案丢失。

这种不一致让用户在回顾会话时，无法从时间线直接看到终稿审批的具体内容。

## 设计目标

- 初稿和终稿审批在时间线中具有**统一的专用渲染卡片**。
- 卡片标题分别为「初稿审批」和「终稿审批」，不再使用「问题」或「调用了 xxx」。
- 展开后显示完整的审批问题正文、选项、用户选择结果。
- 不破坏通用 `question` 工具的渲染逻辑。
- 不改动 dock 面板交互。

## 核心思路

为设计审批引入两个专用工具，分别对应两个阶段：

| 阶段 | 工具名 | 标题 |
|---|---|---|
| 初稿 | `design_request_approval` | 初稿审批 |
| 终稿 | `design_finalize_change` | 终稿审批 |

两个工具都直接调用 `Question.Service.ask`（不经过 `question` 工具），因此不会产生独立的 question ToolPart。工具返回结果中携带 `questions` 和 `answers` metadata，前端用一个统一的 `design_approval` 渲染器展示。

通用 `question` 工具保持原样，不再用于设计审批场景。

## 后端设计

### 新增 `design_request_approval` 工具

**用途**：替代 GraphAgent `change` 模式阶段 2 中对通用 `question` 工具的调用，专门用于初稿审批。

**参数**：

```ts
{
  summary: string           // 变更计划摘要（Markdown）
  warnings?: string         // 发现的问题或警告（可选，Markdown）
  has_issues?: boolean      // 是否存在明显问题
}
```

**行为**：

1. 构造单个 question：
   - `header`: `"设计变更审批"`
   - `question`: 以 `[design-approval]` 开头，后接 summary 和 warnings
   - `options`:
     - 无问题时：`Approve`、`Revise`、`Reject`
     - 有问题时：`Force`、`Revise`、`Reject`
   - `custom: true`
2. 直接调用 `Question.Service.ask` 触发 dock。
3. 解析用户回答，返回结果：
   - `result`: `"approve" | "force" | "revise" | "reject"`
   - `metadata.questions`: 构造的问题数组
   - `metadata.answers`: 用户回答数组
   - `metadata.revisionText`: 当 result 为 revise 时，用户填写的修订意见

**返回值示例**：

```ts
{
  title: "初稿审批",
  output: "用户选择：Approve",
  metadata: {
    questions: [...],
    answers: [["Approve"]],
    result: "approve"
  }
}
```

### 修改 `design_finalize_change` 工具

当前 `design_finalize_change` 已经直接调用 `Question.Service.ask`，只需补充 metadata：

1. 把内部构造的 question 和用户回答记录到返回 metadata。
2. 返回结构保持一致，metadata 增加：
   - `questions`
   - `answers`
   - `result`: `"applied" | "abandoned" | "revision"`
   - `revisionText`（当 result 为 revision 时）

## 前端设计

### 新增 `design_approval` 工具渲染器

在 `packages/session-ui/src/components/message-part.tsx` 中注册：

```tsx
ToolRegistry.register({
  name: "design_approval",
  render(props) {
    const isFirst = props.tool === "design_request_approval"
    const title = isFirst ? "初稿审批" : "终稿审批"
    const questions = () => (props.metadata.questions ?? []) as QuestionInfo[]
    const answers = () => (props.metadata.answers ?? []) as QuestionAnswer[]
    const completed = () => answers().length > 0

    return (
      <BasicTool
        {...props}
        defaultOpen={completed()}
        icon="branch"
        trigger={{ title, subtitle: completed() ? "已回答" : "待回答" }}
      >
        <Show when={completed()}>
          <div data-component="design-approval-answers">
            <For each={questions()}>
              {(q, i) => (
                <div data-slot="design-approval-answer-item">
                  <div data-slot="design-approval-question">{q.question}</div>
                  <div data-slot="design-approval-answer">
                    {answers()[i()]?.join(", ") || "无回答"}
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </BasicTool>
    )
  },
})
```

### 映射专用工具到渲染器

在 `ToolPartDisplay` 的 `render()` 中：

```tsx
const render = createMemo(() => {
  const registered = ToolRegistry.render(part().tool)
  if (registered) return registered
  if (part().tool === "design_request_approval" || part().tool === "design_finalize_change") {
    return ToolRegistry.render("design_approval")
  }
  if (isDesignSubagentTool(part().tool)) return ToolRegistry.render("task")
  return GenericTool
})
```

### 移除 `design_finalize_change` 的通用内部工具标题映射

`designInternalToolInfo` 中 `design_finalize_change` 的映射不再使用，因为专用渲染器会覆盖。可以保留或移除，建议移除以避免歧义。

## GUI 说明

### 标题

| 阶段 | Dock 标题 |
|---|---|
| 初稿 | 🧭 设计变更方向审批 |
| 终稿 | 🔒 设计变更终稿确认 |

### 交互

两个阶段共享同一套 DockPrompt 容器和选项交互，统一为 Question 面板模式：

- 用户在选项列表中选择一项（单选）。
- 选择"修订"时展开多行输入框。
- 右下角只有一个"提交"按钮，没有独立的"拒绝"按钮。
- 提交时根据所选选项发送对应的 answer。

## 权限设计

`packages/opencode/src/agent/agent.ts` 中 `designGraphPermissions`：

- 添加 `design_request_approval: "allow"`。
- `design_finalize_change` 权限已存在，保持不变。
- `question` 权限可以保留给 GraphAgent 用于细化阶段的普通问题，但不再用于审批。

## Prompt 更新

`packages/opencode/src/design/agent/prompt/graph.txt`：

- change 模式阶段 2 工作流中，把「调用 `question.ask`」改为「调用 `design_request_approval`」。
- 说明 `design_request_approval` 的参数：`summary`、`warnings`、`has_issues`。
- change 模式阶段 4 末尾仍然调用 `design_finalize_change`。

## 需要改动的文件

### 后端

- `packages/opencode/src/tool/design.ts`
  - 新增 `DesignRequestApprovalTool`。
  - 修改 `DesignFinalizeChangeTool` 返回 metadata，增加 questions/answers/result。
  - 导出 `DesignRequestApprovalTool` 并加入 `GraphAgentDesignTools`。

- `packages/opencode/src/agent/agent.ts`
  - `designGraphPermissions` 增加 `design_request_approval: "allow"`。

- `packages/opencode/src/design/agent/prompt/graph.txt`
  - change 模式阶段 2 调用 `design_request_approval` 而非 `question.ask`。
  - change 模式阶段 4 末尾调用 `design_finalize_change`。

### 前端

- `packages/session-ui/src/components/message-part.tsx`
  - 注册 `design_approval` 渲染器。
  - `ToolPartDisplay.render()` 映射 `design_request_approval` 和 `design_finalize_change` 到该渲染器。
  - 可选：移除 `designInternalToolInfo` 中 `design_finalize_change` 的标题映射。

### 测试

- `packages/opencode/test/tool/graph-agent-design.test.ts`
  - 更新 change 模式测试，验证 `design_request_approval` 存在且参数正确。
  - 更新终稿测试，验证 `design_finalize_change` 返回 metadata 包含 questions/answers。

## 数据流示例

### 初稿

```
用户：设计一个船战系统
  → ChatAgent 调用 design_request_change
    → design-graph subagent (change 模式)
      → 阶段 1：读图、分析、生成 Change Plan
        → 阶段 2：调用 design_request_approval({ summary, warnings, has_issues })
          → Question.Service.ask → dock 显示「设计变更审批」
            → 用户选择 Approve
              → design_request_approval 返回 { result: "approve", metadata: { questions, answers } }
                → 时间线显示「初稿审批」卡片，展开可见 Q&A
                  → 进入阶段 3 细化
```

### 终稿

```
change 模式阶段 4
  → 调用 design_finalize_change
    → Question.Service.ask → dock 显示「Finalize design changes」
      → 用户选择 Approve
        → design_finalize_change 自动提交 accumulator
          → 返回 { result: "applied", metadata: { questions, answers } }
            → 时间线显示「终稿审批」卡片，展开可见 Q&A
```

## 关键约束

- 两个审批工具都必须直接调用 `Question.Service.ask`，不能经过 `question` 工具，避免产生重复的 question ToolPart。
- 通用 `question` 工具保持原样，只用于 change 模式阶段 3 的具体细节提问。
- Dock 面板的识别逻辑基于 question header 或前缀，无需修改。
- 时间线渲染器只读取 metadata，不改变后端审批逻辑。

## 测试策略

1. **单元测试**：验证 `design_request_approval` 和 `design_finalize_change` 返回的 metadata 结构。
2. **前端渲染测试**：验证 `design_approval` 渲染器对两个工具分别显示「初稿审批」和「终稿审批」。
3. **集成测试**：完整走一次 change 模式流程，确认时间线显示统一。

## 决策总结

| 决策 | 选择 |
|---|---|
| 是否新建初稿审批工具 | 是，新增 `design_request_approval` |
| 终稿工具是否保留 | 是，`design_finalize_change` 补充 metadata |
| 是否复用通用 question 工具渲染 | 否，新建统一的 `design_approval` 渲染器 |
| 标题 | 初稿审批 / 终稿审批 |
| 信息来源 | 工具返回 metadata 中的 `questions` 和 `answers` |
| 是否影响 dock | 否 |
| 是否影响通用 question 工具 | 否 |
