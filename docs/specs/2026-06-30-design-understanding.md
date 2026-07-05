# Design 模式在 OpenCode 中的原生位置

## 一、Design 不是"第三种模式"，而是"第二类原生 Agent"

OpenCode 现有的 primary agent 只有两种形态：**build** 和 **plan**。它们共享同一套运行时基础设施：

- 同一个 `SessionPrompt` 循环
- 同一个 `ToolRegistry` 工具池
- 同一个按 Agent permission 过滤工具的机制
- 同一个 per-instance 的 `InstanceState` 状态模型

它们的区别只在于 **permission ruleset** 和 **系统提示词**。plan 通过 `plan_exit` 工具切回 build，本质上也是在同一个 session 里修改下一条 user message 的 `agent` 字段。

所以 Design 不应该被做成一个独立的"模式"或旁路系统。它应该是一个和 build/plan 平级的 primary agent，**区别仅在于它操作的对象不是文件系统，而是一个结构化的语义图**。这个图本身是一个项目级状态子系统，和 `Session`、`Agent`、`Snapshot` 等一样，应该被纳入 OpenCode 的 per-instance 服务生命周期。

## 二、OpenCode 的状态分层

理解 Design 该放哪儿，必须先理解 OpenCode 的两层状态模型。

### 全局服务层

`AppLayer` 里 merge 的大部分服务都是全局单例：

- `Config`、`Provider`、`Auth`、`Plugin`
- `ToolRegistry`、`Agent`、`Skill`
- `SessionPrompt`、`LLM`、`Permission`

这些服务本身不保存业务状态，或者只保存跨项目共享的轻量配置。它们通过 `ManagedRuntime` + `memoMap` 在进程内共享。

### 项目实例层

真正和具体目录绑定的状态通过 `InstanceState.make<A>` 创建。典型例子是 `Agent.Service`：

```typescript
const state = yield* InstanceState.make<State>(...)
```

`InstanceStore` 负责按 directory 缓存/加载/释放这些状态。`InstanceBootstrap.run` 在实例启动时调用各服务的 `init()`，实例 dispose 时通过 `ScopedCache` 自动清理。

**Design 的图状态天然属于项目实例层**。当前实现把它做成了全局单例，这是所有后续问题的根因：多项目共享、无法按目录恢复、持久化路径和内存状态脱节。

## 三、为什么 SQLite 是一步到位的正确选择

第一版用 JSON/JSONL 是因为"简单"，但 JSON/JSONL 在 Design 场景下会迅速成为瓶颈：

1. **查询成本**。"找出所有和订单相关的边"、"某个上下文下的所有节点"、"两个节点之间是否有路径"——这些操作在 JSON 里需要全量加载 + 遍历，而 SQLite 可以用索引。
2. **并发与一致性**。事件日志追加和状态快照保存是两个独立文件，崩溃时容易不一致。SQLite 的事务可以保证 event append 和 state update 原子性。
3. **图规模**。设计图会增长。JSON 全量重写随着节点增多会越来越慢；SQLite 只更新变化的行。
4. **Extension 层需要查询**。P3 的 aggregate/conflict/cross-context-map 扩展需要基于图做计算，没有查询能力几乎无法落地。

Design 的状态不是简单的 key-value，而是关系型数据（nodes、edges、contexts、prototypes、events）。关系型数据库是正确抽象，JSON 只是偷懒。

## 四、Design 服务的正确形态

Design 服务应该由三个层次组成：

### Core 层

负责图的原子操作和不变量：

- `GraphEngine`：节点/边/上下文/原型的 CRUD，保证唯一边约束、上下文归属等。
- `WorkingSet`：当前对话的活跃视图，LRU 管理。
- `EventLog`：不可变变更历史，支持回滚。

Core 层不依赖任何具体关系原型的语义。这是对的，应该保持。

### Store 层

用 SQLite 替换当前的 JSON/JSONL 持久化：

