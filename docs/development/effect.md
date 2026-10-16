# Effect — Backend Conventions

> Backend: `apps/api/`, one Effect service, domain-oriented modules.
> Effect **4.0.0** stable (2026-10-01). **Pin all `@effect/*` packages to
> the same version** — mixed versions are a common source of type errors.
> If an API below does not match installed 4.0.0 behavior, read
> `repos/effect/` (vendored reference) or the installed package — never
> guess from memory or from older Effect versions.

## Core rules

1. **Effect is the backend programming model.** All async work, service
   composition, retries, timeouts, resource management, and error handling
   go through Effect. No bare Promises escaping domain code, no
   untyped `throw`.
2. **Services via `Context`.** Declare dependencies as `Context.Tag`s /
   Effect 4 service definitions; provide them with `Layer`s. Business
   code receives services as parameters (via `Effect` environment),
   never imports a singleton client directly.
3. **Tagged errors, never `throw`.** Model every failure as a tagged
   error (`Data.TaggedError` / Effect 4 equivalent) with a stable
   `_tag` and structured fields. Map to HTTP status codes at the
   transport boundary only. Example tags: `MenuNotFound`,
   `ExtractionValidationFailed`, `PromptNotPublished`,
   `Unauthorized`, `StorageError`.
4. **No `try/catch` → Effect.** Do not wrap fallible code in
   `try/catch` and return ad-hoc values. Use `Effect.try` /
   `Effect.tryPromise` with explicit error mapping, or `Effect.catchTag`
   for recovery. A `catch` that swallows an error is a review failure.
5. **Schema for contracts.** All API and AI-task input/output validation
   uses Effect Schema from `packages/contracts`. Never re-declare a
   boundary shape in the backend. Decode at the edge; work with typed
   values inside.
6. **HttpApi boundaries.** Expose HTTP via Effect's HttpApi (or the
   Effect 4 equivalent) so endpoints, errors, and schemas stay typed
   end-to-end. Hand-rolled route handlers that bypass the contract
   package are forbidden.
7. **Layers compose; don't hand-wire.** `Layer`s provide services
   (DB, storage, AI provider, clock). Tests swap in test layers — never
   monkey-patch.
8. **No unnecessary wrappers.** No generic "service base class," no
   forwarding layers that add no behavior. Clear, composable functions
   over generic abstraction.

## Project layout (backend)

```
apps/api/src/
├── index.ts                 # HttpApi serve + root Layer wiring (thin)
├── lib/
│   ├── config.ts            # env config (validated, no secrets in repo)
│   ├── errors.ts            # shared error tags (only truly shared ones)
│   └── logging.ts           # structured logging — never PII / secrets
├── db/
│   ├── schema.ts            # Drizzle tables (or per-domain schema files)
│   ├── client.ts            # Drizzle client as an Effect service
│   └── migrations/          # Drizzle Kit output (generated, committed)
├── domains/                 # one dir per domain: catalog, restaurants,
│   ├── catalog/             #   discovery, personalization, menus,
│   │   ├── service.ts       #   ordering, pricing, contributions,
│   │   ├── repository.ts    #   identity, resources, prompts, templates,
│   │   └── errors.ts        #   administration
│   └── …/
└── ai/
    ├── tasks/               # one module per AI task (intent, extraction,
    │   └── …                #   translation, matching, explain, receipt)
    ├── providers/           # provider adapters behind a task interface
    └── prompts.ts           # prompt loading via Prompt Registry (data, not code)
```

Within each domain, separate business logic, workflows, persistence, and
transport only where useful. A tiny domain may be one file; do not force
four-layer ceremony.

## Services, Layers, and dependencies

- **Define a service per external capability**, not per function:
  `Db`, `ObjectStorage`, `AiProvider`, `Clock`, `IdGenerator`.
- **Domain services depend on capability services**, e.g.
  `MenusService` requires `Db` + `ObjectStorage` + `AiExtraction`.
  Declare this in the type; let Layers satisfy it.
- **Repositories are thin.** A repository queries via Drizzle and maps
  rows to domain types. It never calls AI, HTTP, or another domain's
  repository. Cross-domain reads go through the owning domain's service.
