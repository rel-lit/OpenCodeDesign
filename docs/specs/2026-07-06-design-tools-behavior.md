# Design 子代理工具完整行为设计（v1 草案）

> 日期：2026-07-06
> 状态：草案 / 待补充

本文档梳理 design-graph 子代理可用的完整工具集合及其行为、异常处理规则。用于作为实现规格的基础。

---

## 一、读工具（只读）

所有读工具都基于 **Design Change Buffer 合并后的状态**，即能看到 buffer 中待创建/待修改但尚未提交的内容。

读工具遵循**分层信息披露**原则：
- **发现类工具**返回概要，并把结果加入临时工作集。
- **单个 get 工具**返回查询对象自身的完整内容，但其指向的外部实体只给概要（名称替换 ID）。
- **关系/原型专用查询工具**返回对应内容的完整详情。
- **概要中保留自身 ID**，便于后续用 ID 精确查询。
- **指向外部实体的 ID 替换为名称**，避免 GraphAgent 被大量内部 ID 淹没。

### 1.1 发现类工具

| 工具 | 行为 | 返回层级 |
|---|---|---|
| `design_get_temporary_working_set` | 返回当前子代理 session 的临时工作集摘要 | 工作集条目概要 |
| `design_search_graph` | 按名称/别名搜索 concept 或 context，匹配结果加入临时工作集 | 匹配项概要（含自身 ID） |
| `design_expand_node` | 展开指定 concept 的一跳邻居，邻居加入临时工作集 | 邻居概要 + 关系概要（含自身 ID） |
| `design_list_prototypes` | 返回所有关系原型列表 | 列表概要（含 ID） |

#### 概要条目格式

发现类工具返回的每个条目包含：

```ts
{
  id: string      // 自身 ID，保留
  name: string    // 名称
  type: "context" | "node" | "prototype"
  briefSemantics: string  // 简短语义
}
```

### 1.2 单个 get 工具

| 工具 | 行为 | 返回层级 |
|---|---|---|
| `design_get_context` | 返回单个 context 的完整语义及其包含的 concepts 列表 | context 自身完整内容；concepts 只给概要（含 ID） |
| `design_get_concept` | 返回单个 concept 的完整语义及其关系列表 | concept 自身完整内容；relations 只给概要（含 ID） |
| `design_get_relation` | 返回指定两个 concept 之间关系的完整内容 | edge 完整内容 |
| `design_get_prototype` | 返回单个关系原型的完整内容 | prototype 自身完整内容 |
| `design_expand_node_focused` | 展开指定 concept 的一跳邻居，返回中心节点、所有邻居节点、以及它们之间关系的完整内容 | 全部完整内容 |
| `design_get_state_summary` | 返回图规模统计 | 统计数字 |

#### `design_get_context`

返回单个 context 的完整语义，及其包含的 concepts 列表（仅概要）。

输出示例：

```
Context: 战斗系统 (ctx-abc123)
Semantics: 游戏核心战斗机制，包含玩家、敌人、技能、伤害计算等。

Concepts:
- 船 (node-xyz789): 玩家操控的水上载具
- 武器 (node-uvw456): 可装备的攻击性物品
```

注意：context 自身的 ID 保留；下面的 concepts 只给名称和自身 ID，**concept 的 contextId 等外部引用 ID 已被替换为 context 名称**。

#### `design_get_concept`

返回单个 concept 的完整语义，及其关系列表（仅概要）。

输出示例：

```
Concept: 船 (node-xyz789)
Context: 战斗系统         ← contextId 替换为名称
Kind: entity
Aliases: 飞船
Semantics: 玩家操控的水上载具，可装备武器，有耐久度。

Relations:
- 船 --[属于]--> 战斗系统     ← prototypeId / nodeId 替换为名称
- 船 --[装备]--> 武器
```

注意：concept 自身的 ID 保留；relations 中外部实体的 ID 替换为名称。每条关系只显示概要，不展开 `parameters`。

#### `design_get_relation`

参数：

```ts
{
  from: string  // 源 concept 名称或 ID
  to: string    // 目标 concept 名称或 ID
}
```

