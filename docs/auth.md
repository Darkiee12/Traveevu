# Traveevu — Authentication & Authorization (Better Auth + Google)

> Status: PLANNING — decision locked 2026-10-16, no application code.
> Companion to `architecture.md`, `domain-model.md`, `admin-design.md`,
> `user-journeys.md`, `roadmap.md`. ADR: `docs/decisions/0001-better-auth-google.md`.
> `EXECUTION_MODE = PLANNING` — this document decides the approach; it does
> not authorize implementation.

## 1. Decision (one paragraph)

Authentication is **Better Auth**, centralized in the Effect backend
(`apps/api`), shared by both TanStack Start frontends. **Google is the
only initial OAuth/OIDC provider** (`socialProviders.google`). The customer
experience stays **guest-first**: browsing, scanning, and building a
bilingual order draft never require sign-in. Google Sign-In is offered
when the user wants to *persist* something — save preferences/favorites/
order history, or contribute persistent community content. The admin
studio requires authentication **plus** separate server-side
authorization. **Signing in with Google never automatically grants
administrative privileges.** No custom OAuth implementation, ever.

## 2. Why Better Auth (and what was rejected)

| Option | Verdict | Reason |
|---|---|---|
| Better Auth | **Chosen** | Built-in OAuth/OIDC (Google), Drizzle adapter for our Postgres, DB sessions, anonymous plugin for guest→account claiming, admin plugin for role/banned columns, `auth.api.*` server methods + `auth.handler` HTTP handler. No custom OAuth code to write or secure. |
| Custom OAuth (hand-rolled Google OIDC) | **Forbidden** | Token exchange, PKCE/state, refresh, revocation, session handling — all security-critical, all already implemented by Better Auth. Hand-rolling it adds risk with zero demo value. |
| Heavy auth platform / paid BaaS (Auth0, Clerk, Firebase Auth, Supabase Auth) | Rejected | Extra vendor, extra cost, extra SDK surface, and session/identity would live outside our Postgres. Better Auth keeps identity in our own DB next to domain data. |
| Email/password as primary | Deferred, not built | Google-only for MVP keeps the funnel to one button and avoids password storage, reset flows, and email verification. Email/password may be added later without changing the session/authorization model. |
| Passkeys / magic links / OTP | Deferred | Same reason: one provider for the demo; the session model supports adding them later. |

## 3. What "centralized in the Effect backend" means

One Better Auth instance lives in `apps/api`. Both frontends are pure
clients of it. There is no per-frontend auth server, no duplicated
config, no second session store.

```
apps/customer (TanStack Start) ── createAuthClient({ baseURL: API_URL }) ──┐
apps/admin    (TanStack Start) ── createAuthClient({ baseURL: API_URL }) ──┼──> apps/api
                                                                           │    Better Auth instance
Effect domain code ── AuthService.getSession(headers) ────────────────────┘    (auth.handler + auth.api.*)
```

- The backend exposes Better Auth's routes at `/api/auth/*`
  (`auth.handler`), mounted inside the Effect HTTP server (see §4).
- Frontends call those routes through `createAuthClient` from
  `better-auth/react`, with `credentials: "include"` (cookies).
- Frontend **server** code (TanStack Start loaders / server functions)
  never validates a session itself: it forwards the incoming cookie
  headers to the backend, which is the only session authority.
- Domain code never touches cookies, tokens, or Better Auth types
  directly — it receives an `AuthenticatedIdentity` from `AuthService`
  (see §7).

## 4. Effect 4 integration — honest evaluation

**There is no official `@better-auth/effect` package.** A native
Effect integration is an open feature request in the Better Auth repo,
and at least one community package (`effectful-better-auth`, Effect v4)
exists. Decision:

