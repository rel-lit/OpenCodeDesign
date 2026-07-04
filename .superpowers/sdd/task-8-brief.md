# Task 8: 实现临时工作集计算

**Files:**
- Create: `src/design/system/working-set-computer.ts`
- Test: `test/design/system/working-set-computer.test.ts`

**Interfaces:**
- Consumes: `@` references, active working set, keywords, proposed delta, graph state
- Produces: `TemporaryWorkingSet` (initial)

- [ ] **Step 1: Write the failing test**

```typescript
test("includes involved nodes, adjacent edges, and active nodes", () => {
  const graphState = {
    contexts: [{ id: "ctx-core", name: "core" }],
    nodes: [
      { id: "node-1", name: "OrderService", contextId: "ctx-core", kind: "service" },
      { id: "node-5", name: "UserService", contextId: "ctx-core", kind: "service" },
    ],
    edges: [{ leftNodeId: "node-1", rightNodeId: "node-5", label: "uses" }],
    prototypes: [],
  }
  const active = { contextIds: ["ctx-core"], nodeIds: ["node-5"], capacity: 10 }
  const result = WorkingSetComputer.fromInput("修改 @UserService", active, graphState)
  expect(result.nodeIds).toContain("node-5")
  expect(result.nodeIds).toContain("node-1") // 相邻节点
  expect(result.edgeKeys).toContain("node-1->node-5")
})
```

- [ ] **Step 2: Implement computer**

```typescript
// src/design/system/working-set-computer.ts
import * as GraphAgentTypes from "@/design/agent/types"

export const fromInput = (
  input: string,
  active: GraphAgentTypes.ActiveWorkingSet,
  graphState: DesignTypes.GraphState
): GraphAgentTypes.TemporaryWorkingSet => {
  const mentionedNames = Array.from(input.matchAll(/@([A-Za-z0-9_]+)/g)).map((m) => m[1])
  const mentionedNodeIds = mentionedNames
    .map((name) => graphState.nodes.find((n) => n.name === name)?.id)
    .filter((id): id is string => !!id)

  const involvedNodeIds = new Set([...active.nodeIds, ...mentionedNodeIds])
  const involvedEdgeKeys = new Set<string>()

  for (const edge of graphState.edges) {
    if (involvedNodeIds.has(edge.leftNodeId) || involvedNodeIds.has(edge.rightNodeId)) {
      involvedEdgeKeys.add(`${edge.leftNodeId}->${edge.rightNodeId}`)
      involvedNodeIds.add(edge.leftNodeId)
      involvedNodeIds.add(edge.rightNodeId)
    }
  }

  return {
    contextIds: [...new Set([...active.contextIds, ...Array.from(involvedNodeIds).map((id) => graphState.nodes.find((n) => n.id === id)!.contextId)])],
    nodeIds: [...involvedNodeIds],
    edgeKeys: [...involvedEdgeKeys],
    systemAnalysis: { conflictingRelations: [], duplicateNodeCandidates: [], orphanNodes: [], invalidPrototypeUsage: [] },
    expandedByGraphAgent: { contextIds: [], nodeIds: [], edgeKeys: [], reason: "" },
  }
}

export * as WorkingSetComputer from "./working-set-computer"
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/system/working-set-computer.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/design/system/working-set-computer.ts test/design/system/working-set-computer.test.ts
git commit -m "feat(design): implement temporary working set computer"
```

## Global Constraints

- 仅面向 Windows 桌面端 GUI；CLI 与 Web 不在范围内。
- 不替换现有 `Design.Service` 和 SQLite 存储层。
- 模块组织使用 flat top-level exports + `export * as Namespace from "./file"`；禁止使用 `export namespace Foo`。
- 字段/列名使用 snake_case。
- 测试从 `packages/opencode` 目录运行；不使用 root 运行测试。
- 类型检查使用 `bun run typecheck` from `packages/opencode`。

## Dependencies from Previous Tasks

- `GraphAgentTypes.TemporaryWorkingSet` / `ActiveWorkingSet` in `src/design/agent/types.ts`
- `DesignTypes.GraphState` in `src/design/core/types.ts`
