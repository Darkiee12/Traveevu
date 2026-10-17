# Traveevu — Implementation Roadmap (M0–M6)

> Status: PLANNING — no application code. `EXECUTION_MODE = PLANNING` until the user explicitly authorizes `BUILD` and implementation is permitted under hackathon rules. Do not silently change the mode.
> Companion docs: `architecture.md`, `domain-model.md`, `ai-boundaries.md`, `menu-rendering.md`, `data-provenance.md`.
> Ordering principle: **contracts → schema → extraction slice → renderer → bilingual order → persistence/reuse → admin → discovery/pricing → personalization.** Protect the primary demo journey at every milestone. A feature is not complete until its behavior is verified.

## Milestone map

| Milestone | Goal | Gate |
|---|---|---|
| M0 | Contracts + PoCs + repo skeleton (no product features) | PoCs pass; contracts merged |
| M1 | Menu extraction vertical slice (scan → validated extraction → confirm) | Fixture + integration tests pass |
| M2 | Interactive menu renderer + bilingual order + persistence/reuse | Playwright mobile journey passes |
| M3 | Studio: menus + resources + prompts + templates + AI Inspector | Admin workflows verified |
| M4 | Discovery (dish-first + map) + dish pages | Discovery + map verified |
| M5 | Pricing intelligence + contributions + reviews | Price stats verified against fixtures |
| M6 | Personalization (onboarding + recommendations) + polish + demo | Full demo rehearsal passes |

Each milestone below lists: dependencies, expected result, owner agent, acceptance criteria, validation method. Owners are workstream roles from `AGENTS.md` (house rules): Customer UX, Domain/Backend, AI Pipeline, Data/Admin — plus Orchestrator (Muse) for integration review at every milestone. One owner per file/module at a time; shared files have a single owner.

---

## M0 — Contracts, PoCs, skeleton

**Dependencies:** None (first). Blocks all other milestones: no parallel implementation until shared contracts for the slice are merged and stable.

**Expected result:** Monorepo skeleton + `packages/contracts` with the core contracts + passing PoCs + vendored library reference + `AGENTS.md` / workflow docs in place. No product features.

**Owner:** Orchestrator + Domain/Backend (contracts) + AI Pipeline (PoC).

**Work:**

1. Monorepo: Bun + Turborepo, `apps/customer`, `apps/admin`, `apps/api`, `packages/contracts`, `packages/domain`, `packages/ui`, `packages/config`. `bun install`, `bun run check`, `bun run test`, `turbo run dev/build`, `db:migrate`, `db:seed`, `demo:reset` targets defined (per `AGENTS.md` commands).
2. Pin + verify versions: Effect 4.0.0, TanStack Start 1.0 (`@tanstack/react-start >= 1.168.60`, CVE-2026-102989), Drizzle 0.45.3 / drizzle-kit 0.31.11, Bun 1.4.x, TS 5.9+ strict.
3. Vendor library source under `repos/` (git subtree, `--squash`, read-only, never imported by prod code) for Effect at minimum; align with installed versions.
4. Contracts in `packages/contracts` (Effect Schema, single source of truth): `MenuExtraction`, `MenuSnapshot`, `MenuPresentation`, `OrderDraft`, `SearchIntent`, `PriceObservation`, `PromptVersion`, `MenuTemplateVersion`, money + time primitives (exact numerics + currency + UTC timestamps).
5. **PoC 1 (blocking):** Effect Schema → JSON Schema → provider structured output → local decode round-trip for menu extraction on at least one provider. If it fails, narrow the contract or fix conversion — do not proceed with duplicate schemas.
6. **PoC 2:** TanStack Form + Standard Schema interop with Effect Schema (no duplicate Zod schemas).
7. **PoC 3:** Drizzle + PostGIS + JSONB: one migration, one geo query, one JSONB query.
8. **PoC 4:** Effect AI vs Vercel AI SDK vs provider-native SDKs — pick one primary approach on evidence (structured-output support, Effect interop, error modeling, cost/latency). Record decision in `docs/decisions/`.
9. Auth (RESOLVED: Better Auth + Google, ADR 0001 — no custom auth).
   PoC 5: mount `auth.handler` in Effect; Google round-trip in dev;
   anonymous → `onLinkAccount` claim of a draft in one transaction
   (verify throw semantics); admin negative test (Google user without
   role → 403 on every admin route); revocation works.
10. Seed-data licensing check: every seed source permitted / curated / labeled demo.

**Acceptance criteria:**

