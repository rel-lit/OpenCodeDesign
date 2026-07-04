# OpenCode 项目理解笔记

> 本文档持续记录对 OpenCode 原项目（anomalyco/opencode 上游及其当前 fork）的架构理解。
> 所有后续实现讨论默认基于 **Windows x64 桌面端 GUI** 环境，除非显式说明。

---

## 1. 桌面端 GUI 的 Agent 输出显示逻辑

桌面端由两层组成：

- **`packages/desktop`**：Electron 主进程 / preload / 壳层，负责窗口、WSL、更新、菜单等。
- **`packages/app`**：基于 SolidJS 的桌面端 UI 应用，运行在 Electron renderer 中，是用户实际看到的对话界面。

会话时间线的核心渲染链路：

```
packages/app/src/pages/session/timeline/message-timeline.tsx
  └── 虚拟列表 + TimelineRow 分发
        ├── UserMessage        → Message (packages/session-ui)
        ├── AssistantPart      → MessagePart (packages/session-ui)
        ├── Thinking           → TimelineThinkingRow
        └── DiffSummary / Error / Retry
```

`packages/session-ui/src/components/message-part.tsx` 维护一个 `PART_MAPPING`，把消息 part 类型映射到具体渲染组件：

- `PART_MAPPING["text"]` → 普通文本
- `PART_MAPPING["reasoning"]` → `ReasoningPartDisplay`
- `PART_MAPPING["tool"]` → 工具调用卡片

消息 part 是否进入时间线由 `renderable(part, showReasoningSummaries)` 决定：

```ts
// packages/session-ui/src/components/message-part.tsx:618
export function renderable(part: PartType, showReasoningSummaries = true) {
  if (part.type === "tool") { ... }
  if (part.type === "text") return !!part.text?.trim()
  if (part.type === "reasoning") return showReasoningSummaries && !!part.text?.trim()
  return !!PART_MAPPING[part.type]
}
```

### 关键设置

`packages/app/src/context/settings.tsx` 中：

```ts
showReasoningSummaries: false, // 默认不显示 reasoning 摘要
```

用户可在 Settings → General 中开启 "Show reasoning summaries"。

---

## 2. 思考过程折叠机制

### 2.1 什么算“折叠”

在本项目中，**“折叠” = 默认隐藏完整 reasoning 内容，只显示一个 `Thinking...` 指示器 + 从 reasoning 中提取的标题**。只有当用户显式开启 `showReasoningSummaries` 时，完整 reasoning 才会作为时间线的一部分渲染。

### 2.2 折叠的代码路径

1. **流式响应生成 reasoning part**
   - `packages/opencode/src/session/llm/ai-sdk.ts` 把 AI SDK 的 `reasoning-start/reasoning-delta/reasoning-end` 事件转成 `LLMEvent.reasoningStart/Delta/End`。
   - `packages/opencode/src/session/processor.ts` 把这些事件持久化为 `type: "reasoning"` 的 part。

2. **时间线决定是否可渲染**
   - `packages/app/src/pages/session/timeline/rows.ts:127-129`：
     ```ts
     getMessageParts(message.id)
       .filter((part) => renderable(part, showReasoning))
       .map(...)
     ```
   - 当 `showReasoning === false` 时，`renderable()` 对 `type: "reasoning"` 返回 `false`，reasoning part 不会变成 `AssistantPart` row。

3. **Thinking 行替代显示**
   - `packages/app/src/pages/session/timeline/rows.ts:197-209`：
     ```ts
     if (isActive && status === "busy" && !error && (showReasoning ? assistantPartRefs.length === 0 : true)) {
       const heading = assistantMessages
         .flatMap((message) => getMessageParts(message.id))
         .map((part) => (part.type === "reasoning" && part.text ? reasoningHeading(part.text) : undefined))
         .find((value): value is string => !!value)
       rows.push(new TimelineRow.Thinking({ userMessageID: userMessage.id, reasoningHeading: heading }))
     }
     ```
   - `packages/app/src/pages/session/timeline/message-timeline.tsx:125-136`：
     ```tsx
     function TimelineThinkingRow(props: { reasoningHeading?: string; showReasoningSummaries: boolean }) {
       return (
         <div data-slot="session-turn-thinking">
           <TextShimmer text={language.t("ui.sessionTurn.status.thinking")} />
           <Show when={!props.showReasoningSummaries}>
             <TextReveal text={props.reasoningHeading} class="session-turn-thinking-heading" ... />
           </Show>
         </div>
       )
     }
     ```

