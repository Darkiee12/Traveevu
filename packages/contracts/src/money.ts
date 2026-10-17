import { Schema } from "effect"
import { CurrencyCode } from "./enums.js"

/**
 * Money: integer minor units end to end. VND has exponent 0, so minor ==
 * major (85000 = 85,000₫). No floats, no BigInt on the wire (BigInt is
 * not JSON-serializable), no money library. Display formatting only at
 * the render edge via Intl.NumberFormat.
 */
export const CurrencyCodeSchema = Schema.Enum(CurrencyCode)

export const Money = Schema.Struct({
  amountMinor: Schema.Int,
  currency: CurrencyCodeSchema
})

export type Money = typeof Money.Type
