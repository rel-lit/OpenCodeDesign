### Task 7: Update tools and agent integration

**Files:**
- Modify: `packages/opencode/src/tool/design.ts`
- Verify: `packages/opencode/src/tool/registry.ts`
- Verify: `packages/opencode/src/agent/agent.ts`

**Interfaces:**
- Consumes: `Design.Service`.
- Produces: same 7 `design_*` tools, now operating on per-instance state.

**Why:** Tools should require zero changes except that `Design.Service` is now per-instance. This task is mostly verification.

- [ ] **Step 1: Update tool imports if necessary**

`packages/opencode/src/tool/design.ts` already imports `Design` from `@/design/design` and yields `Design.Service`. No changes should be needed. If `Design.Service` interface lost any methods used by tools, restore them.

- [ ] **Step 2: Verify tool registration**

In `packages/opencode/src/tool/registry.ts`, confirm the 7 Design tools are registered and exported. If not, add them:

```typescript
import {
  DesignCreateContextTool,
  DesignCreateEdgeTool,
  DesignCreateNodeTool,
  DesignListEdgesTool,
  DesignListNodesTool,
  DesignResolveReferenceTool,
  DesignShowWorkingSetTool,
} from "./design"

// ... inside registry builder
DesignCreateContextTool,
DesignCreateEdgeTool,
DesignCreateNodeTool,
DesignListEdgesTool,
DesignListNodesTool,
DesignResolveReferenceTool,
DesignShowWorkingSetTool,
```

- [ ] **Step 3: Verify Design agent permissions**

In `packages/opencode/src/agent/agent.ts`, confirm the `design` agent has:

```typescript
permission: Permission.merge(
  defaults,
  Permission.fromConfig({
    question: "allow",
    read: "deny",
    grep: "deny",
    glob: "deny",
    bash: "deny",
    edit: "deny",
    write: "deny",
    apply_patch: "deny",
    task: "deny",
    design_resolve_reference: "allow",
    design_create_context: "allow",
    design_create_node: "allow",
    design_create_edge: "allow",
    design_list_nodes: "allow",
    design_list_edges: "allow",
    design_show_working_set: "allow",
  }),
  user,
),
mode: "primary",
native: true,
prompt: PROMPT_DESIGN,
```

No changes should be needed.

- [ ] **Step 4: Run tool tests**

```bash
cd packages/opencode
bun test test/tool/design.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

If no changes were required:

```bash
git commit --allow-empty -m "chore(design): verify tool and agent integration"
```

If changes were required:

```bash
git add packages/opencode/src/tool/design.ts packages/opencode/src/tool/registry.ts packages/opencode/src/agent/agent.ts
git commit -m "chore(design): verify tool and agent integration"
```

---
