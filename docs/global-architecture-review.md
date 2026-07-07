# OpenCode 全局架构审批与分析

## 一、执行摘要

本报告对 `D:\RLDemos\OpenCodeDesign` 仓库进行全局架构审批。该仓库是一个基于 **Bun + Effect + TypeScript** 的 AI 编程助手客户端，采用 monorepo 结构，当前主要目标平台为 **Windows x64 桌面 GUI**（Electron + SolidJS），默认分支为 `dev`。

总体判断：**架构方向正确，分层清晰，Effect 作为运行时抽象贯穿全栈，核心模块之间的依赖方向得到较好控制。但 Session V2、Design 可视化、Native LLM runtime、集群执行等关键子系统仍处于部分实现或早期阶段，存在较多 TODO 与规格/实现缺口。**

---

## 二、包拓扑与依赖架构

### 2.1 包结构

| 包 | 路径 | 角色 | 审批意见 |
|---|---|---|---|
| `opencode` | `packages/opencode` | 主应用：CLI、TUI、无头服务、Agent、Tool、Design 子系统、会话编排 | 核心应用包，功能密集，合理 |
| `core` | `packages/core` | 共享运行时：持久化会话、事件、数据库、文件系统、PTY、系统上下文、工具注册表、V2 schema | 基础设施定位清晰 |
| `server` | `packages/server` | 公共 HTTP API / `HttpApi` 处理器、路由、中间件 | 基于 `effect/unstable/http` + `protocol` |
| `client` | `packages/client` | 从公共 API 生成的 SDK（Promise + Effect） | 仅依赖 `schema` + `protocol`，符合约束 |
| `schema` | `packages/schema` | 公共/存储契约的 Effect Schema | 浏览器安全，无运行时 |
| `protocol` | `packages/protocol` | 端点构造、中间件放置、公共 API 形状 | 承上启下 |
| `llm` | `packages/llm` | Effect-native LLM 层：协议、路由、Provider 外观、通用事件、工具分发 | 抽象良好 |
| `sdk` | `packages/sdk/js` | 旧版 JS/Promise SDK | 保留兼容，逐步迁移 |
| `sdk-next` | `packages/sdk-next` | 下一代嵌入式 SDK（进程内 host + Effect client） | 组合 `client`/`core`/`server`，方向正确 |
| `desktop` | `packages/desktop` | Electron 主进程与打包 | Windows x64 目标 |
| `app` | `packages/app` | SolidJS 渲染器，可作 Web App | 依赖 `core`/`sdk`/`session-ui`/`ui` |
| `tui` | `packages/tui` | 终端 UI | 由 `opencode` CLI 无参数时启动 |
| `session-ui` | `packages/session-ui` | 共享会话组件（消息渲染、diff、markdown） | 前后端 UI 复用 |
| `ui` | `packages/ui` | UI 原子组件与图标 | 设计系统基础 |
| `plugin` | `packages/plugin` | 插件 API 与钩子 | 外部插件契约 |
| `cli` | `packages/cli` | 独立的 `lildax` CLI 二进制 | 非主 `opencode` CLI |
| `effect-drizzle-sqlite` / `effect-sqlite-node` | 对应路径 | Effect 封装的 SQLite 基础设施 | 底层依赖合理 |

### 2.2 依赖方向控制

架构文档（`AGENTS.md`）明确规定：

- `schema → core / protocol → server`
- `client` 只能依赖 `schema` + `protocol`
- `sdk-next` 组合 `client` + `core` + `server`
- 运行时依赖从 Schema 流向 Core/Protocol，再到 Server

**分析**：该方向符合"领域模型/契约向内，运行时向外"的洋葱模型。`client` 不依赖 `core` 或 `server` 避免了浏览器端引入 Node 运行时。`sdk-next` 作为嵌入式宿主，组合三者是有意为之，属于明确边界例外。

**关注点**：需要持续运行依赖检查（如 `dependency-cruiser` 或自定义脚本），防止 `client` 或 `schema` 被反向污染。

---

## 三、入口点与主运行时循环

### 3.1 入口点

