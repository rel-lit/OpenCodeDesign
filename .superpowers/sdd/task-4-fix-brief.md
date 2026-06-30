# Task 4 Fix Brief

Fix the Important issues found in Task 4 review for `packages/opencode/src/design/store/store.ts`.

## Issues to Fix

1. **Public `transaction` signature exposes `SqlError`**
   - Current: `transaction: <A, E, R>(f: ...) => Effect.Effect<A, E | SqlError, R>`
   - Expected: `transaction: <A, E, R>(f: ...) => Effect.Effect<A, E, R>`
   - Implementation: wrap `db.transaction(...)` with `Effect.orDie` so SQL errors become defects, matching the other store operations.
   - Remove the `SqlError` import if no longer needed.

2. **Use of `any` in row mappers**
   - Current: `(row as any).column_name` in `rowFromContext`, `rowFromNode`, `rowFromEdge`, `rowFromPrototype`, `rowFromEvent`.
   - Expected: define narrow TypeScript interfaces for each raw SQLite row shape and use them instead of `unknown` + `as any`.
   - Example:
     ```typescript
     interface ContextRow { id: string; name: string; semantics: string; node_ids: string }
     const rowFromContext = (row: ContextRow): DesignTypes.BoundedContext => ({ ... })
     ```
   - The `db.all` queries return `unknown[]`, so cast once at the call site or accept the row type in the mapper.

3. **Raw `fs/promises` instead of Effect's `FileSystem`**
   - Current: `import fs from "fs/promises"` and `yield* Effect.promise(() => fs.mkdir(designDir, { recursive: true }))`
   - Expected: use `FileSystem.FileSystem` from `@opencode-ai/core/filesystem`.
   - Implementation:
     ```typescript
     import { FileSystem } from "@opencode-ai/core/filesystem"
     // ...
     const fs = yield* FileSystem.Service
     yield* fs.makeDirectory(designDir, { recursive: true })
     ```
   - Verify the `FileSystem.makeDirectory` signature matches this call.

## Constraints

- Keep all existing tests passing.
- Run `bun typecheck` from `packages/opencode` and `packages/core` after changes.
- Run `bun test test/design/store/store.test.ts`.
- Follow existing code style and the project's AGENTS.md Effect rules.

## Files to Modify

- `packages/opencode/src/design/store/store.ts`
