### Task 10: End-to-end validation

**Files:**
- None (verification only).

**Why:** We must confirm that entering Design mode in the TUI actually creates `.opencode/design/design.sqlite`, writes nodes/edges, and reloads them on next instance load.

- [ ] **Step 1: Build the binary**

```bash
cd packages/opencode
bun run build --single
```

Expected: build succeeds.

- [ ] **Step 2: Run Design mode in a temp project**

```bash
mkdir -p /tmp/design-e2e
cd /tmp/design-e2e
D:\RLDemos\OpenCodeDesign\packages\opencode\dist\opencode.exe --agent design
```

In the TUI, run:

```
创建一个上下文叫 战斗系统
创建节点 船 在 战斗系统
创建节点 生命值 在 战斗系统
连接 船 和 生命值 使用 聚合
```

Exit the TUI.

- [ ] **Step 3: Inspect SQLite file**

```bash
ls .opencode/design/design.sqlite
sqlite3 .opencode/design/design.sqlite "SELECT * FROM design_nodes;"
sqlite3 .opencode/design/design.sqlite "SELECT * FROM design_edges;"
sqlite3 .opencode/design/design.sqlite "SELECT * FROM design_events;"
```

Expected: `design.sqlite` exists and contains the nodes, edge, and events.

- [ ] **Step 4: Re-enter Design mode and verify reload**

```bash
D:\RLDemos\OpenCodeDesign\packages\opencode\dist\opencode.exe --agent design
```

Run `design_list_nodes`. Expected: both `船` and `生命值` are listed.

- [ ] **Step 5: Run full design test suite**

```bash
cd D:\RLDemos\OpenCodeDesign\packages\opencode
bun test test/design
```

Expected: all tests pass.

- [ ] **Step 6: Run full typecheck**

```bash
cd D:\RLDemos\OpenCodeDesign\packages\opencode
bun turbo typecheck
```

Expected: all packages typecheck.

- [ ] **Step 7: Commit**

```bash
git commit --allow-empty -m "chore(design): verify native SQLite integration e2e"
```

---
