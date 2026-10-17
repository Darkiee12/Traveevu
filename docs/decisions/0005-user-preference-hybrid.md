# ADR 0005 — `UserPreference` hybrid: one validated JSONB document + `tasteAnchors` + `PreferenceConflict`

- **Status:** Accepted 2026-10-17 (refined 2026-10-17 — see
  "Refinements" below; the refinement supersedes the v1 shape:
  `tasteAnchors` discriminated union replaces the two-array
  shape, and conflicts persist in a `PreferenceConflict` table
  instead of relying on the anonymous user surviving linking)
- **Amends:** ADR 0001 (save/claim semantics — see §7)
- **Resolves:** the last README ↔ domain-model contradiction (user-profile shape).
  README said `UserPreference` is a single versioned JSONB profile document
  per user with `FavoriteDish` as a preference value on the profile;
  domain-model made `UserPreference` a table with scalar columns and
  `FavoriteDish` a join table. This ADR locks the hybrid below.
- **Related:** ADR 0003 (contributions survive account deletion;
  attribution snapshot), ADR 0004 (validated values, not tables, where
  a join buys nothing in the MVP).

## 1. Decision

### 1.1 `UserPreference`: one table, one validated document per user

```text
UserPreference
  userId        PK, FK → Better Auth user.id (NOT NULL)
  preferences   JSONB, validated by Effect Schema (never raw)
  schemaVersion INTEGER (document format — see §5)
  revision      INTEGER (optimistic concurrency — see §1.4)
  createdAt, updatedAt
```

- Identity stays relational: ownership, claim, and deletion are
  single-row operations keyed by `userId`. Only the preference
  *content* is a document.
- `UserPreferenceDoc` is an Effect Schema contract in
  `packages/contracts` (single source of truth). Postgres cannot
  enforce Effect Schema natively, so validation happens at the app
  boundary: decode on read, encode on write, reject invalid.
- Document fields (all nonessential fields skippable/editable):
  `preferredLanguage`, `originCountryRegion` (optional),
  `ageRange` (optional, nullable), `dietaryRestrictions[]`,
  `allergies[]` (references `AllergenCode`, ADR 0004),
  `religiousRequirements[]` (only if explicitly provided),
  `spiceTolerance`, `typicalBudget` (`Money`, nullable),
  `adventurousness`, `preferredIngredients[]`,
  `preferredTextures[]`, `dislikedIngredients[]`,
  `tasteAnchors` (see §1.2 — one ordered, validated
  discriminated collection, max 5 total).
- **Invariants (unchanged):** origin/region is a *suggestion signal*,
  never a determinant of taste/religion/diet. Explicit preferences
  outrank demographic inference — always. Preferences are never
  published as part of shared menu data.

### 1.2 Taste anchors, not favorites: one `tasteAnchors` collection

- **No `FavoriteDish` table in the MVP.** The field is
  `preferences.tasteAnchors`: **one** ordered, validated
  discriminated collection, **maximum 5 entries total**, order
  preserved as the user arranged it, duplicates rejected. It
  represents the onboarding taste references used as a
  similarity signal for recommendations — not a general
  bookmark list, and not a filter that excludes everything else.
- The rename from `favoriteDishIds` is deliberate: "favorites"
  invites unbounded bookmarking semantics (per-item timestamps,
  notes, moderation, removal flows). Taste anchors are bounded
  (≤ 5), onboarding-scoped, and replaced wholesale on edit.
