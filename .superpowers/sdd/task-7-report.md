# Task 7 Report: Update tools and agent integration

## What was verified

### 1. Tool implementation (`packages/opencode/src/tool/design.ts`)

- Imports `Design` from `@/design/design` and yields `Design.Service` for each of the 7 tools.
- All tool definitions use the per-instance `Design.Service` methods:
  - `design_resolve_reference` → `design.resolveReference`
  - `design_create_context` → `design.createContext`
  - `design_create_node` → `design.createNode`
  - `design_create_edge` → `design.createEdge`
  - `design_list_nodes` → `design.listNodes`
  - `design_list_edges` → `design.listEdges`
  - `design_show_working_set` → `design.listWorkingSet`
- Verified that `Design.Service` exposes all required methods (`createContext`, `createNode`, `createEdge`, `resolveReference`, `listNodes`, `listEdges`, `listWorkingSet`).
- No code changes were required.

### 2. Tool registration (`packages/opencode/src/tool/registry.ts`)

- All 7 design tools are imported from `./design`.
- Each tool is yielded and initialized in the registry builder.
- Each tool is included in the `builtin` tool array returned by `InstanceState.make<State>`.
- `Design.defaultLayer` is provided in `defaultLayer` and `Design.node` is listed as a dependency in `node`.
- No code changes were required.

### 3. Design agent permissions (`packages/opencode/src/agent/agent.ts`)

- The `design` agent has `mode: "primary"`, `native: true`, and `prompt: PROMPT_DESIGN`.
- Its permission set denies file/code tools (`read`, `grep`, `glob`, `bash`, `edit`, `write`, `apply_patch`, `task`) and allows all 7 design tools plus `question`.
- No code changes were required.

## Test results

```text
bun test test/tool/design.test.ts
 4 pass
 0 fail
 5 expect() calls
```

Typecheck also passes:

```text
bun typecheck
$ tsgo --noEmit
```

## Files changed

No source files were modified. This task was purely verification.

## Self-review findings

- All 7 design tools are registered: **yes**.
- Design agent permissions are correct: **yes**.
- Tool tests were run and pass: **yes**.
- Typecheck passes: **yes**.

## Issues or concerns

None. The per-instance `Design.Service` integration is already complete and working.
