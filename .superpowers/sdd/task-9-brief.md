# Task 9: 实现系统辅助分析区

**Files:**
- Create: `src/design/system/analyzer.ts`
- Test: `test/design/system/analyzer.test.ts`

**Interfaces:**
- Consumes: `TemporaryWorkingSet`, `DesignTypes.GraphState`
- Produces: populated `systemAnalysis` fields

- [ ] **Step 1: Write the failing test**

```typescript
test("detects duplicate node candidates", () => {
  const graphState = {
    nodes: [
      { id: "n1", name: "UserService", contextId: "ctx", kind: "service" },
      { id: "n2", name: "UserSvc", contextId: "ctx", kind: "service" },
    ],
    edges: [],
    contexts: [{ id: "ctx", name: "core" }],
    prototypes: [],
  }
  const tws = WorkingSetComputer.fromInput("", { contextIds: ["ctx"], nodeIds: ["n1", "n2"], capacity: 10 }, graphState)
  const result = SystemAnalyzer.analyze(tws, graphState)
  expect(result.systemAnalysis.duplicateNodeCandidates.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Implement analyzer**

```typescript
// src/design/system/analyzer.ts
import * as GraphAgentTypes from "@/design/agent/types"

export const analyze = (
  tws: GraphAgentTypes.TemporaryWorkingSet,
  graphState: DesignTypes.GraphState
): GraphAgentTypes.TemporaryWorkingSet => {
  const orphanNodes = tws.nodeIds.filter((id) => {
    return !graphState.edges.some((e) => e.leftNodeId === id || e.rightNodeId === id)
  })

  const duplicateNodeCandidates: GraphAgentTypes.TemporaryWorkingSet["systemAnalysis"]["duplicateNodeCandidates"] = []
  // 简单启发式：名称编辑距离或共同前缀
  for (let i = 0; i < tws.nodeIds.length; i++) {
    for (let j = i + 1; j < tws.nodeIds.length; j++) {
      const a = graphState.nodes.find((n) => n.id === tws.nodeIds[i])!
      const b = graphState.nodes.find((n) => n.id === tws.nodeIds[j])!
      if (a.name.toLowerCase().includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(a.name.toLowerCase())) {
        duplicateNodeCandidates.push({ nodeIds: [a.id, b.id], similarityScore: 0.7 })
      }
    }
  }

  return {
    ...tws,
    systemAnalysis: {
      ...tws.systemAnalysis,
      orphanNodes,
      duplicateNodeCandidates,
    },
  }
}

export * as SystemAnalyzer from "./analyzer"
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/design/system/analyzer.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/design/system/analyzer.ts test/design/system/analyzer.test.ts
git commit -m "feat(design): add system-assisted graph analysis"
```

## Global Constraints

- 仅面向 Windows 桌面端 GUI；CLI 与 Web 不在范围内。
- 不替换现有 `Design.Service` 和 SQLite 存储层。
- 模块组织使用 flat top-level exports + `export * as Namespace from "./file"`；禁止使用 `export namespace Foo`。
- 字段/列名使用 snake_case。
- 测试从 `packages/opencode` 目录运行；不使用 root 运行测试。
- 类型检查使用 `bun run typecheck` from `packages/opencode`。

## Dependencies from Previous Tasks

- `GraphAgentTypes.TemporaryWorkingSet` in `src/design/agent/types.ts`
- `WorkingSetComputer` in `src/design/system/working-set-computer.ts`
- `DesignTypes.GraphState` in `src/design/core/types.ts`
