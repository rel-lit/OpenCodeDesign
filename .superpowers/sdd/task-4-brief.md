# Task 4: 实现 GraphAgent 执行写入

**Files:**
- Modify: `src/design/agent/graph.ts`
- Modify: `src/design/design.ts`（如需要 transaction 方法暴露）
- Test: `test/design/agent/graph-execute.test.ts`

**Interfaces:**
- Consumes: `Design.Service`, `GraphAgent.Output` with `delta`
- Produces: applied `GraphAgent.Output` and updated DB state

- [ ] **Step 1: Write the failing test**

```typescript
test("execute applies delta via Design.Service", async () => {
  const proposal: GraphAgentTypes.Output = {
    type: "change-proposal",
    summary: "rename node",
    affectedNodes: ["node-5"],
    affectedEdges: [],
    delta: { updateNodes: [{ id: "node-5", patch: { name: "UserServiceV2" } }] },
  }
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const ga = yield* GraphAgent.Service
      return yield* ga.execute(proposal)
    }).pipe(Effect.provide(/* test layers */))
  )
  expect(result.type).toBe("change-applied")
})
```

- [ ] **Step 2: Implement execute using Design.Service**

```typescript
const execute = Effect.fn("GraphAgent.execute")(
  function* (proposal: GraphAgentTypes.Output) {
    if (!proposal.delta) return yield* Effect.fail(new GraphAgentError.NoDelta())
    const design = yield* Design.Service
    yield* design.transaction(function* () {
      for (const node of proposal.delta?.addNodes ?? []) yield* design.createNode(node)
      for (const update of proposal.delta?.updateNodes ?? []) yield* design.updateNode(update.id, update.patch)
      for (const id of proposal.delta?.deleteNodeIds ?? []) yield* design.deleteNode(id)
      for (const edge of proposal.delta?.addEdges ?? []) yield* design.createEdge(edge)
      for (const update of proposal.delta?.updateEdges ?? []) yield* design.updateEdge(update.leftNodeId, update.rightNodeId, update.patch)
      for (const key of proposal.delta?.deleteEdgeKeys ?? []) yield* design.deleteEdge(key)
    })
    return { ...proposal, type: "change-applied" } as GraphAgentTypes.Output
  }
)
```

注意：如果 `Design.Service` 没有 `transaction` 方法，你需要在 `src/design/design.ts` 中增加一个事务包装方法，确保整组操作原子执行。

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/agent/graph-execute.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(design): implement GraphAgent execute writes via Design.Service"
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
- `GraphAgent.Output` / `GraphDelta` types in `src/design/agent/types.ts`
- `DesignAgentLlm.Service` in `src/design/agent/llm.ts`（Task 3）