4. **展开显示完整 reasoning**
   - 当 `showReasoningSummaries === true` 时，reasoning parts 通过 `renderable()` 检查，进入 `AssistantPart` rows，由 `ReasoningPartDisplay` 直接渲染 markdown。
   - `packages/session-ui/src/components/message-part.tsx:1595-1612`：
     ```tsx
     PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props) {
       ...
       return (
         <Show when={text()}>
           <div data-component="reasoning-part" data-timeline-part-id={part().id}>
             <Show when={streaming()} fallback={<Markdown text={text()} ... />}>
               <PacedMarkdown text={text()} ... />
             </Show>
           </div>
         </Show>
       )
     }
     ```

### 2.3 标题提取逻辑

`rows.ts:249` 和 `session-turn.tsx:124` 都实现了相同的 `heading()` 函数，从 reasoning text 中提取第一行有效标题：

- HTML heading `<h1>...</h1>`
- ATX markdown `# Heading`
- Setext `Heading\n===`
- Bold `**Heading**`

如果 reasoning text 没有任何可识别的标题结构，`reasoningHeading` 为 `undefined`，Thinking 行就只显示 "Thinking..." 没有副标题。

---

## 3. 为什么部分模型的思考过程被正常折叠，部分未被正常折叠

### 3.1 根本原因

**模型/Provider 是否把 thinking 内容作为独立的 `reasoning` part 返回。**

只有被识别为 `type: "reasoning"` 的 part 才会受 `showReasoningSummaries` 控制、才会被折叠成 Thinking 行。如果模型把思考内容直接混在普通 `text` part 中输出，UI 没有机制把它单独折叠。

### 3.2 导致差异的具体因素

| 因素 | 被折叠（正常） | 未被折叠（异常） |
|------|---------------|-----------------|
| **AI SDK provider 支持** | provider 能发出 `reasoning-start/delta/end` 事件 | provider 只发出 `text-delta`，thinking 和正文混在一起 |
| **模型 capabilities.reasoning** | `true`，系统会启用 reasoning/thinking 参数 | `false` 或未配置，系统不请求 reasoning 分离 |
| **Provider 请求参数** | 正确设置 `thinking`、`enable_thinking`、`reasoningEffort` 等 | 缺少必要参数，API 不返回独立 reasoning |
| **模型返回格式** | 返回 `reasoning_content` / `reasoning_details` / `thinking` 等独立字段 | 返回的 reasoning 嵌套在普通 message content 中 |
| **是否切换模型** | 同一模型继续对话，reasoning parts 保持 `type: "reasoning"` | 切换模型后 `message-v2.ts` 把旧 reasoning 降级为 `type: "text"` |

### 3.3 关键代码证据

#### A. AI SDK 事件转换

`packages/opencode/src/session/llm/ai-sdk.ts:158-188` 只处理 `reasoning-start/delta/end` 事件。如果 provider 不发送这些事件，就不会生成 reasoning part。

#### B. Provider 请求参数差异

`packages/opencode/src/provider/transform.ts` 中针对不同 provider/model 做特殊处理：

- **DeepSeek**：必须给每个 assistant message 补一个空 reasoning part（`transform.ts:269-284`），因为 API 要求回传 reasoning。
- **Kimi (Anthropic SDK)**：默认启用 thinking（`transform.ts:1144-1153`）。
- **Alibaba / DashScope**：必须加 `enable_thinking: true` 才会返回 reasoning_content（`transform.ts:1155-1167`）。
- **GPT-5 系列**：设置 `reasoningEffort`、`reasoningSummary`、`include` 等（`transform.ts:1169-1206`）。
- **模型没有 `capabilities.reasoning`**：`transform.ts:666` 直接返回空 reasoning 参数。

#### C. 模型切换时 reasoning 降级

`packages/opencode/src/session/message-v2.ts:362-376`：

