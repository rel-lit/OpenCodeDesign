# Task 3: 实现 GraphAgent LLM 调用（变更提案）

**Files:**
- Modify: `src/design/agent/graph.ts`
- Modify: `src/design/agent/prompt/graph.txt`
- Test: `test/design/agent/graph.test.ts`

**Interfaces:**
- Consumes: `Provider.Service` / `ModelV2` for object generation
- Produces: `GraphAgent.Output` with structured `change-proposal`

- [ ] **Step 1: Write the failing test**

```typescript
test("analyze returns structured change-proposal", async () => {
  const input = makeSampleInput()
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const ga = yield* GraphAgent.Service
      return yield* ga.analyze(input)
    }).pipe(Effect.provide(/* mock layer */))
  )
  expect(result.type).toBe("change-proposal")
  expect(result.summary).toBeTruthy()
  expect(result.affectedNodes).toContain("node-5")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/design/agent/graph.test.ts -t "analyze returns structured change-proposal"`
Expected: FAIL (LLM not wired).

- [ ] **Step 3: Wire object generation with mockable provider**

使用 `ai` SDK 的 `generateObject`，通过 provider 服务注入。先实现一个 `mockLayer` 用于测试。

```typescript
// src/design/agent/graph.ts
const analyzeWithLLM = Effect.fn("GraphAgent.analyzeWithLLM")(
  function* (input: GraphAgentTypes.Input) {
    // 构造 prompt：包含临时工作集、系统分析、 proposedChange
    const prompt = buildPrompt(input)
    // 调用 generateObject
    const result = yield* DesignAgentLlm.generateObject({
      prompt,
      schema: GraphAgentOutputSchema, // 使用 Schema 约束输出
    })
    return result.object as GraphAgentTypes.Output
  }
)
```

注意：如果项目里已有 `generateObject` 的封装，优先复用；如果没有，使用 `ai` SDK 的 `generateObject` 并注入 provider/model。

- [ ] **Step 4: Add prompt template**

`src/design/agent/prompt/graph.txt`:
```
You are GraphAgent, a design-graph analysis engine.
You receive a temporary working set, system-automated analysis hints, and an optional proposed change.
Your job:
1. Analyze the design for conflicts, duplicates, orphaned nodes, invalid prototype usage.
2. If a proposed change is provided, evaluate it and return a change-proposal or rejected response.
3. If no proposed change is provided, return an enriched-input or graph-summary.
Always respond with natural language summary in "summary" and structured hints in "structured".
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/design/agent/graph.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(design): wire GraphAgent LLM for change proposals"
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

- `GraphAgent.Service` skeleton in `src/design/agent/graph.ts`
- `GraphAgent.Input` / `Output` types in `src/design/agent/types.ts`
