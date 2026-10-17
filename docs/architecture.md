# Traveevu — Architecture

> Status: PLANNING — no application code. `EXECUTION_MODE = PLANNING`.
> Repo: `Darkiee12/Traveevu` (verified empty: LICENSE + README.md only, default branch `master`).
> Geography (MVP): Ho Chi Minh City — District 1, District 3, Bình Thạnh. Architecture must not hardcode Vietnam-specific assumptions into shared domain logic.
> Last reviewed: 2026-10-16. Verified versions: Effect 4.0.0 stable (2026-10-01), TanStack Start 1.0 stable (2026-10-13), Drizzle 0.45.3 / drizzle-kit 0.31.11, Bun 1.4.x.

## 1. Coherence verdict

**One product — if the MVP is protected.**

The proposal is coherent only when read as one journey:

> Traveler enters an unfamiliar restaurant → scans its menu → understands dishes → selects an order → shows a bilingual order summary to staff.

Discovery, pricing, and personalization are **supporting layers** for that journey, not separate products. The failure mode to avoid is building four apps (a maps app + a chatbot + a price tracker + an admin CMS) that share a logo but no journey.

**Rule:** Every feature in M0–M3 must either (a) make the scan→order slice work, (b) let a second traveler reuse a scanned menu, or (c) let an operator keep scanned menus / prompts / templates correct. Anything else is deferred to M4+ and listed in the cut list in `roadmap.md`.

**What we are NOT building:**

- Not a generic AI chatbot. No chatbot-first navigation. AI sits behind cards, forms, bottom sheets, and bilingual summaries.
- Not a Google Maps clone. Map is a discovery aid, not the product.
- Not an online ordering / payment system. This is an **order communication assistant**. The restaurant needs no software, no account, no API. The UI must never imply the restaurant accepted an order.
- Not a microservices platform. One backend, domain-oriented modules (see §4).

## 2. System overview

```
┌────────────────────────────────────────────────────────────────────┐
│  Customer app (TanStack Start + React) — mobile-first            │
│  Onboarding · Discovery (dish-first) · Map · Menu scan →          │
│  Interactive menu → Bilingual order view · Contributions          │
├────────────────────────────────────────────────────────────────────┤
│  Runtime Management Studio / Admin (TanStack Start + React) — dense admin │
│  Resources · Prompts · Templates · Menus · AI Inspector · Appearance│
├────────────────────────────────────────────────────────────────────┤
│  Backend — ONE modular monolith (Effect)                           │
│  Domains: Catalog · Restaurants · Discovery · Personalization ·    │
│  Menus · Ordering · Pricing · Contributions · Identity · Resources │
│  · Prompt Registry · Template Registry · Administration            │
├────────────────────────────────────────────────────────────────────┤
│  PostgreSQL (+ PostGIS + JSONB + FTS) · S3-compatible storage      │
│  (R2: public bucket + private bucket) · OSM tiles via MapLibre    │
└────────────────────────────────────────────────────────────────────┘
```

### 2.1 Monorepo

- **Runtime:** Bun 1.4.x (package manager + runtime + test runner where it fits).
- **Orchestration:** Turborepo.
- **Language:** TypeScript 5.9+ strict (required by Effect 4.0.0). Node 18+ minimum where Node is involved.
- **Shape (proposed, to be confirmed in BUILD M0):**

```
traveevu/
  apps/
    customer/          # TanStack Start — public-facing, SSR + SEO
    admin/             # TanStack Start — runtime management studio (auth-gated)
    api/               # Effect backend (HTTP API, one deployable)
  packages/
    contracts/         # Effect Schema = Single Source of Truth (see §5)
    domain/            # Pure domain logic (no I/O): filtering, pricing stats, validation
    db/                # Drizzle schema + migrations + queries
    ai/                # AI task adapters (provider-agnostic interfaces)
    ui/                # Shared primitives ONLY where truly shared (do not force shared identity)
    config/            # tsconfig / eslint / shared tooling
  repos/               # Vendored read-only library source (see §8) — NEVER imported by prod code
  docs/                # This planning set + design docs
  AGENTS.md
```

- **Two independently deployable frontends, one backend.** Frontends talk to the backend over typed HTTP APIs derived from `packages/contracts`. No direct DB access from frontends. No frontend-to-frontend imports except via `packages/ui` primitives.
- **Prefer simplicity:** no separate BFF, no API gateway, no event bus, no microservices in MVP.

