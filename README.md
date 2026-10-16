# Traveevu — Planning Pack (PLANNING mode)

> **EXECUTION_MODE = `PLANNING`**
>
> This pack contains planning, architecture, and harness documentation only.
> **Write no application code** until the user explicitly authorizes `BUILD`
> and implementation is permitted under hackathon rules.
> The upstream repo `Darkiee12/Traveevu` (default branch `master`) currently
> contains only `LICENSE` + `README.md` — no code yet. That is intentional:
> this pack must land first, be reviewed, and only then unlock `BUILD`.

**What Traveevu is, in one sentence:** a mobile-first, AI-native food
discovery and ordering companion that helps a traveler in an unfamiliar
food environment discover what to eat, understand dishes and menus,
compare local prices, and communicate an order to staff without needing
the local language — starting in Ho Chi Minh City (District 1, District 3,
Bình Thạnh) and architected for other cities, currencies, and languages.

## How to use this pack

| File | Purpose |
|------|---------|
| `README.md` (this file) | Entry point: critical review, architecture, repo structure, library list, roadmap pointer, blocking questions |
| `AGENTS.md` | Short root instructions for every agent working in the repo |
| `docs/agent-workflow.md` | Multi-agent harness: contracts-first, workstreams, task/report templates, integration review |
| `docs/development/effect.md` | Effect 4 backend conventions |
| `docs/development/typescript.md` | TypeScript + contract + money/time conventions |
| `docs/development/frontend.md` | TanStack Start frontend conventions |

Companion product/architecture docs (product, user journeys, demo scope,
domain model, AI boundaries, menu rendering, data provenance, customer /
admin design) are **not** in this pack — they are produced as a separate
deliverable set in `PLANNING` and must agree with the decisions here.
If they disagree, this pack's contract-ownership and safety rules win
until explicitly amended.

---

## Critical review — answers to the 10 first-assignment questions

### 1. Is the proposed system coherent, or are we combining too many separate products?

**Coherent — but only if one journey is protected.** The features look
like several products (discovery app + menu scanner + ordering assistant +
price intelligence + admin studio), but they share one spine: **a menu
observation becomes structured data, which becomes a reusable interactive
menu, which becomes a bilingual order.** Every feature either feeds that
spine (scan → extraction → contribution → reuse) or reads from it
(discovery, price context, dietary warnings).

The coherence risk is real: personalization, price heatmaps, historical
price graphs, community reviews, and a full runtime studio could each
swallow the hackathon. The guardrail is the MVP priority in §11 of the
master prompt: the demo is *scan → understand → select → show bilingual
order*. Everything else is P2–P4 and must not displace that slice.
Admin/studio features exist to make the demo operable and debuggable
(publish a prompt, fix a menu, preview a render), not to become a
second product. If a feature does not serve the scan-to-order spine or
make it demonstrably more trustworthy, it is cut or deferred.

### 2. What is the smallest domain model that supports menu scanning, interactive ordering, and menu reuse?

Nine concepts carry the slice; everything else is a value object, a
field, or a later extension:

| Concept | Role |
|---|---|
| `Restaurant` | Identity + location (PostGIS point) + locale. No menu data embedded. |
| `MenuSnapshot` | One observation of one restaurant's menu at one time: source image ref, observed-at, extraction confidence, status (`draft` → `published` / `rejected`), supersedes link. Never mutated in place — new scan = new snapshot. |
| `MenuItem` | One row inside a snapshot: original name (verbatim), translated name, description, category, price (minor units + currency), size/options. Belongs to exactly one snapshot. |
| `MenuItemOption` | A documented size / modifier / choice group on a `MenuItem`. Only options present in the evidence exist. No invented options. |
| `Dish` | Canonical, restaurant-independent dish (e.g. Cơm tấm): canonical name, aliases, ingredients (known vs. common), allergens, dietary notes, origin, flavor/texture. Linked from `MenuItem` by a nullable, confidence-scored mapping — mapping is a guess, never a fact. |
| `PriceObservation` | One price evidence event: source type (`menu-listed` vs `receipt-paid`), amount, currency, dish/menu-item ref, observed-at, confidence. Listed ≠ paid; keep them distinct. |
| `Contribution` | The provenance wrapper for a user-submitted scan/receipt/correction: who (pseudonymous; anonymous evidence submissions allowed, `pending_review`, never auto-published — ADR 0003), what, source refs, status, moderation decision. Owner FK nullable (`ON DELETE SET NULL`) + immutable attribution snapshot so contributions survive anonymous-user deletion. Private profile/order data is never part of it. |
| `OrderDraft` | Ephemeral, user-private selection state: snapshot ref + chosen items/options/quantities + free-text notes (flagged as unconfirmed) + estimated total. Never stored inside a shared snapshot. |
| `AIExecution` | Audit record for one AI call: task, prompt version, model id, input refs (not raw PII), output validation result, latency, token/cost if available. |

