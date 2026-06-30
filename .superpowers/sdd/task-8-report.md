# Task 8 Report: Remove legacy JSON/JSONL persistence

## What was deleted/changed

- Deleted `packages/opencode/src/design/core/persistence.ts` (legacy JSON/JSONL persistence service)
- Deleted `packages/opencode/test/design/core/persistence.test.ts` (legacy persistence tests)
- Removed `export * as Persistence from "./core/persistence"` from `packages/opencode/src/design/index.ts`

## Verification

- Grepped `packages/opencode` for `core/persistence`: no remaining matches.
- `bun typecheck` in `packages/opencode` passed (`tsgo --noEmit`).
- `bun test test/design` in `packages/opencode` passed: 22 tests, 0 failures.

## Files changed

- `packages/opencode/src/design/core/persistence.ts` (deleted)
- `packages/opencode/test/design/core/persistence.test.ts` (deleted)
- `packages/opencode/src/design/index.ts` (removed `Persistence` re-export)

## Self-review findings

- Both legacy files were deleted.
- The `Persistence` re-export was removed from `src/design/index.ts`.
- No other imports of `core/persistence` remain.
- Typecheck and design tests pass.
- Commit scoped only to the three intended files; unrelated working-tree changes were left unstaged.

## Issues or concerns

None.
