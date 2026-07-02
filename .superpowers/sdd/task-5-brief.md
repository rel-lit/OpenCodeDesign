# Task 5: 实现审批面板状态机

**Files:**
- Create: `src/design/approval-panel.ts`
- Test: `test/design/approval-panel.test.ts`

**Interfaces:**
- Consumes: `GraphAgent.Output` (proposals)
- Produces: `ApprovalPanel.State` transitions; events: `confirm`, `force`, `reject`, `revise`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test"
import { ApprovalPanel } from "@/design/approval-panel"

describe("ApprovalPanel", () => {
  test("transitions from idle to proposing", () => {
    const panel = ApprovalPanel.make()
    panel.propose({ type: "change-proposal", summary: "rename", affectedNodes: [], affectedEdges: [] })
    expect(panel.getState().status).toBe("proposing")
  })

  test("confirm transitions to executing", () => {
    const panel = ApprovalPanel.make()
    panel.propose({ type: "change-proposal", summary: "rename", affectedNodes: [], affectedEdges: [] })
    panel.confirm()
    expect(panel.getState().status).toBe("executing")
  })
})
```

- [ ] **Step 2: Implement state machine**

```typescript
// src/design/approval-panel.ts
import * as GraphAgentTypes from "@/design/agent/types"

export type State =
  | { status: "idle" }
  | { status: "proposing"; proposal: GraphAgentTypes.Output }
  | { status: "executing"; proposal: GraphAgentTypes.Output }
  | { status: "done"; proposal: GraphAgentTypes.Output }
  | { status: "rejected"; reason: string }

export interface Interface {
  readonly getState: () => State
  readonly propose: (proposal: GraphAgentTypes.Output) => void
  readonly confirm: () => void
  readonly force: () => void
  readonly reject: (reason: string) => void
  readonly done: () => void
  readonly reset: () => void
}

export const make = (): Interface => {
  let state: State = { status: "idle" }
  return {
    getState: () => state,
    propose: (proposal) => { state = { status: "proposing", proposal } },
    confirm: () => {
      if (state.status !== "proposing") throw new Error("Cannot confirm when not proposing")
      state = { status: "executing", proposal: state.proposal }
    },
    force: () => {
      if (state.status !== "proposing") throw new Error("Cannot force when not proposing")
      state = { status: "executing", proposal: state.proposal }
    },
    reject: (reason) => { state = { status: "rejected", reason } },
    done: () => {
      if (state.status !== "executing") throw new Error("Cannot done when not executing")
      state = { status: "done", proposal: state.proposal }
    },
    reset: () => { state = { status: "idle" } },
  }
}

export * as ApprovalPanel from "./approval-panel"
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/approval-panel.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/design/approval-panel.ts test/design/approval-panel.test.ts
git commit -m "feat(design): add approval panel state machine"
```

## Global Constraints

- 仅面向 Windows 桌面端 GUI；CLI 与 Web 不在范围内。
- 不替换现有 `Design.Service` 和 SQLite 存储层。
- 使用 Effect `Effect.gen` 和 `Effect.fn`；遵循 `src/effect/instance-state.ts` 进行 per-project 状态隔离。
- 模块组织使用 flat top-level exports + `export * as Namespace from "./file"`；禁止使用 `export namespace Foo`。
- 字段/列名使用 snake_case。
- 避免 `try`/`catch`，优先使用 Effect 错误通道。
- 测试从 `packages/opencode` 目录运行；不使用 root 运行测试。
- 类型检查使用 `bun run typecheck` from `packages/opencode`。

## Dependencies from Previous Tasks

- `GraphAgent.Output` type in `src/design/agent/types.ts`
