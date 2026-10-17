# Traveevu — Demo Scope (Hackathon)

> Status: PLANNING · Companion to `product.md` and `user-journeys.md`.
> Principle: **protect one complete, convincing user journey** over many disconnected features. If a feature threatens the primary slice, it is cut.

## 1. Priority Stack

| Priority | Slice | Demo promise |
|---|---|---|
| **P1 — Primary (must demo end-to-end)** | Scan → understand → select → bilingual order | A traveler scans a real restaurant menu, understands dishes, selects an order, shows a bilingual summary to staff. |
| **P2** | Menu reuse | A second traveler opens the same restaurant and reuses the contributed menu without re-scanning; re-scan diff surfaces changes. |
| **P3** | Dish discovery | Dish-first search (NL intent + filters) → dish page → nearby restaurants. |
| **P4** | Personalization + price intelligence | Onboarding preferences influence ranking; dish-level price context (median/percentile) where evidence exists. |

Priorities may shift after feasibility testing, but P1 is never sacrificed for P2–P4.

**MVP gating (review amendment 2026-10-16 — locked):** P1 must work
completely — scan → interactive menu → bilingual order, verified on a
real printed menu + Playwright mobile journey — before P2 work starts.
P2 (reuse) is next because it demonstrates the crowdsourced-data
concept: a second traveler opens the same restaurant and uses the
latest published snapshot without re-scanning, with an optional
re-scan diff. P3 discovery does not start until the P1+P2 gate passes.
Do not start P3/P4 to "make progress" while P1 is unverified.

## 2. P1 — Primary Vertical Slice (must be demoable end-to-end)

### What the demo shows (narrative)

1. Presenter opens the app on a phone (narrow viewport).
2. Taps **Scan menu**, photographs a real printed menu (or loads a prepared photo — see §6 rehearsal rules).
3. Reviews the extraction, corrects one item live (demonstrates the Confirm step is real).
4. Browses the interactive menu, picks 2 items, chooses a size/modifier, sets a quantity.
5. Opens the bilingual order summary; shows the staff view (original Vietnamese names + translated requests + total).
6. (Optional, time permitting) Shows that the menu was contributed and is now reusable.

### In scope for P1

- [ ] Camera / gallery menu capture (multi-page), upload validation (type, size).
- [ ] AI menu extraction → validated structured menu (schema-enforced; `unknown` for missing data).
- [ ] Confirm/correction screen (edit name, translation, price; delete invented items; flag uncertainty).
- [ ] Schema-driven interactive menu renderer: `section`, `dish-card`, `quantity`, `single-choice`, `multiple-choice`, `text-note`, `information`, `warning` controls.
- [ ] Order review + bilingual staff view (customer language + original names; translated special requests; estimated total when supported).
- [ ] Explicit "request, not a confirmed order" copy; no payment/submission language.
- [ ] One curated seed restaurant + menu for the fallback path (if live scan fails on stage — see §6).
- [ ] Mobile viewport polish: no overflow, tappable targets ≥ 44px, readable at arm's length.

### Acceptance criteria for P1

- [ ] Works on a real printed Vietnamese menu photo, not only on a fixture.
- [ ] Extraction never invents a price/option/ingredient; missing data renders as `unknown` / "Price not on menu".
- [ ] Confirm step is mandatory before persistence/sharing.
- [ ] Estimated total appears only when every selected item has a price; otherwise the gap is explicit.
- [ ] Staff view is legible when the phone is held out to another person (large type, high contrast, original names).
- [ ] Full flow completes in ≤ ~3 minutes including one correction.
- [ ] Browser validation: tested on narrow mobile viewport + desktop; screenshots / Playwright coverage of the happy path (see §7).

## 3. P2 — Menu Reuse

### In scope

- [ ] Confirmed extraction → opt-in contribution → `MenuSnapshot` version stored with provenance (restaurant, image ref, timestamps, source, confidence, status).
- [ ] Moderation queue in admin: approve / reject with reason (manual review for hackathon; see §5).
- [ ] Second-visitor flow: "Use existing menu (verified [date])" vs. "Scan again".
- [ ] Re-scan diff: added / removed / price-changed items shown before publication.
- [ ] Version history preserved; new observation never silently overwrites the old one.

### Acceptance criteria

- [ ] Demo can show: Visitor A scans → shares → Visitor B opens same restaurant → menu loads without scanning.
- [ ] Diff view shows at least one price change and one added item on a prepared re-scan.
- [ ] Declining to share publishes nothing.

### Cut from P2 (defer)

- Automatic change detection / alerts; crowd consensus scoring; trust scores beyond a simple verification status.

## 4. P3 — Dish Discovery

### In scope

- [ ] Dish-first search with NL intent box ("Understood as" tokens, editable).
- [ ] Deterministic hard-constraint enforcement (price, exclusions) + preference-aware ranking.
- [ ] Dish pages for a curated seed set (canonical name, aliases, translation, description, ingredients, allergens, dietary notes, origin, occasion, flavor/texture, similar familiar foods, typical price range, nearby restaurants).
- [ ] Map view (MapLibre) with dish filter, distance filter, restaurant list synced to pins.
- [ ] Seed data: enough dishes + restaurants in D1/D3/Bình Thạnh to make discovery feel real (target: ≥ 20 dishes, ≥ 15 restaurants — curated, labeled demo observations).