- **Shape** (discriminator is the string-enum
  `TasteAnchorKind` — see `typescript.md`, "String enums for
  domain vocabularies"):

```ts
TasteAnchor =
  | { kind: TasteAnchorKind.Dish, dishId: DishId }
  | { kind: TasteAnchorKind.Unmatched, label: string }
```

- **Free-text food preferences are supported** via the
  `unmatched` variant: when a canonical dish cannot be found,
  the user-typed label is stored as an unmatched entry — used
  for similarity explanation only, never presented as a
  canonical dish, and never smuggled in as a fake id.
- **Duplicates rejected.** Two entries with `kind: dish` and
  the same `dishId` are duplicates; two entries with `kind:
  unmatched` and the same label (compared after trim +
  casefold) are duplicates. A dish entry and an unmatched entry
  with the same text are **not** duplicates (the label is
  unverified text).
- **Only `dish` entries are verified catalog references.**
  Unmatched entries carry no catalog guarantee.
- **AI may suggest resolutions, never silently convert.** AI
  may propose mapping an unmatched label → a canonical dish
  (with confidence). Conversion happens only on explicit user
  confirmation: the unmatched entry is replaced in place by
  the dish entry (position preserved), then the whole
  collection is re-validated — if that dish is already
  present, the converted entry is dropped instead of
  duplicating.
- **Future arbitrary bookmarking is modeled separately if needed.**
  If a bookmark feature ships, it is a new entity/table — never a
  reinterpretation of `tasteAnchors`.

### 1.3 Guests: client-side until explicitly saved

- Temporary guest preferences stay client-side until the user
  explicitly saves them.
- An explicit guest save **may** create a Better Auth anonymous
  identity (lazy-minted at save, not on page view) and persist the
  document as an anonymous-owned `UserPreference` row.
- Google sign-in enables cross-device persistence (claim, §3).

### 1.4 Writes: validate + optimistic concurrency

- Every write validates the full document against
  `UserPreferenceDoc`, including the `tasteAnchors` collection:
  max 5 entries total, duplicates rejected (§1.2), `dish`
  entries reference canonical `Dish` rows (exist, and are not
  merged-away — see §4; a merged-away id is rejected and the
  client resolves it via the redirect), `unmatched` labels are
  non-empty strings (max 200 chars), and `Money` shape for
  budget.
- `revision` is a separate optimistic-concurrency counter
  (starts at 1, +1 per successful write). A write carries the
  expected `revision`; a mismatch fails with a typed conflict
  error and writes nothing. The client re-reads and retries.
  `revision` is **not** history — no prior revisions are kept.

### 1.5 Reads: migrate old, reject unknown future

- If stored `schemaVersion` < current: run a tested migration
  function (pure, covered by tests) to upgrade the document.
- If stored `schemaVersion` > current (unknown future version):
  reject the read with a typed error and **leave the stored row
  untouched** — never auto-migrate forward, never wipe, never
  destroy data to satisfy a reader.

## 2. Why hybrid (and what we give up)

- **Kept relational:** ownership (`userId`), claim (one-row
  re-parent), deletion (one-row delete). These are the operations
  where integrity matters, and they stay single-row and atomic.
- **Kept document:** preference content has no per-field query,
  join, or integrity requirement in the MVP. A document avoids a
  normalized preference graph (many small columns + a join table)
  for data that is always read/written as one unit: the current
  user's own profile.
- **Given up:** cross-user queries over preference content
  ("users who anchored dish X", "most-anchored dishes",
  collaborative "people who liked X also liked Y") become JSONB
  scans/aggregations instead of trivial SQL joins. Acceptable:
  MVP personalization is per-user only (read one doc, rank by
  that user's prefs). Cross-user analytics is an explicit
  promotion trigger (§6).

## 3. Account linking: transfer, or retain both — never silent overwrite

The automatic guest-wins policy is **rejected**. Silently
overwriting saved allergies, dietary restrictions, or other
preferences is a safety and trust failure.

- **Target Google account has no preferences** → transfer the
  guest document: re-parent the guest `UserPreference` row to
  the real account (`UPDATE userId`) in one idempotent
  transaction, together with the rest of the claim
  (`OrderDraft`, draft/pending `Contribution`s — ADR 0001/0003).
- **Both have preferences** → preserve the existing account
  document as the active one, and **retain the incoming guest
  document in a minimal `PreferenceConflict` table owned by the
  authenticated account** until the user explicitly chooses
  which to keep:

```text
PreferenceConflict
  id                     PK
  accountUserId          FK → user.id (owner, NOT NULL)
  guestUserId            VALUE, not FK (anon may be deleted; audit only)
  incomingPreferences    JSONB (validated UserPreferenceDoc)
  incomingSchemaVersion  INTEGER
  incomingRevision       INTEGER (preserved so keep_guest restores concurrency state)
  detectedAt
  status                 pending | resolved (string enum — see typescript.md)
  resolution             keep_account | keep_guest | discarded_expired | NULL
  resolvedAt             nullable
```

  - **Persist-first.** The incoming document is durably
    persisted in `PreferenceConflict` **before any
    destructive account-linking step** (anonymous-user
    deletion, re-parenting). The retained copy therefore
    survives anonymous-account deletion: the anonymous user
    may be deleted after link; the conflict row owns the copy.
    The exact hook/order that guarantees persist-before-delete
    is verified in the M0 PoC — do **not** assume a particular
    hook (e.g. `onLinkAccount`) runs before deletion or is
    even available (§8). If the verified lifecycle cannot
    guarantee persist-before-delete inside the link callback,
    capture the snapshot at **sign-in initiation** (before
    redirect to Google) as a pending conflict row instead.
    If sign-in is then abandoned, the pending row is covered
    by the retention policy below.
  - Resolution is **lazy and non-blocking**: surfaced in
    settings/profile ("You have preferences saved on this device
    that differ from your account — keep which?"), never as a
    blocking modal in the ordering flow. Ordering continues
    against the active account document.
  - **Resolution is atomic** (single transaction):
    - `keep_guest`: the account `UserPreference` row's
      `preferences` / `schemaVersion` / `revision` are replaced
      with the incoming copy, and the conflict is marked
      `resolved(keep_guest)`.
    - `keep_account`: the conflict is marked
      `resolved(keep_account)` and the incoming document is
      deleted from the conflict row (metadata kept). The
      account document is untouched.
    - Either way there is no silent overwrite in either
      direction, and a half-applied resolution is impossible.
  - **Retention / deletion (explicit policy).** Unresolved
    conflicts are retained **90 days from detection**
    (default proposal, confirm in M0), then the conflict row is
    deleted and the deletion recorded; the account's active
    preferences are never touched by expiry. The user may
    discard the retained copy at any time (counts as a
    `keep_account` resolution). Multiple pending conflicts
    (repeated sign-ins from different guest sessions) are
    allowed as separate rows; each resolves independently;
    settings lists them newest-first.
  - **Privacy:** the conflict row contains preference content
    (potentially allergies/dietary data) — it is private to the
    owning account, never exposed publicly, never logged. The
    MVP admin studio has no read path for it.
- Claim remains idempotent: re-running it after a completed
  transfer/conflict-recording is a no-op.

## 4. Canonical dish merges

- A canonical dish merge **preserves redirects**: the merged-away
  `DishId` resolves to the canonical `DishId` (e.g.
  `Dish.mergedIntoDishId`, or a redirect record — decided at
  implementation, not here). Redirects are permanent; old ids
  never silently disappear.
- The merge operation **must** normalize affected taste-anchor
  references as a mandatory step: in every `UserPreference`
  document, map each `dish`-kind `tasteAnchors` entry through
  the redirects (`unmatched` entries are untouched), deduplicate
  the whole collection preserving first-occurrence order, and
  keep the ≤ 5 cap (dedup can only shrink the list). The same
  normalization applies to incoming documents stored in
  `PreferenceConflict` rows.
- Writes validate canonical ids (§1.4). Stored documents that
  still contain pre-merge ids are resolved via redirects during
  migration (§1.5) — there is no FK to do this automatically,
  so the merge procedure's normalization step is a checklist
  item, not an afterthought.

## 5. Versioning and privacy

- `schemaVersion` describes **document format, not edit
  history**. There is no audit trail of preference changes and
  no undo from stored revisions. If audit/compliance ever needs
  history, that is a separate append-only log, added later.
- Tested schema migrations for older documents (§1.5).
  Unknown future versions are rejected without destroying the
  stored data (§1.5).
- **Access:** preference reads/writes are restricted to the
  owning user (server-side: request identity must equal
  `userId`). The MVP admin studio has **no read path** for user
  preferences.
- **No leakage:** allergies / dietary / religious information
  must never appear in public contributions, telemetry, or logs.
  In particular: `AIExecution` logs must not include preference
  content, and recommendation explanations must not leak
  allergy lists. (Publishing a contribution publishes menu/price
  evidence only — ADR 0003.)
- **Deletion:** account deletion removes the `UserPreference`
  row **and** that account's `PreferenceConflict` rows
  (including any retained incoming documents). Contributions
  are preserved according to ADR 0003 (attribution snapshot
  survives; owner FK becomes `NULL`). Deleting preferences
  never deletes contributions.

## 6. Promotion triggers (when to normalize)

Do not introduce a fully normalized preference model until one of
these is real:

- independent favorite/bookmark management (per-item timestamps,
  notes, moderation, removal flows);
- relational integrity demanded for taste anchors (FK enforcement);
- cross-user analytics (aggregation over anchors/preferences);
- more sophisticated personalization (collaborative or
  cross-user recommendation queries).

Promotion = new ADR + migration (e.g. extract
`tasteAnchors` into a join table, re-pointing via
redirects). Arbitrary bookmarking, if it ships, is a separate
model (§1.2) — it does not retroactively justify normalizing
taste anchors.

## 7. Amendments to ADR 0001 (recorded here, applied to `auth.md`)

- **Save no longer strictly requires sign-in.** ADR 0001 §6.2
  said "Save preferences / favorites / order history — Google
  sign-in". Refined: a guest's explicit save persists a
  `UserPreference` row owned by their anonymous identity;
  Google sign-in enables cross-device persistence and claim.
  (Order history and persistent contributor profiles keep their
  existing sign-in rules.)
- **Claim gains the conflict branch** (§3): transfer when the
  target has no preferences; when both exist, persist the
  incoming document first into `PreferenceConflict` (owned by
  the account), retain both + lazy atomic resolution.
  Guest-wins is explicitly rejected.

## 8. Open verification item (M0 PoC — before implementation)

**Verify the exact Better Auth account-linking lifecycle before
implementation — do not assume a particular hook is available
or runs in a particular order.** The persist-first design in
§3 requires a point in the flow where the incoming guest
document can be durably persisted *before* any step that can
delete the anonymous identity or its rows. The M0 PoC must
verify against the installed Better Auth version:

- the exact sequence of the link flow (which callbacks run,
  in which order, and whether any runs before the anonymous
  user is deleted);
- whether a persist-before-delete step is achievable inside
  the link callback, or whether the snapshot must instead be
  captured at sign-in initiation (before redirect to Google);
- `onLinkAccount` throw semantics (link abort? partial
  re-parent? anon user survives?);
- idempotency of a re-run claim;
- confirmation of the 90-day unresolved-conflict retention
  default (§3).

Do not build the claim path until this is verified. If no
ordering guarantees persist-before-delete, the sign-in-initiation
capture fallback in §3 applies — the §3 semantics (retain both,
no silent overwrite, lazy atomic resolution) do not change.
