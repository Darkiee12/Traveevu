# Traveevu — Domain Model

> Status: PLANNING — no application code. Companion to `architecture.md`, `ai-boundaries.md`, `menu-rendering.md`, `data-provenance.md`.
> Principle: resolve domain ambiguity **before** creating incompatible modules. No generic universal JSON table. No one-table-per-entity dogma — tables where identity/lifecycle/querying demands it, structured values / JSONB where the value has no independent lifecycle.

## 1. Smallest domain that supports the MVP

The MVP slice (scan → understand → select → bilingual order → reuse) needs **six core concepts**. Everything else is supporting or deferred.

| # | Concept | Why MVP needs it |
|---|---|---|
| 1 | `Dish` (canonical) | Dish-first discovery; stable identity for "Cơm tấm" across restaurants |
| 2 | `MenuItem` (restaurant-specific) | What *this* restaurant sells, at *this* price, with *these* options |
| 3 | `MenuSnapshot` (observation, versioned) | A scan is evidence at a time; never overwrite history |
| 4 | `PriceObservation` (listed vs paid) | Listed menu price ≠ receipt-paid price; different evidence strength |
| 5 | `OrderDraft` (user-private) | Selections + notes; must never leak into the shared snapshot |
| 6 | `Contribution` (state machine) | How a private scan becomes shared, moderated, published data |

If a proposed entity does not serve one of these six or the studio registries, it is deferred.

## 2. Entity catalogue — table vs structured value

Legend: **Table** = independent identity, lifecycle, queried/joined, versioned/audited. **Value** = owned by a parent, no independent identity, stored as columns / JSONB inside the parent. **JSONB (validated)** = structured payload validated by an Effect Schema contract, stored in JSONB.

| Entity (from prompt §5) | Form | Rationale |
|---|---|---|
| `Dish` | **Table** | Canonical identity; aliases point here; discovery + pricing aggregate here. Variations live on `MenuItem.variantLabel`, not a separate table (ADR 0002) |
| `DishAlias` | **Table** (or table-backed) | Many spellings/names per dish; needs lookup index + provenance; not a throwaway string |
| `DishVariant` | **NOT a table in the MVP** (ADR 0002) | No `DishVariant` table. Regional / preparation variants (e.g., Cơm tấm sườn vs bì vs chả) are preserved as `MenuItem.variantLabel` on the menu items that sell them; dish pages group those items by label. A one-off size/portion difference is a `MenuItemOption`, not a variant |
| `Ingredient` | **Value (JSONB inside `Dish`, validated)** | No `Ingredient` table in MVP (ADR 0004). `Dish.ingredients[]`: `{ name, normalizedId?, role, evidenceLevel, sourceRef? }`. `MenuItem` may carry its own evidence-backed `ingredients[]` |
| `Allergen` | **Value (Effect Schema enum + per-dish status array)** | No `Allergen` table in MVP (ADR 0004). One centralized `AllergenCode` enum in `packages/contracts`; `Dish.allergenStatuses[]`: `{ allergen, status: present \| possibly_present \| confirmed_absent \| unknown, evidence?, sourceRef? }`. Never free-text in safety-critical paths |
| `Restaurant` | **Table** | Identity, PostGIS location, attributes, moderation |
| `MenuCaptureSession` | **Table** (private, ADR 0006) | One private scanning session: N ordered photos + combined AI extraction; token-based for guests; temp retention; at most one snapshot per session in MVP |
| `MenuSnapshot` | **Table** | Immutable observation of captured menu content (possibly partial); never "published" — publication belongs to `PublishedMenuRevision`. Corrections materialize new snapshots; nothing overwrites |
| `PublishedMenuRevision` | **Table** (ADR 0006) | The approved, reusable restaurant menu for (restaurant, scope): references ≥1 approved snapshots (MVP: exactly 1), `revisionNumber` monotonic per restaurant+scope. `published` = in the published set (may or may not be current); `superseded` = withdrawn. Current menu = pointer-selected revision (`CurrentMenuRevision`) |
| `CurrentMenuRevision` | **Table** (pointer, ADR 0006 §2.11) | Explicit current-revision pointer per (restaurant, scope): `(restaurantId, scope)` → `revisionId`. Publish / rollback / withdraw move it transactionally; no pointer row = no current menu |
| `MenuItem` | **Table** (child of snapshot) | Restaurant-specific item within a snapshot; maps to `Dish` optionally (`dishId` nullable — unmapped stays unmapped, never forced); `pageIndex?` = which photo/page it was extracted from |
| `MenuItemOption` | **Value / JSONB inside MenuItem** | Sizes/modifiers/choices belonging to one item; no independent lifecycle. Validated array in JSONB |
| `PriceObservation` | **Table** | Evidence row: source (listed vs receipt), amount, currency, time, place, confidence, provenance |
| `UserPreference` | **Table** (user-scoped, private) | One row per user: `userId` (PK, FK → Better Auth `user.id`), `preferences` (validated JSONB — Effect Schema `UserPreferenceDoc`), `schemaVersion`, `revision` (optimistic concurrency), timestamps. Hybrid per ADR 0005 |
| `FavoriteDish` | **NO table in MVP** (ADR 0005) | Replaced by `UserPreference.preferences.tasteAnchors`: one ordered, validated discriminated collection (`TasteAnchor`, max 5 total). Future arbitrary bookmarking is a separate model, not a reinterpretation of taste anchors |
| `PreferenceConflict` | **Table** (private, ADR 0005 §3) | Minimal conflict store owned by the authenticated account: incoming guest preference document + schema version + revision, persisted before any destructive linking step; lazy atomic resolution; 90-day retention default for unresolved rows |
| `MediaAsset` | **Table** (metadata) + object storage (bytes) | Stable resource ID; metadata in Postgres, bytes in R2; public/private flag |
| `Contribution` | **Table** (state machine) | Wraps a scan / correction / price report / photo; tracks moderation + publication. (`review` joins as a subject type only when Review ships — deferred, see `Review`) |
| `Review` | **DEFERRED — future independent entity, NO table in MVP** | Dish or restaurant review; provenance + moderation; distinct from price/menu evidence. NOT a value object, NOT a JSONB array on `Dish`/`Restaurant`. Do not build the table during the initial scan-to-order MVP. See §4.14 |
| `MenuTemplate` | **Table** | Template identity + metadata |
| `MenuTemplateVersion` | **Table** (JSONB payload, immutable) | Versioned template config; published versions immutable |
| `MenuPresentation` | **Derived / cacheable, NOT a primary table** | Built from (published revision *or* private snapshot + template) via validated transform; shared cache key `(publishedRevisionId, templateVersion, locale)` / private key `(snapshotId, templateVersion, locale)`; never the source of truth |
| `OrderDraft` | **Table** (user-private) | Draft selections; pins `menuRef` (published revision *or* private snapshot), never floats; never merged into shared content |
| `PromptDefinition` | **Table** | Prompt identity + metadata |
| `PromptVersion` | **Table** (JSONB payload, immutable) | Versioned prompt + model + params + schemas; published versions immutable |
| `AIExecution` | **Table** (append-only log) | One row per AI call: promptVersion, model, latency, tokens/cost, validation errors, input refs (no PII) |