### 2.2 Frontend — TanStack Start

**Choice: TanStack Start 1.0 (stable 2026-10-13).** Next.js is the fallback only if a concrete technical reason emerges in M0 (e.g., a blocking incompatibility with a required library). Do not re-litigate without evidence.

**Security pin:** Require `@tanstack/react-start >= 1.168.60` (addresses CVE-2026-102989). Pin and verify in M0; add to dependency audit checklist.

Requirements met by this choice:

| Requirement | How |
|---|---|
| SSR | TanStack Start SSR |
| SEO-friendly public dish/restaurant pages | SSR + route-level meta, server-rendered canonical pages |
| Responsive / mobile-first | Mobile-first CSS, bottom sheets, large touch targets (≥44px) |
| Accessible | shadcn/ui primitives (Radix-based), focus management, semantic HTML |
| Type safety | End-to-end types from `packages/contracts` |
| Fast transitions | TanStack Query caching + Start routing |
| Loading / error states | Route-level pending/error boundaries, explicit empty states |

**Ecosystem (each must justify itself; do not install by popularity):**

- Tailwind CSS — styling.
- shadcn/ui + one consistent primitive library — accessible components.
- TanStack Query — server-state fetching/caching.
- TanStack Form — forms; accepts Standard Schema validators (see §5).
- Lucide — icons.
- Motion — animation (only where it aids comprehension, not decoration).
- MapLibre GL JS — maps. OSM-compatible tiles with attribution. Respect tile-provider terms/rate limits. **No Google Maps scraping.**

**Frontend boundaries:**

- Customer app: distinctive travel/food identity (see `customer-design.md`, to be written in planning). Not a generic dashboard.
- Studio (`apps/admin`): speed, density, clarity. Does **not** need to share the customer visual identity.
- Both frontends render menus through the **same renderer** (see `menu-rendering.md`). The studio preview must use the same underlying menu renderer as the customer app wherever practical.

### 2.3 Backend — Effect

**Choice: Effect 4.0.0 as the primary backend programming model.**

In Effect 4.0.0, packages are consolidated into a single `effect` package; all `@effect/*` packages share one version. Verify exact APIs against installed source in M0 — do not rely on memory or older tutorials.

**Use Effect for:** typed service dependencies (`Layer` / `Context`), explicit error modeling (typed errors, not thrown `any`), resource management (`Scope`), concurrency, retries, timeouts, composition of async operations, observability.

**Do NOT:** wrap every function in an unnecessary Effect layer, build generic abstraction layers that only forward calls, or invent a second framework on top of Effect. Keep modules small, explicit, and testable. Pure domain logic (filtering, price stats, validation) lives in `packages/domain` as plain functions where Effect adds no value; Effect orchestrates I/O at the edges.

**Domain modules (one backend, domain-oriented, NOT microservices):**

| Domain | Owns |
|---|---|
| Catalog | Dish, DishAlias, dish matching (variants live on `MenuItem.variantLabel`, no `DishVariant` table — ADR 0002; ingredients/allergens are validated values on `Dish`/`MenuItem`, no reference tables — ADR 0004) |
| Restaurants | Restaurant identity, location (PostGIS), attributes |
| Discovery | Search intent → ranked dishes/restaurants (deterministic ranking) |
| Personalization | UserPreference (incl. `tasteAnchors`, ADR 0005), recommendation inputs (explicit > demographic) |
| Menus | MenuSnapshot, MenuItem, MenuItemOption, extraction persistence, versioning |
| Ordering | OrderDraft, bilingual order view generation |
| Pricing | PriceObservation, price stats (median/percentiles), evidence rules |
| Contributions | Contribution state machine, moderation, provenance (Review deferred from MVP — future entity, see `domain-model.md` §4.14) |
| Identity | AuthN/AuthZ, roles, audit trail |
| Resources | MediaAsset / resource registry, object storage |
| Prompt Registry | PromptDefinition / PromptVersion, publishing, audit |
| Template Registry | MenuTemplate / MenuTemplateVersion, publishing |
| Administration | Studio workflows that cross domains (kept thin; delegates to domains) |

Within each domain, separate business logic, application workflows, persistence, and transport only where useful. Avoid global technical layers (`services/`, `repositories/` for everything) that obscure domain boundaries.

