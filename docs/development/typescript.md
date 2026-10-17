# TypeScript — Conventions

> Applies to the whole monorepo: `apps/*`, `packages/*`, scripts.
> TypeScript **5.9+**, `strict: true`. Shared base config in
> `packages/config/tsconfig.base.json`; each package extends it, never
> weakens it.

## Strictness

- `strict: true` everywhere. No exceptions per package without an ADR.
- **No `any`.** Use `unknown` + Schema decoding, or a precise type.
  `any` in a diff is a review failure (test fixtures excepted only with
  a comment explaining why).
- **`exactOptionalPropertyTypes: true` — adopt it.** It makes
  `field?: string` mean "absent," not "absent or `undefined`," which
  matches how our JSON / DB / Schema boundaries actually behave and
  catches a whole class of "present-but-undefined" bugs at API and
  persistence edges. If a dependency's types fight it, isolate the
  friction in one adapter module and record it — do not disable the
  flag globally.
- `noUncheckedIndexedAccess: true` — index access returns `T | undefined`;
  handle it instead of assuming presence.
- No `@ts-ignore` / `@ts-expect-error` without a comment naming the
  upstream issue. Prefer fixing the type.
- Prefer `readonly` for data that flows across boundaries (snapshots,
  presentations, contract payloads). Mutability is local and explicit.
- Prefer `type` for unions / intersections, `interface` for object shapes
  that may be extended. Either is fine if consistent within a file.

## Branded IDs

Never pass bare `string` ids around — they are trivially confusable
(`restaurantId` passed where `menuId` was expected compiles fine).

```ts
// packages/contracts — branded id pattern (Effect Schema)
export const RestaurantId = Schema.String.pipe(Schema.brand("RestaurantId"))
export type RestaurantId = typeof RestaurantId.Type
// … MenuSnapshotId, MenuItemId, DishId, ContributionId, OrderDraftId, …
```

- Every entity id is a branded `Schema.String` (UUID or ULID — pick one
  in M0 and record it; do not mix).
- Foreign keys use the branded type of the entity they reference.
- Never construct an id by casting: use the Schema constructor /
  `Schema.decodeSync` at the boundary where the id enters the system.

## Money — integer minor units, never float

- **Money = `{ amountMinor: number (integer), currency: CurrencyCode }`.**
  `amountMinor` is an integer in the currency's minor unit
  (e.g. 85000 VND — VND has 0 decimal places, so minor == major;
  1099 USD cents = $10.99). Never `number` dollars, never `float`.
- **Currency is always present.** A price without a currency code is a
  bug. `CurrencyCode` is a validated `Schema.Literal` union
  (`"VND"`, `"USD"`, …) — extend by adding a literal, never a free string.
- **Arithmetic:** integer arithmetic only. Totals = sum of minor units.
  Averages / medians / percentiles for *display* are computed in minor
  units and rounded once, explicitly, at the display edge (round-half-up,
  documented). Never accumulate float intermediates.
- **Parsing:** menu/receipt prices parse to minor units at the extraction
  boundary (currency-aware: VND `"85.000"` / `"85,000"` / `"85k"` are
  85000; `"85.000"` USD would be 85 dollars — the parser must know the
  currency before interpreting separators). Ambiguous parses are
  `unknown`, never guessed.
- **Validation:** `amountMinor` must be a non-negative integer
  (`Schema.Int` + `>= 0`). Negative prices, `NaN`, `Infinity` are
  rejected by the schema.

### Money boundary (review amendment 2026-10-16 — locked)

One representation end to end. No per-layer reinterpretation, no
`numeric(19,4)`, no float, no string-with-separators past the parser.

| Layer | Representation | Rules |
|---|---|---|
| PostgreSQL (Drizzle) | `BIGINT amount_minor` + `currency_code TEXT` (validated against the literal union; CHECK constraint) | Never `numeric` / `float` / `double`. Never store major units. The driver must return a JS `number` (not a string); decode through the Effect Schema at the DB boundary so a stringly value fails loudly instead of silently concatenating. |
| Effect Schema (`packages/contracts`) | `Money = { amountMinor: Schema.Int, currency: CurrencyCode }` with `amountMinor >= 0` | Single source of truth. Each currency declares its `minorUnitExponent` in one table in contracts (VND = 0, USD = 2, JPY = 0). The exponent is metadata for formatting/parsing only — it never changes the stored integer. |
| JSON wire (API, AI output, presentation) | `{ "amountMinor": 85000, "currency": "VND" }` | Plain JSON integer. No `BigInt` on the wire (not JSON-serializable). No `85.000`, no `"85,000₫"`. `null` means unknown price, never 0. |
| Frontend arithmetic | Integer arithmetic only (`+`, `*` by quantity, integer `min`/`max`) | Totals = sum of minor units. Never `price * 1.1`, never `toFixed` math. Display formatting only at the render edge: `Intl.NumberFormat(locale, { style: "currency", currency })` from the integer + exponent. Display rounding (median/percentile) happens once, explicitly, round-half-up. |
| AI extraction | Model outputs the same `{ amountMinor, currency }` shape, validated locally | The extraction prompt tells the model the target currency's exponent and requires integer minor units. A decimal / float / string price fails validation → retry once → `unknown`. |

