# Traveevu — Admin Design (Runtime Management Studio)

> Status: PLANNING · Companion to `product.md`, `user-journeys.md`, `demo-scope.md`, `customer-design.md`.
> Audience: data/admin workstream (`apps/admin`). During BUILD, translate this into `apps/admin/design.md` (app-local).
> EXECUTION_MODE = PLANNING — no application code.

## 1. What the Admin App Is

The admin app is a **runtime management studio**, not a traditional admin dashboard and not a second customer app.

**MVP studio scope (review amendment 2026-10-16 — locked):** start
with the smallest useful studio — four surfaces only:
1. **Prompt editing** (draft → test against fixtures → publish →
   rollback, contract-gated);
2. **Template management** (author/validate/preview/publish/rollback,
   runtime changes per `menu-rendering.md`, no code);
3. **Media resources** (upload/replace by stable ID, aliases, public vs
   private bucket, cache invalidation);
4. **Scanned-menu inspection + correction** (view original image +
   extraction + uncertainties, field-level corrections, dish mapping,
   version diff, publish/reject) + a **read-only AI Inspector**
   (execution + validation errors + prompt/model versions; re-run /
   side-by-side comparison deferred).
Deferred until the customer experience works: appearance-token
editing beyond the default set, audit export, bulk operations,
a general contributions queue beyond menus, dish/restaurant catalog
editing, user management. Do not build a full CMS before P1 works.
Every deferred surface is a deliberate omission, not a TODO to start
quietly.

Its job: let authorized operators change content and supported configuration **without editing source code or redeploying** — resources, AI prompts, menu templates, menus, appearance tokens — while keeping every change versioned, reviewable, and reversible.

Design priority order: **speed → density → clarity → beauty.** The customer app optimizes for delight; the admin app optimizes for throughput and correctness. An operator doing 50 menu reviews in a sitting must never fight the UI.

What it is not:

- Not a place to write executable code (no code editor for components, CSS, or JS — see §2.5).
- Not a public-facing product (no SEO, no marketing polish, no mobile-first constraint — desktop-first, keyboard-driven).
- Not a place where AI output bypasses validation (published prompts must still satisfy validated output contracts).

## 2. Principles

1. **Density over whitespace.** Tables, compact rows, inline editing, keyboard shortcuts. Information density is a feature here.
2. **Everything is versioned.** Resources, prompts, templates, menus, appearance: every change creates a version with author, timestamp, and reason. Nothing is silently overwritten.
3. **Draft → review → publish → rollback.** No mutation goes straight to production without a review step (except explicitly low-risk toggles, listed in §8). Rollback is one action, not a manual revert.
4. **Preview uses the real renderer.** The admin menu preview renders with the **same underlying menu renderer** as the customer app. If the preview looks right but the customer app looks wrong, that is a bug, not a preview limitation.
5. **Audit everything.** Every admin mutation writes an audit entry (who, what, when, before/after, reason). Audit is append-only and viewable from the affected record.
6. **Authz on every mutation.** No admin route or action ships without an authenticated + authorized + audited check. Read access is also scoped (see §9).
7. **Same renderer, different chrome.** Admin chrome is dense/neutral (see §3); the menu preview pane inside admin uses customer styling, so operators see what travelers will see.

### 2.5 Hard boundaries (non-negotiable)

- No AI-generated JSX / JavaScript / HTML / CSS / template code anywhere. Templates reference a fixed control registry; the renderer maps schema nodes to known components.
- No unrestricted remote CSS/JS execution. Appearance config is versioned design tokens only (§7).
- No publishing a prompt that bypasses its validated output contract. Publish is blocked until contract tests pass (§4).
- No publishing user private data (profile, preferences, order selections, receipt images) as part of shared content. The UI must make this impossible, not merely discouraged.
- No deleting history. Rejection, supersession, and rollback are state transitions; rows are never hard-deleted (except where a legal/privacy erasure requires it, which is itself audited).

## 3. Visual Direction (Admin)

Deliberately different from the customer app. The admin does **not** share the customer visual identity.