```ts
if (part.type === "reasoning") {
  if (differentModel) {
    if (part.text.trim().length > 0)
      assistantMessage.parts.push({ type: "text", text: part.text })
    continue
  }
  assistantMessage.parts.push({
    type: "reasoning",
    text: part.text,
    providerMetadata: part.metadata,
  })
}
```

其中 `differentModel` 在第 245 行定义为：

```ts
const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
```

这意味着：一旦用户在同一会话中切换到不同模型，历史 reasoning 内容会变成普通文本，**不再被折叠**。

#### D. Interleaved reasoning 提取

`packages/opencode/src/provider/transform.ts:286-318`：

对于标记了 `capabilities.interleaved.field` 的模型（field 可能是 `reasoning`、`reasoning_content`、`reasoning_details`），系统会把 content 中的 reasoning parts 提取出来，通过 `providerOptions.openaiCompatible[field]` 发送给 provider。这一步保证了后续请求能正确携带 reasoning；但如果 provider 响应时不按同样格式返回，UI 仍然收不到独立的 reasoning part。

### 3.4 结论

- **“被正常折叠”的模型**：AI SDK provider 支持 reasoning 事件，且 `capabilities.reasoning === true`，请求参数正确，返回内容被正确解析为 `type: "reasoning"` part。
- **“未被正常折叠”的模型**：至少满足以下一种情况：
  1. Provider/模型没有把 thinking 内容分离成独立事件或 part；
  2. `capabilities.reasoning` 为 false 或未启用对应请求参数；
  3. 用户在会话中途切换了模型，导致历史 reasoning 被降级为普通 text；
  4. 模型返回的 reasoning 格式不被当前 AI SDK provider 识别。

---

## 4. 环境约束声明

本项目后续所有实现讨论、调试、验证和构建都默认基于：

- **平台**：Windows x64（本机）
- **客户端**：桌面端 GUI（`packages/desktop` + `packages/app`）
- **构建命令**：`bun run build --single`（Windows x64 单平台构建）
- **测试运行位置**：`packages/opencode` 目录下
- **类型检查**：`bun run typecheck`（使用 `tsgo`）

如涉及 Web、TUI、macOS/Linux、服务器端或移动端，必须显式说明并单独验证。

---

## 5. 相关文件索引

| 文件 | 作用 |
|------|------|
| `packages/app/src/pages/session/timeline/message-timeline.tsx` | 桌面端时间线主组件，分发 TimelineRow |
| `packages/app/src/pages/session/timeline/rows.ts` | TimelineRow 生成逻辑，Thinking row 构建 |
| `packages/session-ui/src/components/session-turn.tsx` | SessionTurn 组件，AssistantParts、Thinking 控制 |
| `packages/session-ui/src/components/message-part.tsx` | Part 渲染映射，`renderable()`，`ReasoningPartDisplay` |
| `packages/app/src/context/settings.tsx` | `showReasoningSummaries` 设置 |
| `packages/opencode/src/session/processor.ts` | 流式事件处理，生成 reasoning part |
| `packages/opencode/src/session/llm/ai-sdk.ts` | AI SDK fullStream → LLMEvent 转换 |
| `packages/opencode/src/provider/transform.ts` | 请求/响应转换，模型特殊参数处理 |
| `packages/opencode/src/provider/provider.ts` | Model / Provider capabilities schema |
| `packages/opencode/src/session/message-v2.ts` | 消息序列化，模型切换时 reasoning 降级 |
| `packages/app/src/pages/session/composer/session-composer-region.tsx` | Composer 区域，挂载所有 dock 面板 |
| `packages/app/src/pages/session/composer/session-question-dock.tsx` | 问题 dock 面板 |
| `packages/app/src/pages/session/composer/session-permission-dock.tsx` | 权限 dock 面板 |
| `packages/session-ui/src/components/dock-prompt.tsx` | 通用 dock 容器组件 |
| `packages/app/src/pages/session/composer/session-composer-state.ts` | 选择当前会话的 question/permission 请求 |
| `packages/app/src/pages/session/composer/session-request-tree.ts` | 在会话树中查找待处理请求 |
| `packages/opencode/src/question/index.ts` | 问题服务，发布 `question.asked` 事件 |
| `packages/opencode/src/permission/index.ts` | 权限服务，发布 `permission.asked` 事件 |
| `packages/opencode/src/tool/task.ts` | `task` 工具，启动 subagent 子会话 |
| `packages/opencode/src/agent/agent.ts` | agent 注册，包含 `mode: "subagent"` |
| `packages/opencode/src/agent/subagent-permissions.ts` | subagent 会话权限派生规则 |
| `packages/opencode/src/tool/registry.ts` | 工具注册表，按 agent permission 过滤可用工具 |
| `packages/opencode/src/background/job.ts` | 后台 job 服务，subagent 前台/后台执行基础 |
| `packages/opencode/src/question/index.ts` | 问题服务，发布 `question.asked` 事件 |
| `packages/opencode/src/permission/index.ts` | 权限服务，发布 `permission.asked` 事件 |
| `packages/opencode/src/session/session.ts` | 会话服务，`updatePart`/`updatePartDelta` 持久化并发布事件 |
| `packages/opencode/src/event-v2-bridge.ts` | OpenCode 事件发布边界，附加 location |

