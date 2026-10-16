# Agent Workflow — Multi-Agent Engineering Harness

> Companion to `AGENTS.md` and the planning-pack `README.md`.
> `EXECUTION_MODE = PLANNING` — this document governs how work is
> organized once `BUILD` is authorized. It does not itself authorize `BUILD`.

## Principles

1. **Contracts first, code second.** No parallel implementation until the
   shared contracts for the slice are merged, reviewed, and stable.
1b. **Orchestration (review amendment 2026-10-16 — locked):** do NOT
   enforce four parallel agents from the beginning. Muse (orchestrator)
   establishes shared contracts first, then delegates **bounded work,
   one workstream at a time, to independent worktrees** — scaling to
   2+ concurrent workstreams only when contracts are stable and the
   workstreams own non-overlapping file sets with no shared-file
   contention. Muse owns integration and architectural consistency,
   is the sole merger to `master` for contracts / renderer / API
   boundaries, and inspects every diff before merge. Parallelism is a
   tool for genuinely independent work, not a default.
2. **Small, reviewable, incremental.** Prefer small diffs merged often
   over large diffs merged at the end.
3. **One owner per shared file at a time.** Coordination beats contention.
4. **Evidence over assertion.** A task is done when its verification
   commands pass and the diff has been inspected — not when an agent says so.
5. **Persistent context in repo files.** Chat history is not a record.
   Decisions, plans, and progress live in `docs/`, `docs/decisions/`,
   and milestone files.
6. **Don't create agents to inflate parallelism.** Spawn a specialized
   agent only when a bounded task genuinely benefits from parallel or
   focused execution.

## Phases

### Phase 0 — Contracts (orchestrator-led, serialized)

- Orchestrator (Muse) identifies for the slice: user journey, domain
  boundaries, shared contracts, technical dependencies, main risks,
  open decisions, acceptance criteria, integration points.
- Contracts land in `packages/contracts` (Effect Schema) + a short
  `docs/decisions/` ADR if the slice changes an earlier decision.
- **Gate:** contracts merged + `bun run check` green. Only then may
  workstream agents start implementation in parallel.

### Phase 1 — Parallel implementation (workstreams, isolated)

- Each workstream works in its own worktree / branch, touching only its
  owned files (see below). Cross-boundary needs go to the orchestrator,
  not to direct edits in another workstream's files.
- Daily (or per-task) integration: rebase onto latest contracts, run
  checks, report via the report template.

### Phase 2 — Integration + review (orchestrator-owned)

- Orchestrator inspects every diff, verifies contract compatibility,
  runs relevant checks, reviews domain boundaries / error handling /
  security, and confirms the feature serves the main user journey.
- Integration is incremental — merge workstream by workstream, fixing
  contract drift immediately, never "at the end."

### Phase 3 — Verification + demo checkpoint

- Run domain tests, AI fixture tests, integration tests, and the
  Playwright mobile journey. Visual inspection on narrow mobile +
  desktop viewports. Record results in the milestone file.
- A milestone is complete only when its acceptance criteria + verification
  commands pass. A feature is not complete until verified.

## Worktrees / isolation

- Use separate worktrees (or equivalent branch isolation) per workstream
  where supported: `git worktree add ../traveevu-<stream> <branch>`.
- One workstream per worktree. Shared files (`packages/contracts`,
  renderer, API boundaries) are edited only by their current owner or
  via an orchestrator-approved contract change.
- Before merging, rebase on the latest `master`, run
  `bun run check && bun run test`, and resolve conflicts with the
  orchestrator — never silently overwrite another workstream's contract.
- Delete the worktree after merge; never leave stale worktrees with
  divergent contracts.

## Workstreams and owned files

| Workstream | Owns | Must not touch without coordination |
|---|---|---|
| **Customer UX** | `apps/customer/**` (routes, components, renderer usage, mobile design, a11y, loading/error/empty states); `docs/customer-design.md` | `packages/contracts`, `apps/api`, renderer *implementation* in shared `packages/ui` (may propose changes via orchestrator) |
| **Domain / backend** | `apps/api/**` except `src/ai/`; `packages/domain/**`; Drizzle schema + migrations; API contracts (jointly with orchestrator) | `apps/customer`, `apps/admin` UI; prompt text; template content |
| **AI pipeline** | `apps/api/src/ai/**` (task services, provider adapters, validation); `fixtures/**` (AI eval fixtures); prompt definitions (drafts — publishing via registry); `docs/ai-boundaries.md` | Business domain logic; renderer; pricing/dietary verdicts (AI proposes, deterministic code decides) |
| **Data / admin** | `apps/admin/**`; registries (resources, prompts, templates); contribution/moderation flows; seed/curation tooling; `docs/admin-design.md` | Customer UX components; core domain services; prompt *execution* semantics |

