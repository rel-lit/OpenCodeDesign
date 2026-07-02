import { expect, test } from "bun:test"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { DesignAgentLlm } from "@/design/agent/llm"
import { SearchAgent } from "@/design/agent/search"
import { Effect, FileSystem, Layer, Path } from "effect"
import { tmpdir } from "../../fixture/fixture"

const mockLlmLayer = Layer.succeed(
  DesignAgentLlm.Service,
  DesignAgentLlm.Service.of({
    generateObject: () =>
      Effect.succeed({
        object: {
          summaryReport: "Project analysis complete",
          diffAnalysis: {
            missingInCode: [{ name: "PaymentGateway", reason: "Not found in order.ts" }],
            divergentRelations: [],
            references: [{ file: "src/services/order.ts", snippet: "export class OrderService" }],
          },
        },
      }),
  }),
)

const testLayer = Layer.mergeAll(
  SearchAgent.layer.pipe(Layer.provide(mockLlmLayer)),
  NodeFileSystem.layer,
  NodePath.layer,
)

test("readProject finds missing PaymentGateway", async () => {
  await using tmp = await tmpdir()
  const originalCwd = process.cwd()
  process.chdir(tmp.path)
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const servicesDir = path.join(tmp.path, "src/services")
        yield* fs.makeDirectory(servicesDir, { recursive: true })
        yield* fs.writeFileString(
          path.join(servicesDir, "order.ts"),
          "export class OrderService {\n  place() {}\n}\n",
        )
        const sa = yield* SearchAgent.Service
        const result = yield* sa.readProject("设计包含 OrderService 和 PaymentGateway")
        expect(result.summaryReport).toBe("Project analysis complete")
        expect(result.diffAnalysis?.missingInCode.some((m) => m.name === "PaymentGateway")).toBe(true)
      }).pipe(Effect.provide(testLayer)),
    )
  } finally {
    process.chdir(originalCwd)
  }
})