**Anti-patterns rejected:**

- One generic `entities (id, type, data JSONB)` table for everything — destroys type safety, indexes, invariants.
- Treating every menu-item name as an independent canonical `Dish` — creates thousands of near-duplicates. Menu items map to dishes; unmapped items stay unmapped until curated.
- Storing user preferences or order drafts inside the shared menu snapshot — forbidden (see §6).

## 3. ER sketch (text)

```
Dish 1──* DishAlias
Dish contains ingredients[]   (validated values, ADR 0004 — NO DishIngredient table)
Dish contains allergenStatuses[] (validated values, ADR 0004 — NO Allergen / IngredientAllergen tables)
MenuItem contains ingredients[] / allergenStatuses[] (optional, evidence-backed, ADR 0004)
Dish 1──* PriceObservation    (aggregated view; observations also link Restaurant/MenuItem)
Dish 1──* Review (dish reviews — DEFERRED, future entity, no table in MVP; see §4.14)
Dish 1──* UserPreference.tasteAnchors (dish-kind entries inside the preference doc, NOT a join table — ADR 0005; no FK, validated on write, normalized on dish merge)
User 1──* PreferenceConflict (owned by the authenticated account — ADR 0005 §3)

Restaurant 1──* MenuCaptureSession (private scanning sessions)
MenuCaptureSession 1──0..1 MenuSnapshot (at most one snapshot per session in MVP)
Restaurant 1──* MenuSnapshot (versioned, append-only observations)
MenuSnapshot 1──* MenuItem
MenuItem *──* MenuItemOption (JSONB value inside MenuItem)
MenuItem *──1 Dish (nullable FK: mapped dish, or NULL = unmapped)
MenuItem.variantLabel — nullable variant label (e.g. "sườn nướng"); NO DishVariant table in MVP (ADR 0002)
MenuItem.pageIndex — nullable; which photo/page the item was extracted from (ADR 0006)
MenuItem 1──* PriceObservation (listed-price evidence)
Restaurant 1──* PriceObservation
Restaurant 1──* Review (restaurant reviews — DEFERRED, future entity, no table in MVP; see §4.14)
Restaurant 1──* PublishedMenuRevision (history preserved; multiple may be `published`, `superseded` = withdrawn)
Restaurant 1──1 CurrentMenuRevision (exactly one current pointer per (restaurant, scope), or none)
CurrentMenuRevision ──> PublishedMenuRevision (pointer target = current menu)
PublishedMenuRevision *──* MenuSnapshot (source snapshots, ≥1; MVP: exactly 1)
MenuSnapshot ──> PublishedMenuRevision (corroboratesRevisionId, nullable — approved-as-corroboration)

User 1──1 UserPreference
User 1──* OrderDraft
OrderDraft 1──* OrderDraftLine (value/child: item ref + options + qty + note)
OrderDraft ──> PublishedMenuRevision | MenuSnapshot (via menuRef discriminated union; never floats)

Contribution 1──1 <subject>   (polymorphic by type: menu_scan | correction | price_report | photo; `review` joins only when Review ships — deferred)
Contribution ──> MenuSnapshot / PriceObservation / MediaAsset (as applicable; `Review` target when Review ships — deferred)
Contribution (correction) ──> PublishedMenuRevision (targetRevisionId — the revision being corrected)

MenuTemplate 1──* MenuTemplateVersion
PromptDefinition 1──* PromptVersion
AIExecution ──> PromptVersion (nullable for non-prompt calls) + Contribution/MenuSnapshot refs

MediaAsset 1──* <referenced by Dish / Restaurant / MenuSnapshot> (by stable resource ID; `Review` reference when Review ships — deferred)
```

Cardinalities are logical; physical FKs follow the same shape. Polymorphic `Contribution.subject` is modeled as explicit nullable FKs + a `subject_type` discriminator, not a stringly-typed generic reference — so integrity is checkable.

## 4. Entity definitions & key fields

### 4.1 `Dish` (canonical)

Identity for a food, independent of any restaurant.

- `id` (stable, e.g., UUID / slug — decide once in M0)
- `canonicalName` — local name, original language (e.g., `Cơm tấm`). Never overwritten by translation.
- `translatedName` — per-locale translations (JSONB map `locale → name`, validated). Translations never overwrite canonical.
- `description` — short, curated; provenance-tagged (curated vs AI-suggested vs unknown).
- `originRegion` — region/city of origin (nullable, with evidence level).
- `mealOccasions` — e.g., breakfast/lunch/dinner/snack (array, validated).
- `flavorProfile` / `textureProfile` — structured enums/tags (spicy, sour, sweet, savory; crispy, soupy…), not free prose, so filtering is deterministic.
- `ingredients[]` — validated `IngredientValue`s (ADR 0004): `{ name, normalizedId?, role: core | common | optional | garnish, evidenceLevel: known | common | confirmed | unknown, sourceRef? }`. Describes the **typical recipe**, not guaranteed preparation.
- `allergenStatuses[]` — validated `AllergenStatus` values (ADR 0004): `{ allergen: AllergenCode (centralized Effect Schema enum), status: present | possibly_present | confirmed_absent | unknown, evidence?, sourceRef? }`. An allergen with no entry is `unknown`. `confirmed_absent` requires restaurant confirmation (or moderator-verified evidence) — never AI inference, never absence of mention.
- `typicalPriceRange` — **derived**, never stored as a fact. Computed from `PriceObservation`s (median/percentiles). Displayed with evidence count + area + date range.
- `status` — `draft | published | merged | deprecated` (merging keeps alias + redirect).