**Transport:** HTTP API (REST-style, typed via contracts). Keep the API surface minimal in MVP: menu scan submit, menu fetch, order draft, discovery search, contributions, studio CRUD for resources/prompts/templates/menus. No GraphQL, no tRPC in MVP unless M0 proves a concrete need.

### 2.4 Persistence — PostgreSQL

- **PostgreSQL** as primary DB. **Drizzle ORM + Drizzle Kit** (0.45.3 / 0.31.11) for schema + migrations.
- **PostGIS** for restaurant/dish location + distance filtering.
- **JSONB** for versioned, schema-validated blobs: prompt versions, template versions, menu presentation payloads, extraction payloads (with validated schemas — not untyped dumps).
- **PostgreSQL full-text search** for dish/restaurant search. **Do NOT introduce OpenSearch** unless search requirements provably exceed Postgres FTS in a measured test.
- **H3** is deferred. Consider only if geographic price aggregation provably needs it.
- **Migrations + explicit indexes.** Every query path used by the demo (nearby restaurants, dish lookup, menu-by-restaurant, price observations by dish+area) gets an index decided deliberately, not by default.
- **Money:** integer minor units end to end — Postgres `BIGINT amount_minor` + currency code; Effect Schema `Money = { amountMinor, currency }`; JSON `{ amountMinor, currency }`; integer-only frontend arithmetic (DECIDED 2026-10-16, review amendment; see `domain-model.md` §7 Q2, `typescript.md` Money boundary). Never `float`/`double`, never `numeric`, never `BigInt` on the wire. Always store `currency_code` + timestamp alongside amounts. MVP currency: VND; model must support others without redesign.
- **Timestamps:** store UTC; preserve both extraction timestamp and observed-menu timestamp where known (see `data-provenance.md`).

### 2.5 AI integration — provider-agnostic behind Effect services

See `ai-boundaries.md` for the full contract. Summary:

- One primary integration approach, selected after M0 PoC: **Effect AI vs Vercel AI SDK vs provider-native SDKs behind Effect services**. The implementation must support multiple providers without leaking provider-specific behavior into business domains.
- Each AI task has its own input/output contract: intent extraction, menu extraction, translation, dish matching, recommendation explanation, receipt extraction.
- Structured output via provider-native mode + **local re-validation**; one retry max, then surface uncertainty (see `ai-boundaries.md` §3).
- Every `AIExecution` records prompt version, model id, latency, tokens/cost if available, validation errors — no sensitive PII in logs.

### 2.6 Storage — S3-compatible

- **R2-compatible abstraction** (S3 API). Two logical buckets: **public** (display assets via stable resource IDs) and **private** (raw receipts, original menu images pending moderation, any PII-bearing evidence).
- Raw receipts: private by default, never publicly accessible. Menu images: private until published; published display assets served via public bucket + CDN/cache invalidation. Scan images are processed privately server-side (backend + AI provider) — processing is not publication; unsubmitted scan images live in temporary storage with a retention limit and are deleted if not submitted (see `data-provenance.md` §5.2).
- Stable resource identifiers: changing an image never requires frontend redeploy; metadata + mappings in Postgres, bytes in object storage (see §6).

### 2.7 Maps & search

- MapLibre GL JS + OSM-compatible tiles. Attribution required. Respect usage terms and rate limits.
- Initial seed data: permitted open data, curated records, clearly labeled demonstration observations only. No scraped data, no fabricated restaurants/prices.

### 2.8 Environments & deployability (MVP scope)

- Local dev: Bun + Turborepo + local Postgres (PostGIS) + local S3-compatible storage (or R2 dev bucket). One command to bring up the stack where possible; document it in `AGENTS.md` in BUILD.
- Frontends and backend deploy independently. No shared runtime state between them except Postgres + object storage.
- No Kubernetes, no multi-region, no custom infra in MVP. Prefer the simplest deployable that the hackathon allows.

## 3. Data flow — the primary slice (scan → order)

```
1. User photographs menu (customer app)
     → upload (validated: type, size) → private bucket + MenuSnapshot (draft)
2. AI menu extraction (provider structured output)
     → validated MenuSnapshot payload (unknown stays unknown)
     → AIExecution logged (promptVersion, model, latency, tokens, validation)
3. User confirms / corrects extraction (customer app)
     → corrections create a NEW observation/version, never silent overwrite
4. Presentation build (template + snapshot → MenuPresentation, validated)
     → renderer maps nodes → known React controls
5. User selects items / sizes / modifiers / quantities / notes
     → OrderDraft (user-private, never in shared snapshot)
     → deterministic total math from menu data only
6. Bilingual order view (customer lang + original VN names/modifiers)
     → user shows phone to staff. No order submission, no payment.
7. (If eligible + confirmed) Contribution
     → menu observation enters moderation → published menu reusable by next traveler
```

