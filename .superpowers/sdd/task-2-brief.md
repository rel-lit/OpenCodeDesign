# Task 2: 创建 GraphAgent 服务骨架

**Files:**
- Create: `src/design/agent/graph.ts`
- Create: `src/design/agent/prompt/graph.txt`
- Modify: `src/agent/agent.ts`
- Test: `test/design/agent/graph.test.ts`

**Interfaces:**
- Consumes: `GraphAgent.Input` / `Output`, `Design.Service`
- Produces: `GraphAgent.Service` with `analyze(input)` and `execute(proposal)` methods

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { GraphAgent } from "@/design/agent/graph"
import * as GraphAgentTypes from "@/design/agent/types"

describe("GraphAgent service", () => {
  test("analyze returns change-proposal for trivial rename", async () => {
    const input: GraphAgentTypes.Input = {
      source: "chat",
      userInput: "rename UserService to UserServiceV2",
      temporaryWorkingSet: {
        contextIds: ["ctx-core"],
        nodeIds: ["node-5"],
        edgeKeys: [],
        systemAnalysis: { conflictingRelations: [], duplicateNodeCandidates: [], orphanNodes: [], invalidPrototypeUsage: [] },
        expandedByGraphAgent: { contextIds: [], nodeIds: [], edgeKeys: [], reason: "" },
      },
      activeWorkingSet: { contextIds: ["ctx-core"], nodeIds: ["node-5"], capacity: 10 },
      graphState: { contexts: [], nodes: [{ id: "node-5", name: "UserService", contextId: "ctx-core", kind: "service" }], edges: [], prototypes: [] },
      proposedChange: { updateNodes: [{ id: "node-5", patch: { name: "UserServiceV2" } }] },
    }
    const program = Effect.gen(function* () {
      const ga = yield* GraphAgent.Service
      return yield* ga.analyze(input)
    })
    expect(program).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/design/agent/graph.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement minimal service skeleton**

```typescript
// src/design/agent/graph.ts
import { Context, Effect } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import * as GraphAgentTypes from "./types"
import PROMPT_GRAPH from "./prompt/graph.txt"

export interface Interface {
  readonly analyze: (input: GraphAgentTypes.Input) => Effect.Effect<GraphAgentTypes.Output>
  readonly execute: (proposal: GraphAgentTypes.Output) => Effect.Effect<GraphAgentTypes.Output>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignGraphAgent") {}
export const use = serviceUse(Service)

export const layer = Effect.gen(function* () {
  const analyze = Effect.fn("GraphAgent.analyze")(
    (input: GraphAgentTypes.Input): Effect.Effect<GraphAgentTypes.Output> => {
      return Effect.succeed({
        type: "change-proposal",
        summary: `Proposed change for ${input.userInput}`,
        affectedNodes: input.temporaryWorkingSet.nodeIds,
        affectedEdges: input.temporaryWorkingSet.edgeKeys,
        delta: input.proposedChange,
      })
    }
  )

  const execute = Effect.fn("GraphAgent.execute")(
    (proposal: GraphAgentTypes.Output): Effect.Effect<GraphAgentTypes.Output> => {
      return Effect.succeed({ ...proposal, type: "change-applied" })
    }
  )

  return { analyze, execute }
}).pipe(Effect.map(Service.make))

export * as GraphAgent from "./graph"
```

- [ ] **Step 4: Register GraphAgent as subagent**

Modify `src/agent/agent.ts` to register a new subagent named `design-graph`:

```typescript
const graphAgentInfo: Info = {
  name: "design-graph",
  description: "Analyzes design graphs, generates change proposals, and executes approved writes.",
  mode: "subagent",
  native: true,
  permission: Permission.fromConfig({ /* 只允许 design_* 工具 */ }),
  prompt: PROMPT_GRAPH,
  options: {},
}
```

For permissions, start with the same design tool permissions used by the existing design agent.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/design/agent/graph.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/design/agent/graph.ts src/design/agent/prompt/graph.txt src/agent/agent.ts test/design/agent/graph.test.ts
git commit -m "feat(design): add GraphAgent service skeleton and register as subagent"
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
