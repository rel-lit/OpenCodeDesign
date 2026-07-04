# Task 13 Report: Implement Design to Plan/Edit Handoff

## What I Implemented

Created the Design → Plan/Edit handoff payload builder that allows `ChatAgent` to pass `SearchAgent`'s diff analysis into Plan mode.

### Files Changed

- **Created** `packages/opencode/src/design/plan-handoff.ts`
  - Defines `PlanHandoffPayload` interface with `mode: "plan"`, `source: "design"`, `diffAnalysis`, and `designGraphSummary`.
  - Exposes a pure `build(input)` function that constructs the payload.
  - Uses the self-reexport pattern `export * as PlanHandoff from "./plan-handoff"`.

- **Modified** `packages/opencode/src/design/design.ts`
  - Imported `PlanHandoff` from `./plan-handoff`.
  - Added `handoffToPlan(input)` to `Design.Service` interface.
  - Implemented `handoffToPlan` as an `Effect.fn` that wraps `PlanHandoff.build` in `Effect.succeed`.
  - Wired the method into the `Service.of` implementation object.

- **Created** `packages/opencode/test/design/plan-handoff.test.ts`
  - Tests `PlanHandoff.build` directly.
  - Tests `Design.Service.handoffToPlan` through the service layer.

## TDD Evidence

1. **RED**: Wrote `test/design/plan-handoff.test.ts` first and ran it.
   - Failure: `Cannot find module '../../src/design/plan-handoff'` because the module did not exist yet.
2. **GREEN**: Implemented `src/design/plan-handoff.ts` and integrated `handoffToPlan` into `Design.Service`.
   - Re-ran the focused test; both tests passed.
3. **Verification**: Ran the full `test/design/` suite and `bun run typecheck`; all passed.

## Test Results

Focused test:

```bash
bun test test/design/plan-handoff.test.ts
```

Output:

```
2 pass
0 fail
8 expect() calls
```

Design suite:

```bash
bun test test/design/
```

Output:

```
55 pass
0 fail
115 expect() calls
```

Typecheck:

```bash
bun run typecheck
```

Output: no errors.

## Self-Review Findings

- Follows existing module shape: flat top-level exports + `export * as Namespace from "./file"`.
- Uses `Effect.fn` for the service method as required.
- Keeps the payload builder pure; service method simply lifts it into Effect.
- No `try`/`catch` used.
- Field names use camelCase in TypeScript where appropriate; no schema/DB columns were added so snake_case constraint is N/A.
- No existing `Design.Service` or SQLite storage behavior was replaced.

## Issues or Concerns

None. The implementation matches the task brief and all verification passes.
