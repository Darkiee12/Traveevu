# ADR 0006 — Menu identity: capture sessions, immutable observations, published revisions

- **Status:** Accepted 2026-10-17 (clarified 2026-10-17 —
  snapshot-immutability scope + explicit transactional
  current-revision pointer; see §2.2, §2.3, §2.8, §2.11)
- **Amends:** the "latest published `MenuSnapshot` = current menu"
  rule (domain-model §4.6 invariant, §5.2; data-provenance §3;
  menu-rendering §9 reuse rule). Under this ADR, snapshots are
  never published; `PublishedMenuRevision`s are.
- **Related:** ADR 0003 (contribution / moderation / corrections),
  ADR 0005 (string-enum convention), `menu-rendering.md`,
  `data-provenance.md`.

## 1. Context — what was wrong with the old model

The old model conflated three different things into one entity:

- **private scanning** (a traveler photographing a menu for
  themselves — no account, no contribution, temp data);
- **observation** (what was captured: items, prices, evidence,
  uncertainty — immutable, possibly partial);
- **publication** (what the public sees as "the menu" —
  approved, reusable, versioned).

Because `MenuSnapshot` played all three roles, the rules broke
the moment two scans existed: a second scan of the same menu
had to become a "new published version" (version churn for an
unchanged menu), an approved-but-not-new scan had nowhere to
live (no "corroboration" state), and "current menu" was a
derived query ("latest published snapshot") with no stable
identity to pin drafts or cache keys to. Corrections
"superseded" snapshots in a chain, mixing the correction's
evidence with the publication act.

## 2. Decision — three separate concerns

### 2.1 `MenuCaptureSession`: one private scanning session

One private scanning session with N ordered photos and a
combined AI extraction. No account or contribution is required.
Temporary data follows the agreed retention policy (ADR 0003:
unsubmitted scan data deleted after the retention window,
default 24h, deletion recorded). Per-image/page evidence and
extraction uncertainty are preserved.

```text
MenuCaptureSession
  id, sessionToken (unguessable; guest access — see §2.5),
  ownerUserId (nullable; set when the scanner is signed in or an
    anonymous identity is minted),
  restaurantId (nullable until identified),
  scope (MenuScope, default main),
  status (active | submitted | expired),
  photos: [{ mediaAssetId, pageIndex }] (ordered, validated JSONB),
  extraction (validated MenuExtraction JSONB, nullable until complete),
  extractionStatus (pending | complete | failed),
  extractionConfidence (overall + per-item, nullable),
  coverage (MenuCoverage, default unknown), coverageNote?,
  createdAt, updatedAt, expiresAt (retention)
```

- One session produces **at most one** snapshot (MVP
  cardinality). A session that is abandoned produces zero.
- Re-photographing one page creates **new evidence** (a new
  photo in a new or continued session) — never a mutation of
  the original observation.

### 2.2 `MenuSnapshot`: an immutable observation, possibly partial

An immutable observation of captured menu content — **not
necessarily an entire restaurant menu**. It may be partial.
Explicit contribution + moderation are required before it can
inform the public menu.

```text
MenuSnapshot
  id, restaurantId (nullable until identified),
  scope (MenuScope, default main),
  snapshotVersion (monotonic per restaurant; assigned once
    restaurantId is known),
  sessionId (nullable; null for correction-materialized / manual),
  source (session_scan | correction | manual),
  imageRefs: MediaAssetId[] (ordered; from the session for scans),
  extraction (validated JSONB: items, categories, prices, options,
    uncertainties),
  extractionConfidence (overall + per-item),
  coverage (MenuCoverage), coverageNote?,
  provenance: { baseSnapshotIds: SnapshotId[],
    correctionContributionId?: ContributionId }
    (empty base for scans; set for materialized corrections),
  status (draft | pending_review | approved | rejected),
  corroboratesRevisionId (nullable; set when approved as
    corroboration — see §2.6),
  capturedAt, observedMenuAt (nullable),
  createdBy (user id, private, nullable for guest-token sessions;
    guest snapshots link via sessionId), createdAt
```

