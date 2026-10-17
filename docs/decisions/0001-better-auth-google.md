# ADR 0001 — Better Auth + Google, guest-first, no auto-admin

> Status: **Accepted** 2026-10-16 (PLANNING — no code).
> **Amended** 2026-10-17 by ADR 0003 (see "Amendments" below):
> anonymous evidence contributions (menu scans, corrections,
> price reports) may be *submitted* without sign-in; publication
> stays manually moderated; reviews + persistent contributor
> profiles still require Google sign-in.
> **Amended** 2026-10-17 by ADR 0005 (see "Amendments" below,
> refined same day): `UserPreference` hybrid document +
> `tasteAnchors` discriminated collection; a guest's explicit save
> persists an anonymous-owned row (sign-in enables cross-device
> persistence); claim transfers when the target has no
> preferences, otherwise the incoming document is persisted
> first into `PreferenceConflict` (owned by the account) and
> both are retained + lazily resolved — never silent overwrite.
> Decides: auth provider, guest model, admin authorization.
> Resolves blocking question **Q1** (customer identity) and the M0
> "auth selection" item. Full design: `docs/auth.md`.

## Amendments

- **ADR 0003 (2026-10-17) — anonymous evidence contributions.**
  Supersedes the "sign-in at save/contribute moments" rule for
  *submitting* verifiable evidence: guests may submit menu scans,
  corrections, and price reports without an account; everything
  anonymous enters `pending_review` and is never auto-published.
  Scan and submit are separate actions (scanning is NOT local-only:
  images are processed privately server-side; see ADR 0003 §1);
  submitting requires an explicit confirmation before extracted
  data is shared for moderation.
  `Contribution.ownerUserId` is nullable (`ON DELETE SET NULL`,
  never `CASCADE`) + an immutable attribution snapshot preserves
  original provenance across anonymous-user deletion on linking.
  Reviews and persistent contributor profiles still require Google
  sign-in. Manual prices are never receipt-backed. MVP keeps manual
  publication approval; trust scoring / auto-moderation are future
  work, not hackathon dependencies. See
  `docs/decisions/0003-anonymous-contributions.md`.
- **ADR 0005 (2026-10-17, refined same day) — `UserPreference`
  hybrid + claim conflicts.** `UserPreference` is one row per
  user: validated JSONB document + `schemaVersion` + `revision`
  (optimistic concurrency); taste anchors live inside the
  document as one ordered discriminated `tasteAnchors`
  collection (`TasteAnchor`, max 5 total) — no `FavoriteDish`
  table. Refines the "sign-in at save moments" rule: a guest's
  explicit save persists an anonymous-owned row; Google sign-in
  enables cross-device persistence and claim. On claim,
  transfer the guest document when the target account has no
  preferences; when both exist, persist the incoming document
  first into `PreferenceConflict` (owned by the account),
  preserve the account document, and resolve lazily + atomically
  in settings — never silently overwrite. Guest-wins is
  rejected. See `docs/decisions/0005-user-preference-hybrid.md`.

## Context

Traveevu needs identity for exactly three things: (1) persisting a
traveler's preferences / favorites / order history, (2) attributing
persistent community contributions (menus, corrections, and reviews
when Review ships — deferred from MVP), (3) protecting the admin
studio. The main demo flow (scan → interactive menu → bilingual
order) must work with zero sign-in friction, and the admin studio
must never grant privilege from a consumer login.

## Options considered

1. **Better Auth + Google-only (chosen).** Built-in OAuth/OIDC, Drizzle
   adapter, DB sessions, anonymous plugin, admin plugin. Identity in
   our own Postgres.
2. **Custom OAuth (hand-rolled Google OIDC).** Rejected — security-
   critical code (PKCE, state, refresh, revocation) with no benefit.
3. **Paid auth BaaS (Auth0 / Clerk / Firebase / Supabase Auth).**
   Rejected — extra vendor/cost/SDK, identity outside our DB.
4. **Account-required before scan.** Rejected — login wall in front of
   the core journey; biggest demo/adoption risk.
5. **Device-UUID guests + claim-on-sign-in.** Rejected as the primary
   guest model — fragile FK story, no server-side session. Replaced by
   Better Auth anonymous users (real rows, claimable via
   `onLinkAccount`).

## Decision

- Better Auth, one instance in the Effect backend (`apps/api`),
  shared by both TanStack Start frontends via `createAuthClient`.
- Google is the only initial OAuth/OIDC provider. No email/password,
  no second provider in the MVP.
- Guest-first: browsing, scanning, and order drafts need no sign-in.
  Sign-in is offered for cross-device persistence, order history,
  and reviews / persistent contributor profiles. An explicit guest
  save persists preferences without sign-in (amended by ADR 0005).
  Submitting verifiable evidence (menu scans, corrections, price
  reports) does not require sign-in — amended by ADR 0003, which
  moves the gate from submission to publication.
- Guest identity = Better Auth anonymous users (lazy minting);
  sign-in claims guest rows via `onLinkAccount` in one idempotent
  transaction (preferences, drafts, draft contributions).
  Preference conflicts resolve per ADR 0005 §3 (transfer, or
  retain both + lazy resolution — never silent overwrite).
- Admin: session + server-side `RequireAdmin` middleware reading the
  DB `role`. New users default to `role: "user"`. Admin is granted
  only explicitly (existing admin, or audited seed allowlist) —
  never from Google claims. Impersonation disabled.
- Effect integration: thin in-house adapter (`auth.handler` mount +
  `AuthService` wrapping `auth.api.*`); no official
  `@better-auth/effect` exists — community wrapper only via M0 PoC.
- Sessions in Postgres, cookie cache OFF in MVP, single-origin
  deployment (first-party cookies, `sameSite: "lax"`).

## Consequences

- Domain tables FK to Better Auth `user.id`. Domain code sees only
  the `AuthenticatedIdentity` contract, never Better Auth types.
- Two DB pools (Better Auth Promise pool + Effect pool) — sized
  jointly within the DB budget.
- M0 must prove: Effect mount + Google round-trip, claim semantics,
  admin negative test, revocation.
- Q1 is resolved: guest-first, optional Google account.

## What would change this

- If the M0 PoC shows the in-house adapter cannot mount cleanly, the
  community Effect wrapper may replace it (recorded as an ADR
  amendment, not silently).
- If single-origin deployment proves impossible, apply the
  cross-origin cookie fallback in `docs/auth.md` §7 (deployment
  decision, not a code redesign).
- Adding a second provider or email/password later does not change
  the session/authorization model.