- [ ] `bun run check` passes on skeleton; `bun run build` passes for all apps.
- [ ] PoC 1 round-trip passes for menu extraction (validated decode of a real provider response).
- [ ] PoC 2 form validation works via Standard Schema with no duplicate schema.
- [ ] PoC 3 migration + geo + JSONB queries pass.
- [ ] PoC 4 decision recorded with rationale + rejected alternatives.
- [ ] Auth approach decided; tile provider + attribution decided.
- [ ] No application feature code merged (skeleton + contracts + PoCs only).

**Validation:** PoC scripts + `bun run check` + `bun run test` (skeleton tests). Orchestrator inspects diffs for contract compatibility + import rules (`repos/` never imported, frontends never import `db`/`ai`).

---

## M1 — Menu extraction vertical slice

**Dependencies:** M0 contracts + PoCs merged.

**Expected result:** A traveler can photograph a menu, get a validated structured extraction, and confirm/correct it. Extraction persists as a versioned `MenuSnapshot` (draft). No renderer, no ordering yet.

**Owner:** AI Pipeline (extraction, prompts, fixtures) + Domain/Backend (persistence, API) + Customer UX (scan + confirm UI).

**Work:**

1. Upload path: validated file type/size → private bucket → `MediaAsset` (private) + `MenuSnapshot` (draft).
2. AI task: menu extraction via published `PromptVersion` (draft → publish flow in code, minimal) + provider structured output + local re-validation + one retry max + `AIExecution` logging (prompt version, model, latency, tokens/cost, validation errors, no PII).
3. Confirmation UI: list extracted items (original + translation + price + uncertainties), edit/correct, confirm → new snapshot version.
4. Dish mapping: deterministic normalized-alias lookup first; AI disambiguation only when ambiguous; low-confidence stays unmapped.
5. AI eval fixtures (minimum 10 from `ai-boundaries.md` §8): clear / blurry / mixed-language / modifiers / no-price menus, receipt with discounts, multi-constraint NL query, ambiguous dish, adversarial injection, explanation with missing evidence.

**Acceptance criteria:**

- [ ] Clear menu: all items + prices extracted, originals preserved.
- [ ] Blurry menu: missing prices = null + uncertainties; no guessed prices.
- [ ] Mixed-language menu: both languages preserved; translations don't overwrite originals.
- [ ] Modifier menu: only printed options extracted; no invented modifiers.
- [ ] No-price menu: prices null + uncertainty shown.
- [ ] Adversarial fixture: injected instructions ignored; extraction only.
- [ ] Corrections create a new snapshot version; history preserved.
- [ ] `AIExecution` rows contain prompt version + model + validation errors and no PII.

**Validation:** Domain tests (alias matching, snapshot versioning) + AI fixture tests (schema compliance + no invented facts) + integration test (upload → extraction → persistence). Fixture suite runs in CI and gates prompt publication.

---

## M2 — Interactive renderer + bilingual order + persistence/reuse

**Dependencies:** M1 extraction slice.

**Expected result:** **The primary demo journey works end-to-end:** scan → understand → select → bilingual order view → reuse. This is the highest-priority milestone. Protect it against scope creep.

**Owner:** Customer UX (renderer, order UI, bilingual view) + Domain/Backend (presentation builder, OrderDraft, totals) + Data/Admin (contribution path, moderation queue minimal).

**Work:**

1. Presentation builder: `buildPresentation(snapshot, templateVersion)` — pure, deterministic, validated. Template registry v1 (one standard template, published).
2. Renderer: control registry (`section`, `dish-card`, `quantity`, `single-choice`, `multiple-choice`, `text-note`, `information`, `warning`) mapped to known React components. No AI-generated code.
3. OrderDraft: pinned snapshot version, selections, deterministic totals (null if any price unknown), deterministic dietary warnings, free-text requests marked unconfirmed.
4. Bilingual order view: customer language + original VN names/modifiers, translated special requests (marked unconfirmed), estimated-total labeling, "request, not confirmed order" disclaimers in both languages.
5. Persistence/reuse: contribution → moderation (approve/reject + reason, minimal) → published snapshot reusable without re-scan; snapshot date shown; "re-scan if outdated" affordance; menu-change diff (new scan vs previous published).
6. Mobile visual validation: narrow + desktop viewports, screenshots/browser automation, spacing/overflow/translations/loading/error states.

**Acceptance criteria:**