| 入口 | 文件 | 说明 |
|---|---|---|
| Desktop | `packages/desktop/src/main/index.ts` | Electron 主进程，启动本地 sidecar server，加载 renderer |
| Renderer | `packages/app/src/entry.tsx` | SolidJS Vite 应用，生产时加载嵌入 bundle |
| CLI | `packages/opencode/src/index.ts` | yargs 分发 `run`/`serve`/`tui`/`models`/`mcp` 等命令 |
| TUI | `packages/tui/src/index.tsx` | 通过 Worker 启动 server，主线程运行 TUI |
| Server | `packages/opencode/src/server/server.ts` | 无头服务入口，被 `serve`、desktop、TUI worker 复用 |

### 3.2 主循环

`opencode` 的核心是 **V2 Session 运行时循环**：

```
SessionV2.prompt(...) → SessionInput.admit() → SessionExecution.wake(sessionID)
   → SessionRunCoordinator（按 Session ID 串行，跨 Session 并发）
   → SessionRunner（一次 drain）
      → 初始化 System Context
      → 解析模型
      → 构建一次 LLM 请求
      → 流式调用 provider
      →  settlement 工具调用
      → 评估是否继续下一个 provider turn
```

**分析**：该模型将"提示准入"与"模型执行"解耦，提示先写 durable row，再异步唤醒执行，适合长会话、中断恢复、多 session 并发。这是相比传统"prompt → loop"架构的显著进步。

**关注点**：
- `SessionExecution` 当前为 **process-local**，集群化尚未实现。
- `SessionRunner` 内部仍有大量 TODO，包括 durable status、bounded retries、interruption settlement、compaction 等。
- 一次 drain 内必须保持"一次显式 `llm.stream(request)` 调用"，这是当前重点约束，但实现复杂度较高。

---

## 四、AI / LLM 架构

### 4.1 Provider 抽象

`packages/llm` 定义了清晰的协议栈：

```
Protocol  →  Endpoint  →  Auth  →  Framing (SSE)  →  Transport (HTTP/WS)
```

- `Route<Body, Prepared>` 是可组合的 LLM 路由抽象。
- Provider facades 如 `OpenAI.configure(...).responses("gpt-4o")` 提供声明式接入。
- 事件统一为 `LLMEvent`：text/reasoning/tool/finish/error 等。

### 4.2 运行时双轨

当前存在两条 LLM 运行时路径：

1. **AI SDK 默认路径**（`packages/opencode/src/session/llm/ai-sdk.ts`）
   - 使用 `ai` 包的 `streamText`。
   - 成熟、兼容 provider 多。
   - 但将 provider 细节隐藏在第三方库中。

2. **Native 实验路径**（`packages/opencode/src/session/llm/native-runtime.ts`）
   - 将 session 数据下降为 `LLMRequest`。
   - 通过 `LLMClient` 直接走 `LLM.route` 协议。
   - 目前仅支持 OpenAI、OpenAI-compatible、Anthropic API-key。

**分析**：双轨策略是合理的迁移路径——AI SDK 保证可用性，Native runtime 逐步夺回协议控制权。但两条路径并存增加了测试矩阵和事件语义一致性负担。

**关注点**：
- Native runtime 的 OAuth、工具调用、结构化输出支持尚不完整。
- 事件从 provider-native 到 `LLMEvent` 的映射在两条路径中需要保持一致，否则 UI 行为会不一致。
- 模型解析在 `packages/opencode/src/provider/provider.ts` 中，但 `AGENTS.md` 提示此处存在 provider-specific 逻辑侵入，需要进一步清理。

---

## 五、会话系统架构（V2 与 Legacy）

### 5.1 V2 核心组件

| 组件 | 文件 | 职责 |
|---|---|---|
| `SessionV2` | `packages/core/src/session/index.ts` | 公共 API |
| `SessionInput` | `packages/core/src/session/input.ts` | durable 提示准入、steer/queue 语义、promotion |
| `SessionExecution` | `packages/core/src/session/execution.ts` | 进程全局调度 |
| `SessionExecutionLocal` | `packages/core/src/session/execution/local.ts` | 本地 placement 发现 |
| `SessionRunCoordinator` | `packages/core/src/session/run-coordinator.ts` | 同 Session 串行、跨 Session 并发 |
| `SessionRunner` | `packages/core/src/session/runner/llm.ts` | 一次 drain 执行 |
| `SessionStore` | `packages/core/src/session/store.ts` | durable 读写 |

### 5.2 关键设计决策

