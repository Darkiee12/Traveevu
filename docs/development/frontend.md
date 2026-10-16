# Frontend — Conventions

> Two TanStack Start apps: `apps/customer/` (traveler app) and
> `apps/admin/` (runtime management studio). Same stack, different
> visual identities: customer = distinctive, travel/food, cross-cultural;
> admin = dense, fast, clear workflows.
>
> **TanStack Start 1.0** stable (2026-10-13). **Security:**
> `@tanstack/react-start >= 1.168.60` (CVE-2026-102989). Verify the pin
> at `BUILD` start; do not ship below it.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | TanStack Start 1.0 + React | SSR, file routing, SEO-friendly public pages |
| Routing | TanStack Router | Type-safe routes; file-based |
| Server state | TanStack Query | All API reads via Query; mutations via Query mutations |
| Forms | TanStack Form | Validators are contract Schemas via Standard Schema interop |
| Styling | Tailwind CSS v4 | Utility-first; design tokens via CSS vars |
| Components | shadcn/ui (owned source) | Accessible primitives; copy into `packages/ui`, customize there |
| Icons | Lucide | No emoji icons in UI |
| Motion | Motion | Small, purposeful transitions; respect `prefers-reduced-motion` |
| Maps | MapLibre GL JS | OSM-compatible; attribution required; no Google scraping |
| Validation | Effect Schema from `packages/contracts` | Single source of truth; no duplicate Zod/form schemas |

Do not add a package because it is popular. Every dependency needs a
reason in the PR that introduces it.

## Architecture: thin frontends, shared contracts

- **Routes load data; components render it.** Route loaders call the
  Effect API through TanStack Query. Components receive typed props.
  Business rules live in the backend or in shared pure functions in
  `packages/*` — never duplicated in a component.
- **All wire data is validated** against `packages/contracts` at the
  fetch edge. A response that fails decoding is an error state, not a
  render attempt.
- **Forms validate with contract Schemas** via TanStack Form +
  Standard Schema. No hand-written parallel validation rules.
- **State:** TanStack Query for server state; local `useState` / router
  search params for UI state; OrderDraft lives in the backend
  (private, per-user) with an optimistic local mirror at most. No
  global client store for domain data.
- **Shared UI** lives in `packages/ui` (primitives + tokens). App-local
  components live in the owning app. Customer and admin do **not**
  share page-level components.

## SSR / SEO

- **Public dish and restaurant pages are SSR + SEO-friendly:**
  server-rendered HTML with real content, canonical URLs, `<title>` /
  meta description, Open Graph tags, and structured data where it fits.
  They must render meaningfully without JavaScript (progressive
  enhancement: interactive menu/order flows need JS, but dish
  information must not).
- Interactive flows (menu selection, order draft) are client-rendered
  on top of SSR shells; loading states are skeletons, not blank pages
  or spinners that replace content.
- Do not `noindex` public pages by default; do not index admin routes
  or private order views.

## Mobile-first, accessibility

- **Mobile-first always.** Design and build for a narrow phone viewport
  first (320–430px), then expand to desktop. Touch targets ≥ 44px.
  Bottom sheets and thumb-reachable primary actions for ordering flows.
  Test on real narrow viewports, not just responsive-mode drag.
- **Accessibility is a gate, not polish:** semantic HTML, keyboard
  navigation for every interactive element, visible focus states,
  sufficient contrast, `aria-*` where semantics need it, alt text on
  images, form labels (never placeholder-only), and screen-reader
  announcements for dynamic results (menu loaded, order updated).
- **Multilingual text behavior:** UI strings localized; long
  translations must not overflow cards/buttons (test Vietnamese +
  English at minimum); never truncate a price, dish name, or warning
  to fit a layout — wrap or resize the layout.
- **Motion:** subtle, fast (≤ 300ms for UI transitions), disabled under
  `prefers-reduced-motion`. No motion that blocks interaction.

## States: loading, empty, error, offline

Every data-driven view implements all four:

- **Loading:** skeleton matching the eventual layout (card skeletons,
  menu skeletons). No full-page spinner for in-flow navigation.
- **Empty:** explain why it's empty + one clear next action
  ("No restaurants serve this dish nearby — try widening distance" +
  button). Never a bare "No results."
- **Error:** what happened in plain language + what the user can do
  (retry, go back, try another restaurant). Retry is a button, not a
  page reload instruction. Log the technical detail; show the human one.
- **Offline / slow network:** degraded but honest — cached content
  labeled as cached, order draft preserved locally, no silent loss of
  a user's selections.

## Schema-driven renderer (the menu system)

- **The renderer consumes validated structured data + a template
  definition.** It maps schema nodes to known React components from a
  fixed registry. It never evaluates AI-generated code.
- **Supported controls (fixed registry):** `quantity`,
  `single-choice`, `multiple-choice`, `text-note`, `information`,
  `warning`, `section`, `dish-card`. A template may only reference
  controls in this registry. Adding a control is a code change +
  review — never a runtime/admin action.
- **AI never generates components.** AI emits menu extraction data
  (validated against the extraction schema). The template registry
  supplies presentation rules. The renderer produces the UI. Any
  proposal to render AI-produced JSX/HTML/JS is rejected.
- **Form validation is dynamic but deterministic:** validation rules
  come from the template + the snapshot (required choices, min/max
  quantities, allowed options) — computed in code, never by the LLM.
- **Free-text special requests** are allowed but visually distinguished
  from confirmed restaurant options ("request — not guaranteed").
- **Bilingual order view:** user locale + restaurant locale side by
  side; original dish/modifier names preserved verbatim; translated
  special requests labeled as translations; estimated total shown only
  when supported by menu data; clearly labeled as a *request to
  communicate*, not a confirmed order.

## Maps

- MapLibre GL JS with an OSM-compatible tile source. Include required
  attribution on every map view.
- Respect tile-provider rate limits; cache tiles per provider terms.
  Never scrape Google Maps.
- Map interactions: pan/zoom, tap pin → bottom sheet with restaurant
  summary, filter chips (dish, distance, price, dietary, attributes)
  that update the list + map together. Map is a view of the list, not
  a separate data source.
- A list view must always exist alongside the map (a11y + low-bandwidth).

## Design system

- Customer and admin each have a `design.md` (customer: product
  personality, visual direction, typography, color, spacing, grid,
  component shapes, card composition, motion, iconography, photography,
  map interactions, navigation, form behavior, empty/loading/error
  states, mobile a11y, multilingual behavior; admin: density, speed,
  clarity). Implement from those docs, not from memory.
- **Design tokens are versioned data**, not hardcoded hex values
  scattered through components. Runtime appearance changes (primary
  color, radii, typography presets, banner resources, menu layout
  presets) come through the appearance configuration in the studio —
  within the versioned token set. No unrestricted remote CSS/JS.
- Do not build a generic dashboard-style customer app. Distinctive
  identity for travel + food + cross-cultural experience.

## Anti-patterns (rejected in review)

- Chatbot-first navigation; nested modal flows; tiny touch targets;
  excessive confirmations; long instructional text; unexplained AI output.
- Business logic, price math, or dietary verdicts in components.
- AI-generated JSX / HTML / JS / CSS rendered at runtime.
- Hand-duplicated schemas (form validation, API shapes) — use contracts.
- `any` props, untyped route params, unvalidated API responses.
- Layouts that overflow or clip on Vietnamese text or narrow viewports.
- Shipping a frontend change without inspecting it on mobile + desktop.