- [ ] Playwright mobile journey passes: scan (fixture image) → confirm → select items/options/quantities → bilingual view shows originals + translations + correct total.
- [ ] Unknown price → total null + "cannot estimate" note (never guessed total).
- [ ] Free-text request visually distinct from confirmed options; translation marked unconfirmed if uncertain.
- [ ] Bilingual view states (both languages) that this is a request, not an accepted order.
- [ ] Second traveler reuses the published menu without re-scanning.
- [ ] Menu-change diff surfaces added/removed/price-changed items.
- [ ] Draft pinned to snapshot version; newer snapshot offers "review changes", never silently rebases.
- [ ] Visual review: mobile + desktop screenshots inspected (compilation ≠ validation).

**Validation:** Playwright main mobile journey + integration tests (snapshot → presentation, selection → order draft) + domain tests (template resolution, order math, versioning) + visual screenshot review.

---

## M3 — Runtime Management Studio

**Dependencies:** M2 (renderer + presentation builder, to share). Studio preview must use the same renderer as the customer app.

**Expected result:** Operators can manage resources, prompts, templates, menus, and inspect AI behavior — without redeploying or editing source code.

**Owner:** Data/Admin + Domain/Backend (registries, APIs) + Customer UX (renderer sharing).

**Work:**

1. **Resource registry:** MediaAssets (stable IDs, public/private, metadata, aliases, preview, replacement, cache invalidation). Changing an image needs no redeploy.
2. **Prompt registry:** PromptDefinition / PromptVersion, draft editing, model selection, params, variables, schema refs, fixture testing, publish/rollback, audit history. Published prompts never bypass validated contracts.
3. **Template registry:** MenuTemplate / MenuTemplateVersion (YAML/JSON authoring → validated JSONB in Postgres), layout, controls, display/validation/ordering rules, locale settings, visual config, publish/deprecate, audit.
4. **Menu management:** scanned menus list, original image inspect, extracted items review, price correction, dish-mapping edit, version compare, uncertainty review, publish/reject, render preview (same renderer).
5. **AI Inspector:** input refs, extracted output, validation errors, prompt/model versions, latency, tokens/cost, fixture comparison, manual corrections. Reproducible: why did this extraction produce this result?
6. **Appearance config:** versioned design tokens + resource refs (colors, radii, typography presets, illustration variants, banners, menu layout presets). No remote CSS/JS.
7. AuthZ on every admin mutation (server-side, audited).

**Acceptance criteria:**

- [ ] Resource replacement updates display without redeploy; old IDs remain resolvable.
- [ ] Prompt publish → subsequent AI executions record the new version; rollback restores prior version.
- [ ] Template publish → presentation cache invalidated by version key; old snapshots still render.
- [ ] Menu correction in studio creates a new snapshot version; diff vs previous visible.
- [ ] AI Inspector reproduces an execution (prompt version, model, output, validation errors, latency/tokens).
- [ ] Appearance change (e.g., primary color) applies without redeploy and without arbitrary CSS/JS.
- [ ] Every admin mutation requires auth + authz + audit; unauthenticated mutation attempts rejected (test).

**Validation:** Playwright admin workflows (menu review, prompt publish, template publish, resource replace) + integration tests (prompt publish → execution, template publish → cache invalidation, contribution → moderation → publication) + authz tests.

---

## M4 — Discovery (dish-first + map + dish pages)

**Dependencies:** M2 (dish + menu data to discover). Can start after M2 contracts are stable; avoid parallel edits to shared contracts.

**Expected result:** Travelers can discover dishes first (not just restaurants), search with natural language, browse the map, and open SEO-friendly dish/restaurant pages.

**Owner:** Customer UX (discovery UI, map, dish pages) + Domain/Backend (search, ranking, geo) + AI Pipeline (intent extraction, explanations).

**Work:**

1. NL intent extraction → validated `SearchIntent` → deterministic filters (dietary, price caps, distance, flavor/texture) over structured data.
2. Dish-first discovery: dish cards (canonical name, translation, description, flavor/texture, price context, nearby restaurants serving it).
3. Dish pages + restaurant pages: SSR, SEO meta, canonical URLs (ID strategy from M0: UUID vs slug).
4. Map: MapLibre + OSM tiles + attribution, filters (dish, distance, price, dietary, attributes, relevance; reviews filter deferred with Review), restaurant pins → dish availability.
5. Recommendation explanations grounded in deterministic ranking features only.
6. Onboarding (lightweight version if M6 slips): language + dietary + favorites (up to 5, searchable) — enough to personalize discovery; full onboarding in M6.

