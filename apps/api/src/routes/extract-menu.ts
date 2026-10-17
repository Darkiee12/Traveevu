import { Effect, Schema } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { MenuExtractionService } from "../ai/menu-extraction-service.js"

/**
 * POST /api/extract-menu
 *
 * Body: { images: [{ mediaType, data, fileName? }] } — data is a data URL,
 * base64 string, or URL per image. Response: a validated MenuExtraction.
 *
 * M0 notes: no auth (guest-first scanning needs none), no persistence
 * (stateless slice; M2 adds it), failures surface as 500s — error mapping
 * to typed JSON responses is follow-up work, not M0 scope.
 */

const ExtractMenuRequest = Schema.Struct({
  body: Schema.Struct({
    images: Schema.Array(
      Schema.Struct({
        mediaType: Schema.String,
        data: Schema.String,
        fileName: Schema.optional(Schema.String)
      })
    )
  })
})

const extractMenuHandler = Effect.gen(function* () {
  const { body } = yield* HttpRouter.schemaJson(ExtractMenuRequest)
  const service = yield* MenuExtractionService
  const result = yield* service.extractMenu({ images: body.images })
  return yield* HttpServerResponse.json(result.extraction)
})

export const ExtractMenuRoute = HttpRouter.route(
  "POST",
  "/api/extract-menu",
  extractMenuHandler
)

export const ApiRoutes = HttpRouter.addAll([ExtractMenuRoute])