- **Default: thin in-house adapter, owned by us, in `apps/api`.**
  Two pieces, both small:
  1. **HTTP mount:** convert the Effect request to a Web `Request`,
     call `auth.handler(request)`, convert the Web `Response` back.
     (Web-standard Request/Response in, Web-standard out — no
     framework magic.)
  2. **Service wrapper:** `AuthService` (an Effect `Context.Tag`)
     exposing `getSession(headers)`, `requireSession(headers)`,
     `requireAdmin(headers)` as `Effect`s with tagged errors
     (`Unauthenticated`, `Forbidden`). Internally each wraps the
     corresponding `auth.api.*` call with `Effect.tryPromise` and maps
     failures to those tagged errors. No Promise leaks past the
     service boundary.
- **Do not adopt the community Effect wrapper as a hard dependency**
  without an M0 PoC proving it tracks the installed Better Auth +
  Effect 4 versions and adds value over the ~40-line adapter above.
  If the PoC shows it is stable and removes real code, it may replace
  the adapter — recorded in an ADR, never silently.
- **HttpApi middleware:** session/authorization enter handlers as
  middleware (`CurrentSessionOption`, `CurrentSession`,
  `RequireAdmin`), each providing the identity (or `Option`) to the
  handler. Route groups declare which middleware they need; a route
  that forgets its middleware is a review failure.

### M0 PoC must prove (before any feature code)

1. `auth.handler` mounts inside the Effect HTTP server and serves a
   full Google OAuth round-trip in dev (real Google test credentials).
2. `AuthService.getSession` returns our `AuthenticatedIdentity`
   contract from a real session cookie; invalid/expired cookie →
   typed `Unauthenticated`, never an exception.
3. Anonymous sign-in → `onLinkAccount` claim moves a draft (see §6)
   in one transaction; claim failure semantics verified (what Better
   Auth does when the callback throws — the claim must be
   idempotent, see §6).
4. A Google-signed-in user **without** an admin role gets 403 on
   every admin route (negative test).
5. Session revocation works (sign-out / revoke → subsequent calls
   unauthenticated).

## 5. Database: Better Auth tables vs domain tables

Better Auth **owns** four tables: `user`, `session`, `account`,
`verification` (plus `role` / `banned` / `banReason` / `banExpires`
columns on `user` from the admin plugin, and `isAnonymous` from the
anonymous plugin). Rules:

- **One Postgres database, two access paths — kept separate.**
  Better Auth uses its official **Promise-based Drizzle adapter**
  (`drizzleAdapter(db, { provider: "pg", schema })`) on its own
  `node-postgres` pool. Effect domain code uses the Effect SQL /
  Drizzle-effect path on its own pool. Do not mix them: the adapter
  is Promise-based, and forcing it through Effect's execution model
  is a known friction point. Bound both pools; the sum stays within
  the DB connection budget.