| Aspect | Admin choice |
|---|---|
| Layout | Desktop-first; left sidebar nav (Resources · Prompts · Templates · Menus · AI Inspector · Appearance · Audit) + main content + optional right detail pane |
| Density | Compact rows (32–36px), 13–14px body text, tables over cards |
| Color | Neutral grays + one accent (indigo/blue) for actions; status colors only for status (draft / pending / published / rejected / rolled-back) |
| Typography | System / Inter-class grotesque; tabular numerals for prices, token counts, latencies |
| Motion | Minimal: instant state changes, no decorative animation; `prefers-reduced-motion` respected by default |
| Chrome | Visible: breadcrumbs, filters, bulk-action bars, keyboard-shortcut hints |

Status vocabulary (consistent everywhere):

| Status | Visual | Meaning |
|---|---|---|
| `draft` | Gray outline badge | Editable, not live |
| `pending` | Amber badge | Awaiting review |
| `published` | Green solid badge | Live; previous published version retained |
| `rejected` | Red outline badge | Not live; reason recorded |
| `rolled-back` | Gray badge + "Rolled back to vN" note | Superseded by explicit rollback |
| `archived` | Muted badge | Retained, not selectable |

## 4. Workflows

Each workflow below specifies: entry, primary view, key actions, and acceptance criteria. All workflows assume the operator is authenticated + authorized; unauthorized actions are hidden, not merely disabled-with-error (see §9).

### 4.1 Resource Registry

Manage: food images, restaurant images, icons, banners, informational graphics, media references, localized content, resource aliases.

**Entry:** Sidebar → Resources. **Primary view:** searchable/filterable table: thumbnail, resource ID (stable, copyable), kind, aliases, locales, usage count, status, updated.

**Key actions:**

- **Upload / replace:** Upload binary → stored in object storage (public bucket for display assets, private bucket for sensitive evidence — operator must pick correctly; default is private for uploads that are not explicitly display assets). Replacing a resource keeps the same stable ID; old binary retained per version. Metadata (alt text, locale, attribution, license) edited inline.
- **Aliases:** Add / remove aliases mapping a logical name (e.g. `dish:pho-bo:hero`) to a resource ID. Changing the mapping changes what the customer app shows without redeploying.
- **Preview:** Full-size preview + "where used" list (dishes, restaurants, banners referencing this resource).
- **Cache invalidation:** Publish triggers invalidation for affected URLs; operator sees invalidation status (requested / complete / failed) — never silent staleness.
- **Localized content:** Per-locale variants of a resource (e.g. banner copy) edited as rows under the same resource ID.

**Acceptance criteria:**

- [ ] Changing an image updates the customer app without redeploy (verified via preview + invalidation status).
- [ ] Stable IDs never change on replace; old versions retrievable.
- [ ] Private vs. public bucket choice is explicit and recorded; private assets have no public URL.
- [ ] Every change has author + timestamp + reason + audit entry.

### 4.2 Prompt Registry

Manage: AI prompt definitions + versions (tasks: intent extraction, menu extraction, translation, dish matching, recommendation explanation, receipt extraction).

**Entry:** Sidebar → Prompts. **Primary view:** definitions table (task, current published version, draft version, model, last published, last run stats). Detail view: version history + editor.

**Key actions:**

- **Draft editing:** Edit prompt text, variables, model selection, inference parameters (temperature, max tokens, etc. — bounded ranges per task), input/output schema references. Drafts never affect live traffic.
- **Test against saved examples:** Run draft against the fixture set for that task (see `ai-boundaries.md`); results show per-example pass/fail (schema compliance + no-invention checks), latency, token usage, estimated cost. Fixture diff view: expected vs. actual structured output, field-level.
- **Publish:** Blocked until: (a) all contract tests pass, (b) a reviewer (or second operator, if configured) approves, (c) a publish note is entered. Publish creates a new version; previous published version retained.
- **Rollback:** One action — re-publish a previous version as current (creates a new version entry noting rollback source). No manual copy-paste.
- **Audit history:** Every version, test run, publish, rollback recorded with author + metadata.

