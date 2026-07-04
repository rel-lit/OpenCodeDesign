# Task 5 Fix Brief

Fix the Important issue found in Task 5 review for `packages/opencode/src/design/design.ts` and its test.

## Issue

`stateRef` is a mutable module-level `let` initialized with `undefined as unknown as InstanceState.InstanceState<DesignState, never, Scope.Scope>`. This is a type-safety hole and a runtime hazard. It is only used by the test to simulate a reload.

## Fix Requirements

1. Remove the mutable `let stateRef` export from `packages/opencode/src/design/design.ts`.
2. Remove the assignment to `stateRef` inside the layer generator.
3. Update the integration test in `packages/opencode/test/design/design.test.ts` so it no longer relies on `Design.stateRef`. Instead, verify persistence across reload by using `InstanceStore` to reload the same directory:
   - After creating nodes/edges, yield `InstanceStore.Service`.
   - Call `instanceStore.reload({ directory: test.directory })` to dispose and recreate the instance.
   - Then yield `Design.Service` again and verify nodes/edges are restored.
   - Alternatively, if `InstanceStore.reload` is awkward, use `InstanceState.invalidate` by obtaining the state handle through a safe mechanism — but do NOT reintroduce a mutable module-level export.
4. If a test-only accessor is genuinely required, expose it as a read-only function or value that returns `Option<InstanceState.InstanceState<DesignState>>`, not a lying cast. Prefer removing it entirely.
5. Optional but recommended: add explicit assertions that restored node IDs match the original IDs (e.g. `expect(after.map(n => n.id)).toEqual([ship.id, hp.id])`).

## Constraints

- Keep all existing tests passing.
- Run `bun typecheck` from `packages/opencode` after changes.
- Run `bun test test/design/design.test.ts`.
- Follow existing code style and the project's AGENTS.md Effect rules.

## Files to Modify

- `packages/opencode/src/design/design.ts`
- `packages/opencode/test/design/design.test.ts`
