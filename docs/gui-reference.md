# OpenCode GUI 参考文档

本仓库的目标平台为 **Windows x64 桌面 GUI**（`packages/desktop` + `packages/app`）。文档涵盖桌面端 GUI 的所有主要入口、页面、布局、状态管理和可复用组件，便于后续讨论和改动时统一指代。

> 范围：`packages/app`、`packages/session-ui`、`packages/ui`、`packages/desktop`  
> 不包含：TUI（`packages/tui`）、Web 端特有逻辑、服务器端渲染

---

## 1. 包结构总览

| 包 | 路径 | 职责 |
|---|---|---|
| `app` | `packages/app` | SolidJS 桌面/Web 应用主包，包含路由、页面、全局状态、业务组件 |
| `session-ui` | `packages/session-ui` | 共享会话组件（消息、diff、markdown、dock 容器等） |
| `ui` | `packages/ui` | 设计系统原子组件，分 v1 和 v2 两套 |
| `desktop` | `packages/desktop` | Electron 渲染层入口和初始化 |

---

## 2. 入口与路由

### 2.1 应用入口

| 文件 | 说明 |
|---|---|
| `packages/app/src/entry.tsx` | Web 入口，渲染根组件 |
| `packages/app/src/app.tsx` | 根组件，定义路由和全局 provider，控制 `newLayoutDesigns` 新旧布局切换 |
| `packages/desktop/src/renderer/index.tsx` | Electron renderer 入口 |
| `packages/desktop/src/renderer/onboarding.tsx` | 桌面端首次启动引导页 |

### 2.2 主要页面

| 文件 | 说明 |
|---|---|
| `packages/app/src/pages/layout.tsx` | 旧版主布局（左侧项目边栏 + 右侧内容区） |
| `packages/app/src/pages/layout-new.tsx` | 新版 v2 外壳布局（顶部标题栏 + 主内容区） |
| `packages/app/src/pages/session.tsx` | 会话主页面，协调时间线、composer、dock、侧边面板 |
| `packages/app/src/pages/new-session.tsx` | 新建会话页面 |
| `packages/app/src/pages/home.tsx` | 首页/欢迎页 |
| `packages/app/src/pages/error.tsx` | 全局错误页 |
| `packages/app/src/pages/directory-layout.tsx` | 目录/项目视图布局 |

### 2.3 路由约定

- URL 模式：`/{base64(directory)}/session/{sessionID}`
- 路由解析在 `packages/app/src/context/layout.tsx` 的 `currentRoute` 中。
- 新旧布局通过 `settings.general.newLayoutDesigns()` 切换。

---

## 3. 全局 Context / 状态地图

`packages/app/src/context/` 目录下所有全局状态容器：

| 文件 | 职责 | 常用 hook |
|---|---|---|
| `layout.tsx` | **核心布局状态**：边栏宽度、review/fileTree/terminal 开关、session tabs、session view、项目列表 | `useLayout` |
| `tabs.tsx` | 浏览器式标签页（session/draft） | `useTabs` |
| `file.tsx` | 文件内容、文件 tab、文件树状态 | `useFile` |
| `prompt.tsx` | composer 输入内容、附件、上下文项 | `usePrompt` |
| `settings.tsx` | 用户设置，含 `newLayoutDesigns` | `useSettings` |
| `terminal.tsx` | terminal 会话状态 | `useTerminal` |
| `command.tsx` | 命令面板与快捷键注册 | `useCommand` |
| `server.tsx` | 服务器连接状态 | `useServer` |
| `server-sync.tsx` | 服务器同步编排 | `useServerSync` |
| `server-sdk.tsx` | 服务器级 SDK | `useServerSDK` |
| `sdk.tsx` | 本地 SDK 实例 | `useSDK` |
| `sync.tsx` | 乐观同步数据 | `useSync` |
| `global.tsx` | 全局应用状态 | `useGlobal` |
| `comments.tsx` | review 行级评论 | `useComments` |
| `permission.tsx` | 权限请求处理 | `usePermission` |
| `notification.tsx` | 通知提醒 | `useNotification` |
| `models.tsx` | 模型选择 | `useModels` |
| `language.tsx` | i18n | `useLanguage` |
| `platform.tsx` | 平台检测（desktop/web） | `usePlatform` |
| `highlights.tsx` | 文本高亮 | `useHighlights` |
| `local.tsx` | 本地-only 状态 | `useLocal` |
| `mcp.ts` | MCP 服务器状态 | `useMcp` |

### 3.1 `layout` context 重点字段

