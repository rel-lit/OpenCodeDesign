# Design 子代理工具完整行为设计（v1）

> 日期：2026-07-06
> 状态：已决策，待实现

本文档梳理 design-graph 子代理可用的完整工具集合及其行为、异常处理规则。包含图操作工具、缓冲区控制工具、审批工具。用于作为实现规格的基础。

---

## 一、读工具（只读，仅针对已持久化图）

所有读工具都基于**已持久化的设计图**，不反映当前 session buffer 中待提交的内容。buffer 中的待提交内容使用专门的 buffer 读工具查看（见 [三、缓冲区控制工具](#三缓冲区控制工具)）。

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
- 船 --[属于]-- 战斗系统     ← prototypeId / nodeId 替换为名称
- 船 --[装备]-- 武器
```

注意：concept 自身的 ID 保留；relations 中外部实体的 ID 替换为名称。每条关系只显示概要，不展开 `parameters`。

#### `design_get_relation`

参数：

```ts
{
  left: string  // 端点 concept 名称或 ID（无序）
  right: string // 端点 concept 名称或 ID（无序）
}
```

行为：
- 查找 left 和 right 两个 concept。
- 查找它们之间的关系（边）。
- 如果关系存在，返回完整内容。
- 如果关系不存在，返回错误 "No relation between 'X' and 'Y'"

注意：关系本身没有独立 ID，只能通过 `left` 和 `right` 两个 concept 的 ID 唯一标识。底层 edge 为无向，输出格式由工具自动处理为 `A --[prototype]-- B`，不暴露方向给 GraphAgent。

输出示例：

```
Relation: 船 --[装备]-- 武器
Left: 船 (node-xyz789)
Right: 武器 (node-uvw456)
Prototype: 装备 (proto-def012)
Semantics: 船可以装备武器作为攻击性组件
Parameters:
  maxSlots: 4
  slotTypes: ["主炮", "副炮"]
```

异常：
- left 不存在：错误 "Source concept 'X' not found"
- right 不存在：错误 "Target concept 'Y' not found"
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

Relation: 船 --[装备]-- 武器
Left: 船 (node-xyz789)
Right: 武器 (node-uvw456)
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

Relation: 船 --[属于]-- 战斗系统
Left: 船 (node-xyz789)
Right: 战斗系统 (ctx-abc123)
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
| `design_define_concept` | `create_node` | 添加创建 concept 操作 | 同一 context 下名字已存在时报错；所属 context 不存在报错 |
| `design_refine_concept` | `update_node` | 添加更新 concept 操作 | 目标不存在报错 |
| `design_withdraw_concept` | `delete_node` | 添加删除 concept 操作，并自动级联删除相关 edge | 目标不存在报错；强制自动级联，不允许 dangling edge |
| `design_relate_concepts` | `create_edge` 或 `update_edge` | 添加创建/更新 edge 操作；返回结果通过 `metadata.operationType` 区分 | left/right/prototype 不存在报错 |
| `design_withdraw_relation` | `delete_edge` | 添加删除 edge 操作 | left/right 不存在报错；边不存在时返回警告 |
| `design_define_relation_prototype` | `create_prototype` 或 `update_prototype` | 添加创建/更新 prototype 操作；返回结果通过 `metadata.operationType` 区分 | 无异常；同名视为更新 |
| `design_withdraw_relation_prototype` | `delete_prototype` | 添加删除 prototype 操作 | 目标不存在报错；被 edge 使用时报错 |

### 2.1 异常处理细则

#### 重名/已存在

| 场景 | 处理 |
|---|---|
| `design_define_context` 名字已存在 | 错误："Context 'X' already exists" |
| `design_define_concept` 同一 context 下名字已存在 | 错误："Concept 'X' already exists in context 'Y'" |
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
| `design_relate_concepts` left 不存在 | 错误："Source concept 'X' not found" |
| `design_relate_concepts` right 不存在 | 错误："Target concept 'X' not found" |
| `design_relate_concepts` relation 不存在 | 错误："Prototype 'X' not found" |
| `design_withdraw_relation` left/right 不存在 | 错误："Concept 'X' not found" |
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
| `design_undo_buffer_operation` | 按 operation ID 从 buffer 移除一条内容操作；存在依赖时按 `cascade` 参数处理 |

### 3.1 `design_undo_buffer_operation` 参数

```ts
{
  operation_id: string
  cascade?: boolean  // 是否级联撤销依赖此操作的后续操作，默认 false
}
```

### 3.2 `design_undo_buffer_operation` 依赖规则

被撤销操作若被后续操作引用：

- `cascade: true`：级联撤销所有依赖此操作的后续操作（包括间接依赖）。
- `cascade: false`（默认）：拒绝撤销并提示先撤销依赖。

依赖关系：

| 被撤销操作 | 依赖它的后续操作 |
|---|---|
| `create_context` | `create_node` 引用该 context |
| `create_node` | `create_edge` / `update_edge` / `delete_edge` 引用该 node |
| `create_prototype` | `create_edge` / `update_edge` 使用该 prototype |
| `update_context` | 仅当修改了 context 的 ID 时，引用它的 `create_node` 依赖此操作 |
| `update_node` | 仅当修改了 node 的 ID 时，引用它的 edge 操作依赖此操作 |
| `update_prototype` | 仅当修改了 prototype 的 ID 时，引用它的 edge 操作依赖此操作 |
| 删除类操作 | 不被其他操作依赖 |

---

## 四、初稿审批工具

| 工具 | 行为 |
|---|---|
| `design_request_approval` | 向用户展示设计变更计划的初稿审批面板，提供 Approve/Force/Revise/Reject 选项 |

### 4.1 参数

```ts
{
  summary: string       // 变更计划摘要（Markdown）
  warnings?: string     // 发现的问题或警告（可选，Markdown）
  has_issues?: boolean  // 是否存在明显问题
}
```

### 4.2 行为

1. 构造单个 question：
   - `header`: `"设计变更审批"`
   - `question`: 以 `[design-approval]` 开头，后接 `summary` 和 `warnings`
   - `options`:
     - 无问题时：`Approve`、`Revise`、`Reject`
     - 有问题时：`Force`、`Revise`、`Reject`
   - `custom: true`
2. 通过 `Question.Service.ask` 发送 question；客户端识别 `[design-approval]` 前缀，渲染专用的 design approval dock 面板，而非通用 question dock。
3. 根据用户选择返回结果：
   - `Approve` → `metadata.result = "approve"`
   - `Force` → `metadata.result = "force"`
   - `Revise` → `metadata.result = "revise"`，并附带 `revisionText`
   - `Reject` → `metadata.result = "reject"`

---

## 五、终稿审批工具

| 工具 | 行为 |
|---|---|
| `design_finalize_change` | 展示 buffer 派生的待提交差异；用户 Approve 时原子提交所有操作，Abandon 时清空 buffer，Revise 时返回继续细化 |

`design_finalize_change` 与 `design_request_approval` 类似，也通过 `Question.Service.ask` 发送 question；但 `question` 以 `[design-finalize]` 开头，客户端渲染终稿确认面板。选项为 `Approve`、`Abandon`、`Revise`。

### 5.1 提交前一致性检查

`design_finalize_change` 用户选择 Approve 后，真正持久化前执行：

1. 所有 `create_node` 引用的 context 存在（持久化图或 buffer 中）。
2. 所有 edge 操作的 from/to node 存在。
3. 所有 edge 操作的 prototype 存在。
4. 无重名 context；同一 context 内无重名 concept。持久化图中已存在的 context/concept，不得在 buffer 中再次创建（包括同名删除后重建）。
5. 无对同一实体的重复创建。
6. `delete_node` 已自动处理相关 edge。

任一检查失败，返回错误给 GraphAgent，不提交。

---

## 六、Buffer 内容操作类型

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

## 七、输出约定

### 7.1 内容写工具

```ts
// 创建 edge
{
  title: "Related concepts",
  output: "船 --[装备]-- 武器 queued",
  metadata: { operationId: "op-xxx", operationType: "create_edge" }
}

// 更新 edge
{
  title: "Related concepts",
  output: "船 --[装备]-- 武器 updated",
  metadata: { operationId: "op-yyy", operationType: "update_edge" }
}

// 创建 prototype
{
  title: "Defined prototype 装备",
  output: "Prototype 装备 queued for creation",
  metadata: { operationId: "op-xxx", operationType: "create_prototype" }
}

// 更新 prototype
{
  title: "Defined prototype 装备",
  output: "Prototype 装备 updated",
  metadata: { operationId: "op-yyy", operationType: "update_prototype" }
}
```

### 7.2 `design_list_buffer_operations`

```ts
{
  operations: [
    { id: "op-1", type: "create_context", description: "Create context '战斗系统'" },
    { id: "op-2", type: "create_node", description: "Create concept '船' in context '战斗系统'" }
  ]
}
```

### 7.3 `design_undo_buffer_operation`

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

## 相关文档

- `docs/specs/2026-07-06-design-change-buffer.md`：Design Change Buffer 总体规格。
- `docs/specs/2026-07-06-design-unified-change-mode.md`：统一 change mode 工作流。