### Acceptance criteria

- [ ] At least one NL query demo: "Something local, spicy, with beef, under 100,000 VND, but not soup" returns sensible, constraint-respecting results.
- [ ] Every dish card shows price-evidence and dietary-evidence states.
- [ ] Map + list stay in sync; empty states name the blocking constraint.

### Cut from P3 (defer)

- Full-text search ranking tuning, personalized recommendation engine, regional variants beyond 1–2 exemplar dishes, review aggregation/sorting.

## 5. P4 — Personalization + Price Intelligence

### In scope

- [ ] Onboarding (Journey 1): language, origin (optional), ≤ 5 favorite dishes, dietary/allergy/religious (explicit only), spice/budget/adventurousness — all skippable, editable later.
- [ ] Preferences influence ranking (explicit preferences > demographic signals; origin never infers religion/diet).
- [ ] Dish-level price context: observed price vs. nearby typical range (median + percentile band) **where evidence suffices**; otherwise "insufficient evidence".
- [ ] Staleness labeling on price observations.

### Acceptance criteria

- [ ] Onboarding completable/skippable in ≤ 90s.
- [ ] Two users with different favorite dishes see measurably different ordering for the same query (spot-check, not a full recommender eval).
- [ ] No price average is presented as fact without a stated sample / evidence state.

### Cut from P4 (defer)

- Price heatmaps, historical price graphs, price-change detection/alerts, regional price comparisons, collaborative filtering, learned taste embeddings.

## 6. Explicit Cut List (hackathon — do NOT build)

| Cut | Why | What to say if asked |
|---|---|---|
| OpenSearch | PostgreSQL full-text + PostGIS suffices for demo scale | "Postgres search first; revisit with evidence" |
| H3 geo-indexing | PostGIS distance queries suffice; H3 only helps at aggregation scale we won't reach | Deferred to post-hackathon |
| Price heatmaps / history graphs / alerts | Needs longitudinal data we don't have; median/percentile context is the honest MVP | Deferred |
| Payment / order submission / POS integration | Out of product scope (communication assistant, not ordering platform) | "Show-phone ordering only" |
| Full personalization engine / ML recommender | Rule + preference-similarity ranking is enough; ML adds risk without demo value | Deferred |
| Chatbot assistant | Explicitly against product philosophy | NL search box only |
| Native apps, offline-first sync, multi-city launch | Web, HCMC seed only | Deferred |
| Social feed / following / messaging | Reviews only if ever built (Review deferred — see `domain-model.md` §4.14). Corrections stay in the Contribution workflow, never social. | Deferred |
| Auto-publishing AI extractions | Human confirm + moderation required | Manual review queue |
| Unrestricted remote CSS/JS theming | Versioned design tokens only | Security boundary |
| Real-time availability / inventory | Menus are point-in-time observations | Staleness labeled |
| Automated moderation / spam ML | Manual queue suffices for demo volume | Deferred |

Anything on this list requires an explicit product decision to re-add; it is not "stretch goal" work to start quietly.

## 7. Verification Plan (demo readiness)

| Layer | What must exist before demo |
|---|---|
| Domain tests | Dish alias matching, dietary filtering, price normalization, geo filtering, menu versioning, contribution state transitions, template resolution |
| AI eval fixtures | ≥ 8 fixtures: clear Vietnamese menu, blurry menu, mixed-language menu, menu with modifiers, menu missing prices, receipt with discounts, multi-constraint NL query, ambiguous food description. Schema compliance + no-invention checks. |
| Integration tests | Extraction → persistence; snapshot → presentation; selection → order draft; prompt publish → subsequent execution; template publish → cache invalidation; contribution confirm → moderation/publication |
| Browser tests | Playwright (or equivalent): P1 mobile journey end-to-end; admin approve/reject flow; narrow + desktop viewports; visual check of spacing/overflow/translations/loading/error states |
| Rehearsal | At least one full dry run on a real printed menu + one run on the fallback fixture (see below) |

### Rehearsal fallback rules (avoid demo failure modes)

- Prepare **one fully curated fallback restaurant + menu** (pre-extracted, pre-verified) so the demo can proceed via "Use existing menu" if live AI extraction fails on stage.
- Prepare a **second menu version** with a visible price change for the P2 diff demo.
- Never fake a live extraction: if the fallback is used, say so ("This is a previously verified menu").
- Pre-seed the demo account's onboarding (or rehearse the skip path) so onboarding never eats demo time.

## 8. Seed Data Requirements (minimum for a credible demo)

- ≥ 15 restaurants across D1 / D3 / Bình Thạnh with names, coordinates, and at least one dish each.
- ≥ 20 canonical dishes with aliases, translations, ingredients, allergen flags, dietary notes, typical price ranges.
- ≥ 1 restaurant with a complete, verified menu (the P1 fallback).
- ≥ 1 restaurant with two menu versions (the P2 diff demo).
- Price observations: enough per featured dish to show a real median band for at least 3 dishes; other dishes honestly show "insufficient evidence".
- All seed rows labeled as curated / demo observations with source + timestamp. No scraped data presented as verified.

## 9. What "Done" Means

The demo is done when an independent person, given only a phone and a printed menu, can complete P1 without help, and a second person can reuse the resulting menu — both within the time boxes above, with no invented data and no payment/submission language anywhere in the UI.
