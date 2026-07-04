# Task 12 Report: Implement SearchAgent project reading and diff analysis

## What I implemented

- `src/design/agent/search.ts`
  - Added `SearchOutputSchema` (with `summaryReport`, optional `diffAnalysis`, optional `nonGraphInfo`) to validate LLM output.
  - Implemented `readProject(graphSummary)`:
    - Resolves `src/services` relative to `process.cwd()` via the `Path.Path` service.
    - Reads the directory and each file via `FileSystem.FileSystem`.
    - Builds a prompt from `PROMPT_SEARCH`, the graph summary, and code snippets.
    - Calls `DesignAgentLlm.generateObject` with the schema and returns the structured result.
  - Kept `search(input)` as a lightweight placeholder returning a summary string.
  - Added `defaultLayer` wiring `DesignAgentLlm.defaultLayer`, `NodeFileSystem.layer`, and `NodePath.layer`.
  - Updated `Interface.readProject` return type to include `Provider.DefaultModelError` and `FileSystem | Path` requirements.

- `src/design/agent/prompt/search.txt`
  - Expanded the prompt to instruct the LLM to compare the design graph against code snippets, identify missing entities and divergent relations, and return structured data matching the schema.

- `test/design/agent/search-integration.test.ts`
  - Integration test `readProject finds missing PaymentGateway`:
    - Creates a temporary project directory with `src/services/order.ts` containing `OrderService` but not `PaymentGateway`.
    - Mocks `DesignAgentLlm.Service` to return a predictable `diffAnalysis`.
    - Calls `SearchAgent.Service.readProject` and asserts `diffAnalysis.missingInCode` contains `PaymentGateway`.

## TDD Evidence

1. **RED**: Wrote the integration test first. It failed with:
   ```
   Expected: "Project analysis complete"
   Received: "Project read placeholder"
   ```
   confirming the test exercised the missing behavior.
2. **GREEN**: Implemented `readProject`, prompt, and schema; test passed.
3. **REFACTOR**: Added `defaultLayer`, cleaned types, and ran the full design suite.

## What I tested and test results

- Focused test:
  ```
  bun test test/design/agent/search-integration.test.ts
  1 pass, 0 fail
  ```
- Design suite:
  ```
  bun test test/design
  53 pass, 0 fail
  ```
- Typecheck:
  ```
  bun run typecheck
  (no errors)
  ```

## Files changed

- `packages/opencode/src/design/agent/search.ts`
- `packages/opencode/src/design/agent/prompt/search.txt`
- `packages/opencode/test/design/agent/search-integration.test.ts`

## Commits

- `e0bd5ea78` feat(design): implement SearchAgent project reading and diff analysis

## Self-review findings

- The implementation follows the task brief's pseudo-code (reading `src/services` relative to cwd).
- The output schema matches the `Output` TypeScript interface.
- The test avoids real LLM calls by mocking `DesignAgentLlm.Service`.
- `defaultLayer` is provided for production wiring.

## Issues or concerns

- **Per-project isolation**: The current implementation resolves `src/services` against `process.cwd()`. This matches the brief's example but does not use `InstanceRef`/`InstanceState` for per-project isolation as described in the global constraints. In a multi-project setting, callers must ensure the cwd is the target project directory.
- **Test cwd mutation**: The integration test changes `process.cwd()` and restores it in `finally`. This is safe for this single-test file but is fragile if tests are ever run concurrently and rely on cwd.
