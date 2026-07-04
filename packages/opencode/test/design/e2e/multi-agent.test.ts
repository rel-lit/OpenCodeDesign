import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../../lib/effect"
import { Design } from "../../../src/design/design"
import { DesignStore } from "../../../src/design/store/store"
import { testInstanceStoreLayer } from "../../fixture/fixture"

const testDesignLayer = Design.layer().pipe(Layer.provide(DesignStore.defaultLayer))

const it = testEffect(testInstanceStoreLayer)

describe("Multi-agent E2E", () => {
  it.instance("full flow: preprocess → temp working set → accumulate → apply → version sync", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.init()

      const ctx = yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* design.createNode({ id: "node-user", name: "UserService", contextId: ctx.id })

      const preprocessed = yield* design.preprocessInput("修改 @UserService")
      expect(preprocessed.processedText).toContain("UserService")
      expect(preprocessed.temporaryWorkingSet.nodeIds).toContain("node-user")

      const versionBefore = yield* design.getCurrentVersion()
      expect(versionBefore.sequence).toBe(0)

      const sessionID = "session-e2e-1"
      yield* design.resetTemporaryWorkingSet(sessionID)
      const temp = yield* design.getTemporaryWorkingSet(sessionID)
      expect(temp.nodeIds).toContain("node-user")

      yield* design.addAccumulatedNode(sessionID, {
        name: "NewNode",
        contextId: ctx.id,
        kind: "node",
        aliases: [],
        defaultSemantics: "",
      })

      yield* design.updateAccumulatedNode(sessionID, "node-user", { name: "UserServiceV2" })
      yield* design.applyAccumulatedChanges(sessionID)

      const node = yield* design.getNode("node-user")
      expect(node?.name).toBe("UserServiceV2")

      const newNode = (yield* design.listNodes()).find((n) => n.name === "NewNode")
      expect(newNode).toBeDefined()

      const versionAfter = yield* design.getCurrentVersion()
      expect(versionAfter.sequence).toBe(1)
    }).pipe(Effect.provide(testDesignLayer)),
  )
})
