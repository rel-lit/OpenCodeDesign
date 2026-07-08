# 项目现状分析

## 一、项目背景与定位

本仓库是 OpenCode 的 Windows 桌面 GUI 分支（`D:\RLDemos\OpenCodeDesign`），默认分支为 `dev`。它是一个基于 Effect/TypeScript 的 AI 编程助手客户端，核心包包括：

- `packages/opencode`：主程序（CLI + TUI + 会话核心）
- `packages/core`、`packages/client`、`packages/server`：服务端与协议层
- `packages/desktop`、`packages/app`：桌面 GUI 与前端
- `packages/sdk`、`packages/sdk-next`：对外 SDK
- `packages/schema`、`packages/protocol`：类型与 API 定义

当前开发重心在 **Design（设计图）子系统** —— 让 AI 子代理维护一份结构化的项目设计图，用于跨会话记忆、代码检索、变更规划。

## 二、最近完成的工作

过去两轮迭代集中在 **Design 工具补全与架构清理**：

| 提交 | 主题 | 关键内容 |
|---|---|---|
| `b22514f00` | 补全读工具与校验规则 | 新增 `design_get_relation`、`design_get_prototype`、`design_expand_node_focused`；修复 `design_withdraw_context`/`design_withdraw_relation`/`design_define_concept` 的边界校验。 |
| `d078a52b4` | 活跃工作集持久化 | 在 `design_working_set` 表保存 LRU 工作集；`Design` 启动加载、实例释放前保存。 |
| `d4820046c` | 保护快照保存 | 当 `InstanceRef` 不可用时跳过保存，避免测试崩溃。 |
| `c2b75ba8a` | 清理 Design 服务死代码 | 删除 `createNode`/`updateNode`/`createEdge`/`deleteEdge` 等直接变更包装方法；重写 `test/design/design.test.ts` 走 `DesignChangeBuffer`。 |

此外，更早还有 `6b20a12c1` 等提交将 GraphAgent 的图摘要注入 SearchAgent 提示词，实现按 context/concept 聚焦检索。

## 三、当前架构分析

### 3.1 设计图核心

```
GraphEngine          // 内存中的图：contexts / nodes / edges / prototypes
WorkingSet           // LRU 活跃工作集（按 node/context 访问热度排序）
EventLog             // 变更事件日志，用于版本同步与回滚
VersionSync          // chat-agent / visual-editor / design-graph 三端版本同步
TemporaryWorkingSet  // 子代理 session 级临时工作集
DesignChangeBuffer   // 批量变更缓冲区，提交时一次性 apply
DesignStore          // SQLite 持久化：graph state + event log + working set
```

### 3.2 写路径已统一

所有对图的变更现在只走 `DesignChangeBuffer`：

```
GraphAgent → bufferAddOperation → DesignChangeBuffer → bufferApply → graph.* + persistMutation
```

`Design` 服务层不再暴露 `createNode`/`updateNode`/`createEdge` 等直接方法，避免多入口导致状态不一致。

### 3.3 活跃工作集持久化

- **加载**：`Design` 初始化时从 `store.loadWorkingSet()` 读取快照，注入 `WorkingSet`。
- **保存**：实例 `scope` finalizer 或 `InstanceStore.disposeDirectory` 前触发 `saveWorkingSetIfPossible()`。
- **中间更新**：`bufferApply` 在每次变更后调用 `touchNode`/`touchContext`/`forgetNode`/`forgetContext`，保持内存中的工作集实时准确。
- **设计选择**：采用"退出快照"而非"每次 touch 写库"，降低 IO 与实现耦合。

## 四、关键决策评估

### 4.1 删除直接变更包装方法

**优点**：
- 单一入口，避免绕过 `DesignChangeBuffer` 产生的版本不同步。
- 测试被迫使用与生产一致的 buffer 路径，覆盖度更真实。

**风险**：
- 如果未来其他模块需要临时直接改图，必须重新设计入口；目前没有这类需求。
- 外部插件或脚本若曾依赖这些旧 API，会失效。但 `Design` 是内部服务，插件不直接调用。

### 4.2 工作集快照持久化

**优点**：
- 实现轻量，不污染 `WorkingSet` 内部逻辑。
- 跨重启后用户仍能看到最近关注的设计实体，对长周期项目友好。