- **提示准入（admit）与执行（wake）分离**：prompt 先持久化，再调度。
- **steer vs queue**：steer 在下一个安全边界提升为可见消息；queue 在会话空闲时提升。
- **Location-scoped**：会话绑定到目录，可选 `workspaceID`，未指定即本地隐式放置。
- **Session ID 复用**：复用 Session ID 即采用已有会话；复用 prompt message ID 在 Session+prompt+delivery 模式匹配时视为精确重试。
- **EventV2 与 replay**：EventV2 重播与集群执行所有权分离。

### 5.3 Legacy 会话

`SessionV1` 仍用于 UI/TUI 兼容，通过 `EventV2Bridge` 桥接。这增加了维护成本，但在迁移期是必要的。

**分析**：V2 架构理论上能支持长期运行、可中断、可恢复的智能体会话。然而实现深度不足：大量 TODO 集中在 `SessionRunner`（状态持久化、重试边界、插件集成、compaction、输出事件等）。

**关注点**：
- V2 是 process-local，崩溃后 durable continuation 没有设计。
- Legacy 桥接层的正确性需要持续验证，否则 UI 可能看到 stale 或丢失事件。
- 需要明确 V1 完全废弃的时间表，否则双会话系统会长期拖累演进。

---

## 六、工具与 Agent 架构

### 6.1 工具定义

`packages/opencode/src/tool/tool.ts` 定义了标准工具形状：

```ts
Tool.define(id, init) → { description, parameters, execute(args, ctx) }
```

- 参数使用 Effect `Schema` 严格校验。
- `Tool.Context` 提供 sessionID、messageID、callID、abort、agent、历史消息、`ask`/`metadata` 回调。
- 结果截断由 `Truncate`（`packages/opencode/src/tool/truncate.ts`）控制。

### 6.2 工具注册表

`packages/opencode/src/tool/registry.ts` 组装：

- 内置工具（shell/read/glob/grep/edit/write/task/todo/webfetch/websearch/skill/apply_patch/question/lsp/plan/design 等）
- 配置文件 `{tool,tools}/*.{js,ts}` 自定义工具
- 插件工具
- MCP 工具

工具按当前 agent/model 过滤，提供当前 provider turn 的可用列表。

### 6.3 Agent 与子代理

- Agent 配置在 `packages/opencode/src/agent/agent.ts`。
- 模式：`primary`（主代理）、`subagent`（子代理）、`all`。
- 内置主代理：`build`、`plan`、`design`、`compaction`、`title`、`summary`。
- 内置子代理：`design-graph`、`design-search`、`general`、`explore`。
- 子代理权限派生：`packages/opencode/src/agent/subagent-permissions.ts`。
- 子代理通过 `task` 工具（`packages/opencode/src/tool/task.ts`）生成子会话。

### 6.4 权限系统

`packages/opencode/src/permission/index.ts` 提供规则匹配：`allow` / `ask` / `deny`。`ask` 会发布事件并等待用户回复。

**分析**：工具/Agent 架构是 OpenCode 的核心竞争力之一。Schema-first 工具定义、Context 注入、权限拦截、子代理派生都符合现代 Agent 平台设计。`task` 工具将子代理实现为子会话，天然获得隔离与审计。

**关注点**：
- 工具注册表越来越大，需要关注启动时加载性能与插件工具冲突。
- 权限规则是顺序匹配，规则顺序错误可能导致安全漏洞，需要更清晰的规则可视化。
- MCP 工具动态注入，可能带入未经审计的权限，需要 MCP 工具的默认权限策略。

---

## 七、Design 子系统架构（重点审查）

### 7.1 核心组件

| 组件 | 文件 | 职责 | 状态 |
|---|---|---|---|
| `Design.Service` | `src/design/design.ts` | 子系统门面，per-directory 状态 | 已落地 |
| `GraphEngine` | `src/design/core/graph.ts` | 内存图 | 已落地 |
| `WorkingSet` | `src/design/core/working-set.ts` | LRU 活跃工作集 | 已落地 + 持久化 |
| `TemporaryWorkingSet` | `src/design/system/temporary-working-set.ts` | 子代理 session 临时工作集 | 已落地 |
| `EventLog` | `src/design/core/event-log.ts` | 变更事件日志 | 已落地 |
| `VersionSync` | `src/design/system/version-sync.ts` | 三端版本同步 | 已落地 |
| `DesignChangeBuffer` | `src/design/system/design-change-buffer.ts` | 批量变更缓冲区 | 已落地 |
| `DesignStore` | `src/design/store/store.ts` | SQLite 持久化 | 已落地 |
| `GraphAgent` / `SearchAgent` | `src/design/agent/` | 设计图子代理 | 已落地 |