**Why this is not over-complex for VND:** VND has exponent 0, so
minor == major and `85000` is just `85000`. There are no cents, no
rounding, and no `BigInt` anywhere — every real menu price is far
below `Number.MAX_SAFE_INTEGER` (2^53). The integer rule exists to
stop the classic bugs (float totals like `0.1 + 0.2`, `"85.000"` parsed
as 85, totals built from formatted strings), not to add a currency
library. Do not introduce a money library, `Decimal`, or `numeric`
column "just in case" — the contract above is the whole system.

## Time

- **Timestamps are `timestamptz` in PostgreSQL, ISO-8601 UTC strings on
  the wire.** Store UTC; render in the user's / restaurant's timezone
  at the display edge only.
- Never store local-time strings without an offset. Never rely on the
  DB session timezone.
- `observedAt` (when the menu/receipt was observed) is distinct from
  `createdAt` (when the row was written) and `extractedAt` (when AI ran).
  All three exist on snapshots/contributions; do not conflate them.
- Durations use explicit units (`timeoutMs`, `latencyMs`) — never a bare
  `timeout: number`.

## Schema ownership — one source of truth

- **Effect Schema owns every data contract.** API requests/responses,
  AI task inputs/outputs, menu extraction schema, presentation schema,
  order representation, registry payloads — all defined once in
  `packages/contracts`, imported everywhere.
- **No duplicate schemas.** Do not hand-write a Zod schema, a JSON
  Schema file, a Drizzle-only validation, or a form-only shape that
  mirrors a contract. If a second representation is unavoidable
  (e.g. a library that only accepts Zod), derive it mechanically from
  the Effect Schema definition and delete the hand copy.
- **Standard Schema interop:** Effect Schema implements Standard Schema,
  so TanStack Form, TanStack Query validators, and other Standard-Schema
  consumers use the contract Schema directly. If a consumer needs a
  different flavor, adapt at the consumer edge — never fork the schema.
- **JSON Schema conversion:** generate from Effect Schema when an
  external tool needs JSON Schema (e.g. structured-output declarations
  for an AI provider). Generated artifacts are build outputs, not
  hand-maintained sources.
- **Schema changes are versioned decisions.** Changing a published
  contract shape requires: updating `packages/contracts`, updating
  consumers, adding/adjusting tests, and (if wire-compatible behavior
  changes) a `docs/decisions/` note. Never widen a schema to `unknown`
  to make a consumer compile.

## String enums for domain vocabularies

Domain discriminators, statuses, and fixed sets of values are
**string-valued TypeScript enums** — defined once, in
`packages/contracts`, as the authoritative definition. Effect
Schema validates them at runtime. Never scatter inline string
literal unions for domain vocabulary through the codebase, and
never duplicate a vocabulary across schemas — import the enum.

**Why string enums, not inline unions and not numeric enums:**

- One definition: adding a member (e.g. a new `AllergenCode`)
  happens in exactly one place; every schema, query, and UI
  that imports it follows.
- String values are readable and stable in JSON, API responses,
  DB rows, and logs. Numeric enums renumber silently and are
  opaque on the wire — never use them for domain values.
- Runtime validation stays with Effect Schema: the TS enum is
  the definition, the Schema is the validator. Neither is
  hand-duplicated.

**Pattern:**

```ts
// packages/contracts — TasteAnchorKind (ADR 0005)
export enum TasteAnchorKind {
  Dish = "dish",
  Unmatched = "unmatched",
}

// Discriminator: Schema.Literal of the enum members
export const TasteAnchor = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal(TasteAnchorKind.Dish),
    dishId: DishId,
  }),
  Schema.Struct({
    kind: Schema.Literal(TasteAnchorKind.Unmatched),
    label: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  }),
)

// Plain value set: Schema.Enums of the enum
export const ContributionStatusSchema = Schema.Enums(ContributionStatus)
```

**Storage / wire:**

- JSON: the string value (`"dish"`, `"pending_review"`).
- PostgreSQL: store the string value (`TEXT` + `CHECK` against
  the enum members, or Drizzle `pgEnum` — decide once in M0;
  either way the TS enum is authoritative and the DB mirrors it).
- Never store a numeric enum index. Never accept an unvalidated
  string into a domain field — decode through the Schema at the
  boundary.

**Seed vocabulary (defined here; the enum in contracts is
authoritative, this table is the index):**

