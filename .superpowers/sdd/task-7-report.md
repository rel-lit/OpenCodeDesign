# Task 7 Report

## What I implemented

Implemented `@` reference expansion in `src/design/system/preprocessor.ts`. The `expandAtReferences` function scans raw user input for `@NodeName` references and expands each matched reference into a node summary containing the node ID, kind, and context name.

The implementation depends on a `kind` field on design nodes. Because `DesignTypes.Node` did not yet expose `kind`, I added it to the schema and propagated it through the minimal necessary surfaces:

- `src/design/core/types.ts`: added `kind: Schema.String` to `Node`
- `src/design/core/graph.ts`: `createNode` accepts optional `kind` and defaults to `"node"`
- `src/design/store/store.ts`: persisted `kind` in the `design_nodes` table and round-tripped it through `rowFromNode`
- `src/tool/design.ts` and existing design tests: added `kind` to manually-constructed node objects so typecheck and runtime behavior stay consistent

## What I tested and test results

- Focused test: `bun test test/design/system/preprocessor.test.ts` — **PASS**
- Design suite: `bun test test/design/` — **47 pass, 0 fail**
- Typecheck: `bun run typecheck` — **clean**

## TDD Evidence

1. Wrote the failing test in `test/design/system/preprocessor.test.ts` against a stub `expandAtReferences` that returned the input unchanged.
2. Ran the test and confirmed it failed with the expected assertion error (`Received: "修改 @UserService 的依赖"`).
3. Implemented the expansion logic.
4. Re-ran the test and confirmed it passed.
5. Ran the full design test suite and typecheck to verify no regressions.

## Files changed

- `src/design/system/preprocessor.ts` (new)
- `test/design/system/preprocessor.test.ts` (new)
- `src/design/core/types.ts`
- `src/design/core/graph.ts`
- `src/design/store/store.ts`
- `src/tool/design.ts`
- `test/design/agent/graph-execute.test.ts`
- `test/design/agent/graph.test.ts`
- `test/design/store/store.test.ts`
- `test/tool/design.test.ts`

## Self-review findings

- The preprocessor implementation matches the task brief exactly.
- The `kind` field addition is a schema change that rippled into storage and a few tests; all call sites were updated and verified.
- No existing `Design.Service` or SQLite storage behavior was replaced; only extended with the new column.
- All design tests pass and typecheck is clean.

## Issues or concerns

- The task brief only listed creating `src/design/system/preprocessor.ts` and its test, but the brief's implementation references `node.kind`, which did not exist in `DesignTypes.Node`. I had to add `kind` to the node schema and persist it. This is a small but real schema migration concern for existing `design.sqlite` databases that predate this change; the new column is created with `DEFAULT 'node'` in fresh databases, but existing tables will need the column added if backward compatibility is required.