### 7.2 已完成功能（近期）

- GraphAgent 完整读工具集：`design_get_context`、`design_get_concept`、`design_get_relation`、`design_get_prototype`、`design_expand_node`、`design_expand_node_focused`、`design_search_graph`、`design_list_prototypes`、`design_get_state_summary`、`design_get_temporary_working_set`。
- 写工具校验增强：`design_withdraw_context` 检查子 concept、`design_withdraw_relation` 边缺失警告、`design_define_concept` 重名检查。
- 统一写路径：所有变更通过 `DesignChangeBuffer` 原子提交，直接变更包装方法已删除。
- 活跃工作集持久化：`design_working_set` 表 + 实例释放快照。
- SearchAgent 摘要注入：GraphAgent 生成图摘要，按 context/concept 聚焦后注入 SearchAgent 提示词。

### 7.3 架构模式评估

**写路径统一**：`DesignChangeBuffer` 作为唯一变更入口，是正确的设计。它保证了批量原子性、版本同步、事件日志一致性。删除 `Design` 层上的直接包装方法进一步强化了这一约束。

**工作集持久化**：采用"退出快照"模式，避免每次 `touch` 写库。权衡了实时性与 IO 成本，对桌面场景合理。但异常退出会丢失当前 session 的工作集更新。

**分层信息披露**：读工具区分发现类（返回概要并加入临时工作集）与单个 get（返回完整内容），避免 GraphAgent 被内部 ID 淹没。这是务实的 LLM 工具设计。

**版本同步**：`VersionSync` 通过 event log 检测 chat-agent 与 visual-editor 的 stale，防止不同 UI 覆盖设计图。但 visual editor UI 本身尚未实现。

### 7.4 设计子系统的缺口

| 缺口 | 说明 | 风险 |
|---|---|---|
| 可视化编辑器 | 规格存在，UI 未实现 | 设计图只能由子代理维护，用户无法直接编辑 |
| 系统分析区 | 冲突检测、重复候选、孤立节点、原型误用 | 子代理无法自检设计图健康度 |
| `@` 引用展开 | 规格存在，未实现 | 影响工具输入的便利性 |
| 审批两阶段 | 工具存在，端到端 UX 未定型 | 设计变更的用户控制点不完整 |
| 工作集异常退出 | 仅实例释放保存 | 崩溃丢失 session 级 working set 更新 |
| 残留 entry | 工作集可能包含已删除实体的 entry | 脏数据可能展示给用户 |

---

## 八、持久化与状态管理

### 8.1 SQLite 与 Drizzle

- 使用 `@effect/sql-sqlite-bun` + `effect-drizzle-sqlite`。
- PRAGMA：WAL、`synchronous=NORMAL`、`busy_timeout=5000`、`foreign_keys=ON`。
- 迁移由 `core` 在首次连接时应用，schema 定义在 `packages/core/src/**/*.sql.ts`。

### 8.2 持久化范围

- **全局 DB**（`~/.config/opencode/opencode.db`）：sessions、messages、parts、session_input、event store、event sequences、projects、credentials、permissions、PTY tickets。
- **项目级 DB**（`.opencode/design/design.sqlite`）：design graph state、event log、working set。
- **项目级文件**：`.opencode/plans/*.md`。
- **配置**：`~/.config/opencode/opencode.json` + 项目级 `opencode.json`。

### 8.3 状态管理

- **Effect Context Service**：几乎所有服务都是 Effect `Context.Service` + `Layer`。
- **InstanceState**：`ScopedCache` 按 `directory` 缓存 per-directory 状态，自动清理。
- **InstanceRef**：`Context.Reference` 持有当前 `InstanceContext`（directory、project、worktree）。
- **InstanceRegistry**：`registerDisposer` / `registerBeforeDisposer` 管理 per-directory 资源释放。
- **Lifecycle**：`Effect.addFinalizer` 处理清理；`Effect.forkScoped` 处理后台流。

**分析**：`InstanceState` + `ScopedCache` 是桌面多项目场景的关键抽象。它避免了手动管理生命周期，也防止了不同目录之间的状态泄漏。`Design` 工作集快照在 finalizer 中保存，正是该机制的应用。

