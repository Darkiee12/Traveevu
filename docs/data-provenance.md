# Traveevu — Data Provenance

> Status: PLANNING — no application code. Companion to `architecture.md`, `domain-model.md`, `ai-boundaries.md`, `menu-rendering.md`.
> Core rule: **Evidence is not fact. Every shared claim carries its source, time, confidence, and status — or is explicitly unknown.**

## 1. Evidence vs verified fact

| Level | Meaning | Examples | UI treatment |
|---|---|---|---|
| `verified` | Human-curated, restaurant-confirmed, or moderator-published | Moderator-published menu; restaurant-confirmed ingredient | Shown plainly; source available on detail |
| `observed` | Extracted from evidence (menu photo, receipt) with provenance + confidence | Menu-scan price; receipt line item | Shown with source + date ("from menu photo, Oct 2026") |
| `common` | Common recipe knowledge, not specific to *this* restaurant | "Cơm tấm commonly contains fish sauce" | Shown as "commonly contains", never as a fact about this restaurant |
| `unknown` | No evidence | Unlisted ingredients; illegible price | Shown as unknown / "ask staff" — never hidden, never defaulted to safe/typical |

**Rules:**

- AI-extracted information carries confidence + provenance. It is `observed` at best, never `verified` by virtue of being extracted.
- An LLM-generated description is **never** sufficient evidence of a restaurant's ingredients, prices, or availability.
- Promotion from `observed` → `verified` requires a human step: moderation, curation, or restaurant confirmation. Promotion is recorded (who, when, from what evidence).
- Demotion is also possible: a correction or a newer observation can demote a claim back to `observed`/`unknown`. History is preserved; demotion creates a new version, not a silent edit.

## 2. Provenance fields (every shared record)

Every shared fact (dish attribute, menu item, price, restaurant attribute) carries, at minimum:

```text
Provenance {
  source: enum,          // menu_scan | receipt | manual | curated | user_report | open_data | demo
  sourceRef?: id,        // MenuSnapshot id / Contribution id / Receipt ref — traceable
  capturedAt: timestamp, // when the evidence was captured/extracted
  observedAt?: timestamp,// when the underlying reality was observed (menu date, receipt date)
  confidence?: number,   // extraction/matching confidence where applicable
  evidenceLevel: enum,   // verified | observed | common | unknown
  status: enum,          // draft | pending_review | published | rejected | superseded
  createdBy?: id,        // private — never exposed publicly
  supersedesId?: id      // previous version, if any
}
```

**Two timestamps, always distinguished:**

- `capturedAt` / extraction timestamp = when we processed the evidence.
- `observedAt` / observed-menu timestamp = when the menu/receipt itself dates from, **when available** (e.g., a printed menu date, a receipt date). Often unknown — then `null`, not the capture time.

Conflating these two produces false "freshness" claims (a 2023 menu scanned in 2026 is not fresh). The UI shows the observed date where known, and the capture date otherwise, labeled correctly.

## 3. Menu observations — versioning & change detection

- `MenuSnapshot` rows are append-only and immutable once stored (see `domain-model.md` §4.6). Corrections, re-scans, and admin edits create **new versions**; nothing overwrites.
- Each version records: restaurant, snapshot version, image ref, extraction payload, confidence, status, `supersedesId`, timestamps.
- **Current menu** = latest `published` snapshot for a restaurant, resolved deterministically. History remains queryable.
- **Change detection:** When a new snapshot is stored, a deterministic diff vs the previous published snapshot reports: added items, removed items, price changes (old → new), option changes. The diff is surfaced to moderators and, where useful, to users ("3 prices changed since your last visit").
- **Comparison, not replacement:** A scan may be compared with an existing menu to detect changes. The comparison result is itself stored (diff + timestamps), not just acted on silently.
- **Reuse:** The next traveler reuses the latest published snapshot without re-scanning. The UI shows the snapshot's date + "Re-scan if this looks outdated".

## 4. Dietary safety — evidence tiers (normative)

Dietary claims are safety-critical. The model below is mandatory, not advisory.

### 4.1 Ingredient evidence levels

