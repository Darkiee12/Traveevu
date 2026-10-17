# Traveevu — Menu Rendering Architecture

> Status: PLANNING — no application code. Companion to `architecture.md`, `domain-model.md`, `ai-boundaries.md`, `data-provenance.md`.
> Core rule: **AI produces validated structured data. Known code renders it. AI never produces executable UI code.**

## 1. The boundary (normative)

```
Extraction (evidence)  →  Presentation (validated)  →  Renderer (known code)  →  OrderDraft (private)  →  Bilingual order view
   MenuSnapshot /               MenuPresentation            React components          user selections        customer lang + originals
   PublishedMenuRevision        template + revision         from registry           + free-text notes
   + confidence                 (or private snapshot)
```

| Stage | What it is | Who/what produces it | Mutable? |
|---|---|---|---|
| Extraction | `MenuSnapshot`: items, prices, options, uncertainties, confidence, provenance (from a `MenuCaptureSession`; ADR 0006) | AI extraction + user confirmation | Append-only; corrections = new snapshot + new revision |
| Presentation | `MenuPresentation`: validated tree of schema nodes, bound to a template version | Pure deterministic builder: `buildPresentation(menuSource, templateVersion)` where `menuSource = PublishedMenuRevision \| MenuSnapshot` | Derived; never edited directly |
| Renderer | React code mapping presentation nodes → known components | Hand-written code in the repo | Code change only |
| OrderDraft | User selections against one pinned `menuRef` (published revision *or* private snapshot) | User interaction + deterministic math | User-private; editable until confirmed for display |
| Bilingual order view | Read-only display: customer language + original local names/modifiers | Deterministic render from OrderDraft + pinned source originals | Derived |

**Forbidden:** AI-generated JSX, JavaScript, arbitrary HTML, CSS, or template code. If a payload contains executable code, it is rejected by validation and never reaches the renderer.

## 2. Canonical menu extraction schema

The extraction schema is the contract between AI extraction and everything downstream. Defined once in `packages/contracts` as Effect Schema. (Full field list in `ai-boundaries.md` §2.2; this doc defines how it flows into rendering.)

```text
MenuExtraction → (user confirmation) → MenuSnapshot.extraction {
  restaurantRef?: { name?, locationHint? }   // evidence only, not identity
  categories: [{ id, originalLabel, translatedLabel?, sortOrder }]
  items: [{
    id,                      // stable within snapshot
    originalName,            // verbatim — never overwritten
    translatedName?,          // nullable
    description?,             // verbatim/extracted; null if absent
    categoryId?,
    price?: { amount, currencyCode } | null,
    sizes?: [{ id, label, translatedLabel?, priceDelta? }],
    options?: MenuItemOption[],   // see §3 — only if printed on menu
    quantityPricing?: string | null,
    dishMapping?: { dishId | null, confidence, matchType },
    confidence: number,
    uncertainties: Uncertainty[]
  }]
  currencyHints: string[]
  uncertainties: Uncertainty[]
  overallConfidence: number
}
```

**Rules:**

- `originalName` is verbatim. Translations are a separate nullable layer.
- Missing price → `null`, not 0, not "typical".
- Missing description → `null`, not an LLM-invented description.
- Options/modifiers come from the menu image only. No invented options.
- Uncertainties travel with the data into the presentation so the UI can show them (e.g., "price unclear — please confirm with staff").

## 3. Template configuration schema

Templates define **how** a presentation is assembled — which controls are allowed, in what order, with what validation and display rules. They do not contain data or code.

```text
MenuTemplateVersion {
  templateId, version, layoutId,           // e.g. "standard-menu-v1"
  supportedControls: ControlId[],          // subset of registry in §4
  displayRules: {
    showCategories: boolean,
    showPrices: boolean,                   // false only if prices unknown — never hide known prices
    showDietaryWarnings: boolean,
    showUncertaintyBadges: boolean,        // default true
    groupByCategory: boolean,
    sortItemsBy?: enum
  },
  validationRules: {
    requireQuantity: boolean,
    maxQuantityPerLine?: number,
    requireChoiceForRequiredOptions: boolean,
    specialRequestMaxLength?: number
  },
  orderingRules: {
    categoryOrder?: string[],              // or "as-printed"
    itemOrder?: enum                        // "as-printed" | "price-asc" | "price-desc"
  },
  localeSettings: {
    supportedLocales: string[],
    fallbackLocale: string,
    showOriginalAlongsideTranslation: boolean  // default true
  },
  visualConfig: {
    density?: enum,                        // compact | comfortable
    cardStyle?: enum,                      // references known design tokens only
    bannerResourceId?: string | null       // stable resource ID, not a URL/code
  },
  status: enum                             // draft | published | deprecated
}
```

