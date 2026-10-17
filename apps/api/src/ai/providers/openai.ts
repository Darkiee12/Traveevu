import { Config, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"

/**
 * Provisional provider layer: GPT-6.1 Sol (official OpenAI docs: $2 in /
 * $0.10 cached / $2.50 cache writes / $10 out per 1M tokens; image input +
 * structured outputs). PROVISIONAL — provider selection is not final.
 * Evaluation runs reuse MenuExtractionService with each shortlist layer.
 *
 * Requires OPENAI_API_KEY in the environment. Missing key fails fast at
 * layer build with a ConfigError — the slice cannot run without it.
 */
export const OpenAiProviderLive = OpenAiLanguageModel.model("gpt-6.1-sol").pipe(
  Layer.provide(
    OpenAiClient.layerConfig({
      apiKey: Config.Redacted("OPENAI_API_KEY")
    }).pipe(Layer.provide(FetchHttpClient.layer))
  )
)
