import { Effect } from "effect"
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
  readonly awaitConfirmation: () => Effect.Effect<GraphAgent.Output>
}

export const make = (): Interface => {
  let state: State = { status: "idle" }
  let resolveConfirmation: ((proposal: GraphAgent.Output) => void) | undefined
  let rejectConfirmation: ((error: Error) => void) | undefined

  const awaitConfirmation = () =>
    Effect.promise(
      () =>
        new Promise<GraphAgent.Output>((resolve, reject) => {
          if (state.status === "executing") {
            resolve(state.proposal)
            return
          }
          if (state.status === "rejected") {
            reject(new Error(state.reason))
            return
          }
          resolveConfirmation = resolve
          rejectConfirmation = reject
        }),
    )

  return {
    getState: () => state,
    propose: (proposal) => {
      state = { status: "proposing", proposal }
    },
    confirm: () => {
      if (state.status !== "proposing") throw new Error("Cannot confirm when not proposing")
      state = { status: "executing", proposal: state.proposal }
      if (resolveConfirmation) {
        resolveConfirmation(state.proposal)
        resolveConfirmation = undefined
        rejectConfirmation = undefined
      }
    },
    force: () => {
      if (state.status !== "proposing") throw new Error("Cannot force when not proposing")
      state = { status: "executing", proposal: state.proposal }
      if (resolveConfirmation) {
        resolveConfirmation(state.proposal)
        resolveConfirmation = undefined
        rejectConfirmation = undefined
      }
    },
    reject: (reason) => {
      state = { status: "rejected", reason }
      if (rejectConfirmation) {
        rejectConfirmation(new Error(reason))
        resolveConfirmation = undefined
        rejectConfirmation = undefined
      }
    },
    done: () => {
      if (state.status !== "executing") throw new Error("Cannot done when not executing")
      state = { status: "done", proposal: state.proposal }
    },
    reset: () => {
      state = { status: "idle" }
      resolveConfirmation = undefined
      rejectConfirmation = undefined
    },
    awaitConfirmation,
  }
}

export * as ApprovalPanel from "./approval-panel"
