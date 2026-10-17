import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import {
  MenuExtractionService,
  MenuExtractionServiceLive
} from "../src/ai/menu-extraction-service.js"
import { cannedResponsesApi, createStubFetch } from "./support/stub-fetch.js"

/**
 * Service test: MenuExtractionService decodes provider structured output
 * into the MenuExtraction contract, with size→price association intact.
 * Transport is stubbed fetch (no key, no network); the canned response
 * carries output_text JSON for a valid MenuExtraction.
 */
describe("MenuExtractionService", () => {
  test("extractMenu decodes structured output into the contract", async () => {
    const cannedExtraction = {
      items: [
        {
          originalName: "Trà đào",
          translatedName: "Peach tea",
          description: null,
          price: null,
          category: "Trà",
          sizes: [
            { label: "Size M", price: { amountMinor: 35000, currency: "VND" } },
            { label: "Size L", price: { amountMinor: 45000, currency: "VND" } }
          ],
          options: [],
          quantityPricing: null,
          confidence: 0.92,
          uncertainties: [],
          pageIndex: 0,
          sourceText: "Trà đào — Size M 35k / L 45k"
        }
      ],
      categories: ["Trà"],
      currencyHints: ["VND"],
      uncertainties: [],
      overallConfidence: 0.92,
      warnings: []
    }
    const { stub } = createStubFetch(cannedResponsesApi(JSON.stringify(cannedExtraction)))

    const serviceLayer = MenuExtractionServiceLive.pipe(
      Layer.provide(
        OpenAiLanguageModel.model("gpt-6.1-sol").pipe(
          Layer.provide(
            OpenAiClient.layer({ apiKey: Redacted.make("test-key") }).pipe(
              Layer.provide(FetchHttpClient.layer)
            )
          )
        )
      )
    )

    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* MenuExtractionService
      }).pipe(
        Effect.provide(serviceLayer),
        Effect.provide(Layer.succeed(FetchHttpClient.Fetch, stub))
      )
    )
    const result = await Effect.runPromise(
      service.extractMenu({
        images: [{ mediaType: "image/jpeg", data: "data:image/jpeg;base64,/9j/FAKE" }]
      })
    )
    const extraction = result.extraction
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, reasoningTokens: 0 })
    expect(extraction.items[0]?.sizes[0]?.price?.amountMinor).toBe(35000)
    expect(extraction.items[0]?.sizes[1]?.price?.amountMinor).toBe(45000)
    expect(extraction.items[0]?.price).toBeNull()
  })
})