---

## 6. 桌面端 Composer 区域的阻塞式面板系统

桌面端 GUI 在聊天输入框上方（composer 区域）实现了一套阻塞式面板系统，用于向用户请求确认或选择。它的核心特征是：面板出现时用户不能与输入框或历史消息交互，必须做出响应或关闭面板后，当前会话才能继续。

### 6.1 通用容器：`DockPrompt`

`packages/session-ui/src/components/dock-prompt.tsx` 是一个轻量的通用容器组件，本身不绑定任何业务逻辑。它的 API 非常简单：

```tsx
<DockPrompt
  kind="question" | "permission"
  header={...}      // 顶部标题/进度区域
  footer={...}      // 底部操作按钮区域
  children={...}    // 中间主要内容区域
/>
```

`kind` 只影响 `data-slot` 的命名前缀，例如 `question-header`、`permission-footer-actions`，用于样式和测试定位。容器本身只负责把内容放进统一的 dock 外壳（`DockShell` + `DockTray`）并渲染在 composer 上方。

### 6.2 两类已实现的业务面板

OpenCode 当前已经有两类基于 `DockPrompt` 的实现：

#### A. `SessionPermissionDock`（权限面板）

文件：`packages/app/src/pages/session/composer/session-permission-dock.tsx`

- **触发条件**：后端 `Permission.Service` 发布 `permission.asked` 事件，且当前会话树中存在匹配该会话的待处理权限请求。
- **显示位置**：由 `SessionComposerState.permissionRequest()` 从 `sync().data.permission` 中选出，`SessionComposerRegion` 在 composer 上方渲染。
- **内容结构**：
  - 标题：固定显示 "Permission required"。
  - 图标：警告图标。
  - 主体：工具描述（从 i18n 取 `settings.permissions.tool.<permission>.description`）+ 匹配的模式列表（`patterns`）。
  - 操作：`Deny`（拒绝）、`Allow Always`（始终允许）、`Allow Once`（仅本次允许）。
- **后端语义**：`Permission.Service.ask()` 会创建一个 `Deferred`，会话执行 Fiber 阻塞等待；用户点击后调用 `Permission.Service.reply()`，根据选择 `once`/`always`/`reject` 解除阻塞或失败。

#### B. `SessionQuestionDock`（问题面板）

文件：`packages/app/src/pages/session/composer/session-question-dock.tsx`

- **触发条件**：后端 `Question.Service` 发布 `question.asked` 事件。
- **显示位置**：由 `SessionComposerState.questionRequest()` 从 `sync().data.question` 中选出。
- **内容结构**：
  - 标题：`header`（30 字以内）+ 多问题进度点。
  - 主体：`question` 完整问题文本 + 提示文字 + `options` 选项列表。
  - 选项支持单选/多选（`multiple`），每个选项包含 `label`（1-5 词）和 `description`（解释）。
  - 支持自定义回答（`custom = true`），用户可以输入自己的文字。
  - 操作：`Dismiss`（关闭/拒绝）、`Back`（上一题）、`Next`/`Submit`（下一题/提交）。
