import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ApprovalPanel } from "@/design/approval-panel"

const sampleProposal = {
  type: "change-proposal" as const,
  summary: "rename",
  affectedNodes: [] as string[],
  affectedEdges: [] as string[],
}

describe("ApprovalPanel", () => {
  test("starts in idle state", () => {
    const panel = ApprovalPanel.make()
    expect(panel.getState().status).toBe("idle")
  })

  test("transitions from idle to proposing", () => {
    const panel = ApprovalPanel.make()
    panel.propose(sampleProposal)
    expect(panel.getState().status).toBe("proposing")
  })

  test("stores the proposal while proposing", () => {
    const panel = ApprovalPanel.make()
    panel.propose(sampleProposal)
    const state = panel.getState()
    if (state.status !== "proposing") throw new Error("expected proposing")
    expect(state.proposal).toBe(sampleProposal)
  })

  test("confirm transitions to executing", () => {
    const panel = ApprovalPanel.make()
    panel.propose(sampleProposal)
    panel.confirm()
    expect(panel.getState().status).toBe("executing")
  })

  test("force transitions to executing", () => {
    const panel = ApprovalPanel.make()
    panel.propose(sampleProposal)
    panel.force()
    expect(panel.getState().status).toBe("executing")
  })

  test("done transitions to done", () => {
    const panel = ApprovalPanel.make()
    panel.propose(sampleProposal)
    panel.confirm()
    panel.done()
    expect(panel.getState().status).toBe("done")
  })

  test("reject transitions to rejected", () => {
    const panel = ApprovalPanel.make()
    panel.propose(sampleProposal)
    panel.reject("too risky")
    const state = panel.getState()
    expect(state.status).toBe("rejected")
    if (state.status !== "rejected") throw new Error("expected rejected")
    expect(state.reason).toBe("too risky")
  })

  test("reset returns to idle", () => {
    const panel = ApprovalPanel.make()
    panel.propose(sampleProposal)
    panel.confirm()
    panel.reset()
    expect(panel.getState().status).toBe("idle")
  })

  test("confirm throws when not proposing", () => {
    const panel = ApprovalPanel.make()
    expect(() => panel.confirm()).toThrow("Cannot confirm when not proposing")
  })

  test("force throws when not proposing", () => {
    const panel = ApprovalPanel.make()
    expect(() => panel.force()).toThrow("Cannot force when not proposing")
  })

  test("done throws when not executing", () => {
    const panel = ApprovalPanel.make()
    expect(() => panel.done()).toThrow("Cannot done when not executing")
  })

  test("awaitConfirmation resolves after confirm", async () => {
    const panel = ApprovalPanel.make()
    const proposal = { type: "change-proposal" as const, summary: "rename", affectedNodes: [] as string[], affectedEdges: [] as string[] }
    panel.propose(proposal)
    const promise = Effect.runPromise(panel.awaitConfirmation())
    panel.confirm()
    const result = await promise
    expect(result).toBe(proposal)
  })

  test("awaitConfirmation resolves after force", async () => {
    const panel = ApprovalPanel.make()
    const proposal = { type: "change-proposal" as const, summary: "rename", affectedNodes: [] as string[], affectedEdges: [] as string[] }
    panel.propose(proposal)
    const promise = Effect.runPromise(panel.awaitConfirmation())
    panel.force()
    const result = await promise
    expect(result).toBe(proposal)
  })

  test("awaitConfirmation rejects after reject", async () => {
    const panel = ApprovalPanel.make()
    const proposal = { type: "change-proposal" as const, summary: "rename", affectedNodes: [] as string[], affectedEdges: [] as string[] }
    panel.propose(proposal)
    const promise = Effect.runPromise(panel.awaitConfirmation())
    panel.reject("too risky")
    await expect(promise).rejects.toThrow("too risky")
  })
})