- 每个项目目录一个 SQLite 文件，例如 `.opencode/design/design.sqlite`。
- 表结构：`nodes`、`edges`、`contexts`、`prototypes`、`events`。
- `DesignStore` 服务提供事务性读写，把 Core 的内存操作同步到数据库。

Store 层也不关心关系语义，只负责把 Core 的抽象持久化。

### Extension 层

依附于特定关系原型的可选逻辑：

- `aggregate` 原型处理器：生成聚合视图
- `cross-context-map` 处理器：跨上下文映射
- `conflict` 处理器：冲突检测

Extension 通过注册原型处理器介入生命周期，不是 Core 必需。这符合原设计。

## 五、工具与 Agent 的协作

当前 Design 工具的集成方向是对的，但有一个关键问题：**工具应该对 Design Agent 充分可用，对其他 Agent 按需可用**。

OpenCode 的工具过滤机制在 `LLMRequestPrep.resolveTools`：

```typescript
const disabled = Permission.disabled(
  Object.keys(input.tools),
  Permission.merge(input.agent.permission, input.permission ?? [])
)
```

所有工具先注册进 `ToolRegistry`，然后按 Agent 的 permission ruleset 过滤。所以 Design Agent 的 permission 里 `design_*: allow`、文件工具 `deny` 是正确的。

但 future 可能有场景：build agent 也需要读取 design 图（比如"按设计图实现代码"）。这时候不应该给 build agent 开 design 工具的创建权限，而是应该提供只读的 `design_query_*` 工具。权限系统可以精确到每个 tool name，所以这是自然扩展。

## 六、加载与恢复机制

Design 状态必须在实例启动时加载。流程应该是：

1. `InstanceStore.load(directory)` 被调用。
2. `InstanceBootstrap.run` 执行，依次调用各服务 `init()`。
3. `Design.Service.init()` 检查 `.opencode/design/design.sqlite`：
   - 存在：加载 nodes/edges/contexts 到内存，重建 working set。
   - 不存在：初始化空图，创建 schema。
4. 用户进入 Design Agent 后，图已经是当前项目的状态。
5. 每次 mutation 通过事务写入 SQLite。
6. 实例 dispose 时不需要特殊操作，因为已经实时持久化。

事件日志也不需要单独 append 到 JSONL，而是作为 SQLite 表的一部分，和状态同事务写入。

## 七、与 Plan/Build 的关系

长期愿景是 `Design → Plan → Edit → Feedback` 闭环。当前阶段不实现闭环，但要为闭环预留接口：

- Design 输出的是结构化图，不是文本计划。
- Plan agent 未来可以从 design 图生成实现计划（通过读取 design 状态）。
- Build agent 未来可以对比代码与设计图的偏差（Drift/Sync Agent）。

所以 Design 的状态存储必须是 queryable 的。JSON/JSONL 会让闭环几乎不可能实现，SQLite 是前置条件。

## 八、当前实现需要推翻的部分

1. **全局 Design 状态**：必须改成 per-instance。
2. **JSON/JSONL 持久化**：替换为 SQLite。
3. **手动 save/appendEvent**：改为事务性写入，或者让 mutation 直接操作 Store 层。
4. **AppLayer 里的 `Design.defaultLayer`**：需要重新设计。如果 Design 是 per-instance，它不应该在 `AppLayer` 顶层 merge，而应该通过 `InstanceState` 提供，或在 `InstanceBootstrap` 中初始化。
5. **测试里的手动 `Layer.provide(Design.defaultLayer)`**：per-instance 化后，测试应该像使用 `Agent.Service` 一样自然获得 Design 状态。

## 九、为什么不接受"P1 先跑通"

"先跑通"的代价是：

- 状态模型错误会拖累所有后续功能（恢复、多项目、Extension、闭环）。
- JSON/JSONL 到 SQLite 的迁移不是简单替换文件格式，而是重写 Store 层和事务逻辑。
- 现在一次性做对，比以后推翻重来成本低得多。

Design 是 OpenCode 的长期能力，不是一次性 demo。基座必须正确。
