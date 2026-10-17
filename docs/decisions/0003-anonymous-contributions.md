# ADR 0003 — Anonymous evidence contributions (amends ADR 0001)

> Status: **Accepted** 2026-10-17 (PLANNING — no code).
> **Correction** 2026-10-17: §1 originally said scanning is
> "local-only" and that nothing leaves the device. That was wrong —
> extraction is server-side AI, so the menu image is sent to our
> backend and the AI provider for *private processing*. The
> corrected distinction is in §1 below.
> Amends ADR 0001 (Better Auth + Google): the gate for contributing
> moves from *submission* to *publication* for verifiable evidence.
> Reviews and persistent contributor profiles still require Google
> sign-in. Full design: `docs/auth.md` §6, `docs/domain-model.md`
> §4.13, `docs/data-provenance.md` §5–§7.

## Context

ADR 0001 resolved Q1 as guest-first, but left contributions
sign-in-gated: a traveler had to create an account before a menu
scan could enter the public database. That puts the login wall at
the exact moment the traveler is most motivated and most able to
help — standing in the restaurant, menu in hand — and contradicts
the product principle that travelers should be able to help
themselves and the next visitor without being forced into
registration.

At the same time, anonymous submission is the highest-abuse,
lowest-trust input the system takes. The decision below keeps the
frictionless moment and pays for it with moderation, not with
trust in the submitter.

## Decision

### 1. Scan and submit are separate actions

- **Scanning requires no account and never auto-creates a public
  contribution.** The scan → extraction → interactive menu →
  bilingual order flow works with no authentication and no anonymous
  identity. Scanning alone never mints a Better Auth anonymous user
  and never creates a contribution.
- **Scanning is NOT local-only.** Extraction is server-side AI, so
  the menu image is sent to our backend and to the AI provider for
  **private processing** — processing is not publication. Private
  processing rules: the image is stored as a private `MediaAsset`,
  visible only to the extraction pipeline (and, if submitted, to
  moderators); it is held in temporary storage with a retention
  limit — unsubmitted scan images are deleted after a short window
  (default proposal: 24h after capture or when the draft is
  abandoned, whichever is first; exact window confirmed in M0;
  deletion is recorded); and the UI discloses before scanning that
  the photo goes to our backend + AI provider for extraction, is
  not published, and is deleted if not submitted. See
  `data-provenance.md` §5.2.
- **The customer gets an interactive menu without publishing.**
  Confirming the extraction lets the traveler order; it does not
  share or publish anything.
- **Contributing is a separate, explicit action.** Only when the
  traveler taps "Share this menu with Traveevu" (or equivalent) does
  the app create/use a Better Auth anonymous identity — and only
  because persistent guest ownership of the contribution requires
  one.
- **Confirmation before sharing.** Before extracted data is shared
  for moderation, the UI asks for confirmation and states what
  happens: the extracted menu goes into a moderation queue, is
  reviewed by a human before anything publishes, and needs no
  account. Declining keeps the scan-to-order flow untouched and the
  unsubmitted image is deleted per the retention rule above.
- **The shared menu never contains private data.** A published
  `MenuSnapshot` / contribution carries menu/price/review evidence
  only — never `UserPreference` (incl. taste anchors, ADR 0005)
  or `OrderDraft` fields. See `data-provenance.md` §5.2.

### 2. What anonymous guests may submit — and what still needs sign-in

| Submission | Anonymous allowed? | Publication |
|---|---|---|
| Menu scan (`menu_scan`) | Yes | `pending_review` → manual moderator approval. Never auto-published. |
| Correction (`correction`) | Yes | `pending_review` → manual moderator approval. Never auto-published. Allergen corrections always need moderator review. |
| Price report (`price_report`) | Yes | `pending_review` → manual moderator approval. Manual prices are never receipt-backed (see §3). |
| Review (`review`) | **No** — Google sign-in required (when Review ships; deferred from MVP — `domain-model.md` §4.14) | Moderated; opinions, never dietary/price evidence. |
| Persistent contributor profile (public history, attribution page) | **No** — Google sign-in required | N/A |

"Anonymous" means **no account**, not **no identity**: submissions
are owned by a Better Auth anonymous-plugin user id
(`isAnonymous: true`), so they are attributable, claimable, and
FK-safe. Public attribution for anonymous submissions is
pseudonymous ("submitted by a traveler") — no profile link, no PII.

### 3. Evidence quality differs — never equate the three

All anonymous submissions require moderation, but their confidence
and verification requirements differ. The moderation UI and the
domain model must keep these classes visibly distinct:

