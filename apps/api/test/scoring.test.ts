import { describe, expect, test } from "bun:test"
import { CurrencyCode, type MenuExtraction } from "@traveevu/contracts"
import { normalizeName, scoreExtraction } from "../src/eval/scoring.js"

const extraction = (overrides: Partial<MenuExtraction> = {}): MenuExtraction => ({
  items: [],
  categories: [],
  currencyHints: [],
  uncertainties: [],
  overallConfidence: 1,
  warnings: [],
  ...overrides
})

const item = (overrides: Record<string, unknown> = {}) => ({
  originalName: "Trà đào",
  translatedName: "Peach tea",
  description: null,
  price: null,
  category: "Trà",
  sizes: [
    { label: "Size M", price: { amountMinor: 35000, currency: CurrencyCode.VND } },
    { label: "Size L", price: { amountMinor: 45000, currency: CurrencyCode.VND } }
  ],
  options: [],
  quantityPricing: null,
  confidence: 0.9,
  uncertainties: [],
  pageIndex: 0,
  ...overrides
})

describe("scorer", () => {
  test("normalization is diacritic/case/punctuation-insensitive", () => {
    expect(normalizeName("  Trà   Đào! ")).toBe("tra dao")
    expect(normalizeName("TRÀ-ĐÀO")).toBe("tra dao")
  })

  test("exact match scores clean", () => {
    const gold = extraction({ items: [item()] })
    const score = scoreExtraction(gold, extraction({ items: [item()] }))
    expect(score.matchedItems).toBe(1)
    expect(score.priceCorrectItems).toBe(1)
    expect(score.severeFailures).toHaveLength(0)
  })

  test("swapped size prices are a severe misassociation", () => {
    const gold = extraction({ items: [item()] })
    const swapped = extraction({
      items: [
        item({
          sizes: [
            { label: "Size M", price: { amountMinor: 45000, currency: CurrencyCode.VND } },
            { label: "Size L", price: { amountMinor: 35000, currency: CurrencyCode.VND } }
          ]
        })
      ]
    })
    const score = scoreExtraction(gold, swapped)
    expect(score.priceWrongItems).toBe(1)
    expect(score.severeFailures.some((f) => f.kind === "price_misassociated")).toBe(true)
  })

  test("guessed price for an unknown-price item is a severe invented price", () => {
    const gold = extraction({ items: [item({ sizes: [], price: null })] })
    const guessed = extraction({
      items: [item({ sizes: [], price: { amountMinor: 50000, currency: CurrencyCode.VND } })]
    })
    const score = scoreExtraction(gold, guessed)
    expect(score.unknownGuessed).toBe(1)
    expect(score.severeFailures.some((f) => f.kind === "invented_price")).toBe(true)
  })

  test("fabricated option is severe", () => {
    const gold = extraction({ items: [item()] })
    const fabricated = extraction({
      items: [
        item({
          options: [{ label: "Extra syrup", priceDelta: { amountMinor: 10000, currency: CurrencyCode.VND } }]
        })
      ]
    })
    const score = scoreExtraction(gold, fabricated)
    expect(score.severeFailures.some((f) => f.kind === "fabricated_option")).toBe(true)
  })

  test("extra priced item is a severe invented price; extra unpriced item is not", () => {
    const gold = extraction({ items: [item()] })
    const extra = extraction({
      items: [
        item(),
        item({ originalName: "Phantom dish", price: { amountMinor: 99000, currency: CurrencyCode.VND }, sizes: [] }),
        item({ originalName: "Mystery dish", price: null, sizes: [] })
      ]
    })
    const score = scoreExtraction(gold, extra)
    expect(score.extraItems).toEqual(["Phantom dish", "Mystery dish"])
    expect(score.severeFailures.filter((f) => f.kind === "invented_price")).toHaveLength(1)
  })
})
