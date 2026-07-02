import { GraphAgent } from "@/design/agent/types"
import { DesignTypes } from "../core/types"

export const expandAtReferences = (input: string, graphState: DesignTypes.GraphState): string => {
  const pattern = /@([A-Za-z0-9_]+)/g
  return input.replace(pattern, (match, name) => {
    const node = graphState.nodes.find((n) => n.name === name)
    if (!node) return match
    const ctx = graphState.contexts.find((c) => c.id === node.contextId)
    return `${match}（节点 ID: ${node.id}，类型: ${node.kind}，上下文: ${ctx?.name ?? node.contextId}）`
  })
}

export const buildProcessedText = (
  expandedInput: string,
  temporaryWorkingSet: GraphAgent.TemporaryWorkingSet,
  enriched?: GraphAgent.Output,
): string => {
  const analysis = temporaryWorkingSet.systemAnalysis
  const notes: string[] = []
  if (analysis.orphanNodes.length > 0) notes.push(`孤立节点: ${analysis.orphanNodes.join(", ")}`)
  if (analysis.duplicateNodeCandidates.length > 0) notes.push("疑似重复节点")
  if (analysis.conflictingRelations.length > 0) notes.push("关系冲突")
  if (analysis.invalidPrototypeUsage.length > 0) notes.push("原型使用异常")

  const parts = [expandedInput]
  if (notes.length > 0) parts.push(`\n\n系统分析: ${notes.join("；")}`)
  if (enriched?.summary) parts.push(`\n\nGraphAgent 补充: ${enriched.summary}`)

  return parts.join("")
}

export * as Preprocessor from "./preprocessor"
