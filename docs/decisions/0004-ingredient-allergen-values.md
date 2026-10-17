# ADR 0004 — Ingredient / Allergen as validated values in the MVP

> Status: **Accepted** 2026-10-17 (PLANNING — no code).
> Fixes an inconsistency: `README.md` deferred Ingredient/Allergen to
> value objects while `domain-model.md` made them tables. This ADR
> is the tie-breaker: **values**.

## Context

Dietary safety is the product's hardest promise: a traveler with a
peanut allergy must be able to trust what Traveevu says about a
dish. The domain model must decide where ingredient and allergen
information lives: independent reference tables with joins
(`Ingredient`, `Allergen`, `DishIngredient`, `IngredientAllergen`),
or validated structured values owned by the dish (and, where
evidenced, by the menu item). The choice affects the schema,
extraction, dietary filtering, and curation workload. It is
expensive to reverse once dishes, filters, and UI are built on it
— hence a locked decision now.

## Options considered

- **A — Validated values in the MVP (chosen).** Ingredients and
  allergen statuses live as validated values on `Dish`, with
  optional evidence-backed values on `MenuItem`. The allergen
  vocabulary is a centralized Effect Schema enum. No reference
  tables, no joins, no shared ingredient→allergen mapping.
- **B — Independent reference tables now.** `Ingredient` +
  `Allergen` tables, `DishIngredient` join (role, evidence),
  `IngredientAllergen` mapping. Rejected for the MVP: it forces
  curating a shared vocabulary and join rows before the demo proves
  the core journey, and a centrally derived allergen list is only
  as complete as its mapping — an incomplete mapping silently
  under-reports. Tables buy cross-dish querying and one spelling;
  the MVP does not need either yet.
- **C — Free-text ingredients / string allergens.** Rejected:
  unqueryable, unscannable, and unsafe — arbitrary allergen strings
  scattered through the app cannot support deterministic filtering.

## Decision

### 1. No tables in the MVP

No independent `Ingredient`, `Allergen`, `DishIngredient`, or
`IngredientAllergen` tables. There are no join rows to curate and
no shared ingredient→allergen mapping to keep complete.

### 2. Ingredients are validated values on `Dish`

```ts
IngredientValue = {
  name: string,            // original name as evidenced (verbatim where from menu text)
  normalizedId?: string,   // optional dedup aid, e.g. "fish-sauce" — NOT a foreign key
  role: "core" | "common" | "optional" | "garnish",
  evidenceLevel: "known" | "common" | "confirmed" | "unknown", // see data-provenance.md §4.1
  sourceRef?: string,      // snapshot / contribution / curation ref, where available
}
Dish = { ..., ingredients: IngredientValue[] }
```

`normalizedId` helps grouping and de-duplication without a table.
Two dishes may spell the same ingredient differently; that is
tolerated in the MVP (see § Promotion triggers).

### 3. One centralized allergen vocabulary (Effect Schema)

`AllergenCode` is a single Effect Schema union in
`packages/contracts` (`peanut`, `tree_nut`, `shellfish`, `fish`,
`egg`, `dairy`, `gluten`, `soy`, `sesame`, …). Every allergen value
anywhere in the app must validate against it. No arbitrary allergen
strings, no per-file string literals, no second list. Adding a code
is a contract change: versioned, reviewed, released with the
contracts package. This resolves `data-provenance.md` Q3
(allergen vocabulary governance).

### 4. Allergen status is four-state — missing ≠ confirmed absent

```ts
AllergenStatus = {
  allergen: AllergenCode,
  status: "present" | "possibly_present" | "confirmed_absent" | "unknown",
  evidence?: string,       // how the status was established
  sourceRef?: string,
}
Dish = { ..., allergenStatuses: AllergenStatus[] }
```

- `present` — evidenced in the dish/serving.
- `possibly_present` — may be present, including cross-contact risk
  or uncertain preparation.
- `confirmed_absent` — established by restaurant confirmation (or
  moderator-verified evidence). **Never** by AI inference, **never**
  by absence of mention, **never** by an empty ingredient list.
