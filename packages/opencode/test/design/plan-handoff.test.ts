import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { PlanHandoff } from "../../src/design/plan-handoff"
import { Design } from "../../src/design/design"
import { DesignStore } from "../../src/design/store/store"

const testLayer = Design.layer().pipe(Layer.provide(DesignStore.defaultLayer))

const it = testEffect(testLayer)

describe("PlanHandoff", () => {
  test("builds Plan payload from SearchAgent diff analysis", () => {
    const diffAnalysis = {
      missingInCode: [{ name: "PaymentGateway", reason: "not found" }],
      divergentRelations: [],
      references: [],
    }
    const payload = PlanHandoff.build({
      diffAnalysis,
      designGraphSummary: "设计包含 3 个服务节点",
    })
    expect(payload.mode).toBe("plan")
    expect(payload.source).toBe("design")
    expect(payload.diffAnalysis).toBe(diffAnalysis)
    expect(payload.designGraphSummary).toBe("设计包含 3 个服务节点")
  })

  it.instance("Design.Service.handoffToPlan builds payload from SearchAgent output", () =>
    Effect.gen(function* () {
      const design = yield* Design.Service
      const diffAnalysis = {
        missingInCode: [{ name: "OrderService", reason: "not implemented" }],
        divergentRelations: [{ actualCode: "class Order", reason: "naming mismatch" }],
        references: [{ file: "src/order.ts", snippet: "export class Order" }],
      }
      const payload = yield* design.handoffToPlan({
        diffAnalysis,
        designGraphSummary: "设计包含订单服务",
      })
      expect(payload.mode).toBe("plan")
      expect(payload.source).toBe("design")
      expect(payload.diffAnalysis).toBe(diffAnalysis)
      expect(payload.designGraphSummary).toBe("设计包含订单服务")
    }),
  )
})
