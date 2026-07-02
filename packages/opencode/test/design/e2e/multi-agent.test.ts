import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../../lib/effect"
import { Design } from "../../../src/design/design"
import * as GraphAgentTypes from "../../../src/design/agent/types"
import { GraphAgent } from "../../../src/design/agent/graph"
import { DesignStore } from "../../../src/design/store/store"
import { ApprovalPanel } from "../../../src/design/approval-panel"
import { testInstanceStoreLayer } from "../../fixture/fixture"

const autoConfirmPanel = (): ApprovalPanel.Interface => {
  const panel = ApprovalPanel.make()
  const originalPropose = panel.propose
  return {
    ...panel,
    propose: (proposal) => {
      originalPropose(proposal)
      panel.confirm()
    },
  }
}

const makeMockGraphAgent = (calls: { analyzed: GraphAgentTypes.Input[]; executed: GraphAgentTypes.Output[] }) =>
  GraphAgent.Service.of({
    analyze: (input) => {
      calls.analyzed.push(input)
      return Effect.succeed({
        type: "change-proposal" as const,
        summary: "E2E proposal",
        affectedNodes: input.proposedChange?.updateNodes?.map((n) => n.id) ?? [],
        affectedEdges: [],
        delta: input.proposedChange,
      })
    },
    execute: (proposal) =>
      Effect.gen(function* () {
        calls.executed.push(proposal)
        const design = yield* Design.Service
        const delta = proposal.delta
        if (!delta) return { ...proposal, type: "change-applied" as const }
        yield* design.transaction(
          Effect.gen(function* () {
            for (const node of delta.addNodes ?? []) {
              yield* design.createNode({
                id: node.id,
                name: node.name,
                contextId: node.contextId,
                defaultSemantics: node.defaultSemantics,
                aliases: [...node.aliases],
              })
            }
            for (const update of delta.updateNodes ?? []) {
              yield* design.updateNode(update.id, update.patch)
            }
            for (const id of delta.deleteNodeIds ?? []) {
              yield* design.deleteNode(id)
            }
            for (const edge of delta.addEdges ?? []) {
              yield* design.createEdge({
                leftNodeId: edge.leftNodeId,
                rightNodeId: edge.rightNodeId,
                prototypeId: edge.prototypeId,
                parameters: { ...edge.parameters },
              })
            }
            for (const update of delta.updateEdges ?? []) {
              yield* design.updateEdge(update.leftNodeId, update.rightNodeId, update.patch)
            }
            for (const key of delta.deleteEdgeKeys ?? []) {
              const [left, right] = key.split("::")
              if (left && right) yield* design.deleteEdge(left, right)
            }
          }),
        )
        yield* design.bumpVersion("chat-agent")
        return { ...proposal, type: "change-applied" as const }
      }),
  })

const makeTestLayer = (calls: { analyzed: GraphAgentTypes.Input[]; executed: GraphAgentTypes.Output[] }) =>
  Design.layer({ makeApprovalPanel: autoConfirmPanel }).pipe(
    Layer.provide(DesignStore.defaultLayer),
    Layer.provide(Layer.succeed(GraphAgent.Service, makeMockGraphAgent(calls))),
  )

const it = testEffect(testInstanceStoreLayer)

describe("Multi-agent E2E", () => {
  it.instance("full flow: preprocess → propose → confirm → execute → version sync", () =>
    Effect.gen(function* () {
      const calls = { analyzed: [] as GraphAgentTypes.Input[], executed: [] as GraphAgentTypes.Output[] }

      return yield* Effect.gen(function* () {
        const design = yield* Design.Service
        yield* design.init()

        const ctx = yield* design.createContext({ id: "ctx-core", name: "Core" })
        yield* design.createNode({ id: "node-user", name: "UserService", contextId: ctx.id })

        const preprocessed = yield* design.preprocessInput("修改 @UserService")
        expect(preprocessed.processedText).toContain("UserService")
        expect(preprocessed.temporaryWorkingSet.nodeIds).toContain("node-user")

        const versionBefore = yield* design.getCurrentVersion()
        expect(versionBefore.sequence).toBe(0)

        const delta: GraphAgentTypes.GraphDelta = {
          updateNodes: [{ id: "node-user", patch: { name: "UserServiceV2" } }],
        }

        const result = yield* design.proposeChanges(delta)

        expect(calls.analyzed.length).toBeGreaterThanOrEqual(1)
        expect(calls.executed.length).toBe(1)
        expect(result.type).toBe("change-applied")

        const node = yield* design.getNode("node-user")
        expect(node?.name).toBe("UserServiceV2")

        const versionAfter = yield* design.getCurrentVersion()
        expect(versionAfter.sequence).toBe(1)
      }).pipe(Effect.provide(makeTestLayer(calls)))
    }),
  )
})
