# Design 子智能体链接卡片渲染规格

## 背景与问题

当前 Design Mode v2 中，ChatAgent 调用 `design_ask_graph`、`design_request_change` 等工具时，内部通过 `TaskTool.execute` 启动 `design-graph` 或 `design-search` 子智能体。但这些设计工具在父会话的时间线中渲染为默认的 `GenericTool`：

- 标题显示 "Called design_request_change"
- 副标题显示工具输入参数
- **没有子智能体会话链接**
- 用户无法直接跳转到子智能体会话查看完整执行过程和审批流程

这与通用 `task` 工具的体验不一致。`task` 工具会显示一个可点击的卡片，标题为子智能体名称，副标题为任务描述，点击后跳转到子智能体会话。

## 设计目标

- 让 Design 工具的调用结果在父会话中显示为类似 `task` 工具的子智能体会话链接卡片。
- 用户点击卡片即可跳转到 `design-graph` / `design-search` 子智能体会话，查看完整过程。
- 父会话不展开显示子智能体的详细输出，保持时间线简洁。
- 复用现有 `task` 工具的渲染模式和 `BasicTool` 组件，避免重复造轮子。

## 核心决策

| 决策 | 选择 |
|------|------|
| 是否显示展开详情 | **否**，跟 `task` 工具一致，`hideDetails=true` |
| 卡片是否可点击跳转 | **是**，点击整个卡片跳转到子智能体会话 |
| 图标 | 使用设计相关图标（如 `layers` 或 `git-branch`），区别于 `task` 的 `task` 图标 |
| 标题 | 子智能体名称：`design-graph` 或 `design-search` |
| 副标题 | 工具描述，如 "Design cognition"、"Design change request" |
| 子会话 ID 来源 | `metadata.result.metadata.sessionId` |

## 复用点

设计工具渲染器直接复用 `task` 工具渲染器的实现模式：

| 功能 | 来源 |
|------|------|
| 子会话 ID 解析 | `message-part.tsx` 中 `task` 渲染器的 `childSessionId` 逻辑 |
| 会话链接生成 | `sessionLink()` 辅助函数 |
| 跳转行为 | `data.navigateToSession` 或 `window.location.assign(href)` |
| 卡片布局 | `BasicTool` + 自定义 `trigger` JSX |
| Spinner / 运行中状态 | `props.status === "pending" \|\| "running"` |

区别仅在于：
- `icon` 不使用 `"task"`
- `title` 来自子智能体名称（而非 task 的 agent 名称推断）
- `subtitle` 来自 design 工具的 `description` 字段

## 实现方案

### 1. 服务端确保 metadata 中包含子会话 ID

当前 `design.ts` 中 design 工具返回的结果已经把 `result` 放在 `metadata` 中：

```ts
return {
  title: "Design change request",
  output: result.output,
  metadata: { result } as Record<string, unknown>,
}
```

而 `result` 本身来自 `TaskTool.execute`，其结构包含 `metadata.sessionId`。因此前端可以通过 `props.metadata.result.metadata.sessionId` 获取子会话 ID。

**不需要修改服务端**，metadata 链路已经完整。

### 2. 前端注册 design 工具渲染器

在 `packages/session-ui/src/components/message-part.tsx` 的 `ToolRegistry` 中，新增一个通用渲染器匹配所有 Design ChatAgent 工具。

由于这些工具都通过子智能体执行，可以用一个渲染器处理多个工具名：

```ts
const DESIGN_SUBAGENT_TOOLS = new Set([
  "design_ask_graph",
  "design_request_change",
  "design_summarize_design",
  "design_search_project",
  "design_search_web",
])
```

渲染器逻辑：

```tsx
ToolRegistry.register({
  name: "design-subagent",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const location = useLocation()

    const childSessionId = createMemo(() => {
      const value = props.metadata?.result?.metadata?.sessionId
      if (typeof value === "string" && value) return value
    })

    const subagentType = createMemo(() => {
      const value = props.metadata?.result?.metadata?.subagent_type ?? props.input?.subagent_type
      if (typeof value === "string" && value) return value
      return "design-graph"
    })

    const title = createMemo(() => subagentType())
    const subtitle = createMemo(() => {
      const value = props.input?.description ?? props.metadata?.result?.metadata?.description
      if (typeof value === "string" && value) return value
      return childSessionId()
    })

    const href = createMemo(() => sessionLink(childSessionId(), location.pathname, data.sessionHref))
    const clickable = createMemo(() => !!(childSessionId() && (data.navigateToSession || href())))
    const running = createMemo(() => props.status === "pending" || props.status === "running")

    const open = () => {
      const id = childSessionId()
      if (!id) return
      if (data.navigateToSession) {
        data.navigateToSession(id)
        return
      }
      const value = href()
      if (value) window.location.assign(value)
    }

    const navigate = (event: MouseEvent) => {
      if (!data.navigateToSession) return
      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      open()
    }

    const trigger = () => (
      <div data-component="task-tool-card">
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <Show when={running()}>
              <span data-component="task-tool-spinner">
                <Spinner />
              </span>
            </Show>
            <span data-component="task-tool-title">{title()}</span>
            <Show when={subtitle()}>
              <span data-slot="basic-tool-tool-subtitle">{subtitle()}</span>
            </Show>
          </div>
        </div>
        <Show when={clickable()}>
          <div data-component="task-tool-action">
            <Icon name="square-arrow-top-right" size="small" />
          </div>
        </Show>
      </div>
    )

    return (
      <BasicTool
        icon="layers" // 或 "git-branch"，需确认图标库
        status={props.status}
        trigger={trigger()}
        hideDetails
        triggerHref={href()}
        clickable={clickable()}
        onTriggerClick={navigate}
      />
    )
  },
})
```

