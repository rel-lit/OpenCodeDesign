# Task 5 Report: Rewrite `Design.Service` as per-instance facade

## What was implemented

Rewrote `packages/opencode/src/design/design.ts` so `Design.Service` becomes a per-instance facade backed by SQLite via `DesignStore`.

Key changes:
- `Design.Service` now uses `InstanceState.make<DesignState>` to create one private `{ graph, workingSet, eventLog, store }` tuple per project directory.
- On instance startup, the service loads the previously persisted graph state from SQLite and re-hydrates the in-memory `GraphEngine`, `WorkingSet`, and `EventLog`.
- Every mutating operation (`createContext`, `createNode`, `createEdge`, `resolveReference`) appends an event and then calls `persistMutation`, which runs `store.transaction` to save the graph state and append the event atomically.
- Removed the old `save`/`load` methods from the public interface and replaced them with `init()`.
- `Design.defaultLayer` now provides `DesignStore.defaultLayer` instead of the old `GraphEngine`/`WorkingSet`/`EventLog`/`Persistence` layers.
- `Design.node` dependency list updated to `[DesignStore.node]`.
- Exported `Design.stateRef` so tests can invalidate per-instance state.

Note: the brief placed `yield* DesignStore.Service` inside the `InstanceState.make` initializer. To satisfy Effect's requirement tracking, the `DesignStore.Service` is yielded at the layer level and captured in the initializer closure. This keeps the `InstanceState`'s requirement set to `Scope.Scope` only, so the public `Design.Service` methods do not leak the `DesignStore` dependency.

## Files changed

- `packages/opencode/src/design/design.ts` (rewritten)
- `packages/opencode/test/design/design.test.ts` (new integration test)

## What was tested

Created `packages/opencode/test/design/design.test.ts` with one integration test:
- Creates a context, two nodes, and an edge.
- Verifies two nodes exist.
- Invalidates `Design.stateRef` to simulate a reload.
- Re-acquires `Design.Service`, calls `init()`.
- Verifies both nodes and the edge are restored from SQLite.

### Test results

```
bun test test/design/design.test.ts
 1 pass
 0 fail
```

Full design suite:

```
bun test test/design
 24 pass
 0 fail
```

Package-wide typecheck:

```
bun typecheck
(no errors)
```

## Self-review findings

- All spec requirements implemented.
- Typecheck is clean.
- All design tests pass.
- The mutable module-level `stateRef` works for the current single-test usage but could race if multiple test files concurrently build `Design.defaultLayer` and access `Design.stateRef`. This is acceptable for the current milestone because only the new test uses it, and the assignment/use are sequential within each test's Effect fiber.
- The integration test verifies real SQLite persistence, not mocked behavior.

## Concerns

- `Design.stateRef` is a mutable module-level export. It is intended only for tests and should not be used from production code.
- If a SQLite transaction fails after the in-memory graph has been mutated, the in-memory state and SQLite state will diverge. This matches the note in the brief and is accepted for this milestone.

---

# Task 5 Fix Report: Remove mutable `stateRef` export

## What was fixed

Removed the mutable module-level `stateRef` export from `packages/opencode/src/design/design.ts` and updated the integration test to verify SQLite persistence through `InstanceStore.reload` instead.

Key changes:
- Removed `export let stateRef: InstanceState.InstanceState<DesignState, never, Scope.Scope>` from `design.ts`.
- Removed the `stateRef = designState` assignment inside the layer generator.
- Updated `packages/opencode/test/design/design.test.ts` to:
  - Yield `TestInstance` to obtain the temporary directory.
  - Yield `InstanceStore.Service` and call `store.reload({ directory: test.directory })` to dispose and recreate the instance.
  - Re-acquire `Design.Service`, call `init()`, and verify restored nodes and edges.
  - Add an explicit assertion that restored node IDs match the original IDs.

## Files changed

- `packages/opencode/src/design/design.ts`
- `packages/opencode/test/design/design.test.ts`
- `.superpowers/sdd/task-5-report.md` (this report)

