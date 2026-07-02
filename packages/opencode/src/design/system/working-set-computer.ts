import { GraphAgent } from "@/design/agent/types"
import { DesignTypes } from "@/design/core/types"

export const fromInput = (
  input: string,
  active: GraphAgent.ActiveWorkingSet,
  graphState: DesignTypes.GraphState,
): GraphAgent.TemporaryWorkingSet => {
  const mentionedNames = Array.from(input.matchAll(/@([A-Za-z0-9_]+)/g)).map((m) => m[1])
  const mentionedNodeIds = mentionedNames
    .map((name) => graphState.nodes.find((n) => n.name === name)?.id)
    .filter((id): id is string => !!id)

  const involvedNodeIds = new Set([...active.nodeIds, ...mentionedNodeIds])
  const involvedEdgeKeys = new Set<string>()

  for (const edge of graphState.edges) {
    if (involvedNodeIds.has(edge.leftNodeId) || involvedNodeIds.has(edge.rightNodeId)) {
      involvedEdgeKeys.add(`${edge.leftNodeId}->${edge.rightNodeId}`)
      involvedNodeIds.add(edge.leftNodeId)
      involvedNodeIds.add(edge.rightNodeId)
    }
  }

  return {
    contextIds: [
      ...new Set([
        ...active.contextIds,
        ...Array.from(involvedNodeIds).map((id) => graphState.nodes.find((n) => n.id === id)!.contextId),
      ]),
    ],
    nodeIds: [...involvedNodeIds],
    edgeKeys: [...involvedEdgeKeys],
    systemAnalysis: {
      conflictingRelations: [],
      duplicateNodeCandidates: [],
      orphanNodes: [],
      invalidPrototypeUsage: [],
    },
    expandedByGraphAgent: {
      contextIds: [],
      nodeIds: [],
      edgeKeys: [],
      reason: "",
    },
  }
}

export * as WorkingSetComputer from "./working-set-computer"
