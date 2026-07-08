# OpenCode（上游） vs. OpenCodeDesign（本项目）区别说明

## 一、关系定位

**OpenCodeDesign** 是 **OpenCode** 上游项目的**衍生 fork（魔改）**，不是简单的 superset/subset，而是：

- **保留了上游大部分核心引擎**（Session V2、Effect 运行时、LLM 层、Tool/Agent 框架、Desktop 壳等）。
- **删除了**上游的 `codemode` 包以及上游 `specs/` 目录。
- **新增了一个原生的 Design（设计图）子系统**和围绕它工作的多代理工作流。
- **将目标平台从跨平台 CLI/TUI/Desktop 收窄到 Windows x64 桌面 GUI。**

用一句话概括：**OpenCode 是通用 AI 编程助手；OpenCodeDesign 是在其引擎基础上，专门做一个带“设计图”模式、用于管理项目语义知识的 Windows 桌面 AI 工具。**

---

## 二、共同继承的骨架

| 领域 | 说明 |
|---|---|
| 包结构 | 两者 packages/ 下绝大部分包一致：`core`、`opencode`、`server`、`client`、`schema`、`protocol`、`llm`、`desktop`、`app`、`tui`、`plugin`、`sdk`、`sdk-next` 等。 |
| Session V2 | `packages/core/src/session/` 与 `packages/opencode/src/session/` 目录内容基本相同，提示准入、SessionExecution、SessionRunner、Location 等概念一致。 |
| 工具/Agent 框架 | Schema-first tool、ToolRegistry、权限系统、子代理 `task` 工具、内置 Agent 机制等完全一致。 |
| LLM 层 | `packages/llm` 的 Route/Protocol/Provider 抽象、AI SDK 默认路径、Native runtime 实验路径均继承。 |
| Desktop / App | Electron 主进程 + SolidJS renderer 的 sidecar 架构相同。 |
| 构建栈 | Bun workspace + Effect + tsgo + electron-builder + Bun.build 编译单文件 CLI。 |

---

## 三、OpenCodeDesign 新增的核心内容

### 3.1 Design（设计图）子系统

这是本项目最大的新增模块，全部位于 `packages/opencode/src/design/`：

| 组件 | 文件 | 作用 |
|---|---|---|
| `Design.Service` | `src/design/design.ts` | 设计图子系统门面，per-directory 状态 |
| `GraphEngine` | `src/design/core/graph.ts` | 内存语义图：contexts、nodes、edges、prototypes |
| `WorkingSet` | `src/design/core/working-set.ts` | LRU 活跃工作集，跨实例持久化 |
| `TemporaryWorkingSet` | `src/design/system/temporary-working-set.ts` | 子代理 session 临时工作集 |
| `EventLog` | `src/design/core/event-log.ts` | 设计图变更事件日志 |
| `VersionSync` | `src/design/system/version-sync.ts` | chat-agent / visual-editor / graph-agent 三端同步 |
| `DesignChangeBuffer` | `src/design/system/design-change-buffer.ts` | 批量设计变更缓冲区，原子提交 |
| `DesignStore` | `src/design/store/store.ts` | SQLite 持久化：graph state、event log、working set |
| `GraphAgent` / `SearchAgent` | `src/design/agent/` | 设计图专用子代理 |

### 3.2 Design 专用 Agent / 子代理

| 代理 | 上游 | 本项目 | 说明 |
|---|---|---|---|
| `design` 主代理 | 无 | 有 | 用户可在 GUI 中选择 design 模式 |
| `design-graph` 子代理 | 无 | 有 | 分析设计图、提出变更计划、审查 |
| `design-search` 子代理 | 无 | 有 | 结合项目代码/网络检索与设计图摘要比对 |

### 3.3 Design 工具集

`packages/opencode/src/tool/design.ts` 中新增工具：

- 读工具：`design_get_context`、`design_get_concept`、`design_get_relation`、`design_get_prototype`、`design_expand_node`、`design_expand_node_focused`、`design_search_graph`、`design_list_prototypes`、`design_get_state_summary`、`design_get_temporary_working_set`。
- 写工具：`design_define_concept`、`design_define_context`、`design_relate_concepts`、`design_withdraw_context`、`design_withdraw_relation`、`design_update_concept`、`design_update_context` 等。
- 缓冲区/审批工具：`design_request_approval`、`design_finalize_change`、`design_undo_last_change`、`design_clear_change_buffer`。
- Chat 入口：`design_ask_graph`、`design_request_change`、`design_summarize_design`、`design_search_project`、`design_search_web`。

### 3.4 Design 专用 UI 组件