**Invariant:** A `Dish` is never created implicitly by AI extraction alone without a mapping decision. Extraction proposes a mapping (`dishId` + confidence); a human/curation step or a high-confidence deterministic rule confirms it. Low-confidence stays unmapped.

### 4.2 `DishAlias`

- `dishId`, `alias` (original spelling), `locale`/`language`, `source` (curated / extraction / user), `confidence`.
- Indexed for lookup: alias matching is deterministic (normalized, diacritic-aware for Vietnamese) + AI-assisted disambiguation only when deterministic match is ambiguous. See `ai-boundaries.md`.
- **Invariant:** Aliases never change the canonical name. Merging two dishes re-points aliases, never deletes history. A merge also preserves a redirect (merged-away id → canonical id) and **must** normalize `UserPreference.preferences.tasteAnchors` in every preference document (and in `PreferenceConflict` incoming documents): map `dish`-kind entries through redirects, leave `unmatched` entries untouched, deduplicate the whole collection preserving first-occurrence order, keep the ≤ 5 cap (ADR 0005 §4). Writes referencing a merged-away id are rejected; stored pre-merge ids resolve via redirects during migration.

### 4.3 `DishVariant` — NOT a table in the MVP (ADR 0002, Option A)

There is no `DishVariant` table, no `variantName` / `distinguishingIngredients`
entity, and no variant threshold to decide in the MVP. Variations are
preserved where they are observed — on the menu item:

- `MenuItem.variantLabel`: nullable, validated string (e.g., `sườn nướng`,
  `bì`, `chả trứng`), taken from the menu evidence (original wording),
  never invented. `null` = no variant stated.
- Discovery groups by canonical `Dish`. A dish page shows its mapped
  menu items grouped by `variantLabel` (plus an "no variant stated"
  group), so variants stay visible without becoming entities.
- Price stats and dietary reasoning aggregate at the `Dish` level;
  variant-level stats are a display grouping of `MenuItem` /
  `PriceObservation` rows, never a separate aggregate entity.
- A restaurant's one-off size/portion difference is a `MenuItemOption`,
  not a variant.
- **Promotion path (only if evidence demands it later):** if variants
  ever prove they need their own lifecycle (own ingredients, allergens,
  curation, identity independent of any menu), promote them via a
  migration that creates the table from `MenuItem.variantLabel`
  values + a curation pass — recorded in a new ADR. Do not pre-build it.

### 4.4 `Ingredient` / `Allergen` — validated values, NO tables (ADR 0004)

There are no `Ingredient`, `Allergen`, `DishIngredient`, or
`IngredientAllergen` tables in the MVP. Ingredients and allergen
statuses are validated structured values owned by `Dish` (typical
recipe) and, where evidenced, by `MenuItem` (this serving):

- `IngredientValue`: `name` (original, verbatim where from menu
  text), `normalizedId?` (optional dedup aid, e.g. `fish-sauce` —
  NOT a foreign key), `role` (`core | common | optional | garnish`),
  `evidenceLevel` (`known | common | confirmed | unknown` — see
  `data-provenance.md` §4.1), `sourceRef?` (snapshot / contribution
  / curation ref where available).
- `AllergenStatus`: `allergen` (`AllergenCode` — one centralized
  Effect Schema enum in `packages/contracts`; no arbitrary allergen
  strings anywhere), `status` (`present | possibly_present |
  confirmed_absent | unknown`), `evidence?` (how established),
  `sourceRef?`. An allergen with no entry is `unknown`.
- `Dish.ingredients[]` / `Dish.allergenStatuses[]` describe the
  typical recipe — not a guarantee about any restaurant's
  preparation. `MenuItem.ingredients[]` / `MenuItem.allergenStatuses[]`
  (optional) carry that serving's evidence-backed values from the
  menu; when present they take precedence for that serving, otherwise
  reasoning falls back to the Dish-level typical values with
  uncertainty surfaced.
