# Design 模式两阶段审批流程

> 日期：2026-07-05
> 状态：规范 / 待实现

## 设计目标

设计图变更是不可逆的设计决策。用户必须在两个不同粒度上确认：

1. **初稿**：确认"要不要朝这个方向改"。
2. **终稿**：确认"具体要改哪些节点、边、上下文、语义描述"。

两个阶段共享同一个审批面板 GUI 组件/服务，但由 GraphAgent 在子会话中通过**不同的工具调用**触发。

---

## 阶段一：初稿审批（Judge）

### 触发

当 ChatAgent 判断用户想要修改设计图时（包括从零开始创建），它会整理出一段条理清晰的设计需求变更描述，包含：

- 变更意图
- 整体方向
- 系统建议
- 从聊天中收集到的所有细节

ChatAgent 调用 `design_request_change`，把这段描述传入 `design-graph` subagent。

### GraphAgent 行为

GraphAgent 以 `judge` 模式运行：

1. 读取当前图状态。
2. 使用临时工作集工具聚焦相关上下文和概念。
3. 生成高层 Change Plan，只描述核心设计决策。
4. 检查冲突、重复、孤立节点、无效原型使用等问题。
5. 判断是否存在"明显问题"。
6. 调用审批面板（`question.ask`）向用户展示：
   - 变更意图
   - GraphAgent 的分析
   - 发现的问题或警告
   - Change Plan 摘要

### 面板选项

四个选项以单选形式呈现，用户选择后需点击提交按钮。

| 选项 | 出现条件 | 行为 |
|---|---|---|
| **Approve** | GraphAgent 未发现明显问题时 | 进入阶段二细化模式 |
| **Force** | GraphAgent 发现明显问题时 | 进入阶段二细化模式，但 GraphAgent 被授权自主合理化细节，不再反复征求用户意见 |
| **Revise** | 始终出现 | 展开输入框，默认预填入一段基于用户视角的修订方向说明；用户可覆盖输入；提交后 GraphAgent 基于新建议重新分析并再次调用初稿审批 |
| **Reject** | 始终出现 | 终止子代理，返回 `rejected`；返回值包含 GraphAgent 之前提供的分析文本 |

- **Approve** 与 **Force** 互斥，根据是否存在明显问题二选一。
- 面板风格类似 Question 单选题面板，不是权限面板。

### 输出

- `rejected`：用户拒绝，子代理终止。
- `needs-clarification`：用户要求修订，子代理终止，附带用户修改意见。
- 进入 `refine` 模式：用户同意或强行推进。

---

## 阶段二：细化与终稿审批（Refine + Finalize）

### 触发

初稿审批通过后，GraphAgent 以 `refine` 模式继续在同一子会话中运行。

### 细化过程

GraphAgent 通过 **Question 面板**逐个细节询问用户。例如：

> "‘船’的语义解释应该包含哪些内容？请选择一项或给出你自己的描述。"

每个细节确定后，GraphAgent 调用对应的语义化图变更 Tool：

- `design_define_context`
- `design_define_concept`
- `design_refine_concept`
- `design_withdraw_concept`
- `design_relate_concepts`
- `design_withdraw_relation`
- `design_define_relation_prototype`

这些变更不立即写入数据库，而是累积到子会话私有的临时 accumulator。

### 终稿提交工具

所有细节敲定后，GraphAgent 调用**终稿提交工具**。该工具与初稿审批面板共享同一 GUI 服务，但工具 ID/调用不同。

终稿提交工具向用户展示所有待提交变更的具体细节，并提供三个选项：

| 选项 | 行为 |
|---|---|
| **同意** | 工具自动提交临时 accumulator 中的所有变更，相当于内部执行 `design_apply_changes`。成功后 bump 版本，子代理返回 `change-applied` 及变更说明文本。 |
| **废弃变更，选择退出** | 终止子代理，清空临时 accumulator，返回 `abandoned`；返回值包含 GraphAgent 之前提供的变更细节。 |
| **修订** | 输入框必填；提交后 GraphAgent 回到 Question 面板继续细化修订，然后再次调用终稿提交工具。 |

用户选择后需点击提交按钮确认。

### 关键约束

- 终稿提交工具是**一个工具的两个阶段**：第一阶段呈现变更并等待用户决策，第二阶段根据用户选择自动提交或放弃。
- GraphAgent 不需要在调用终稿提交工具后再手动调用 `design_apply_changes`。
- 临时 accumulator 在子代理终止时自动清理。