Each arrow is a validated contract boundary. See `menu-rendering.md` and `data-provenance.md`.

## 4. Module dependency rules

- `packages/contracts` depends on nothing in the repo (only Effect Schema / Standard Schema). Everything else may depend on it.
- `packages/domain` depends only on `contracts` + stdlib. No I/O, no DB, no HTTP, no AI SDKs.
- `packages/db` depends on `contracts` + Drizzle. No AI, no HTTP.
- `packages/ai` depends on `contracts` + provider SDK(s) behind interfaces. No DB, no HTTP routing.
- `apps/api` composes all of the above via Effect Layers.
- `apps/customer` / `apps/admin` depend on `contracts` (+ `ui` primitives). They never import `db` or `ai` directly.
- **`repos/` is never imported.** It is read-only reference source only (see §8).

Violation = architectural drift. Reviewers check imports in PR review (see `roadmap.md` M0 acceptance).

## 5. Single Source of Truth — Effect Schema owns contracts

**Decision (locked): Effect Schema owns shared contracts. Zod v4 only where a boundary requires it, via Standard Schema interop. NO duplicate schemas.**

Rationale:

- One definition per contract, enforced by types + runtime decode.
- Effect Schema supports JSON Schema conversion (needed for provider structured output) and Standard Schema interop (needed for TanStack Form + other validators).
- Duplicating every contract in both Effect Schema and Zod guarantees drift: one side changes, the other silently accepts invalid data.

Rules:

1. Define each contract once in `packages/contracts` as Effect Schema.
2. Derive JSON Schema from Effect Schema for provider structured-output calls. Do not hand-write a second schema for the same payload.
3. Where a library requires Zod (or another validator), adapt via Standard Schema — do not redefine fields.
4. TanStack Form accepts Standard Schema validators; wire Effect Schema through that path.
5. API validation, AI output validation, and DB-boundary validation all decode through the same contract.

**M0 proof-of-concept (blocking):** Before committing, prove the round-trip — Effect Schema → JSON Schema → provider structured output (at least one provider) → local decode with Effect Schema — works for the menu-extraction contract. If it fails, revisit: either fix the conversion or narrow the contract. Do not proceed to BUILD with two parallel schema systems. See `roadmap.md` M0.

## 6. Runtime Management Studio — storage & publishing model

Full design in `roadmap.md` / studio planning docs. Summary of the storage decisions (locked):

| Registry | Live persistence | Authoring / seed format | Versioning |
|---|---|---|---|
| Resources | Postgres metadata + mappings; bytes in object storage; stable resource IDs | — (upload + metadata form) | Asset replacement = new object + metadata update + cache invalidation; old IDs remain resolvable where referenced |
| Prompts | Postgres JSONB (`PromptDefinition` + `PromptVersion`), validated | YAML/JSON seed files only | Draft → published → rollback; published versions immutable; every execution records version |
| Templates | Postgres JSONB (`MenuTemplate` + `MenuTemplateVersion`), validated | YAML/JSON seed files only | Same as prompts; new executable component still requires code change |

**Invariants:**

- YAML is an authoring/seed format, **never** the live persistence mechanism.
- Published prompts/templates never bypass validated output contracts. Publishing runs the same validation as execution.
- Changing an image / prompt / template never requires frontend redeployment.
- Cache invalidation is keyed by version: presentation cache key = `(restaurantId, snapshotVersion, templateVersion)`. Publishing a new template version invalidates derived presentations; it never mutates stored snapshots.
- Audit history is append-only: who published what, when, from which draft.
- No unrestricted remote CSS/JS execution. Appearance config is a versioned set of design tokens + resource references, mapped to known code. A completely new executable component requires a code change + deploy.

See `menu-rendering.md` §6 for template migration + cache rules, and `data-provenance.md` for audit/provenance.

## 7. Security & privacy — architectural posture

(Detail in `data-provenance.md` §5 + studio docs. Architectural points:)

