import { useState } from "react"
import { Schema } from "effect"
import { MenuExtraction, type MenuItemExtraction } from "@traveevu/contracts"
import { createFileRoute } from "@tanstack/react-router"
import {
  emptySelection,
  formatVND,
  lineTotal,
  orderTotal,
  type OrderSelection
} from "../order"

/**
 * M0 customer flow: upload menu photos → extract → interactive menu →
 * bilingual order view. Stateless: no persistence (M2), no auth
 * (guest-first scanning needs none).
 */

export const Route = createFileRoute("/")({
  component: ScanToOrder
})

interface Photo {
  readonly dataUrl: string
  readonly mediaType: string
  readonly name: string
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

function ScanToOrder() {
  const [photos, setPhotos] = useState<Array<Photo>>([])
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extraction, setExtraction] = useState<MenuExtraction | null>(null)
  const [selections, setSelections] = useState<Readonly<Record<number, OrderSelection>>>({})

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    const next: Array<Photo> = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue
      next.push({
        dataUrl: await readFileAsDataUrl(file),
        mediaType: file.type,
        name: file.name
      })
    }
    setPhotos((prev) => [...prev, ...next])
  }

  const extract = async () => {
    setExtracting(true)
    setError(null)
    try {
      const response = await fetch("/api/extract-menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: photos.map((p) => ({ mediaType: p.mediaType, data: p.dataUrl }))
        })
      })
      if (!response.ok) throw new Error(`Extraction failed (HTTP ${response.status})`)
      const json: unknown = await response.json()
      const decoded = Schema.decodeUnknownSync(MenuExtraction)(json)
      setExtraction(decoded)
      setSelections({})
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed")
    } finally {
      setExtracting(false)
    }
  }

  const reset = () => {
    setPhotos([])
    setExtraction(null)
    setSelections({})
    setError(null)
  }

  const updateSelection = (index: number, patch: Partial<OrderSelection>) => {
    setSelections((prev) => ({
      ...prev,
      [index]: { ...(prev[index] ?? emptySelection()), ...patch }
    }))
  }

  const ordered = extraction
    ? extraction.items
        .map((item, index) => ({ item, index, selection: selections[index] ?? emptySelection() }))
        .filter(({ selection }) => selection.quantity > 0)
    : []
  const total = extraction ? orderTotal(extraction, selections) : { known: true, amountMinor: 0 }

  return (
    <main>
      <h1>Traveevu — Scan, understand, order</h1>
      <p className="muted">
        Photograph a menu, pick your dishes, and show the bilingual order to staff.
        Nothing is published; the photos are used only for extraction.
      </p>

      {error && <p className="error">{error}</p>}

      {!extraction && (
        <section className="card">
          <h2>1. Photograph the menu</h2>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => void addPhotos(e.target.files)}
          />
          <div className="thumbs">
            {photos.map((photo, i) => (
              <div key={i} className="thumb">
                <img src={photo.dataUrl} alt={`Menu page ${i + 1}`} />
                <button
                  type="button"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="primary"
            disabled={photos.length === 0 || extracting}
            onClick={() => void extract()}
          >
            {extracting ? "Extracting…" : `Extract menu (${photos.length} photo${photos.length === 1 ? "" : "s"})`}
          </button>
        </section>
      )}

      {extraction && (
        <>
          <section className="card">
            <h2>2. Your menu</h2>
            <p className="muted">
              Extraction confidence: {Math.round(extraction.overallConfidence * 100)}%
              {extraction.warnings.length > 0 && ` · ${extraction.warnings.join(" ")}`}
            </p>
            {extraction.categories.map((category) => (
              <CategorySection
                key={category}
                category={category}
                items={extraction.items
                  .map((item, index) => ({ item, index }))
                  .filter(({ item }) => item.category === category)}
                selections={selections}
                onSelect={updateSelection}
              />
            ))}
            <CategorySection
              category="Other"
              items={extraction.items
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => item.category === null)}
              selections={selections}
              onSelect={updateSelection}
            />
          </section>

          <section className="card">
            <h2>3. Your order — show this to staff</h2>
            {ordered.length === 0 && <p className="muted">Nothing selected yet.</p>}
            {ordered.map(({ item, index, selection }) => {
              const total = lineTotal(item, selection)
              return (
                <div key={index} className="order-line">
                  <div className="row">
                    <strong>{item.originalName}</strong>
                    {item.translatedName && <span className="muted">({item.translatedName})</span>}
                    {selection.sizeLabel && <span>· {selection.sizeLabel}</span>}
                    {selection.optionLabels.length > 0 && (
                      <span>· {selection.optionLabels.join(", ")}</span>
                    )}
                  </div>
                  <div className="row">
                    <span className="qty">
                      <button
                        type="button"
                        aria-label="Decrease quantity"
                        onClick={() =>
                          updateSelection(index, { quantity: Math.max(0, selection.quantity - 1) })
                        }
                      >
                        −
                      </button>
                      <span>{selection.quantity}</span>
                      <button
                        type="button"
                        aria-label="Increase quantity"
                        onClick={() => updateSelection(index, { quantity: selection.quantity + 1 })}
                      >
                        +
                      </button>
                    </span>
                    <span>{total.known ? formatVND(total.amountMinor) : "Price unknown — ask staff"}</span>
                    <button
                      type="button"
                      onClick={() => updateSelection(index, { quantity: 0 })}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
            {ordered.length > 0 && (
              <p>
                <strong>
                  Total:{" "}
                  {total.known
                    ? formatVND(total.amountMinor)
                    : "Some prices unknown — confirm with staff"}
                </strong>
              </p>
            )}
            <p className="muted">Prices as printed on the menu. Unknown prices are never guessed.</p>
            <button type="button" onClick={reset}>
              Scan another menu
            </button>
          </section>
        </>
      )}
    </main>
  )
}

function CategorySection({
  category,
  items,
  selections,
  onSelect
}: {
  category: string
  items: Array<{ item: MenuItemExtraction; index: number }>
  selections: Readonly<Record<number, OrderSelection>>
  onSelect: (index: number, patch: Partial<OrderSelection>) => void
}) {
  if (items.length === 0) return null
  return (
    <section>
      <h3>{category}</h3>
      {items.map(({ item, index }) => (
        <ItemCard
          key={index}
          item={item}
          index={index}
          selection={selections[index] ?? emptySelection()}
          onSelect={onSelect}
        />
      ))}
    </section>
  )
}

function ItemCard({
  item,
  index,
  selection,
  onSelect
}: {
  item: MenuItemExtraction
  index: number
  selection: OrderSelection
  onSelect: (index: number, patch: Partial<OrderSelection>) => void
}) {
  const needsSize = item.sizes.length > 0 && selection.sizeLabel === null
  const hasKnownPrice =
    item.price !== null || item.sizes.some((s) => s.price !== null)
  return (
    <div className="card">
      <strong>{item.originalName}</strong>
      {item.translatedName && <div className="muted">{item.translatedName}</div>}
      {item.description && <p>{item.description}</p>}
      <p>
        {item.price
          ? formatVND(item.price.amountMinor)
          : item.sizes.length > 0
            ? "See sizes"
            : "Price not shown — ask staff"}
      </p>
      {item.sizes.length > 0 && (
        <div className="row">
          {item.sizes.map((size) => (
            <label key={size.label} className="choice">
              <input
                type="radio"
                name={`size-${index}`}
                checked={selection.sizeLabel === size.label}
                onChange={() => onSelect(index, { sizeLabel: size.label })}
              />
              {size.label}
              {size.price ? ` — ${formatVND(size.price.amountMinor)}` : " — price unknown"}
            </label>
          ))}
        </div>
      )}
      {item.options.length > 0 && (
        <div className="row">
          {item.options.map((option) => (
            <label key={option.label} className="choice">
              <input
                type="checkbox"
                checked={selection.optionLabels.includes(option.label)}
                onChange={(e) =>
                  onSelect(index, {
                    optionLabels: e.target.checked
                      ? [...selection.optionLabels, option.label]
                      : selection.optionLabels.filter((l) => l !== option.label)
                  })
                }
              />
              {option.label}
              {option.priceDelta ? ` (+${formatVND(option.priceDelta.amountMinor)})` : ""}
            </label>
          ))}
        </div>
      )}
      {item.uncertainties.length > 0 && (
        <p className="warn">
          Uncertain: {item.uncertainties.map((u) => u.reason).join("; ")}
        </p>
      )}
      {!hasKnownPrice && <p className="warn">No price on the menu for this item.</p>}
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={needsSize}
          onClick={() => onSelect(index, { quantity: selection.quantity + 1 })}
        >
          {selection.quantity > 0 ? `Add another (${selection.quantity} in order)` : "Add to order"}
        </button>
      </div>
    </div>
  )
}
