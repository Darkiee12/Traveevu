import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { MenuExtraction } from "../src/menu-extraction.js"

const decode = (input: unknown) => Schema.decodeUnknownSync(MenuExtraction)(input)

/**
 * Decisive case (M0 acceptance): a multi-price line must keep each price
 * associated with its own size. Valid JSON with misassociated prices is a
 * failure — the contract pins the association shape, the fixture tests
 * pin the association behavior.
 */
const traDaO = {
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

describe("MenuExtraction", () => {
  test("decodes a valid extraction and keeps size→price association", () => {
    const decoded = decode(traDaO)
    expect(decoded.items[0]?.sizes[0]?.price?.amountMinor).toBe(35000)
    expect(decoded.items[0]?.sizes[1]?.price?.amountMinor).toBe(45000)
    expect(decoded.items[0]?.sourceText).toBe("Trà đào — Size M 35k / L 45k")
  })

  test("unknown price decodes as null + uncertainty, never a guess", () => {
    const decoded = decode({
      ...traDaO,
      items: [
        {
          ...traDaO.items[0],
          sizes: [],
          price: null,
          uncertainties: [
            { field: "price", reason: "price illegible in photo", severity: "high" }
          ]
        }
      ]
    })
    expect(decoded.items[0]?.price).toBeNull()
    expect(decoded.items[0]?.uncertainties).toHaveLength(1)
  })

  test("rejects a price given as a bare string", () => {
    expect(() =>
      decode({
        ...traDaO,
        items: [{ ...traDaO.items[0], price: "35k", sizes: [] }]
      })
    ).toThrow()
  })

  test("rejects confidence outside 0..1", () => {
    expect(() => decode({ ...traDaO, overallConfidence: 1.5 })).toThrow()
  })
})