行为：
- 查找 from 和 to 两个 concept。
- 查找它们之间的关系（边）。
- 如果关系存在，返回完整内容。
- 如果关系不存在，返回错误 "No relation between 'X' and 'Y'"

注意：关系本身没有独立 ID，只能通过 `from` 和 `to` 两个 concept 的 ID 唯一标识。

输出示例：

```
Relation: 船 --[装备]--> 武器
From: 船 (node-xyz789)
To: 武器 (node-uvw456)
Prototype: 装备 (proto-def012)
Semantics: 船可以装备武器作为攻击性组件
Parameters:
  maxSlots: 4
  slotTypes: ["主炮", "副炮"]
```

异常：
- from 不存在：错误 "Source concept 'X' not found"
- to 不存在：错误 "Target concept 'Y' not found"
- 关系不存在：错误 "No relation between 'X' and 'Y'"

#### `design_get_prototype`

返回单个关系原型的完整内容。

输出示例：

```
Prototype: 装备 (proto-def012)
Default semantics: 一个实体可以装备另一个实体作为组件
Parameter schema:
  maxSlots: number
  slotTypes: string[]
```

#### `design_expand_node_focused`

参数：

```ts
{
  name_or_id: string  // 中心 concept 名称或 ID
}
```

行为：
- 查找中心 concept。
- 查找所有与中心 concept 直接相连的关系（边）。
- 对每个关系，查找另一端的概念作为邻居。
- 返回：
  - 中心 concept 的完整内容（含自身 ID）
  - 所有邻居 concept 的完整内容（含自身 ID）
  - 中心节点与每个邻居之间关系的完整内容

输出示例：

```
Center: 船 (node-xyz789)
Context: 战斗系统
Kind: entity
Aliases: 飞船
Semantics: 玩家操控的水上载具，可装备武器，有耐久度。

Neighbors:

[邻居 1]
Concept: 武器 (node-uvw456)
Context: 战斗系统
Kind: entity
Aliases: none
Semantics: 可装备的攻击性物品。

Relation: 船 --[装备]--> 武器
From: 船 (node-xyz789)
To: 武器 (node-uvw456)
Prototype: 装备 (proto-def012)
Semantics: 船可以装备武器作为攻击性组件
Parameters:
  maxSlots: 4
  slotTypes: ["主炮", "副炮"]

[邻居 2]
Concept: 战斗系统 (ctx-abc123)
Context: N/A
Kind: bounded_context
Aliases: none
Semantics: 游戏核心战斗机制。

Relation: 船 --[属于]--> 战斗系统
From: 船 (node-xyz789)
To: 战斗系统 (ctx-abc123)
Prototype: 属于 (proto-ghi789)
Semantics: 概念属于某个限界上下文
Parameters: {}
```

异常：
- 中心 concept 不存在：返回错误 "Concept 'X' not found"

### 1.3 `search` 与 `get` 的区别

| 维度 | `design_search_graph` / `design_expand_node` / `design_list_prototypes` | `design_get_context` / `design_get_concept` / `design_get_relation` / `design_get_prototype` / `design_expand_node_focused` |
|---|---|---|
| 目的 | 发现、定位 | 深入了解单个对象 |
| 查询条件 | 名称/别名/节点 | ID 或精确名称 |
| 返回数量 | 多个匹配项 | 单个对象或单个中心对象及其直接关联 |
| 是否加入工作集 | 是 | 否 |
| 返回内容 | 概要 | 查询对象自身完整，关联对象概要（focused 版本全部完整） |

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

### 2.1 异常处理细则

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

### 3.1 `design_undo_buffer_operation` 依赖规则

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

### 4.1 提交前一致性检查

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

### 6.1 内容写工具

```ts
{
  title: "Defined concept 船",
  output: "Concept 船 queued for creation",
  metadata: { operationId: "op-xxx" }
}
```

### 6.2 `design_list_buffer_operations`

```ts
{
  operations: [
    { id: "op-1", type: "create_context", description: "Create context '战斗系统'" },
    { id: "op-2", type: "create_node", description: "Create concept '船' in context '战斗系统'" }
  ]
}
```

### 6.3 `design_undo_buffer_operation`

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
