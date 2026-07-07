import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Provider } from "@/provider/provider"
import { generateObject } from "ai"
import { Context, Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { Decoder } from "effect/Schema"

export class GenerateObjectError extends Schema.TaggedErrorClass<GenerateObjectError>()("DesignAgentLlmGenerateObjectError", {
  message: Schema.String,
}) {}

export interface GenerateObjectInput {
  readonly prompt: string
  readonly schema: Schema.Schema<unknown>
}

export interface Interface {
  readonly generateObject: (
    input: GenerateObjectInput,
  ) => Effect.Effect<{ object: unknown }, GenerateObjectError | Provider.DefaultModelError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DesignAgentLlm") {}
export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const provider = yield* Provider.Service

    const generateObjectImpl = (
      input: GenerateObjectInput,
    ): Effect.Effect<{ object: unknown }, GenerateObjectError | Provider.DefaultModelError> =>
      Effect.gen(function* () {
        const model = yield* provider.defaultModel()
        const resolved = yield* provider.getModel(model.providerID, model.modelID)
        const language = yield* provider.getLanguage(resolved)

        const params = {
          model: language,
          schema: Object.assign(
            Schema.toStandardSchemaV1(input.schema as Decoder<unknown>),
            Schema.toStandardJSONSchemaV1(input.schema as Decoder<unknown>),
          ),
          messages: [{ role: "user", content: input.prompt }],
          temperature: 0.3,
        } satisfies Parameters<typeof generateObject>[0]

        const result = yield* Effect.tryPromise({
          try: () => generateObject(params),
          catch: (error) =>
            new GenerateObjectError({
              message: error instanceof Error ? error.message : String(error),
            }),
        })
        return { object: result.object }
      })

    return Service.of({ generateObject: generateObjectImpl })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(LayerNode.compile(Provider.node)))

export const node = LayerNode.make({
  service: Service,
  layer: defaultLayer,
  deps: [Provider.node],
})

export * as DesignAgentLlm from "./llm"
