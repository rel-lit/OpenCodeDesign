# Design 子代理统一变更模式（"change" mode）

> 日期：2026-07-06
> 状态：规范 / 待实现

## 背景与问题

当前 `design-graph` 子代理的 `Input.mode` 同时暴露 `judge` 和 `refine` 两种模式，但实际运行时：

1. `design_request_change` 只发起一次 `task.execute`，mode 固定为 `"judge"`。
2. `refine` 模式从未被外部单独调用。
3. `Input.changePlan` 和 `Input.force` 虽然存在于类型中，但只在 prompt 文本中作为内部状态引用，从未被外部传入。
4. 同一个 LLM 调用内完成 judge → refine → finalize，本身就是"一个 mode 不同流程"。

这导致类型、prompt 和实际实现之间存在不一致：`judge` / `refine` 被表述为可切换的模式，但它们只是统一变更流程中的两个阶段。

## 设计目标

- 把 `judge` / `refine` 收敛为单一的 `"change"` 模式。
- 移除 `Input.changePlan` 和 `Input.force`，因为它们是子代理内部状态，不是外部输入。
- 让 prompt 清晰描述统一变更流程的各个阶段。
- 不破坏现有工具行为、dock 交互和时间线渲染。
- 保持 `change-applied` / `change-forced` / `abandoned` / `rejected` 输出类型不变。

## 核心思路

`design-graph` 子代理只对外暴露一个变更入口：`mode: "change"`。该模式内部按顺序执行以下阶段：

1. **分析阶段（原 judge phase）**
   - 读取临时工作集。
   - 必要时扩展工作集。
   - 生成高层 Change Plan。
   - 检查明显问题。

2. **初稿审批阶段**
   - 调用 `design_request_approval`。
   - 根据用户选择分支：
     - `Approve` → 进入细化阶段，`force = false`
     - `Force` → 进入细化阶段，`force = true`
     - `Revise` → 读取修订意见，回到分析阶段重新生成 Change Plan，再次调用 `design_request_approval`
     - `Reject` → 返回 `rejected`

3. **细化阶段（原 refine phase）**
   - 根据 `force` 决定询问策略：
     - `force = false`：每个具体细节都通过 Question 面板询问用户。
     - `force = true`：所有细节由你自主合理化决定，不再通过 Question 面板询问用户。
   - 调用语义化图工具将变更累积到临时 accumulator。
   - 所有细节敲定后，进入阶段 4。如果用户对自主决策不满意，可以在阶段 4 选择 `Revise` 并提出修改意见，你据此继续细化。

4. **终稿审批阶段**
   - 调用 `design_finalize_change`。
   - 根据用户选择分支：
     - `Approve` → 提交 accumulator，bump 版本，返回 `change-applied` 或 `change-forced`
     - `Abandon` → 清空 accumulator，返回 `abandoned`
     - `Revise` → 回到细化阶段继续迭代

整个流程在同一个子代理调用中完成。

## 后端设计

### `packages/opencode/src/design/agent/types.ts`

```ts
export interface Input {
  mode: "cognition" | "change" | "summarize" | "review-save"
  request: string
  source: "chat" | "visual-editor"
  userInput: string
  activeWorkingSet: WorkingSetEntry[]
  knownVersion?: number
  visualEditorDelta?: GraphDelta
}
```

- 移除 `"judge"` 和 `"refine"`。
- 移除 `changePlan` 和 `force` 字段。

`Output` 类型保持不变：

```ts
export interface Output {
  type: "cognition" | "change-applied" | "change-forced" | "abandoned" | "rejected"
  summary: string
  insights?: Insight[]
  proposal?: { ... }
  appliedChange?: { ... }
  questions?: string[]
}
```

### `packages/opencode/src/tool/design.ts`

```ts
function buildGraphAgentPrompt(input: {
  design: Design.Interface
  mode: "cognition" | "change" | "summarize" | "review-save"
  request: string
  ctx: Tool.Context
}): Effect.Effect<string>
```

`DesignRequestChangeTool` 调用时：