- **Status change (breaking):** `MenuSnapshotStatus` is now
  `draft | pending_review | approved | rejected`. Snapshots
  are never `published` and never `superseded` — publication
  belongs to revisions (§2.3). `supersedesId` is dropped; its
  job moves to revision supersession + snapshot provenance.
- **Immutability, precisely (clarified 2026-10-17):** the
  **observation/evidence payload is immutable** — `extraction`,
  `imageRefs`, `provenance`, `capturedAt` / `observedMenuAt`,
  `sessionId`, `source`, `snapshotVersion`. It is never
  rewritten, including by corrections: a correction creates a
  **new evidence-bearing snapshot** (§5) rather than rewriting
  the original extraction. **Workflow fields may change
  through audited, authorized transitions only:** `status`
  (`draft → pending_review → approved | rejected`),
  `corroboratesRevisionId` (set at approval-as-corroboration),
  `restaurantId` (set-once when identified),
  `coverage` / `coverageNote` (moderator-correctable during
  review, audited). Every workflow transition is recorded
  (who, when, from what, to what, reason) in the audit trail.
- **Draft snapshots are private.** Confirming an extraction
  for ordering materializes a private snapshot (`status:
  draft`). It is retained while its session is live **or** an
  active `OrderDraft` references it; otherwise it follows
  session retention (deleted with the session).
- **Submitted snapshots are evidence.** On submit, the same
  snapshot transitions `draft → pending_review` (not a new
  row) and becomes the contribution's subject.

### 2.3 `PublishedMenuRevision`: the approved, reusable menu

The approved, reusable restaurant menu — potentially
assembled from multiple snapshots. It preserves source
provenance for each item and price (via its source snapshots).
**For MVP, a revision references exactly one approved
snapshot; sophisticated multi-source merging is deferred.**
The schema already supports N snapshots (`sourceSnapshotIds`
array), so no migration is needed when assembly ships — only
the assembly logic is deferred.

```text
PublishedMenuRevision
  id, restaurantId (NOT NULL), scope (MenuScope),
  revisionNumber (monotonic per restaurant + scope),
  sourceSnapshotIds: SnapshotId[] (≥ 1, ordered; MVP: exactly 1),
  coverage (MenuCoverage), coverageNote?,
  status (published | superseded — see below),
  supersedesRevisionId (nullable — lineage only, NOT currentness),
  publishedAt, publishedBy (moderator id, private), createdAt
```

- **Publication is a distinct act** (moderator decision +
  timestamp), not a property of an observation. A revision
  gives public content a stable identity for draft pins and
  cache keys even as its source snapshot set grows.
- **Status semantics (clarified 2026-10-17):** `published` =
  in the published set, eligible to be current. It does **not**
  mean "currently selected" — a published revision is not
  necessarily the currently selected revision (§2.11).
  `superseded` = **withdrawn** from the published set (e.g.
  found incorrect / fraudulent) — no longer eligible to be
  current. Publishing a newer revision does **not** supersede
  the old one; it only moves the pointer. `supersedesRevisionId`
  records lineage (which revision this one was created as
  successor of), never currentness.
- **Public surfaces use revisions only.** Discovery, dish
  pages, and price context derive from `PublishedMenuRevision`
  content. Approved-but-unpublished snapshots are evidence,
  not public content.

### 2.4 Completeness: unknown / partial / reported-complete

Completeness is explicit — never inferred:

```ts
enum MenuCoverage { Unknown = "unknown", Partial = "partial",
  ReportedComplete = "reported_complete" }
```