- **Schema generation:** Better Auth's CLI (`@better-auth/cli
  generate`) produces the Drizzle schema for its tables. That output
  is checked in and migrated with **Drizzle Kit like everything
  else** — there is no second migration system. Re-run the CLI after
  any plugin change and review the diff.
- **Domain tables reference `user.id` by foreign key**
  (`UserPreference.userId`, `FavoriteDish.userId`,
  `OrderDraft.userId`, `Contribution.userId`). Better Auth's `user`
  table is the identity root; domain tables never duplicate identity.
- **Never hand-write Better Auth's table shapes**, and never let
  domain logic read the `session` table directly. The only reader of
  auth tables is Better Auth itself, through `AuthService`.
- **Better Auth uses adapter model names**, not table names, in its
  config — match the installed version's expectations and verify in
  the M0 PoC.

## 6. Guest-first + guest → account migration (the core UX contract)

### 6.1 What guests can do without signing in

- Browse dishes, dish pages, maps, price context.
- Scan a menu, review/correct the extraction, build an interactive
  menu, select items, and show the bilingual order to staff.
- Hold an **in-progress order draft** on the device (in-memory /
  local state). Nothing about the demo requires an account.
- **Submit verifiable evidence for moderation** — menu scans,
  corrections, price reports (ADR 0003). See §6.2.

### 6.1a Scan and submit are separate actions (ADR 0003, corrected 2026-10-17)

- **Scanning requires no account and never auto-creates a public
  contribution.** The scan → extraction → interactive menu →
  bilingual order flow works with no authentication and no anonymous
  identity. Scanning alone never mints a Better Auth anonymous user
  and never creates a contribution.
- **Scanning is NOT local-only.** Extraction is server-side AI, so
  the menu image is sent to our backend and to the AI provider for
  **private processing** — processing is not publication. The image
  is stored as a private `MediaAsset`, visible only to the
  extraction pipeline (and, if submitted, to moderators); it is held
  in temporary storage with a retention limit — unsubmitted scan
  images are deleted after a short window (default proposal: 24h
  after capture or when the draft is abandoned, whichever is first;
  exact window confirmed in M0; deletion is recorded); and the UI
  discloses before scanning that the photo goes to our backend +
  AI provider for extraction, is not published, and is deleted if
  not submitted. See `data-provenance.md` §5.2.
- **The customer gets an interactive menu without publishing.**
  Confirming the extraction lets the traveler order; it does not
  share or publish anything.
- **Contributing is a separate, explicit action.** Only when the
  traveler taps "Share this menu with Traveevu" (or equivalent)
  does the app create/use a Better Auth anonymous identity — and
  only because persistent guest ownership of the contribution
  requires one.
- **Confirmation before sharing.** Before extracted data is shared
  for moderation, the UI asks for confirmation and states what
  happens: the extracted menu goes into a moderation queue, is
  reviewed by a human before anything publishes, and needs no
  account. Declining keeps the scan-to-order flow untouched and the
  unsubmitted image is deleted per the retention rule above.
- **The shared menu never contains private data.** A published
  `MenuSnapshot` / contribution carries menu/price/review evidence
  only — never `UserPreference`, `FavoriteDish`, or `OrderDraft`
  fields.

### 6.2 What requires sign-in — and what does not (amended by ADR 0003)

The gate for contributions moved from *submission* to *publication*
for verifiable evidence. Nothing anonymous is ever auto-published.

| Action | Needs sign-in? | Publication |
|---|---|---|
| Save preferences / favorites / order history | **Yes** — Google sign-in | Private to the account |
| Submit a menu scan | No (anonymous guest) | `pending_review` → manual moderator approval |
| Submit a correction | No (anonymous guest) | `pending_review` → manual moderator approval; allergen corrections always need moderator review |
| Submit a price report | No (anonymous guest) | `pending_review` → manual moderator approval; manual prices are never receipt-backed (ADR 0003 §3) |
| Submit a review (deferred from MVP; when implemented) | **Yes** — Google sign-in | Moderated; opinions, never dietary/price evidence |
| Persistent contributor profile (public history, attribution page) | **Yes** — Google sign-in | N/A |

- The UI offers "Sign in with Google to save" **at the moment the
  user tries to persist something private**, and "Sign in with
  Google to review" for reviews — never as a gate in front of
  scanning, ordering, or submitting evidence.
- Public attribution for anonymous submissions is pseudonymous
  ("submitted by a traveler") — no profile link, no PII.

### 6.3 Guest identity: Better Auth anonymous users (not device UUIDs)

Guest-owned rows are owned by a real Better Auth user id from the
start — the **anonymous plugin** mints a guest user
(`isAnonymous: true`, synthetic email on a domain we control or a
clearly non-routable domain, e.g. `guest.traveevu.local`) plus a real
session. This keeps every ownership FK `NOT NULL` and makes claiming
a simple re-parent instead of a fragile device-id migration.

Rules:

- **Lazy minting.** Do not create an anonymous user on mere page
  view. Mint one only when the guest does something that needs
  persistence (starts a savable draft, saves a preference, begins a
  contribution). Browsing stays stateless.
- **Claim on sign-in.** When a guest signs in with Google, the
  anonymous plugin's `onLinkAccount({ anonymousUser, newUser })`
  callback runs **before** the anonymous user is deleted. Our
  callback re-parents the guest's rows to the real account in **one
  transaction**: `UserPreference`, `FavoriteDish`, `OrderDraft`
  (including the in-progress draft — the user does not lose their
  current menu or order), and `Contribution` rows in `draft` and
  `pending_review` status. Then the anonymous user is deleted by
  the plugin.
- **Claim is idempotent and must not throw away the draft.** If the
  claim transaction fails, the link must not silently discard the
  guest's data: the claim is retried / the failure is logged and
  surfaced ("We couldn't move your previous draft — it is still on
  this device"), and the guest's draft remains recoverable.
  The M0 PoC verifies exactly what Better Auth does when
  `onLinkAccount` throws (does the link abort? does the anonymous
  user survive?) and the claim is written to match that behavior.
  The PoC now also verifies that a throw leaves contributions
  intact: no partial re-parent, no orphaned FK.
- **Contributions survive anonymous-user deletion (ADR 0003).**
  `Contribution.ownerUserId` is a **nullable FK, `ON DELETE SET
  NULL`, never `CASCADE`** — deleting a user (link, prune, or
  account deletion) never deletes contributions. Every
  `Contribution` carries an **immutable attribution snapshot**
  (validated JSONB: `originalUserId` as a value, not an FK,
  `isAnonymousAtSubmission`, `displayLabel`, `submittedAt`) that
  preserves original provenance and is never rewritten by a link
  event. On link, `draft`/`pending_review` contributions re-parent
  to the real account for FK integrity; the attribution snapshot
  stays original. Published contributions keep their original
  attribution display. On prune (anonymous user deleted without
  linking), the owner FK becomes `NULL` and the contribution stays
  in its queue/state with its snapshot intact, still labeled guest.
  **The attribution snapshot is internal-only** — no public API
  response, published page, or shared payload may contain a user
  id, email, or any raw internal identifier. Public surfaces expose
  only the `displayLabel` ("submitted by a traveler" for anonymous
  submissions, or the contributor's chosen public display label
  for signed-in submissions). Re-parenting changes the internal
  owner FK, never the public label.
- **Published contributions are NOT re-parented silently.**
  A `Contribution` that is already `published` keeps its original
  attribution record; the claim moves `draft`/`pending_review`
  contributions and private data (preferences, favorites, drafts).
  Published history is evidence — it is never rewritten by a link
  event.
- **Abuse guards.** Anonymous sign-in is rate-limited per IP
  (Better Auth rate limiting) and anonymous users with no owned rows
  are pruned by a scheduled job after a retention window. Clearing
  cookies orphans an anonymous identity — acceptable: the guest
  simply starts fresh; nothing shared depends on the orphaned
  identity.
- **Guest IDs alone are not abuse prevention (ADR 0003).**
  Clearing cookies mints a fresh anonymous identity, so a ban or
  rate limit keyed only on guest id is trivially evaded. Abuse
  controls must be layered: per-IP rate limits on anonymous
  submissions, per-submission validation (schema, size, duplicate
  detection), and the moderation queue as the hard gate — nothing
  anonymous publishes without a human. Guest-id bans are at most a
  convenience, never the mechanism.
  simply starts a fresh guest session; nothing they published is
  lost (published data is attributed in history, not to the live
  anon row).

### 6.4 Sign-in UX

- One button: **"Continue with Google"**. No password fields, no
  custom OAuth screens, no account chooser we built ourselves.
- After sign-in, the user lands back where they were (deep link /
  return-to), with their draft intact — the claim runs as part of
  the sign-in, not as a separate step.
- Sign-out revokes the session server-side; the user's saved data
  stays in their account for next sign-in.

## 7. Sessions, cookies, and deployment topology

- **Sessions are stored in Postgres** (authoritative, revocable).
  Sign-out / revoke immediately invalidates server-side.
- **Cookie cache: OFF in the MVP.** Better Auth's `cookieCache`
  (compact/JWT/JWE) avoids a DB read per request, but a cached
  session cannot be centrally revoked and the cache does not carry
  custom fields. For a hackathon, correctness and revocation beat
  the saved round-trip. Revisit only with measured latency evidence.
- **Session lifetime:** `expiresIn` 7 days (Better Auth default),
  `updateAge` 24h (session refresh). Admin sessions use the same
  mechanism; admin *authorization* is checked per request from the
  DB role (see §8), so a revoked/removed admin loses access on the
  next request, not at token expiry.
- **Cookie attributes:** `httpOnly: true`, `secure: true` in
  production, `path: /`, `sameSite` per topology below.
- **Deployment topology (locked for MVP): single origin.**
  Customer, admin, and API are served behind one origin
  (`/` → frontends, `/api/*` → Effect backend via reverse proxy).
  Cookies are then **first-party**: `sameSite: "lax"` suffices,
  no CORS credentials dance, SSR cookie forwarding is trivial.
  `trustedOrigins` is an explicit allowlist containing exactly the
  deployed origins (prod + localhost dev) — no wildcards.
- **If single-origin is impossible** (e.g. hackathon hosting splits
  frontends and API onto different origins), the fallback is:
  `sameSite: "none"` + `secure: true` + `trustedOrigins` allowlist +
  CORS with `credentials: true`, and frontend SSR forwards incoming
  cookies to the backend. This is a deployment decision, not a code
  change — record it in the deployment notes when the host is known.
- **Secrets (never in repo):** `BETTER_AUTH_SECRET` (32+ random
  chars), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `BETTER_AUTH_URL` / base URL. Via Secure Vault / env only.
  Google Cloud Console: one OAuth client per deployment origin;
  authorized redirect URIs must include the backend callback
  (`<origin>/api/auth/callback/google`). For the demo, expect the
  Google "unverified app" consent-screen warning unless the OAuth
  consent screen is verified — plan the demo around it (verified
  test users / internal app, or acknowledge the warning on stage).
  This is a demo-logistics item, not an architecture item.

## 8. Admin studio: authentication + separate authorization

- **Every admin route and mutation requires:** a valid session
  **and** an admin role, checked server-side on every request.
  Client-side hiding of admin UI is convenience only — never the
  enforcement.
- **Google sign-in never grants admin.** New users (by any method)
  get the default role `user`. Admin is a **database role**, never
  a Google claim, group, email domain, or anything in the OAuth
  profile. There is no code path from "signed in with Google" to
  "is admin".
- **How someone becomes admin:** only by explicit grant —
  (a) an existing admin granting the role through the studio (audited),
  or (b) a seed allowlist applied at deploy time (a small list of
  Google account IDs / verified emails in env, applied by an
  audited one-time grant, not by sign-in logic). The grant itself is
  an audit event (who, whom, when, reason). There is no self-service
  admin request flow in the MVP.
- **Authorization model:** roles `user` / `operator` / `admin`
  (via the admin plugin's `role` column; `defaultRole: "user"`,
  `adminRoles: ["admin"]`). `RequireAdmin` middleware enforces
  `role == "admin"` for studio mutations; finer-grained
  operator/viewer permissions are deferred — the MVP studio has
  admins only, and every admin action is audited. Do not use the
  admin plugin's client-side user-management endpoints (list users,
  ban, impersonation) unless a real need appears; **impersonation
  stays disabled** in the MVP.
- **Audit:** every admin mutation logs actor, action, entity,
  before/after, reason, timestamp (append-only). Role grants and
  revocations are audit events.
- **Admin sessions:** same session mechanism as customers, but the
  studio UI must not cache authorization: each mutation re-checks
  the role from the DB session. A demoted admin loses access on the
  next request.

## 9. Contract boundary: Better Auth types never leak into the domain

Better Auth's `user` / `session` shapes are **not** domain contracts
and are not in `packages/contracts`. The boundary:

```text
Better Auth (auth.api / auth.handler)
    → AuthService (apps/api, thin adapter)
    → AuthenticatedIdentity  [Effect Schema, in packages/contracts]
    → domain handlers / middleware
```

```text
AuthenticatedIdentity {
  userId: UserId,            // branded, = Better Auth user.id
  email: string | null,      // from Google profile; may be null for anonymous
  name: string | null,
  isAnonymous: boolean,
  role: "user" | "operator" | "admin",
}
```

- Domain code sees only `AuthenticatedIdentity`. It never imports
  `better-auth`, never reads cookies, never parses tokens.
- The `role` in `AuthenticatedIdentity` comes from the DB session
  read at request time (server-side), never from a client-sent
  value and never from Google claims.
- Guest (unauthenticated) requests have **no** identity — handlers
  that allow guests take `Option<AuthenticatedIdentity>`; handlers
  that require persistence take `AuthenticatedIdentity` and fail
  `Unauthenticated` without one. Anonymous-plugin guests are
  *authenticated* (they have a session) with `isAnonymous: true` —
  that is how guest-owned rows keep a real owner id.

## 10. What this decision changes elsewhere

- **Q1 (blocking questions) — RESOLVED:** guest-first, optional
  Google account. See `docs/decisions/0001-better-auth-google.md`.
- **Contribution attribution (ADR 0003, amends this decision):**
  anonymous guests may *submit* menu scans, corrections, and price
  reports for moderation; publication stays manually moderated;
  reviews + persistent contributor profiles still require Google
  sign-in. Scan and submit are separate actions; submitting needs
  an explicit confirmation. `Contribution.ownerUserId` is nullable
  (`ON DELETE SET NULL`) + immutable attribution snapshot. See
  `docs/decisions/0003-anonymous-contributions.md`.
- **`UserPreference` / `FavoriteDish` / `OrderDraft` /
  `Contribution`:** owner is a Better Auth `user.id` (anonymous or
  real). The old "anonymous session/device id" design is replaced
  by anonymous-plugin users (real rows, claimable).
- **Roadmap M0:** "Auth selection" becomes "Better Auth + Google
  PoC" (mount, Google round-trip, claim, admin negative test). No
  custom auth work in any milestone.
- **Admin design:** §9 auth section now reads: Better Auth session +
  `RequireAdmin` middleware + audited explicit grants; no auto-admin.
- **User journeys:** sign-in appears only at save moments and for
  persistent contributor profiles, and for reviews when Review
  ships (deferred from MVP; ADR 0003: submitting evidence does not
  require sign-in); the P1 demo flow has no sign-in step.
- **No changes to:** money, snapshot immutability, template/renderer
  boundary, menu extraction contracts, pricing rules.

## 11. Risks & open items (for M0, not for this decision)

1. **Community Effect wrapper vs in-house adapter** — decided by
   M0 PoC (see §4). Default is in-house.
2. **`onLinkAccount` failure semantics** — verify in PoC; claim must
   be idempotent (see §6.3).
3. **Two DB pools** (Better Auth Promise pool + Effect pool) —
   size them so their sum stays within the DB budget; verify under
   the Playwright journey.
4. **Single-origin deployment** — confirm the hackathon host can
   reverse-proxy `/api/*` to the backend; otherwise apply the
   cross-origin fallback in §7.
5. **Google OAuth consent screen** — unverified-app warning in the
   demo unless verified; arrange test users / internal app early.
6. **Anonymous-submission abuse controls (ADR 0003)** — per-IP rate
   limits on anonymous submissions, duplicate detection, and queue
   capacity; thresholds decided in M0/M2. Guest-id bans alone are
   not the mechanism.
7. **Submit-confirmation UX (ADR 0003)** — exact copy for the
   "Share this menu" confirmation (what is shared, moderation,
   no account needed); designed in M2 with the contribution flow.
6. **Anonymous-user pruning** — retention window + scheduled job;
   define in M0 (default: prune anon users with no owned rows after
   30 days; never prune anon users owning published contributions
   without re-attribution review).

## 12. Explicit non-goals (MVP)

- No email/password, no passkeys, no magic links, no OTP.
- No second OAuth provider (no GitHub/Apple/Facebook).
- No impersonation, no admin self-service role requests.
- No client-side authorization (all authz is server-side).
- No custom OAuth code, no token handling outside Better Auth.
- No sign-in wall anywhere in the P1 demo flow.
