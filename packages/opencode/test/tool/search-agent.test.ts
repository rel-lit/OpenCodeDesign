import { afterEach, describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Design } from "@/design/design"
import { SessionTrace } from "@/design/system/session-trace"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Session } from "@/session/session"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ChatAgentDesignTools } from "../../src/tool/design"
import { Tool } from "@/tool/tool"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const servicesLayer = Layer.mergeAll(
  LayerNode.compile(Agent.node),
  LayerNode.compile(BackgroundJob.node),
  LayerNode.compile(EventV2Bridge.node),
  LayerNode.compile(Config.node),
  LayerNode.compile(CrossSpawnSpawner.node),
  LayerNode.compile(Session.node),
  LayerNode.compile(SessionRunState.node),
  LayerNode.compile(SessionStatus.node),
  LayerNode.compile(Truncate.node),
  LayerNode.compile(ToolRegistry.node),
  LayerNode.compile(SessionTrace.node),
  LayerNode.compile(SessionProjector.node),
  LayerNode.compile(Database.node),
  LayerNode.compile(Design.node),
  LayerNode.compile(Ripgrep.node),
  RuntimeFlags.layer(),
)

const it = testEffect(testInstanceStoreLayer)

const seed = Effect.fn("SearchAgentTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    variant: "xhigh",
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

describe("ChatAgent design search tools", () => {
  it.instance("design_search_project injects graph summary before calling design-search", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const searchTool = yield* ChatAgentDesignTools.DesignSearchProjectTool
      const captured: Array<{ agent?: string; prompt: string }> = []
      const promptOps = stubOps({
        onPrompt: (input) => {
          captured.push({ agent: input.agent, prompt: input.parts.map((p) => (p.type === "text" ? p.text : "")).join("") })
        },
        text: JSON.stringify({ type: "search-result", summaryReport: "found" }),
      })
      const ctx = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "design",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
        extra: { promptOps, bypassAgentCheck: true },
      }

      yield* (yield* Tool.init(searchTool)).execute({ intent: "check if ship is implemented" }, ctx)

      const graphSummaryCall = captured.find((c) => c.agent === "design-graph")
      const searchCall = captured.find((c) => c.agent === "design-search")

      expect(graphSummaryCall).toBeDefined()
      expect(graphSummaryCall?.prompt).toContain("mode: summarize")
      expect(graphSummaryCall?.prompt).toContain("request: Summarize the current design.")

      expect(searchCall).toBeDefined()
      expect(searchCall?.prompt).toContain("## Graph Summary")
      expect(searchCall?.prompt).toContain("## Retrieval Requirements")
      expect(searchCall?.prompt).toContain("check if ship is implemented")
    }).pipe(Effect.provide(servicesLayer)),
  )

  it.instance("design_search_project passes focus to graph summary", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const searchTool = yield* ChatAgentDesignTools.DesignSearchProjectTool
      const captured: Array<{ agent?: string; prompt: string }> = []
      const promptOps = stubOps({
        onPrompt: (input) => {
          captured.push({ agent: input.agent, prompt: input.parts.map((p) => (p.type === "text" ? p.text : "")).join("") })
        },
        text: JSON.stringify({ type: "search-result", summaryReport: "focused" }),
      })
      const ctx = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "design",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
        extra: { promptOps, bypassAgentCheck: true },
      }

      yield* (yield* Tool.init(searchTool)).execute(
        { intent: "check implementation", focus: { contexts: ["combat"], concepts: ["ship"] } },
        ctx,
      )

      const graphSummaryCall = captured.find((c) => c.agent === "design-graph")
      expect(graphSummaryCall?.prompt).toContain("mode: summarize")
      expect(graphSummaryCall?.prompt).toContain("focus on contexts: combat; concepts: ship")

      const searchCall = captured.find((c) => c.agent === "design-search")
      expect(searchCall?.prompt).toContain("## Focus")
      expect(searchCall?.prompt).toContain("contexts: combat")
      expect(searchCall?.prompt).toContain("concepts: ship")
    }).pipe(Effect.provide(servicesLayer)),
  )

  it.instance("design_search_project uses provided graph_summary without calling design-graph", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const searchTool = yield* ChatAgentDesignTools.DesignSearchProjectTool
      const captured: Array<{ agent?: string; prompt: string }> = []
      const promptOps = stubOps({
        onPrompt: (input) => {
          captured.push({ agent: input.agent, prompt: input.parts.map((p) => (p.type === "text" ? p.text : "")).join("") })
        },
        text: JSON.stringify({ type: "search-result", summaryReport: "custom" }),
      })
      const ctx = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "design",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
        extra: { promptOps, bypassAgentCheck: true },
      }

      yield* (yield* Tool.init(searchTool)).execute(
        { intent: "verify", graph_summary: "Custom summary from caller" },
        ctx,
      )

      const graphSummaryCall = captured.find((c) => c.agent === "design-graph")
      expect(graphSummaryCall).toBeUndefined()

      const searchCall = captured.find((c) => c.agent === "design-search")
      expect(searchCall?.prompt).toContain("## Graph Summary")
      expect(searchCall?.prompt).toContain("Custom summary from caller")
      expect(searchCall?.prompt).toContain("## Retrieval Requirements")
      expect(searchCall?.prompt).toContain("verify")
    }).pipe(Effect.provide(servicesLayer)),
  )
})
