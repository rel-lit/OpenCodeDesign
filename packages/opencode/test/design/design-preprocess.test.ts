import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Design } from "../../src/design/design"
import { DesignStore } from "../../src/design/store/store"

const designLayer = Design.layer().pipe(Layer.provide(DesignStore.defaultLayer))

const it = testEffect(designLayer)

describe("Design.Service preprocessInput", () => {
  it.instance("returns processed input with expanded @ references", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      yield* design.init()

      const ctx = yield* design.createContext({ id: "ctx-core", name: "Core" })
      yield* design.createNode({ id: "node-user", name: "UserService", contextId: ctx.id })

      const result = yield* design.preprocessInput("修改 @UserService")

      expect(result.processedText).toContain("UserService")
      expect(result.temporaryWorkingSet.nodeIds).toContain("node-user")
    }),
  )
})