Deliberately **not** first-class tables in the MVP: `DishVariant`
(a row on `Dish` / `MenuItem` with a `variant` label until variants prove
they need their own lifecycle), `Ingredient` / `Allergen` as standalone
registries (start as validated value objects on `Dish`; promote only if
cross-dish querying demands it), `Review` (defer unless demo needs it),
`FavoriteDish` (a preference value on the user profile, not a join-heavy
entity yet). `UserPreference` is a single versioned profile document per
user (JSONB under a schema), not a normalized preference graph.

### 3. Which parts genuinely require AI, and which should be deterministic?

**AI — interpretation and explanation only:**

- Natural-language intent → structured search intent (constraints, dish
  hints, budget, exclusions). AI proposes; deterministic code enforces.
- Menu/receipt image → structured extraction (names, prices, categories,
  options). AI proposes; schema validation + user confirmation decide.
- Translation of names/descriptions/special requests (with original
  preserved alongside).
- Dish matching: menu-item name → candidate canonical `Dish` (scored
  candidates; human/admin confirms, never auto-merges silently).
- Recommendation explanations ("similar to X you like because grilled,
  smoky, …") — prose grounded in structured dish attributes.

**Deterministic — everything that affects safety, money, or truth:**

- Hard-constraint enforcement (dietary exclusions, allergen flags,
  budget ceiling, distance, availability). An LLM never overrides these.
- Price math: totals, ranges, medians/percentiles, currency handling.
  Integer minor units only; no float, no LLM arithmetic.
- Dietary safety verdicts: only *known / common / confirmed / unknown*
  evidence tiers (see §10 of master prompt). Absence of evidence is
  never evidence of safety.
- Form validation, template resolution, rendering, ordering rules,
  versioning, moderation state transitions.
- Search ranking *combination*: deterministic scoring over structured
  signals; AI may supply a relevance feature, never the final sort alone.

Rule of thumb: **if a wrong answer costs money, health, or trust, it is
deterministic. If a wrong answer costs only relevance or phrasing, AI may
propose it inside a validated contract.**

### 4. How should Effect, PostgreSQL, Drizzle, TanStack Start, and shared contracts fit together?

```
┌─────────────────── apps/ (TanStack Start, SSR) ───────────────────┐
│ customer app ──► BFF / API routes ──► packages/contracts (Schema)   │
│ admin app    ──► same contracts, admin-only routes                  │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ JSON over HTTP, Schema-validated both ends
┌─────────────────── apps/api (Effect) ──────────────────────────────┐
│ HttpApi endpoints → domain workflows (Effect) → repositories (Drizzle)│
│ AI tasks behind Effect services (provider-swappable adapters)       │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ Drizzle ORM + migrations (Drizzle Kit)
┌─────────────────── PostgreSQL + PostGIS ───────────────────────────┐
│ normalized domain tables + JSONB for versioned config/snapshots     │
│ full-text search + PostGIS distance; NO OpenSearch in MVP            │
└─────────────────────────────────────────────────────────────────────┘
```

- **One backend, domain-oriented modules** (`apps/api/src/domains/*`).
  No microservices. Effect is the programming model inside the backend;
  it does not leak into the frontends except through the shared contracts.
- **Contracts own the boundary.** `packages/contracts` defines every
  API request/response, AI task input/output, menu extraction schema,
  presentation schema, and order representation exactly once, in
  **Effect Schema** (see `docs/development/typescript.md` — no duplicate
  Zod schemas). Frontends and backend import the same definitions;
  TanStack Form consumes them via Standard Schema interop.
- **Drizzle is the only persistence mapper.** Drizzle schemas live next
  to their domain; Drizzle Kit owns migrations. Repositories are thin:
  query + map to domain types. No repository may call AI or HTTP.
- **TanStack Start apps are thin.** Routes load via TanStack Query
  against the Effect API, render schema-driven UI, and hold only
  presentation state. Business rules live in the backend or in shared
  pure functions in `packages/*`, never duplicated in components.
- **PostgreSQL does the heavy lifting** it is good at: relational
  integrity, JSONB for versioned snapshots/templates/prompts, PostGIS
  for "nearby", full-text search for dish/restaurant search. H3,
  OpenSearch, and caches beyond HTTP/CDN are deferred until measured
  need.

### 5. How should the runtime management studio store and publish resources, prompts, and templates?

One pattern for all three registries: **versioned draft → validated →
published → audited**, with the *published version pointer* as the only
thing the customer path reads.

| Registry | Storage | Publish rule |
|---|---|---|
| Resources (images, banners, icons, localized content) | Binary in S3-compatible object storage (public vs private buckets); metadata + stable resource id + aliases in PostgreSQL | Swapping a resource id's target is a new version; frontends resolve ids at request/render time + cache invalidation by id+version. No redeploy. |
| Prompts | `PromptDefinition` + `PromptVersion` rows: versioned text, model selection, parameters, variable list, input/output schema refs, status (`draft`/`published`/`retired`), audit trail | Publishing requires: schema refs resolve, fixture tests pass, previous published version retained for rollback. AI executions record `promptVersionId` + `modelId`. Published prompts can never bypass output-contract validation. |
| Menu templates | Authored as YAML/JSON (seed + admin editor), stored as **validated JSONB** in PostgreSQL (`MenuTemplate` + `MenuTemplateVersion`): layout id, allowed controls, display/validation/ordering rules, localized strings, visual config, status | Publishing requires: control ids all exist in the supported-control registry, JSON Schema / Effect Schema validation passes, render-preview fixture passes. A new published template version invalidates presentation cache for menus using that template (by template id + version key, not by TTL alone). |

Admin mutations are authenticated + authorized, audited (who, when,
before/after version), and reversible (rollback = repoint the published
pointer, never rewrite history). No registry may store executable code:
templates reference component ids from a fixed renderer registry;
prompts are data, never evaluated as code; resources are binary + metadata.

### 6. What is the correct boundary between menu extraction data, templates, generated presentations, and user order state?

Four layers, four owners, one direction of flow:

1. **Extraction data** (`MenuSnapshot` + `MenuItem`s) — *evidence*.
   Owned by the Menus domain. Immutable once published; corrections
   create a new snapshot version. Contains only what was observed
   (unknown stays `null`/`unknown`, with confidence). Never contains
   user preferences or order state.
2. **Template** (`MenuTemplateVersion`) — *presentation rules*.
   Owned by the Template Registry. Declares which controls/layouts may
   be used and how. Contains no restaurant data and no user data.
3. **Generated presentation** (`MenuPresentation`) — *derived view*.
   Pure function: `presentation = render(snapshot, template, locale,
   userDietaryFlags)`. It is cacheable, version-keyed by
   `(snapshotId, templateVersionId, locale)`, and regenerable at any
   time. It is **not** stored as the source of truth; storing it is an
   optimization with an invalidation rule, not a new entity. Dietary
   warnings here are *derived annotations*, computed deterministically
   from dish evidence tiers — never baked into the snapshot.
4. **Order state** (`OrderDraft`) — *private user selection*.
   Owned by the Ordering domain, keyed to the user + snapshot. Holds
   chosen items/options/quantities, free-text notes (marked
   unconfirmed), and a computed estimated total. It references the
   snapshot; it never mutates it. The bilingual staff view is a
   read-only rendering of the draft (user locale + restaurant locale
   side by side), clearly labeled as a *request to communicate*, not a
   confirmed order.

Crossing the boundary the wrong way is a bug: user prefs inside a
snapshot, template ids invented by AI, prices computed by the LLM, or
order state persisted in shared menu data are all rejected in review.

### 7. Which dependencies or features are unnecessary for the hackathon?

**Rejected dependencies** (see full table in "Recommended library list"):

- **Next.js** — no concrete advantage over TanStack Start for this
  stack (TanStack Router/Query/Form coherence, SSR/SEO already covered).
- **OpenSearch / Elasticsearch** — Postgres full-text + PostGIS cover
  hackathon search volume; adding a second search index is pure overhead.
- **H3** — only if geographic price aggregation proves it needs it;
  PostGIS aggregation is enough for the demo.
- **Prisma** — Drizzle is lighter, SQL-first, and fits Effect +
  migrations better; two ORMs is never justified.
- **Microservices / message queues / event bus** — one Effect backend,
  direct calls, no distributed-systems tax.
- **Zod as a second schema system** — Effect Schema owns contracts;
  Zod only via Standard Schema interop if a library demands it, never
  hand-duplicated.
- **AI-generated JSX / HTML / executable components** — forbidden.
  Schema-driven renderer only.
- **Remote CSS/JS execution, arbitrary template code** — forbidden.
- **Heavy auth platform / paid services** — minimal session auth for
  admin + optional user accounts; anonymous demo flow must work.

**Deferred features** (explicitly not in the MVP slice): price heatmaps,
historical price graphs, regional price comparison, receipt-based price
authority, community reviews/ratings, full personalization engine,
multi-city seed data beyond HCMC districts, offline mode, restaurant
accounts / order submission / payments. Each is architecturally
*possible* (the domain model leaves room) but none may displace the
scan-to-order demo.

### 8. How should the multi-agent harness be organized to prevent architectural drift?

See `docs/agent-workflow.md` for the full harness. The anti-drift
mechanisms, in order of strength:

1. **Contracts first, code second.** No parallel implementation until
   `packages/contracts` (Effect Schema) for the slice is merged and
   reviewed. Shared files have a single owner; others read, never edit
   without coordination.
2. **One source of truth per contract** (Effect Schema). Drift is
   usually duplicate schemas; banning duplicates removes the main
   drift vector.
3. **Worktrees / isolation per workstream**, with small, reviewable
   diffs merged incrementally — never a big-bang merge at the end.
4. **Task contracts + report templates** for every delegation
   (objective, owned files, contracts, acceptance criteria, verification
   commands). "Implemented successfully" without diff + tests is not
   accepted.
5. **Orchestrator-owned integration.** The lead agent (Muse) inspects
   every diff, runs checks, verifies contract compatibility, and owns
   cross-workstream integration points. Workstream agents never
   integrate each other's work unilaterally.
6. **Persistent context in repo files** (`docs/decisions/*.md`,
   milestone plans), not chat history. An agent must be able to resume
   from files alone.
7. **Vendored library reference** (`repos/`, read-only, git-subtree
   `--squash`) so agents read real Effect/TanStack APIs instead of
   hallucinating them — and never import production code from it.

### 9. Which decisions must be made before implementation, and which can safely wait?

**Decide now (blocking BUILD):**

- Schema ownership: Effect Schema is the single source of truth.
- Money = integer minor units + currency code; timestamps =
  `timestamptz`; PostGIS for location. (Non-negotiable; retrofitting
  is expensive.)
- Snapshot immutability + versioning; listed vs. paid price distinction;
  dietary evidence tiers (known / common / confirmed / unknown).
- Extraction → template → presentation → order boundary (§6 above).
- No AI-generated executable UI; fixed control registry.
- Monorepo shape, package boundaries, and who owns shared files.
- AI provider + budget + key custody (see Blocking questions).
- Auth model for admin + whether demo users need accounts at all.
- The blocking questions in the table below — each names what unblocks it.

**Safely defer (decide during BUILD, defaults given):**

- Exact dish taxonomy / full HCMC seed dataset (seed a small curated
  set; taxonomy evolves with real scans).
- Full personalization ranking formula (start: hard filters + simple
  preference-boost scoring; tune after demo works).
- Price aggregation statistics (start: median + p25/p75 + n + warning
  when n is small; heatmaps/graphs later).
- Prompt wording / model choice per task (registry makes these
  runtime-changeable; pick sane defaults, iterate on fixtures).
- Design-token values (structure of tokens is fixed; values are
  runtime-configurable).
- Caching strategy beyond HTTP/CDN + version-keyed presentation cache
  (add only on measured slowness).
- H3, OpenSearch, queues, multi-region deployment (only on evidence).

### 10. What implementation order gives us the highest probability of producing an excellent mobile-first demo?

Order by **demo-critical path first, with contracts before code**:

1. **M0 — Skeleton + contracts.** Monorepo, tooling, CI checks,
   `packages/contracts` for menu snapshot / presentation / order draft.
   *Exit:* `bun install && turbo run check` green; contract package
   compiles; no app code yet.
2. **M1 — Menu extraction vertical slice (backend).** Upload →
   AI extraction (one task, one prompt version) → schema validation →
   snapshot persistence → admin review screen (list + correct + publish).
   *Exit:* a real menu photo becomes a validated, publishable snapshot.
3. **M2 — Schema-driven renderer + interactive menu.** Template
   registry (one template), presentation derivation, quantity /
   choice / note controls, dietary annotations, estimated total.
   *Exit:* published snapshot renders as an interactive menu on mobile.
4. **M3 — Bilingual order view.** OrderDraft → bilingual staff page
   (user locale + Vietnamese originals), clearly a communication aid.
   *Exit:* end-to-end demo works on a phone: scan → confirm → select →
   show staff. **This is the demo gate — protect it.**
5. **M4 — Menu reuse + versioning.** Second visit reuses published
   snapshot; new scan diffs against existing; version history visible
   in admin. *Exit:* no re-scan needed for a known restaurant.
6. **M5 — Discovery (dish-first).** Dish pages (SSR/SEO), search,
   map with dish/distance/price/dietary filters, restaurant pages.
   *Exit:* a dish page links to nearby restaurants serving it.
7. **M6 — Personalization + price intelligence.** Onboarding (≤5
   favorite dishes), preference-aware ranking, median/p25/p75 price
   context with evidence warnings. *Exit:* "spicy beef under 100k,
   not soup" returns ranked, constraint-honest results.
8. **M7 — Contributions + studio hardening.** Receipts, corrections,
   resource/prompt registries, AI inspector, appearance tokens.
   *Exit:* admin can operate the demo without code changes.

Parallelize only after M0 contracts are stable (see
`docs/agent-workflow.md`): customer UX owns M2–M3 UI, domain/backend
owns M1/M4 persistence, AI pipeline owns extraction quality + fixtures,
data/admin owns M4/M7 studio. Never parallelize M0.

---

## Recommended architecture

**One TypeScript monorepo (Bun + Turborepo) holding two TanStack Start
frontends (customer + admin), one Effect backend organized by domain,
one shared Effect Schema contract package, PostgreSQL + PostGIS + JSONB
as the only database, and S3-compatible object storage for media — with
AI accessed only through provider-swappable Effect services behind
per-task input/output contracts, and all runtime-configurable content
(prompts, templates, resources, design tokens) stored as versioned data
in PostgreSQL rather than in code or redeploys.**

```
                    ┌─────────────────────────────────────┐
                    │  Customer app (TanStack Start)    │  mobile-first,
                    │  Admin app    (TanStack Start)    │  SSR/SEO, maps
                    └──────────────┬──────────────────────┘
                                   │ HTTP + Effect Schema JSON
                    ┌──────────────▼──────────────────────┐
                    │  Effect API (apps/api)              │
                    │  domains: catalog · restaurants ·  │
                    │  discovery · menus · ordering ·    │
                    │  pricing · contributions · identity │
                    │  resources · prompts · templates ·  │
                    │  admin · personalization            │
                    │  AI services: intent · extraction · │
                    │  translation · matching · explain  │
                    └──────────────┬──────────────────────┘
                                   │ Drizzle ORM
              ┌────────────────────▼────────────────────┐
              │  PostgreSQL + PostGIS + JSONB + FTS    │
              │  S3-compatible storage (R2)             │
              └─────────────────────────────────────────┘
```

Key invariants: AI never invents restaurants, prices, options, or
safety verdicts; money is integer minor units; snapshots are immutable
observations; templates are data, not code; order state is private.

---

## Proposed repository structure

```
traveevu/                                  # repo root (Darkiee12/Traveevu)
├── AGENTS.md                              # root instructions (from this pack)
├── README.md                              # product + setup (from docs/product.md)
├── package.json                           # bun workspaces + turbo scripts
├── turbo.json
├── bun.lockb
├── tsconfig.base.json
├── .env.example                           # NO secrets; names only
├── docs/
│   ├── product.md
│   ├── user-journeys.md
│   ├── demo-scope.md
│   ├── architecture.md                    # deepens this README
│   ├── domain-model.md
│   ├── ai-boundaries.md
│   ├── menu-rendering.md
│   ├── data-provenance.md
│   ├── customer-design.md
│   ├── admin-design.md
│   ├── agent-workflow.md                  # from this pack
│   ├── decisions/                         # ADRs: 0001-schema-ownership.md, …
│   ├── development/
│   │   ├── effect.md                      # from this pack
│   │   ├── typescript.md                  # from this pack
│   │   └── frontend.md                    # from this pack
│   └── milestones/
│       ├── M0-contracts.md
│       ├── M1-extraction.md
│       └── …                              # one file per milestone
├── repos/                                 # READ-ONLY vendored lib source
│   ├── effect/                            # git subtree --squash, pinned
│   └── tanstack/                          # (only if needed; keep small)
├── packages/
│   ├── contracts/                         # ★ single source of truth
│   │   └── src/                           # Effect Schema: api, ai, menu,
│   │       │                              # presentation, order, admin
│   │       └── index.ts
│   ├── domain/                            # pure domain funcs (no I/O):
│   │   └── src/                           # pricing, dietary tiers, matching
│   ├── ui/                                # shared primitives (shadcn-based)
│   └── config/                            # tsconfig/eslint/tailwind presets
├── apps/
│   ├── api/                               # Effect backend (one service)
│   │   └── src/
│   │       ├── index.ts                   # HttpApi serve + Layers
│   │       ├── domains/                   # one dir per domain
│   │       │   ├── catalog/
│   │       │   ├── menus/
│   │       │   ├── ordering/
│   │       │   └── …/
│   │       ├── ai/                        # task services + provider adapters
│   │       ├── db/                        # Drizzle schema + migrations
│   │       └── lib/                       # config, logging, errors
│   ├── customer/                          # TanStack Start: traveler app
│   │   └── src/
│   │       ├── routes/                    # dishes, restaurants, menu, order
│   │       ├── components/                # renderer + cards + map + sheets
│   │       └── lib/
│   └── admin/                             # TanStack Start: studio
│       └── src/
│           ├── routes/                    # menus, prompts, templates, resources
│           ├── components/
│           └── lib/
├── skills/                                # repo-local agent skills (only if justified)
├── fixtures/                              # AI eval fixtures (menus, receipts, queries)
└── scripts/                               # seed, demo reset, checks
```

Ownership: `packages/contracts` — orchestrator + domain/backend agent
jointly, single-owner-at-a-time; `apps/api` — domain/backend;
`apps/customer` — customer UX; AI services + `fixtures/` — AI pipeline;
`apps/admin` + registries — data/admin. Cross-boundary edits require
orchestrator approval (see `docs/agent-workflow.md`).

---

## Recommended library list

Pinned versions are **verified as of 2026-10-16**. Re-verify at `BUILD`
start; if a pin moved, update this table + `docs/decisions/` rather than
silently drifting.

| Library | Pin | Reason |
|---|---|---|
| Bun | `1.4.x` | Fast runtime + package manager + workspaces; single toolchain for monorepo |
| Turborepo | `2.x` | Task caching/orchestration across apps + packages |
| TypeScript | `5.9+`, `strict` | Required by Effect 4; strict catches contract drift early |
| Effect | `4.0.0` (stable 2026-10-01) — **all `@effect/*` pinned to the same version** | Typed services, tagged errors, Layers, retries/timeouts, observability; consolidated packages in v4 |
| `@effect/schema` (via Effect 4) | `4.0.0` | Single contract owner; Standard Schema interop |
| Drizzle ORM | `0.45.3` | Lightweight, SQL-first, excellent Postgres/PostGIS/JSONB support |
| Drizzle Kit | `0.31.11` | Migrations + schema management |
| PostgreSQL | `16+` with PostGIS | Relational + JSONB + FTS + geo in one store |
| TanStack Start | `1.0` stable (2026-10-13); **`@tanstack/react-start >= 1.168.60`** (CVE-2026-102989) | SSR + SEO + file routing; coherent with Router/Query/Form |
| TanStack Router / Query / Form | matching Start 1.0 peer range | Routing, server state, Standard-Schema forms; one ecosystem, fewer seams |
| Tailwind CSS | latest v4 stable | Utility styling; pairs with shadcn |
| shadcn/ui | latest (component source, not a versioned dep) | Accessible primitives, owned source |
| Lucide | latest stable | Icon set |
| Motion | latest stable | Animation (formerly Framer Motion) |
| MapLibre GL JS | latest stable | OSM-compatible maps, no Google scraping |
| AI provider SDK | **TBD — see Blocking questions** (behind Effect service interface; Vercel AI SDK *or* provider-native SDK *or* Effect AI — decide after Effect 4 compat check) | Provider-swappable; business code never imports a provider SDK directly |
| `@effect/vitest` | matching Effect 4 | Effect-native testing |
| Playwright | latest stable | Mobile-journey browser tests |

### Rejected — and why

| Rejected | Why |
|---|---|
| Next.js | No concrete technical reason it beats TanStack Start here; TanStack coherence (Router/Query/Form/Start) reduces integration seams. Reconsider only on a concrete, evidenced reason. |
| OpenSearch / Elasticsearch | Postgres FTS + PostGIS cover hackathon search; second index = ops + sync burden with zero demo benefit. |
| H3 | Only if geo price aggregation outgrows PostGIS; defer until measured. |
| Prisma | Drizzle fits Effect + SQL-first migrations better; two ORMs never justified. |
| Microservices / queues / event bus | One Effect backend; distributed-systems tax buys nothing at hackathon scale. |
| Zod as a parallel schema system | Duplicate schemas are the #1 drift vector. Effect Schema owns contracts; Zod only via Standard Schema interop if a library forces it. |
| AI-generated JSX / HTML / components | Security + correctness: AI emits validated structured data; a fixed renderer maps it to known React components. |
| Google Maps / scraping | Terms + cost + fragility. OSM + MapLibre with attribution. |
| Remote CSS/JS in templates | Unrestricted remote execution is a security hole; versioned design tokens + fixed components instead. |
| Heavy auth / paid BaaS | Demo must work anonymously; admin needs minimal session auth. Add identity only as needed. |

---

## Prioritized implementation roadmap

Full milestone definitions live in `docs/milestones/M0…M7` (to be written
from this outline during `PLANNING` close-out). Summary:

| Milestone | Goal | Gate |
|---|---|---|
| M0 | Skeleton + contracts | `turbo run check` green; contracts compile |
| M1 | Menu extraction slice (backend + admin review) | Real photo → validated publishable snapshot |
| M2 | Schema-driven renderer + interactive menu | Published snapshot → interactive mobile menu |
| M3 | Bilingual order view | **Demo gate:** scan → confirm → select → show staff |
| M4 | Menu reuse + versioning | Second visit reuses snapshot; diff on re-scan |
| M5 | Discovery (dish-first + map) | Dish page → nearby restaurants serving it |
| M6 | Personalization + price intelligence | Constrained, ranked, preference-aware results + price context |
| M7 | Contributions + studio hardening | Admin operates demo without code changes |

Protect M3. Cut scope from M5–M7 before touching M1–M3.

---

## Blocking questions

Each question names an **owner** and **what unblocks `BUILD`**.
Nothing in this table is answered by guessing — each needs a named
decision or a verified fact.

### Product

| # | Question | Owner | Unblocks BUILD when… |
|---|---|---|---|
| P1 | ~~Is anonymous demo (no account) acceptable, or must travelers sign in?~~ **RESOLVED 2026-10-16 (ADR 0001): guest-first** — browsing, scanning, order drafts need no sign-in; Google Sign-In offered at save moments and for reviews / persistent contributor profiles (ADR 0003: submitting evidence needs no sign-in). | Product / user | ✅ Decision recorded in `docs/auth.md` + `docs/decisions/0001-better-auth-google.md` + `docs/decisions/0003-anonymous-contributions.md` |
| P2 | Which HCMC seed restaurants/dishes (small curated set) may we use, and under what license/permission? | Product / data | Seed list + provenance note exists; no scraped data enters the repo |
| P3 | What exactly may the demo claim about dietary safety? Confirm the four evidence tiers (known / common / confirmed / unknown) and the "never claim safe from absence" rule in demo copy. | Product | Wording approved; renderer shows tiers, never a bare "safe" badge |
| P4 | Demo language set: Vietnamese + English only, or more? | Product | Locale list fixed; translation scope bounded |

### Data / legal

| # | Question | Owner | Unblocks BUILD when… |
|---|---|---|---|
| D1 | Map tile provider + attribution + rate limits for the demo (OSM-compatible)? | Eng | Provider + attribution string chosen; usage terms respected |
| D2 | Are we permitted to photograph + republish restaurant menus in the demo? Any venue opt-out process? | Product / legal | Policy written; contribution flow includes consent/removal path |
| D3 | Receipt handling: raw images private by default — retention period + deletion path? | Eng / product | Retention + deletion rule recorded; private bucket enforced |
| D4 | User-generated content moderation: who moderates, and what is the publish/reject SLA for the demo? | Product | One named moderator path (even if manual) exists |

### AI provider / budget

| # | Question | Owner | Unblocks BUILD when… |
|---|---|---|---|
| A1 | Which AI provider(s) + model(s) for extraction / translation / intent — and is Effect AI, Vercel AI SDK, or provider-native SDK the adapter, verified against Effect 4.0.0? | Eng (AI pipeline) | Provider + adapter chosen; keys custody decided; per-task contracts drafted |
| A2 | Budget / rate limits for the hackathon (max tokens / calls / cost)? | Eng / organizer | Numeric cap recorded; AIExecution logging covers spend |
| A3 | Key custody: whose key, where stored (Secure Vault / env), who rotates? | Eng | No key in repo; storage path documented |

### Auth

| # | Question | Owner | Unblocks BUILD when… |
|---|---|---|---|
| U1 | ~~Admin auth mechanism (session? magic link? single admin seed account?) and who holds admin credentials during the demo?~~ **RESOLVED 2026-10-16 (ADR 0001):** Better Auth session + server-side `RequireAdmin` (DB role). Admin granted only explicitly (existing admin or audited seed allowlist); Google sign-in never auto-grants admin. | Eng | ✅ Mechanism chosen; admin routes protected in M0 |
| U2 | ~~Do travelers need any account for contributions, or is contribution anonymous-with-moderation?~~ **RESOLVED 2026-10-17 (ADR 0003, amending ADR 0001):** anonymous guests may *submit* menu scans, corrections, and price reports — all enter `pending_review`, never auto-published, MVP keeps manual approval. Reviews + persistent contributor profiles still require Google sign-in. Scan and submit are separate actions (scanning is NOT local-only: images are processed privately server-side, temp storage + retention + disclosure — ADR 0003 §1); submitting needs explicit confirmation before extracted data is shared for moderation. Manual prices are never receipt-backed. | Product / eng | ✅ Decision recorded in `docs/decisions/0003-anonymous-contributions.md`; `auth.md`, `domain-model.md`, `data-provenance.md` reconciled |

### Demo logistics

| # | Question | Owner | Unblocks BUILD when… |
|---|---|---|---|
| G1 | Demo device + network: real phone on venue Wi-Fi? Offline fallback needed? | Demo lead | Device + network plan known; loading/error states cover the realistic failure |
| G2 | Demo restaurant(s): one confirmed venue with a real menu we may scan on stage? | Demo lead | ≥1 real menu photo set (or explicitly labeled demo fixtures) ready for M1 |
| G3 | Hackathon rule check: does any pre-`BUILD` artifact (fixtures, seed data, vendored `repos/`) count as "pre-built code"? | Organizer | Written confirmation; `repos/` + fixtures scoped to stay compliant |

---

## Status

- [x] Planning pack (this directory): harness docs written, `PLANNING`-only.
- [ ] Companion docs: product / journeys / demo scope / architecture /
      domain model / AI boundaries / menu rendering / data provenance /
      customer + admin design.
- [ ] Milestone files `docs/milestones/M0…M7`.
- [ ] Blocking questions resolved → explicit user authorization →
      `EXECUTION_MODE = BUILD`.
