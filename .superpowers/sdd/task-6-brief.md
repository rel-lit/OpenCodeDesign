### Task 6: Wire `Design.Service` into `InstanceBootstrap`

**Files:**
- Modify: `packages/opencode/src/project/bootstrap.ts`
- Modify: `packages/opencode/src/project/bootstrap-service.ts` (no change needed, but verify `Design.Service` has `init` method)

**Interfaces:**
- Consumes: `Design.Service`.
- Produces: `InstanceBootstrap.run` calls `Design.Service.init()` after plugin init.

**Why:** Loading Design state must happen automatically when a project instance is bootstrapped, not lazily when the user first enters Design mode.

- [ ] **Step 1: Add `Design.Service` to bootstrap deps**

Modify `packages/opencode/src/project/bootstrap.ts`:

```typescript
import { Design } from "@/design/design"

// ...

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const plugin = yield* Plugin.Service
    const project = yield* Project.Service
    const shareNext = yield* ShareNext.Service
    const snapshot = yield* Snapshot.Service
    const vcs = yield* Vcs.Service
    const design = yield* Design.Service

    const run = Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* Effect.logInfo("bootstrapping", { directory: ctx.directory })
      yield* config.get()
      yield* plugin.init()
      yield* Effect.forEach(
        [lsp, shareNext, format, vcs, snapshot, project, design],
        (s) => s.init().pipe(Effect.catchCause((cause) => Effect.logWarning("init failed", { cause }))),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.withSpan("InstanceBootstrap.init"))
    }).pipe(Effect.withSpan("InstanceBootstrap"))

    return Service.of({ run })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide([
    Config.defaultLayer,
    Format.defaultLayer,
    LSP.defaultLayer,
    Plugin.defaultLayer,
    Project.defaultLayer,
    ShareNext.defaultLayer,
    Snapshot.defaultLayer,
    Vcs.defaultLayer,
    Design.defaultLayer,
  ]),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, Format.node, LSP.node, Plugin.node, Project.node, ShareNext.node, Snapshot.node, Vcs.node, Design.node],
})
```

- [ ] **Step 2: Verify typecheck**

```bash
cd packages/opencode
bun typecheck
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/project/bootstrap.ts
git commit -m "feat(design): initialize Design.Service during InstanceBootstrap"
```

---
