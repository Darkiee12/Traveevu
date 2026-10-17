import { describe, expect, test } from "bun:test"
import { CurrencyCode, type MenuExtraction, type MenuItemExtraction } from "@traveevu/contracts"
import {
  emptySelection,
  formatVND,
  lineTotal,
  orderTotal,
  type OrderSelection
} from "../src/order"

const baseItem = (overrides: Partial<MenuItemExtraction> = {}): MenuItemExtraction => ({
  originalName: "Trà đào",
  translatedName: "Peach tea",
  description: null,
  price: null,
  category: "Trà",
  sizes: [
    { label: "Size M", price: { amountMinor: 35000, currency: CurrencyCode.VND } },
    { label: "Size L", price: { amountMinor: 45000, currency: CurrencyCode.VND } }
  ],
  options: [{ label: "Extra peach", priceDelta: { amountMinor: 5000, currency: CurrencyCode.VND } }],
  quantityPricing: null,
  confidence: 0.9,
  uncertainties: [],
  pageIndex: 0,
  ...overrides
})

describe("order math (integer minor units)", () => {
  test("size selection picks the associated price", () => {
    const total = lineTotal(baseItem(), { ...emptySelection(), quantity: 2, sizeLabel: "Size L" })
    expect(total).toEqual({ known: true, amountMinor: 90000 })
  })

  test("option deltas add to the unit price", () => {
    const selection: OrderSelection = {
      quantity: 1,
      sizeLabel: "Size M",
      optionLabels: ["Extra peach"]
    }
    expect(lineTotal(baseItem(), selection)).toEqual({ known: true, amountMinor: 40000 })
  })

  test("base price used when no size chosen", () => {
    const item = baseItem({ sizes: [], price: { amountMinor: 35000, currency: CurrencyCode.VND } })
    expect(lineTotal(item, { ...emptySelection(), quantity: 3 })).toEqual({
      known: true,
      amountMinor: 105000
    })
  })

  test("null price makes the line unknown, never zero", () => {
    const item = baseItem({ sizes: [], price: null })
    expect(lineTotal(item, { ...emptySelection(), quantity: 1 }).known).toBe(false)
  })

  test("non-VND price makes the line unknown, never converted", () => {
    const item = baseItem({ sizes: [], price: { amountMinor: 200, currency: CurrencyCode.USD } })
    expect(lineTotal(item, { ...emptySelection(), quantity: 1 }).known).toBe(false)
  })

  test("order total sums lines; one unknown line makes the total unknown", () => {
    const extraction: MenuExtraction = {
      items: [
        baseItem(),
        baseItem({ originalName: "Cà phê", sizes: [], price: null, options: [] })
      ],
      categories: ["Trà"],
      currencyHints: [CurrencyCode.VND],
      uncertainties: [],
      overallConfidence: 0.9,
      warnings: []
    }
    const known = orderTotal(extraction, {
      0: { quantity: 1, sizeLabel: "Size M", optionLabels: [] }
    })
    expect(known).toEqual({ known: true, amountMinor: 35000 })
    const unknown = orderTotal(extraction, {
      0: { quantity: 1, sizeLabel: "Size M", optionLabels: [] },
      1: { quantity: 1, sizeLabel: null, optionLabels: [] }
    })
    expect(unknown.known).toBe(false)
  })

  test("VND formatting has no fractions", () => {
    expect(formatVND(35000)).toBe("35.000 ₫")
  })
})