```
layout.sidebar          // 左侧项目边栏（opened, width, workspaces）
layout.fileTree         // 右侧文件树（opened, width, tab: 'changes' | 'all'）
layout.review           // review 面板（diffStyle, panelOpened）
layout.terminal         // 底部 terminal（height, opened）
layout.session          // session 区域宽度
layout.view(sessionKey) // 当前会话视图状态（reviewPanel, terminal, todoCollapsed, scroll）
layout.tabs(sessionKey) // 当前会话打开的文件 tabs
```

---

## 4. 布局系统

### 4.1 左侧边栏（项目/会话导航）

| 文件 | 说明 |
|---|---|
| `packages/app/src/pages/layout/sidebar-shell.tsx` | 左侧边栏外壳 |
| `packages/app/src/pages/layout/sidebar-items.tsx` | 边栏项目渲染和导航 |
| `packages/app/src/pages/layout/sidebar-workspace.tsx` | 工作区/项目树 |
| `packages/app/src/pages/layout/sidebar-project.tsx` | 项目级子树 |
| `packages/app/src/pages/layout/session-tab-avatar.tsx` | 会话头像 |
| `packages/app/src/pages/layout/inline-editor.tsx` | 行内重命名编辑器 |

### 4.2 顶部标题栏

| 文件 | 说明 |
|---|---|
| `packages/app/src/components/titlebar.tsx` | 顶部 chrome、标签条、右侧挂载区 |
| `packages/app/src/components/titlebar-tab-strip.tsx` | 标签条渲染 |
| `packages/app/src/components/titlebar-tab-popover.tsx` | 标签预览浮层 |
| `packages/app/src/components/titlebar-tab-nav.tsx` | 标签导航 |
| `packages/app/src/components/titlebar-tab-gesture.ts` | 标签拖拽/滚动手势 |

### 4.3 右侧面板

| 文件 | 说明 |
|---|---|
| `packages/app/src/pages/session/session-side-panel.tsx` | **右侧边栏容器**，包含 review tab、context tab、文件 tabs、文件树 |
| `packages/app/src/pages/session/review-tab.tsx` | review/diff 面板包装 |
| `packages/app/src/pages/session/file-tabs.tsx` | 文件 tab 内容和文件查看器 |

### 4.4 底部面板

| 文件 | 说明 |
|---|---|
| `packages/app/src/pages/session/terminal-panel.tsx` | 旧版 terminal 面板 |
| `packages/app/src/pages/session/terminal-panel-v2.tsx` | v2 terminal 面板 |

### 4.5 Composer 区域

| 文件 | 说明 |
|---|---|
| `packages/app/src/components/prompt-input.tsx` | 主输入框 |
| `packages/app/src/pages/session/composer/session-composer-region.tsx` | composer 区域，承载输入框和 dock |
| `packages/app/src/pages/session/composer/session-composer-region-controller.ts` | composer 区域控制器 |
| `packages/app/src/pages/session/composer/session-composer-state.ts` | composer 状态机 |
| `packages/app/src/pages/session/composer/session-composer-controls.ts` | composer 控制按钮 |

---

## 5. Session 页面

`packages/app/src/pages/session.tsx` 是会话主页面，其内部结构为：

```
SessionPage
└── Page
    ├── SessionHeader                // 顶部会话头
    ├── MessageTimeline              // 消息时间线
    ├── SessionComposerRegion        // 输入框 + dock
    └── SessionSidePanel             // 右侧面板（review / files / context）
```

### 5.1 Session 头部

| 文件 | 说明 |
|---|---|
| `packages/app/src/components/session/session-header.tsx` | 模型/Agent 控制、状态、review/terminal 切换按钮 |

### 5.2 时间线

| 文件 | 说明 |
|---|---|
| `packages/app/src/pages/session/timeline/message-timeline.tsx` | 主消息时间线 UI |
| `packages/app/src/pages/session/timeline/model.ts` | 时间线数据模型 |
| `packages/app/src/pages/session/timeline/projection.ts` | 从同步数据生成行 |
| `packages/app/src/pages/session/timeline/rows.ts` | 行构建逻辑 |
| `packages/app/src/pages/session/timeline/timeline-row.ts` | 行组件类型 |
| `packages/app/src/pages/session/timeline/row-reconciliation.ts` | 更新间行协调 |
| `packages/app/src/pages/session/timeline/measure.ts` | 行高测量 |
| `packages/app/src/pages/session/timeline/virtual-items.ts` | 虚拟项布局 |

### 5.3 Dock 面板系统

所有 dock 挂载在 composer 区域内，阻塞式请求用户输入。

