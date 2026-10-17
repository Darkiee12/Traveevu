# Traveevu — Product Definition

> Status: PLANNING · `EXECUTION_MODE = PLANNING` · No application code.
> Repo: `Darkiee12/Traveevu` (empty at planning time: only LICENSE + README on `master`).
> This document is the product source of truth. Architecture, domain model, and menu-rendering docs build on it; they do not redefine it.

## 1. Vision

**Reduce friction between a traveler and an unfamiliar local food environment.**

A traveler arriving in Ho Chi Minh City should be able to answer, within minutes and without speaking Vietnamese:

1. What should I eat?
2. Is it safe / suitable for me?
3. What is a fair price?
4. Where nearby serves it?
5. How do I order it?

Today those answers are fragmented across Google Maps, translation apps, review sites, food blogs, and search engines — and even after finding a restaurant, understanding the menu and communicating an order can still fail.

Traveevu is a **mobile-first, AI-native food discovery and ordering companion** that unifies that path: dish-first discovery → nearby restaurants → menu understanding → bilingual ordering.

## 2. Problem (evidence from the brief)

| Pain | Why existing tools fail |
|---|---|
| Doesn't know what local dishes exist | Search requires knowing the dish name first |
| Doesn't know local names / pronunciation | Translation apps translate words, not dishes |
| Remembers a dish only by appearance / ingredients | Image search returns photos, not structured dish data |
| Unsure about dietary suitability / allergens | Blogs and reviews are inconsistent; no ingredient-level model |
| Doesn't know a fair local price | Prices are per-restaurant, not per-dish with distribution context |
| Doesn't know which nearby restaurants serve a specific dish | Maps are restaurant-first, not dish-first |
| Cannot understand a physical menu | Photo translation is flat text; no structure, options, or totals |
| Cannot explain an order to staff | No bilingual, structured order summary tied to the actual menu |

## 3. Product Philosophy

### 3.1 AI behind familiar UI, not a chatbot

AI reduces the information the user must understand. It does **not** introduce a new interface the user must learn.

- Primary UI: cards, maps, search inputs, guided questions, selectable options, interactive forms, bottom sheets, clear action buttons, bilingual order summaries.
- AI works behind those surfaces: interpreting ambiguous input, extracting structured data from images, matching dishes, explaining recommendations.
- No chatbot-first navigation. There is no expectation that the user "prompts" the app. Natural-language input is **one** input method (a search box with examples), not the product.

### 3.2 Structured data enforces truth; AI interprets language

| AI does | Deterministic code does |
|---|---|
| Interpret natural-language intent ("something local, spicy, with beef, under 100,000 VND, but not soup") | Enforce hard constraints (price ceiling, dietary exclusion, distance) |
| Extract menu structure from a photo | Validate extraction against a schema; reject invented fields |
| Translate names/descriptions, explain recommendations | Compute price medians / percentiles from observations |
| Match a menu item to a canonical dish (with confidence) | Store provenance, version menus, enforce authz |
| Suggest similar dishes the user may recognize | Never claim dietary safety from absence of evidence |

**Hard rule: never let the LLM invent restaurants, prices, options, or ingredients.** If evidence is missing, the field is `unknown` and the UI says so.

### 3.3 Core UX principle

> A user understands how to perform the main action within ~15–30 seconds without reading documentation.

Optimize for the user's mental model, not the internal software structure. Progressive disclosure: show extra controls only when they become relevant. Prefer one clear action per screen over dense dashboards.

### 3.4 Dietary safety posture

Never claim a dish is safe for an allergy because the model did not identify that ingredient. Distinguish explicitly:

- **Known ingredients** — stated on the menu / confirmed by the restaurant.
- **Common recipe ingredients** — typical for the dish, not confirmed for this serving.
- **Restaurant-confirmed ingredients** — verified via menu or staff.
- **Unknown preparation details** — cross-contact, sauces, shared fryers, etc.

The UI must communicate uncertainty where it exists. A missing allergen warning is not a safety guarantee.

## 4. Initial Geography

**Hackathon prototype scope:** Ho Chi Minh City, Vietnam — District 1, District 3, Bình Thạnh.

This is a **seed-data and demo scope**, not an architectural scope. The architecture must support additional cities, countries, currencies, and languages without major domain redesign:

- No Vietnam-specific assumptions in shared domain logic (no hardcoded `VND`, `vi`, district names, or price bands in core types).
- Currency is always carried as an ISO 4217 code alongside an integer minor-units amount (`amountMinor`, never float, never decimal/`numeric`).
- Language is a locale tag on content rows, not a column named `vietnamese_name`.
- Geography is coordinates + administrative labels from data, not enums in code.
- Dish, restaurant, menu, and price models must work for any city added later by seeding new data.

Seed data for the prototype uses permitted open data, curated records, and clearly labeled demonstration observations. Do not design around unauthorized Google Maps scraping. Respect OSM / tile-provider attribution, terms, and rate limits.