```ts
const graphPrompt = yield* buildGraphAgentPrompt({
  design,
  mode: "change",
  request: args.intent,
  ctx,
})
```

### `packages/opencode/src/design/agent/prompt/graph.txt`

重写模式说明部分：

```
你按以下模式工作，模式由输入中的 `mode` 字段决定：

- cognition：通过分析图来回答设计问题。返回自然语言洞察。
- change：接收自然语言设计意图，分析图，生成高层 Change Plan，请求用户初稿审批，细化细节，请求终稿审批，最终应用或放弃变更。
- summarize：基于当前工作集生成当前设计的自然语言摘要。
- review-save：审查来自可视化编辑器的差异并返回建议。
```

新增统一的 `"change" 模式工作流"` 章节，替换原来的 `judge` 和 `refine` 两节：

```
## "change" 模式工作流

本模式在一次调用内完成从意图到应用（或放弃）的完整变更流程。流程分为四个阶段：分析、初稿审批、细化、终稿审批。

### 阶段 1：分析

1. 调用 `design_get_temporary_working_set` 读取当前会话视图。
2. 如果信息不足，使用 `design_search_graph` 或 `design_expand_node` 聚焦分析范围。
3. 基于临时工作集生成高层 Change Plan：
   - `summary` 限制在 2-3 句话以内。
   - 仅列出将要新增/修改的顶层上下文和关键概念。
4. 检查冲突、重复、孤立节点和无效原型使用，判断是否存在"明显问题"。

### 阶段 2：初稿审批

5. 调用 `design_request_approval` 向用户展示变更计划。
   - `summary` 字段放变更计划正文（Markdown）。
   - 如果存在明显问题，在 `warnings` 字段说明，并设置 `has_issues: true`。
   - 面板会自动根据 `has_issues` 提供 Approve/Force/Revise/Reject 选项。
6. 等待用户回答。
7. 根据用户选择分支：
   - **Approve**：进入阶段 3 细化，`force = false`。
   - **Force**：进入阶段 3 细化，`force = true`；你自主决定所有细节，不再通过 Question 面板询问用户。
   - **Reject**：终止子代理，返回类型为 `"rejected"` 的 JSON。
   - **Revise**：读取用户输入的修改意见，回到阶段 1 重新分析并生成 Change Plan，然后再次调用 `design_request_approval`。如果用户未提供修改意见，视为无效修订，需重新询问。

### 阶段 3：细化

8. 基于 Change Plan，通过 Question 面板逐个细节询问用户（仅当 `force = false` 时）。
   - 如果 `force = true`，你自主决定所有细节，不再通过 Question 面板询问用户。
   - 如果 `force = false`，每个具体细节都应询问用户。
9. 每个细节确定后，调用对应的语义化写入工具，将变更累积到临时 accumulator。
10. 所有细节敲定后，进入阶段 4。

### 阶段 4：终稿审批

11. 调用 `design_finalize_change` 向用户展示所有待提交变更的具体细节。
12. 根据用户选择分支：
    - **Approve**：工具自动提交 accumulator 中所有变更，bump 版本。
      - 如果初稿阶段为 **Approve**，返回 `"change-applied"`。
      - 如果初稿阶段为 **Force**，返回 `"change-forced"`。
    - **Abandon**：工具清空 accumulator，返回 `"abandoned"`。
    - **Revise**：读取用户修订意见，回到阶段 3 继续细化。
```

输出 schema 保持现有类型不变，仅说明文字更新：

```
- cognition、summarize、review-save 模式使用 "cognition"。
- "change" 模式终稿 Approve 后，若初稿为 Approve 使用 "change-applied"，若初稿为 Force 使用 "change-forced"。
- "change" 模式终稿 Abandon 使用 "abandoned"。
- "change" 模式初稿 Reject 使用 "rejected"。
- "change" 模式初稿 Revise 与终稿 Revise 均为内部循环，不返回独立输出类型。
```

## ChatAgent Prompt