### 3. 工具名到渲染器的映射

当前 `ToolRegistry.render(toolName)` 是精确匹配。要为一个渲染器匹配多个工具名，有两种方式：

**方案 A：注册时传入多个 name（如果 ToolRegistry 支持）**
- 需要查看 `ToolRegistry` 的实现是否支持数组 name 或通配符。

**方案 B：为每个 design 工具单独注册同一个 render 函数**
- 如果 ToolRegistry 只支持单 name，则重复注册 5 次：
  - `design_ask_graph`
  - `design_request_change`
  - `design_summarize_design`
  - `design_search_project`
  - `design_search_web`
- 每个注册调用同一个 render 函数。

**推荐方案 B**，因为更确定、不需要改 ToolRegistry 本身。

### 4. 图标选择

需要确认 `@opencode-ai/ui/icon` 中可用的图标名称。候选：
- `layers`：适合设计/分层语义
- `git-branch`：适合图/关系语义
- `compass`：适合探索/认知语义
- `task`：保持与 task 工具一致，但会混淆

推荐 `layers`，备选 `git-branch`。

### 5. i18n

当前 `task` 工具的标题直接显示 agent 名称，没有走 i18n。Design 工具也可以直接显示 `design-graph` / `design-search`，不需要新增 i18n key。

但以下可选：
- 如果希望显示中文别名，可新增 key：
  - `session.designSubagent.designGraph` = "设计图"
  - `session.designSubagent.designSearch` = "设计搜索"
- 副标题来自服务端 `description`（英文），如需汉化需在服务端根据工具类型返回中文描述。

本方案保持简单：**标题显示原始 agent 名，副标题显示英文 description**。

## 需要改动的文件

### 修改文件

- `packages/session-ui/src/components/message-part.tsx`
  - 新增 Design 子智能体工具渲染器注册（5 个工具名映射到同一渲染函数）。
  - 复用现有 `sessionLink()`、`taskAgent()` 附近的逻辑。

### 不修改的文件

- `packages/opencode/src/tool/design.ts`：metadata 链路已完整，无需改动。
- `packages/opencode/src/tool/task.ts`：无需改动。
- `packages/session-ui/src/components/basic-tool.tsx`：无需改动。

## 测试策略

1. **组件级测试**（Vitest + SolidJS testing library）：
   - 提供 mock part（tool=`design_request_change`，status=`completed`，metadata.result.metadata.sessionId=`ses_xxx`）。
   - 验证渲染出包含 `design-graph` 标题和跳转链接的卡片。
   - 验证 `hideDetails=true` 时不显示展开箭头。
   - 验证运行中状态显示 spinner。

2. **真实 GUI 测试**：
   - 在桌面端触发 `design_request_change`。
   - 确认父会话出现可点击的 "design-graph" 卡片。
   - 点击后跳转到子智能体会话，能看到 GraphAgent 的审批提问和 Change Plan。

## 边界情况

- **子会话 ID 缺失**：如果 metadata 中没有 sessionId，卡片不可点击，只显示标题和副标题。
- **运行中状态**：子智能体还在执行时，卡片显示 spinner，但仍然可以点击跳转会话查看进行中的过程。
- **错误状态**：如果子智能体执行失败，错误信息可能通过 `ToolErrorCard` 渲染（`message-part.tsx` 中已有 `status === "error"` 分支）。本渲染器主要处理非 error 状态；error 分支可复用现有逻辑，或额外确保 error 时也显示子会话链接。

## 后续扩展

- 未来可以在卡片上增加状态徽章，例如 "等待审批中"、"已应用"。
- 未来可以为 design 工具的结果增加一个轻量级展开摘要（但仍默认折叠），显示 "3 个节点受影响" 等关键信息。
- 本次先保持与 `task` 工具一致，避免过度设计。

## 决策总结

| 决策 | 选择 |
|------|------|
| 渲染方式 | 新增专用渲染器，5 个 design 工具名单独注册但共享 render 函数 |
| 卡片跳转 | 点击整个卡片跳转到子智能体会话 |
| 展开详情 | 不显示，`hideDetails=true` |
| 图标 | `layers`（待确认图标库） |
| 标题 | 子智能体名称 `design-graph` / `design-search` |
| 副标题 | 工具 `description` 字段 |
| 子会话 ID 来源 | `metadata.result.metadata.sessionId` |
| 服务端改动 | 无 |
