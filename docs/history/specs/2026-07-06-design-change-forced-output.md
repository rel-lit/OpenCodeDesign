# Design 子代理输出类型增加 `change-forced`

> 日期：2026-07-06
> 状态：已并入统一 change mode 规格

## 背景与问题

Design 模式的统一 `change` mode 中，初稿阶段允许用户在 GraphAgent 发现明显问题时选择 **Force（强行推进）**。按原规格，Force 与 Approve 都会进入细化阶段并执行变更，但 GraphAgent 最终返回给 ChatAgent 的类型都是 `"change-applied"`，且 `appliedChange.summary` 不区分是否经历过 Force。

这导致 ChatAgent 无法区分以下两种场景：

1. **Approve 后的成功**：用户认可了变更方向，子代理按部就班细化并应用。
2. **Force 后的成功**：用户在发现问题的背景下强制推进，子代理被授权自主合理化细节，可能会过滤、调整或省略部分不合理内容。

在测试中已经观察到：用户选择 Force 后，ChatAgent 看到 `"change-applied"` 和“成功新增三条跨上下文关系”的摘要，误以为 GraphAgent 主动过滤掉了荒谬的边，而没有意识到这是 Force 后子代理被授权自主决策的结果。

## 设计目标

- 让 ChatAgent 能明确区分 Approve 与 Force 后的成功。
- 不破坏 dock 面板交互。
- 不改动通用 `question` 工具渲染逻辑。
- 最小化修改范围：只增加一个输出类型，并调整相关 prompt。

## 核心思路

在 GraphAgent 输出类型中新增 `"change-forced"`，与 `"change-applied"` 共享相同的 `appliedChange` schema。`change` mode 的终稿阶段提交成功后：

- 如果初稿阶段用户选择 **Approve**，返回 `"change-applied"`。
- 如果初稿阶段用户选择 **Force**，返回 `"change-forced"`。

ChatAgent 收到 `"change-forced"` 后，应明确告知用户：变更已应用，但这是基于 Force 的强制推进，子代理已自主合理化细节；同时总结实际应用了什么、与原始意图有何差异。

## 后端设计

### 类型更新

在 `packages/opencode/src/design/agent/types.ts` 中：

```ts
export interface Output {
  type: "cognition" | "change-applied" | "change-forced" | "abandoned" | "rejected"
  summary: string
  // ... 其他字段不变
  appliedChange?: {
    version: number
    affectedNodes: string[]
    affectedEdges: string[]
    affectedContexts: string[]
    summary: string
  }
}
```

- `"change-forced"` 的 `appliedChange` 必填，与 `"change-applied"` 相同。
- 不引入新的字段，避免 schema 膨胀。

### 输出差异语义

| 输出类型 | 含义 | ChatAgent 行为 |
|---|---|---|
| `"change-applied"` | 初稿 Approve，终稿 Approve，变更已应用 | 正常总结变更，询问下一步 |
| `"change-forced"` | 初稿 Force，终稿 Approve，变更已应用 | 说明这是强制推进后的结果，强调子代理已自主合理化细节，总结实际应用内容 |
| `"abandoned"` | 终稿选择废弃 | 说明变更未应用 |
| `"rejected"` | 初稿选择拒绝 | 说明变更被拒绝 |

## Prompt 更新

### `packages/opencode/src/design/agent/prompt/graph.txt`

统一 `change` mode 工作流中说明：

- 终稿 Approve 后，若初稿阶段为 Approve，返回 `"change-applied"`。
- 终稿 Approve 后，若初稿阶段为 Force，返回 `"change-forced"`。
- 在 `appliedChange.summary` 中，Force 场景应简要说明哪些原始内容被过滤或调整，以及原因。

### `packages/opencode/src/agent/prompt/design.txt`

在"当你收到 `design_request_change` 的结果时"一节增加 `"change-forced"` 的处理：

```
- 如果类型为 "change-applied"，总结变更内容并询问接下来要完善什么。
- 如果类型为 "change-forced"，说明变更已在用户强制推进下应用；子代理已自主合理化细节。总结实际应用的变更，指出与原始意图的差异（例如过滤了哪些内容），并询问用户是否接受这些调整。
- 如果类型为 "rejected"，说明变更被拒绝，并邀请用户修改请求。
- 如果类型为 "abandoned"，说明用户在终稿阶段放弃了变更，并邀请用户重新发起请求。
- 如果类型为 "cognition"，使用这些洞察来支撑你的回复。
```

## 数据流示例

### Force 场景

```
用户：让资源点也能升级科技树
  → ChatAgent 调用 design_request_change
    → design-graph subagent (change 模式)
      → 阶段 1：读图、分析、发现「资源点→升级→科技树」语义矛盾
        → 阶段 2：design_request_approval({ summary, warnings, has_issues: true })
          → dock 显示 Approve/Force/Revise/Reject，其中 Approve 不可选
            → 用户选择 Force
              → 阶段 3：细化，force=true，GraphAgent 自主决定所有细节
                → 保留「资源点→产出→资源」、新增「资源→升级→建筑」、过滤掉矛盾的科技树边
                  → 阶段 4：design_finalize_change
                    → 用户选择 Approve
                      → 返回 { "type": "change-forced", appliedChange: { ... } }
                        → ChatAgent 看到 "change-forced"
                          → 回复：变更已按 Force 强制应用；原始「资源点升级科技树」被调整为「资源升级建筑」...
```

### Approve 场景

与上述流程相同，但初稿选择 Approve，最终返回 `"change-applied"`。

## 需要改动的文件

### 后端

- `packages/opencode/src/design/agent/types.ts`
  - `Output.type` 联合类型增加 `"change-forced"`。

- `packages/opencode/src/design/agent/prompt/graph.txt`
  - 输出 schema 增加 `"change-forced"`。
  - 统一 `change` mode 工作流说明 Approve / Force 对应的最终返回类型。

### ChatAgent Prompt

- `packages/opencode/src/agent/prompt/design.txt`
  - 增加 `"change-forced"` 的处理说明。

### 测试

- `packages/opencode/test/tool/graph-agent-design.test.ts`
  - 新增或更新测试，验证 `"change-forced"` 输出类型被正确解析。

## 关键约束

- 不修改 `design_request_approval` 工具本身，它已返回 `result: "force"`。
- 不修改 dock 面板选项或交互。
- 不改动通用 `question` 工具。
- `change-forced` 与 `change-applied` 共享 `appliedChange` schema，避免前端和后端类型复杂化。
- GraphAgent 在当前架构下通过读取 `design_request_approval` 的返回结果判断是 Approve 还是 Force；无需额外传递 `force` 变量。

## 相关文档

- `docs/specs/2026-07-06-design-unified-change-mode.md`：统一 `change` mode 的完整规格，包含本类型所在的流程上下文。

## 测试策略

1. **类型测试**：验证 `Output.type` 允许 `"change-forced"`。
2. **Prompt 一致性测试**：验证 `graph.txt` 和 `design.txt` 中包含 `"change-forced"` 相关说明。
3. **集成测试**：通过模拟用户 Force 选择，验证 GraphAgent 最终返回 `"change-forced"`。

## 决策总结

| 决策 | 选择 |
|---|---|
| 如何区分 Force 与 Approve | 新增 `"change-forced"` 输出类型 |
| 是否修改审批工具 | 否，`design_request_approval` 已返回 `result: "force"` |
| 是否新增 schema 字段 | 否，复用 `appliedChange` |
| 是否影响 dock | 否 |
| 是否影响通用 question 工具 | 否 |
| ChatAgent 行为 | 看到 `"change-forced"` 时明确说明强制推进与合理化细节 |
