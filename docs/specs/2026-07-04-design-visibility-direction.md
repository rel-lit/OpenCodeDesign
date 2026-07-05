# Design Mode: GraphAgent Visibility & Approval Panel Direction

> 状态：方向讨论稿（direction spec）
> 日期：2026-07-04
> 依赖：
> - `docs/superpowers/notes/opencode-understanding.md` 对 OpenCode 面板、subagent、session part 的分析
> - `docs/superpowers/specs/2026-07-01-design-multi-agent-architecture.md` 中的多 agent 架构设计
> - `docs/superpowers/specs/2026-07-03-design-tool-split-design.md` 中的工具拆分设计

---

## 1. 当前问题

### 1.1 GraphAgent 的“不可见性”

当前 GraphAgent 是 `packages/opencode/src/design/agent/graph.ts` 中定义的一个 Effect Context Service，接口为：

```ts
interface Interface {
  analyze(input: GraphAgent.Input): Effect.Effect<GraphAgent.Output, ...>
  execute(proposal: GraphAgent.Output): Effect.Effect<GraphAgent.Output, ...>
}
```

它被调用的完整链路是：

```
ChatAgent 调用 design_propose_change(delta)
  → Design.proposeChanges(delta, panel?)
    → GraphAgent.analyze(input)        // 内部 LLM 调用，无 session 事件
    → 若提供 ApprovalPanel，则等待用户确认
    → GraphAgent.execute(proposal)     // 内部调用 applyRawDelta，无 session 事件
    → 返回 GraphAgent.Output 作为 tool result
```

因为整个过程不经过 `session/processor.ts`，也不创建子会话，所以：

- 没有 `reasoning` part，用户看不到 GraphAgent 的分析思路。
- 没有 `tool` part，用户看不到 GraphAgent 调用了哪些 design 工具。
- 没有子会话标签页，无法单独查看 GraphAgent 的完整工作流。

用户只能在 ChatAgent 的最终回复里看到 `design_propose_change` 返回的一段摘要。

### 1.2 审批面板目前只是概念

当前代码里虽然有一个 `packages/opencode/src/design/approval-panel.ts`，但它只是一个内存中的状态机：

```ts
interface Interface {
  propose(proposal: GraphAgent.Output): void
  awaitConfirmation(): Effect.Effect<GraphAgent.Output>
}
```

它没有被接入任何 GUI。`Design.proposeChanges` 中的逻辑是：

```ts
const approvalPanel = panel ?? makeApprovalPanel?.()
if (approvalPanel) {
  approvalPanel.propose(proposal)
  const approved = yield* approvalPanel.awaitConfirmation()
  return yield* graphAgent.execute(approved)
}
return yield* graphAgent.execute(proposal)
```

也就是说，如果没有外部注入 `panel`，所有变更自动执行；如果有，则阻塞等待确认。这个“panel”目前只在测试中作为 mock 使用。

---

## 2. 目标

1. **GraphAgent 的输出必须对桌面端 GUI 可见**：至少让用户看到 GraphAgent 正在分析、它提出了什么变更、最终是否应用成功。
2. **所有 chat-initiated 的图写入必须显式用户确认**：这是 multi-agent 架构的核心约束，不能绕过。
3. **尽量复用 OpenCode 已有机制**：不重复造事件协议、面板容器和阻塞语义。

---

## 3. 三个候选方向

### 方向 A：原生 Subagent 路径

#### 3.1 概念

把 GraphAgent 改造成一个真正的 OpenCode subagent。

在 OpenCode 中，subagent 是 `mode: "subagent"` 的 agent，只能通过 `task` 工具启动。启动后它会获得一个独立的子会话，子会话中的 LLM 调用、工具调用、reasoning 都会自动持久化并同步到 GUI（子会话标签页可见）。完成后结果会被注入父会话。

#### 3.2 架构变更

1. 在 `packages/opencode/src/agent/agent.ts`（或配置）中新增一个 `graph` agent：
   - `mode: "subagent"`
   - 系统 prompt 使用当前 `GraphAgent` 的 prompt
   - 工具集 = `GraphAgentDesignTools`（即内部 CRUD 工具）

2. 删除或退化内部 `GraphAgent.Service`：
   - `analyze` 和 `execute` 不再作为 Effect Service 被 `Design.proposeChanges` 调用。
   - 现有 `applyRawDelta` 保留在 `Design.Service` 中。

3. `design_propose_change` 工具不再调用 `Design.proposeChanges` 的内部 GraphAgent，而是调用 `task` 工具：
   - `subagent_type: "graph"`
   - prompt 中包含当前图状态摘要、用户原始输入、临时工作集等。