**AI execution recording (cross-cutting):** Each AI execution records prompt version, model identifier, task, latency, token usage, estimated cost, and input *references* — never raw personal data, receipts, or secrets. Operators inspect executions via the AI Inspector (§4.5), not via raw logs.

**Acceptance criteria:**

- [ ] No draft can affect live traffic; publish requires passing contract tests + note.
- [ ] Test runs show per-fixture pass/fail + cost/latency before publish.
- [ ] Rollback is one action and is itself audited.
- [ ] No prompt version can bypass its output contract (enforced at publish + at execution).

### 4.3 Menu Template Registry

Manage: templates defining how interactive menu presentations are assembled (layout, supported controls, display rules, validation rules, ordering rules, localized presentation, visual config, publication status).

**Entry:** Sidebar → Templates. **Primary view:** templates table (template ID, version, layout, supported controls, status). Detail: editor + preview.

**Key actions:**

- **Author/edit:** Templates authored as YAML or JSON; stored as validated JSONB in PostgreSQL. YAML is an authoring/seed format only — the live persistence mechanism is JSONB. Editor validates against the template configuration schema on every change (inline errors, no silent invalid saves).
- **Supported controls:** Template declares which controls from the fixed registry it uses (`quantity`, `single-choice`, `multiple-choice`, `text-note`, `information`, `warning`, `section`, `dish-card`). Referencing an unknown control is a validation error.
- **Preview:** Template + a sample menu (selectable from fixtures / real menus) rendered with the **same renderer** as the customer app, side by side: desktop + narrow-mobile preview. Preview must show validation behavior (e.g. required modifier missing → error state).
- **Publish / rollback:** Same draft → review → publish → rollback flow as prompts. Publishing a template triggers **presentation cache invalidation** (see §8) — operator sees which cached presentations were invalidated.
- **Version migration:** When a template version changes shape, the registry records a migration note (what changed, whether old snapshots remain renderable, fallback behavior). Old menu snapshots must remain renderable or show an explicit "template no longer supported" state — never a blank screen.

**Acceptance criteria:**

