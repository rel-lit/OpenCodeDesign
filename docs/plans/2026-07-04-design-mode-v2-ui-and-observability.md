# Design Mode v2 UI & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the remaining Design Mode v2 improvements: subagent session trace logging, subagent session link cards in the parent timeline, and a dedicated design approval dock.

**Architecture:** Reuse existing OpenCode primitives (`Question.Service`, `DockPrompt`, `BasicTool`, `ToolRegistry`, `EventV2Bridge`) rather than inventing new protocols. Add minimal, focused services/components for each feature. Keep changes isolated to `packages/opencode` (server-side trace + metadata), `packages/session-ui` (tool rendering), and `packages/app` (approval dock).

**Tech Stack:** Effect v4 beta, SolidJS, `@effect/platform-node` `FileSystem`/`Path`, existing `@opencode-ai/ui` components.

## Global Constraints

- Platform: Windows x64; build command `bun run build --single`.
- Type check: `bun run typecheck` from `packages/opencode`, never `tsc` directly.
- Tests: run from `packages/opencode` (`bun test test/design ...`), never from repo root.
- Edit existing files; only create new files when required.
- Follow existing module-shape conventions: flat top-level exports, self-reexport at bottom, no `export namespace`.
- Use `Effect.gen` + `Effect.fn`; avoid `try`/`catch`; prefer Effect error channels.
- Never introduce secrets or API keys.
- All commits use conventional style: `type(scope): summary`.

---

## Task 1: Visual Editor Sync State Refactor

> **Note:** This task was already implemented in commit `12baccabd` before the plan was written. It is retained here for context and ordering. Skip if already merged.

**Files:**
- Modify: `packages/opencode/src/design/system/version-sync.ts`
- Modify: `packages/opencode/src/design/design.ts`
- Modify: `packages/opencode/src/tool/design.ts`
- Modify: `packages/opencode/test/design/system/version-sync.test.ts`

**Interfaces:**
- Consumes: `EventLog.Interface` (lists `graph_version_bumped` events)
- Produces: `VersionSync.Interface` with `getCurrentVersion`, `bumpVersion`, `isVisualEditorDirty`, `markVisualEditorDirty`, `clearVisualEditorDirty`, `checkChatAgentSync` (no `refreshChatAgentContext`)

**Behavior:**
- Derive `isVisualEditorDirty` and `checkChatAgentSync` from `eventLog.list()` instead of memory variables.
- `design_ask_graph` and `design_summarize_design` no longer call `checkChatAgentSync`; on success they call `design.bumpVersion("chat-agent")`.
- `design_request_change` keeps `checkChatAgentSync`.
- Delete `refreshChatAgentContext` from `VersionSync.Interface`, `Design.Interface`, and implementations.

---

## Task 2: Design Subagent JSONL Trace Log

### 2.1 Add `SessionTrace` service

**Files:**
- Create: `packages/opencode/src/design/system/session-trace.ts`

**Interfaces:**
- Produces: `SessionTrace.Interface` with `enable(input: { sessionID: string; agent: string; parentSessionID?: string }): Effect.Effect<void>`

**Step-by-step:**

- [ ] **Step 1: Create service skeleton**

```ts
import { Context, Effect, Layer } from "effect"
import { FileSystem, Path } from "@effect/platform"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export interface Interface {
  readonly enable: (input: {
    sessionID: string
    agent: string
    parentSessionID?: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignSessionTrace") {}
```

- [ ] **Step 2: Decide on internal state mechanism**

Use plain `Ref` (not `SubscriptionRef`) for `Map<string, TraceSink>` and `Map<string, TraceEntry[]>`. Example:

```ts
type TraceSink = {
  sessionID: string
  agent: string
  parentSessionID?: string
}

type TraceEntry = {
  timestamp: string
  type: string
  sessionID: string
  parentSessionID?: string
  agent: string
  data: unknown
}
```

- [ ] **Step 3: Implement file writing helper**

Use `FileSystem.FileSystem` and `Path.Path`. Build `logDir = path.join(directory, ".opencode", "logs", "sessions")`. Append lines with `fs.writeFile(filePath, bytes, { append: true, create: true })`. Convert string to `Uint8Array` with `new TextEncoder().encode(...)`.

- [ ] **Step 4: Implement `enable` and event listener**

In `make`:
1. Yield `FileSystem.FileSystem`, `Path.Path`, `InstanceState.context`, `EventV2Bridge.Service`.
2. Create `Ref<Map<string, TraceSink>>` and `Ref<Map<string, TraceEntry[]>>`.
3. Subscribe to `events.listen(...)`. In handler, extract `sessionID` from `event.data.sessionID`. If the session is in sinks and event type is in allow-list, build `TraceEntry` and push to buffer.
4. `enable` adds a sink if agent is `"design-graph"` or `"design-search"`.

- [ ] **Step 5: Add buffering and flush**

Keep buffer per session. Flush when buffer reaches 32 entries or every 500ms. Use `Effect.forkScoped` for periodic flush loop. On scope finalizer, flush all remaining buffers.

