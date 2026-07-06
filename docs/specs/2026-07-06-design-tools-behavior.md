# Design 子代理工具完整行为设计（v1 草案）

> 日期：2026-07-06
> 状态：草案 / 待补充

本文档梳理 design-graph 子代理可用的完整工具集合及其行为、异常处理规则。用于作为实现规格的基础。

---

## 一、读工具（只读）

所有读工具都基于 **Design Change Buffer 合并后的状态**，即能看到 buffer 中待创建/待修改但尚未提交的内容。

| 工具 | 行为 |
|---|---|
| `design_get_temporary_working_set` | 返回当前子代理 session 的临时工作集摘要 |
| `design_search_graph` | 按名称/别名搜索 concept 或 context，匹配结果加入临时工作集 |
| `design_expand_node` | 展开指定 concept 的一跳邻居，邻居加入临时工作集 |
| `design_get_concept` | 返回 concept 的语义、context、关系、邻居 |
| `design_get_context` | 返回 context 及其包含的 concepts |
| `design_get_state_summary` | 返回图规模统计 |
| `design_list_prototypes` | 返回所有关系原型列表 |

---

## 二、内容写工具（向 buffer 添加内容操作）

所有内容写工具都不直接修改数据库，而是向当前 session 的 `Design Change Buffer` 添加一条内容操作。

| 工具 | 操作类型 | 行为 | 异常处理 |
|---|---|---|---|
| `design_define_context` | `create_context` | 添加创建 context 操作 | 名字已存在时报错 |
| `design_update_context` | `update_context` | 添加更新 context 操作 | 目标不存在报错；新名字冲突报错 |
| `design_withdraw_context` | `delete_context` | 添加删除 context 操作 | 目标不存在报错；若仍包含 concept 则报错 |
| `design_define_concept` | `create_node` | 添加创建 concept 操作 | 名字已存在报错；所属 context 不存在报错 |
| `design_refine_concept` | `update_node` | 添加更新 concept 操作 | 目标不存在报错 |
| `design_withdraw_concept` | `delete_node` | 添加删除 concept 操作，并自动级联删除相关 edge | 目标不存在报错 |
| `design_relate_concepts` | `create_edge` 或 `update_edge` | 添加创建/更新 edge 操作 | from/to/prototype 不存在报错 |
| `design_withdraw_relation` | `delete_edge` | 添加删除 edge 操作 | from/to 不存在报错；边不存在时返回警告 |
| `design_define_relation_prototype` | `create_prototype` 或 `update_prototype` | 添加创建/更新 prototype 操作 | 无异常；同名视为更新 |
| `design_withdraw_relation_prototype` | `delete_prototype` | 添加删除 prototype 操作 | 目标不存在报错；被 edge 使用时报错 |

### 异常处理细则

#### 重名/已存在

| 场景 | 处理 |
|---|---|
| `design_define_context` 名字已存在 | 错误："Context 'X' already exists" |
| `design_define_concept` 名字已存在 | 错误："Concept 'X' already exists" |
| `design_define_relation_prototype` 名字已存在 | 视为 `update_prototype`，更新语义 |
| `design_update_context` 新名字与其他 context 冲突 | 错误："Context name 'X' already in use" |

#### 引用不存在

| 场景 | 处理 |
|---|---|
| `design_define_concept` 指定 context 不存在 | 错误："Context 'X' not found" |
| `design_update_context` 目标不存在 | 错误："Context 'X' not found" |
| `design_withdraw_context` 目标不存在 | 错误："Context 'X' not found" |
| `design_refine_concept` 目标不存在 | 错误："Concept 'X' not found" |
| `design_withdraw_concept` 目标不存在 | 错误："Concept 'X' not found" |
| `design_relate_concepts` from 不存在 | 错误："Source concept 'X' not found" |
| `design_relate_concepts` to 不存在 | 错误："Target concept 'X' not found" |
| `design_relate_concepts` relation 不存在 | 错误："Prototype 'X' not found" |
| `design_withdraw_relation` from/to 不存在 | 错误："Concept 'X' not found" |
| `design_withdraw_relation_prototype` 目标不存在 | 错误："Prototype 'X' not found" |

#### 删除约束