| Level | Meaning | Source |
|---|---|---|
| `confirmed` | Restaurant confirmed this ingredient / preparation for *this* dish at *this* restaurant | Restaurant statement, verified menu note, moderator-confirmed |
| `known` | Stated on the menu / in verified dish data for this dish | Menu text, curated dish data |
| `common` | Common recipe knowledge for this dish in general | Culinary knowledge, AI suggestion labeled as such |
| `unknown` | No evidence about this ingredient / preparation | Absence of information |

### 4.1a Allergen status — four-state, separate axis (ADR 0004)

Ingredient evidence (§4.1) and allergen status are **distinct axes**.
Ingredients and allergen statuses are validated values on `Dish`
(typical recipe) and, where evidenced, on `MenuItem` (this serving)
— no `Ingredient` / `Allergen` / `DishIngredient` /
`IngredientAllergen` tables in the MVP.

| Status | Meaning | Established by |
|---|---|---|
| `present` | Allergen is in the dish/serving | Menu text, restaurant statement, moderator-verified evidence |
| `possibly_present` | Allergen may be present, incl. cross-contact risk / uncertain preparation | Uncertain evidence, cross-contact concern, AI suggestion at most |
| `confirmed_absent` | Allergen is confirmed not present | Restaurant confirmation (or moderator-verified evidence) **only** — never AI inference, never absence of mention |
| `unknown` | No information | Absence of information; an allergen with no entry is `unknown` |

- An ingredient with evidence `common` supports at most
  `possibly_present` for its allergen, never `present`.
- Cross-contact risk is `possibly_present` + an uncertainty entry
  (e.g. `cross_contact_unknown`), never collapsed into
  absent/unknown.
- The allergen vocabulary is one centralized `AllergenCode` enum
  in `packages/contracts` (Effect Schema). No arbitrary allergen
  strings anywhere; adding a code is a contract change.

### 4.2 Display rules

- **Never claim safe from absence.** "The model did not identify peanut" ≠ "peanut-free". For a **strict allergen exclusion**, a "safe" verdict requires `confirmed_absent` for that allergen at the applicable level (`MenuItem`-level if present, else Dish-level typical) **and** no `possibly_present` / `unknown` blocking the claim. Anything else → "cannot confirm safe": show the warning, suggest asking staff. Dish-level values describe the typical recipe, not guaranteed preparation — the UI surfaces that distinction.
- When preparation is `unknown`, the UI says so explicitly: "Preparation unknown — ask staff whether this contains peanuts." No green checkmark, no "safe" label.
- `common` ingredients are shown as "commonly contains X" — visually distinct from `known`/`confirmed`. The user can see the difference at a glance.
- AI-suggested ingredients are always `common` until evidenced otherwise. AI suggestions never auto-promote to `known`.
- **Severe allergies:** If the user has declared a severe allergy, uncertainty is surfaced prominently (warning control, acknowledgment step). See `menu-rendering.md` §6. The system must not design a flow where "no warning shown" reads as "safe".

### 4.3 What counts as evidence (and what does not)

