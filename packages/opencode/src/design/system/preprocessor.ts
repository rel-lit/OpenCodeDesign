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

export * as Preprocessor from "./preprocessor"