4. GraphAgent（subagent）在子会话中：
   - 分析用户需求。
   - 如果需要变更，调用内部 `design_propose_change` 或直接向用户提问请求确认。
   - 用户确认后，执行实际 CRUD 工具（`design_create_node` 等）。

5. 审批面板复用 `Question.Service`：
   - GraphAgent subagent 调用 `question.ask`，问题选项为 `["Approve", "Reject", "Edit..."]`。
   - 桌面端用现有的 `SessionQuestionDock` 渲染，或者新增一个基于 `DockPrompt` 的 `SessionDesignApprovalDock`。

#### 3.3 优点

- 自动获得 reasoning、tool、step-start 等 session part 的可见性。
- 子会话标签页天然支持查看 GraphAgent 完整工作流。
- 不需要手写 LLM 事件转换和 part 持久化。
- 复用 OpenCode 的 subagent 权限模型。

#### 3.4 缺点

- 子 agent 的工具调用决策完全由 LLM 驱动，对审批时机的控制变弱。
- 需要把当前“先分析再执行”的两段式流程拆成子 agent 内部的自主 loop。
- 子 agent 无法直接访问父 agent 的内部 Design 服务状态，必须通过 prompt 传递上下文。
- 结果回注到父会话是异步的，父 agent 需要等待 `task` 工具完成。
- 可能触发 background subagent 的限制（`OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`）。

#### 3.5 适用条件

适合希望**快速获得可见性**、愿意接受 subagent 自主决策模型的场景。

---

### 方向 B：内部服务 + 手动 Part 路径

#### 3.1 概念

保持 GraphAgent 作为内部 Effect Service，但在 `Design.proposeChanges` 执行过程中手动写入 session part，让 GraphAgent 的分析和执行过程出现在父会话时间线中。

#### 3.2 架构变更

1. `Design.proposeChanges` 接收当前 assistant message 的 `messageID` 和 `sessionID`（通过 tool context 传入）。

2. 在以下关键节点调用 `Session.Service.updatePart` 写入 part：
   - 开始分析时写入 `type: "step-start"` 或自定义 `type: "design-step"` part。
   - GraphAgent LLM 返回 reasoning 时写入 `type: "reasoning"` part（如果模型支持）或 `type: "text"` part。
   - GraphAgent 调用内部工具时写入 `type: "tool"` part（手动构造 tool part）。
   - 分析完成时写入 `type: "text"` part，展示变更摘要。

3. 审批面板复用 `Question.Service`：
   - `Design.proposeChanges` 在得到 change-proposal 后调用 `Question.Service.ask({ ... })`。
   - 问题 payload 中包含变更 diff 的文本描述、影响节点/边列表。
   - 桌面端新增 `SessionDesignApprovalDock`，基于 `DockPrompt` 渲染，选项为 `Approve` / `Reject` / `Edit`。

4. 用户确认后，`Design.proposeChanges` 继续执行 `GraphAgent.execute` 或 `applyRawDelta`，并再次写入 part 表示已应用。

#### 3.3 优点

- 对 GraphAgent 流程保持完全控制：分析、确认、执行的顺序由代码显式编排。
- 不需要把 Design 服务状态塞进 prompt 传给 subagent。
- 审批面板可以做得非常复杂（显示图 diff、支持编辑）。

#### 3.4 缺点

- 需要手写大量 part 管理代码：part ID、message ID、事件顺序、增量更新、错误回滚。
- 需要新增自定义 part 类型并在 `message-part.tsx` 中注册渲染组件。
- reasoning 的显示依赖模型是否返回独立 reasoning；如果模型不支持，只能以 text 形式展示，无法折叠。
- 工具调用过程需要手动模拟 `tool-input-start/delta/end` 和 `tool-call/tool-result`，容易与真实 tool 流不一致。

#### 3.5 适用条件

适合希望对 GraphAgent 流程做**精确控制**、愿意为可见性投入自定义 part 开发成本的场景。

---

### 方向 C：混合路径（推荐）

#### 3.1 概念

结合 A 和 B 的优点：

- **审批面板复用 `Question.Service` + `DockPrompt` 派生组件**（来自方向 A/B 的通用部分）。
- **GraphAgent 保持为内部 Effect Service**，以便 `Design.proposeChanges` 精确控制分析→确认→执行的流程（来自方向 B）。
- **GraphAgent 的 LLM 调用通过 Effect 直接完成，但把关键状态写入 session part**，使用 `Session.Service.updatePart` 手动产生可见内容（来自方向 B）。
- **不创建独立子会话**，避免 subagent 生命周期和异步回注问题（区别于方向 A）。

#### 3.2 架构变更

1. 保留 `GraphAgent.Service` 和 `Design.proposeChanges` 的现有控制流。