**Rules:**

- Templates are authored as YAML/JSON and stored as **validated JSONB** in Postgres. YAML is authoring/seed only, never live persistence.
- Published template versions are immutable. Editing = new version.
- A template may only reference control IDs in the registry (§4) and design tokens in the versioned design system. It cannot introduce a new component, a new CSS rule, or executable code. A completely new executable component requires a code change + deploy.
- Publishing a template runs the same validation as execution (schema + control-registry + token checks). Published templates never bypass validated contracts.

**Runtime changes without deploy (review amendment 2026-10-16 — locked):**
Extraction and presentation are separate by construction — the AI
output contract is `MenuExtraction` data only; it never names a
template, a control, or a layout. Through the admin studio, an
operator can, with **no code change and no redeploy**: create a new
template version (new layout, control subset, display/validation/
ordering rules, locale settings, visual config within known tokens),
validate it, preview it against a real menu with the real renderer,
publish it, and roll back to a previous version. Publishing flips
the "current published template" pointer and invalidates cached
presentations built from the old version (cache key §7.1); existing
`OrderDraft`s stay pinned to the presentation they were built from.
What runtime changes can **never** do: add a new control, change a
control's behavior, add CSS/JS, or bypass schema validation — those
are code changes. If a requested presentation cannot be expressed
with the existing registry, that is a signal to add a control in code,
not to stretch a template into code.

## 4. Supported control registry (the ONLY controls the renderer knows)

The renderer maps presentation nodes to **known React components**. AI and templates may only *select and configure* these controls — never define new ones.

| Control ID | Purpose | Props (validated) | Example |
|---|---|---|---|
| `section` | Group items (category, header) | `title`, `translatedTitle`, `items[]` | "Món chính / Mains" |
| `dish-card` | One menu item: name, translation, description, price, warnings, uncertainties | `itemRef`, `showPrice`, `showWarnings` | Cơm tấm card |
| `quantity` | How many | `min`, `max`, `default`, `step` | 1–10 |
| `single-choice` | Pick exactly one (size, spice level if printed) | `options[]`, `required`, `defaultChoice?` | Size: Nhỏ / Vừa / Lớn |
| `multiple-choice` | Pick 0..N (toppings/add-ons if printed) | `options[]`, `minSelections`, `maxSelections` | Add-ons |
| `text-note` | Free-text special request | `maxLength`, `placeholder`, `label` | "Less spicy, please" |
| `information` | Read-only info (description, allergen note, "ask staff") | `text`, `tone` | "Contains fish sauce (commonly)" |
| `warning` | Dietary / uncertainty warning | `text`, `severity`, `evidenceLevel` | "Preparation unknown — ask staff about peanuts" |

**Rules:**

- Every node in a `MenuPresentation` has `control: <ControlId>` + `props` validated against that control's schema. Unknown control ID → presentation rejected, never rendered.
- `props` are data only: strings, numbers, enums, references. No functions, no code strings, no HTML.
- The renderer is hand-written React. Adding a control = code change + registry update + tests. Templates cannot add controls.
- Accessibility: every control renders with label, focus state, touch target ≥44px, and error text (see customer design doc in planning).

## 5. Menu presentation schema

`MenuPresentation` is the validated output of `buildPresentation(menuSource, templateVersion)` where `menuSource = PublishedMenuRevision | MenuSnapshot` (ADR 0006):

```text
MenuPresentation {
  menuRef,                          // { kind: published_revision, revisionId } | { kind: private_snapshot, snapshotId }
  sourceKind,                       // published_revision | private_snapshot
  templateId, templateVersion,
  restaurantRef: { id, name, translatedName? },
  locale: string,                  // presentation locale
  coverage, coverageNote?,         // MenuCoverage + note — UI shows coverage limitations
  observedAt?, publishedAt?,       // source snapshot dates / revision publish date — UI shows dates, never live-availability guarantees
  nodes: PresentationNode[],       // tree: section → dish-card → controls
  warnings: PresentationWarning[], // global: e.g. "menu may be outdated"
  estimatedPriceNote?: string,     // "Prices as printed; totals are estimates"
  builtAt: timestamp
}
PresentationNode {
  id, control: ControlId,
  props: <validated per-control props>,
  children?: PresentationNode[]
}
```

**Rules:**

