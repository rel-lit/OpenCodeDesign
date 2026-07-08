# 实现计划：Design 模式两阶段审批流程

> 日期：2026-07-05
> 基于规范：`docs/specs/2026-07-05-design-two-stage-approval.md`

## 目标

将 Design 模式图变更流程从当前的"初稿 → 直接执行"改造为"初稿审批 → 细化敲定 → 终稿审批"两阶段流程。

---

## 现状盘点

### 已具备的基础设施

| 能力 | 位置 | 状态 |
|---|---|---|
| 子会话私有的变更 accumulator | `packages/opencode/src/design/system/change-accumulator.ts` | ✅ 已存在，按 sessionID 隔离 |
| 读工具自动看到 accumulator 合并状态 | `Design.getAccumulatedGraphState` | ✅ 已实现 |
| 语义化写工具写入 accumulator | `design_define_concept` 等 | ✅ 已实现 |
| 提交 accumulator 到数据库 | `Design.applyAccumulatedChanges` | ✅ 已实现，但版本源固定为 `"chat-agent"` |
| question 事件子会话冒泡 | `Question.Service` + `sessionTreeRequest` | ✅ 已实现 |
| 专用设计审批 dock | `SessionDesignApprovalDock` | ✅ 已实现，但仅支持 Apply/Reject/Revise 三个按钮 |
| 通用 Question dock | `SessionQuestionDock` | ✅ 支持单选 + custom 输入，可直接用于细化阶段 |
| design-graph subagent | `agent.ts` | ✅ 已注册，权限已配置 |

### 关键缺口

1. 没有 `refine` 子代理模式，prompt 仍是 `judge → execute`。
2. 没有 `design_finalize_change` 工具。
3. 审批面板不支持单选 + 提交按钮，不支持"同意/强行"互斥，不支持初稿/终稿两种 stage。
4. 没有 `abandoned` 输出类型。
5. `applyAccumulatedChanges` 版本源不可配置。
6. 子代理终止时 accumulator 不会自动清理。
7. Question schema 没有 `metadata` 字段，stage 识别需要靠前缀约定。

---

## 实现阶段

### 阶段 1：后端核心改造

#### 1.1 扩展 GraphAgent 类型与输出

**文件**：`packages/opencode/src/design/agent/types.ts`

- 在 `DesignGraphSubagentInput.mode` 中增加 `"refine"`。
- 在 `DesignGraphSubagentOutput.type` 中增加 `"abandoned"`。
- 为 `refine` 模式添加 `changePlan` 和 `force` 字段。

#### 1.2 新增终稿提交工具

**文件**：`packages/opencode/src/tool/design.ts`（或新建 `packages/opencode/src/tool/design-finalize-change.ts`）

实现 `DesignFinalizeChangeTool`：

- 工具 ID：`design_finalize_change`
- 权限：仅 `design-graph` subagent 可用
- 行为：
  1. 读取当前 accumulator 状态（`Design.getAccumulatedGraphState`）。
  2. 生成人类可读的变更摘要。
  3. 调用 `question.ask`，header 使用 `[design-finalize]` 前缀，options 为：
     - `Approve`
     - `Abandon`
     - `Revise`
  4. 等待用户回答：
     - `同意` → 调用 `Design.applyAccumulatedChanges(sessionID, { source: "graph-agent" })`，返回 `change-applied`。
     - `废弃变更，选择退出` → 调用 `Design.clearAccumulatedChanges(sessionID)`，返回 `abandoned`。
     - `修订` → 返回一个特殊结果（如 `metadata: { revision: true }`），让 GraphAgent 继续 refine 流程。

**文件**：`packages/opencode/src/design/design.ts`

- 修改 `applyAccumulatedChanges` 支持可选 `source` 参数，默认保持 `"chat-agent"`。
- 或新增 `finalizeAccumulatedChanges(sessionID)` 方法，内部使用 `"graph-agent"` 作为版本源。

#### 1.3 更新 GraphAgent prompt

**文件**：`packages/opencode/src/design/agent/prompt/graph.txt`

- 将 `execute` 模式替换为 `refine` 模式。
- 重写 `judge` 模式流程：
  - 生成 Change Plan 后调用审批面板。
  - 选项为 `Approve` / `Force` / `Revise` / `Reject`。
  - 根据是否存在明显问题决定显示 `Approve` 还是 `Force`。
  - `Approve` / `Force` → 进入 `refine` 模式。
  - `Reject` → 返回 `rejected`。
  - `Revise` → 读取用户输入，重新分析后再次调用审批面板。