**关注点**：
- `InstanceRef` 在 finalizer 中可能不可用，已有 `saveWorkingSetIfPossible` 保护，但类似问题可能在其他服务 finalizer 中出现。
- 全局 DB 与项目级 DB 的分离是合理的，但跨 DB 一致性（如 session 引用 design graph）需要小心处理。
- SQLite WAL 在 Windows 桌面环境下需要确保文件锁正确释放，否则崩溃后可能留下 `-wal` 文件。

---

## 九、配置、插件与 MCP

### 9.1 配置

- `packages/opencode/src/config/config.ts`：配置解析。
- 候选文件：`~/.config/opencode/opencode.jsonc`、项目级 `opencode.json`/`opencode.jsonc`、旧版 TOML 迁移。
- 支持变量替换、远程配置 URL、JSONC。
- Schema：`ConfigV1.Info`（`packages/core/src/v1/config/config.ts`）。

### 9.2 Agent / 子代理 / Skill

- Agent 配置合并内置与自定义（`packages/opencode/src/agent/agent.ts`）。
- Skill 从 `skills/**/SKILL.md`、`.claude/skills`、`.agents/skills` 和远程 URL 发现（`packages/opencode/src/skill/index.ts`）。
- 子代理通过 `task` 工具派生。

### 9.3 插件

- `packages/plugin/src/`：插件 API。
- `packages/opencode/src/plugin/index.ts`：加载内置 auth 插件与外部插件。
- 插件获得生成的 `OpencodeClient`、project、worktree、directory、hooks。
- Hooks：`tool.execute.before/after`、`config`、`event`、`dispose` 等。

### 9.4 MCP

- `packages/opencode/src/mcp/index.ts`：MCP 支持。
- 支持 `stdio`、`remote`（StreamableHTTP/SSE）、OAuth。
- MCP 工具注册到工具注册表；MCP resources 通过 `list_mcp_resources` 等工具暴露。

**分析**：配置、插件、MCP 三位一体，使 OpenCode 具备可扩展性。但 MCP 工具与外部插件工具的默认权限、审计、错误隔离需要更明确的设计。当前 MCP 工具直接进入 tool registry，可能带来未经审查的副作用。

---

## 十、构建与分发

### 10.1 CLI 构建

- `packages/opencode/script/build.ts`：使用 `Bun.build({ compile: { ... } })` 生成单文件二进制。
- `--single`：仅当前平台/架构（Windows x64）。
- 输出：`packages/opencode/dist/opencode-windows-x64/bin/opencode.exe`。
- 其他选项：`--baseline`、`--skip-install`、`--sourcemaps`、`--skip-embed-web-ui`。

### 10.2 Desktop 构建

- `packages/desktop`：使用 `electron-vite` + `electron-builder`。
- 配置 `electron-builder.config.ts`：dev/beta/prod 通道。
- 目标：Windows NSIS，配置中也包含 macOS/Linux。
- Desktop 通过 sidecar 启动本地 OpenCode server，renderer 通过 preload IPC 通信。

### 10.3 测试

- 单元/集成：**Bun test**。
- 浏览器/E2E：**Playwright**（`packages/app`）。
- 类型检查：**tsgo**（`tsgo --noEmit`），从包目录运行，禁止直接 `tsc`。
- 根 `package.json` 阻止从根运行测试： `"test": "echo 'do not run tests from root' && exit 1"`。

**分析**：构建流程对 Windows 桌面场景高度定制。`Bun.build` 单文件编译简化了 CLI 分发，Desktop 的 sidecar 模式将前后端解耦。测试策略合理，但类型检查使用 `tsgo` 是项目特定选择，需要确保所有开发者环境一致。

**关注点**：
- 当前平台单一聚焦（Windows x64），但 `electron-builder` 配置仍包含 macOS/Linux，需要维护是否仍支持。
- `tsgo` 不是标准 TypeScript 工具，新贡献者可能不熟悉，需要文档支持。
- 根目录禁止运行测试是强约束，CI 必须配置为从各包目录运行。

---

## 十一、已做之事总结

### 11.1 近期 Design 工作（最近 30 个提交中的核心）

1. **统一变更缓冲区**：`DesignChangeBuffer` 替代 `ChangeAccumulator`，`bufferApply` 原子提交。
2. **工具行为规格**：`docs/specs/2026-07-06-design-tools-behavior.md` 成为实现基准。
3. **GraphAgent 读工具补全**：三个缺失读工具 + 校验规则修复。
4. **工作集持久化**：跨实例重启保留活跃工作集。
5. **SearchAgent 摘要注入**：GraphAgent 摘要按聚焦范围注入 SearchAgent 提示词。
6. **代码清理**：删除 `Design` 直接变更包装方法，统一测试路径。