`packages/opencode/src/agent/prompt/design.txt` 不需要因为 mode 合并而改变，因为 ChatAgent 只通过 `design_request_change` 调用子代理，不关心内部 mode 名称。已有的 `"change-applied"` / `"change-forced"` 处理说明保持不变。

## 工具与权限

- `design_request_approval` 和 `design_finalize_change` 工具本身不变。
- `designGraphPermissions` 不需要新增或删除权限。
- `design_request_change` 仍然是 ChatAgent 触发变更流程的唯一入口。

## 数据流示例

```
用户：设计一个船战系统
  → ChatAgent 调用 design_request_change(intent)
    → task.execute({ subagent_type: "design-graph", mode: "change", request: intent })
      → design-graph subagent (change 模式)
        → 阶段 1：读图、分析、生成 Change Plan
          → 阶段 2：design_request_approval({ summary, has_issues: false })
            → 用户选择 Approve
              → 阶段 3：细化（Question 面板逐个确认细节）
                → design_define_concept + design_relate_concepts（入 accumulator）
                  → 阶段 4：design_finalize_change
                    → 用户选择 Approve
                      → 提交 accumulator，bump 版本
                        → 返回 { type: "change-applied", appliedChange: {...} }
```

## 需要改动的文件

### 后端

- `packages/opencode/src/design/agent/types.ts`
  - `Input.mode` 改为 `"cognition" | "change" | "summarize" | "review-save"`。
  - 移除 `changePlan` 和 `force` 字段。

- `packages/opencode/src/tool/design.ts`
  - `buildGraphAgentPrompt` 的 `mode` 参数类型改为 `"cognition" | "change" | "summarize" | "review-save"`。
  - `DesignRequestChangeTool` 调用时传 `mode: "change"`。

- `packages/opencode/src/design/agent/prompt/graph.txt`
  - 重写模式说明，移除 `judge` / `refine`。
  - 新增统一的 `"change" 模式工作流` 章节。
  - 更新输出 schema 说明。

### 测试

- `packages/opencode/test/design/agent/types.test.ts`
  - 把 `mode: "judge"` 改为 `mode: "change"`。
  - 断言 `mode` 为 `"change"`。

- `packages/opencode/test/tool/graph-agent-design.test.ts`
  - 检查是否有依赖 `mode` 名称的断言（当前没有），如有则更新。

### 文档

- `docs/specs/2026-07-05-design-two-stage-approval.md`
  - 更新为"change 模式内的两阶段审批"，把 `judge` / `refine` 改为阶段名称。

- `docs/specs/2026-07-06-design-change-forced-output.md`
  - 把"judge 模式"、"refine 模式"改为"change 模式内的初稿/细化阶段"。

- `docs/specs/2026-07-06-design-approval-timeline-rendering.md`
  - 同样更新 mode 名称引用。

- `docs/specs/graph-agent-working-set.md`
  - 更新示例中的 `mode: refine`。

## 关键约束

- 子代理仍然是一次调用完成全流程。
- 不引入新的工具。
- 不改变 dock 面板或时间线渲染。
- 不改变输出类型和 schema。
- 移除的 `changePlan` / `force` 字段没有外部调用方（已确认）。

## 测试策略

1. 类型测试：验证 `Input.mode` 不再接受 `"judge"` / `"refine"`，接受 `"change"`。
2. Prompt 文本测试：验证 `graph.txt` 中不包含 `"judge"` 或 `"refine"` 模式说明。
3. 工具测试：验证 `design_request_change` 调用时生成 `mode: "change"` 的 prompt。
4. 集成测试：完整走一次 change 模式流程，确认输出类型正确。

## 决策总结

| 决策 | 选择 |
|---|---|
| 新 mode 名称 | `"change"` |
| 是否保留 `judge` / `refine` | 否，从 `Input.mode` 中移除 |
| 是否移除 `changePlan` / `force` 输入字段 | 是 |
| 输出类型是否变化 | 是，移除 `needs-clarification` |
| 工具是否变化 | 否 |
| prompt 是否重写 | 是，统一为 `"change" 模式工作流` |
| 是否影响 ChatAgent | 否 |
| 是否影响 dock / 时间线 | 否 |
