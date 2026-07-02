# Task 15 Report: EventLog-based Version Sync and Cognition Refresh

## What Was Implemented

- Created `src/design/system/version-sync.ts` with:
  - `GraphVersion` type carrying `sequence`, `timestamp`, and `source`.
  - `VersionSync.Interface` exposing `getCurrentVersion`, `bumpVersion`, and `refreshChatAgentContext`.
  - `VersionSync.Service` Context service and `layer`/`defaultLayer` wiring over `EventLog`.
  - `make(eventLog)` that derives the current logical version from `EventLog.list().length` and bumps it transiently after each successful write.
- Modified `src/design/design.ts`:
  - Added `VersionSync` methods to `Design.Interface`.
  - Stored a `VersionSync` instance in `DesignState` backed by the same in-memory `EventLog`.
  - Exposed `getCurrentVersion`, `bumpVersion`, and `refreshChatAgentContext` on `Design.Service`.
- Modified `src/design/agent/graph.ts`:
  - Calls `design.bumpVersion("chat-agent")` after a successful `execute` transaction.
- Modified `src/design/visual-editor-protocol.ts`:
  - Calls `design.bumpVersion("visual-editor")` after a successful raw save.
- Created `test/design/system/version-sync.test.ts` covering `getCurrentVersion` and `bumpVersion`.

## TDD Evidence

1. Wrote `test/design/system/version-sync.test.ts` first.
2. Initial run failed: module `../../../src/design/system/version-sync` not found.
3. Created a skeleton `version-sync.ts` with a deliberately wrong `getCurrentVersion` returning `sequence: 999`.
4. Re-ran tests; failure confirmed `Expected: 0, Received: 999` for the first test and missing `EventLog.Service` for the second.
5. Implemented correct logic and fixed layer wiring (`Layer.provideMerge(EventLog.defaultLayer)`).
6. Re-ran tests; both passed.

## Tests Run

- Focused test: `bun test test/design/system/version-sync.test.ts`
  - 2 pass, 0 fail
- Full design suite: `bun test test/design/ --timeout 60000`
  - 59 pass, 0 fail
- Typecheck: `bun run typecheck`
  - Passed with no output

## Files Changed

- `src/design/system/version-sync.ts` (created)
- `src/design/design.ts` (modified)
- `src/design/agent/graph.ts` (modified)
- `src/design/visual-editor-protocol.ts` (modified)
- `test/design/system/version-sync.test.ts` (created)

## Self-Review Findings

- `VersionSync.getCurrentVersion` reads `last.source`, but `DesignTypes.EventNode` does not currently carry a `source` field. The expression safely falls back to `"chat-agent"`, which matches the brief skeleton. This means `getCurrentVersion` always reports `"chat-agent"` when deriving from the event log; the explicit source is only visible after `bumpVersion`. Future work may add `source` to event storage if derivation needs to be source-aware.
- `bumpVersion` is logical/transient: it does not append a new event, so subsequent `getCurrentVersion` calls return the pre-bump sequence. This matches the brief's "derive logical versions from EventLog sequence numbers" wording.
- `refreshChatAgentContext` is intentionally a no-op placeholder per the brief; the TODO comment is preserved for the cognition-refresh follow-up.
- No circular dependencies introduced; `GraphAgent` and `VisualEditorProtocol` already depend on `Design.Service`.

## Concerns

None blocking. The `source` fallback behavior is the only deviation from a fully source-aware system, but it is faithful to the provided brief and existing `EventNode` schema.