- [ ] **Step 6: Wire into `Design.node` and `ToolRegistry.node`**

Add `SessionTrace.node` to `Design.node` deps and `ToolRegistry.node` deps so `TaskTool` can access it.

- [ ] **Step 7: Call `SessionTrace.enable` from `TaskTool`**

In `packages/opencode/src/tool/task.ts`, after child session `nextSession` is created (and after `design.resetTemporaryWorkingSet` if design-graph), call:

```ts
const sessionTrace = yield* SessionTrace.Service
yield* sessionTrace.enable({
  sessionID: nextSession.id,
  agent: next.name,
  parentSessionID: ctx.sessionID,
})
```

- [ ] **Step 8: Typecheck and test**

Run `bun run typecheck` in `packages/opencode`. Fix any Effect API mismatches by checking nearby files for exact patterns.

- [ ] **Step 9: Write trace log test**

Create `packages/opencode/test/design/system/session-trace.test.ts`. Mock `EventV2Bridge` events, enable tracing for a session, publish allowed/disallowed events, flush, and assert file contents.

- [ ] **Step 10: Run tests**

Run `bun test test/design/system/session-trace.test.ts` and `bun test test/tool/task.test.ts`.

- [ ] **Step 11: Commit**

```bash
git add packages/opencode/src/design/system/session-trace.ts packages/opencode/src/design/design.ts packages/opencode/src/tool/task.ts packages/opencode/src/tool/registry.ts packages/opencode/test/design/system/session-trace.test.ts
git commit -m "feat(design): add JSONL trace log for design subagent sessions"
```

---

## Task 3: Design Subagent Link Card Rendering

### 3.1 Extract shared subagent link card renderer

**Files:**
- Modify: `packages/session-ui/src/components/message-part.tsx`

**Interfaces:**
- Consumes: `ToolRegistry` render props (`input`, `metadata`, `status`)
- Produces: Registered renderers for `design_ask_graph`, `design_request_change`, `design_summarize_design`, `design_search_project`, `design_search_web`

**Step-by-step:**

- [ ] **Step 1: Identify reusable helper**

Reuse existing `sessionLink()` helper and `BasicTool` + custom trigger JSX from the `task` renderer.

- [ ] **Step 2: Implement `DesignSubagentToolCard` renderer**

Create a render function that:
1. Reads `props.metadata.result.metadata.sessionId` as child session ID.
2. Reads `props.input.description` or `props.metadata.result.metadata.description` as subtitle.
3. Determines agent name from `props.metadata.result.metadata.subagent_type` or `props.input.subagent_type`.
4. Builds `href` with `sessionLink(...)`.
5. Renders `BasicTool` with `icon="layers"`, custom trigger mimicking `task` trigger, `hideDetails={true}`, and click navigation.

- [ ] **Step 3: Register for all 5 design chat tools**

```ts
for (const name of [
  "design_ask_graph",
  "design_request_change",
  "design_summarize_design",
  "design_search_project",
  "design_search_web",
]) {
  ToolRegistry.register({ name, render: designSubagentRenderer })
}
```

- [ ] **Step 4: Typecheck session-ui**

From `packages/session-ui`, run the package's typecheck command. Fix icon name if `layers` is unavailable; fall back to `task` or `git-branch`.

- [ ] **Step 5: Write component test**

Create `packages/session-ui/src/components/message-part-design-subagent.test.tsx` (or similar). Render a tool part with `tool: "design_ask_graph"`, `metadata.result.metadata.sessionId`, and assert the card title/link are present.

- [ ] **Step 6: Run tests**

Run relevant session-ui tests and design tool tests from `packages/opencode`.

- [ ] **Step 7: Commit**

```bash
git add packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/message-part-design-subagent.test.tsx
git commit -m "feat(session-ui): render design subagent tools as session link cards"
```

---

## Task 4: Design Approval Dock

### 4.1 Add `SessionDesignApprovalDock` component

