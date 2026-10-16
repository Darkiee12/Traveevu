# ADR 0002 — Dish identity: no `DishVariant` table in the MVP (Option A)

> Status: **Accepted** 2026-10-17 (PLANNING — no code).
> Fixes an inconsistency: `domain-model.md` previously defined
> `DishVariant` as a separate table while `README.md` deferred it.
> This ADR is the tie-breaker.

## Context

A dish like Cơm tấm appears on menus in variants (sườn, bì, chả trứng).
The domain model must decide where a "variant" lives: its own entity
with identity and lifecycle, or a label on the thing that actually
varies (the restaurant's menu item). The choice affects the schema,
dish matching, price aggregation, dietary reasoning, and every query
that groups by dish. It is expensive to reverse once data, mappings,
and UI are built on it — hence a locked decision now.

## Options considered

- **A — No `DishVariant` table in the MVP (chosen).** Group discovery
  by canonical `Dish`. Preserve variations as `MenuItem.variantLabel`
  (nullable, validated, from menu evidence, never invented) on the
  menu items that sell them. Dish pages group mapped menu items by
  variant label. Price stats and dietary reasoning aggregate at the
  `Dish` level; variant-level views are display groupings, not
  entities.
- **B — Separate `DishVariant` table now.** Each recognized variant
  gets its own row (`dishId`, `variantName`,
  `distinguishingIngredients`, `notes`) with its own identity.
  Rejected for the MVP: it forces a threshold decision ("when does a
  variant deserve a row?") that cannot be answered without real menu
  data, invites a proliferation of near-duplicate entities (the same
  failure mode as a `Dish` per menu spelling), and adds curation
  burden before the demo proves the core journey.
- **C — Variants as free text only.** No `variantLabel` field; variant
  info survives only inside `originalName`. Rejected: the label
  becomes unqueryable, so dish pages cannot group by variant and
  matching cannot use variant evidence.

## Decision (Option A)

- No `DishVariant` table, no variant entity, no variant threshold in
  the MVP.
- `MenuItem.variantLabel`: nullable validated string from menu
  evidence; `null` = no variant stated. A one-off size/portion
  difference is a `MenuItemOption`, not a variant.
- Discovery, search, price stats, and dietary reasoning key on the
  canonical `Dish`. Variant grouping is a presentation of menu items.
- Dish matching may use variant labels as evidence (matching
  `matchType: variant` stays valid) but never creates a variant entity.

## Consequences

- Schema is smaller: one fewer table, one fewer mapping decision in
  extraction, one fewer curation queue.
- Variants stay visible to travelers (grouped on dish pages) without
  becoming entities the team must curate.
- If two restaurants' "same" variant actually differ in ingredients
  or allergens, that difference is visible only per menu item, not
  as a shared variant fact — acceptable for the MVP, since dietary
  claims already require per-item evidence tiers.

## What would change this

Promotion to a `DishVariant` table requires a new ADR + a migration
that builds the table from observed `MenuItem.variantLabel` values
plus a curation pass. Trigger: variants prove they need their own
lifecycle (own ingredients, allergens, curation, identity
independent of any menu). Do not pre-build it.
