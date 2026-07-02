import { GraphAgent } from "@/design/agent/types"

export type State =
  | { status: "idle" }
  | { status: "proposing"; proposal: GraphAgent.Output }
  | { status: "executing"; proposal: GraphAgent.Output }
  | { status: "done"; proposal: GraphAgent.Output }
  | { status: "rejected"; reason: string }

export interface Interface {
  readonly getState: () => State
  readonly propose: (proposal: GraphAgent.Output) => void
  readonly confirm: () => void
  readonly force: () => void
  readonly reject: (reason: string) => void
  readonly done: () => void
  readonly reset: () => void
}

export const make = (): Interface => {
  let state: State = { status: "idle" }

  return {
    getState: () => state,
    propose: (proposal) => {
      state = { status: "proposing", proposal }
    },
    confirm: () => {
      if (state.status !== "proposing") throw new Error("Cannot confirm when not proposing")
      state = { status: "executing", proposal: state.proposal }
    },
    force: () => {
      if (state.status !== "proposing") throw new Error("Cannot force when not proposing")
      state = { status: "executing", proposal: state.proposal }
    },
    reject: (reason) => {
      state = { status: "rejected", reason }
    },
    done: () => {
      if (state.status !== "executing") throw new Error("Cannot done when not executing")
      state = { status: "done", proposal: state.proposal }
    },
    reset: () => {
      state = { status: "idle" }
    },
  }
}

export * as ApprovalPanel from "./approval-panel"