- [ ] Invalid templates cannot be saved/published (schema validation enforced).
- [ ] Preview uses the real customer renderer at two viewports.
- [ ] Publish invalidates presentation cache; invalidation status visible.
- [ ] Introducing a *new executable component* is recognized as a code change, not an admin action (documented in the template editor's help copy).

### 4.4 Menu Management

Manage: scanned menus, extracted items, corrections, version comparison, publication.

**Entry:** Sidebar → Menus. **Primary view:** queue table (restaurant, submitted, source, confidence, status: pending / published / rejected, item count). Filters: status, restaurant, date, confidence band. Bulk actions: assign, approve (only for low-risk, high-confidence items if policy allows — default: individual review).

**Key actions:**

- **Inspect:** Detail view: original image(s) (with zoom), extracted items grouped by category, per-item confidence, per-field uncertainty flags, extraction metadata (prompt version, model, latency, timestamps).
- **Correct:** Inline edit of any extracted field (name, translation, price, category, size, modifier). Correcting a price requires a reason (dropdown + note). Corrections are versioned; original extraction preserved.
- **Dish mapping:** Map each menu item to a canonical dish (search + select) or mark "no canonical match" (creates a candidate for catalog review). Mapping affects discovery (dish pages link to this menu).
- **Compare versions:** Side-by-side diff of two snapshots: added / removed / price-changed / modifier-changed items, with per-item before/after. Diff is the primary view for re-scans.
- **Review uncertainties:** Filter to low-confidence / missing-price / unmapped items; resolve each (confirm / correct / remove).
- **Publish / reject:** Publish makes the menu available for traveler reuse; reject requires a reason (visible to submitter where applicable). Both are audited.
- **Render preview:** "Preview as traveler" opens the customer renderer with this menu + a selectable template, at mobile + desktop widths (same renderer, §2 principle 4).

**Acceptance criteria:**

- [ ] Operator can review + correct + publish a menu without leaving the detail view.
- [ ] Diff view shows added / removed / price-changed items for re-scans.
- [ ] Original extraction is never overwritten; corrections are new versions.
- [ ] Publish/reject requires reason where policy demands it; all actions audited.
- [ ] Preview uses the real customer renderer.

### 4.5 AI Inspector

Developer-oriented investigation of AI behavior. **Entry:** Sidebar → AI Inspector. **Primary view:** execution log (task, prompt version, model, latency, tokens, cost, status, timestamp) with filters.

**Key actions:**

- **Inspect one execution:** Input (redacted references + schema, not raw PII), extracted structured output, validation errors (field-level, with the failing value), prompt + model versions, latency, token usage, estimated cost.
- **Compare against expected fixture:** For fixture-backed executions, expected vs. actual diff, field-level.
- **Manual corrections:** Operator corrects the output; correction is saved as a new fixture candidate / feedback record (feeds eval set, does not silently retrain anything).
- **Re-run:** Re-run the same input against a different prompt version / model for comparison (results shown side by side; re-run does not overwrite the original execution record).

**Acceptance criteria:**

- [ ] Any unexpected extraction can be traced to input + prompt version + model + validation errors in ≤ 2 clicks from the execution log.
- [ ] No raw personal data / receipts / secrets visible in inspector (references only).
- [ ] Re-runs are additive records, never overwrites.

### 4.6 Contribution / Moderation Queue (cross-cutting)

Contributions (menus, price observations, corrections, photos — reviews join when Review ships; Review is deferred from the MVP, see `domain-model.md` §4.14) share one moderation surface, filtered by type. Queue shows: type, submitter display label ("submitted by a traveler" for anonymous submissions — never a user id, email, or raw internal identifier on any public surface; moderators may see the internal attribution snapshot for audit/abuse investigation, never PII), restaurant/dish, submitted time, evidence (image thumbnail / extracted data), status. Actions: approve / reject (+ reason) / request-more-info. Bulk approve only for explicitly low-risk types per policy (default: none). Every decision audited; submitter sees status. Anonymous submissions are never auto-published (ADR 0003).

### 4.7 Appearance Configuration

Manage versioned design tokens + resources: primary/secondary colors, border radii, typography presets, illustration variants, banner resources, supported menu layout presets.

**Key actions:** Edit token values (color pickers with contrast-ratio readout — warn below WCAG AA; radius sliders; typography preset picker). Preview: live preview pane showing customer components (card, button, chip, sheet) in the new tokens + the menu renderer with a sample menu. Publish: versioned, audited, cache-invalidation triggered. Rollback: one action.

**Hard rule:** Tokens only. No custom CSS/JS input, no arbitrary style injection. The editor offers a fixed token schema; anything outside it requires a code change.

**Acceptance criteria:**

- [ ] Token change previews on real customer components before publish.
- [ ] Contrast warnings shown before publish (not after).
- [ ] Publish invalidates affected caches; rollback restores the previous token set.

### 4.8 Audit Log

Append-only, filterable (actor, action, entity, time range). Detail shows before/after diff for the change. Accessible from every record ("View history") and from the sidebar. Export is optional (defer for hackathon unless needed for demo).

## 5. Navigation & Layout (Admin)

- **Left sidebar (fixed):** Resources · Prompts · Templates · Menus · Contributions · AI Inspector · Appearance · Audit. Each shows a pending-count badge where relevant (menus pending, contributions pending).
- **Main content:** List/table view with persistent filters (filters survive navigation within a session). Detail opens as a right pane for quick review, or full page for editing (templates, prompts).
- **Keyboard:** `j/k` or arrow keys to move rows, `Enter` to open, `e` to edit, `a` to approve / `r` to reject (in queues), `/` to focus search, `Esc` to close panes. Shortcuts listed in a `?` help overlay. All actions also reachable by mouse — shortcuts are accelerators, not requirements.
- **Bulk actions:** Checkbox rows + bulk bar (approve / reject / assign). Bulk actions require a single reason and show a confirmation count ("Approve 12 menus?").
- **No nested modals.** Confirmations are inline bars or single dialogs; a dialog never opens another dialog.

## 6. Data Tables (Admin Standard)

- Sortable columns, column visibility toggle, saved filter presets per view.
- Row: compact (32–36px), status badge, primary identifier, key facts, updated time, owner/assignee.
- Pagination (server-side) + total count. No infinite scroll for audit/queue views (position matters).
- Empty states: "No menus pending review" + CTA to the relevant queue / docs link — never a blank table.
- Loading: skeleton rows; error: inline retry bar (never a blank screen).

## 7. Preview & Cache Invalidation Rules

| Published change | Invalidated | Operator sees |
|---|---|---|
| Resource replace / alias change | Customer asset URLs + pages using it | Invalidation status (requested / complete / failed) |
| Prompt publish | Nothing cached for prompts (executions read current published version at call time) | "Live from [time]" confirmation |
| Template publish | Cached menu presentations using that template | Count of invalidated presentations + status |
| Appearance publish | Cached styles / token bundle | Status + preview link |
| Menu publish | Restaurant menu cache, dish-page "served at" lists | Status |

Invalidation failures are **visible errors**, not silent. Operator can retry invalidation from the affected record.

## 8. Publishing Safety Rules

- Drafts never affect live traffic (all domains).
- Publish requires: passing validation (schema / contract tests), a publish note, and (where configured) a second approver.
- Rollback is one action, creates a new version, is audited.
- Low-risk toggles that may skip second approval (explicit list, review at BUILD): none by default — the hackathon default is "every publish is reviewed". If a toggle list is added, it must be documented in this file and enforced in code.
- Failed publish (validation / invalidation error) leaves the previous published version live. Never a half-published state.

## 9. Auth, Authorization & Privacy (Admin)

- **Authentication:** Required for all admin routes. Better Auth
  session (Google Sign-In), centralized in the Effect backend —
  see `docs/auth.md` (ADR 0001). No shared / default credentials;
  no admin access without login.
- **Authorization:** Role-based (`user` / `operator` / `admin` via
  Better Auth admin plugin `role` column; default `user`). Every
  mutation checks role + ownership/scope through server-side
  `RequireAdmin` middleware reading the role from the DB session —
  never from Google claims, never from client-sent values.
  **Google sign-in never grants admin.** Admin is granted only
  explicitly (existing admin, or audited seed allowlist). Unauthorized
  actions are **hidden** in the UI (not shown-disabled) and
  **rejected** server-side (UI hiding is not the enforcement).
- **Audit:** Every mutation logs actor, action, entity, before/after, reason, timestamp. Audit is append-only.
- **Privacy:** Operators see pseudonymous submitter IDs, not raw PII. Receipt images and private evidence open only in the private viewer with access logged. No export of PII from admin. No copying private data into prompt test runs.
- **Secrets:** No secrets in admin UI, logs, or URLs. API keys / credentials managed via Secure Vault / env only, never displayed.

## 10. Accessibility & Responsiveness (Admin)

- Desktop-first, but usable at 1024px width; no mobile layout required for hackathon (operators use desktop). Tables scroll horizontally with sticky first column + sticky header rather than collapsing.
- Keyboard operable throughout (§5 shortcuts). Focus visible. Dialogs trap focus; Esc closes.
- Contrast ≥ 4.5:1 for body text; status badges use text + shape, not color alone.
- Screen-reader labels on icon-only actions; table headers announced; bulk-action counts announced.

## 11. What Admin Is NOT

- Not a code editor (no component / CSS / JS authoring).
- Not a customer-app reskin (different density, chrome, and priorities).
- Not a place to bypass validation (publish gates are enforced server-side).
- Not a raw database browser (all edits go through domain services + validation + audit).

## 12. Acceptance Criteria (Design)

- [ ] Operator can complete a full menu review (inspect → correct → map → publish) in ≤ 3 minutes per menu.
- [ ] Operator can publish a prompt, template, resource, or token change without redeploying, with rollback available in one action.
- [ ] Menu preview in admin is pixel-equivalent to the customer renderer (same component, not a mock).
- [ ] Every admin mutation is authorized + audited; unauthorized actions are hidden and server-rejected.
- [ ] No admin flow allows publishing unvalidated AI output, unvalidated templates, or private user data.
- [ ] Keyboard-only operation works for queue review (open → correct → approve/reject).