| Enum | Members | Source |
|---|---|---|
| `TasteAnchorKind` | `dish`, `unmatched` | ADR 0005 §1.2 |
| `ContributionStatus` | `draft`, `submitted`, `pending_review`, `published`, `rejected`, `needs_more_info` | domain-model §4.13 |
| `MenuSnapshotStatus` | `draft`, `pending_review`, `published`, `rejected`, `superseded` | domain-model §4.6 |
| `PriceObservationKind` | `listed`, `receipt_paid` | domain-model §5.3 ("listed vs receipt-paid"). Distinct from `PriceObservation.source` (`menu_snapshot` \| `receipt` \| `manual` \| `contribution`) — kind is the evidence kind, source is where it came from. Do not conflate them. |
| `AllergenCode` | `peanut`, `tree_nut`, `shellfish`, `fish`, `egg`, `dairy`, `gluten`, `soy`, `sesame`, … (open set — extend by adding a member) | ADR 0004 (its "centralized Effect Schema enum" is this string-valued TS enum) |
| Allergen status values | `present`, `possibly_present`, `confirmed_absent`, `unknown` | ADR 0004. **Naming note:** ADR 0004 currently uses `AllergenStatus` for the `{ allergen, status, evidence }` record. At BUILD, disambiguate with one mechanical rename (record → `AllergenStatusEntry`, or value enum → `AllergenPresence`). Do not keep two meanings for one name. |
| `OrderDraftStatus` | `draft`, `confirmed_for_display`, `abandoned` | domain-model §4.17 |
| `PreferenceConflictStatus` / `PreferenceConflictResolution` | `pending`, `resolved` / `keep_account`, `keep_guest`, `discarded_expired` | ADR 0005 §3 |
| `CurrencyCode` | `VND`, `USD`, … | Money section above. **Supersedes:** the Money section's "validated `Schema.Literal` union" description — `CurrencyCode` becomes a string enum under this convention. |
| `MenuCaptureSessionStatus` | `active`, `submitted`, `expired` | ADR 0006 §2.1 |
| `MenuSnapshotStatus` | `draft`, `pending_review`, `approved`, `rejected` | ADR 0006 §2.2. **Breaking change:** loses `published` + `superseded` — publication belongs to `PublishedMenuRevision`. |
| `PublishedMenuRevisionStatus` | `published`, `superseded` | ADR 0006 §2.3. `published` = in the published set (may or may not be current — currentness is the `CurrentMenuRevision` pointer); `superseded` = withdrawn from the published set. Publishing a newer revision does NOT supersede the old one. |
| `MenuCoverage` | `unknown`, `partial`, `reported_complete` | ADR 0006 §2.4. `reported_complete` is a contributor assertion, not verification. |
| `MenuScope` | `main` (MVP value; extensible) | ADR 0006 §2.5. Current-menu key is (restaurant, scope). |
| `OrderDraftMenuRefKind` | `published_revision`, `private_snapshot` | ADR 0006 §2.9. Discriminator for `OrderDraft.menuRef` / `MenuPresentation.menuRef`. |
| `MenuSnapshotSource` | `session_scan`, `correction`, `manual` | ADR 0006 §2.2. Replaces old `scan \| contribution \| manual`. |

**Rules for new vocabulary:** any new domain status,
discriminator, or fixed value set follows this convention —
string-valued TS enum in `packages/contracts`, validated by
Effect Schema, added to the table above when introduced.
Existing planning docs write these values as inline unions
(e.g. status (`draft | published | …`)) — read those as
references to the enums above; at BUILD they are mechanically
converted to enum references in contracts, with no change in
meaning.

**Supersedes:** the "Enums: prefer `Schema.Literal` unions over
TS `enum`" bullet in "Naming and structure" below — that
guidance is retired for domain vocabularies. Ad-hoc local
unions that are *not* domain vocabulary (a one-off local
flag) may still use `Schema.Literal`; anything stored,
crossing a boundary, or reused is an enum.

## Naming and structure

- Files: `kebab-case.ts`. Types: `PascalCase`. Functions/vars:
  `camelCase`. Constants: `SCREAMING_SNAKE_CASE`. No default exports
  except framework-required entry points.
- One concept per file where the concept is a contract or domain entity;
  small helpers may share a `utils.ts` only within their own module —
  no global `utils/` dumping ground.
- Errors: `<Domain><Problem>` tagged errors (`MenuNotFound`,
  `ExtractionValidationFailed`) — see `docs/development/effect.md`.
- Enums: domain discriminators, statuses, and fixed value sets
  are string-valued TS enums — see "String enums for domain
  vocabularies" above. That section supersedes the old
  prefer-Literal-unions guidance for domain vocabulary.
- Unknown vs. missing: use `null` for "known to be absent/unknown"
  (e.g. a menu item with no listed price: `price: null`) and omit the
  key for "not applicable." With `exactOptionalPropertyTypes`, these
  are distinct — keep them distinct in the domain too.

## Nullability, options, and results

- Functions that can fail return `Effect<T, E>` (backend) or a typed
  `Result`-style value — never throw, never return `null` to signal an
  error.
- Optional values are `T | null` in schemas (explicit) or absent keys
  (with `exactOptionalPropertyTypes`). Avoid `T | undefined` in stored
  or wire data.
- Collections: empty array, never `null`, for "no items."

## What not to do

- No `any`, no `@ts-ignore` without justification, no `as` casts to
  silence Schema decoding, no float money, no naive local datetimes,
  no second schema system, no stringly-typed ids, no `Date` objects
  crossing a JSON boundary (ISO strings only).