`packages/app/src/` 中新增：

- `session-design-approval-dock.tsx`：设计变更审批面板。
- `session-new-design-view.tsx`：设计图视图入口。

### 3.5 Design 文档规格

`docs/specs/` 中新增设计相关规格：

- `2026-06-29-design-mode-design.md`
- `2026-07-01-design-multi-agent-architecture.md`
- `2026-07-04-design-visual-editor-sync-design.md`
- `2026-07-06-design-tools-behavior.md`
- `graph-agent-working-set.md`
- 等

---

## 四、OpenCodeDesign 删除/收窄的内容

| 项目 | 上游 | 本项目 | 说明 |
|---|---|---|---|
| `packages/codemode` | 有 | 无 | 上游的 codemode 包被移除 |
| `specs/` 目录 | 有（上游规格） | 无 | 改为 `docs/specs/`，且内容偏向 Design |
| 目标平台 | 跨平台：macOS/Windows/Linux CLI + TUI + Desktop | 仅 Windows x64 Desktop GUI | `AGENTS.md` 明确约束 |
| `@opentui` / `turbo` 版本 | 较新 | 较旧 | 本项目锁定在 `0.3.4` / `2.8.13` |

---

## 五、核心差异总结

```
OpenCode（上游）
  = 通用 AI 编程助手
  + 跨平台 CLI/TUI/Desktop
  + build / plan / general 等 Agent
  + 完整插件/MCP/工具生态
  - 无设计图语义模型
  - 无 design-graph / design-search 子代理

OpenCodeDesign（本项目）
  = OpenCode 引擎 + Design 子系统
  + 原生设计图（context / concept / relation / prototype）
  + design-graph 子代理（维护设计图）
  + design-search 子代理（用设计图指导代码检索）
  + 两阶段设计变更审批 UI
  + 工作集持久化
  - 仅 Windows x64 Desktop
  - 移除了 codemode
```

---

## 六、为什么要做这个 fork

从规格文档和实现来看，OpenCodeDesign 的核心假设是：

> 在复杂、长周期的软件项目中，仅靠对话历史无法维持一致的领域知识。需要一个**结构化的、可持久化的、可被子代理共享的语义设计图**。

因此：

1. **设计图**作为项目知识的单一事实来源（single source of truth）。
2. **GraphAgent** 负责维护设计图的正确性与完整性。
3. **SearchAgent** 用设计图指导代码检索，回答“代码是否实现了设计”的问题。
4. **审批面板**让用户对设计变更保持最终控制权。

---

## 七、代码层面如何快速区分

如果你拿到一份代码，想知道它是上游还是 OpenCodeDesign，可以检查这几个特征：

| 检查项 | 上游 OpenCode | OpenCodeDesign |
|---|---|---|
| `packages/opencode/src/design/` 目录 | 不存在 | 存在 |
| `packages/codemode` | 存在 | 不存在 |
| `docs/specs/` 下有大量 `design-*.md` | 无 | 有 |
| `src/tool/design.ts` 有 `design_ask_graph` 等工具 | 无 | 有 |
| `AGENTS.md` 开头有 **Environment Constraints** | 无 | 有 |
| `README.md` 强调 Windows x64 设计模式 | 无 | 有 |

---

## 八、审批视角：OpenCodeDesign 的战略价值与风险

### 8.1 战略价值

- **差异化明显**：在通用 AI 编程助手同质化严重的背景下，Design 模式是一个清晰的差异化方向。
- **复用上游成熟引擎**：不需要从零做 Session、Tool、LLM，Focus 在 Design 本身。
- **多代理协作模型**：GraphAgent + SearchAgent + Design 主代理形成完整闭环，具备产品故事。

### 8.2 风险

- **平台收窄**：仅 Windows x64 Desktop 限制用户基数，且与上游跨平台方向渐行渐远。
- **维护成本**：每次上游升级都需要处理 Design 子系统的合并冲突。
- **实现深度**：Design 可视化编辑器、系统分析区、两阶段审批端到端仍未完成。
- **价值验证**：设计图对普通用户的价值仍需验证，可能过于工程师导向。

---

## 九、结论

OpenCodeDesign 是 **OpenCode 上游的一个专业化 Windows 桌面 fork**，它不是在做另一个通用 AI 编程助手，而是在做：

> **一个带有可持久化语义设计图、专门用于长周期软件项目知识管理的 AI 协作工具。**

理解这一点，就能理解为什么本项目大量工作集中在 `packages/opencode/src/design/`、为什么新增 `design-graph`/`design-search` 子代理、为什么目标平台收窄到 Windows x64 Desktop。
