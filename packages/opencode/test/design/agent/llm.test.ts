import { describe, expect, mock, test } from "bun:test"
import { Effect, Layer } from "effect"
import { DesignAgentLlm } from "@/design/agent/llm"
import { ProviderTest } from "../../fake/provider"
import { Schema } from "effect"

const OutputSchema = Schema.Struct({ answer: Schema.Number })

describe("DesignAgentLlm", () => {
  test("generateObject returns parsed object on success", async () => {
    const generateObjectMock = mock(() => Promise.resolve({ object: { answer: 42 } }))
    mock.module("ai", () => ({ generateObject: generateObjectMock }))

    const fake = ProviderTest.fake({
      getLanguage: () => Effect.succeed({} as never),
    })

    const layer = DesignAgentLlm.layer.pipe(Layer.provide(fake.layer))

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* DesignAgentLlm.Service
        const result = yield* llm.generateObject({ prompt: "test", schema: OutputSchema })
        expect(result.object).toEqual({ answer: 42 })
        expect(generateObjectMock).toHaveBeenCalled()
      }).pipe(Effect.provide(layer)),
    )
  })

  test("generateObject returns GenerateObjectError on failure", async () => {
    const generateObjectMock = mock(() => Promise.reject(new Error("model timeout")))
    mock.module("ai", () => ({ generateObject: generateObjectMock }))

    const fake = ProviderTest.fake({
      getLanguage: () => Effect.succeed({} as never),
    })

    const layer = DesignAgentLlm.layer.pipe(Layer.provide(fake.layer))

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* DesignAgentLlm.Service
        let caught: DesignAgentLlm.GenerateObjectError | undefined
        yield* llm
          .generateObject({ prompt: "test", schema: OutputSchema })
          .pipe(
            Effect.catch((error) => {
              caught = error as DesignAgentLlm.GenerateObjectError
              return Effect.void
            }),
          )
        expect(caught).toBeInstanceOf(DesignAgentLlm.GenerateObjectError)
        expect(caught?.message).toBe("model timeout")
      }).pipe(Effect.provide(layer)),
    )
  })
})
