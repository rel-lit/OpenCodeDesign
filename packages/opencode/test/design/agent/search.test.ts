import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { SearchAgent } from "@/design/agent/search"

const mockSearchLayer = Layer.succeed(
  SearchAgent.Service,
  SearchAgent.Service.of({
    search: (input) =>
      Effect.succeed({
        summaryReport: `Mock search result for: ${input.retrievalRequirements}`,
      }),
    readProject: () => Effect.succeed({ summaryReport: "Mock project read" }),
  }),
)

test("search agent returns summary report", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const sa = yield* SearchAgent.Service
      return yield* sa.search({
        graphSummary: "设计包含 UserService 和 OrderService",
        retrievalRequirements: "对比项目实现",
      })
    }).pipe(Effect.provide(mockSearchLayer)),
  )
  expect(result.summaryReport).toBeTruthy()
})
