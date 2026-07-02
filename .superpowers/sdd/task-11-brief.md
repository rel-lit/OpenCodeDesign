# Task 11: 定义 SearchAgent 类型与服务

**Files:**
- Create: `src/design/agent/search.ts`
- Create: `src/design/agent/prompt/search.txt`
- Modify: `src/agent/agent.ts`
- Test: `test/design/agent/search.test.ts`

**Interfaces:**
- Consumes: `graphSummary`, `retrievalRequirements`
- Produces: `summaryReport`, `diffAnalysis`, `nonGraphInfo`

- [ ] **Step 1: Write the failing test**

```typescript
import { SearchAgent } from "@/design/agent/search"

test("search agent returns summary report", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const sa = yield* SearchAgent.Service
      return yield* sa.search({
        graphSummary: "设计包含 UserService 和 OrderService",
        retrievalRequirements: "对比项目实现",
      })
    }).pipe(Effect.provide(/* mock layer */))
  )
  expect(result.summaryReport).toBeTruthy()
})
```

- [ ] **Step 2: Implement SearchAgent skeleton**

```typescript
// src/design/agent/search.ts
import { Context, Effect } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import PROMPT_SEARCH from "./prompt/search.txt"

export interface Input {
  graphSummary: string
  retrievalRequirements: string
  focus?: { contextIds?: string[]; nodeIds?: string[] }
}

export interface Output {
  summaryReport: string
  diffAnalysis?: {
    missingInCode: Array<{ nodeId?: string; name: string; reason: string }>
    divergentRelations: Array<{ designEdge?: string; actualCode: string; reason: string }>
    references: Array<{ file: string; line?: number; snippet: string }>
  }
  nonGraphInfo?: Array<{ type: "text" | "link"; content: string }>
}

export interface Interface {
  readonly search: (input: Input) => Effect.Effect<Output>
  readonly readProject: (graphSummary: string) => Effect.Effect<Output>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignSearchAgent") {}
export const use = serviceUse(Service)

export const layer = Effect.gen(function* () {
  const search = Effect.fn("SearchAgent.search")(
    (input: Input): Effect.Effect<Output> => {
      return Effect.succeed({
        summaryReport: `Search result for: ${input.retrievalRequirements}`,
      })
    }
  )
  const readProject = Effect.fn("SearchAgent.readProject")(
    (graphSummary: string): Effect.Effect<Output> => {
      return Effect.succeed({ summaryReport: "Project read placeholder" })
    }
  )
  return { search, readProject }
}).pipe(Effect.map(Service.make))

export * as SearchAgent from "./search"
```

- [ ] **Step 3: Register SearchAgent as subagent**

在 `src/agent/agent.ts` 中注册 `design-search`。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/design/agent/search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(design): add SearchAgent service skeleton and register as subagent"
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
