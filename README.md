<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>

<p align="center">基于 OpenCode 的开源 AI Coding Agent，扩展原生 Design 设计模式。</p>
<p align="center">
  <a href="https://github.com/anomalyco/opencode"><img alt="Upstream" src="https://img.shields.io/badge/upstream-anomalyco%2Fopencode-blue?style=flat-square" /></a>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20x64-blueviolet?style=flat-square" />
</p>

---

本项目是 [OpenCode](https://github.com/anomalyco/opencode) 的一个 fork，在保留其 AI 编程助手核心能力的基础上，增加了**原生 Design（设计模式）**：允许以结构化语义图的方式管理上下文、概念、关系与原型，并在桌面端 GUI 中通过多 Agent 协作完成设计分析、检索、变更提案与审批。

> **范围声明**
> 本 fork 的构建、运行与验证均只针对 **Windows x64 桌面端 GUI**（`packages/desktop` + `packages/app`）。CLI、Web、macOS、Linux 及服务器端部署不在当前维护范围内，如需使用请自行验证。

---

## 目录

- [环境配置与依赖安装](#环境配置与依赖安装)
- [系统运行方法](#系统运行方法)
- [典型使用示例](#典型使用示例)
- [目录结构](#目录结构)
- [许可证](#许可证)

---

## 环境配置与依赖安装说明

### 前置条件

- **操作系统**：Windows 10/11 x64
- **运行时**：Bun 1.3.14（仓库根目录 `package.json` 已锁定 `packageManager`）
- **版本控制**：Git

> 不建议使用 npm/yarn 直接安装依赖；所有脚本均假设使用 `bun`。

### 1. 克隆仓库

```powershell
git clone https://github.com/rel-lit/OpenCodeDesign.git
cd opencode
```

### 2. 安装依赖

```powershell
bun install
```

安装期间会触发 `postinstall` 脚本修复 `node-pty` 等原生依赖。如果失败，请检查是否已以管理员权限打开终端，或参考上游 [OpenCode 贡献指南](./CONTRIBUTING.md)。

### 3. 配置模型 Provider

推荐通过桌面端 GUI 的 **Settings → Provider** 界面连接模型并填写 API Key。该方式会自动生成并维护项目级 `opencode.json`，无需手动编辑。

若确需手动配置，可在项目根目录创建 `opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "openai/gpt-4o",
  "small_model": "openai/gpt-4o-mini",
  "provider": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}"
    }
  }
}
```

> 建议通过环境变量注入密钥：`$env:OPENAI_API_KEY="sk-..."`。也可直接在 `opencode.json` 中填写，但请勿提交到 Git。

支持的 provider 可参考 `packages/opencode/src/provider/provider.ts` 与 `packages/opencode/package.json` 中的 `@ai-sdk/*` 依赖。

---

## 系统运行方法

### 开发模式：桌面端 GUI

```powershell
bun run dev:desktop
```

该命令会启动 Electron 主进程（`packages/desktop`）并加载 SolidJS 渲染应用（`packages/app`）。首次启动需要下载/编译 Electron 依赖，耗时可能较长。

### 仅启动无头 API 服务

```powershell
bun dev serve
```

默认监听 `http://localhost:4096`。可指定端口：

```powershell
bun dev serve --port 8080
```

> 无头服务主要供内部调试使用；当前 fork 的交互场景以桌面端 GUI 为主。

### 类型检查

```powershell
bun run --cwd packages/opencode typecheck
```

### Windows x64 单平台构建

```powershell
bun run --cwd packages/opencode build --single
```

构建产物位于 `packages/opencode/dist/opencode-windows-x64/bin/opencode.exe`。

---

## 典型使用示例

以下示例均在 Windows 桌面端 GUI 中操作。打开项目后，在输入框左下角通过 Agent 下拉框（或 `Tab` 快捷键循环）把当前 Agent 切换到 **design**。

### 示例 1：创建设计图

1. 启动 `bun run dev:desktop`，在桌面端打开任意项目目录。
2. 在输入框左下角切换到 **design** Agent。
3. 输入：

```text
我想要设计一个游戏的战斗系统，玩法可能类似于《吸血鬼幸存者》。
```

4. design Agent 调用 `design_request_change`，`design-graph` 子代理分析当前图状态后生成高层变更计划，例如创建"战斗系统"上下文及"玩家""敌人""技能"等概念，并在 composer 区域弹出 **设计变更方向审批** 面板。
5. 根据面板选项选择 **应用**、**强制推进**、**修改** 或 **拒绝**。若选择应用或强制推进，子代理进入细化阶段确认概念语义与关系，最后弹出 **设计变更终稿确认** 面板。
6. 终稿确认后，系统自动将变更写入 `.opencode/design/design.sqlite`，bump 设计图版本号，并在时间线中展示 `@design-graph subagent` 子会话的完整操作过程。

### 示例 2：聚焦特定范围并检索代码实现

1. 在已有设计图的项目中保持当前 Agent 为 **design**，输入：

```text
检查战斗系统中"玩家"和"技能"两个概念是否在代码里有对应实现。
```

2. design Agent 调用 `design_search_project`，系统自动执行两步：
   - 调用 `design-graph` 子代理的 summarize 模式，生成聚焦于 `contexts: 战斗系统` 与 `concepts: 玩家, 技能` 的图摘要。
   - 将摘要注入 `design-search` 子代理，子代理读取项目代码并返回差异分析。
3. 分析结果包括：哪些概念在代码中缺失、哪些关系与实现不一致、相关文件引用及代码片段。design Agent 将结果汇总为自然语言报告，并建议下一步行动。

### 示例 3：与 design Agent 讨论设计，系统自动调用 cognition 分析

1. 在桌面端 GUI 中保持当前 Agent 为 **design**，输入：

```text
我觉得把"技能"直接挂在"战斗系统"下不太对，它是不是应该独立成一个跨上下文共享的概念？
```

2. design Agent 识别到该问题涉及当前设计图的语义结构，自动调用 `design_ask_graph` 工具，让 `design-graph` 子代理进入 cognition 模式分析："技能"当前的上下文归属、与相邻概念的关系、跨上下文复用的可能性等。
3. `design-graph` 子代理返回结构化洞察，例如："技能"当前仅隶属于"战斗系统"上下文；它与"玩家"存在"has-a"关系；若要让"技能"跨上下文共享，建议将其提升为独立上下文或定义新的关系原型。
4. design Agent 将这些洞察整合进回复，继续与用户讨论拆分方案，或在用户确认后直接发起 `design_request_change` 执行变更。

该示例展示 design Agent 不会凭空回应设计质疑，而是通过 cognition 工具自动查询图状态并给出基于当前设计的分析。

---

## 目录结构

| 目录 | 说明 |
|------|------|
| `packages/opencode` | 核心服务、CLI、Agent、Design 模式实现 |
| `packages/app` | 桌面端渲染应用（SolidJS） |
| `packages/desktop` | Electron 主进程与壳层 |
| `packages/core` | 上游共享基础设施（数据库、会话、LSP 等） |
| `docs/specs` | Design 模式相关设计规格 |
| `docs/notes` | 项目理解笔记与环境约束声明 |

更多实现细节与约束请阅读：

- `docs/notes/opencode-understanding.md`
- `docs/specs/2026-06-30-design-understanding.md`
- `docs/specs/2026-07-01-design-multi-agent-architecture.md`

---

## 许可证

本项目基于 [OpenCode](https://github.com/anomalyco/opencode) 上游代码 fork 并修改，采用 **MIT 许可证**。

原项目许可证：见仓库根目录 `LICENSE`。

---

**说明**：本 fork 并非 OpenCode 官方项目，与 OpenCode 团队不存在隶属关系。
