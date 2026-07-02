import { GraphAgent } from "@/design/agent/types"
import { DesignTypes } from "@/design/core/types"

const commonPrefixLength = (a: string, b: string): number => {
  let i = 0
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) {
    i++
  }
  return i
}

export const analyze = (
  tws: GraphAgent.TemporaryWorkingSet,
  graphState: DesignTypes.GraphState,
): GraphAgent.TemporaryWorkingSet => {
  const orphanNodes = tws.nodeIds.filter((id) => {
    return !graphState.edges.some((e) => e.leftNodeId === id || e.rightNodeId === id)
  })

  const duplicateNodeCandidates: GraphAgent.TemporaryWorkingSet["systemAnalysis"]["duplicateNodeCandidates"] = []
  for (let i = 0; i < tws.nodeIds.length; i++) {
    for (let j = i + 1; j < tws.nodeIds.length; j++) {
      const a = graphState.nodes.find((n) => n.id === tws.nodeIds[i])
      const b = graphState.nodes.find((n) => n.id === tws.nodeIds[j])
      if (a === undefined || b === undefined) continue
      const aName = a.name.toLowerCase()
      const bName = b.name.toLowerCase()
      const sharedPrefix = commonPrefixLength(aName, bName)
      if (aName.includes(bName) || bName.includes(aName) || sharedPrefix >= 4) {
        duplicateNodeCandidates.push({ nodeIds: [a.id, b.id], similarityScore: 0.7 })
      }
    }
  }

  return {
    ...tws,
    systemAnalysis: {
      ...tws.systemAnalysis,
      orphanNodes,
      duplicateNodeCandidates,
    },
  }
}

export * as SystemAnalyzer from "./analyzer"
