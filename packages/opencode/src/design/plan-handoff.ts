import type { DiffAnalysis } from "@/design/agent/types"

export interface PlanHandoffPayload {
  mode: "plan"
  source: "design"
  diffAnalysis: DiffAnalysis
  designGraphSummary: string
}

export const build = (input: {
  diffAnalysis: DiffAnalysis
  designGraphSummary: string
}): PlanHandoffPayload => ({
  mode: "plan",
  source: "design",
  diffAnalysis: input.diffAnalysis,
  designGraphSummary: input.designGraphSummary,
})

export * as PlanHandoff from "./plan-handoff"
