# Task 1: 定义 GraphAgent 核心类型与接口

**Files:**
- Create: `src/design/agent/types.ts`
- Modify: `src/design/core/types.ts`（如需补充字段）
- Test: `test/design/agent/types.test.ts`

**Interfaces:**
- Consumes: `DesignTypes.GraphState`, `DesignTypes.Node`, `DesignTypes.Edge` from `src/design/core/types.ts`
- Produces: `GraphAgent.Input`, `GraphAgent.Output`, `GraphDelta` 类型

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test"
import { GraphAgent } from "@/design/agent/types"

describe("GraphAgent types", () => {
  test("input schema accepts chat source with proposed change", () => {
    const input: GraphAgent.Input = {
      source: "chat",
      userInput: "rename UserService",
      temporaryWorkingSet: {
        contextIds: ["ctx-core"],
        nodeIds: ["node-5"],
        edgeKeys: [],
        systemAnalysis: {
          conflictingRelations: [],
          duplicateNodeCandidates: [],
          orphanNodes: [],
          invalidPrototypeUsage: [],
        },
        expandedByGraphAgent: {
          contextIds: [],
          nodeIds: [],
          edgeKeys: [],
          reason: "",
        },
      },
      activeWorkingSet: { contextIds: ["ctx-core"], nodeIds: ["node-5"], capacity: 10 },
      graphState: { contexts: [], nodes: [], edges: [], prototypes: [] },
      proposedChange: {
        updateNodes: [{ id: "node-5", patch: { name: "UserServiceV2" } }],
      },
      knownVersion: 1,
    }
    expect(input.source).toBe("chat")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/design/agent/types.test.ts`
Expected: FAIL with module not found or type not found.

- [ ] **Step 3: Implement minimal types**

```typescript
// src/design/agent/types.ts
import { DesignTypes } from "@/design/core/types"

export interface TemporaryWorkingSet {
  contextIds: string[]
  nodeIds: string[]
  edgeKeys: string[]
  systemAnalysis: {
    conflictingRelations: Array<{
      edgeKey: string
      reason: string
      severity: "error" | "warning"
    }>
    duplicateNodeCandidates: Array<{ nodeIds: string[]; similarityScore: number }>
    orphanNodes: string[]
    invalidPrototypeUsage: Array<{ edgeKey: string; prototypeId: string; reason: string }>
  }
  expandedByGraphAgent: {
    contextIds: string[]
    nodeIds: string[]
    edgeKeys: string[]
    reason: string
  }
}

export interface ActiveWorkingSet {
  contextIds: string[]
  nodeIds: string[]
  capacity: number
}

export interface GraphDelta {
  addNodes?: DesignTypes.Node[]
  updateNodes?: Array<{ id: string; patch: Partial<DesignTypes.Node> }>
  deleteNodeIds?: string[]
  addEdges?: DesignTypes.Edge[]
  updateEdges?: Array<{ leftNodeId: string; rightNodeId: string; patch: Partial<DesignTypes.Edge> }>
  deleteEdgeKeys?: string[]
}

export interface Input {
  source: "chat" | "visual-editor"
  userInput: string
  temporaryWorkingSet: TemporaryWorkingSet
  activeWorkingSet: ActiveWorkingSet
  graphState: DesignTypes.GraphState
  proposedChange?: GraphDelta
  knownVersion?: number
}

export interface Output {
  type: "enriched-input" | "graph-summary" | "change-proposal" | "change-applied" | "rejected"
  summary: string
  structured?: {
    warnings?: Array<{ code: string; message: string; nodeId?: string; edgeKey?: string }>
    suggestions?: Array<{ action: string; reason: string }>
  }
  affectedNodes: string[]
  affectedEdges: string[]
  questions?: string[]
  delta?: GraphDelta
}

export * as GraphAgent from "./types"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/design/agent/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/design/agent/types.ts test/design/agent/types.test.ts
git commit -m "feat(design): define GraphAgent core types"
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
