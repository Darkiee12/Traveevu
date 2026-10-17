# Traveevu — Customer Design

> Status: PLANNING · Companion to `product.md`, `user-journeys.md`, `demo-scope.md`.
> Audience: customer-UX workstream (`apps/customer`). During BUILD, translate this into `apps/customer/design.md` (app-local, same content, no duplication drift — this file remains the planning source until BUILD starts).
> EXECUTION_MODE = PLANNING — no application code.

## 1. Product Personality

Traveevu is a **confident local companion**, not a travel brochure, not a dashboard, not a chatbot.

| Trait | What it means in the UI | What it never does |
|---|---|---|
| **Warm + street-level** | Food photography leads; market / street-food energy; human tone ("This is a good first phở") | Generic stock-travel imagery, corporate blue gradients |
| **Clear + direct** | One action per screen; prices and uncertainty stated plainly | Jargon ("AI-powered semantic retrieval"), hedging walls of text |
| **Respectful guest** | Vietnamese names always shown with diacritics; original wording preserved; staff view treated as a real social moment | Anglicized names, mocking "exotic" copy, infantilizing tourists |
| **Honest about uncertainty** | `Unknown` is a designed state, not a failure | Fake precision, invented averages, green "safe" badges without evidence |
| **Calm under pressure** | The order screen is quiet, large, high-contrast — designed to be held out to a stranger | Cluttered, timer-pressured, ad-like |

**Voice:** Short sentences. Second person for actions ("Pick two dishes you like"), third person for facts ("Cơm tấm is usually served with…"). No exclamation-mark enthusiasm. No "Great question!" / "I'd be happy to help!" filler. Error copy names the problem + the next step ("Page 2 is blurry — retake it?").

## 2. Visual Direction

### 2.1 Identity concept — "Market stall, printed menu, phone in hand"

Visual language borrows from Vietnamese street-food culture without caricature: warm paper, ink, chili/leaf accents, bold dish names, price tags that look like they belong on a stall. The app should feel like a well-designed menu + map, not a SaaS product.

- **Photography first.** Dish cards, dish pages, and restaurant headers lead with real food photos (seed photos must be of the actual dish; never a stock photo of a different dish). No photo → designed placeholder illustration, never a mismatched photo.
- **No generic dashboard chrome.** No sidebar, no stat cards, no data-table aesthetic in the customer app. Navigation is a bottom nav + contextual headers.
- **Map is a tool, not a wallpaper.** Map occupies the top half / full-bleed behind a bottom sheet; it never competes with content for attention.

### 2.2 Color system (tokens — values are proposals, final values live in the versioned design-token set)

| Token | Value (proposal) | Use |
|---|---|---|
| `surface` | Warm paper `#FFF9F0` | App background |
| `surface-card` | White `#FFFFFF` | Cards, sheets |
| `ink` | Near-black warm `#1F1A14` | Primary text, headings |
| `ink-muted` | `#6B625A` | Secondary text — must still pass 4.5:1 on paper |
| `primary` | Deep chili `#C2410C` (burnt orange-red) | Primary actions, active states, price emphasis |
| `primary-contrast` | White | Text on primary |
| `accent-leaf` | Herb green `#2F7D4F` | Dietary / fresh / "confirmed" markers (never alone — always with text/icon) |
| `accent-gold` | Turmeric `#D9A441` | Sparing: badges, highlights, rating stars |
| `warning` | Amber `#B45309` on `#FEF3C7` | Uncertainty, "check this", stale data |
| `danger` | `#B91C1C` | Allergen warnings, destructive actions |
| `border` | `#E8DDD0` | Card / input borders |
| `overlay` | `rgba(31,26,20,0.5)` | Sheet scrims, image overlays |

Rules:

- Color never carries meaning alone. Every color-coded state also has text and/or an icon (allergen = red + ⚠ + "Contains peanut"; uncertainty = amber + "Unknown preparation").
- Primary color is reserved for the single main action per screen. Secondary actions are outlined / ghost.
- Dark mode is **deferred** for the hackathon. The staff view must work in bright daylight (high contrast, large type) regardless.
- Admin appearance config may change these tokens at runtime (see `admin-design.md` §7) — customer code must read tokens, never hardcode hex in components.

### 2.3 Typography

| Role | Proposal | Notes |
|---|---|---|
| Display / dish names | A high-legibility grotesque with character (e.g. "Be Vietnam Pro" or system grotesque — decide at BUILD; must support Vietnamese diacritics natively) | Dish names set large; diacritics must render correctly at all sizes — test `ở, ơ, ư, đ, ệ, ộ` explicitly |
| Body | Same family, regular | 16px base minimum on mobile; never below 14px for body copy |
| Price / numbers | Tabular numerals | Prices align; `85,000` never wraps mid-number |
| Staff view | Display size, 24–32px | Legible at arm's length |
| UI labels / chips | 14px medium, uppercase only for short section labels | No all-caps paragraphs |