| 文件 | 用途 |
|---|---|
| `packages/app/src/pages/session/composer/session-question-dock.tsx` | 问题/确认 dock |
| `packages/app/src/pages/session/composer/session-permission-dock.tsx` | 权限 dock |
| `packages/app/src/pages/session/composer/session-design-approval-dock.tsx` | Design 变更审批 dock |
| `packages/app/src/pages/session/composer/session-followup-dock.tsx` | 后续建议 dock |
| `packages/app/src/pages/session/composer/session-todo-dock.tsx` | 待办 dock |
| `packages/app/src/pages/session/composer/session-revert-dock.tsx` | 回退 dock |
| `packages/session-ui/src/components/dock-prompt.tsx` | 通用 dock 容器 |

### 5.4 Review V2

| 文件 | 说明 |
|---|---|
| `packages/app/src/pages/session/v2/review-panel-v2.tsx` | v2 review 面板接入 |
| `packages/app/src/pages/session/v2/review-panel-v2-state.ts` | v2 review 面板持久化状态 |
| `packages/app/src/pages/session/v2/session-file-list-v2.tsx` | v2 文件列表 |
| `packages/app/src/pages/session/v2/review-diff-kinds.ts` | diff 类型聚合 |

### 5.5 Session 辅助模块

| 文件 | 说明 |
|---|---|
| `packages/app/src/pages/session/helpers.ts` | tab 辅助、sizing、焦点工具 |
| `packages/app/src/pages/session/session-layout.ts` | `useSessionLayout`、`useSessionKey` |
| `packages/app/src/pages/session/session-panel-layout.ts` | 面板布局逻辑 |
| `packages/app/src/pages/session/use-session-commands.tsx` | 会话快捷键命令 |
| `packages/app/src/pages/session/use-composer-commands.tsx` | composer 快捷键命令 |
| `packages/app/src/pages/session/handoff.ts` | 会话状态交接持久化 |
| `packages/app/src/pages/session/session-ownership.ts` | 会话所有权检查 |

---

## 6. 组件库

### 6.1 `packages/session-ui`

会话级可复用组件。

| 文件 | 说明 |
|---|---|
| `packages/session-ui/src/components/message-part.tsx` | 消息 part 渲染（text、file、tool、reasoning 等） |
| `packages/session-ui/src/components/session-turn.tsx` | 会话 turn 包装 |
| `packages/session-ui/src/components/markdown.tsx` | Markdown 渲染 |
| `packages/session-ui/src/components/file.tsx` | 文件内容查看器 |
| `packages/session-ui/src/components/session-review.tsx` | Review/diff 查看器 |
| `packages/session-ui/src/components/line-comment.tsx` | 行级评论 |
| `packages/session-ui/src/components/dock-prompt.tsx` | Dock 容器 |
| `packages/session-ui/src/components/basic-tool.tsx` | 基础 tool 卡片 |
| `packages/session-ui/src/components/tool-error-card.tsx` | tool 错误卡片 |
| `packages/session-ui/src/components/session-retry.tsx` | 重试 UI |
| `packages/session-ui/src/components/message-nav.tsx` | 消息导航 |

v2 组件位于 `packages/session-ui/src/v2/components/`：

| 文件 | 说明 |
|---|---|
| `packages/session-ui/src/v2/components/session-review-v2.tsx` | v2 review 查看器 |
| `packages/session-ui/src/v2/components/session-review-file-preview-v2.tsx` | v2 文件预览 |
| `packages/session-ui/src/v2/components/basic-tool-v2.tsx` | v2 tool 卡片 |
| `packages/session-ui/src/v2/components/tool-error-card-v2.tsx` | v2 tool 错误卡片 |

### 6.2 `packages/ui` v1 设计系统

基础原子组件。

| 文件 | 说明 |
|---|---|
| `packages/ui/src/components/button.tsx` | Button |
| `packages/ui/src/components/icon-button.tsx` | IconButton |
| `packages/ui/src/components/tabs.tsx` | Tabs |
| `packages/ui/src/components/dialog.tsx` | Dialog |
| `packages/ui/src/components/dropdown-menu.tsx` | DropdownMenu |
| `packages/ui/src/components/tooltip.tsx` | Tooltip |
| `packages/ui/src/components/select.tsx` | Select |
| `packages/ui/src/components/switch.tsx` | Switch |
| `packages/ui/src/components/scroll-view.tsx` | ScrollView |
| `packages/ui/src/components/resize-handle.tsx` | ResizeHandle |
| `packages/ui/src/components/icon.tsx` | Icon |
| `packages/ui/src/components/logo.tsx` | Logo/Mark |
| `packages/ui/src/components/toast.tsx` | Toast |
| `packages/ui/src/components/avatar.tsx` | Avatar |
| `packages/ui/src/components/card.tsx` | Card |
| `packages/ui/src/components/dock-surface.tsx` | DockSurface |
| `packages/ui/src/components/diff-changes.tsx` | DiffChanges |

