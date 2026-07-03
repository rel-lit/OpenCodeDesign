# Design Tool Split SDD Progress

- Plan: docs/superpowers/plans/2026-07-03-design-tool-split.md
- Base commit: 2ad7130f4 docs(design): tool split implementation plan

## Tasks

- [x] Task 1: Adjust GraphDelta type to allow omitted system fields (commit a40aff7a)
- [x] Task 2: Update applyRawDelta to auto-fill fields and resolve temporary IDs (commit 83447f86)
- [x] Task 3: Add design_propose_change tool and remove ChatAgent write tools from registry (commit a40ae7df)
- [x] Task 4: Ensure GraphAgent.execute uses applyRawDelta only (commit 2ab4d8a0)
- [x] Task 5: Rewrite ChatAgent prompt (commit c574bce9)
- [x] Task 6: Update GraphAgent prompt (commit 97c598d6)
- [x] Task 7: Run full verification (commit 97c598d6)

## Follow-up Fix (after test feedback)

- [x] Fix design_propose_change delta schema to be strict
- [x] Update ChatAgent prompt with exact delta field names
- [x] Add regression tests for invalid delta field names
- [x] Run full verification

Verification results:
- `bun run typecheck`: PASS
- `bun test test/design`: 71 pass, 0 fail
- `bun test test/tool/design.test.ts test/tool/graph-agent-design.test.ts`: 20 pass, 0 fail
- `bun run build --single`: PASS (Windows x64)


