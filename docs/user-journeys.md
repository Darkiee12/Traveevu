# Traveevu — User Journeys

> Status: PLANNING · Companion to `product.md` and `demo-scope.md`.
> Global rule for every journey: **the user understands the main action within ~15–30 seconds without reading documentation.** If a journey cannot meet that, the design is wrong, not the user.

Conventions used below:

- **Trigger** — what brings the user here.
- **Steps** — numbered happy-path flow.
- **Failure / uncertainty states** — what happens when data, AI, network, or user input is missing or untrusted. These are first-class states, not edge cases.
- **Acceptance criteria** — what "done" means for BUILD.

Shared principles across journeys:

- No chatbot-first navigation. Natural-language input appears as a search box with examples, not a conversational agent.
- Every AI-derived claim shows its evidence state. `Unknown` is a valid, visible state.
- No invented restaurants, prices, options, or ingredients — ever.
- Dietary safety is never inferred from absence. See `product.md` §3.4.
- All journeys are mobile-first; desktop is a wider layout of the same flow, not a different product.

---

## Journey 1 — Personalized Onboarding

**Goal:** Capture just enough preference signal to make first recommendations useful, without feeling like a survey.

### Trigger

First launch, or user taps "Personalize" / edits profile from settings.

### Steps

1. Welcome screen: one sentence of value ("Tell us what you like — we'll translate it into local dishes."), two buttons: **Get started** / **Skip for now**.
2. Language: pick preferred language (default: device locale; options include English, Vietnamese for prototype). This sets customer-facing UI + translation target.
3. Origin (optional): country/region picker with search. Used only to suggest familiar dishes. Copy explicitly states it is optional and never determines religion, dietary rules, or taste.
4. Favorite dishes: search + select **up to 5** dishes. System suggests familiar dishes based on origin (if given), but the user can search any dish not shown. Selected dishes appear as removable chips. Counter shows `n / 5`.
5. Dietary needs (all optional, multi-select + free text): dietary restrictions, allergies, religious dietary requirements (only when explicitly provided by the user — never pre-filled from origin). Each selection shows a one-line explanation of how it will be used ("We'll hide dishes that commonly contain this and flag uncertainty.").
6. Taste + budget (optional, one screen, sliders/chips): spice tolerance (none → love heat), willingness to try unfamiliar foods (cautious → adventurous), typical budget per meal (ranges in user's currency; stored as currency + band, not a precise number).
7. Done: "You're set." → lands on dish discovery with 2–3 starter recommendations and a visible **Edit preferences** affordance. Skipped users land on the same screen with generic popular dishes and a non-blocking "Personalize" banner.

### Happy path

User completes steps 1–5 in under ~90 seconds, selects 2–3 favorites, sees immediately relevant recommendations.

### Failure / uncertainty states

| State | Behavior |
|---|---|
| User skips everything | Full app remains usable; generic ranking; banner offers personalization later. No blocking. |
| Favorite dish not found in search | Free-text entry allowed; stored as a user-provided dish label with `unmatched` status. Used for similarity explanation only, never presented as a canonical dish. |
| User selects 5 favorites, tries a 6th | Inline message "You can pick up to 5 — remove one to add another." No error modal. |
| User changes origin after picking favorites | Favorites are kept; suggestions refresh. No silent deletion. |
| Network fails mid-onboarding | Selections persist locally; sync retries silently; user can continue. |
| User edits profile later | All fields editable; changes re-rank recommendations immediately; no "re-onboarding" flow. |

### 15–30s rule

Within 15–30s the user sees the welcome screen, understands the single action ("pick dishes you like"), and can skip entirely. No wall of text, no account creation gate.

### Acceptance criteria

- [ ] Entire onboarding completable or skippable in ≤ 90s on mobile.
- [ ] Favorite-dish picker supports search beyond initial suggestions; max 5 enforced inline.
- [ ] No field infers religion, dietary rules, or taste from nationality/origin.
- [ ] All nonessential fields skippable; skip path yields a usable app.
- [ ] Preferences editable after onboarding without restart.

---

## Journey 2 — Dish-First Discovery with Natural-Language Intent

**Goal:** Go from a vague craving to a ranked list of real dishes, with reasons the user can trust.

### Trigger

User opens the app, or taps search on any screen.

### Steps

1. Search box with rotating example prompts (e.g. "Something local, spicy, with beef, under 100,000 VND, but not soup"). User types freely or taps an example.
2. Optional quick filters as chips (no form): price band, spice, soup / not soup, dietary-safe candidates, distance. Filters are additive and removable with one tap.
3. AI interprets input into **validated structured intent** (dish characteristics, ingredients to include/exclude, price ceiling + currency, dietary constraints, meal context). The app shows a compact "Understood as:" line with editable tokens (e.g. `spicy ✓` `beef ✓` `≤ 100,000 VND ✓` `no soup ✓`) so the user can correct misinterpretation without retyping.
4. Deterministic retrieval + ranking returns dishes: hard constraints enforced by query logic (price, exclusions, dietary flags), soft ranking by preference similarity, availability, price evidence, meal context.
5. Each dish card shows: photo (if available), canonical local name + translated name, one-line description, flavor/texture tags, typical price range with evidence state, dietary suitability summary ("contains peanut — commonly" / "unknown preparation"), and "restaurants nearby" count.
6. Tap a card → dish page: full details (aliases, ingredients, allergens, origin, meal occasion, flavor/texture, similar familiar foods, typical price range, nearby restaurants serving it). Regional variants listed explicitly where they exist (variant-labelled menu items grouped on the dish page; no separate `DishVariant` table — ADR 0002).
7. From the dish page, user can go to map (Journey 3) or to a restaurant's menu (Journey 4).

### Happy path

User types one sentence, sees "Understood as" tokens, corrects one token, gets 5–10 relevant dishes in < 3s, taps one, understands it without translation tools.

### Failure / uncertainty states

| State | Behavior |
|---|---|
| Intent is ambiguous ("something good") | Show clarifying chips ("Spicy? Meaty? Soup?") instead of guessing; one tap refines. No chatbot thread. |
| Intent contains a constraint with no matching dishes | Empty state names the constraint ("No beef dishes under 50,000 VND nearby") + one-tap suggestions to relax it. Never silently drop the constraint. |
| Price evidence insufficient for a dish | Price line reads "Price range unknown nearby" with a "Why?" affordance — never a fabricated average. |
| Dietary suitability unknown | Card shows "Preparation unknown — ask staff" rather than a green check. |
| Dish has no photo | Placeholder illustration (not a stock photo of a different dish). |
| AI intent parse fails validation | Fall back to keyword search over dish names/ingredients; show "Showing keyword results" notice. Never show unvalidated AI output. |
| Location unavailable / denied | Discovery still works (city-level ranking); distance filters hidden; banner explains "Location off — showing city-wide results." |

### 15–30s rule

Search box + one example prompt are visible immediately. User can type and see results without onboarding, account, or tutorial.

### Acceptance criteria

- [ ] NL intent is shown back as editable tokens before/above results.
- [ ] Hard constraints (price ceiling, exclusions) are never silently relaxed; relaxation requires explicit user action.
- [ ] Every dish card carries price-evidence and dietary-evidence states.
- [ ] Empty states name the blocking constraint and offer one-tap relaxation.
- [ ] Invalid AI output never reaches the UI (schema validation + keyword fallback).

---

## Journey 3 — Map + Local Price Intelligence

**Goal:** Answer "where nearby serves this dish, and what should I expect to pay?"

### Trigger

User taps "Map" / "Nearby" from a dish page, discovery results, or bottom nav.

### Steps

1. Map centers on user location (or HCMC D1 fallback if location denied). Restaurant pins for the selected dish (or all restaurants when no dish is selected).
2. Bottom sheet lists the same restaurants as cards, synced with the map: tapping a card highlights its pin and vice versa.
3. Filters in the sheet header: dish, distance (500m / 1km / 2km / 5km), price band, dietary suitability, restaurant attributes (e.g. seating, open now — only where data exists), relevance to preferences. Filters apply instantly; result count updates.
4. Each restaurant card shows: name, distance, dish price at that restaurant (if observed) vs. **typical nearby range** (median + percentile band where evidence suffices), dietary note, and a "View menu" action when a menu exists.
5. Price context example: `Cơm tấm — 85,000 VND · Typical nearby: 40,000–65,000 VND`. When the observed price sits above the typical band, the UI labels it ("Above typical range") without moralizing.
6. Tap a restaurant → restaurant page (menus, dishes served, price observations, reviews) → "View menu" enters Journey 4 if a menu is available.

### Happy path

User sees 3–8 nearby pins for their dish within seconds, compares dish-level prices at a glance, picks a restaurant, opens its menu.

### Failure / uncertainty states

| State | Behavior |
|---|---|
| Too few price observations | Price line reads "Not enough observations for a typical range" + shows individual observed prices (if any) with dates. No average presented as fact. |
| No restaurants serve the dish nearby | Empty map state: "No restaurants serving [dish] within 2 km" + one-tap widen radius / "See all dishes nearby". |
| Location denied | Map centers on District 1 default; distance filters disabled; banner explains. |
| Restaurant has no menu on file | Card shows "No menu on file — scan it" action (feeds Journey 4/5 contribution flow). |
| Price observations are stale (> configurable age, e.g. 90 days for demo) | Stale badge ("Last observed Mar 2026") + reduced prominence in range computation; never silently treated as current. |
| Map tiles fail to load | List view remains fully usable; retry affordance; attribution still shown. |

### 15–30s rule

Map + pins + bottom-sheet list render on first open; the first filter tap is visible without scrolling or opening a menu.

### Acceptance criteria

- [ ] Map and list stay in sync (selection in one highlights the other).
- [ ] Price context uses median/percentile bands where evidence suffices; otherwise explicit "insufficient evidence".
- [ ] Stale observations are labeled and down-weighted, never silently treated as current.
- [ ] Restaurant cards distinguish "dish price here" from "typical nearby range".
- [ ] Map works (list fallback) when tiles or location fail.

---

## Journey 4 — Menu Scan → Interactive Menu → Bilingual Order (PRIMARY)

**Goal (the demo):** A traveler enters an unfamiliar restaurant, scans its menu, understands the dishes, selects an order, and shows a bilingual order summary to staff.

This is the highest-priority journey. All other journeys support it.

### Trigger

User taps **Scan menu** (home, restaurant page, or map card) and points the camera at a physical menu — or picks a menu photo from the gallery. Alternatively, the user opens a restaurant that already has a trusted menu (skip to step 4).

### Steps

1. **Capture.** Camera view with framing guidance ("Fit the full menu in frame"). One shutter button. Multi-page menus: "Add another page" loop. Retake affordance per page. File validation: image type/size limits enforced before upload.
2. **Extract.** Progress state with honest copy ("Reading your menu…") — no fake percentage. The photo is sent to our backend and the AI provider for **private processing** (processing is not publication; disclosed before scanning — see `data-provenance.md` §5.2). AI extracts structured menu data: original names, translated names, descriptions, prices + currencies, categories, sizes, options, modifiers, quantity pricing, instructions. Original wording preserved.
3. **Confirm.** Review screen lists extracted items grouped by category, each with original name + translation + price. Uncertain items are flagged ("Low confidence — check price") and editable inline. User corrects names/prices, removes hallucinated items, adds missing ones. **Confirming the extraction lets the traveler order — it does not publish or share anything.** Contributing the menu is a separate, explicit action (Journey 5).
4. **Interactive menu.** The confirmed menu renders as an interactive ordering UI (schema-driven; see `menu-rendering.md`): browse categories, read dish explanations, select items, choose sizes / documented modifiers, set quantities, add special requests. Estimated total updates live. Dietary warnings/uncertainties appear inline on affected items.
5. **Review order.** Order review screen: selected items in user's preferred language + original names, quantities, modifiers, special requests, estimated total (when supported by menu data). Clear distinction: confirmed restaurant options vs. free-text requests ("Restaurant may not support this — ask staff").
6. **Bilingual staff view.** One screen, two halves (or toggle): customer view (user's language) + staff view (restaurant's language: original dish/modifier names, quantities, special requests translated, estimated total). Large type, high contrast. Copy states plainly: "Show this to staff. This is a request, not a confirmed order." User shows phone to staff. No payment, no submission, no implication of acceptance.

### Happy path

Scan → confirm (1–2 corrections) → select 2 items with a size choice → bilingual summary in under ~2 minutes. Staff can read the order without an app, account, or integration.

### Failure / uncertainty states

| State | Behavior |
|---|---|
| Blurry / cropped / glare photo | Extraction flags low-confidence items; user is prompted to retake specific pages ("Page 2 is blurry — retake?"). No silent guessing. |
| Menu in mixed languages | Each item keeps its original text; translation fills per-item; untranslatable items show original + "Translation unavailable". |
| Menu has modifiers (sizes, toppings, spice levels) | Rendered as `single-choice` / `multiple-choice` controls from the schema. Modifiers not in the menu are never offered. |
| Menu missing prices for some items | Those items show "Price not on menu" and are excluded from the estimated total with a note ("Total excludes items without listed prices"). |
| Extraction invents an item / price | User deletes it in Confirm step; deletion is recorded (feeds AI-eval fixtures + moderation signal). |
| AI extraction fails / times out | Retry affordance; option to enter items manually; original photo retained for later retry. |
| Estimated total cannot be computed | Total area reads "Total unavailable — some prices missing" instead of a partial sum presented as final. |
| User adds a free-text special request | Marked "Request — not a confirmed restaurant option" in both language views. |
| Staff cannot read the screen (brightness / language) | Staff view uses large type; toggle to original-language-only; no reliance on color alone. |
| Restaurant already has a trusted menu | User is offered "Use existing menu (verified [date])" vs. "Scan again". Re-scan compares against existing menu and surfaces changes (see Journey 5). |

### 15–30s rule

The **Scan menu** action is visible within 15–30s of opening the app. Camera opens in one tap. The user never has to find a tutorial to start scanning.

### Acceptance criteria

- [ ] Scan → confirm → select → bilingual summary works end-to-end on a real printed menu photo.
- [ ] Confirm step is mandatory before any menu is saved/shared.
- [ ] Uncertain / low-confidence extractions are flagged and editable; never silently published.
- [ ] Estimated total is shown only when all selected items have prices; otherwise the gap is explicit.
- [ ] Staff view preserves original names/modifiers; special requests are translated and marked as requests, not confirmed options.
- [ ] No payment, submission, or "order placed" language anywhere.
- [ ] Reuse path: existing trusted menu is offered before forcing a re-scan.

---

## Journey 5 — Contribution & Menu Reuse

**Goal:** Every confirmed scan improves the platform for the next traveler, without leaking private data or publishing unverified claims.

### Trigger

User confirms a menu extraction (Journey 4, step 3) and is offered "Share this menu to help future travelers", or a user submits a correction / price observation / review from a dish or restaurant page.

### Steps

1. After confirmation, contribution prompt: what will be shared (extracted menu items, prices, restaurant identity, extraction timestamp, observed menu timestamp if known, source, confidence) and what will **not** be shared (profile, preferences, order selections, photos of receipts, identity, internal identifiers — public attribution is only a display label, "submitted by a traveler" for anonymous submissions). One-tap **Share** / **Keep private**. Note: the menu photo was already sent for private extraction (Journey 4, step 2); sharing applies to the extracted data, and the photo itself is never published without explicit moderation.
2. Shared menu enters moderation: `pending` → `published` / `rejected` (with reason). Admin reviews original image, extracted items, uncertainties, and dish mappings (see `admin-design.md`).
3. Versioning: a new observation for the same restaurant creates a new `MenuSnapshot` version; history is preserved. A re-scan is compared against the current published menu and changes are surfaced ("3 prices changed, 1 item added").
4. Reuse: the next traveler opening that restaurant sees "Menu from [date], verified [status]" and uses it directly without scanning. Staleness is labeled.
5. Corrections: any user can flag an item ("Wrong price", "No longer served", "Wrong translation") with an optional note. Corrections enter the same moderation queue and, once accepted, create a new version — never silently overwrite history.
6. Other contributions (reviews, price observations, food photos) follow the same pattern: submit → provenance recorded (source, timestamp, confidence) → moderation → publication. Receipt submissions keep raw images private by default.

### Happy path

User shares a menu; the next traveler at the same restaurant opens it instantly and orders without scanning.

### Failure / uncertainty states

| State | Behavior |
|---|---|
| User declines to share | Menu still works for their own order; nothing is published; no nagging. The unsubmitted scan image is deleted per the retention rule (`data-provenance.md` §5.2). |
| Contribution conflicts with published menu | Both versions retained; moderation resolves; user sees "Under review" if they revisit. |
| Receipt contains personal / transactional info | Raw image stays private; only extracted price observations (with taxes/discounts/combos noted) enter the public pipeline after review. |
| Correction is disputed | Provenance + history preserved; moderation decides; no silent overwrite. |
| Spam / abusive UGC | Moderation queue + rejection with audit trail; submitter sees status, not silent disappearance. |

### 15–30s rule

The Share / Keep-private choice is one screen, one tap each, with a plain-language summary of what is shared. No legalese wall.

### Acceptance criteria

- [ ] Sharing is opt-in, per-menu, with an explicit list of what is / is not shared.
- [ ] Menu changes create versions; history is never silently overwritten.
- [ ] Re-scan diff (added / removed / price-changed items) is shown before publication.
- [ ] Private data (profile, order selections, receipt images) is never published with shared menus.
- [ ] Every contribution carries provenance (source, timestamp, confidence, status) and an audit trail.

---

## Cross-Journey Notes

- **Navigation:** Bottom nav (mobile): Discover · Map · Scan · Saved / Profile. Scan is always one tap away.
- **Saved state:** Favorite dishes, saved restaurants, and recent menus persist across sessions for signed-in users (Better Auth + Google). Guests hold an in-progress draft on the device via an anonymous-plugin session; signing in claims it into the account (`onLinkAccount`) without losing the current menu/order. Sign-in is offered at save moments and for reviews / persistent contributor profiles (ADR 0003: submitting evidence does not require sign-in), never as a gate in front of scanning, ordering, or submitting evidence. See `docs/auth.md` §6.
- **Offline:** Reading a previously loaded menu / order summary must work without network where feasible; scanning requires network for AI extraction (stated honestly in UI).
- **Language switching:** Changing preferred language re-renders customer views immediately; staff view always preserves original names regardless of UI language.