## Test results

```
bun test test/design/design.test.ts
 1 pass
 0 fail
 4 expect() calls
```

## Typecheck results

```
bun typecheck
$ tsgo --noEmit
(no errors)
```

## Issues or concerns

None. The persistence test still exercises real SQLite reload behavior without exposing a mutable module-level handle.

---

# Task 5 Second Fix Report: Quality issues from re-review

## What was fixed

Addressed one Important and two Minor quality issues in `packages/opencode/src/design/design.ts`:

1. **Removed unnecessary `as DesignState` type assertion** (Important)
   - Location: `packages/opencode/src/design/design.ts:87`
   - Changed `return { graph, workingSet, eventLog, store } as DesignState` to `return { graph, workingSet, eventLog, store }`.
   - The object literal already satisfies `DesignState`; the cast only masked potential future type mismatches.

2. **Wrapped `init` in `Effect.fn`** (Minor)
   - Location: `packages/opencode/src/design/design.ts:179-183`
   - Changed `const init = () => Effect.gen(function* () { ... })` to `const init = Effect.fn("Design.init")(function* () { ... })`.
   - Aligns with the project's Effect rules for named/traced effects.

3. **Used `import type` for `Scope`** (Minor)
   - Location: `packages/opencode/src/design/design.ts:1`
   - Split `import { Context, Effect, Layer, Scope } from "effect"` into `import { Context, Effect, Layer } from "effect"` and `import type { Scope } from "effect"`.
   - `Scope` is only used as a type argument to `InstanceState.make`, so it should be a type-only import.

## Files changed

- `packages/opencode/src/design/design.ts`
- `.superpowers/sdd/task-5-report.md` (this report)

## Test results

```
bun test test/design/design.test.ts
bun test v1.3.14 (0d9b296a)

test\design\design.test.ts:
(pass) Design.Service > persists nodes and edges across reload [82.24ms]

 1 pass
 0 fail
 4 expect() calls
Ran 1 test across 1 file. [2.29s]
```

## Typecheck results

```
bun typecheck
$ tsgo --noEmit
```

## Issues or concerns

None. All requested quality fixes are applied, tests pass, and typecheck is clean.

---

# Task 5 Third Fix Report: Named effects for public methods

## What was fixed

Addressed the Important observability/style issue found in the final Task 5 re-review for `packages/opencode/src/design/design.ts`:

Public methods and `persistMutation` were anonymous `Effect.gen` blocks. The project's AGENTS.md Effect rules require `Effect.fn("Domain.method")` for named/traced effects.

Wrapped each of the following in `Effect.fn("Design.<name>")`:

- `persistMutation` → `Effect.fn("Design.persistMutation")`
- `createContext` → `Effect.fn("Design.createContext")`
- `createNode` → `Effect.fn("Design.createNode")`
- `createEdge` → `Effect.fn("Design.createEdge")`
- `resolveReference` → `Effect.fn("Design.resolveReference")`
- `getState` → `Effect.fn("Design.getState")`

`init` was already wrapped as `Effect.fn("Design.init")` in the previous fix and was left unchanged.

Signatures and behavior are identical; only naming/tracing was added. The closures capturing `use`, `designState`, and `persistMutation` continue to work unchanged.

## Files changed

- `packages/opencode/src/design/design.ts`
- `.superpowers/sdd/task-5-report.md` (this report)

## Test results

```
bun test test/design/design.test.ts
bun test v1.3.14 (0d9b296a)

test\design\design.test.ts:
(pass) Design.Service > persists nodes and edges across reload [86.68ms]

 1 pass
 0 fail
 4 expect() calls
Ran 1 test across 1 file. [2.64s]
```

## Typecheck results

```
bun typecheck
$ tsgo --noEmit
(no errors)
```

## Issues or concerns

None. All public Design methods are now named/traced effects, tests pass, and typecheck is clean.
