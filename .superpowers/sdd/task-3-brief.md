### Task 3: Refactor `EventLog` into a reusable factory

**Files:**
- Modify: `packages/opencode/src/design/core/event-log.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: exported `makeEventLog` factory returning `Effect.Effect<EventLog.Interface>`.

**Why:** Each project needs its own event log. The factory pattern is identical to `GraphEngine`.

- [ ] **Step 1: Extract factory**

```typescript
export const makeEventLog = Effect.fn("EventLog.make")(function* () {
  let events: DesignTypes.EventNode[] = []

  // move append, rollbackTo, list here
  // append should accept an optional `id` so restored events keep their original IDs:
  // const append = (input: { id?: string; eventType: ...; ... }) => ...

  return { append, rollbackTo, list } satisfies EventLog.Interface
})
```

Update `EventLog.Interface.append` to accept an optional `id?: string` and use `input.id ?? makeId()` when constructing the event.

- [ ] **Step 2: Rewrite global `EventLog.Service` layer**

```typescript
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const log = yield* makeEventLog
    return Service.of(log)
  }),
)
```

- [ ] **Step 3: Verify `EventLog` tests still pass**

Run:
```bash
cd packages/opencode
bun test test/design/core/event-log.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/design/core/event-log.ts
git commit -m "refactor(design): extract EventLog factory"
```

---