---

## 输出类型

GraphAgent 子代理最终返回给 ChatAgent 的 JSON 输出包含以下类型：

| 类型 | 含义 |
|---|---|
| `cognition` | 设计认知、摘要、审查结果 |
| `change-applied` | 初稿通过 + 细化完成 + 终稿同意，变更已提交 |
| `abandoned` | 用户在终稿阶段选择废弃变更 |
| `rejected` | 用户在初稿阶段选择 Reject |
| `needs-clarification` | 用户在初稿阶段选择修订，需要 ChatAgent 重新组织意图 |

---

## 工具清单

### ChatAgent 工具

| 工具 | 用途 |
|---|---|
| `design_request_change` | 启动 `design-graph` subagent 进入 `judge` 模式 |

### GraphAgent 子代理内部工具

| 工具 | 用途 |
|---|---|
| `design_get_design` | 获取设计概览 |
| `design_get_context` | 获取限界上下文 |
| `design_get_concept` | 获取概念 |
| `design_find_concepts` | 查找概念 |
| `design_get_relations` | 获取关系 |
| `design_list_prototypes` | 列出关系原型 |
| `design_workset_get` / `add` / `remove` / `expand` | 管理临时工作集 |
| `design_define_context` | 定义上下文 |
| `design_define_concept` | 定义概念 |
| `design_refine_concept` | 精炼概念 |
| `design_withdraw_concept` | 撤销概念 |
| `design_relate_concepts` | 关联概念 |
| `design_withdraw_relation` | 撤销关系 |
| `design_define_relation_prototype` | 定义关系原型 |
| `design_finalize_change` | 终稿提交工具：呈现所有临时变更，用户同意后自动提交 |

### 不再使用的旧模式

- `execute` 模式不再作为独立子代理模式存在；其职责被拆分为 `refine` 模式 + `design_finalize_change` 工具。
- `design_apply_changes` 不再由 GraphAgent 显式调用；它由 `design_finalize_change` 内部自动触发。

---

## 数据流示例

```
用户："设计一个船战系统，船有生命值，被攻击会扣血"
  → ChatAgent 整理需求描述
    → design_request_change(intent)
      → design-graph subagent (judge 模式)
        → 读图、分析、生成 Change Plan
          → 调用审批面板
            → 用户选择"Approve"
              → 进入 refine 模式
                → Question 面板："‘船’的语义描述放什么？"
                  → 用户回答
                    → design_define_concept (写入临时 accumulator)
                → Question 面板："‘生命值’放在哪个上下文？"
                  → 用户回答
                    → design_define_concept + design_relate_concepts (写入临时 accumulator)
                → 所有细节敲定
                  → design_finalize_change
                    → 展示所有待提交变更
                      → 用户选择"Approve"
                        → 自动提交 accumulator
                          → bump version
                            → 返回 change-applied
                              → ChatAgent 总结结果
```

---

## GUI 说明

### 初稿审批面板

- 标题：设计变更审批
- 内容区：Markdown 渲染的 GraphAgent 分析与 Change Plan
- 选项区：单选列表
  - Approve / Force（二选一）
  - Revise（选中后展开输入框，带默认提示文本）
  - Reject
- 底部：提交按钮

### Question 面板（细化阶段）

- 每个细节一个 Question 请求
- 可包含预设选项 + custom 输入
- GraphAgent 读取回答后继续下一步

### 终稿审批面板

- 标题：设计变更终稿确认
- 内容区：Markdown 渲染的所有待提交变更细节
- 选项区：单选列表
  - Approve
  - Abandon
  - Revise（选中后输入框必填）
- 底部：提交按钮

---

## 实现要点

1. `design-graph` subagent 新增 `refine` 模式。
2. 新增 `design_finalize_change` 内部工具，供 GraphAgent 在 refine 模式末尾调用。
3. 审批面板组件需要支持：
   - 根据 metadata.stage 区分初稿/终稿
   - 根据选项 label 动态显示/隐藏输入框
   - 单选 + 提交按钮，而非即时提交
   - 必填验证（终稿"修订"选项）
4. 临时 accumulator 由 `Design.Service` 提供，绑定到 subagent sessionID。
5. `design_finalize_change` 在用户选择"Approve"后内部调用 `Design.applyRawDelta` 并 bump 版本。

---

## 与旧文档的关系

本文档取代 `2026-07-04-design-architecture-v2.md` 中关于审批流程、execute 模式、design_apply_changes 调用方式的相关章节。