- **Invariant:** Allergen statuses are explicit per-dish (or
  per-serving) values, never derived from a shared mapping (there
  is none) and never from LLM absence ("model didn't mention
  peanut" ≠ "peanut-free"). `confirmed_absent` requires restaurant
  confirmation (or moderator-verified evidence). AI may propose
  ingredients / allergen concerns (menu text → `known`;
  unsourced suggestion → `common` / `possibly_present` at most)
  but can never set `confirmed_absent`. Cross-contact risk is
  `possibly_present` + an uncertainty entry (e.g.
  `cross_contact_unknown`), never collapsed into absent/unknown.
- **Promotion path (only if evidence demands it later):** if
  cross-dish ingredient querying, duplicated vocabulary
  maintenance, or centrally curated ingredient→allergen
  relationships require tables, promote via a new ADR + migration
  from the value arrays + a curation pass. Do not pre-build a food
  ontology.

### 4.5 `Restaurant`

- `id`, `name` (original), `translatedName` (locale map), `location` (PostGIS `geography(Point, 4326)`), `address` (structured + free-text), `attributes` (validated JSONB: seating, cash-only, halal… — each attribute provenance-tagged), `status` (`draft | published | closed | duplicate`), `source`.
- **Invariant:** Restaurant identity is deduplicated by (name + location proximity + address) with human review for near-duplicates. Never auto-merge on name alone.

### 4.6 `MenuSnapshot` (immutable observation, possibly partial) — ADR 0006

One row per menu observation. **Corrections and re-scans create new rows; nothing overwrites.** A snapshot is an observation of
captured content — **not** necessarily an entire restaurant menu,
and **never** "published". Publication belongs to
`PublishedMenuRevision` (§4.22). The old rule "current menu =
latest `published` snapshot" is retired (ADR 0006 §6).

**Corrections, practically (review amendment 2026-10-16 — locked, mechanics updated by ADR 0006 §5):**
OCR/extraction mistakes are expected, so correction must be a
first-class, low-friction path — not "append-only means unfixable":

- The **original extraction payload is preserved verbatim** in the
  snapshot that produced it (plus the source image ref, prompt version,
  model, confidence). It is never edited in place.
- A **correction is a `Contribution` of type `correction`** that
  carries a field-level change list: `{ field, oldValue, newValue,
  reason, actor, at }` (e.g. `items[2].price: 85000 → 65000`,
  reason `OCR misread 6 as 8`) **against the current published
  revision** (`targetRevisionId`). No free-form "fixed the menu".
- On **submit**, the system materializes a **candidate snapshot**:
  a copy of the current revision's content with the validated
  change list applied deterministically (no AI), `source:
  correction`, `provenance: { baseSnapshotIds,
  correctionContributionId }`, `status: pending_review`. On
  approval, a new `PublishedMenuRevision` references it; on
  rejection it stays `rejected` (history preserved). The UI
  (admin + traveler confirm screen) shows original vs corrected
  side by side, and history shows every version + its correction
  reason. Nothing is silently overwritten.
- **Per-field provenance, not just per-snapshot.** Each corrected /
  confirmed field carries its own evidence level: `ai_extracted`
  (observed, with confidence + prompt version) → `user_confirmed`
  (the traveler reviewed and confirmed that field) →
  `restaurant_confirmed` (restaurant statement — strongest, only from
  an explicit restaurant confirmation, never inferred). A snapshot
  therefore mixes levels: one item's price may be
  `restaurant_confirmed` while another item's description is still
  `ai_extracted`. The confirm screen promotes only the fields the
  user actually reviewed; unreviewed fields stay `ai_extracted`.
- **Promotion is recorded**, never assumed: who confirmed what, when,
  from which evidence. Demotion is also possible (a newer observation
  can demote a field back to `ai_extracted` / `unknown`).
- **Dietary / safety fields** follow the same rule with a stricter
  gate: a correction that *adds* an allergen or *removes* one
  requires moderator review — it is never auto-published from a
  single user correction. See `data-provenance.md` §4.

- `id`, `restaurantId` (nullable until identified), `scope` (`MenuScope`, default `main`), `snapshotVersion` (monotonic per restaurant; assigned once `restaurantId` is known), `sessionId` (nullable; null for correction-materialized / manual), `source` (`session_scan | correction | manual`), `imageRefs` (ordered `MediaAsset` ids — scan images are processed privately server-side with temporary storage + retention limits; see `data-provenance.md` §5.2), `extraction` (validated JSONB payload: items, categories, prices, options, uncertainties), `extractionConfidence` (overall + per-item), `coverage` (`MenuCoverage`), `coverageNote?`, `provenance` (`{ baseSnapshotIds[], correctionContributionId? }` — empty base for scans), `status` (`draft | pending_review | approved | rejected` — never `published`, never `superseded`; ADR 0006), `corroboratesRevisionId` (nullable — set when approved as corroboration, ADR 0006 §2.6), `capturedAt` (extraction time), `observedMenuAt` (menu's own date, if visible; nullable), `createdBy` (user id, private, nullable for guest-token sessions — guest snapshots link via `sessionId`), `createdAt`.
- **Invariant:** The snapshot **evidence payload** (`extraction`, `imageRefs`, `provenance`, `capturedAt` / `observedMenuAt`, `sessionId`, `source`, `snapshotVersion`) is immutable — never rewritten, including by corrections, which create new evidence-bearing snapshots. Workflow fields (`status`, `corroboratesRevisionId`, `restaurantId` set-once, `coverage`/`coverageNote`) change only through audited, authorized transitions (ADR 0006 §2.2). The "current menu" for a restaurant + scope = pointer-selected current **revision** (§4.23, ADR 0006 §2.8/§2.11). History is always queryable.
- **Invariant:** `MenuSnapshot` never contains user preferences, order drafts, or user-specific pricing. It is shared evidence.
- **Invariant:** A draft (private) snapshot is retained while its session is live or an active `OrderDraft` references it; otherwise it follows session retention (ADR 0006 §2.2).

### 4.7 `MenuItem` (restaurant-specific)

- `id`, `snapshotId`, `originalName` (verbatim from menu — preserved), `translatedName` (locale map), `description` (verbatim or extracted; `null` if absent — never invented), `category`, `variantLabel` (nullable validated string, e.g. `sườn nướng`, from menu evidence, never invented; `null` = no variant stated — ADR 0002), `price` (nullable `Money` — integer minor units, see §7 Q2; missing price stays `null`), `currencyCode`, `sizeVariants` / `options` (see `MenuItemOption`), `dishId` (nullable mapping to canonical `Dish`), `mappingConfidence`, `ingredients[]` (optional, evidence-backed `IngredientValue`s from the menu — ADR 0004; absent = no menu-level evidence, fall back to Dish-level typical with uncertainty), `allergenStatuses[]` (optional, evidence-backed `AllergenStatus` values from the menu — ADR 0004; take precedence for this serving when present), `uncertainties` (array: e.g., `price_unclear`, `ingredients_unknown`, `cross_contact_unknown`), `sortOrder`, `pageIndex?` (nullable — which photo/page of the capture session this item was extracted from; ADR 0006 §2.5).
- **Invariant:** `originalName` is never overwritten by translation or normalization. Display always shows original alongside translation.
- **Invariant:** Price `null` ≠ price 0. Missing price is displayed as unknown.

### 4.8 `MenuItemOption` (structured value, JSONB inside `MenuItem`)

- `id` (stable within item), `kind` (`size | single_choice | multiple_choice | note`), `label` (original), `translatedLabel`, `choices[]` (`label`, `priceDelta` nullable, `available` flag), `required`, `maxSelections`, `constraints` (validated).
- **Invariant:** Only options present in the menu evidence may be offered. AI must not invent modifiers. Free-text special requests are separate (see `OrderDraft`) and marked unconfirmed.
- Rendered via the control registry — see `menu-rendering.md` §3. No executable code in options.

### 4.9 `PriceObservation`

Evidence, not fact. Two distinct evidence kinds:

| Kind | Meaning | Strength |
|---|---|---|
| `listed` | Price printed on a menu / menu snapshot item | Advertised; may be stale, may exclude tax/service |
| `receipt_paid` | Price actually paid on a receipt | Stronger for "what it costs"; must account for tax, discount, combo, portion |

Fields: `id`, `kind`, `dishId` (nullable), `menuItemId` (nullable), `restaurantId`, `amountMinor` (integer minor units, Postgres `BIGINT` — see §7 Q2 / `typescript.md` Money boundary; never float, never `numeric`), `currencyCode`, `observedAt`, `source` (`menu_snapshot | receipt | manual | contribution`), `sourceRef` (snapshot/receipt/contribution id), `portion` / `variant` (if known), `confidence`, `status` (`pending | published | rejected`), `createdBy` (private).

**Invariants:**

- Listed and receipt-paid observations are never averaged together silently. Aggregations group by kind and disclose the mix.
- **Manual ≠ receipt (ADR 0003).** A manually entered price
  (`source: manual`, typed numbers, no backing image) is never a
  receipt-backed observation (`source: receipt`, receipt photo with
  legible line items). Manual observations carry a capped
  confidence and, if published, are labeled "reported price,
  unverified". Manual and receipt-backed observations are never
  aggregated or displayed equivalently — moderation, aggregation,
  and UI must keep the `source` boundary visible.
- Price stats (median, p25/p75, min/max) are computed deterministically from observations, never by LLM. Display always includes observation count, area, date range, and kind mix. Insufficient evidence → "insufficient evidence", never a fabricated average.
- Receipt images are private by default (see `data-provenance.md` §5). A receipt-derived observation publishes the *amount*, not the receipt image or PII.

### 4.10 `UserPreference` (user-private) — hybrid document, ADR 0005

One row per user. Identity stays relational; preference *content*
is a validated document:

- `userId` — PK, FK → Better Auth `user.id` (`NOT NULL`).
  Guest rows are anonymous-plugin users (`isAnonymous: true`),
  claimed on sign-in (see §7 Q4, `auth.md` §6, ADR 0005 §3).
- `preferences` — JSONB, validated by Effect Schema
  `UserPreferenceDoc` (`packages/contracts`): `preferredLanguage`,
  `originCountryRegion` (optional), `ageRange` (optional,
  nullable), `dietaryRestrictions[]`, `allergies[]` (references
  `AllergenCode`, ADR 0004), `religiousRequirements[]` (only if
  explicitly provided), `spiceTolerance`, `typicalBudget`
  (`Money`, nullable), `adventurousness`,
  `preferredIngredients[]`, `preferredTextures[]`,
  `dislikedIngredients[]`, `tasteAnchors` (see §4.11 — one
  ordered discriminated `TasteAnchor[]` collection, max 5
  total).
- `schemaVersion` — document **format** version, not edit
  history. Older documents are upgraded by tested migration
  functions; unknown future versions are rejected on read with
  the stored row left untouched (ADR 0005 §1.5).
- `revision` — optimistic-concurrency counter (starts at 1, +1
  per successful write). Writes carry the expected `revision`;
  a mismatch fails with a typed conflict error and writes
  nothing. `revision` is not history — no prior revisions are
  kept.
- `createdAt`, `updatedAt`.
- **Invariants:** All nonessential fields skippable/editable.
  Origin/region is a *suggestion signal*, never a determinant of
  taste/religion/diet. Explicit preferences outrank demographic
  inference — always. Preferences are never published as part of
  shared menu data. Reads/writes restricted to the owning user
  (server-side identity must equal `userId`); the MVP admin
  studio has no read path for preferences. Allergies / dietary /
  religious information never appears in contributions,
  telemetry, or logs. Account deletion removes the row (and
  that account's `PreferenceConflict` rows — §4.20);
  contributions survive per ADR 0003.

### 4.11 `tasteAnchors` — NOT a `FavoriteDish` table (ADR 0005)

- `preferences.tasteAnchors`: one ordered, validated
  discriminated collection, **maximum 5 entries total**,
  duplicates rejected, order preserved as the user arranged
  it:

```ts
TasteAnchor =
  | { kind: TasteAnchorKind.Dish, dishId: DishId }
  | { kind: TasteAnchorKind.Unmatched, label: string }
```

  `TasteAnchorKind` is a string-valued TS enum (`dish`,
  `unmatched`) — see `typescript.md`, "String enums for domain
  vocabularies". Onboarding taste references — a similarity
  signal for recommendations (grilled → grilled, etc.), not a
  filter that excludes everything else, and not a general
  bookmark list.
- Onboarding: select up to 5 (dish + unmatched combined).
  Searchable beyond initial suggestions. Free-text labels
  that match no canonical dish are stored as `unmatched`
  entries — similarity explanation only, never presented as a
  canonical dish.
- Duplicates rejected: same `dishId` twice, or same label
  twice (after trim + casefold). A dish entry and an unmatched
  entry with the same text are not duplicates.
- Writes validate that every `dish` entry references a
  canonical `Dish` (exists, not merged-away — a merged-away
  id is rejected and the client resolves it via the redirect,
  §4.2). `unmatched` labels are non-empty strings (max 200
  chars). Only `dish` entries are verified catalog references.
- AI may suggest resolutions (unmatched label → canonical
  dish); conversion happens only on explicit user
  confirmation — replace in place (position preserved), then
  re-validate; if that dish is already present, drop the
  converted entry instead of duplicating.
- Future arbitrary bookmarking is modeled separately if needed;
  it is never a reinterpretation of `tasteAnchors`.
- Promotion to a join table requires a new ADR (triggers:
  independent favorite management, relational integrity,
  cross-user analytics, sophisticated personalization —
  ADR 0005 §6).

### 4.12 `MediaAsset`

- `id` (stable resource ID), `kind` (`food_image | restaurant_image | icon | banner | graphic | menu_photo | receipt | review_photo` — `review_photo` reserved, unused until Review ships), `storageKey`, `bucket` (`public | private`), `mimeType`, `byteSize`, `width/height`, `altText` (locale map), `aliases[]`, `status` (`draft | published | archived`), `createdBy`, `createdAt`.
- Bytes in object storage; metadata + mappings in Postgres. Changing an image = new object + metadata update + cache invalidation; old IDs remain resolvable where referenced.
- Menu photos / receipts are `private` by default. Public display assets are `public`.

### 4.13 `Contribution`

State machine wrapping any user-submitted data (menu scan, correction, price report, photo — `review` joins as a subject type only when Review ships; Review is deferred, see §4.14).

**Subjects (ADR 0006):** `menu_scan` → `MenuSnapshot` (candidate,
`pending_review`, created from the session extraction at submit).
`correction` → `MenuSnapshot` (candidate materialized at submit
from the current revision + change list — §4.6) **plus**
`targetRevisionId` (the revision being corrected). `price_report`
→ `PriceObservation`.

- `id`, `ownerUserId` (private, **nullable FK, `ON DELETE SET NULL`,
  never `CASCADE`** — ADR 0003), `attribution` (immutable snapshot,
  validated JSONB: `originalUserId` as a value, not an FK,
  `isAnonymousAtSubmission`, `displayLabel`, `submittedAt` — never
  rewritten by a link event; **internal-only**: no public API
  response or published page may contain a user id, email, or raw
  internal identifier — public surfaces expose only the
  `displayLabel`), `subjectType` (`menu_scan | correction | price_report | photo` in the MVP; `review` joins only when Review ships — deferred, §4.14), `subjectRefs` (explicit FKs), `status`: `draft → submitted → pending_review → published | rejected | needs_more_info`, `moderationNotes` (private), `reviewedBy`, `reviewedAt`, `createdAt`.
- **Transitions:** only forward through moderation; `published` is terminal for that version (a correction creates a new contribution + new snapshot, not a mutation). Rejection records a reason; user can resubmit as a new contribution.
- **Invariant:** Publishing a contribution never publishes the contributor's profile, preferences, or order history.
- **Anonymous submissions (ADR 0003):** menu scans, corrections,
  and price reports may be submitted by anonymous guests (Better
  Auth anonymous-plugin users, `isAnonymous: true`). They enter
  `pending_review` and are never auto-published; the MVP keeps
  manual publication approval. Reviews and persistent contributor
  profiles require Google sign-in. Scan and submit are separate
  actions — submitting needs an explicit confirmation before
  extracted data is shared for moderation. (Scanning itself is NOT
  local-only: images are processed privately server-side — see
  `data-provenance.md` §5.2.) Deleting a user (link, prune,
  account deletion) never deletes contributions: the owner FK
  becomes `NULL` and the attribution snapshot preserves original
  provenance.

### 4.14 `Review` — DEFERRED from the MVP (future independent entity)

**Do not build the `Review` table during the initial scan-to-order
MVP.** Review is deferred — but it is **not** a value object. It
must never be stored as a JSONB array on `Dish` or `Restaurant`,
and no placeholder ratings or review statistics may be introduced
without actual supporting data (no average ratings, no review
counts, no stars from empty data).

When Review ships, it is an independent entity because it has its
own author, target, timestamps, moderation state, and lifecycle.
Reserved future shape (not implemented in the MVP):

- `id`, `subjectType` (`dish | restaurant`), `subjectId`, `userId` (private), `rating` (nullable — reviews without ratings allowed), `text` (nullable), `photos[]` (MediaAsset refs), `status` (`pending | published | rejected | removed`), `createdAt`, `helpfulness` (derived, not stored as fact).
- Reviews are opinions, not evidence for ingredients/prices. Never use review text as the sole source for a dietary or price claim.
- Reviews require Google sign-in when implemented (ADR 0003).
  Corrections, menu scans, and price reports stay under the
  `Contribution` workflow — they are not reviews and must not be
  confused with them.

### 4.15 `MenuTemplate` / `MenuTemplateVersion`

- `MenuTemplate`: `id`, `name`, `description`, `status`.
- `MenuTemplateVersion`: `templateId`, `version`, `layoutId`, `supportedControls[]`, `displayRules`, `validationRules`, `orderingRules`, `localeSettings`, `visualConfig`, `status` (`draft | published | deprecated`), `publishedAt`, `createdBy`. Payload = validated JSONB. Published versions immutable.
- New executable component = code change, not a template change. Templates only *select and configure* known components (see `menu-rendering.md`).

### 4.16 `MenuPresentation` (derived)

- **Not a primary table.** Built by: `buildPresentation(menuSource, templateVersion) → validated MenuPresentation`, where `menuSource = PublishedMenuRevision | MenuSnapshot` (ADR 0006). Carries `menuRef` (revision id *or* snapshot id) + `sourceKind`, `coverage`, `coverageNote?`, `observedAt?`, `publishedAt?` for UI display.
- May be cached with shared key `(publishedRevisionId, templateVersion, locale)` or private key `(snapshotId, templateVersion, locale)`; cache invalidated on new published revision or new template publish. Corroboration does **not** invalidate (same revision id). Rebuilding is pure + deterministic — same inputs always yield the same presentation.
- The presentation embeds user-independent item-level evidence (cacheable); the per-user dietary warning is a separate overlay computed from `UserPreference` + presentation evidence, never stored in the shared cached presentation (ADR 0006 §2.10).
- Never edited directly. Edits go to the snapshot (new snapshot) / revision (new revision) or the template (new version), then rebuild.

### 4.17 `OrderDraft` (user-private)

- `id`, `userId`, `menuRef` (pinned — the draft references an immutable published revision *or* the customer's private extraction result, never floats):

```ts
OrderDraft.menuRef =
  | { kind: OrderDraftMenuRefKind.PublishedRevision, revisionId: PublishedMenuRevisionId }
  | { kind: OrderDraftMenuRefKind.PrivateSnapshot, snapshotId: MenuSnapshotId }
```

  `lines[]` (each: `menuItemId`, `selectedOptions[]` (option + choice ids), `quantity`, `specialRequest` (free text, marked unconfirmed), `lineTotal` (deterministic)), `estimatedTotal` (deterministic sum; `null` if any line price unknown), `dietaryWarnings[]` (computed deterministically from known ingredients + uncertainty flags), `status` (`draft | confirmed_for_display | abandoned`), `createdAt`, `updatedAt`.
- **Invariants:** Draft is private to the user. It never merges into shared content. Free-text requests are visually distinguished from confirmed options. Estimated total is clearly labeled estimated. The bilingual view is generated from the draft + pinned source originals — never from LLM recollection. **Never silently rebase:** when a newer revision publishes while a draft is open, the UI offers an explicit, confirmed refresh (re-pin + line re-validation, diff shown first — ADR 0006 §2.9). A draft pinning a private snapshot keeps that snapshot retained until the draft is abandoned / deleted / expires.

### 4.18 `PromptDefinition` / `PromptVersion`

- `PromptDefinition`: `id`, `task` (`intent_extraction | menu_extraction | translation | dish_matching | explanation | receipt_extraction`), `description`.
- `PromptVersion`: `definitionId`, `version`, `model` (or model family), `parameters` (temperature, max tokens, etc. — validated), `promptTemplate` (with named variables), `inputSchemaRef`, `outputSchemaRef` (Effect Schema ids), `status` (`draft | published | deprecated`), `publishedAt`. Payload validated JSONB. Published versions immutable.
- Published prompts never bypass validated output contracts.

### 4.19 `AIExecution` (append-only)

- `id`, `task`, `promptVersionId` (nullable), `modelId`, `startedAt`, `latencyMs`, `tokensIn/out` (if available), `estimatedCost` (if available), `inputRefs` (snapshot/contribution ids — no raw PII), `validationErrors[]`, `status` (`success | validation_failed | provider_error | retry_then_success`), `outputRef`.
- **Invariant:** No sensitive PII in logs. No raw user profile, no receipt image bytes, no full prompt with user data — only references + metadata + validation outcomes.

### 4.20 `PreferenceConflict` (private) — ADR 0005 §3

Minimal conflict store owned by the authenticated account.
The incoming guest document is persisted here **before any
destructive account-linking step**, so the retained copy
survives anonymous-account deletion.

- `id`, `accountUserId` (FK → `user.id`, owner, `NOT NULL`),
  `guestUserId` (value, not FK — anon may be deleted; audit
  only), `incomingPreferences` (validated JSONB
  `UserPreferenceDoc`), `incomingSchemaVersion`,
  `incomingRevision`, `detectedAt`, `status`
  (`pending | resolved`), `resolution`
  (`keep_account | keep_guest | discarded_expired | NULL`),
  `resolvedAt` (nullable).
- **Invariants:** private to the owning account (no admin read
  path in MVP, never logged, never public). Resolution is
  atomic (single transaction — ADR 0005 §3). Unresolved rows
  are retained 90 days from detection (default proposal,
  confirm in M0), then deleted with the deletion recorded;
  expiry never touches the account's active preferences.
  Account deletion removes the account's conflict rows.
  Multiple pending conflicts allowed as separate rows, each
  resolving independently.

### 4.21 `MenuCaptureSession` (private) — ADR 0006 §2.1

One private scanning session. No account or contribution
required; guest sessions are keyed by an ephemeral
`sessionToken`, not a user id (ADR 0003: scanning never mints
an anonymous identity).

- `id`, `sessionToken` (unguessable; guest access),
  `ownerUserId` (nullable; set when the scanner is signed in
  or an anonymous identity is minted), `restaurantId`
  (nullable until identified), `scope` (`MenuScope`, default
  `main`), `status` (`active | submitted | expired`),
  `photos` (ordered `[{ mediaAssetId, pageIndex }]`,
  validated JSONB), `extraction` (validated `MenuExtraction`
  JSONB, nullable until complete), `extractionStatus`
  (`pending | complete | failed`), `extractionConfidence`
  (overall + per-item, nullable), `coverage`
  (`MenuCoverage`, default `unknown`), `coverageNote?`,
  `createdAt`, `updatedAt`, `expiresAt` (retention).
- **Invariants:** one session produces at most one snapshot
  (MVP). Re-photographing a page creates new evidence, never
  a mutation. Session + unsubmitted photos are deleted after
  the retention window (default 24h, ADR 0003) with the
  deletion recorded; a confirmed snapshot referenced by a
  draft survives per §4.6.

### 4.22 `PublishedMenuRevision` (the reusable public menu) — ADR 0006 §2.3

The approved, reusable restaurant menu for (restaurant,
scope). Publication is a distinct act, not a property of an
observation.

- `id`, `restaurantId` (`NOT NULL`), `scope` (`MenuScope`),
  `revisionNumber` (monotonic per restaurant + scope),
  `sourceSnapshotIds` (`SnapshotId[]`, ≥ 1, ordered; MVP:
  exactly 1), `coverage` (`MenuCoverage`), `coverageNote?`,
  `status` (`published | superseded`),
  `supersedesRevisionId` (nullable), `publishedAt`,
  `publishedBy` (moderator id, private), `createdAt`.
- **Invariants:** `published` = in the published set,
  eligible to be current — **not** necessarily the currently
  selected revision. `superseded` = withdrawn from the
  published set. Publishing a new revision does **not**
  supersede the old one; it moves the pointer (§4.23).
  `supersedesRevisionId` is lineage only. `resolveCurrentMenu(restaurantId,
  scope)` returns the pointer-selected revision, or none
  (no pointer row = no current menu, even if published
  revisions exist). Public surfaces use revisions only.
  Display shows observation date (source snapshot
  `observedMenuAt` / `capturedAt`) + verification date
  (`publishedAt`) + coverage — never a guarantee of live
  restaurant availability. Any revision (current,
  non-current `published`, or `superseded`) stays renderable
  for pinned order drafts.

### 4.23 `CurrentMenuRevision` (pointer) — ADR 0006 §2.11

Explicit current-revision pointer per (restaurant, scope).

- `restaurantId`, `scope` (composite PK), `revisionId`
  (FK → `PublishedMenuRevision`), `updatedAt`, `updatedBy`
  (moderator id, private).
- **Invariants:** publish = create revision + move pointer,
  one transaction, audited. Rollback = move pointer to an
  older `published` revision, one transaction, audited — no
  new revision, no status changes. Withdraw = status →
  `superseded`, one transaction, audited; if the withdrawn
  revision was current, the pointer moves in the same
  transaction. Pointer updates serialize via the pointer row
  per (restaurant, scope) — concurrent publishes both create
  revisions; the later-committing pointer move wins; nothing
  is overwritten. No pointer row = no current menu.

## 5. The four distinctions that matter most

### 5.1 Dish vs MenuItem

| | `Dish` | `MenuItem` |
|---|---|---|
| Identity | Canonical food | What one restaurant sells |
| Example | Cơm tấm (canonical) | "Cơm Tấm Sườn Nướng 65K" at Quán X |
| Price | Derived aggregate, never stored as fact | Listed price on that menu (or null) |
| Multiplicity | One per food | Many per dish, across restaurants and snapshots |

A restaurant may sell multiple variants of one dish → multiple `MenuItem`s mapping to one `Dish`, distinguished by `MenuItem.variantLabel`. Never create a new `Dish` per menu-item spelling, and never create a `DishVariant` row (ADR 0002).

### 5.2 Observation vs Publication vs Current Menu (ADR 0006)

- `MenuCaptureSession` = private scanning. `MenuSnapshot` =
  observation at a time (possibly partial). Append-only,
  immutable once stored. `PublishedMenuRevision` = the
  approved, reusable public menu.
- "Current menu" = pointer-selected current **revision**
  for a (restaurant, scope) (`CurrentMenuRevision` §4.23),
  resolved via `resolveCurrentMenu(restaurantId, scope)`.
  It is *not* the latest snapshot, nor the latest published
  revision by number — pending contributions never silently
  change public content.
- A new scan creates a new snapshot; normalized comparison
  (`diffMenus`, ADR 0006 §2.6) against the current revision's
  content detects equivalence (→ corroboration, no new
  revision) or meaningful changes (→ moderation). Changes are
  surfaced to moderators and, where useful, to users ("menu
  may have changed").
- Public surfaces (discovery, dish pages, price context) use
  published revisions only. Approved-but-unpublished snapshots
  are evidence, not public content.

### 5.3 PriceObservation: listed vs receipt-paid

See §4.9. Different sources, different strength, never silently merged. Receipt parsing must consider taxes, discounts, combos, portions — a receipt total is not automatically a per-dish price.

### 5.4 Original vs Translated

- Original wording is canonical and immutable (`canonicalName`, `originalName`, `original modifier`).
- Translations are a separate, locale-keyed layer. They never overwrite originals.
- The bilingual order view shows **both**: customer language + original local names/modifiers. Staff see originals; customer sees their language.

### 5.5 Template vs Presentation vs Order

- `MenuTemplate` = available presentation patterns (config).
- `MenuPresentation` = template + one snapshot, validated, derived.
- `OrderDraft` = one user's selections against one presentation/snapshot. Private.
- Renderer = code that maps presentation nodes → known React components. See `menu-rendering.md`.

### 5.6 User-specific vs Shared

| Shared (public, moderated) | User-private (never shared) |
|---|---|
| Dish, Restaurant, MenuSnapshot (published), PriceObservation (published, de-identified) | UserPreference (incl. `tasteAnchors`), PreferenceConflict, OrderDraft |
| MediaAsset (public kind) | Receipt images, draft scans, order history |
| Prompt/Template versions (published) | AIExecution input payloads with PII |

### 5.7 Evidence vs Verified Fact

| Level | Meaning | UI treatment |
|---|---|---|
| `verified` | Human-curated / restaurant-confirmed / moderator-published | Shown plainly |
| `observed` | Extracted from menu/receipt with provenance + confidence | Shown with source + date |
| `common` | Common recipe knowledge (e.g., "Cơm tấm typically contains fish sauce") | Shown as "commonly contains", not as a fact about *this* restaurant |
| `unknown` | No evidence | Shown as unknown / "ask staff" — never hidden, never defaulted to safe |

AI-extracted information carries confidence + provenance. LLM-generated description is **never** sufficient evidence for ingredients, prices, or availability.

## 6. Key invariants (checklist for reviewers)

1. Snapshots are append-only; corrections = new snapshots + new revisions (ADR 0006).
2. Prices are integer minor units (`amountMinor`, `BIGINT`) + currency + timestamp; `null` ≠ 0. Never float, never `numeric`.
3. Listed vs receipt-paid observations are distinct kinds.
4. Price stats are deterministic (median/percentiles), never LLM-computed.
5. Original text is never overwritten by translation.
6. MenuItem → Dish mapping is nullable; unmapped stays unmapped.
7. OrderDraft references a pinned `menuRef` (published revision *or* private snapshot); never floats.
8. OrderDraft / UserPreference never enter shared content.
9. Options offered = options in evidence. No invented modifiers.
10. Dietary safety: absence of mention ≠ safe. Evidence levels (`known / common / confirmed / unknown`) are always distinguished.
11. Published prompt/template versions are immutable.
12. AIExecution logs contain no PII.
13. Contributions go through the state machine; publishing never leaks private data.
14. Every shared fact carries provenance (source, time, confidence, status) or is explicitly `unknown`.
15. No `DishVariant` table in the MVP; variations live on `MenuItem.variantLabel` (ADR 0002).

## 7. Open questions

1. **ID strategy** — UUID vs human-readable slug for Dish/Restaurant: decide once in M0; slugs help SEO but need uniqueness + rename policy.
2. **Money representation** — RESOLVED 2026-10-16: integer minor units end to end (Postgres `BIGINT amount_minor` + currency, Effect Schema `Money`, JSON `{ amountMinor, currency }`, integer-only frontend arithmetic). See `docs/development/typescript.md` § Money boundary. No `numeric`, no float, no `BigInt` on the wire.
3. **DishVariant threshold** — RESOLVED 2026-10-17 (ADR 0002,
   Option A): no `DishVariant` table in the MVP, no threshold to
   decide. Variations are `MenuItem.variantLabel`; discovery groups
   by canonical `Dish`. Promotion to a table later requires a new ADR
   + migration from observed labels.
4. **Auth model for UserPreference/OrderDraft** — RESOLVED 2026-10-16
   (ADR 0001), amended 2026-10-17 (ADR 0003, ADR 0005): Better
   Auth owns identity (`user` / `session` / `account` /
   `verification` tables). Guests are anonymous-plugin users
   (real rows, `isAnonymous: true`), so `UserPreference` /
   `OrderDraft` FK to `user.id` with `NOT NULL` owners; sign-in
   claims guest rows via `onLinkAccount`. Guest preferences stay
   client-side until explicitly saved; an explicit guest save may
   mint an anonymous identity + persist the document; Google
   sign-in enables cross-device persistence. **Claim conflict
   (ADR 0005 §3):** if the target account has no preferences,
   transfer the guest document; if both have preferences,
   preserve the account document, persist the incoming guest
   document first into `PreferenceConflict` (§4.20), and
   resolve lazily in settings — never silently overwrite.
   Exception (ADR 0003): `Contribution.ownerUserId` is
   **nullable** (`ON DELETE SET NULL`, never `CASCADE`) + an
   immutable attribution snapshot, so contributions survive
   anonymous-user deletion on linking/prune with original
   provenance intact. See `docs/auth.md` §6.
5. **Moderation capacity** — who reviews contributions in the demo? Define a minimal moderation path in M2 (at least: approve/reject + reason).