- `unknown` (default): coverage not stated. `partial`:
  known-incomplete (e.g. "drinks section only", "pages 1–2
  photographed"). `reported_complete`: the contributor
  **asserts** this is the full menu for the scope — an
  assertion, not verification. A moderator may downgrade it
  to `partial`.
- **Never infer missing pages or sections.** The builder never
  invents sections to "complete" a partial menu.
- **Show coverage limitations to customers.** The UI shows
  coverage + coverage note + observation/verification dates
  alongside any published menu. A partial menu is labeled
  partial; it is never presented as whole.

### 2.5 Multiple photos, sessions, and guest ownership (ADR 0003 tension, resolved)

- One session holds N ordered photos; the combined extraction
  preserves page-level references (`MenuItem.pageIndex`,
  per-item confidence) and per-photo evidence.
- **Guest sessions are token-based, not user-based.** ADR 0003
  says scanning never mints an anonymous identity — so a
  guest session is keyed by an ephemeral `sessionToken`
  (unguessable, client-held), with `ownerUserId` null. On
  submit, an anonymous identity is minted **only if needed**
  (persistent guest ownership of the contribution), and the
  snapshot/contribution are owned by it. This preserves
  "scanning requires no account" while keeping the ownership
  story intact.
- **Scope** (`MenuScope`, string enum, MVP value `main`,
  extensible to `food` / `drinks` / `lunch` / …) is recorded
  on session, snapshot, and revision (default `main`,
  editable at confirm/moderation). The current-menu key is
  (restaurant, scope).

### 2.6 Duplicate scans: equivalence strengthens, never auto-publishes

- **Semantic equivalence** is decided by a normalized,
  deterministic comparison (`diffMenus`): item names
  normalized (trim / casefold / diacritic-insensitive /
  punctuation- and whitespace-collapsed), prices in minor
  units + currency, options sorted by (label, priceDelta),
  categories normalized. Equivalence = same multiset of
  (normalized name, price, options, portion/variant context).
- **Unchanged scans strengthen evidence, never auto-increment
  the published revision.** An approved snapshot that is
  semantically equivalent to the current published revision
  is recorded as corroboration
  (`corroboratesRevisionId` = current revision id). No new
  revision, no cache invalidation (the revision id is
  unchanged), no public change.
- **Meaningful changes require validation.** A scan that
  differs (added/removed item, price change, option change)
  goes through moderation like any other submission. Item
  reorder, whitespace/case/diacritic-only differences, and
  confidence-only differences are **not** meaningful changes.
- **Image similarity is deferred.** For MVP, semantic
  comparison decides equivalence. Image similarity (e.g.
  pHash) may supplement later; it is never decisive alone.

### 2.7 Conflict resolution: never blind newest-wins

- **Comparable observations** = same (restaurant, scope,
  item identity: normalized name + portion + variant +
  options context). A different price for a comparable item
  is a **conflict**; a price for a different portion/variant
  is a distinct observation, not a conflict.
- **Portion, variant, and context are preserved** in every
  comparison — a 500ml price never "conflicts with" a 330ml
  price.
- **Conflicting comparable observations require moderation
  before replacing published information.** In MVP this is
  structural, not procedural: there is **no auto-publish
  path** — every publication is a moderator decision — so a
  conflict can never silently replace published info. The
  moderator sees the deterministic diff (old → new) and
  chooses: publish a new revision from the candidate snapshot,
  or reject / request more info.

### 2.8 Current menu: pointer-selected revision, with dates — not a guarantee

- **Resolution:** `resolveCurrentMenu(restaurantId, scope)`
  → the revision selected by the `CurrentMenuRevision`
  pointer for (restaurant, scope) (§2.11). **Not** "the
  latest published revision by number" — currentness is an
  explicit pointer, not a derived max. If no pointer row
  exists → no current menu ("No verified menu yet" + offer
  to scan), even if published revisions exist.
- **Pending contributions never silently change public
  content.** Until a revision publishes, the public menu is
  exactly the current revision.
- **Display:** observation date (source snapshot
  `observedMenuAt` / `capturedAt`) + verification date
  (revision `publishedAt`) + coverage. **Never a guarantee
  of live restaurant availability** — the UI says when the
  menu was observed/verified, never "this is what they serve
  right now".

### 2.9 Order drafts: pin, never silently rebase

```ts
OrderDraft.menuRef =
  | { kind: OrderDraftMenuRefKind.PublishedRevision,
      revisionId: PublishedMenuRevisionId }
  | { kind: OrderDraftMenuRefKind.PrivateSnapshot,
      snapshotId: MenuSnapshotId }
```

- A draft pins an **immutable published revision** or the
  customer's **private extraction result** (draft snapshot).
  It never floats.
- **Never silently rebase.** When a newer revision publishes
  while a draft is open, the UI offers an **explicit refresh**
  ("Menu updated — review changes", diff: added / removed /
  price-changed items and options). Refresh is a confirmed
  user action that re-pins the draft to the new revision and
  re-validates lines (changed/removed items and options
  flagged); the user sees the diff before confirming.
- `MenuItem.id` is globally unique; revision items retain
  their source snapshot item ids, so draft lines reference
  item ids directly regardless of pin kind.
- A draft pinning a private snapshot keeps that snapshot
  retained until the draft is abandoned / deleted / expires
  (§2.2).

### 2.10 Caching: revision-keyed shared presentations, per-user annotation overlay

- **Shared cache key:** `(publishedRevisionId,
  templateVersion, locale)`. The restaurant id drops out
  (the revision implies restaurant + scope).
- **Private cache key:** `(snapshotId, templateVersion,
  locale)` for presentations built from a private snapshot.
- **Corroboration does not invalidate** (same revision id).
  A new published revision or a new template version
  creates a new key.
- **Rollback reuses the old key.** A rollback moves the
  pointer back to a previously-current revision, whose
  presentation may still be cached under its revision id —
  no rebuild required.
- **Dietary annotations are an overlay, not cached content.**
  The shared presentation embeds **user-independent**
  item-level evidence (e.g. "contains peanuts — known")
  which is cacheable and identical for all users. The
  **user-specific** warning ("matches *your* allergy") is
  computed separately per user from `UserPreference` +
  presentation evidence (client-side or a per-user layer)
  and is never stored in the shared cached presentation.
  This refines the old "builder resolves dietary warnings"
  line: the builder resolves *evidence*; the per-user
  warning is an overlay.

### 2.11 Current-revision pointer: explicit, transactional (clarified 2026-10-17)

Currentness is an explicit pointer, not a derived max:

```text
CurrentMenuRevision
  restaurantId, scope (composite PK),
  revisionId (FK → PublishedMenuRevision),
  updatedAt, updatedBy (moderator id, private)
```

- **Publish = create revision + move pointer, one
  transaction, audited.** The revision is `published` and
  current at birth.
- **Rollback = move pointer to an older `published`
  revision, one transaction, audited.** No new revision, no
  status changes. The previously-current revision stays
  `published` (in the set, still selectable) — it is not
  superseded by the rollback.
- **Withdraw = set a revision's status → `superseded`, one
  transaction, audited.** If the withdrawn revision was
  current, the pointer must move in the same transaction
  (to another `published` revision, or to none).
- **Concurrency:** pointer updates are serialized via the
  pointer row (row lock / atomic conditional update) per
  (restaurant, scope). Two concurrent publishes both create
  revisions; pointer moves serialize; the later-committing
  move wins the pointer. Nothing is overwritten — the other
  revision remains `published` and selectable via rollback.
- **Historical revisions remain accessible to pinned order
  drafts.** Drafts pin `revisionId` directly, so any revision
  — current, non-current `published`, or `superseded` —
  stays renderable. If a pinned revision was withdrawn, the
  refresh offer surfaces that plus the current pointer
  target.
- **Corroboration** references the pointer target at review
  time (`corroboratesRevisionId`) — historical linkage, not
  currentness.

## 3. Minimum schema changes

| Change | Detail |
|---|---|
| **NEW** `MenuCaptureSession` | §2.1. Private scanning state. |
| **NEW** `PublishedMenuRevision` | §2.3. Public menu identity. Status `published` = in the published set (may or may not be current); `superseded` = withdrawn. |
| **NEW** `CurrentMenuRevision` | §2.11. Explicit current-revision pointer per (restaurant, scope). One small table; the concurrency + rollback story depends on it. |
| `MenuSnapshot.status` | `draft \| pending_review \| approved \| rejected` (drop `published`, `superseded`). |
| `MenuSnapshot.source` | `session_scan \| correction \| manual` (drop `contribution`). |
| `MenuSnapshot` fields | Add `sessionId?`, `imageRefs[]` (ordered, replaces single `imageRef`), `coverage` + `coverageNote?`, `scope`, `provenance { baseSnapshotIds[], correctionContributionId? }`, `corroboratesRevisionId?`. Drop `supersedesId`. `snapshotVersion` assigned once `restaurantId` is known. `createdBy` nullable (guest-token sessions link via `sessionId`). |
| `MenuItem` fields | Add `pageIndex?` (which photo/page the item was extracted from). |
| `OrderDraft` pin | `snapshotId + snapshotVersion` → `menuRef` discriminated union (§2.9). |
| `Contribution` subjects | `menu_scan` → `MenuSnapshot` (candidate, `pending_review`). `correction` → `MenuSnapshot` (candidate materialized at submit — §4) + `targetRevisionId`. `price_report` → `PriceObservation` (unchanged). |
| `MenuPresentation` | `snapshotId, snapshotVersion` → `menuRef` + `sourceKind`; add `coverage`, `coverageNote?`, `observedAt?`, `publishedAt?`. Builder: `buildPresentation(menuSource, templateVersion)` where `menuSource = PublishedMenuRevision \| MenuSnapshot`. |
| `BilingualOrderView` | `snapshotId, snapshotVersion` → `menuRef`. |

## 4. Lifecycles / state transitions

```text
MenuCaptureSession:
  active → submitted (user taps Share; snapshot → pending_review)
  active → expired (retention window elapsed; session + unsubmitted
    photos deleted, deletion recorded; a confirmed snapshot
    referenced by a draft survives per §2.2)
  (extraction: pending → complete | failed, inside active)

MenuSnapshot:
  draft (private) → pending_review (submitted)
  pending_review → approved (accepted evidence) | rejected
    | pending_review (needs_more_info → resubmission)
  approved → referenced by a new PublishedMenuRevision
    | corroborating (corroboratesRevisionId set, no new revision)

Contribution (menu_scan / correction):
  draft → submitted → pending_review → published | rejected
    | needs_more_info
  menu_scan / correction is "published" ⇔ its snapshot is
    approved AND (a new revision references it OR it is
    recorded as corroboration).

PublishedMenuRevision:
  published → superseded (withdrawn from the published set,
    e.g. found incorrect / fraudulent; if it was current, the
    pointer moves in the same transaction)
  Publishing a newer revision does NOT supersede the old one —
    it only moves the pointer.

CurrentMenuRevision (pointer):
  (no row) → pointer to revision (publish, one transaction)
  pointer → pointer to older published revision (rollback,
    one transaction, audited; no new revision, no status change)
  pointer moves in the same transaction as a withdrawal if the
    withdrawn revision was current

OrderDraft:
  draft → confirmed_for_display | abandoned
  refresh: explicit, confirmed re-pin to a newer revision +
    line re-validation (never silent)
```

## 5. Corrections under the new model (replaces snapshot-chain corrections)

- A correction is a `Contribution(type: correction)` carrying
  a field-level change list (`field, oldValue, newValue,
  reason, actor, at`) **against the current published
  revision** (`targetRevisionId`). A correction requires a
  published menu to correct — without one, the flow is a new
  scan.
- On **submit**, the system materializes a **candidate
  snapshot**: a copy of the current revision's content with
  the validated change list applied **deterministically**
  (no AI, no assembly logic), `source: correction`,
  `provenance: { baseSnapshotIds: <current revision's
  sources>, correctionContributionId }`, `status:
  pending_review`. The change list + base snapshots +
  correction contribution are all retained — original
  evidence is never destroyed.
- On **approval**, a new `PublishedMenuRevision`
  references the candidate snapshot. On rejection, the
  candidate snapshot is `rejected` (history preserved).
- Per-field provenance (`ai_extracted → user_confirmed →
  restaurant_confirmed`) and the allergen-correction
  moderator gate are unchanged (ADR 0003 / review amendment).

## 6. What changes — the "latest published snapshot" rule, and where

| Location | Old rule | New rule (ADR 0006) |
|---|---|---|
| domain-model §4.6, §5.2 | "Current menu = latest `published` snapshot" | Current menu = **pointer-selected** current **revision** for (restaurant, scope) (§2.8, §2.11) |
| domain-model §4.16, §4.17 | Presentation from snapshot; draft pins snapshot | Presentation from revision *or* private snapshot; draft pins `menuRef` |
| data-provenance §3, §6.2, §7 | Snapshot versioning / "published snapshot" / correction → new snapshot version | Observation vs publication split; publication = revision; corrections materialize a candidate snapshot + new revision |
| menu-rendering §1, §5, §7.1, §7.3, §8, §9, §10 | Builder from snapshot; cache key `(restaurant, snapshotVersion, template, locale)`; draft pins snapshot; reuse = latest published snapshot | Builder from revision-or-snapshot; cache keys §2.10; draft pins `menuRef`; reuse = current published revision; dietary warnings = evidence (shared) + per-user overlay |
| architecture.md | Cache key `(restaurantId, snapshotVersion, templateVersion)` | Cache keys §2.10 |
| user-journeys Journey 4/5 | Scan → snapshot; contribute → published snapshot; reuse snapshot | Scan → session → private snapshot; contribute → snapshot → revision; reuse = current revision |
| admin-design §4.4 | Review + correct + publish a menu (snapshot) | Review candidate snapshot → **publish new revision** *or* **approve as corroboration**; reject / needs-more-info |
| roadmap M2/M4, README | "Published snapshot reusable" | "Published revision reusable" |
| ADR 0003 §2 | Correction "against a published snapshot" | Correction "against the current published revision" |

## 7. Deferred (explicitly not in this ADR)

- **Multi-source merging / assembly:** revisions referencing
  >1 snapshot, assembling a menu from partials, cross-snapshot
  conflict merging. Schema supports it; logic ships later.
- **Image-similarity duplicate detection:** semantic
  comparison decides in MVP (§2.6).
- **Auto-publish / auto-rebase:** no auto-publish path, no
  silent draft rebase — ever (structural, §2.7/§2.9).
- **Offline cached menus:** unchanged (deferred, per
  menu-rendering §12).

## 8. Challenge notes (why the split is worth a table)

- **"Is a near-1:1 revision table overengineering?"** No —
  because the failure mode it removes is real: without it,
  "approved but not new" (corroboration) has no representation,
  publication has no stable identity for pins/cache keys, and
  the first multi-snapshot menu forces a redesign. The MVP
  revision is thin (one snapshot, provenance, coverage,
  timestamps) — the cost is one table + one resolution step,
  and the shape already supports the deferred assembly.
- **"Why not fold the session into a draft snapshot?"**
  Because a session may produce zero snapshots (abandoned),
  holds photos + extraction state + retention semantics that
  are not observations, and keeps guest scanning token-based
  (ADR 0003) instead of forcing identity at scan time.
- **"Does discovery get slower?"** Public reads resolve one
  revision, then its source snapshot(s) — one extra lookup
  vs the old model, against the same indexes. Acceptable.

## 9. Open items (M0/M2 — not this decision)

- Session-token generation / storage (unguessable token,
  client-held; server lookup by token hash).
- Confirm the 24h unsubmitted-retention default in M0
  (carried over from ADR 0003).
- `diffMenus` normalization spec detail (edge cases:
  combo/quantity pricing, multilingual name variants) —
  specified with fixtures in M2.
- `MenuScope` values beyond `main` (drinks / lunch / …) —
  extend the enum when a real scope ships; do not pre-build
  scope UI in MVP.