- **实现细节值得注意**：
  - 问题文本按**纯文本**渲染（`{question()?.question}`），不支持 Markdown。
  - 自定义输入是作为一个**选项**嵌入在 `options` 列表里的（radio/checkbox 的最后一项），不是独立输入区。
  - 支持多问题分步（`questions[]` 数组），有 tab 进度条和缓存未提交答案的逻辑。
  - 内容区最大高度通过 `measure()` 动态计算，避免遮挡历史消息。
  - textarea 自动增高通过 `resizeInput()` 实现。
- **后端语义**：`Question.Service.ask()` 同样创建 `Deferred` 等待；用户提交后 `Question.Service.reply()` 返回 `answers` 数组，每个答案是选中 `label` 的字符串数组。

### 6.3 面板选择逻辑

`packages/app/src/pages/session/composer/session-request-tree.ts` 提供了一个 `sessionTreeRequest` 辅助函数：它从当前会话 ID 向上遍历父会话链，再在整条链上查找对应类型的待处理请求。这意味着子会话中的权限/问题请求也能在父会话的 composer 中显示出来（只要未被过滤）。

`SessionComposerState` 中的关键代码：

```ts
const questionRequest = createMemo(() => sessionQuestionRequest(sync().data.session, sync().data.question, params.id))
const permissionRequest = createMemo(() => sessionPermissionRequest(..., (item) => !permission.autoResponds(item, sdk().directory)))
const blocked = createMemo(() => !!permissionRequest() || !!questionRequest())
```

当 `blocked` 为 `true` 时，todo dock 等状态也会被标记为活跃，避免 composer 收起。

### 6.4 与设计模式相关的结论

- `DockPrompt` 是复用的最佳起点：它已经把 dock 外壳、动画、定位、键盘事件等通用逻辑封装好了，新增一种面板只需要提供 `kind`、`header`、`children`、`footer`。
- `DockPrompt` 的 `kind` 只影响 `data-slot` 命名前缀，因此可以接受任意字符串（如 `"design-approval"`），无需修改组件本身。
- 后端已有成熟的阻塞式请求机制：`Question.Service` 和 `Permission.Service` 都使用 `Deferred` + EventV2 事件发布，天然支持“请求-响应”模式。
- 如果设计模式需要用户确认图变更，**不需要从零写事件协议和面板组件**，可以直接复用其中一种：
  - 若确认内容是“是否允许某操作”，复用 `Permission.Service` + `SessionPermissionDock`。
  - 若确认内容是“从多个选项中选择/自定义回答”，复用 `Question.Service` + `SessionQuestionDock`。
  - 若内容更复杂（例如显示 Markdown 格式的 Change Plan、支持编辑后再批准），则新增一个 `DockPrompt` 派生组件，但后端仍可复用 `Question.Service` 的 Deferred 阻塞语义。此时应优先复用 `SessionQuestionDock` 的已有实现片段（`measure()`、`resizeInput()`、`useMutation` 模式），但重新编排 UI，而不是改造通用问题面板。

---

## 7. Session Part 的生成与持久化机制

### 7.1 什么是 Session Part

在 OpenCode 中，一条消息（`Message`）由多个 `Part` 组成。Part 是时间线渲染的最小单位，常见类型有：

- `text`：普通文本。
- `reasoning`：模型思考过程，可被折叠。
- `tool`：工具调用及其结果。
- `step-start`：步骤开始标记。
- `file`、`source-url`、`tool-invocation` 等。

Part 的渲染映射在 `packages/session-ui/src/components/message-part.tsx` 的 `PART_MAPPING` 中。新类型要进入时间线，必须被加入该映射或在 `renderable()` 中返回 true。

### 7.2 Part 是如何产生的

Part 由 `packages/opencode/src/session/processor.ts` 在流式处理 LLM 事件时生成：

- `reasoning-start/delta/end` → 创建/更新 `type: "reasoning"` 的 part。
- `tool-input-start/delta/end`、 `tool-call`、 `tool-result`、 `tool-error` → 创建/更新 `type: "tool"` 的 part。
- `step-start` → 创建 `type: "step-start"` 的 part。
- `text-delta` → 创建/追加 `type: "text"` 的 part。

