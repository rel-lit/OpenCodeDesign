import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import fs from "fs/promises"
import path from "path"
import { DesignTypes } from "./types"
import { InstanceState } from "@/effect/instance-state"

export interface Interface {
  readonly save: (state: DesignTypes.GraphState) => Effect.Effect<void>
  readonly load: () => Effect.Effect<DesignTypes.GraphState | undefined>
  readonly appendEvent: (event: DesignTypes.EventNode) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignPersistence") {}

const GRAPH_FILE = "graph.json"
const EVENTS_FILE = "events.jsonl"
const DESIGN_DIR = ".opencode/design"

const paths = Effect.gen(function* () {
  const instance = yield* InstanceState.context
  const designDir = path.join(instance.directory, DESIGN_DIR)
  const graphPath = path.join(designDir, GRAPH_FILE)
  const eventsPath = path.join(designDir, EVENTS_FILE)
  return { designDir, graphPath, eventsPath }
})

const ensureDir = (designDir: string) =>
  Effect.gen(function* () {
    const dir = Bun.file(designDir)
    const exists = yield* Effect.promise(() => dir.exists())
    if (!exists) {
      yield* Effect.promise(() => fs.mkdir(designDir, { recursive: true }))
    }
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const save = Effect.fn("Persistence.save")(function* (state) {
      const { designDir, graphPath } = yield* paths
      yield* ensureDir(designDir)
      const data = JSON.stringify(state, null, 2)
      yield* Effect.promise(() => Bun.write(graphPath, data))
    })

    const load = Effect.fn("Persistence.load")(function* () {
      const { graphPath } = yield* paths
      const file = Bun.file(graphPath)
      const exists = yield* Effect.promise(() => file.exists())
      if (!exists) return undefined
      const text = yield* Effect.promise(() => file.text())
      return JSON.parse(text) as DesignTypes.GraphState
    })

    const appendEvent = Effect.fn("Persistence.appendEvent")(function* (event) {
      const { designDir, eventsPath } = yield* paths
      yield* ensureDir(designDir)
      const line = JSON.stringify(event) + "\n"
      yield* Effect.promise(() => fs.appendFile(eventsPath, line))
    })

    return Service.of({ save, load, appendEvent })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [],
})

export * as Persistence from "./persistence"
