# Task 7: 实现 @ 引用展开

**Files:**
- Create: `src/design/system/preprocessor.ts`
- Test: `test/design/system/preprocessor.test.ts`

**Interfaces:**
- Consumes: raw user input string, current graph state
- Produces: input with `@` references expanded

- [ ] **Step 1: Write the failing test**

```typescript
test("expands @UserService to node summary", () => {
  const graphState = {
    nodes: [{ id: "node-5", name: "UserService", contextId: "ctx-core", kind: "service" }],
    contexts: [{ id: "ctx-core", name: "core" }],
    edges: [],
    prototypes: [],
  }
  const result = expandAtReferences("修改 @UserService 的依赖", graphState)
  expect(result).toContain("UserService（节点 ID: node-5")
})
```

- [ ] **Step 2: Implement expansion**

```typescript
// src/design/system/preprocessor.ts
export const expandAtReferences = (input: string, graphState: DesignTypes.GraphState): string => {
  const pattern = /@([A-Za-z0-9_]+)/g
  return input.replace(pattern, (match, name) => {
    const node = graphState.nodes.find((n) => n.name === name)
    if (!node) return match
    const ctx = graphState.contexts.find((c) => c.id === node.contextId)
    return `${match}（节点 ID: ${node.id}，类型: ${node.kind}，上下文: ${ctx?.name ?? node.contextId}）`
  })
}

export * as Preprocessor from "./preprocessor"
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/system/preprocessor.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/design/system/preprocessor.ts test/design/system/preprocessor.test.ts
git commit -m "feat(design): implement @ reference expansion"
```

## Global Constraints

- 仅面向 Windows 桌面端 GUI；CLI 与 Web 不在范围内。
- 不替换现有 `Design.Service` 和 SQLite 存储层。
- 模块组织使用 flat top-level exports + `export * as Namespace from "./file"`；禁止使用 `export namespace Foo`。
- 字段/列名使用 snake_case。
- 测试从 `packages/opencode` 目录运行；不使用 root 运行测试。
- 类型检查使用 `bun run typecheck` from `packages/opencode`。

## Dependencies from Previous Tasks

- `DesignTypes.GraphState` in `src/design/core/types.ts`
