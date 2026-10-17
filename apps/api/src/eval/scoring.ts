import type { MenuExtraction, MenuItemExtraction, Money } from "@traveevu/contracts"

/**
 * Fixture scorer — pure functions comparing an extraction against a
 * manually verified gold label. Deterministic; no AI, no network.
 *
 * Matching is by normalized original name (trim, casefold, diacritic-
 * insensitive, punctuation/whitespace-collapsed) — the same normalization
 * the ADR 0006 diffMenus comparison uses.
 *
 * Severity (per the evaluation plan): price–item–size misassociation,
 * invented prices, and fabricated options are SEVERE. A price mismatch
 * on a matched item is severe even when the value is merely wrong
 * (not misassociated) — a wrong price is worse than a missing one.
 * Translation differences are not scored here; they are minor.
 */

export const normalizeName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // "đ" does not decompose under NFD, so map it explicitly.
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")

const moneyEqual = (a: Money | null, b: Money | null): boolean => {
  if (a === null || b === null) return a === b
  return a.amountMinor === b.amountMinor && a.currency === b.currency
}

const hasAnyPrice = (item: MenuItemExtraction): boolean =>
  item.price !== null ||
  item.sizes.some((s) => s.price !== null) ||
  item.options.some((o) => o.priceDelta !== null)

export interface SevereFailure {
  readonly kind:
    | "price_mismatch"
    | "price_misassociated"
    | "invented_price"
    | "fabricated_option"
  readonly detail: string
}

export interface ExtractionScore {
  readonly goldItems: number
  readonly matchedItems: number
  readonly missedItems: ReadonlyArray<string>
  readonly extraItems: ReadonlyArray<string>
  readonly priceCorrectItems: number
  readonly priceWrongItems: number
  readonly sizesCorrect: number
  readonly sizesWrong: number
  readonly optionsCorrect: number
  readonly optionsWrong: number
  readonly unknownCorrect: number
  readonly unknownGuessed: number
  readonly pageIndexCorrect: number
  readonly pageIndexWrong: number
  readonly severeFailures: ReadonlyArray<SevereFailure>
}

export const scoreExtraction = (
  gold: MenuExtraction,
  extracted: MenuExtraction
): ExtractionScore => {
  const remaining = [...extracted.items]
  const missedItems: Array<string> = []
  const extraItems: Array<string> = []
  const severeFailures: Array<SevereFailure> = []
  let matchedItems = 0
  let priceCorrectItems = 0
  let priceWrongItems = 0
  let sizesCorrect = 0
  let sizesWrong = 0
  let optionsCorrect = 0
  let optionsWrong = 0
  let unknownCorrect = 0
  let unknownGuessed = 0
  let pageIndexCorrect = 0
  let pageIndexWrong = 0

  for (const goldItem of gold.items) {
    const idx = remaining.findIndex(
      (e) => normalizeName(e.originalName) === normalizeName(goldItem.originalName)
    )
    if (idx === -1) {
      missedItems.push(goldItem.originalName)
      continue
    }
    const item = remaining.splice(idx, 1)[0]!
    matchedItems++

    // Unknown handling: gold has no price info anywhere.
    if (!hasAnyPrice(goldItem)) {
      if (!hasAnyPrice(item)) {
        unknownCorrect++
      } else {
        unknownGuessed++
        severeFailures.push({
          kind: "invented_price",
          detail: `Item "${goldItem.originalName}" has no price on the menu but extraction assigned one.`
        })
      }
    }

    // Base price + sizes + options must all match for the item to count
    // as price-correct.
    let itemPriceOk = true
    if (!moneyEqual(goldItem.price, item.price)) {
      itemPriceOk = false
      const goldBaseInSizes = item.sizes.some(
        (s) => goldItem.price !== null && moneyEqual(goldItem.price, s.price)
      )
      severeFailures.push({
        kind: goldBaseInSizes ? "price_misassociated" : "price_mismatch",
        detail:
          `Item "${goldItem.originalName}": base price gold=${JSON.stringify(goldItem.price)} ` +
          `extracted=${JSON.stringify(item.price)}` +
          (goldBaseInSizes ? " (gold base price found on a size — misassociated)" : "")
      })
    }
    for (const goldSize of goldItem.sizes) {
      const size = item.sizes.find(
        (s) => normalizeName(s.label) === normalizeName(goldSize.label)
      )
      if (size && moneyEqual(goldSize.price, size.price)) {
        sizesCorrect++
      } else {
        sizesWrong++
        itemPriceOk = false
        const goldSizeOnOtherSize = item.sizes.some(
          (s) =>
            normalizeName(s.label) !== normalizeName(goldSize.label) &&
            goldSize.price !== null &&
            moneyEqual(goldSize.price, s.price)
        )
        const goldSizeOnBase =
          goldSize.price !== null && moneyEqual(goldSize.price, item.price)
        const misassociated = goldSizeOnOtherSize || goldSizeOnBase
        severeFailures.push({
          kind: misassociated ? "price_misassociated" : "price_mismatch",
          detail:
            `Item "${goldItem.originalName}" size "${goldSize.label}": gold=${JSON.stringify(goldSize.price)} ` +
            `extracted=${size ? JSON.stringify(size.price) : "missing"}` +
            (misassociated ? " (gold size price found in the wrong slot — misassociated)" : "")
        })
      }
    }
    for (const goldOption of goldItem.options) {
      const option = item.options.find(
        (o) => normalizeName(o.label) === normalizeName(goldOption.label)
      )
      if (option && moneyEqual(goldOption.priceDelta, option.priceDelta)) {
        optionsCorrect++
      } else {
        optionsWrong++
        itemPriceOk = false
        severeFailures.push({
          kind: "price_mismatch",
          detail:
            `Item "${goldItem.originalName}" option "${goldOption.label}": gold=${JSON.stringify(goldOption.priceDelta)} ` +
            `extracted=${option ? JSON.stringify(option.priceDelta) : "missing"}`
        })
      }
    }
    // Fabricated options: extracted labels with no gold counterpart.
    for (const option of item.options) {
      const inGold = goldItem.options.some(
        (o) => normalizeName(o.label) === normalizeName(option.label)
      )
      if (!inGold) {
        optionsWrong++
        itemPriceOk = false
        severeFailures.push({
          kind: "fabricated_option",
          detail: `Item "${goldItem.originalName}": fabricated option "${option.label}".`
        })
      }
    }
    if (itemPriceOk) priceCorrectItems++
    else priceWrongItems++

    if (goldItem.pageIndex === item.pageIndex) pageIndexCorrect++
    else pageIndexWrong++
  }

  for (const extra of remaining) {
    extraItems.push(extra.originalName)
    if (hasAnyPrice(extra)) {
      severeFailures.push({
        kind: "invented_price",
        detail: `Extra item "${extra.originalName}" (no gold match) carries a price — invented or misread.`
      })
    }
  }

  return {
    goldItems: gold.items.length,
    matchedItems,
    missedItems,
    extraItems,
    priceCorrectItems,
    priceWrongItems,
    sizesCorrect,
    sizesWrong,
    optionsCorrect,
    optionsWrong,
    unknownCorrect,
    unknownGuessed,
    pageIndexCorrect,
    pageIndexWrong,
    severeFailures
  }
}