| Evidence | Backing | Verification on moderation |
|---|---|---|
| Menu scan | Menu photo + extraction payload + confidence | Moderator checks extraction against the photo. Image-backed, re-verifiable. Highest of the three. |
| Correction | Field-level change list (`field, oldValue, newValue, reason, actor, at`) against the current published revision (ADR 0006 §5) | Moderator checks the diff + reason against prior evidence. May need new evidence. On submit, a candidate snapshot is materialized; on approval, a new revision references it. |
| Price report, receipt-backed | Receipt photo, legible line items | Moderator checks line items; stored as `PriceObservation` source `receipt`, kind `receipt_paid`. |
| Price report, manually entered | Typed numbers, no backing image | **Never stored as receipt-backed.** Source `manual`, kind stays `listed`-class at best, confidence capped, and if published it is labeled "reported price, unverified". Manual and receipt-backed observations are never aggregated or displayed equivalently. |

A manually reported price must never become a receipt-backed
observation through moderation, aggregation, or display. The
`source` enum (`menu_snapshot | receipt | manual | contribution`)
is the boundary; `manual` ≠ `receipt`, permanently.

### 4. Anonymous linking lifecycle — integrity + provenance survive deletion

Better Auth's anonymous plugin **deletes the anonymous user on
account linking** (after `onLinkAccount` runs). The design must not
depend on the anonymous user row surviving:

- `Contribution.ownerUserId` is a **nullable FK, `ON DELETE SET NULL`,
  never `CASCADE`**. Deleting a user (link, prune, or account
  deletion) never deletes contributions.
- Every `Contribution` carries an **immutable attribution snapshot**
  (validated JSONB): `{ originalUserId (value, not FK),
  isAnonymousAtSubmission, displayLabel, submittedAt }`. This is the
  original provenance record; it survives any user deletion and is
  never rewritten by a link event.
- **On link:** `onLinkAccount` re-parents the guest's `draft` and
  `pending_review` contributions to the real account (FK integrity),
  while the attribution snapshot stays original. Published
  contributions keep their original attribution display.
- **On prune / deletion without linking:** the retention job prunes
  only anonymous users with no owned rows (`auth.md` §6.3), so
  contributions are never orphaned by pruning. If an anonymous user
  with contributions is ever deleted another way (e.g. an explicit
  deletion request), the owner FK becomes `NULL`; the contribution
  stays in its queue/state with its attribution snapshot intact and
  its public label still "guest".
- The M0 PoC (ADR 0001) already must verify `onLinkAccount` throw
  semantics; it now also verifies that a throw leaves both the
  anonymous user and its contributions intact (no partial re-parent,
  no orphaned FK).
- **No internal identifiers are ever exposed publicly.** The
  attribution snapshot (`originalUserId`, `ownerUserId`) is
  internal-only: moderators and the claim job may read it, but no
  public API response, published page, or shared payload may
  contain a user id, email, or any raw internal identifier. Public
  surfaces expose only the `displayLabel` — "submitted by a
  traveler" for anonymous submissions, or the contributor's chosen
  public display label for signed-in submissions. This holds
  across linking, pruning, and account deletion: re-parenting
  changes the internal owner FK, never the public label.

### 5. Guest IDs alone are not abuse prevention

Clearing cookies mints a fresh anonymous identity, so a ban or
rate limit keyed only on guest id is trivially evaded. Abuse
controls must therefore be layered:

- Per-IP rate limits on anonymous submissions (in addition to
  Better Auth's own rate limiting).
- Per-submission validation (schema, size, duplicate detection).
- The moderation queue itself as the hard gate — nothing anonymous
  publishes without a human.
- Enforcement (rejection, IP-level blocks, content blocks) decided
  in M0/M2; guest-id bans are at most a convenience, never the
  mechanism.

### 6. MVP scope: manual approval only

- **MVP: manual publication approval for every anonymous
  submission.** No auto-publish path for anonymous input, even for
  re-scans matching the existing menu.
- **Future, explicitly not hackathon dependencies:** trust scoring,
  reputation, automated moderation, auto-confirmation fast-paths.
  The existing fast-path note in `data-provenance.md` §6.1 (decide
  in M2) stays a *possible* future decision and must never apply
  to anonymous submissions without a new ADR.

## Consequences

- The contribution gate moves: "submit" is open to guests,
  "publish" is human-gated for everyone, and reviews/profiles stay
  sign-in-gated.
- Moderation load grows with anonymous submissions — the queue and
  the approve/reject UX (M2) must handle guest-owned items with no
  profile to inspect.
- `Contribution` ownership becomes nullable + attribution
  snapshot; the claim/prune jobs must implement §4 exactly.
- Price aggregation must respect the `manual` ≠ `receipt` boundary
  everywhere it groups or displays observations.

## What would change this

- If anonymous abuse overwhelms manual moderation in practice,
  the remedy is stronger pre-moderation controls (stricter rate
  limits, CAPTCHA, image-required submissions) — not silently
  re-gating submission behind sign-in. Re-gating submission would
  need a new ADR, because it reverses this decision's core premise.
- Trust scoring / auto-moderation, if ever introduced, needs its
  own ADR and must define how anonymous submissions earn trust
  without an account.
