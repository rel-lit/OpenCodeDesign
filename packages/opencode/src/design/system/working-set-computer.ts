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

const parseEdgeKey = (key: string): [string, string] => {
  const parts = key.split("::")
  return [parts[0], parts[1]]
}

export const fromDelta = (
  delta: GraphAgent.GraphDelta,
  active: GraphAgent.ActiveWorkingSet,
  graphState: DesignTypes.GraphState,
): GraphAgent.TemporaryWorkingSet => {
  const involvedNodeIds = new Set<string>(active.nodeIds)

  for (const node of delta.addNodes ?? []) {
    if (node.id) involvedNodeIds.add(node.id)
  }
  for (const update of delta.updateNodes ?? []) {
    involvedNodeIds.add(update.id)
  }
  for (const id of delta.deleteNodeIds ?? []) {
    involvedNodeIds.add(id)
  }
  for (const edge of delta.addEdges ?? []) {
    involvedNodeIds.add(edge.leftNodeId)
    involvedNodeIds.add(edge.rightNodeId)
  }
  for (const update of delta.updateEdges ?? []) {
    involvedNodeIds.add(update.leftNodeId)
    involvedNodeIds.add(update.rightNodeId)
  }
  for (const key of delta.deleteEdgeKeys ?? []) {
    const [leftNodeId, rightNodeId] = parseEdgeKey(key)
    involvedNodeIds.add(leftNodeId)
    involvedNodeIds.add(rightNodeId)
  }

  const involvedEdgeKeys = new Set<string>()

  for (const edge of graphState.edges) {
    if (involvedNodeIds.has(edge.leftNodeId) || involvedNodeIds.has(edge.rightNodeId)) {
      involvedEdgeKeys.add(`${edge.leftNodeId}->${edge.rightNodeId}`)
      involvedNodeIds.add(edge.leftNodeId)
      involvedNodeIds.add(edge.rightNodeId)
    }
  }
  for (const edge of delta.addEdges ?? []) {
    involvedEdgeKeys.add(`${edge.leftNodeId}->${edge.rightNodeId}`)
  }
  for (const update of delta.updateEdges ?? []) {
    involvedEdgeKeys.add(`${update.leftNodeId}->${update.rightNodeId}`)
  }
  for (const key of delta.deleteEdgeKeys ?? []) {
    const [leftNodeId, rightNodeId] = parseEdgeKey(key)
    involvedEdgeKeys.add(`${leftNodeId}->${rightNodeId}`)
  }

  return {
    contextIds: [
      ...new Set([
        ...active.contextIds,
        ...Array.from(involvedNodeIds)
          .map((id) => graphState.nodes.find((n) => n.id === id)?.contextId)
          .filter((id): id is string => !!id),
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