### 11.2 更早的架构奠基

- V2 Session 架构设计与实现（核心已在 `packages/core`）。
- Effect 全栈迁移与 `InstanceState`/`InstanceRef` 机制。
- `llm` 包与 Native runtime 实验。
- Plugin/MCP/配置系统。
- Desktop Electron 架构与 sidecar server。

---

## 十二、架构审批结论

### 12.1 审批通过的部分

| 领域 | 审批意见 | 理由 |
|---|---|---|
| 包边界与依赖方向 | 通过 | 洋葱模型清晰，`client` 与 `sdk-next` 边界明确 |
| Effect 全栈采用 | 通过 | 服务生命周期、错误处理、并发控制得到统一 |
| InstanceState / ScopedCache | 通过 | 桌面多项目状态的正确抽象 |
| V2 Session 设计 | 通过 | 提示准入与执行解耦，支持长期会话与中断 |
| Tool/Agent 架构 | 通过 | Schema-first、子代理隔离、权限拦截完整 |
| Design 子系统方向 | 通过 | 分层信息披露、统一写路径、版本同步是正确选择 |
| 构建与测试策略 | 通过 | 单文件编译、包目录测试、tsgo 类型检查符合项目规模 |

### 12.2 有条件通过 / 需要改进的部分

| 领域 | 状态 | 关键问题 |
|---|---|---|
| Session V2 实现深度 | 有条件通过 | 大量 TODO 集中在 runner，尚未达到生产级鲁棒性 |
| Native LLM runtime | 有条件通过 | 仅支持有限 provider，OAuth/工具/结构化输出不完整 |
| Design 可视化 | 不通过 | 规格存在但 UI 未实现，用户无法直接编辑设计图 |
| 工作集持久化 | 有条件通过 | 异常退出保护弱，残留 entry 未过滤 |
| 集群/分布式执行 | 不通过 | 尚未设计，仅 process-local |
| MCP/插件安全 | 有条件通过 | 默认权限、审计、隔离策略需明确 |
| V1/V2 双会话 | 有条件通过 | 需要明确的废弃时间表与迁移路径 |

### 12.3 总体审批等级

**B+（良好，但关键子系统尚未完成）**

基础架构扎实，方向正确，但 Design 可视化、Session V2 完整实现、Native LLM 完备性、集群执行等关键能力仍处于半成品或规格阶段。当前代码适合继续迭代，但**不建议作为完整产品发布**。

---

## 十三、建议的优先行动

### 高优先级（未来 1-2 周）

1. **完成 Design 工作集数据卫生**：在 `saveWorkingSet` 前过滤已删除实体的 entry；补充异常退出/恢复测试。
2. **推进 Design 可视化编辑器**：实现一个最小可行 UI，让用户能直接查看/编辑设计图，验证 `VersionSync` 的三端同步。
3. **清理 SessionRunner TODO**：优先实现 durable status、bounded retries、interruption settlement，使 V2 从"可跑"变为"可信任"。

### 中优先级（未来 1 个月）

4. **完成 Native LLM runtime**：补齐 OAuth、工具调用、结构化输出，使其能覆盖 AI SDK 的主路径。
5. **明确 V1 废弃计划**：设定 V1 完全移除的里程碑，减少双会话维护负担。
6. **增加 MCP/插件默认权限策略**：对 MCP 和外部插件工具实施默认受限权限，要求显式授权。
7. **设计集群执行方案**：将 `SessionExecution` 从 process-local 推进到可分布式的 ownership 模型。

### 低优先级 / 持续

8. **监控 SearchAgent 摘要 token**：长项目下引入摘要长度上限或分层摘要。
9. **文档化架构决策**：将本报告中的关键决策写入 `docs/architecture/`。
10. **引入依赖方向自动化检查**：防止包边界被意外突破。

---

## 十四、最终声明

本审批基于当前 `dev` 分支（`c2b75ba8a`）的代码扫描。OpenCode 的架构具有成为顶级 AI 编程助手平台的潜力，但当前阶段仍需在**实现深度、产品完整性、异常鲁棒性**三方面继续投入。建议保持当前架构方向，聚焦完成高优先级子系统，而非扩展新功能。
