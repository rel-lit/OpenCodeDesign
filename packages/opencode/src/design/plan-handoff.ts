import type { SearchAgent } from "@/design/agent/search"

export interface PlanHandoffPayload {
  mode: "plan"
  source: "design"
  diffAnalysis: SearchAgent.Output["diffAnalysis"]
  designGraphSummary: string
}

export const build = (input: {
  diffAnalysis: SearchAgent.Output["diffAnalysis"]
  designGraphSummary: string
}): PlanHandoffPayload => ({
  mode: "plan",
  source: "design",
  diffAnalysis: input.diffAnalysis,
  designGraphSummary: input.designGraphSummary,
})

export * as PlanHandoff from "./plan-handoff"