- Building is **pure + deterministic**: same (menuSource, templateVersion) → same presentation. No AI in the builder. No randomness, no timestamps inside node content (only `builtAt` metadata).
- Presentation is **derived, not stored as source of truth**. It may be cached (see §7); rebuilding is always possible from revision/snapshot + template.
- The builder resolves: category grouping, item ordering, locale (translation + original side-by-side), **item-level dietary evidence** (user-independent: e.g. "contains peanuts — known" — the *per-user* warning "matches *your* allergy" is a separate overlay computed from `UserPreference` + presentation evidence, never stored in the shared cached presentation; ADR 0006 §2.10), uncertainty badges, and price display (integer minor units + currency).
- The builder never invents options, prices, or ingredients. If the source lacks them, the presentation shows unknown / omits the control.
- Form validation rules come from the template (`validationRules`) + control schemas. Validation runs client-side (TanStack Form, Standard Schema) **and** is re-checked deterministically when the order draft is created — client validation is UX, server validation is enforcement.

## 6. Form state & validation

- **Form state** lives in the customer app (TanStack Form), bound to the presentation nodes. State shape: `{ lines: [{ itemRef, quantity, selectedOptions: [{ optionId, choiceIds[] }], specialRequest }] }`.
- **Validation:**
  - Required options must have a selection.
  - Quantity within `[min, max]`; integer.
  - `multiple-choice` within `[minSelections, maxSelections]`.
  - `specialRequest` within `maxLength`; free text is allowed but **marked unconfirmed** (see §8).
  - Selections must reference options that exist in the pinned snapshot. A selection referencing an option not in the snapshot is rejected — this blocks invented modifiers from any source.
- **Dynamic behavior:** Options may show/hide based on other selections **only** if the snapshot/template declares that dependency (e.g., "size L unlocks extra topping group"). No AI-driven dynamic behavior.
- **Totals:** Computed deterministically from snapshot prices + selections. If any selected line has unknown price, the total is `null` + note "Total cannot be estimated — one or more prices unknown". Never estimate a total from guessed prices.
- **Dietary warnings:** Computed deterministically when selections change (from known ingredient evidence + uncertainty). Warnings are informational; they never auto-remove an item (user decides), but a severe-allergy warning must be prominent and require explicit acknowledgment to proceed — decide exact interaction in customer design doc.

## 7. Template version migration & cache invalidation

### 7.1 Cache key (ADR 0006 §2.10)

- Shared menus: **`(publishedRevisionId, templateVersion, locale)`**.
- Private menus (ordering from a private snapshot): **`(snapshotId, templateVersion, locale)`**.
- New published revision → new key (old presentations remain valid for old revisions; drafts pin their `menuRef`).
- Corroboration does **not** invalidate (same revision id — an equivalent scan strengthens evidence without changing public content).
- New published template version → new key; derived presentations rebuild. **Publishing a template never mutates stored snapshots or revisions.**
- Cache invalidation is by key versioning, not by arbitrary TTL alone. TTL may exist as a safety net, but version keys are the primary mechanism.

### 7.2 Template version migration policy

- Templates are versioned; presentations record which template version built them.
- When a new template version publishes, existing `OrderDraft`s are **not** migrated — they stay pinned to their snapshot + the presentation they were built from. A user starting a new order gets the new template.
- Breaking changes to the control registry (removing/renaming a control) require: (a) a code change, (b) a registry version bump, (c) templates that reference the removed control fail validation until updated. No silent fallback to a different control.
- Old snapshots and revisions remain renderable: the builder must support all published template versions that reference the current registry, or the template is marked `deprecated` and its presentations rebuild on the latest compatible template with a visible note. Preserve compatibility with previously stored snapshots/revisions — never require re-scanning because a template changed.

### 7.3 Revision interplay (ADR 0006)

- `OrderDraft` pins `menuRef` (published revision *or* private snapshot). If the current pointer moves to a different revision while a draft is open (new publish or rollback), the UI offers: "Menu updated — review changes" (diff: added/removed/price-changed items and options) with the choice to keep the old draft or refresh onto the current revision (explicit, confirmed re-pin + line re-validation). Never silently rebase a draft onto a new menu. If the pinned revision was withdrawn, the refresh offer says so.
- Menu-change detection: compare a candidate snapshot vs the current published revision's content (`diffMenus` — normalized deterministic comparison on normalized name + price + options + portion/variant context; ADR 0006 §2.6). Equivalence → corroboration (no new revision). Meaningful changes → moderation. Surface to moderators and, where useful, to users.

## 8. Bilingual order representation

`OrderDraft` → bilingual order view (read-only, show-to-staff):

