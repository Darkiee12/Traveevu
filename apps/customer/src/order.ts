import type { MenuItemExtraction, MenuExtraction } from "@traveevu/contracts"

/**
 * Order math for the M0 customer flow — pure functions, integer minor
 * units only, no floats. M0 scope: single currency (VND). A price in any
 * other currency, or a null price, makes the line's total unknown rather
 * than guessed or converted.
 *
 * One line per menu item: the item's current size/options selection IS
 * its order line. Changing the selection changes the line; quantity is
 * kept separately.
 */

export interface OrderSelection {
  readonly quantity: number
  readonly sizeLabel: string | null
  readonly optionLabels: ReadonlyArray<string>
}

export const emptySelection = (): OrderSelection => ({
  quantity: 0,
  sizeLabel: null,
  optionLabels: []
})

export interface LineTotal {
  /** False when any priced component is unknown or non-VND. */
  readonly known: boolean
  readonly amountMinor: number
}

const priceMinor = (price: { amountMinor: number; currency: string } | null): LineTotal =>
  price === null || price.currency !== "VND"
    ? { known: false, amountMinor: 0 }
    : { known: true, amountMinor: price.amountMinor }

export const lineUnitTotal = (
  item: MenuItemExtraction,
  selection: OrderSelection
): LineTotal => {
  let amountMinor = 0
  if (selection.sizeLabel !== null) {
    const size = item.sizes.find((s) => s.label === selection.sizeLabel)
    if (!size) return { known: false, amountMinor: 0 }
    const sizePrice = priceMinor(size.price)
    if (!sizePrice.known) return { known: false, amountMinor: 0 }
    amountMinor += sizePrice.amountMinor
  } else {
    const basePrice = priceMinor(item.price)
    if (!basePrice.known) return { known: false, amountMinor: 0 }
    amountMinor += basePrice.amountMinor
  }
  for (const label of selection.optionLabels) {
    const option = item.options.find((o) => o.label === label)
    if (!option) return { known: false, amountMinor: 0 }
    const delta = priceMinor(option.priceDelta)
    if (!delta.known) return { known: false, amountMinor: 0 }
    amountMinor += delta.amountMinor
  }
  return { known: true, amountMinor }
}

export const lineTotal = (
  item: MenuItemExtraction,
  selection: OrderSelection
): LineTotal => {
  const unit = lineUnitTotal(item, selection)
  if (!unit.known) return { known: false, amountMinor: 0 }
  return { known: true, amountMinor: unit.amountMinor * selection.quantity }
}

export interface OrderTotal {
  readonly known: boolean
  readonly amountMinor: number
}

export const orderTotal = (
  extraction: MenuExtraction,
  selections: Readonly<Record<number, OrderSelection>>
): OrderTotal => {
  let amountMinor = 0
  for (const [index, selection] of Object.entries(selections)) {
    if (selection.quantity <= 0) continue
    const item = extraction.items[Number(index)]
    if (!item) return { known: false, amountMinor: 0 }
    const total = lineTotal(item, selection)
    if (!total.known) return { known: false, amountMinor: 0 }
    amountMinor += total.amountMinor
  }
  return { known: true, amountMinor }
}

export const formatVND = (amountMinor: number): string =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amountMinor)
