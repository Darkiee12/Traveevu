import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import { LanguageModel, Prompt } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { cannedResponsesApi, createStubFetch } from "./support/stub-fetch.js"

/**
 * M0 PoC: image input through @effect/ai.
 *
 * Question: does a Prompt carrying an image (FilePart) travel end-to-end
 * through the provider package into the provider's HTTP request?
 *
 * Method: stub the fetch transport via the FetchHttpClient.Fetch
 * reference, run generateText through @effect/ai-openai, and assert the
 * outgoing request body carries the image as an input_image part.
 * No API key, no network.
 *
 * If this fails, the adapter falls back to provider-native SDK calls
 * behind the same MenuExtractionService contract (see docs/milestones/M0.md).
 */
describe("M0 PoC: image input through @effect/ai", () => {
  test("FilePart image reaches the OpenAI request as input_image", async () => {
    const { stub, captured } = createStubFetch(cannedResponsesApi("hello"))

    const prompt = Prompt.fromMessages([
      Prompt.makeMessage("user", {
        content: [
          Prompt.makePart("text", { text: "Extract the menu items from this photo." }),
          Prompt.makePart("file", {
            mediaType: "image/jpeg",
            fileName: "menu.jpg",
            data: "data:image/jpeg;base64,/9j/FAKE"
          })
        ]
      })
    ])

    const program = Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel
      const response = yield* model.generateText({ prompt })
      return response.text
    })

    const clientLayer = OpenAiClient.layer({ apiKey: Redacted.make("test-key") }).pipe(
      Layer.provide(FetchHttpClient.layer)
    )
    const mainLayer = OpenAiLanguageModel.model("gpt-6.1-sol").pipe(
      Layer.provide(clientLayer)
    )

    const text = await Effect.runPromise(
      program.pipe(
        Effect.provide(mainLayer),
        Effect.provide(Layer.succeed(FetchHttpClient.Fetch, stub))
      )
    )
    expect(text).toBe("hello")

    expect(captured).toHaveLength(1)
    expect(captured[0]?.url).toContain("/responses")
    const body = captured[0]?.body as {
      input: Array<{
        role: string
        content: Array<{ type: string; image_url?: string; text?: string }>
      }>
    }
    const userMessage = body.input.find((m) => m.role === "user")
    expect(userMessage).toBeDefined()
    expect(userMessage?.content).toContainEqual({
      type: "input_text",
      text: "Extract the menu items from this photo."
    })
    const imagePart = userMessage?.content.find((p) => p.type === "input_image")
    expect(imagePart?.image_url).toBe("data:image/jpeg;base64,/9j/FAKE")
  })
})