**风险**：
- 仅在工作目录关闭时保存，若进程异常退出会丢失当前 session 的 working set 更新。
- 快照条目对应的实体若后续被删除，会保留"指向已删除实体"的 entry，直到被自然淘汰或访问时验证。

### 4.3 `design_get_relation` 使用 `left`/`right`

与 `design_relate_concepts`/`design_withdraw_relation` 参数保持一致，避免源/目标方向性歧义。底层 edge 是无向的，工具输出统一格式为 `A --[prototype]-- B`。

## 五、现状健康度

| 维度 | 状态 | 说明 |
|---|---|---|
| 类型检查 | 通过 | `bun turbo typecheck` 29/29 成功，最近一次 push 由钩子触发。 |
| 相关测试 | 通过 | `test/design/design.test.ts`、`test/tool/graph-agent-design.test.ts`、`test/tool/search-agent.test.ts` 均通过。 |
| 功能完整度 | 高 | GraphAgent 读工具集已完整；写工具校验已覆盖常见边界。 |
| 代码一致性 | 高 | 规格文档、实现、测试三者参数一致。 |
| 持久化 | 可用 | 工作集快照持久化已落地，但异常退出保护较弱。 |
| 死代码 | 已清理 | `Design` 直接变更包装方法已删除。 |

## 六、仍存在的风险与建议

1. **工作集异常退出保护**
   - 当前只在实例释放/scope finalizer 保存。若进程崩溃，当前 session 的 working set 更新丢失。
   - 建议：后续可考虑低频率的 debounce 保存（例如每 30 秒或 working set 重大变化时），但需评估 IO 成本。

2. **已删除实体的残留 entry**
   - `WorkingSet` 加载时不会验证 entry 对应的 node/context 是否存在；使用时会因懒加载自然发现失效，但列表展示可能包含脏 entry。
   - 建议：在 `saveWorkingSet` 或 `WorkingSet.list()` 时过滤掉已删除实体的 entry。

3. **读工具基于持久化图**
   - 规格明确所有读工具只反映已持久化图，不反映 buffer 中待提交内容。这对 GraphAgent 子代理是合理约束，但用户可能困惑。
   - 建议：确保 `design_get_*` 工具的返回描述中明确说明"不包含未提交的 buffer 变更"。

4. **测试覆盖范围**
   - 已覆盖正常路径与常见边界；但以下场景仍可补充：
     - 工作集在异常退出后恢复的预期行为。
     - 多个并发子代理对同一 `Design` 实例的工作集竞争。
     - 大规模图下的 `design_expand_node_focused` 性能。

5. **变更缓冲区的 UX 风险**
   - `bufferApply` 是原子批量提交，一旦 apply 即持久化。如果未来引入部分失败回滚，需要确保 `graph` 的变更与 `persistMutation` 在同一个事务内。
   - 当前 `persistMutation` 使用 `store.transaction`，符合要求，但需保持。

6. **GraphAgent 与 SearchAgent 的摘要注入链路**
   - 当前 SearchAgent 已能接收 GraphAgent 摘要，但需要保证 `graph_summary` 过大时不超限 token。
   - 建议：监控长项目中的摘要长度，必要时引入分层摘要或聚焦裁剪。

## 七、下一步建议

优先级从高到低：

1. **过滤工作集残留 entry**：在 `saveWorkingSet` 前只保留仍存在的 node/context entry，避免持久化脏数据。
2. **补充异常退出/恢复测试**：明确并验证进程崩溃后的工作集恢复语义。
3. **评估工作集 debounce 持久化**：在 IO 可接受范围内，增加低频率自动保存。
4. **监控 SearchAgent 摘要 token**：长项目下确保摘要注入不过载上下文。
5. **整理剩余规格文档**：继续把 `design-tools-behavior.md` 中未实现或未验证的部分（如审批工具）标记清楚。

## 八、总结

Design 子系统已从"功能补齐"阶段进入"架构收敛"阶段：工具集完整、写路径统一、持久化落地、死代码清理。主要风险在于工作集持久化的异常退出保护，以及长期运行下的数据卫生（残留 entry、摘要长度）。建议在下一步小迭代中处理工作集过滤与异常恢复测试，之后再考虑更复杂的实时保存策略。
