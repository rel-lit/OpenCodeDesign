# Task 6: 让 Design 主 Agent 走 GraphAgent 提案流程

**Files:**
- Modify: `src/agent/prompt/design.txt`
- Modify: `src/tool/design.ts`
- Modify: `src/design/design.ts`
- Test: `test/tool/design.test.ts`

**Interfaces:**
- Consumes: `GraphAgent.Service`, `ApprovalPanel.Interface`
- Produces: design tool calls now grouped and routed through GraphAgent

- [ ] **Step 1: Write the failing test**

```typescript
test("design tool group routes through GraphAgent proposal", async () => {
  // 模拟 ChatAgent 一次响应中连续调用两个 design 工具
  // 验证它们被归为一组并交给 GraphAgent.analyze
})
```

- [ ] **Step 2: Implement tool call grouping in design.ts service**

在 `src/design/design.ts` 中新增 `proposeChanges(delta)` 方法：

```typescript
proposeChanges: (delta: GraphAgentTypes.GraphDelta) => Effect.Effect<GraphAgentTypes.Output>
```

该方法：
1. 构建临时工作集。
2. 调用 `GraphAgent.analyze`。
3. 将提案放入审批面板（系统 UI 触发）。
4. 等待用户确认后调用 `GraphAgent.execute`。

注意：由于当前阶段系统层预处理（Task 7-10）尚未实现，`proposeChanges` 可以先使用一个简化的临时工作集（仅包含 delta 直接涉及的节点/边 + 当前活跃工作集）。后续 Task 10 会替换为完整的系统预处理。

- [ ] **Step 3: Update Design agent prompt**

更新 `src/agent/prompt/design.txt`，让 ChatAgent 知道：
- 不要直接修改图。
- 一次性提出一组 `design_*` 操作。
- 用户会在审批面板确认后执行。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/tool/design.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(design): route design tool calls through GraphAgent approval flow"
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

- `GraphAgent.Service` in `src/design/agent/graph.ts`
- `ApprovalPanel` in `src/design/approval-panel.ts`
- `GraphAgent.GraphDelta` type in `src/design/agent/types.ts`