- 新增 `refine` 模式流程：
  - 基于 Change Plan，通过 Question 面板逐个细节询问用户。
  - 每个细节确定后调用对应语义化 Tool 写入 accumulator。
  - 所有细节完成后调用 `design_finalize_change`。
  - 根据终稿面板结果返回 `change-applied`、`abandoned` 或继续细化。
- 输出 schema 增加 `abandoned`。

#### 1.4 调整权限

**文件**：`packages/opencode/src/agent/agent.ts`

- 在 `designGraphPermissions` 中：
  - 添加 `design_finalize_change: "allow"`。
  - 将 `design_apply_changes` 和 `design_clear_changes` 改为 `"deny"`（GraphAgent 不应再显式调用）。
- 确认 `design` ChatAgent 权限不变（仍然只有 `design_request_change` 等入口工具）。

#### 1.5 accumulator 自动清理

**文件**：`packages/opencode/src/tool/task.ts`

- 在 `design-graph` subagent 任务结束时（成功、失败、取消、中断），调用 `Design.clearAccumulatedChanges(childSessionID)`。
- 可以在 `Effect.acquireUseRelease` 的 release 阶段加入清理逻辑。

---

### 阶段 2：前端审批面板改造

#### 2.1 扩展 SessionDesignApprovalDock

**文件**：`packages/app/src/pages/session/composer/session-design-approval-dock.tsx`

改造目标：

- 识别 stage：
  - `request.questions[0]?.header?.startsWith("[design-approval]")` → 初稿
  - `request.questions[0]?.header?.startsWith("[design-finalize]")` → 终稿
- 使用单选列表 + 提交按钮，而不是三个独立按钮。
- 初稿选项：
  - `Approve`（根据 options 决定是否渲染）
  - `Force`（根据 options 决定是否渲染）
  - `Revise`（选中后展开输入框，带默认预填入文本）
  - `Reject`
- 终稿选项：
  - `Approve`
  - `Abandon`
  - `Revise`（选中后输入框必填）
- 提交时根据选中的 radio 发送对应 answer：
  - `Approve` → `["Approve"]`
  - `Force` → `["Force"]`
  - `Revise` → `["Revise", text]`
  - `Reject` → `["Reject"]`
  - `Approve`（终稿） → `["Approve"]`
  - `Abandon` → `["Abandon"]`
  - `Revise`（终稿） → `["Revise", text]`

**问题**：如何传递"是否存在明显问题"给前端？

方案 A（推荐，无需改 schema）：在 `question.ask` 的 `options` 中直接只放应该出现的选项。GraphAgent 根据是否存在问题构造不同的 options 数组。前端只渲染收到的 options，无需额外 metadata。

- 无问题：options = [Approve, Revise, Reject]
- 有问题：options = [Force, Revise, Reject]

这样前端不需要知道"互斥"逻辑，只需要支持单选 + 提交 + 修订输入框。

#### 2.2 更新路由检测

**文件**：`packages/app/src/pages/session/composer/session-composer-region.tsx`

- 扩展 `isDesignApprovalRequest` 使其同时匹配 `[design-approval]` 和 `[design-finalize]` 前缀。

#### 2.3 新增/更新 i18n key

**文件**：`packages/app/src/i18n/en.ts`、`zh.ts`、`zht.ts`

新增 key：

- `session.designApproval.agree`
- `session.designApproval.force`
- `session.designApproval.revise`
- `session.designApproval.reject`
- `session.designApproval.abandon`
- `session.designApproval.finalizeTitle`
- `session.designApproval.reviseRequired`

#### 2.4 工具时间线标题

**文件**：`packages/session-ui/src/components/message-part.tsx`

- 在 `designInternalToolInfo` 的 `titles` 映射中添加 `design_finalize_change: "确认设计变更"`。

---

### 阶段 3：测试

#### 3.1 后端测试

**文件**：`packages/opencode/test/tool/graph-agent-design.test.ts`

新增测试：

- `design_finalize_change` 同意提交 accumulator。
- `design_finalize_change` 废弃清空 accumulator。
- `design_finalize_change` 修订返回继续细化信号。

**文件**：`packages/opencode/test/design/design.test.ts`

新增测试：