**Acceptance criteria:**

- [ ] Multi-constraint NL query ("local, spicy, beef, under 100k, not soup") yields correct filters; ambiguity flagged, not guessed.
- [ ] Dietary/price/distance hard constraints enforced deterministically; no LLM-invented restaurants/prices.
- [ ] Dish page explains: names, translations, ingredients, allergens (with evidence tiers), origin, occasion, flavor/texture, similar foods, price context, nearby restaurants.
- [ ] Map filters work; pins link to dish/restaurant pages; attribution present.
- [ ] Dish/restaurant pages SSR + SEO meta verified.
- [ ] Explanations reference only supplied ranking features.

**Validation:** Domain tests (dish alias matching, dietary filtering, geo filtering, price normalization) + AI fixture (multi-constraint NL query, ambiguous dish) + Playwright discovery journey + SEO/SSR checks.

---

## M5 — Pricing intelligence + contributions

**Dependencies:** M2 (snapshots, contributions) + M4 (discovery surfaces to show price context).

**Expected result:** Dish-level price context is honest (median/percentiles + evidence counts, never LLM averages), contributions flow through moderation, and receipts strengthen price evidence without exposing PII. Reviews are **deferred from the MVP** (future independent entity — see `domain-model.md` §4.14); no Review table is built in M5.

**Owner:** Domain/Backend (pricing, contributions) + Customer UX (price UI) + AI Pipeline (receipt extraction) + Data/Admin (moderation).

**Work:**

1. Price stats: deterministic median / p25 / p75 / min / max from `PriceObservation`s, grouped by kind (listed vs receipt-paid), area, date range, variant/portion. Display: "Typical nearby range: 40,000–65,000 VND (n=12, District 1, last 90 days)". Insufficient evidence → "insufficient evidence".
2. Receipt extraction: line items, tax, discounts, combos, portions separated; PII redaction; private-by-default storage; receipt-paid observations via moderation.
3. Contributions: menu photos, food photos, receipts, price observations, corrections — full state machine + moderation queue + provenance. (Reviews are NOT part of M5 — deferred, see item 4.)
4. Reviews: **DEFERRED from the MVP.** Do not build the `Review` table, review submission, or review display in M5. When Review ships (post-MVP): dish/restaurant reviews, moderation, display; reviews never used as dietary/price evidence; reviews require Google sign-in (ADR 0003).
5. Price-change detection: new observations vs history; surface meaningful changes (moderator + user where useful).

**Acceptance criteria:**

- [ ] Price display always includes count + area + date range + kind mix; insufficient evidence shows "insufficient evidence", never a fabricated average.
- [ ] Listed vs receipt-paid never silently averaged together.
- [ ] Receipt with discounts: discount/tax/combo separated; no flattened per-dish price.
- [ ] Receipt images private; PII redacted before any wider use; no PII in logs.
- [ ] Contribution state machine enforced (draft → submitted → pending → published/rejected/needs_more_info); publishing never leaks profile/preferences/order history.
- [ ] Corrections create new versions; history preserved.

**Validation:** Domain tests (price normalization, price stats incl. percentiles, contribution transitions) + AI fixture (receipt with discounts) + integration tests (contribution → moderation → publication, receipt → observation) + privacy checks (no PII in logs / public surfaces).

---

## M6 — Personalization + polish + demo

**Dependencies:** M4 + M5 (discovery + pricing to personalize). Lowest priority — cut first if time is short.

**Expected result:** Short, non-survey onboarding personalizes recommendations; the full product is polished, tested, and demo-ready.

**Owner:** Customer UX (onboarding, recommendations UI) + Domain/Backend (personalization) + AI Pipeline (explanations) + Orchestrator (demo).

**Work:**

1. Onboarding: origin (suggestion only), language, dietary/allergies/religious (explicit only), spice, budget, adventurousness, preferred ingredients/textures, up to 5 favorite dishes (searchable, not just suggested). Skippable nonessentials; editable later. Explicit prefs > demographic inference.
2. Similarity recommendations: favorites → similar local dishes (shared flavors/techniques/textures), with grounded explanations.
3. Polish: empty states, loading states, error recovery, multilingual text behavior, accessibility pass, motion pass, map interactions polish.
4. Demo: reproducible demo script + `demo:reset` to known state + seeded demo data (labeled demo) + rehearsal. Demo = primary journey (M2) + reuse (M2) + discovery (M4) + one price-context example (M5).
5. Final verification: full test suite + Playwright (mobile journey + admin flows) + visual review (mobile + desktop) + security review (uploads, authz, PII, injection fixtures).

