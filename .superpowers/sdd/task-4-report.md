# Task 4 Report: Create DesignStore SQLite schema and service

## What I Implemented

1. **Exported `DatabaseShape` from `@opencode-ai/core/database`**
   - Modified `packages/core/src/database/database.ts` to export the existing `DatabaseShape` type so consumers can structurally depend on it.

2. **Created `DesignStore` service (`packages/opencode/src/design/store/store.ts`)**
   - Defined a `Store` interface with `ensureSchema`, `loadGraphState`, `saveGraphState`, `appendEvent`, `listEvents`, and `transaction`.
   - Implemented `makeStore(db: DbLike)` using raw `CREATE TABLE IF NOT EXISTS` statements and `sql`-tagged parameterized queries via `drizzle-orm`.
   - Used `InstanceState.make` so each project directory gets its own `.opencode/design/design.sqlite` database, creating the directory before opening the db.
   - Wired up the public service layer and `LayerNode` node with `Database.node` as a dependency.

3. **Created tests (`packages/opencode/test/design/store/store.test.ts`)**
   - Added missing `DesignTypes` import and wrote two instance-scoped tests verifying schema creation / graph persistence and event append/list behavior.

## Deviations from the Task Brief

The brief's `Store` interface omitted the database error types that `EffectDrizzleSqlite` returns. To make the code typecheck while keeping the public surface as simple as possible:

- Individual store operations (`run`/`all`) are wrapped with `.pipe(Effect.orDie)`, so their signatures remain `Effect.Effect<void>` / `Effect.Effect<...>` as shown in the brief.
- The `transaction` signature was updated to `Effect.Effect<A, E | SqlError, R>` to accurately reflect the transaction primitive's actual error and requirement types.

These are the minimal type-correctness adjustments required; runtime behavior matches the spec.

## What I Tested

- Focused test: `bun test test/design/store/store.test.ts` — 2 pass
- Full design suite: `bun test test/design` — 23 pass, 0 fail
- Typecheck:
  - `cd packages/opencode && bun typecheck` — clean
  - `cd packages/core && bun typecheck` — clean

## Files Changed

- `packages/core/src/database/database.ts`
- `packages/opencode/src/design/store/store.ts` (new)
- `packages/opencode/test/design/store/store.test.ts` (new)
- `.superpowers/sdd/task-4-report.md` (this report)

## Self-Review Findings

- All spec-mandated operations are implemented.
- Tests verify persistence and event ordering, not just mocked behavior.
- Typecheck and full design test suite are pristine.
- The only concerns are the intentional interface adjustments for database error types, noted above.

---

# Task 4 Fix Report

## What I Fixed

1. **Public `transaction` signature no longer leaks `SqlError`**
   - Removed the `SqlError` import from `effect/unstable/sql/SqlError`.
   - Changed the `Store.transaction` signature from `Effect.Effect<A, E | SqlError, R>` to `Effect.Effect<A, E, R>`.
   - Wrapped `db.transaction(...)` with `.pipe(Effect.orDie)` so SQL-level errors become defects, matching the other store operations.

2. **Row mappers are now typed instead of using `any`**
   - Added narrow TypeScript interfaces for each raw SQLite row shape: `ContextRow`, `NodeRow`, `EdgeRow`, `PrototypeRow`, and `EventRow`.
   - Updated `rowFromContext`, `rowFromNode`, `rowFromEdge`, `rowFromPrototype`, and `rowFromEvent` to accept these typed rows.
   - Cast the `unknown[]` results from `db.all` once at each call site (`loadGraphState` and `listEvents`) to the appropriate row type.

3. **Directory creation uses an Effect file-system service instead of raw `fs/promises`**
   - Replaced the `fs/promises` import and `Effect.promise(() => fs.mkdir(...))` call with `FSUtil.Service` from `@opencode-ai/core/fs-util`.
   - Used `fs.makeDirectory(designDir, { recursive: true }).pipe(Effect.orDie)`.
   - Updated `defaultLayer` to provide `FSUtil.defaultLayer` and added `FSUtil.node` to the `LayerNode` dependencies.

## Test Results

- `bun test test/design/store/store.test.ts` — 2 pass, 0 fail

## Typecheck Results

- `cd packages/opencode && bun typecheck` — clean
- `cd packages/core && bun typecheck` — clean

## Files Changed

- `packages/opencode/src/design/store/store.ts`
- `.superpowers/sdd/task-4-report.md` (this report)

## Issues or Concerns

- The fix brief suggested using `FileSystem.FileSystem` from `@opencode-ai/core/filesystem`, but that project's `FileSystem.Service` interface does not expose `makeDirectory`. I used `FSUtil.Service` instead, which wraps Effect's `FileSystem.FileSystem` and is the established pattern elsewhere in `packages/opencode` (e.g., `src/worktree/index.ts`). This satisfies the intent of replacing raw `fs/promises` with an Effect-aware file-system service and keeps the call signature (`makeDirectory(path, { recursive: true })`) identical to the brief's example.
