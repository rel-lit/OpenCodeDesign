# Task 10: 整合预处理流程到 Design 服务

**Files:**
- Modify: `src/design/design.ts`
- Modify: `src/design/system/preprocessor.ts`
- Test: `test/design/design-preprocess.test.ts`

**Interfaces:**
- Consumes: raw user input
- Produces: processed input text, enriched input from GraphAgent

- [ ] **Step 1: Write the failing test**

```typescript
test("preprocess returns processed input for ChatAgent", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const design = yield* Design.Service
      return yield* design.preprocessInput("修改 @UserService")
    }).pipe(Effect.provide(/* test layers */))
  )
  expect(result.processedText).toContain("节点 ID")
})
```

- [ ] **Step 2: Implement preprocessInput in Design.Service**

```typescript
preprocessInput: (input: string) => Effect.Effect<{
  processedText: string
  temporaryWorkingSet: GraphAgentTypes.TemporaryWorkingSet
  enriched?: GraphAgentTypes.Output
}>
```

实现：
1. 获取当前图状态、活跃工作集。
2. `@` 展开。
3. 计算临时工作集。
4. 系统辅助分析。
5. 阈值判断：若触发，调用 GraphAgent.analyze 返回 enriched input。
6. 生成 processedText。

注意：阈值判断可以先用简单启发式（输入包含 `@`、临时工作集非空、输入长度等）。后续可细化。

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/design-preprocess.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(design): integrate system preprocessor into Design.Service"
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

- `Preprocessor.expandAtReferences` in `src/design/system/preprocessor.ts`
- `WorkingSetComputer.fromInput` in `src/design/system/working-set-computer.ts`
- `SystemAnalyzer.analyze` in `src/design/system/analyzer.ts`
- `GraphAgent.Service` in `src/design/agent/graph.ts`
