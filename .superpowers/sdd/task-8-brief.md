### Task 8: Remove legacy JSON/JSONL persistence

**Files:**
- Delete: `packages/opencode/src/design/core/persistence.ts`
- Delete: `packages/opencode/test/design/core/persistence.test.ts`
- Modify: `packages/opencode/src/design/index.ts` (if it re-exports `Persistence`)

**Why:** JSON/JSONL persistence is replaced by SQLite. Keeping it creates confusion and duplicate code paths.

- [ ] **Step 1: Delete legacy files**

```bash
git rm packages/opencode/src/design/core/persistence.ts
git rm packages/opencode/test/design/core/persistence.test.ts
```

- [ ] **Step 2: Remove `Persistence` from design exports**

Modify `packages/opencode/src/design/index.ts`:

```diff
  export * as Design from "./design"
  export * as GraphEngine from "./core/graph"
  export * as WorkingSet from "./core/working-set"
  export * as EventLog from "./core/event-log"
- export * as Persistence from "./core/persistence"
  export * as DesignTypes from "./core/types"
```

Then verify no other file imports `@/design/core/persistence`:

```bash
cd packages/opencode
grep -r "core/persistence" src/design test/design
```

Expected: no matches.

- [ ] **Step 3: Run tests and typecheck**

```bash
cd packages/opencode
bun typecheck
bun test test/design
```

Expected: typecheck passes; design tests pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(design): remove legacy JSON/JSONL persistence"
```

---