- **Resource management:** use `Effect.acquireRelease` / `Scope` for
  anything needing cleanup (DB pool, streams, temp files). No manual
  `close()` in business code paths.
- **Concurrency:** use Effect combinators (`Effect.all` with explicit
  concurrency, `Effect.forEach`, `Queue`, `Semaphore`) — never raw
  `Promise.all` on Effect values. Default to sequential unless
  parallelism is intentional and bounded.

## Errors, retries, timeouts

- **Error taxonomy per domain**, in `<domain>/errors.ts`. Each error:
  stable `_tag`, human-readable message, structured fields (ids, not PII),
  and a mapping to an HTTP status at the boundary.
- **Retry only what is retryable.** Transient provider/storage errors:
  bounded retries with backoff via `Effect.retry` + `Schedule`. Never
  retry validation errors, auth errors, or non-idempotent mutations
  without an idempotency key.
- **Timeouts on every external call.** AI provider calls, storage calls,
  and outbound HTTP get explicit `Effect.timeout`s. A hung provider must
  never hang a request.
- **No silent fallbacks.** If AI extraction fails validation, surface
  `ExtractionValidationFailed` with the validation errors — do not fall
  back to a guessed menu, a cached stale menu, or free-form text.

## AI integration inside Effect

- AI is accessed **only** through task services in `apps/api/src/ai/`
  (e.g. `MenuExtractionService`, `IntentExtractionService`).
  Business domains depend on the task interface, never on a provider SDK.
- Each task has: an input schema, an output schema (both in
  `packages/contracts`), a prompt version id (loaded from the Prompt
  Registry), a provider adapter, and validation of the raw output
  before it leaves the AI layer.
- Record every execution as an `AIExecution` (prompt version, model id,
  input refs, validation result, latency, token/cost if available).
  Never log raw user content, images, or secrets in execution records.
- Provider adapters are swappable: Effect AI, Vercel AI SDK, or
  provider-native SDK — the choice is an adapter decision (see
  `README.md` blocking question A1), not a business-logic decision.

## Testing

- **Framework:** `@effect/vitest`, pinned to the same Effect version.
- **Unit tests:** pure domain functions (pricing, dietary tiers, matching,
  versioning, state transitions) — fast, no Layers needed.
- **Service tests:** run workflows with test Layers (in-memory / stub
  `Db`, stub `AiProvider` returning fixture outputs). Assert tagged
  errors, not thrown exceptions.
- **Contract tests:** every HttpApi endpoint decodes/encodes against
  `packages/contracts`. A passing test means the wire shape matches the
  schema — not just "200 OK."
- **AI fixture tests:** run each AI task against `fixtures/` inputs and
  assert schema compliance + no invented facts (prices/options present
  in evidence only). These tests use stubbed provider outputs by
  default; live-provider runs are opt-in, capped, and never in CI.
- **Never `await` an Effect in a test without running it** via the
  test runtime (`Effect.runPromise` / `@effect/vitest` helpers).
  Unhandled `Effect` values are silent no-ops — a classic bug.

## Reading library source

Before guessing an Effect API:

1. Check `repos/effect/` (vendored, pinned to the installed version).
2. Check the installed package in `node_modules/@effect/*`.
3. Check the official Effect docs for the installed version.

Do not copy vendored source into production code, do not import from
`repos/`, and do not write code against an Effect version other than
the pinned one. If the blog post / docs disagree with installed 4.0.0
behavior, installed behavior wins — record the discrepancy in
`docs/decisions/`.

## Anti-patterns (rejected in review)

- `throw` / untyped errors; `try/catch` that returns a default value.
- `any`, `as unknown as X` to escape Schema decoding, or `@ts-ignore`.
- Importing a provider SDK (OpenAI/Anthropic/…) outside `apps/api/src/ai/providers/`.
- Business logic in route handlers; SQL in route handlers.
- `Effect.runSync` on async work; fire-and-forget Effects.
- Logging PII, raw images, prompt contents containing user data, or secrets.
- Retry loops around non-idempotent mutations without idempotency keys.