| Evidence | Counts for |
|---|---|
| Menu text listing an ingredient | `known` for that ingredient in that menu item |
| Restaurant staff confirmation (recorded) | `confirmed` |
| Moderator-curated dish data with cited source | `known` for the canonical dish (not for a specific restaurant's preparation) |
| AI extraction from menu image | `observed` — the menu said it; still `known` only if the menu text itself states the ingredient |
| AI-generated description ("this dish usually has…") | `common` at best — never `known`/`confirmed` |
| Review text mentioning an ingredient (when Review ships; deferred from MVP) | Not evidence for dietary safety. Reviews are opinions. |
| Absence in any of the above | `unknown` — nothing else |

## 5. Privacy — receipts, images, and personal data

### 5.1 Receipts

- **Raw receipt images are private by default.** Never publicly accessible. Stored in the private bucket; access is owner + authorized moderators only, with audit.
- Receipt parsing must consider taxes, discounts, combos, portions, and other price modifiers. A receipt total is not automatically a per-dish price.
- **PII redaction:** Detect and protect personal / transactional information on receipts (card numbers, names, phone numbers, transaction IDs, QR codes that encode personal data). Redaction happens before any wider use; the redacted/derived observation (amount, dish, restaurant, date) is what may be published — never the raw image or PII fields.
- A receipt-derived `PriceObservation` (kind `receipt_paid`) publishes the *amount + context*, not the receipt image or PII.
- Receipts are **not automatically authoritative**. They are stronger price evidence than manual submissions, but still go through the contribution/moderation path. A receipt with unclear line items stays `pending` / `needs_more_info`.

### 5.2 Menu photos & user contributions

- **Scan images are processed privately, not published.** Extraction
  is server-side AI, so a menu photo is sent to our backend and to
  the AI provider for private processing — processing is not
  publication. The image is stored as a private `MediaAsset`,
  visible only to the extraction pipeline (and, if submitted, to
  moderators), with access audited.
- **Temporary storage + retention limit.** An unsubmitted scan
  image is held only until the traveler decides: if they do not
  submit it, it is deleted after a short window (default proposal:
  24h after capture or when the draft is abandoned, whichever is
  first; exact window confirmed in M0; deletion is recorded). A
  submitted image is retained per the retention policy (§9 Q1)
  until the contributor deletes it or the window passes.
- **Privacy disclosure.** The UI discloses before scanning that the
  photo goes to our backend + AI provider for extraction, is not
  published, and is deleted if not submitted. The scan flow never
  implies the photo stays on the device.
- Menu photos: private until published. Published display uses the derived structured menu, not necessarily the raw photo. If a raw photo is ever displayed publicly, it needs explicit moderation + a check for incidental PII (people, license plates, etc. in the background).
- User-generated content (menu photos, food photos, receipts, price observations, corrections — reviews when Review ships; deferred from MVP) requires moderation + provenance. See §6.
- **Do not publish the user's private profile or ordering preferences** as part of shared menu data. Publishing a contribution publishes the *menu/price evidence* (review evidence when Review ships; deferred), never `UserPreference` (incl. taste anchors), `PreferenceConflict` (retained incoming preference documents — private to the owning account, never published/logged), or `OrderDraft`.
- **Invariant:** the shared/published menu (`MenuSnapshot` /
  contribution payload) must never contain private user
  preferences or order details. Extraction and publication
  pipelines carry only menu evidence; preference/order fields are
  never an input to them.
- Users can request correction/removal of their contributions. Removal marks the contribution `removed` + supersedes dependent snapshots where needed; it does not rewrite history — the removal itself is recorded.

### 5.3 PII minimization

- Store only the personal data the product needs. No unnecessary PII.
- `AIExecution` logs contain no PII (see `domain-model.md` §4.19): prompt version, model, latency, tokens/cost, validation errors, input *references* — never raw profile, receipt bytes, or secrets.
- Avoid logging sensitive user information unnecessarily anywhere. If a log needs an identifier, use an opaque user id, not name/email.
- Profile fields are editable and deletable. Deleting a profile removes/ anonymizes its private data; shared published evidence derived from contributions remains (de-identified) unless a removal request applies — decide the exact retention policy in M0 with the privacy review.

## 6. Moderation & publication states

### 6.1 Contribution state machine

```
draft → submitted → pending_review → published | rejected | needs_more_info
                                              ↺ (resubmit as NEW contribution)
```

- `draft`: user is still editing; not visible to others.
- `submitted`: awaiting review.
- `pending_review`: in a moderator queue.
- `published`: visible to other travelers; evidence is shared.
- `rejected`: not published; reason recorded; user may resubmit as a new contribution.
- `needs_more_info`: moderator requests clarification (e.g., blurry image, unclear price); user resubmits as a new version.

Transitions are forward-only through moderation. There is no silent auto-publish for safety-relevant claims. (A future fast-path — e.g., high-confidence re-scan matching the existing menu — may auto-confirm *menu sameness*, but it must not auto-publish new dietary or price claims. Decide in M2; default is human review.)

**Anonymous submissions (ADR 0003):** menu scans, corrections, and
price reports may be submitted by anonymous guests (Better Auth
anonymous-plugin users). They enter at `submitted` → `pending_review`
and are **never auto-published** — the MVP keeps manual publication
approval for every anonymous submission. Trust scoring, reputation,
and automated moderation are future improvements, explicitly not
hackathon dependencies; they need their own ADR if ever introduced.

### 6.2 Menu / price / review publication

| Data | Published when | Evidence quality / verification (ADR 0003) |
|---|---|---|
| Menu snapshot | Contribution approved by moderator (or eligible fast-path, if defined) | Menu scan: photo-backed + extraction payload; moderator checks extraction against the photo. Highest of the anonymous evidence classes — re-verifiable. |
| Price observation | Moderated + deduplicated; receipt-paid observations need legible line items | Receipt-backed (`source: receipt`): photo with legible line items. Manual (`source: manual`): typed, unverified — never receipt-backed, confidence capped, published only as "reported price, unverified". Manual and receipt-backed are never aggregated or displayed equivalently. |
| Review | **DEFERRED from the MVP** (future independent entity — `domain-model.md` §4.14). When implemented: moderated (spam/abuse/PII check); reviews are opinions, never dietary/price evidence | Signed-in only when implemented (ADR 0003). |
| Dish (canonical) | Curated or moderator-approved; AI-proposed dishes stay `draft` until reviewed | — |

**Corrections** (field-level change list against a published
snapshot) are verified as diff + reason against prior evidence;
allergen corrections always need moderator review. Corrections go
through the same contribution/moderation path as new submissions.

### 6.3 Audit trails

- Every admin mutation, prompt/template publish, moderation decision, and contribution status change is recorded: who, when, from what, to what, reason.
- Audit records are append-only.
- The AI Inspector can trace any published menu back to: original image ref, extraction payload, prompt version, model, corrections applied, moderator, publish time.

## 7. Corrections

- Any user or moderator can propose a correction (price, dish mapping, translation, option, allergen note).
- A correction creates a **new observation/version**, never a silent in-place edit. The old version remains in history with its provenance.
- **Field-level provenance (review amendment 2026-10-16):** each field carries `evidenceLevel: ai_extracted | user_confirmed | restaurant_confirmed` + `sourceRef` + `confirmedBy/at` where applicable. The original extraction is preserved verbatim; a correction is a `Contribution(type: correction)` with an explicit field-level change list (`field, oldValue, newValue, reason, actor, at`) that produces a new snapshot version. The confirm screen promotes only fields the user actually reviewed. Safety-relevant corrections (adding/removing an allergen) require moderator review — never auto-published from one user correction.
- Corrections go through the same contribution/moderation path as new submissions.
- If a correction invalidates a previously published claim (e.g., a price was wrong), the corrected version supersedes it, and the UI reflects the correction. The history shows both versions + the reason.
- Malicious / spam corrections are handled by moderation + rejection reasons; repeated abuse may restrict contribution privileges (decide enforcement in M0 auth/moderation design). Guest IDs alone are not abuse prevention (ADR 0003) — clearing cookies mints a fresh anonymous identity, so controls must include per-IP rate limits, per-submission validation, and the moderation queue as the hard gate.

## 8. Seed & demo data provenance

- Initial seed data: permitted open data, curated records, and **clearly labeled demonstration observations** only. No scraped data. No fabricated restaurants/prices presented as real.
- Demo observations carry `source: demo` + a visible label in the UI ("Demo data") so a demo reviewer never mistakes them for real observations.
- Seed data goes through the same schemas and validation as real data — no backdoor unvalidated seed path.
- When real user contributions replace demo data for a restaurant, the demo snapshot is superseded (history preserved), not deleted silently.

## 9. Open questions

1. **Retention policy** — how long are private raw images (menu photos, receipts) kept after their derived observations publish? Decide in M0; default proposal: keep until the contributor deletes them or a defined retention window passes, with deletion recorded.
2. **Fast-path auto-confirmation** — define narrow criteria (if any) for auto-confirming a re-scan that exactly matches the published menu. Default: human review. Decide in M2.
3. **Allergen vocabulary governance** — RESOLVED 2026-10-17
   (ADR 0004): one centralized `AllergenCode` enum in
   `packages/contracts` (Effect Schema). Adding a code is a
   contract change: versioned, reviewed, released with the
   contracts package. No `Allergen` table in the MVP.
4. **Profile deletion vs shared evidence** — exact de-identification rules when a user deletes their account. Decide in M0 with privacy review.
5. **Anonymous-submission abuse controls (ADR 0003)** — per-IP rate-limit thresholds, duplicate detection, queue capacity for guest-owned items. Decide in M0/M2; guest-id bans alone are not the mechanism.