2. 扩展 `Design.proposeChanges` 的输入，使其能拿到当前 tool call 的 `messageID` 和 `sessionID`：
   - tool context 已经提供 `ctx.messageID` 和 `ctx.sessionID`。

3. 在 `GraphAgent.analyze` 内部：
   - 调用 LLM 后，把 `summary` 和 `structured`（warnings/suggestions）写入一个 `type: "text"` 的 session part。
   - 如果希望显示 reasoning，可以把 LLM 的 reasoning 内容也写入 `type: "reasoning"` part（如果 generateObject 接口能返回 reasoning）。

4. 在 `Design.proposeChanges` 中得到 `change-proposal` 后：
   - 写入一个 `type: "text"` part，提示“已生成变更提案，等待用户确认”。
   - 调用 `Question.Service.ask(...)` 发起审批请求。

5. 桌面端新增 `SessionDesignApprovalDock`：
   - 基于 `DockPrompt`，`kind="question"`。
   - header 显示“Design change proposal”。
   - content 显示 diff 摘要（从 question payload 中解析）。
   - footer 显示 `Approve` / `Reject` / `Edit` 按钮。
   - 当用户选择 `Edit` 时，可以展开一个文本输入框让用户描述修改意见，然后以自定义 answer 回传给后端。

6. 后端 `Question.Service.reply()` 收到答案后：
   - `Approve` → 执行 `applyRawDelta`，写入“已应用”part。
   - `Reject` → 写入“已拒绝”part，向 ChatAgent 返回 rejection。
   - `Edit` → 把用户反馈作为新的输入重新调用 `GraphAgent.analyze`，生成新提案。

#### 3.3 优点

- 保留了对分析→确认→执行流程的精确控制。
- 审批面板可以充分利用 `DockPrompt` 的通用结构，后端复用 `Question.Service` 的 Deferred 阻塞语义。
- GraphAgent 的关键输出（摘要、 warnings、最终应用结果）进入时间线，解决核心不可见问题。
- 不需要引入 subagent 生命周期和权限规则。

#### 3.4 缺点

- 仍然需要手动写入 session part，但只需要写少量关键节点，不需要模拟完整 tool 流。
- 需要新增 `SessionDesignApprovalDock` 组件和对应 schema。
- 如果将来希望 GraphAgent 的工具调用过程也可见，仍然需要扩展 part 写入逻辑。

#### 3.5 为什么推荐

- 它最符合当前已有的多 agent 架构：ChatAgent 是主 agent，GraphAgent 是内部分析服务，SearchAgent 也是内部服务。
- 它最小化了对 OpenCode 核心机制（subagent、session processor）的侵入。
- 它把“审批”这一 GUI 阻塞式交互复用得最干净：后端用 `Question.Service`，前端用 `DockPrompt`。
- 它保留了“用户必须显式批准所有 chat-initiated 图写入”的精确控制点。

---

## 4. 需要进一步决策的问题

1. **GraphAgent 的工具调用过程是否需要可见？**
   - 如果只需要“GraphAgent 分析了什么 + 最终提案 + 应用结果”可见，方向 C 足够。
   - 如果需要“GraphAgent 具体调用了 design_create_node 等每一个工具”的完整 trace，方向 A 更自然，或方向 B 需要大量手动模拟。

2. **审批面板是否支持编辑？**
   - 支持编辑意味着 answer 类型需要自定义文本，并在拒绝/编辑后让 ChatAgent 看到反馈。
   - 这会决定 `QuestionV1.Info.custom` 是否为 true，以及 `SessionDesignApprovalDock` 是否需要文本输入区。

3. **审批粒度是多粗？**
   - 当前 `design_propose_change` 已经是一个完整的 batch delta。审批可以按整个 batch 进行（一个 question）。
   - 也可以拆成多个 question（按节点/边分组），但会增加交互复杂度。

4. **是否需要在子会话标签页中单独打开 GraphAgent？**
   - 方向 A 自动支持。
   - 方向 C 不支持独立标签页，GraphAgent 输出混合在父会话时间线中。

---

## 5. 推荐的下一步

基于方向 C，建议进入实现计划阶段前完成以下设计细化：

1. 定义 `design_approval` question 的 schema（payload 字段、选项、custom answer 格式）。
2. 设计 `SessionDesignApprovalDock` 的 UI 结构（header/content/footer 内容，diff 展示方式）。
3. 明确 `Design.proposeChanges` 中需要写入 session part 的关键节点和 part 类型。
4. 明确 `GraphAgent.analyze` 的 LLM 输出如何映射到 `reasoning`/`text` part。
5. 定义 `Edit` 分支的完整交互：用户输入 → 重新分析 → 新提案 → 再次审批。