- `finalizeAccumulatedChanges` 使用 `"graph-agent"` 版本源。
- accumulator 在提交后被清空。

**文件**：`packages/opencode/test/tool/task.test.ts`

新增测试（可选）：

- `design-graph` subagent 结束时 accumulator 被清理。

#### 3.2 真实 GUI 测试

在桌面端实际验证：

1. 发起一个设计变更请求。
2. 确认初稿审批面板出现，选项正确（根据是否有问题显示 同意/强行）。
3. 选择修订，确认输入框有默认文本。
4. 选择同意/强行，进入细化阶段，确认 Question 面板逐个询问细节。
5. 所有细节完成后，确认终稿审批面板出现。
6. 选择同意，确认变更落库；选择废弃，确认未落库；选择修订，确认回到 Question 面板。

---

## 风险与决策

### 决策 1：终稿提交工具是一个独立 tool 还是复用 question.ask？

**选择**：实现为独立 tool `design_finalize_change`。

理由：
- 该工具需要读取 accumulator 状态并自动执行提交/清理，不仅仅是提问。
- 作为 tool 可以在子代理 timeline 中显示"确认设计变更"卡片。
- 权限控制更精确。

### 决策 2：如何识别 stage？

**选择**：使用 header 前缀 `[design-approval]` 和 `[design-finalize]`，与现有 `SessionDesignApprovalDock` 保持一致。

理由：
- 不改动 Question schema，避免 SDK 重新生成。
- 向后兼容旧客户端。

### 决策 3：同意/强行互斥如何在前端实现？

**选择**：不在前端实现互斥逻辑，而是由 GraphAgent 在构造 question options 时只放入应该出现的选项。

理由：
- 前端保持简单，只负责渲染收到的 options。
- 互斥决策属于业务逻辑，放在 agent 侧更合适。

### 决策 4：版本源使用什么？

**选择**：终稿提交使用 `"graph-agent"` 作为版本源，与 ChatAgent 发起的读取同步源 `"chat-agent"` 区分开。

理由：
- 明确变更来源是 GraphAgent 子代理。
- 便于后续审计和脏标记逻辑。

---

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `packages/opencode/src/design/agent/types.ts` | 增加 `refine` 模式和 `abandoned` 输出类型 |
| `packages/opencode/src/design/agent/prompt/graph.txt` | 重写 judge/refine 流程 |
| `packages/opencode/src/tool/design.ts` | 新增 `DesignFinalizeChangeTool` |
| `packages/opencode/src/design/design.ts` | 支持可配置版本源的提交方法 |
| `packages/opencode/src/agent/agent.ts` | 更新 design-graph 权限 |
| `packages/opencode/src/tool/task.ts` | subagent 结束时清理 accumulator |
| `packages/app/src/pages/session/composer/session-design-approval-dock.tsx` | 支持单选 + 提交、初稿/终稿双 stage |
| `packages/app/src/pages/session/composer/session-composer-region.tsx` | 匹配 `[design-finalize]` 前缀 |
| `packages/session-ui/src/components/message-part.tsx` | 添加 `design_finalize_change` 标题 |
| `packages/app/src/i18n/en.ts`、`zh.ts`、`zht.ts` | 新增审批面板文案 |
| `packages/opencode/test/tool/graph-agent-design.test.ts` | 新增终稿工具测试 |
| `packages/opencode/test/design/design.test.ts` | 新增版本源和清理测试 |

---

## 验收标准

- [x] `design_request_change` 触发 design-graph subagent 后，用户看到初稿审批面板。
- [x] 初稿面板根据是否存在明显问题显示 Approve 或 Force。
- [x] 选择 Approve/Force 后，进入 Question 面板逐个细节询问。
- [x] 每个细节确定后写入 accumulator，不立即落库。
- [x] 所有细节完成后，出现终稿审批面板。
- [x] 终稿选择 Approve → 自动提交所有变更，返回 `change-applied`。
- [x] 终稿选择 Abandon → 清空 accumulator，返回 `abandoned`。
- [x] 终稿选择 Revise → 必填输入框，返回细化流程。
- [x] 初稿选择 Reject → 返回 `rejected`。
- [x] 初稿选择 Revise → 带默认提示文本，重新分析。
- [x] 子代理终止时 accumulator 自动清理。
- [x] `bun run typecheck` 全过。
- [ ] 真实 GUI 测试通过。