Multilingual rules (see §8):

- Vietnamese text is never truncated mid-word in a way that hides diacritics; allow wrapping.
- Translated names sit **below** the original name, smaller + muted — original is primary.
- Long translations (e.g. German, French) must wrap; cards grow vertically; no horizontal overflow.
- Line-height ≥ 1.5 for body; ≥ 1.3 for headings. Letter-spacing: none on Vietnamese text (diacritics collide otherwise).

### 2.4 Spacing / grid / shapes

- Spacing scale (4pt base): `4 / 8 / 12 / 16 / 24 / 32 / 48`. Card padding: 16. Screen padding: 16 (mobile), 24 (desktop). Section gap: 24.
- Grid: single column on mobile (max content width 640px centered); two-column card grid on ≥ 768px; map + list split on ≥ 1024px.
- Radii: cards `16px`, chips / filters `999px`, buttons `12px`, bottom sheets `24px` top corners, images `12px` inside cards. No sharp-cornered enterprise cards, no fully pill-shaped food cards.
- Shadows: one soft elevation for cards (`0 2px 12px rgba(31,26,20,0.08)`), one stronger for sheets / floating action buttons. No heavy drop shadows on every element.
- Touch targets: **minimum 44 × 44px** for every tappable element (buttons, chips, pins, stepper controls). This is a hard rule, not a guideline.

## 3. Layout & Navigation

### 3.1 Bottom navigation (mobile)

Four tabs, always visible: **Discover** · **Map** · **Scan** (center, raised, primary color — the most important action) · **Saved / Profile**.

- Scan is visually dominant (larger, primary-filled) because it is the primary journey.
- Active tab: primary color icon + label; inactive: muted.
- Desktop: same four items in a top header; Scan remains a prominent button.

### 3.2 Headers

- Screen header: title (left) + at most one contextual action (right, e.g. "Edit preferences"). No hamburger menus, no nested drawers.
- Back navigation is a single left chevron; deep-linking must preserve back behavior (dish → restaurant → menu → order is a linear stack, not a modal maze).

### 3.3 Bottom sheets

Used for: map restaurant list, dish quick-view, filter panels, order review (optional).

- Sheet has a visible drag handle, a title, and a close affordance. Half / full snap points; content scrolls inside the sheet, page behind stays stable.
- **No nested modals.** A sheet never opens another modal on top of itself. If a flow needs a second level (e.g. sheet → confirm dialog), the sheet closes first or the flow becomes a full screen.
- Filters live in a sheet on mobile, in a sidebar on desktop — same filter state, same controls.

## 4. Component Patterns

### 4.1 Cards

**Dish card** (discovery / search results):

```
[photo 4:3, or placeholder illustration]
Canonical local name (display, diacritics intact)
Translated name (muted, below)
One-line description · flavor/texture tags (chips)
Typical price range + evidence state · "N restaurants nearby"
Dietary line (with evidence tier — see §6)
```

**Restaurant card** (map list / dish page):

```
Name · distance · open status (only if data exists)
Dish price here vs. typical nearby range (see §5)
Dietary note · [View menu] / [Scan menu]
```

**Menu item row** (interactive menu):

```
Original name + translation · description (1–2 lines)
Price (or "Price not on menu") · dietary flags
[−] qty [+] stepper · size/modifier controls below when selected
```

Card rules: one primary action per card (tap → detail). Secondary actions are explicit buttons, never hidden behind long-press or hover (hover does not exist on mobile).

### 4.2 Search

- Search box is prominent on Discover: large input, placeholder with a rotating example prompt, submit on Enter / search button.
- Below the box: "Understood as" token row (editable tokens with × to remove, tap to change). Tokens are the contract — if the tokens are wrong, the results are wrong, and the user can see why.
- Quick-filter chips below tokens (price, spice, soup/no-soup, dietary). One tap toggles; active state is primary-filled.
- No chatbot thread, no "AI is thinking" streaming text, no suggested follow-up questions styled as conversation.

### 4.3 Map

- MapLibre GL JS, OSM-compatible tiles with attribution always visible.
- Pins: numbered / dish-icon pins (not generic dots). Selected pin enlarges + shows a mini-card; map pans to keep it visible above the sheet.
- Bottom sheet list mirrors pins; selection syncs both ways.
- Price context appears on the card, not as a map label (map stays uncluttered).
- Map controls: zoom + locate-me only. No layers menu, no 3D, no traffic.

