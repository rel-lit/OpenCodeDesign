### Task 9: Update session prompt test and run full typecheck

**Files:**
- Modify: `packages/opencode/test/session/prompt.test.ts`

**Why:** The prompt test previously needed `Design.defaultLayer` manually provided. With Design now per-instance and wired through `InstanceBootstrap`, the test setup may need adjustment.

- [ ] **Step 1: Inspect current prompt test setup**

Open `packages/opencode/test/session/prompt.test.ts` and find where `Design.defaultLayer` is provided.

- [ ] **Step 2: Replace manual Design layer provision only if compilation breaks**

Because `Design.defaultLayer` still provides `Design.Service`, the prompt test may continue to work without changes. Run `bun typecheck` first (Step 3). Only modify the test if there is a concrete type error related to Design.

If the test manually provides `Design.defaultLayer` and a type error appears, replace that provision with the new per-instance wiring by ensuring the test uses `InstanceStore.provide` or a server helper that includes `InstanceBootstrap`.

Do not remove `Design.defaultLayer` provision unless the typechecker explicitly requires it.

- [ ] **Step 3: Run typecheck**

```bash
cd packages/opencode
bun typecheck
```

Expected: no errors.

- [ ] **Step 4: Run prompt test**

```bash
cd packages/opencode
bun test test/session/prompt.test.ts
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/test/session/prompt.test.ts
git commit -m "test(design): update prompt test for per-instance Design"
```

---
