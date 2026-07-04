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
- 后端已有成熟的阻塞式请求机制：`Question.Service` 和 `Permission.Service` 都使用 `Deferred` + EventV2 事件发布，天然支持“请求-响应”模式。
- 如果设计模式需要用户确认图变更，**不需要从零写事件协议和面板组件**，可以直接复用其中一种：
  - 若确认内容是“是否允许某操作”，复用 `Permission.Service` + `SessionPermissionDock`。
  - 若确认内容是“从多个选项中选择/自定义回答”，复用 `Question.Service` + `SessionQuestionDock`。
  - 若内容更复杂（例如显示 diff、支持编辑后再批准），则新增一个 `DockPrompt` 派生组件，但后端仍可复用 `Question.Service` 的 Deferred 阻塞语义。

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

在 OpenCode 中，subagent 是一种特殊的 agent，注册时 `mode: "subagent"`。它不能被用户直接选为默认主 agent，只能由其他 agent 通过 `task` 工具调用。

注册位置：`packages/opencode/src/agent/agent.ts` 中通过 `Agent.register(...)` 或配置生成。subagent 和普通 agent 的区别主要在于：

- `mode: "subagent"`。
- 默认不出现在用户可选 agent 列表中。
- 可以有自己的系统 prompt、模型覆盖、工具集、权限规则。

### 8.2 `task` 工具如何启动 Subagent

`packages/opencode/src/tool/task.ts` 实现 `task` 工具：

1. 解析 `subagent_type`，从 `Agent.Service` 获取对应 agent 配置。
2. 创建一个新的子会话（`Session.create({ parentID: ctx.sessionID, agent: next.name, ... })`）。
3. 把 prompt 解析为 parts，调用 `ops.prompt({ sessionID: nextSession.id, agent: next.name, parts })`。
4. 子会话开始运行，子 agent 的 LLM 调用、工具调用、reasoning 都会写入子会话的消息 part。
5. 完成后把结果注入父会话。

关键代码结构：

```ts
const nextSession = yield* sessions.create({
  parentID: ctx.sessionID,
  title: params.description + ` (@${next.name} subagent)`,
  agent: next.name,
  permission: [...],
})
// ...
const result = yield* ops.prompt({ sessionID: nextSession.id, agent: next.name, parts })
```

### 8.3 Subagent 的可见性

由于 subagent 运行在独立会话中，它的所有输出（reasoning、tool、text）都会自动持久化并同步到 GUI。桌面端可以在子会话标签页中看到完整过程。父会话中则通过最终的 synthetic message 看到结果摘要。

这是 OpenCode 当前唯一“官方”的让非主 agent 工作过程可见的机制。

### 8.4 与设计模式相关的结论

- 如果希望 GraphAgent 的分析过程、工具调用过程对用户可见，**最直接的方式是把它注册为 subagent**，用 `task` 工具调用。
- 作为内部 Effect Service 的 GraphAgent 不会自动产生 session part；必须手动调用 `Session.Service.updatePart`。
- subagent 路径会引入额外的会话生命周期、权限规则和结果回注逻辑，但省去了手写事件流和 part 持久化。

