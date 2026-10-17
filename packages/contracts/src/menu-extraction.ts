import { Schema } from "effect"
import { UncertaintySeverity } from "./enums.js"
import { CurrencyCodeSchema, Money } from "./money.js"

/**
 * MenuExtraction — the AI task contract for menu scanning
 * (docs/ai-boundaries.md §2). The model copies; it never invents.
 *
 * - Names and prices are copied verbatim from the image. Missing or
 *   illegible values are `null` + an `uncertainty` entry — never a
 *   "typical" price or a guessed ingredient.
 * - Categories, sizes, options, and quantity pricing come from the
 *   image only. Absent means absent, not empty invention.
 * - `pageIndex` (ADR 0006) identifies the source photo within the
 *   scanning session (0-based). `sourceText` carries the original
 *   visible text when possible — evidence traceability for evaluation.
 *   Model confidence values and bounding boxes are never trusted
 *   without validation.
 */

const Confidence = Schema.Number.pipe(
  Schema.refine((n): n is number => n >= 0 && n <= 1)
)

export const ExtractionUncertainty = Schema.Struct({
  field: Schema.String,
  reason: Schema.String,
  severity: Schema.Enum(UncertaintySeverity)
})

export const MenuItemSize = Schema.Struct({
  label: Schema.String,
  price: Schema.NullOr(Money)
})

export const MenuItemOption = Schema.Struct({
  label: Schema.String,
  priceDelta: Schema.NullOr(Money)
})

export const QuantityPricing = Schema.Struct({
  quantity: Schema.Int,
  price: Money
})

export const MenuItemExtraction = Schema.Struct({
  originalName: Schema.String,
  translatedName: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  price: Schema.NullOr(Money),
  category: Schema.NullOr(Schema.String),
  sizes: Schema.Array(MenuItemSize),
  options: Schema.Array(MenuItemOption),
  quantityPricing: Schema.NullOr(QuantityPricing),
  confidence: Confidence,
  uncertainties: Schema.Array(ExtractionUncertainty),
  pageIndex: Schema.Int,
  sourceText: Schema.optional(Schema.String)
})

export const MenuExtraction = Schema.Struct({
  items: Schema.Array(MenuItemExtraction),
  categories: Schema.Array(Schema.String),
  currencyHints: Schema.Array(CurrencyCodeSchema),
  uncertainties: Schema.Array(ExtractionUncertainty),
  overallConfidence: Confidence,
  warnings: Schema.Array(Schema.String)
})

export type MenuExtraction = typeof MenuExtraction.Type
export type MenuItemExtraction = typeof MenuItemExtraction.Type
export type ExtractionUncertainty = typeof ExtractionUncertainty.Type