- `unknown` — no information. An allergen with no entry in
  `allergenStatuses` is `unknown` (implicit); the array holds only
  asserted statuses.

Ingredient evidence level and allergen status are **distinct axes**
— do not conflate them. An ingredient with evidence `common`
(commonly in the recipe) can support at most
`possibly_present` for its allergen, never `present`. A
`confirmed_absent` verdict is about the allergen, established by
confirmation, not by ingredient bookkeeping.

### 5. Dish-level is typical; MenuItem-level is this serving

- `Dish.ingredients[]` / `Dish.allergenStatuses[]` describe the
  **typical recipe** — not a guarantee about any restaurant's
  preparation.
- `MenuItem` may carry its own evidence-backed values where the
  menu provides them:

```ts
MenuItem = { ..., ingredients?: IngredientValue[], allergenStatuses?: AllergenStatus[] }
```

  Empty / absent = no menu-level evidence; dietary reasoning then
  falls back to the Dish-level typical values **with uncertainty
  surfaced** ("typical recipe, not confirmed for this serving").
  MenuItem-level evidence, when present, takes precedence for that
  serving.

### 6. AI proposes; it never clears an allergen

- AI extraction may propose ingredients or allergen concerns. A
  proposal carries the evidence of its source: transcribed menu
  text → ingredient evidence `known`; unsourced AI suggestion →
  ingredient evidence `common` at most / allergen status
  `possibly_present` at most, with provenance recorded.
- AI **cannot** set `confirmed_absent`. Only restaurant
  confirmation (or moderator-verified evidence) establishes it.
- Restaurant confirmation and cross-contact uncertainty stay
  distinguishable: cross-contact risk is expressed as
  `possibly_present` + an uncertainty entry (e.g.
  `cross_contact_unknown`), never collapsed into `absent` or
  `unknown`.

### 7. Dietary filtering respects evidence levels

Filtering is deterministic code, never LLM judgment:

- **Strict allergen exclusion** (user's allergy): a "safe" verdict
  requires `confirmed_absent` for that allergen at the applicable
  level (MenuItem-level if present, else Dish-level) **and** no
  `possibly_present` / `unknown` that blocks the claim. Anything
  else → "cannot confirm safe": show the warning, suggest asking
  staff. Never a green safe badge from uncertainty.
- **Non-strict preferences** (dislikes, avoidances) may filter on
  `present` only.
- The UI always shows *why*: the status, the evidence, and the
  typical-vs-serving distinction. See `customer-design.md` §6.

### 8. Promotion triggers (future, need a new ADR)

Promote to reference tables only if evidence demands it:

- **Cross-dish ingredient querying** becomes a real feature
  ("which dishes contain X?" as a first-class query, not a scan).
- **Duplicated vocabulary maintenance** grows painful (same
  ingredient spelled many ways, curation burden).
- **Centrally curated ingredient→allergen relationships** become
  required (one mapping the team maintains, instead of per-dish
  statuses).

Promotion = new ADR + migration that builds the tables from the
value arrays + a curation pass. Do not pre-build it.

## Consequences

- Smallest domain: no vocabulary tables, no joins, no mapping to
  keep complete before the core journey works.
- Dietary safety rests on explicit per-dish (and per-serving)
  statuses with evidence — not on a shared derivation that could
  silently under-report.
- Cost: ingredient spellings may duplicate across dishes;
  cross-dish ingredient queries are scans, not indexed joins.
  Accepted for the MVP.
- No comprehensive food ontology in the MVP. The vocabulary grows
  from real dishes and real menus, not from a pre-built taxonomy.

## What would change this

- Any promotion trigger in §8 firing, via a new ADR.
- If restaurant-confirmed allergen data proves systematically
  unavailable in practice, the `confirmed_absent` bar does **not**
  lower — the UI keeps saying "cannot confirm safe". Lowering the
  bar would need a new ADR and is a safety regression by default.
