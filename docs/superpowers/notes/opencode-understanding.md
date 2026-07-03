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
