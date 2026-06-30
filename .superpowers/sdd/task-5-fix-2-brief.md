# Task 5 Second Fix Brief

Address the Important and Minor quality issues found in the Task 5 re-review for `packages/opencode/src/design/design.ts`.

## Issues to Fix

1. **Important: Remove unnecessary `as DesignState` type assertion**
   - Location: `packages/opencode/src/design/design.ts:87`
   - Current: `return { graph, workingSet, eventLog, store } as DesignState`
   - Expected: `return { graph, workingSet, eventLog, store }`
   - The object literal should already satisfy `DesignState`. If typecheck fails without the cast, investigate and fix the underlying type mismatch instead of masking it with `as`.

2. **Minor: Wrap `init` in `Effect.fn`**
   - Location: `packages/opencode/src/design/design.ts:179-183`
   - Current: `const init = () => Effect.gen(function* () { ... })`
   - Expected: `const init = Effect.fn("Design.init")(function* () { ... })`

3. **Minor: Use `import type` for `Scope`**
   - Location: `packages/opencode/src/design/design.ts:1`
   - Current: `import { Context, Effect, Layer, Scope } from "effect"`
   - Expected: `import { Context, Effect, Layer } from "effect"` and `import type { Scope } from "effect"`
   - `Scope` is only used as a type argument to `InstanceState.make`.

## Constraints

- Keep all existing tests passing.
- Run `bun typecheck` from `packages/opencode` after changes.
- Run `bun test test/design/design.test.ts`.
- Follow existing code style and the project's AGENTS.md Effect rules.

## Files to Modify

- `packages/opencode/src/design/design.ts`
