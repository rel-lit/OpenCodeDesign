import { Context, Effect, Layer, Ref, Scope } from "effect"
import { FileSystem, Path } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { InstanceRef } from "@/effect/instance-ref"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { EventV2 } from "@opencode-ai/core/event"

const TRACED_SUBAGENTS = new Set(["design-graph", "design-search"])

export function shouldTrace(agent: string): boolean {
  return TRACED_SUBAGENTS.has(agent)
}

export interface TraceEntry {
  readonly timestamp: string
  readonly type: string
  readonly sessionID: string
  readonly parentSessionID?: string
  readonly agent: string
  readonly data: unknown
}

export interface TraceSink {
  readonly sessionID: string
  readonly agent: string
  readonly parentSessionID?: string
  readonly logDir: string
}

export interface Interface {
  readonly enable: (input: {
    sessionID: string
    agent: string
    parentSessionID?: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignSessionTrace") {}

const LOGGED_EVENT_TYPES = new Set([
  "message.updated",
  "message.part.updated",
  "question.asked",
  "question.replied",
  "question.rejected",
  "permission.asked",
  "permission.replied",
  "permission.rejected",
  "session.error",
  "tool.input",
  "tool.result",
  "tool.error",
])

function sanitizeEvent(event: EventV2.Payload): unknown {
  const data = event.data as Record<string, unknown> | undefined
  if (!data || typeof data !== "object") return data
  const clone: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if ((key === "output" || key === "text") && typeof value === "string" && value.length > 4096) {
      clone[key] = value.slice(0, 4096) + "\n[truncated]"
      continue
    }
    clone[key] = value
  }
  return clone
}

function extractSessionID(data: unknown): string | undefined {
  if (data === null || typeof data !== "object") return undefined
  const value = (data as Record<string, unknown>).sessionID
  return typeof value === "string" ? value : undefined
}

export const make = (input: {
  events: EventV2Bridge.Service["Service"]
}): Effect.Effect<Interface, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const sinks = yield* Ref.make<Map<string, TraceSink>>(new Map())
    const buffer = yield* Ref.make<Map<string, TraceEntry[]>>(new Map())
    const bufferSize = 32
    const flushIntervalMs = 500

    const ensureDir = (logDir: string) =>
      Effect.fnUntraced(function* () {
        yield* fs.makeDirectory(logDir, { recursive: true }).pipe(
          Effect.catch(() => Effect.logWarning("Failed to create session trace log directory", { logDir })),
        )
      })

    const flushOne = Effect.fn("SessionTrace.flushOne")(function* (sink: TraceSink) {
      const current = yield* Ref.get(buffer)
      const entries = current.get(sink.sessionID) ?? []
      if (entries.length === 0) return
      const next = new Map(current)
      next.set(sink.sessionID, [])
      yield* Ref.set(buffer, next)
      const lines = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
      const filePath = path.join(sink.logDir, `${sink.sessionID}.jsonl`)
      yield* fs.writeFile(filePath, new TextEncoder().encode(lines), { flag: "a" }).pipe(
        Effect.catch(() => Effect.logWarning("Failed to write session trace log", { filePath })),
      )
    })

    const flushAll = Effect.fn("SessionTrace.flushAll")(function* () {
      const current = yield* Ref.get(sinks)
      for (const sink of current.values()) {
        yield* flushOne(sink)
      }
    })

    const periodicFlush = Effect.fn("SessionTrace.periodicFlush")(function* () {
      while (true) {
        yield* Effect.sleep(`${flushIntervalMs} millis`)
        const current = yield* Ref.get(sinks)
        for (const sink of current.values()) {
          yield* flushOne(sink)
        }
      }
    })

    const appendEvent = Effect.fnUntraced(function* (event: EventV2.Payload) {
      const sessionID = extractSessionID(event.data)
      if (!sessionID) return
      const current = yield* Ref.get(sinks)
      const sink = current.get(sessionID)
      if (!sink) return
      if (!LOGGED_EVENT_TYPES.has(event.type)) return
      const currentBuffer = yield* Ref.get(buffer)
      const entry: TraceEntry = {
        timestamp: new Date().toISOString(),
        type: event.type,
        sessionID: sink.sessionID,
        parentSessionID: sink.parentSessionID,
        agent: sink.agent,
        data: sanitizeEvent(event),
      }
      const list = currentBuffer.get(sessionID) ?? []
      list.push(entry)
      const next = new Map(currentBuffer)
      next.set(sessionID, list)
      yield* Ref.set(buffer, next)
      if (list.length >= bufferSize) {
        yield* flushOne(sink)
      }
    })

    const subscription = yield* input.events.listen((event) =>
      appendEvent(event).pipe(Effect.catch(() => Effect.void)),
    )

    yield* Effect.addFinalizer((_) =>
      Effect.gen(function* () {
        yield* flushAll()
        yield* subscription
      }).pipe(Effect.catch(() => Effect.void)),
    )

    yield* periodicFlush().pipe(Effect.forkScoped)

    const enable = Effect.fn("SessionTrace.enable")(function* (input: {
      sessionID: string
      agent: string
      parentSessionID?: string
    }) {
      if (!shouldTrace(input.agent)) return
      const ctx = yield* InstanceRef
      if (!ctx) return
      const logDir = path.join(ctx.directory, ".opencode", "logs", "sessions")
      yield* ensureDir(logDir)()
      const current = yield* Ref.get(sinks)
      if (current.has(input.sessionID)) return
      const sink: TraceSink = {
        sessionID: input.sessionID,
        agent: input.agent,
        parentSessionID: input.parentSessionID,
        logDir,
      }
      const nextSinks = new Map(current)
      nextSinks.set(input.sessionID, sink)
      yield* Ref.set(sinks, nextSinks)
      const currentBuffer = yield* Ref.get(buffer)
      const nextBuffer = new Map(currentBuffer)
      nextBuffer.set(input.sessionID, [])
      yield* Ref.set(buffer, nextBuffer)
    })

    return Service.of({ enable })
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    return yield* make({ events })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
  Layer.provide(LayerNode.compile(EventV2Bridge.node)),
)

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [EventV2Bridge.node],
})

export * as SessionTrace from "./session-trace"
