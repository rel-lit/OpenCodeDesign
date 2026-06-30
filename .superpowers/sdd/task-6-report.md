## Task 6: Wire `Design.Service` into `InstanceBootstrap`

- **Status:** DONE
- **Commits:**
  - `26c213e8f` feat(design): initialize Design.Service during InstanceBootstrap
- **Typecheck:** `bun typecheck` passed from `packages/opencode` (no errors)
- **Concerns:** None
- **Report file path:** D:\RLDemos\OpenCodeDesign\.superpowers\sdd\task-6-report.md

### What was implemented

Modified `packages/opencode/src/project/bootstrap.ts` to wire `Design.Service` into the `InstanceBootstrap` initialization sequence:

1. Added `import { Design } from "@/design/design"`.
2. Yielded `Design.Service` alongside the other bootstrap dependencies so `run` remains `R = never`.
3. Included `design` in the `Effect.forEach` init batch so its `init()` is called after plugin init.
4. Added `Design.defaultLayer` to `defaultLayer` providers.
5. Added `Design.node` to `LayerNode` deps.

This ensures Design state is loaded automatically when a project instance starts, rather than lazily when the user first enters Design mode.

### Files changed

- `packages/opencode/src/project/bootstrap.ts`

### Self-review findings

- The change matches the task brief exactly.
- `Design.Service` already exposes `init()`, `defaultLayer`, and `node`, so no changes to `bootstrap-service.ts` or `design.ts` were needed.
- Typecheck passes cleanly.
- Only the intended file was committed.