| 场景 | 处理 |
|---|---|
| `design_withdraw_context` 且该 context 下仍有 concept | 错误："Context 'X' still contains concepts: A, B. Withdraw them first." |
| `design_withdraw_concept` 且该 concept 有关联 edge | **自动级联删除相关 edge**，向 buffer 添加对应 `delete_edge` 操作 |
| `design_withdraw_relation_prototype` 且该 prototype 被 edge 使用 | 错误："Prototype 'X' is used by edges: A<->B, C<->D. Withdraw those edges first." |
| `design_withdraw_relation` 边不存在 | 警告："Edge X<->Y does not exist"，不添加操作 |

---

## 三、缓冲区控制工具

| 工具 | 行为 |
|---|---|
| `design_list_buffer_operations` | 返回当前 buffer 中所有内容操作列表 |
| `design_undo_buffer_operation` | 按 operation ID 从 buffer 移除一条内容操作；存在依赖时拒绝 |

### `design_undo_buffer_operation` 依赖规则

被撤销操作若被后续操作引用，则拒绝撤销并提示先撤销依赖：

| 被撤销操作 | 阻塞后续操作 |
|---|---|
| `create_context` | `create_node` 引用该 context |
| `create_node` | `create_edge` / `update_edge` / `delete_edge` 引用该 node |
| `create_prototype` | `create_edge` / `update_edge` 使用该 prototype |
| `update_context` | 仅当修改了 context 的 ID 时阻塞引用它的 `create_node` |
| `update_node` | 仅当修改了 node 的 ID 时阻塞引用它的 edge 操作 |
| `update_prototype` | 仅当修改了 prototype 的 ID 时阻塞引用它的 edge 操作 |
| 删除类操作 | 不被其他操作依赖 |

---

## 四、终稿审批工具

| 工具 | 行为 |
|---|---|
| `design_finalize_change` | 展示 buffer 派生的待提交差异；用户 Approve 时原子提交所有操作，Abandon 时清空 buffer，Revise 时返回继续细化 |

### 提交前一致性检查

`design_finalize_change` 用户选择 Approve 后，真正持久化前执行：

1. 所有 `create_node` 引用的 context 存在（持久化图或 buffer 中）。
2. 所有 edge 操作的 from/to node 存在。
3. 所有 edge 操作的 prototype 存在。
4. 无重名 context/concept。
5. 无对同一实体的重复创建。
6. `delete_node` 已自动处理相关 edge。

任一检查失败，返回错误给 GraphAgent，不提交。

---

## 五、Buffer 内容操作类型

```ts
type BufferOperationType =
  | "create_context"
  | "update_context"
  | "delete_context"
  | "create_node"
  | "update_node"
  | "delete_node"
  | "create_edge"
  | "update_edge"
  | "delete_edge"
  | "create_prototype"
  | "update_prototype"
  | "delete_prototype"
```

---

## 六、输出约定

### 内容写工具

```ts
{
  title: "Defined concept 船",
  output: "Concept 船 queued for creation",
  metadata: { operationId: "op-xxx" }
}
```

### `design_list_buffer_operations`

```ts
{
  operations: [
    { id: "op-1", type: "create_context", description: "Create context '战斗系统'" },
    { id: "op-2", type: "create_node", description: "Create concept '船' in context '战斗系统'" }
  ]
}
```

### `design_undo_buffer_operation`

```ts
// 成功
{ title: "Operation undone", output: "Removed operation op-2", metadata: {} }

// 失败（有依赖）
{
  title: "Cannot undo operation",
  output: "Operation op-1 is referenced by: op-2. Undo those first.",
  metadata: { blockedBy: ["op-2"] }
}
```

---

## 七、待补充/待决策

1. context 更新时是否允许修改 context 的 ID？
2. concept 更新时是否允许修改 concept 的名字？若允许，是否同步更新 edge 中的引用？
3. prototype 更新时是否允许修改名字？被使用的 prototype 改名后，edge 是否保持引用？
4. `design_withdraw_relation_prototype` 在缓冲区阶段是否被允许？还是只允许撤销 `create_prototype` 操作？
5. 是否支持 `design_undo_buffer_operation({ operation_id, cascade: true })` 级联撤销依赖？
6. `design_withdraw_concept` 的 cascade 行为是否应暴露为参数，还是强制自动级联？
7. 读工具基于 buffer 合并状态，是否也需要显示哪些内容是待提交的？
8. 是否需要 `design_clear_buffer` 工具供 GraphAgent 在 refine 阶段直接清空缓冲区？

---

## 相关文档

- `docs/specs/2026-07-06-design-change-buffer.md`：Design Change Buffer 总体规格。
- `docs/specs/2026-07-06-design-unified-change-mode.md`：统一 change mode 工作流。
