# Task 16 Report: E2E Integration and Regression Tests

## What Was Implemented

Created end-to-end and regression tests for the Design multi-agent architecture.

- **E2E test** (`packages/opencode/test/design/e2e/multi-agent.test.ts`):
  - Preprocesses chat input containing an `@` reference via `Design.Service.preprocessInput`.
  - Submits a `GraphDelta` through `Design.proposeChanges`.
  - Uses an auto-confirming approval panel so the flow proceeds without UI interaction.
  - Verifies `GraphAgent.execute` is invoked and the node update is written to the DB.
  - Verifies `VersionSync.getCurrentVersion()` returns an incremented sequence after execution.

- **Regression test in `test/design/design.test.ts`**:
  - Exercises `Design.Service.proposeChanges` end-to-end.
  - Confirms the delta is applied and the graph version is bumped.

- **Regression test in `test/tool/design.test.ts`**:
  - Creates a context and node via design tools.
  - Confirms the graph version increments after a tool-driven `proposeChanges` execution.
  - Updated the shared `mockGraphAgentLayer` `execute` implementation to call `design.bumpVersion("chat-agent")` so it matches real `GraphAgent.execute` behavior.

## Commands Run

### Design tests

```bash
bun test test/design test/tool/design.test.ts
```

Result: **73 pass, 0 fail** across 20 files.

### Typecheck

```bash
bun run typecheck
```

Result: **PASS** (`$ tsgo --noEmit`).

### Windows x64 build

```bash
bun run build --single
```

Result: **SUCCESS** — built in 34.60s, smoke test passed:

```
Running smoke test: dist/opencode-windows-x64/bin/opencode --version
Smoke test passed: 0.0.0-dev-202607021345
```

## Files Changed

- `packages/opencode/test/design/e2e/multi-agent.test.ts` (created)
- `packages/opencode/test/design/design.test.ts` (added regression test + imports)
- `packages/opencode/test/tool/design.test.ts` (added `bumpVersion` to mock, added regression test)

## Issues

- Initial E2E assertion for `versionBefore.sequence` was off by one because `createContext` and `createNode` each append an event. Corrected the expectation to `2` and the after-expectation to `versionBefore.sequence + 1`.
- The first regression test in `design.test.ts` initially hung because the approval panel was not auto-confirming. Fixed by passing `makeApprovalPanel: autoConfirmPanel` to `Design.layer`.
- Build/install step created transient `.opencode` directories and a malformed `%E0%A4%A` artifact under `packages/opencode/`; these were removed before staging.

No pre-existing Windows-specific failures were observed in the design-related test run.

---

## Approval-Panel Deadlock Fix (Follow-up)

### What Changed

- `packages/opencode/src/design/design.ts`:
  - Removed the implicit `ApprovalPanel.make` fallback in `Design.layer` so the default layer no longer injects a blocking panel.
  - Updated `proposeChanges` to use an explicit `panel` argument or an injected `makeApprovalPanel` factory when one is provided; otherwise it auto-approves the proposal and executes it directly.
  - This preserves the panel-based confirmation path for GUI integration while preventing deadlock in CLI-less and test environments.

- `packages/opencode/test/design/design.test.ts`:
  - Added a regression test `proposeChanges auto-approves when no panel is injected` that verifies the service executes the delta and bumps the graph version without an approval panel.

### Test Results

```bash
bun test test/design test/tool/design.test.ts
```

Result: **74 pass, 0 fail** across 20 files.

```bash
bun run typecheck
```

Result: **PASS** (`$ tsgo --noEmit`).

---

## Verification Run (2026-07-02)

Re-ran the design test suite and typecheck to confirm the deadlock fix.

```bash
bun test test/design test/tool/design.test.ts
```

Result: **74 pass, 0 fail** across 20 files.

```bash
bun run typecheck
```

Result: **PASS** (`$ tsgo --noEmit`).

No additional code changes were required; the fix in commit `4b4fdc6f` already addresses the issue.

## Fix 1: Approval Panel Deadlock

Fixed in commit 4b4fdc6f. proposeChanges auto-executes when no panel is provided. Verified: 74 design tests pass, typecheck clean.

---

## Fix 2: Durable EventLog-Based Version Sync

### What Changed

Replaced the stub `VersionSync` implementation with durable version events stored in the `EventLog`.

- `packages/opencode/src/design/core/types.ts`:
  - Added `"graph_version_bumped"` to the `EventType` literal union.
  - Added `VersionBumpSource` literal schema (`"chat-agent" | "visual-editor"`).
  - Added optional `source` field to `EventNode` so version-bump events can carry their source.

- `packages/opencode/src/design/core/event-log.ts`:
  - Extended `append` input to accept an optional `source`.
  - Preserved `source` on appended `EventNode` instances.

- `packages/opencode/src/design/store/store.ts`:
  - Added a nullable `source TEXT` column to `design_events`.
  - Added a schema-migration step that adds the column to existing tables via `PRAGMA table_info` / `ALTER TABLE`.
  - Persisted and restored `source` in `appendEvent` and `rowFromEvent`.

- `packages/opencode/src/design/system/version-sync.ts`:
  - `getCurrentVersion` now filters for `graph_version_bumped` events and derives sequence from the count of those events, reading source/timestamp from the latest bump.
  - `bumpVersion(source)` appends a `graph_version_bumped` event before refreshing the chat-agent context.
  - `refreshChatAgentContext` now logs the version via `Effect.logInfo` so the requested version is accessible.

- `packages/opencode/src/design/design.ts`:
  - Restored `source` when replaying persisted events into the in-memory `EventLog`.
  - `Design.bumpVersion` now persists the newly appended version event through `persistMutation` so the bump survives reloads.

- `packages/opencode/test/design/system/version-sync.test.ts`:
  - Updated expectations so sequence reflects bump count rather than total event count.
  - Added assertions that the bump event is durably appended and that `getCurrentVersion` reflects it.
  - Added a test for multiple consecutive bumps.

### Test Results

```bash
bun test test/design/system/version-sync.test.ts test/design/design.test.ts test/tool/design.test.ts
```

Result: **19 pass, 0 fail** across 3 files.

```bash
bun run typecheck
```

Result: **PASS** (`$ tsgo --noEmit`).