**Files:**
- Create: `packages/app/src/pages/session/composer/session-design-approval-dock.tsx`
- Modify: `packages/app/src/pages/session/composer/session-composer-region.tsx`
- Modify: `packages/app/src/pages/session/composer/session-composer-state.ts`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`
- Modify: `packages/opencode/src/design/agent/prompt/graph.txt`

**Interfaces:**
- Consumes: `QuestionRequest`, SDK `question.reply`/`reject`, `DockPrompt`
- Produces: `SessionDesignApprovalDock` component; `designApprovalRequest` / `designApprovalResponding` / `designApprovalRespond` in composer state

**Step-by-step:**

- [ ] **Step 1: Create component file**

Create `packages/app/src/pages/session/composer/session-design-approval-dock.tsx`. Copy structure from `session-question-dock.tsx` and `session-permission-dock.tsx`.

Props:

```ts
export function SessionDesignApprovalDock(props: {
  request: QuestionRequest
  responding: boolean
  onResponseSubmit: () => void
})
```

- [ ] **Step 2: Implement Markdown rendering**

Import `Markdown` from `@opencode-ai/session-ui/markdown` (or wherever the project keeps it). Render `question` field inside scrollable container.

- [ ] **Step 3: Implement Revise textarea**

Use local `createStore` for `{ reviseOpen: boolean; reviseText: string }`. Default closed. Clicking "Revise" opens textarea. Clicking "Submit revision" validates non-empty text and calls `question.reply` with `["revise", text]`.

- [ ] **Step 4: Implement footer buttons**

Three buttons:
- Reject (ghost) → `question.reject`
- Revise (secondary) → toggle textarea / submit
- Apply (primary) → `question.reply(["apply"])`

Use new i18n keys: `session.designApproval.action.reject`, `session.designApproval.action.revise`, `session.designApproval.action.apply`, `session.designApproval.title`, `session.designApproval.revisePlaceholder`.

- [ ] **Step 5: Reuse resize/measure helpers**

Copy `measure()` and `resizeInput()` from `session-question-dock.tsx` if needed for textarea auto-grow and content max-height.

- [ ] **Step 6: Add composer state selectors**

In `session-composer-state.ts`:

```ts
const designApprovalRequest = createMemo(() => {
  const req = sessionQuestionRequest(sync().data.session, sync().data.question, params.id)
  if (!req) return
  if (!req.questions[0]?.header?.startsWith("[design-approval]")) return
  return req
})
```

Add `designApprovalResponding()` and `designApprovalRespond()` analogous to `permissionResponding`/`decide`.

Update `blocked()` to include `designApprovalRequest()`.

- [ ] **Step 7: Mount component in composer region**

In `session-composer-region.tsx`, render `SessionDesignApprovalDock` before `SessionQuestionDock`.

- [ ] **Step 8: Update GraphAgent prompt**

In `packages/opencode/src/design/agent/prompt/graph.txt`, update judge-mode `question.ask` example to use:
- `header: "[design-approval] 设计变更审批"`
- `options: [{ label: "应用", description: "..." }, { label: "拒绝", description: "..." }]`
- `custom: true`

- [ ] **Step 9: Update GraphAgent answer parsing**

In the judge-mode workflow description in `graph.txt`, document that:
- `answers[0][0] === "apply"` → execute
- `answers[0][0] === "revise"` → return `needs-clarification`
- reject → return `rejected`

- [ ] **Step 10: Typecheck app**

Run typecheck in `packages/app`.

- [ ] **Step 11: Add i18n keys to `en.ts` and `zh.ts`**

```ts
"session.designApproval.title": "Design change approval",
"session.designApproval.action.apply": "Apply",
"session.designApproval.action.revise": "Revise",
"session.designApproval.action.reject": "Reject",
"session.designApproval.revisePlaceholder": "Describe how you'd like to revise this plan...",
```

and Chinese equivalents.

- [ ] **Step 12: Add tests**

Create `packages/app/src/pages/session/composer/session-design-approval-dock.test.tsx` (or extend existing). Mock SDK `question.reply`/`reject`. Assert Markdown renders, Revise textarea opens, Apply submits `["apply"]`.

- [ ] **Step 13: Run tests**

Run app tests and `bun run typecheck` in `packages/opencode` and `packages/app`.

- [ ] **Step 14: Commit**

```bash
git add packages/app/src/pages/session/composer/session-design-approval-dock.tsx packages/app/src/pages/session/composer/session-composer-region.tsx packages/app/src/pages/session/composer/session-composer-state.ts packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts packages/opencode/src/design/agent/prompt/graph.txt packages/app/src/pages/session/composer/session-design-approval-dock.test.tsx
git commit -m "feat(app): add dedicated design approval dock with revise input"
```

---

## Final Verification

- [ ] Run `bun run typecheck` in `packages/opencode`.
- [ ] Run `bun run typecheck` in `packages/app` and `packages/session-ui` if available.
- [ ] Run `bun test test/design test/tool/graph-agent-design.test.ts test/tool/task.test.ts` in `packages/opencode`.
- [ ] Run `bun run build --single` from repo root.
- [ ] If any test fails, fix and re-verify before claiming complete.

---

## Spec Coverage Check

| Spec requirement | Implementing task |
|------------------|-------------------|
| Markdown rendering of Change Plan | Task 4 |
| Apply / Revise / Reject actions with revise textarea | Task 4 |
| `[design-approval]` header recognition | Task 4 |
| Design tools show subagent session link cards | Task 3 |
| `hideDetails=true` for design subagent cards | Task 3 |
| JSONL trace log for design subagents | Task 2 |
| Trace log path `.opencode/logs/sessions/<session-id>.jsonl` | Task 2 |
| Sync state derived from event log | Task 1 (done) |
| Read tools bump `chat-agent` version | Task 1 (done) |
| Delete `refreshChatAgentContext` | Task 1 (done) |

---

## Placeholder Scan

No placeholders like "TBD", "TODO", or "implement later" remain in code steps. Each step includes file paths and exact API names. Where code is illustrative (e.g., `Markdown` import location), implementer must verify the exact import path from neighboring files before committing.
