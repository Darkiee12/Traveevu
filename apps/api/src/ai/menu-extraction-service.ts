import { Context, Effect, Layer } from "effect"
import { AiError, LanguageModel, Prompt } from "effect/ai"
import { MenuExtraction } from "@traveevu/contracts"
import {
  MENU_EXTRACTION_SYSTEM_PROMPT,
  MENU_EXTRACTION_USER_PROMPT
} from "./prompts.js"

/**
 * MenuExtractionService — the single AI boundary for menu scanning.
 *
 * The Menus domain depends only on this service + the contracts in
 * @traveevu/contracts. It never imports a provider SDK. The service is
 * implemented once against Effect's provider-neutral LanguageModel; the
 * provider is a Layer supplied at runtime (see ./providers/openai.ts).
 * Swapping providers changes the layer, never this service. No router,
 * no fallback chain, no two-stage pipeline.
 */

export interface MenuImageInput {
  /** MIME type, e.g. "image/jpeg". */
  readonly mediaType: string
  /** Image bytes as a data URL, base64 string, or URL. */
  readonly data: string
  readonly fileName?: string
}

export interface ExtractMenuInput {
  /** Menu pages in order: images[0] is pageIndex 0, images[1] is pageIndex 1, … */
  readonly images: ReadonlyArray<MenuImageInput>
}

export interface ExtractionUsage {
  /** Token counts as reported by the provider. Missing fields read as 0. */
  readonly inputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
}

export interface ExtractMenuResult {
  readonly extraction: MenuExtraction
  readonly usage: ExtractionUsage
}

export const MenuExtractionService = Context.Service<{
  readonly extractMenu: (
    input: ExtractMenuInput
  ) => Effect.Effect<ExtractMenuResult, AiError.AiError>
}>("MenuExtractionService")

export const MenuExtractionServiceLive = Layer.effect(
  MenuExtractionService,
  Effect.gen(function* () {
    const model = yield* LanguageModel.LanguageModel
    return {
      extractMenu: (input) =>
        Effect.gen(function* () {
          const prompt = Prompt.fromMessages([
            Prompt.makeMessage("system", { content: MENU_EXTRACTION_SYSTEM_PROMPT }),
            Prompt.makeMessage("user", {
              content: [
                Prompt.makePart("text", { text: MENU_EXTRACTION_USER_PROMPT }),
                ...input.images.map((image, index) =>
                  Prompt.makePart("file", {
                    mediaType: image.mediaType,
                    fileName: image.fileName ?? `page-${index + 1}.jpg`,
                    data: image.data
                  })
                )
              ]
            })
          ])
          const response = yield* model.generateObject({
            prompt,
            schema: MenuExtraction,
            objectName: "menuExtraction"
          })
          return {
            extraction: response.value,
            usage: {
              inputTokens: response.usage.inputTokens.total ?? 0,
              outputTokens: response.usage.outputTokens.total ?? 0,
              reasoningTokens: response.usage.outputTokens.reasoning ?? 0
            }
          }
        })
    }
  })
)