这些事件来自 `packages/opencode/src/session/llm/ai-sdk.ts` 对 AI SDK `fullStream` 的转换，或来自 `packages/llm` 包的 native runtime。

### 7.3 Part 如何持久化和同步到 GUI

`Session.Service` 提供两个核心方法：

- `updatePart(part)`: 发布 `message.part.updated` 事件，并把完整 part 写入 SQLite。
- `updatePartDelta(input)`: 发布 `message.part.delta` 事件，只传输字段增量。

两者都通过 `EventV2Bridge.Service.publish()` 发布事件。`EventV2Bridge` 在 `packages/opencode/src/event-v2-bridge.ts` 中实现，它会：

1. 把事件发布到全局 `EventV2` pub/sub 系统。
2. 同时通过 `GlobalBus.emit("event", ...)` 把事件推送给当前 Electron 窗口的同步层。

桌面端 `packages/app/src/context/sync.tsx` 监听这些事件并更新本地状态，驱动时间线重新渲染。

### 7.4 非 LLM 流程如何写入 Part

任何持有 `Session.Service` 和 `MessageID` 的代码都可以调用 `updatePart` 写入 part，不一定需要 LLM 流。例如：

```ts
yield* session.updatePart({
  id: PartID.ascending(),
  messageID: assistantMessage.id,
  sessionID,
  type: "text",
  text: "GraphAgent 已完成分析...",
})
```

这意味着即使 GraphAgent 不是 subagent，也可以在执行过程中手动写入 `reasoning`、`tool` 或自定义 part，让它们出现在时间线中。代价是需要自己管理 part ID、message ID、事件顺序和错误恢复。

---

## 8. Subagent 机制

### 8.1 什么是 Subagent

在 OpenCode 中，subagent 是一种特殊的 agent，注册时 `mode: "subagent"`。它不能被用户直接选为默认主 agent，只能由其他 agent 通过 `task` 工具调用，或在 CLI/TUI 中通过 `@agent-name` 命令触发。

注册位置：`packages/opencode/src/agent/agent.ts` 中通过硬编码 `Agent.Info` 对象或配置生成。subagent 和普通 agent 的核心区别：

| 属性 | primary agent | subagent |
|------|--------------|----------|
| `mode` | `"primary"` / `"all"` | `"subagent"` / `"all"` |
| 用户可选 | 是 | 否（`mode !== "subagent"` 才可见） |
| 启动方式 | 用户选择或默认 | 只能由 `task` 工具或 subtask part 启动 |
| 权限规则 | 继承用户配置 | 由 `deriveSubagentSessionPermission` 派生 |
| 输出可见性 | 直接渲染在当前会话 | 写入独立子会话，结果回注父会话 |

### 8.2 注册方式

以 `design-graph` 和 `design-search` 为例：

```ts
// packages/opencode/src/agent/agent.ts:179-209
const graphAgentInfo: Info = {
  name: "design-graph",
  description: "Analyzes design graphs, generates change proposals, and executes approved writes.",
  mode: "subagent",
  native: true,
  permission: Permission.merge(defaults, designToolPermissions, user),
  prompt: PROMPT_GRAPH,
  options: {},
}

const searchAgentInfo: Info = {
  name: "design-search",
  description: "Searches the codebase against a design graph summary and returns a summary report and diff analysis.",
  mode: "subagent",
  native: true,
  permission: Permission.merge(defaults, readonlyPermissions, user),
  prompt: PROMPT_SEARCH,
  options: {},
}
```

`permission` 字段决定 subagent 被允许/拒绝使用哪些工具。`prompt` 字段作为该 agent 的系统 prompt。`model` 字段可选，未指定时继承调用它的父 agent 的模型。

### 8.3 `task` 工具如何启动 Subagent

`packages/opencode/src/tool/task.ts` 实现 `task` 工具，参数结构：

```ts
{
  description: string           // 3-5 词任务描述，会作为子会话标题
  prompt: string                // 给 subagent 的具体指令
  subagent_type: string         // agent 名称，如 "design-graph"
  task_id?: string              // 可选，恢复已有子会话
  command?: string              // 触发来源命令
  background?: boolean          // 是否后台运行（实验性）
}
```

