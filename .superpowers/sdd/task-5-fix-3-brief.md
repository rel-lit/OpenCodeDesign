# Task 5 Third Fix Brief

Address the Important observability/style issue found in the final Task 5 re-review for `packages/opencode/src/design/design.ts`.

## Issue

Public methods and `persistMutation` are anonymous `Effect.gen` blocks. AGENTS.md requires using `Effect.fn("Domain.method")` for named/traced effects.

## Fix Requirements

1. Wrap each of the following in `Effect.fn("Design.<name>")`:
   - `persistMutation` → `Effect.fn("Design.persistMutation")`
   - `createContext` → `Effect.fn("Design.createContext")`
   - `createNode` → `Effect.fn("Design.createNode")`
   - `createEdge` → `Effect.fn("Design.createEdge")`
   - `resolveReference` → `Effect.fn("Design.resolveReference")`
   - `getState` → `Effect.fn("Design.getState")`
2. Ensure the signatures and behavior remain identical; only add naming/tracing.
3. Keep `init` already wrapped as `Effect.fn("Design.init")`.

## Constraints

- Keep all existing tests passing.
- Run `bun typecheck` from `packages/opencode` after changes.
- Run `bun test test/design/design.test.ts`.
- Follow existing code style and the project's AGENTS.md Effect rules.

## Files to Modify

- `packages/opencode/src/design/design.ts`