### 4.4 Interactive menu (schema-driven renderer)

The renderer maps validated schema nodes to known components — AI never emits components (see `menu-rendering.md`). Visual rules for the renderer:

| Schema node | Component | Visual rule |
|---|---|---|
| `section` | Category header | Sticky within menu scroll; dish count; collapse affordance |
| `dish-card` | Menu item row (§4.1) | Original name primary; translation muted; price right-aligned tabular |
| `quantity` | Stepper `[−] n [+]` | 44px targets; qty badge on card when > 0 |
| `single-choice` | Radio-chip group | One selected; selected = primary-filled chip |
| `multiple-choice` | Checkbox-chip group | Multiple; checkmark + primary border |
| `text-note` | Textarea / input | Placeholder "Anything staff should know?"; marked as request |
| `information` | Info block | Muted background, info icon, plain text |
| `warning` | Warning block | Amber background, warning icon, evidence tier + "Ask staff" guidance |

- Selecting an item expands its controls inline (progressive disclosure). Unselected items show no controls.
- Estimated total is a **sticky footer bar** on the menu screen: total + item count + "Review order" button. When the total cannot be computed, the bar says why ("Total excludes 1 item without a listed price") instead of showing a partial sum.
- Free-text requests are visually distinct (dashed border + "Request — not a confirmed option" label) in both the menu and the order views.

### 4.5 Bilingual order view

Two clearly separated zones on one screen (or a toggle — decide at BUILD; stacked zones preferred for show-to-staff):

- **Your order** (customer language): items, modifiers, quantities, requests, estimated total.
- **For staff** (restaurant language): original dish/modifier names, quantities, translated requests, estimated total. Large type (24–32px), high contrast, generous line spacing. Header copy: "Show this to staff. This is a request, not a confirmed order."
- A "Copy / share" action is optional; no "Submit order" button exists anywhere.

### 4.6 Onboarding

- One question per screen, large type, tappable chips (not dropdowns, not long forms).
- Progress shown as "Step 2 of 5" + thin progress bar; Skip is always visible, same weight as Continue (no dark pattern).
- Favorite-dish picker: search input + suggestion chips + selected chips with ×. Counter `n / 5` always visible.
- Dietary screen: each option is a toggle chip with a one-line explanation of use. Religious requirements appear only as an opt-in free-text / multi-select the user chooses — never pre-filled, never inferred.

## 5. Price Presentation (honest by design)

Price UI must encode evidence, not just numbers:

| Evidence state | Presentation |
|---|---|
| Observed price at this restaurant | `85,000 VND` + "Observed [date]" (muted, small) |
| Typical nearby range (sufficient observations) | `Typical nearby: 40,000–65,000 VND` (median band; footnote "Based on N observations") |
| Observed above typical band | `85,000 VND` + amber tag "Above typical range" |
| Insufficient observations | `Price range unknown nearby` + "Why?" affordance (explains threshold) |
| Price missing from menu | `Price not on menu` (menu item) — excluded from totals with a note |
| Stale observation | Badge "Last observed [date]" + down-weighted in range |

Never show a bare average. Never show a price without a currency code. Never let a stale observation look current.

## 6. Dietary / Allergen Presentation (safety-critical)

Evidence tiers (from `product.md` §3.4) map to fixed UI treatments:

| Tier | UI |
|---|---|
| Known ingredients (on menu / confirmed) | Ingredient list, plain text |
| Common recipe ingredients | "Commonly contains…" + amber "Not confirmed for this serving" |
| Restaurant-confirmed | Green check + "Confirmed by restaurant" (only when actually confirmed) |
| Unknown preparation | Amber warning block: "Preparation unknown — ask staff about [allergen]" |

Allergen warnings: red + warning icon + allergen name in text. Never a bare icon. Never a green "safe" badge derived from absence. The dish page lists allergens with their ADR 0004 status (`present` / `possibly_present` / `confirmed_absent` / `unknown`); a green check appears only for `confirmed_absent` on that specific allergen (restaurant-confirmed). `possibly_present` / `unknown` show a warning, never a safe badge. Dish-level values are labeled as typical recipe, not guaranteed preparation; MenuItem-level values, when present, take precedence for that serving. The menu item shows a compact warning; the order review repeats warnings for selected items.

## 7. Motion