The orchestrator owns: `packages/contracts` (with domain/backend),
`docs/decisions/`, milestone files, cross-workstream integration, and
final accept/reject on every diff.

## Task contract template

Every delegated task uses this template. No task ships without it.

```markdown
## Task: <short title>
### Objective
<One paragraph: what outcome, for whom, why now.>

### Context
- Milestone: M<n> — <name> (link to docs/milestones/M<n>.md)
- User journey: <link / summary>
- Relevant decisions: <docs/decisions/NNNN-*.md>
- Prior work: <what exists, what to reuse>

### Owned files / modules
- <paths this agent may edit>
- Shared files: <read-only unless orchestrator approves>

### Relevant contracts
- <packages/contracts/... paths + schema names>
- API endpoints: <method + path>
- AI tasks (if any): <task name + input/output schema>

### Constraints
- <e.g. no AI-generated JSX; money = integer minor units; snapshot immutability>
- <e.g. must not touch packages/contracts without approval>

### Inputs
- <fixtures, seed data, designs, prior docs>

### Expected outputs
- <code / docs / tests — concrete files>

### Acceptance criteria
- [ ] <observable, testable criterion>
- [ ] <…>

### Verification commands
- `bun run check`, `bun run test`, `bun run test:e2e` (as applicable)
- <slice-specific commands, e.g. `bun run fixtures:menu`>

### Dependencies on other tasks
- Blocked by: <task / contract>
- Blocks: <task>
- Parallel-safe with: <task>
```

## Report template

Every agent reports in this format on completion (or on handoff).
"Implemented successfully" alone is not a report.

```markdown
## Report: <task title>
### What changed
- <file>: <what + why> (link diff / commit)

### What was tested
- `bun run check` — <pass/fail + output excerpt>
- `bun run test` — <pass/fail, N tests>
- <Playwright / fixture commands> — <result>
- Manual verification: <viewport / flow / screenshot note>

### What remains incomplete
- <explicit gaps, TODOs, follow-ups>

### Architectural concerns
- <contract drift, boundary questions, security notes, tech debt>
- None. (only if genuinely none)
```

## Integration / review checklist

The orchestrator applies this to every diff before merge:

- [ ] **Contract compatibility:** imports only from `packages/contracts`;
      no duplicated schema; API request/response match the contract.
- [ ] **Domain boundaries:** no business rule duplicated in the frontend;
      no AI call in a repository; no pricing/dietary verdict from the LLM.
- [ ] **Error handling:** Effect tagged errors at boundaries; no swallowed
      errors; no `try/catch` converted silently; user-facing errors are
      actionable.
- [ ] **Security:** uploads validated; admin mutations authorized +
      audited; no PII/secrets in logs; no executable content from AI or
      templates; private media stays private.
- [ ] **Data integrity:** snapshots immutable (new version, not edit);
      money = integer minor units + currency; timestamps `timestamptz`;
      listed vs. paid prices kept distinct; dietary tiers preserved.
- [ ] **Journey fit:** the change serves the main scan-to-order journey
      or a named milestone — not a disconnected feature.
- [ ] **Tests:** meaningful tests added/updated; fixture tests for AI
      behavior; Playwright coverage for journey changes.
- [ ] **Visual (frontend):** inspected on narrow mobile + desktop;
      loading / error / empty states present; touch targets adequate;
      translations not overflowing.
- [ ] **Docs:** `docs/decisions/` ADR if a decision changed; milestone
      file updated; `AGENTS.md` updated only if a convention changed.

## Persistent context

- **Decisions:** `docs/decisions/NNNN-<slug>.md` — context, options
  considered, decision, consequences, what would change it.
- **Milestones:** `docs/milestones/M<n>-<slug>.md` — dependencies,
  expected result, ownership, acceptance criteria, validation method,
  current status + evidence.
- **Progress:** update the milestone file on every merge, not in chat.
- **Handoff rule:** any agent must be able to resume from repo files
  alone. If a fact exists only in chat, it does not exist — write it down.

## Common failure modes (do not repeat)

- Parallel implementation starting before contracts stabilize →
  incompatible modules, wasted rework. (Contracts first.)
- Two schemas for the same shape → silent drift. (One schema, in
  `packages/contracts`.)
- "It compiles" treated as "it works" → untested journeys, broken
  mobile layouts. (Run the app; run Playwright; look at screenshots.)
- AI output trusted without validation → invented prices/options.
  (Validate every AI output against its contract; confirm with the user.)
- Big-bang merge → unresolvable conflicts + hidden breakage.
  (Incremental integration, orchestrator-owned.)
- Decisions made in chat and lost → repeated arguments. (ADR in repo.)
```