## 5. Features (summary)

Full behavior lives in `user-journeys.md`; rendering rules in `menu-rendering.md` (companion doc); domain model in `domain-model.md` (companion doc).

1. **Personalized onboarding** — short, skippable; up to 5 favorite dishes; dietary restrictions, allergies, religious requirements (only when explicitly provided), spice tolerance, budget, adventurousness. Country/region may suggest familiar dishes but must never infer religion, dietary rules, or taste from nationality. Explicit preferences beat demographic assumptions.
2. **AI-powered food discovery** — natural-language intent → validated structured search intent → ranked dishes, combined with preferences, constraints, location, availability, price observations, dish characteristics, meal context.
3. **Dish-first discovery** — dish pages: canonical local name, aliases/spellings, translated name, description, ingredients, allergens, dietary notes, origin, meal occasion, flavor/texture, similar familiar foods, typical price range, nearby restaurants serving it. Regional variants are explicit, not collapsed — shown as variant-labelled menu items grouped on the dish page (`MenuItem.variantLabel`; no separate `DishVariant` table — ADR 0002).
4. **Map + local price intelligence** — interactive map; filters by dish, distance, price, dietary suitability, restaurant attributes, personal relevance (reviews filter deferred with Review — see `domain-model.md` §4.14). Dish-level price context (e.g. observed price vs. nearby typical range) with median/percentile estimates where evidence suffices; explicit "insufficient evidence" otherwise.
5. **AI menu scanning** — photograph a physical menu → structured extraction (original names, translations, descriptions, prices/currencies, categories, sizes, options, modifiers, quantity pricing, instructions). Preserve original wording. Missing/uncertain stays `unknown`. User can correct.
6. **Interactive menu generation** — extracted menu becomes an interactive ordering UI via **schema-driven rendering** (see §6). Browse categories, understand dishes, select items/sizes/modifiers, set quantities, add special requests, review estimated total, see dietary warnings/uncertainties.
7. **Bilingual ordering** — customer view in user's preferred language; staff view preserves original local names/modifiers, quantities, special requests translated into the restaurant's language, estimated total when supported. User shows phone to staff. **Order communication assistant, not payment or order submission.** No implication the restaurant accepted the order. Requested changes are distinguished from confirmed options.
8. **Crowdsourced menu contributions** — confirmed extractions may be contributed as versioned menu observations (restaurant identity, image reference, extraction timestamp, observed menu timestamp, items, prices, source, confidence, verification/publication status). Next traveler reuses a trusted menu without re-scanning. Private profile/order data is never published with shared menus.
9. **Community data** — menu photos, food photos, receipts, price observations, corrections. (Restaurant/dish reviews deferred with Review — see `domain-model.md` §4.14.) Receipts are stronger price evidence than manual submissions but not automatically authoritative (taxes, discounts, combos, portions). Raw receipt images stay private by default; detect/protect personal/transactional info. All UGC needs moderation + provenance.

## 6. Schema-Driven UI (product-level rule)

**The AI must never generate executable React components, JSX, JavaScript, or arbitrary HTML as menu output.**

AI generates validated structured menu data and, where appropriate, selects from a predefined registry of supported UI components/templates. The app renderer maps validated schema nodes to known React components. Supported controls include: `quantity`, `single-choice`, `multiple-choice`, `text-note`, `information`, `warning`, `section`, `dish-card`.

Consequences:

- A new executable component requires a code change. Changing which existing components a template uses does not.
- Templates are versioned runtime data (see Runtime Management Studio in `architecture.md`), not code.
- Free-text special requests are allowed but visually distinguished from guaranteed restaurant options.

## 7. What Is OUT for MVP

Explicitly out — do not build, do not imply in UI copy:

| Out | Reason / replacement |
|---|---|
| Online payment / order submission to restaurants | Show-phone ordering only; no payment, no POS integration |
| Full personalization / recommendation engine | Onboarding + simple preference-aware ranking; no ML recommender |
| Price heatmaps, historical price graphs, price-change alerts | Median/percentile context only, where evidence exists |
| OpenSearch, H3 geo-indexing | PostgreSQL + PostGIS + full-text search first; revisit only with evidence |
| Real-time restaurant availability / inventory | Menus are observations at a point in time; staleness is shown, not hidden |
| Chatbot assistant as primary UX | NL search box only |
| Multi-city launch | HCMC D1/D3/Bình Thạnh seed only; architecture stays generic |
| Native mobile apps | Mobile-first responsive web |
| Social feed / following / messaging | Reviews only if ever built (Review deferred — see `domain-model.md` §4.14). Corrections stay in the Contribution workflow, never social. |
| Automated publishing of AI extractions | Human confirmation + moderation before publication |
| Unrestricted remote CSS/JS theming in admin | Versioned design tokens only |

## 8. Success Criteria (product)