执行流程：

1. **权限自检**：调用 `ctx.ask({ permission: "task", patterns: [subagent_type], always: ["*"] })`，询问用户是否允许调用该 subagent（除非 `bypassAgentCheck`）。
2. **获取 agent 配置**：`agent.get(params.subagent_type)`。
3. **派生子会话权限**：`deriveSubagentSessionPermission({ parentSessionPermission, subagent })`。
4. **创建子会话**：`Session.create({ parentID: ctx.sessionID, agent: next.name, permission: childPermission })`。
5. **解析 prompt**：`ops.resolvePromptParts(params.prompt)` 把 prompt 字符串转成 parts。
6. **运行子会话**：`ops.prompt({ sessionID: nextSession.id, agent: next.name, parts })`。
7. **提取结果**：取子会话最后一条 `type: "text"` part 的 text。
8. **回注父会话**：把结果包成 XML 格式（`<task id="..." state="completed"><task_result>...</task_result></task>`）返回给父 agent。

### 8.4 Subagent 权限派生规则

`packages/opencode/src/agent/subagent-permissions.ts`：

```ts
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  return [
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny",
    ),
    ...(canTodo ? [] : [{ permission: "todowrite", pattern: "*", action: "deny" }]),
    ...(canTask ? [] : [{ permission: "task", pattern: "*", action: "deny" }]),
  ]
}
```

派生规则说明：

- 父会话的 `deny` 规则和 `external_directory` 规则会传递给子会话。
  - 注意：这意味着如果父会话显式 deny 了某个工具（包括 `question`），子会话也会被 deny。但实际配置中，ChatAgent 通常不会显式 deny `question`，因此 GraphAgent 只要自身 permission 允许 `question` 就可以调用。
- 如果 subagent 自身 permission 没有显式允许 `todowrite`，则默认拒绝所有 `todowrite`。
- 如果 subagent 自身 permission 没有显式允许 `task`，则默认拒绝所有 `task`（防止子 agent 无限递归创建子 agent）。

此外 `task.ts` 还会追加：

- `experimental.primary_tools` 中配置的默认拒绝工具。
- 如果 subagent 未声明 `task` 权限，额外拒绝 `task`。
- 如果 subagent 未声明 `todowrite` 权限，额外拒绝 `todowrite`。

这意味着 subagent 的工具集由**自身 permission + 父会话的 deny 规则 + task 工具默认防御规则**共同决定。父 Agent 自身没有权限调用的工具，不会自动让子 Agent 获得；但父 Agent 显式 deny 的工具会限制子 Agent。

### 8.5 Subagent 如何暴露给 LLM

`packages/opencode/src/tool/registry.ts:311-324` 的 `describeTask` 会把所有 mode 不是 `"primary"` 的 agent 列出，并过滤掉当前 agent permission 中 `task:<agent>` 为 `deny` 的项：

```ts
const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
const filtered = items.filter(
  (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
)
```

最终附加在 `task` 工具的描述里，成为 LLM 可调用的 subagent 列表。LLM 不需要知道 subagent 内部实现，只需要调用 `task` 工具并传入 `subagent_type`。

### 8.6 两种启动路径：命令式 vs 工具式

#### A. 命令式启动（CLI/TUI 中 `@design-graph`）

`packages/opencode/src/session/prompt.ts:1438-1449`：

```ts
const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
const parts = isSubtask
  ? [{
      type: "subtask",
      agent: agent.name,
      description: cmd.description ?? "",
      command: input.command,
      model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
      prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
    }]
  : [...uniqueTemplateParts, ...(input.parts ?? [])]
```

当用户输入 `@design-graph 分析这个图` 时，系统会生成一个 `type: "subtask"` 的 user part。主循环 `loop()` 发现 `task.type === "subtask"` 时，调用 `handleSubtask()`，内部和 `task` 工具一样走 `TaskTool.execute()`。

#### B. 工具式启动（LLM 调用 `task`）

主 agent 在 tool call 中调用 `task`，`task.ts` 创建子会话并运行。父 agent 的当前 assistant message 里会留下一个 `type: "tool"` part，状态为 completed，output 是 XML 包装的结果。

