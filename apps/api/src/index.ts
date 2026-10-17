import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
import { MenuExtractionServiceLive } from "./ai/menu-extraction-service.js"
import { OpenAiProviderLive } from "./ai/providers/openai.js"
import { ApiRoutes } from "./routes/extract-menu.js"

/**
 * apps/api entry point. Serves the M0 routes on PORT (default 3001).
 * Requires OPENAI_API_KEY — the provider layer fails fast at startup
 * without it.
 */

const port = Number(process.env.PORT ?? 3001)

const ServiceLive = MenuExtractionServiceLive.pipe(Layer.provide(OpenAiProviderLive))

const ServerLive = HttpRouter.serve(ApiRoutes).pipe(
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  Layer.provide(ServiceLive)
)

Effect.runPromise(Layer.launch(ServerLive))