- **Primary journey works end-to-end:** traveler scans a menu → understands dishes → selects an order → shows a bilingual summary to staff. (See `demo-scope.md`.)
- First action is discoverable in 15–30s with no documentation.
- No invented prices, options, ingredients, or restaurants anywhere in the UI.
- Every price shown carries its evidence state (observed / estimated / insufficient).
- Every dietary claim carries its evidence level (known / common / confirmed / unknown).
- A second traveler can reuse a contributed menu without re-scanning.
- Admin can change a resource, prompt, or template and publish without redeploying.

## 9. Confirmed vs. Assumption vs. Open Decision

### 9.1 Confirmed requirements

| # | Requirement | Source |
|---|---|---|
| C1 | EXECUTION_MODE = PLANNING until user explicitly authorizes BUILD | Master prompt §0 |
| C2 | Mobile-first, AI-native, no chatbot-first UX | Master prompt §1 |
| C3 | HCMC D1/D3/Bình Thạnh prototype; architecture must generalize | Master prompt §1 |
| C4 | Primary demo: scan → understand → select → bilingual order | Master prompt §11 |
| C5 | Schema-driven menu UI; no AI-generated executable code | Master prompt §2.6 |
| C6 | Order communication only; no payment/submission | Master prompt §2.7 |
| C7 | Prices as exact numerics + currency code; provenance + confidence required | Master prompt §4–5 |
| C8 | Dietary uncertainty must be explicit; absence ≠ safety | Master prompt §10 |
| C9 | Monorepo: Bun + Turborepo + TypeScript; TanStack Start preferred; Effect backend; PostgreSQL + Drizzle + PostGIS; S3-compatible storage | Master prompt §4 |
| C10 | Two frontends (customer + runtime studio), one domain backend, shared contracts | Master prompt §4 |

### 9.2 Reasonable assumptions (reversible, to confirm during BUILD kickoff)

| # | Assumption | Why it is safe to assume now |
|---|---|---|
| A1 | Customer app default languages: English + Vietnamese; staff view defaults to Vietnamese for HCMC seed | Matches geography; locale system generalizes |
| A2 | RESOLVED 2026-10-16 (ADR 0001): Better Auth + Google-only; guest-first customer (anonymous-plugin guests), admin = session + server-side RequireAdmin, Google never auto-grants admin. | Demo needs low friction; admin mutations still require auth |
| A3 | Seed data will be hand-curated + clearly labeled demo observations, not scraped | Avoids legal/quality risk; sufficient for demo |
| A4 | One backend deployment with domain modules, not microservices | Explicit constraint in master prompt §14 |
| A5 | Map tiles via an OSM-compatible provider with attribution (e.g. CARTO / OSM tile usage within terms) | MapLibre GL JS requirement; exact provider chosen at BUILD |
| A6 | AI provider behind an Effect service boundary; provider swappable | Master prompt §4.6 requires provider independence |

### 9.3 Open decisions (must resolve before / early in BUILD)

| # | Decision | Owner / timing | Impact if unresolved |
|---|---|---|---|
| O1 | AI provider(s) + model(s) for menu extraction vs. intent extraction (same or different?) | BUILD kickoff | Prompt registry + cost/latency assumptions |
| O2 | Exact map tile provider + rate-limit budget | BUILD kickoff | Map reliability in demo |
| O3 | RESOLVED 2026-10-16 (ADR 0001): Better Auth + Google; guest-first customer, admin via DB role + RequireAdmin. See `docs/auth.md`. | Before auth code | Blocks contribution + admin work |
| O4 | Single schema source of truth: Effect Schema vs. Zod (PoC required per master prompt §4.4) | Before shared contracts | Duplicate contracts across stack |
| O5 | Deployment targets (where backend, frontends, Postgres, R2 live) | Before infra work | Demo reproducibility |
| O6 | Moderation workflow depth for hackathon (manual review queue vs. auto-publish with flags) | Before contributions work | Trust + demo risk |
| O7 | Seed restaurant/dish dataset: how many, which sources, who curates | Before demo rehearsal | Demo credibility |
| O8 | Onboarding persistence: local-only vs. account-synced for demo | Before onboarding build | Scope of identity work |

## 10. Non-Goals

- Not a Google Maps clone (maps serve dish-first discovery, not general POI browsing).
- Not a generic AI chatbot.
- Not a restaurant SaaS / POS / delivery platform.
- Not a travel guide (no hotels, flights, itineraries).
- Not a nutrition / medical advice app (dietary info is informational with uncertainty, not medical guidance).

## 11. Related Documents

- `user-journeys.md` — behavior per journey, failure states.
- `demo-scope.md` — what the hackathon demo must and must not include.
- `customer-design.md` / `admin-design.md` — visual + interaction design.
- `architecture.md`, `domain-model.md`, `ai-boundaries.md`, `menu-rendering.md`, `data-provenance.md` — technical companions (same folder, owned by parallel planning workstreams).