### 8.7 前台 vs 后台执行

`task.ts` 支持两种模式：

- **前台（默认）**：`runInBackground === false`。父 agent 的 fiber 阻塞等待子会话完成，子会话通过 `background.start()` + `background.wait()` 运行，但 `Effect.acquireUseRelease` 保证父会话在子会话结束后才继续。
- **后台**：`runInBackground === true`（需要 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`）。子会话作为后台 job 运行，`task` 工具立即返回 "running" 状态，后台完成后通过 `inject()` 向父会话追加一条 synthetic user message 触发后续处理。

对 Design 模式而言，默认应使用**前台模式**，因为 GraphAgent 的分析结果必须立即返回给 ChatAgent 才能继续审批流程。

### 8.8 结果如何返回父会话

前台模式下：

1. `runTask()` 取子会话最后一条 `text` part 作为 `text`。
2. `renderOutput()` 包装成 XML：
   ```xml
   <task id="<sessionID>" state="completed">
     <task_result>子 agent 最终文本输出</task_result>
   </task>
   ```
3. 作为 `task` 工具的 `output` 返回给父 agent。
4. 父 agent 的下一步 prompt 中，该 XML 作为 tool result 出现在 assistant message 的 tool part 里。

因此，subagent 的结果完全依赖**最终 text part 的内容**。如果 subagent 需要返回结构化数据，应该让 subagent 的 system prompt 强制它输出 JSON/XML，再由父 agent 解析。

### 8.9 `subtask` Part 在历史中的表示

`packages/opencode/src/session/message-v2.ts:234-239`：

```ts
if (part.type === "subtask") {
  userMessage.parts.push({
    type: "text",
    text: "The following tool was executed by the user",
  })
}
```

在把会话历史转成模型消息时，`subtask` part 被降级成普通 text part，内容固定为 "The following tool was executed by the user"。这是为了让不支持自定义 part 类型的模型能继续理解上下文，但会丢失 subtask 的元数据（agent、description、prompt）。

### 8.10 Subagent 的可见性

由于 subagent 运行在独立会话中，它的所有输出自动持久化并同步到 GUI：

- 桌面端会话列表会出现一个子会话标签，标题形如 `"description (@design-graph subagent)"`。
- 子会话内部包含完整的 reasoning、tool call、text 时间线。
- 父会话中只看到一个 `task` tool part 的结果摘要。

这是 OpenCode 当前唯一“官方”的让非主 agent 工作过程可见的机制。

### 8.11 对 Design 模式的启示

| 能力 | 内部 Effect Service（当前 GraphAgent） | 原生 Subagent（方向 A） |
|------|--------------------------------------|------------------------|
| 过程可见性 | 必须手动 `Session.Service.updatePart` | 自动持久化到子会话 |
| 权限隔离 | 无，继承父 agent 全部能力 | 由 `permission` 字段精确控制 |
| 用户审批 | 需自定义面板/逻辑 | 可复用 `question.ask` / `Permission.Service` |
| 并发/后台 | 需要自行管理 fiber | `task` 工具原生支持前台/后台 |
| 结果结构化 | 任意 Effect 返回值 | 依赖最终 text part，需 prompt 约束 |
| 生命周期 | 同步函数调用 | 独立 session + background job |

**关键结论**：

- 如果希望 GraphAgent 的分析/工具调用过程对用户可见，**应把它改为原生 subagent**，通过 `task` 工具调用。
- subagent 可以拥有 `question.ask` 权限。`sessionTreeRequest` 会把子会话中的 question/permission 请求向下遍历并显示到父会话 composer，用户在父会话中作答后，子会话的 `Deferred` 被 resolve。因此审批状态并不会分散，体验和父 agent 直接提问一致。
- 对 Design 模式而言，这意味着 GraphAgent 可以在子会话中直接生成 Change Plan、调用 `question.ask` 请求用户审批、并在用户选择 Apply 后继续在子会话内部执行写入，减少跨 Agent 传递 plan 时的理解偏差。
- 父 agent 仍然是编排层：决定何时调用 subagent，并处理 Reject / Revise 后的后续对话。但审批面板本身由 subagent 驱动即可，无需父 agent 中转。