### 6.3 `packages/ui` v2 设计系统

新版设计系统组件。

| 文件 | 说明 |
|---|---|
| `packages/ui/src/v2/components/button-v2.tsx` | ButtonV2 |
| `packages/ui/src/v2/components/icon-button-v2.tsx` | IconButtonV2 |
| `packages/ui/src/v2/components/icon.tsx` | Icon v2 |
| `packages/ui/src/v2/components/tabs-v2.tsx` | TabsV2 |
| `packages/ui/src/v2/components/dialog-v2.tsx` | DialogV2 |
| `packages/ui/src/v2/components/menu-v2.tsx` | MenuV2 |
| `packages/ui/src/v2/components/tooltip-v2.tsx` | TooltipV2 |
| `packages/ui/src/v2/components/select-v2.tsx` | SelectV2 |
| `packages/ui/src/v2/components/switch-v2.tsx` | SwitchV2 |
| `packages/ui/src/v2/components/textarea-v2.tsx` | TextareaV2 |
| `packages/ui/src/v2/components/text-input-v2.tsx` | TextInputV2 |
| `packages/ui/src/v2/components/badge-v2.tsx` | BadgeV2 |
| `packages/ui/src/v2/components/avatar-v2.tsx` | AvatarV2 |
| `packages/ui/src/v2/components/project-avatar-v2.tsx` | ProjectAvatarV2 |
| `packages/ui/src/v2/components/diff-changes-v2.tsx` | DiffChangesV2 |
| `packages/ui/src/v2/components/loader-v2.tsx` | LoaderV2 |
| `packages/ui/src/v2/components/accordion-v2.tsx` | AccordionV2 |

---

## 7. 桌面端入口

| 文件 | 说明 |
|---|---|
| `packages/desktop/src/renderer/index.tsx` | Electron renderer 根入口 |
| `packages/desktop/src/renderer/onboarding.tsx` | 首次启动引导 |
| `packages/desktop/src/renderer/initialization.ts` | 渲染层初始化 |
| `packages/desktop/src/renderer/webview-zoom.ts` | Webview 缩放 |
| `packages/desktop/src/renderer/cli.ts` | 渲染层 CLI 参数 |

---

## 8. 新增 GUI 的接入点（以 Design graph sidebar 为例）

要在 Session 页面增加一个 Design graph 侧边栏，推荐接入路径：

1. **布局状态** — `packages/app/src/context/layout.tsx`
   - 新增 `designPanel: { opened, width }` 状态，提供 `toggle`/`resize` API，类似 `fileTree`。

2. **切换入口** — `packages/app/src/components/session/session-header.tsx`
   - 在头部右侧增加 Design 面板开关按钮（可放在 `newLayoutDesigns` flag 后）。

3. **右侧面板集成** — `packages/app/src/pages/session/session-side-panel.tsx`
   - 新增 Design tab 或独立面板分支，渲染 graph 内容。

4. **新面板组件** — 新建文件，例如：
   - `packages/app/src/pages/session/design-graph-panel.tsx`
   - 使用 SDK 查询 Design graph 数据并渲染 contexts / nodes / edges / prototypes。

5. **主页面接入** — `packages/app/src/pages/session.tsx`
   - 在桌面布局计算中加入 `desktopDesignPanelOpen`，调整 `sessionPanelWidth`。

6. **命令面板** — `packages/app/src/pages/session/use-session-commands.tsx`
   - 注册 `designGraph.toggle` 命令与快捷键。

7. **数据层引用**（非 GUI，但需配合）：
   - `packages/opencode/src/design/design.ts` — Design 主服务
   - `packages/opencode/src/design/core/graph.ts` — 内存图引擎
   - `packages/opencode/src/tool/design.ts` — design 工具

---

## 9. 术语表

| 中文/英文 | 含义 |
|---|---|
| Session | 一次会话 |
| Composer | 聊天输入框及上方 dock 区域 |
| Dock | 阻塞式请求面板（question/permission/design-approval 等） |
| Timeline | 消息时间线 |
| Review Panel | 右侧面板中的代码 diff 审查区 |
| File Tree | 右侧面板中的文件树 |
| Context Tab | 会话上下文统计 tab |
| Layout Context | 全局布局状态 |
| v1 / v2 UI | 新旧两套界面，由 `newLayoutDesigns` 设置控制 |
| Side Panel | `SessionSidePanel`，右侧容器 |
| Sidebar | 左侧项目/会话导航边栏 |
| Titlebar | 顶部标题栏 |

---

> 最后更新：2026-07-09  
> 维护者：OpenCodeDesign fork 工作分支 `design`