- Purpose: orient, not decorate. Sheet slides up (200–250ms, ease-out); card tap → detail uses a shared-element / fade-slide (≤ 250ms); filter change → list cross-fades, no layout jump.
- Stepper / chip selection: instant state change + subtle scale (≤ 100ms). No bounce, no spring overshoot on primary flows.
- Loading: skeleton cards for lists; shimmer for menu extraction with honest copy ("Reading your menu…"); no spinners on buttons longer than 400ms without a progress state.
- `prefers-reduced-motion`: disable all non-essential animation; sheets appear instantly.
- Motion library: Motion (per stack decision). Do not add a second animation library.

## 8. Multilingual Text Behavior

- Customer UI strings are localized via a locale system (not hardcoded per-language branches). Vietnamese is a first-class locale, not a translation afterthought.
- Diacritics: test every heading style with `ở, ơ, ư, đ, ệ, ộ, ắ, ằ`. No font that drops or misplaces diacritics. No `text-transform: uppercase` on Vietnamese headings (diacritic stacking breaks) — use styled case or leave as-is.
- Long translations: cards grow vertically; buttons wrap to two lines rather than truncating; no `white-space: nowrap` on user-visible text except prices and short tokens.
- Numbers: prices use locale-appropriate grouping (`85,000` / `85.000` per locale) but the underlying value is always exact + currency-coded. Never parse a displayed price back into a number.
- Staff view: original names are never transliterated or "cleaned". If a translation is unavailable, show original + "Translation unavailable" — never a blank.

## 9. Empty / Loading / Error States

| State | Pattern | Example copy |
|---|---|---|
| Empty search results | Illustration + named constraint + one-tap relaxation | "No beef dishes under 50,000 VND nearby. [Show up to 80,000 VND]" |
| No menu on file | Card + CTA | "No menu on file — [Scan it]" |
| No saved items | Illustration + CTA | "No saved dishes yet. Tap ♡ on any dish." |
| Loading list | Skeleton cards (same shape as real cards) | — |
| Menu extraction loading | Progress + honest copy + photo thumbnail | "Reading your menu…" |
| Extraction failed | Retry + manual entry + keep photo | "We couldn't read this menu. [Retry] [Enter items manually]" |
| Network offline | Banner + cached content where available | "You're offline — showing your saved menu." |
| Generic error | Inline error + retry, never a blank screen or a stack trace | "Something went wrong. [Try again]" |

Empty states always offer **one** next action. Error states always offer retry and a way forward. No dead ends.

## 10. Mobile-First + Accessibility

- Viewports to validate (BUILD): 360px, 390px, 430px widths + desktop 1280px. Test with browser automation / screenshots — compilation is not validation.
- Touch: ≥ 44px targets; ≥ 8px gaps between adjacent targets; steppers and chips meet this.
- Keyboard: full flow operable by keyboard (search → select → quantity → review → staff view). Focus visible (2px primary outline). Focus order follows visual order. Sheets trap focus while open; Esc closes sheet/dialog.
- Screen readers: dish cards are labelled with name + price + dietary summary; prices announced with currency; stepper buttons labelled "Increase quantity of [dish]"; warnings are `role="alert"` only for true blockers (allergen conflicts), otherwise `role="status"`.
- Contrast: body text ≥ 4.5:1, large text ≥ 3:1, UI icons ≥ 3:1 against backgrounds. Staff view ≥ 7:1 (bright-daylight use).
- No reliance on color alone (see §2.2), no hover-only affordances, no timed interactions (no auto-dismissing content the user must read).
- `prefers-reduced-motion` respected (see §7). Font scaling: layout must survive 200% text zoom without horizontal overflow.

## 11. What the Customer App Is NOT

- Not a dashboard (no stat cards, no tables, no sidebar).
- Not a chatbot (no conversation thread, no "AI is typing").
- Not a delivery app (no checkout, no payment, no order tracking).
- Not a social app (no feed, no follows, no comments threads — reviews, when implemented, are structured, not conversational; Review is deferred from the MVP — see `domain-model.md` §4.14).
- Not a generic map app (map serves dish-first discovery only).

## 12. Acceptance Criteria (design)

- [ ] First action discoverable in 15–30s on every primary screen with no documentation.
- [ ] All tappable elements ≥ 44 × 44px (audit in BUILD).
- [ ] No nested modals; sheets have one level only.
- [ ] Every price shows currency + evidence state; every dietary claim shows its tier.
- [ ] Vietnamese diacritics render correctly at all sizes; no truncation hides them.
- [ ] Staff view legible at arm's length in daylight (large type, ≥ 7:1 contrast).
- [ ] Keyboard + screen-reader pass on the P1 journey (scan → confirm → select → bilingual order).
- [ ] Narrow (360px) + desktop (1280px) screenshots reviewed in BUILD; no overflow, no clipped text.