```text
BilingualOrderView {
  draftId, menuRef,   // pinned published revision or private snapshot (ADR 0006 §2.9)
  customerLocale: string, restaurantLocale: string,   // e.g. "en" / "vi"
  lines: [{
    quantity,
    customerName, customerModifierLabels,   // user's language
    originalName, originalModifierLabels,    // restaurant's language, verbatim
    lineTotal?: { amount, currencyCode } | null,
    specialRequestCustomer?: string,         // user's language (as typed)
    specialRequestStaff?: string | null,     // translated to restaurant language; null if untranslated
    specialRequestStatus: "confirmed_option" | "unconfirmed_request"
  }],
  estimatedTotal?: { amount, currencyCode } | null,
  dietaryNotes?: string[],                   // e.g. "Customer reports peanut allergy — please confirm"
  disclaimers: string[]                      // "This is a request, not a confirmed order" (both languages)
}
```

**Rules:**

- **Staff view preserves originals:** original dish names, original modifier names, quantities. Staff never see only a translation.
- **Customer view** uses the user's preferred language.
- **Special requests:** free-text requests are translated into the restaurant's language (AI translation task, validated) but are **clearly distinguished** from confirmed/guaranteed options — visually marked "request — please confirm with staff". If translation fails or is uncertain, show the original text + a note, never a guessed translation.
- **Estimated total** shown only when all line prices are known; labeled estimated. If any price is unknown, show "Total unknown — please confirm prices with staff".
- **No false confirmation:** The view must clearly state (both languages) that this is a request to communicate, not an accepted order. No "Order placed", no order number that implies acceptance, no payment UI.
- **Privacy:** The bilingual view contains no user profile, preferences, or order history — only this draft's selections.

## 9. Sample interaction (end-to-end)

```
1. Menu photo(s) → `MenuCaptureSession` (private, token-based for guests) → AI extraction → validated MenuExtraction (unknown stays unknown)
2. User confirmation / correction → private `MenuSnapshot` (draft) with per-page evidence + coverage
3. buildPresentation(private snapshot, template V) → validated MenuPresentation
4. Renderer maps nodes → dish-card / quantity / single-choice / multiple-choice / text-note / warning
5. User selects items, sizes, modifiers, quantities, special requests
   → validation (template rules + snapshot options) → OrderDraft (pinned to private snapshot via `menuRef`)
6. Deterministic totals + dietary evidence (+ per-user warning overlay) → bilingual order view
7. User shows phone to staff. No submission, no payment.
8. (If eligible + confirmed) Contribution → moderation → `PublishedMenuRevision` (new revision referencing the approved snapshot) reusable
   by the next traveler WITHOUT re-scanning (same revision, same template).
```

**Reuse rule:** The customer must not need to scan the same menu again if a sufficiently recent and trusted version is already available. "Sufficiently recent and trusted" = current published revision for (restaurant, scope), with its observation date (`observedMenuAt` / `capturedAt`), verification date (`publishedAt`), and coverage shown. The UI always shows the menu's dates + coverage and offers "Re-scan if this looks outdated". Menus change over time — recency is displayed, not assumed. Pending contributions never change the public menu.

## 10. Admin preview

- The studio's menu preview uses the **same renderer** as the customer app wherever practical (shared renderer code / same presentation builder). An admin correcting a menu sees exactly what the customer will see.
- Admin corrections to a menu materialize a candidate snapshot + (on approval) a new published revision (never silent overwrite) and rebuild the presentation. The preview shows the new revision + a diff vs the current revision.
- The AI Inspector can show, for a snapshot: extraction payload, uncertainties, prompt version, model, validation errors, latency/tokens, and the human corrections applied — so a developer can understand why an extraction produced an unexpected result.

## 11. Security constraints (renderer-specific)

- No executable code in any presentation node, template, or extraction payload. Validation rejects code-like props (functions, `<script>`, event-handler attributes, `javascript:` URIs).
- All rendered text is escaped by React by default; never use `dangerouslySetInnerHTML` for AI/template content. If rich text is ever needed, it must come from a validated, allow-listed subset — out of MVP scope; plain text only in MVP.
- Template `visualConfig` references known design tokens + resource IDs only. No remote CSS/JS, no inline styles from templates.
- User input (special requests) is rendered as plain text, never interpreted as markup or instructions.

## 12. Open questions

1. **Renderer sharing mechanism** — shared package (`packages/ui` / renderer) imported by both frontends vs duplicated thin wrappers: decide in M0; sharing is preferred if it does not couple the frontends' visual identities.
2. **Severe-allergy acknowledgment interaction** — exact UX (modal vs inline confirm) decided in customer design doc; must be prominent, not dismissible by accident.
3. **Menu-change diff UX** — how prominently to surface "menu may have changed" to a returning traveler: decide in M2 with real scan data.
4. **Offline / cached menus** — whether a published menu is cached on-device for offline viewing: deferred; MVP requires network for scan, may allow viewing a cached presentation.