- Validate uploads (type, size, dimensions) at the edge before AI/processing. Reject, don't sanitize-and-hope.
- Separate public/private media at the bucket level, not by filename convention.
- AuthN required for all privileged actions; AuthZ enforced on **every** admin mutation (server-side, not UI-only).
- Audit trails for admin mutations + prompt/template publishes + moderation decisions.
- Menu images, reviews, user input = untrusted. Never interpolate them into prompts as instructions. Prompt-injection defenses in `ai-boundaries.md` §5.
- No arbitrary executable code in dynamic templates (see §6, `menu-rendering.md`).
- No unnecessary PII storage. No PII in AI logs. Receipt images private by default; redact PII before any wider use.
- Dietary safety is a data-modeling constraint, not a copywriting fix — see `domain-model.md` §5 and `data-provenance.md` §4.

## 8. Library source availability (Effect git-subtree trick)

Follow the approach described in the Effect blog post *"The One Weird Git Trick That Makes Coding Agents More Effect-ive"* (summarized here, not copied):

- Vendor pinned dependency source into a **read-only reference directory** (`repos/`) using git subtree (with `--squash`), so agents can inspect real APIs and idiomatic usage instead of guessing from training data.
- **Never import production code from `repos/`.** It is reference only.
- **Never modify vendored source.**
- Align vendored versions with installed package versions. When the installed version changes, re-vendor.
- Exclude `repos/` from editor search / indexing where possible to avoid confusion.
- Do not assume the blog post reflects the newest Effect release — verify against Effect 4.0.0 docs + installed source in M0.

Apply the same pattern sparingly to other high-risk libraries only if justified (e.g., TanStack Start internals). Do not vendor the whole internet.

## 9. What is deliberately NOT in the architecture (cut / deferred)

| Item | Decision |
|---|---|
| Microservices / event bus / message queue | No. One backend, in-process modules. |
| OpenSearch / Elasticsearch | No. Postgres FTS first; measure before adding. |
| H3 geospatial indexing | Deferred. PostGIS first. |
| GraphQL / tRPC | No in MVP. Typed REST via contracts. |
| Real-time collaboration / websockets | No. |
| Payment / order submission to restaurants | Never in scope (communication assistant only). |
| Chatbot-first UI / free-form chat | No. Structured UI + AI behind it. |
| AI-generated JSX/HTML/JS | Forbidden (see `menu-rendering.md`). |
| Remote CSS/JS execution | Forbidden. |
| Google Maps / scraping | Forbidden. OSM + MapLibre only. |
| Duplicate Zod + Effect Schema contracts | Forbidden (see §5). |
| Generic universal JSON table for all entities | Forbidden (see `domain-model.md`). |
| Price heatmaps / historical graphs / regional comparisons | Future extensions, not MVP. |
| Multi-city launch | Architecture supports it; MVP seeds HCMC only. |

## 10. Open questions & risks (architecture-level)

1. **Effect AI vs Vercel AI SDK vs provider-native SDKs** — decided by M0 PoC (structured-output round-trip + Effect interop). Risk: picking before PoC locks in the wrong adapter.
2. **TanStack Start 1.0 + Effect Schema + TanStack Form interop** — verify Standard Schema path in M0; fallback is thin adapter, not duplicate schemas.
3. **Drizzle + PostGIS + JSONB ergonomics** — confirm migration + query patterns in M0; PostGIS types need explicit handling.
4. **Tile provider for production** — choose an OSM-compatible provider with acceptable terms/rate limits before demo; document attribution.
5. **AI provider(s) for demo** — at least one provider with reliable structured output; multi-provider support is an interface goal, not a demo requirement to call all providers.
6. **Auth provider** — RESOLVED 2026-10-16 (ADR 0001): Better Auth,
   one instance in the Effect backend, Google-only OAuth. Guest-first
   customer; admin = session + server-side `RequireAdmin`. Google
   sign-in never grants admin. Full design: `docs/auth.md`. M0 PoC
   must still prove the Effect mount, claim, and admin negative test.
7. **Seed data licensing** — verify every seed record is permitted open data / curated / clearly labeled demo data. No scraped menus.

## 11. Document map

- `domain-model.md` — entities, invariants, ER sketch.
- `ai-boundaries.md` — what AI may/may not do, contracts, retry/validation, injection defenses.
- `menu-rendering.md` — extraction → presentation → renderer → order, control registry, template migration, cache.
- `data-provenance.md` — evidence vs fact, confidence, moderation, privacy, dietary safety.
- `roadmap.md` — M0–M6, acceptance criteria, cut list, risks.