**Acceptance criteria:**

- [ ] Onboarding completable in <2 minutes; skippable; editable; no assumption that nationality determines taste/religion/diet.
- [ ] Recommendations reference favorites' features; explanations grounded.
- [ ] Demo rehearsal passes end-to-end on a clean `demo:reset` state.
- [ ] All M0–M5 acceptance criteria still pass (no regressions).
- [ ] Visual + accessibility review signed off (mobile + desktop).

**Validation:** Playwright full journey + domain + AI fixture + integration suites + demo rehearsal checklist + visual review.

---

## Cut list (defer or drop if time is short — protect M2 first)

| Item | Disposition |
|---|---|
| Price heatmaps / historical graphs / regional comparisons | Future — not MVP |
| H3 geospatial indexing | Deferred — PostGIS first |
| OpenSearch | No — Postgres FTS first, measure before adding |
| Multi-city launch | Architecture supports it; MVP seeds HCMC only |
| Full personalization (M6) | Cut/simplify first if time is short; M2 demo survives without it |
| Advanced onboarding (age range, textures, etc.) | Simplify to language + dietary + favorites if needed |
| Real-time / offline / on-device AI | Out of scope |
| Payment / order submission | Never in scope |
| Reviews (`Review` entity) | Deferred from MVP — future independent entity, not a value object, no table now, no JSONB arrays, no placeholder ratings/stats (see `domain-model.md` §4.14) |
| Chatbot-first UI | Never in scope |
| AI-generated executable UI | Forbidden, not deferred |
| Remote CSS/JS | Forbidden, not deferred |
| Google Maps / scraping | Forbidden, not deferred |

**Cut rule:** Cut in reverse milestone order (M6 → M5 → M4). Never cut M0–M2 completeness to fund M4–M6 breadth. One complete journey beats five partial features.

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Effect Schema → JSON Schema → provider structured output fails (PoC 1) | Contracts unusable for AI | M0 PoC is blocking; narrow contract or fix conversion before BUILD |
| Effect 4.0.0 APIs differ from memory/tutorials | Wrong code, wasted work | Vendored `repos/` source is the authority; verify against installed source |
| TanStack Start 1.0 + Form + Schema interop gaps | Validation duplication | PoC 2; thin adapter, never duplicate schemas |
| AI hallucinates prices/ingredients/options | False claims, safety risk | Validated contracts + unknown-stays-unknown + fixtures + moderation; see `ai-boundaries.md` |
| Prompt injection via menu/review content | Manipulated output | Delimited data, instruction hierarchy, schema validation, adversarial fixture |
| Dietary safety misread ("no warning = safe") | User harm | Evidence tiers + explicit unknown + prominent warnings; see `data-provenance.md` §4 |
| Menu data goes stale | Wrong prices shown | Versioned snapshots + observed dates + re-scan affordance + change diff |
| Seed data licensing / scraping temptation | Legal / trust risk | Permitted open data + curated + labeled demo only; no scraping |
| Multi-agent drift (shared contracts diverge) | Incompatible modules | Contracts-first, one owner per shared file, orchestrator diff review, incremental merges |
| Scope creep (four apps instead of one journey) | Demo fails | Cut list + milestone gates; every feature must serve scan→order, reuse, or operations |
| Tile provider / AI provider selection delays (auth decided: Better Auth + Google, ADR 0001) | Blocked milestones | Decide in M0; do not build custom auth; one reliable AI provider suffices for demo |
| Demo data mistaken for real data | Misleading demo | `source: demo` + visible "Demo data" labels |

## Milestone acceptance — general rules

- A milestone is done only when its acceptance criteria pass **and** its validation commands were actually run (report commands + results, not "implemented successfully").
- Every agent report lists: what changed, what was tested (commands + results), what remains incomplete, any architectural concerns.
- Orchestrator inspects diffs for contract compatibility, domain boundaries, error handling, and security-sensitive behavior before merge.
- Plans and progress live in repo files (`docs/`, `docs/decisions/`, milestone files) — never rely on chat history alone.
- If a document is unnecessary or duplicates another source of truth, explain that and omit it. These six docs are the planning core; `docs/product.md`, `docs/user-journeys.md`, `docs/demo-scope.md`, `docs/customer-design.md`, `docs/admin-design.md`, `docs/agent-workflow.md`, `docs/development/*.md` are separate planning deliverables owned by other workstreams (see `AGENTS.md` links).
