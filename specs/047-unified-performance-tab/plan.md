# Implementation Plan: Unified Performance Tab

**Branch**: `047-unified-performance-tab` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/047-unified-performance-tab/spec.md`

## Summary

Replace the Quick Performance Test and Performance Plans tabs with one **Performance** tab: an entry screen (source
picker, saved plans, recent runs) that opens a five-step path (Source, Operations, Plan, Load, Run). The path
**hosts the existing plan panes** (chain tree, step editor, data sets, load profile, thresholds, launch card,
results) instead of rebuilding them, by extracting the plan editor's load/save/analysis state into a hook that the
path's steps share. Backend changes are limited to one additive endpoint, `POST /api/chain-plans/:planId/reselect`,
which makes "change operations without losing edits" possible for specification plans. No stored entity changes.

Reading the code showed that the design mock simplifies the plan model and that three spec statements do not match
the product as built (write acknowledgement, workflow selection, load controls). They are listed under **Spec
reconciliation** and need a decision before `/speckit-tasks`.

## Technical Context

**Language/Version**: TypeScript on Node.js 24 LTS (existing)

**Primary Dependencies**: React, Vite, Tailwind CSS v4, Express (all existing); no new dependency

**Storage**: Existing local database for chain plans, runs and data sets (unchanged); session-held quick test
(unchanged); new UI state is in-memory only

**Testing**: Vitest, React Testing Library with jsdom, Supertest (existing); AI-independent, no model, no network

**Target Platform**: Local web application, desktop first, usable at phone width

**Project Type**: Web application (npm workspaces: `backend`, `frontend`, `packages/shared-domain`)

**Performance Goals**: Selecting, filtering and ticking operations stays responsive for specifications with several
hundred operations; reselect completes in the same order of time as seeding that selection

**Constraints**: Deterministic reselect (no clock or randomness beyond existing id counters); nothing sent to any
environment before Start; no new external call; the existing upload limit and validation unchanged; no stack traces,
paths or internals in error bodies

**Scale/Scope**: One tab, one new page and about eight new components, one extracted hook, one new endpoint, catalogue
and routing changes in `App.tsx`, reshaping of about eight test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I, XIV Specification is the source of truth; no silent assumptions | Pass. Reselect derives chains from the specification only; the plan states where the spec and the product differ instead of choosing silently |
| II, III, IV, V, VI AI | Not applicable. No AI involved |
| IX Separation of concerns, X Domain model first | Pass. Edit-state helpers and request types go to `shared-domain`; reselect logic in the backend seed module, route stays thin; the path is presentation |
| XI Human in the loop | Pass. Re-selection that would drop edited work needs explicit confirmation; reset asks first |
| XVI, XXIV Deterministic, reproducible | Pass. Same plan and selection give the same result; covered by contract tests |
| XVII Security and privacy | Pass with a note. No request is sent before Start. The write-gate decision (R6) must be taken consciously; credentials found while reselecting are dropped and listed, never kept in the clear |
| XIX Fail safely | Pass. Typed errors, nothing changed on refusal; stale revisions use the existing conflict path |
| XX Observability without sensitive logging | Pass. One log event with counts only |
| XXI Testability at every boundary | Pass. Contract tests for reselect, hook tests, component tests per step |
| XXV Incremental delivery | Pass. Three independently shippable phases (below) |
| XXVI Specification traceability | Pass. Requirements map to phases; research items map to decisions |
| XXVII Prefer simple architecture | Pass. No stepper framework, no state library; reuse existing panes, dialog and stepper pattern |
| XXXI Definition of done | Applies. Includes documentation, roadmap entry and version bump (project rule) |
| XXXII Review at real scale | Pass. Filters and select-all/clear-all on Operations and in the panel (R12) |
| XXXIII Presentation consistency | Pass. Same tokens, dark mode, responsive and accessibility rules; stepper follows `ImportRunStepper` |

**Gate result**: PASS. No violation to justify. Re-check after design: PASS (the one additive endpoint is within
IX and XXV; it narrows, rather than breaks, 037 FR-026 as recorded in R2).

## Spec reconciliation (decide before `/speckit-tasks`)

The spec was written from the mock. These items conflicted with, or over-promised against, the product as built. All
six were resolved on 2026-10-11 (`/speckit-clarify`, four asked and two factual corrections) and the spec now matches.

| # | Spec text | Product reality | Resolution (applied to the spec) |
|---|---|---|---|
| 1 | FR-028, US1 scenario 6, SC-005: a write acknowledgement is required before Start | Specs 032 and AP-029 state there is no extra confirmation; AP-040's launch card names the target and lists writes beside Start | Amend to "names the environment and lists every write beside Start". Do not add a new gate (R6) |
| 2 | FR-026: presets (smoke, load, stress) and four fields | Staged load profile with five starting profiles, thresholds, think time, environment | Amend to "the existing load controls" (R5) |
| 3 | FR-008, US4 scenario 1: workflows listed and selectable, collections listed | Workflow seeding takes no selection; collection selection lives in Import & Run | Workflows seed whole as today; collections reuse Import & Run's request selection (R8) |
| 4 | FR-017: reset rebuilds steps from the source | Plans also own data sets, load profile, thresholds | State that reset keeps those and runs (R4) |
| 5 | Assumption "no existing API contract change" and the request "no backend change" | A merge needs one additive endpoint | Accept the endpoint (R2) and annotate 037 FR-026 |
| 6 | FR-016 "edited step" | Edit state is per step (`changed`) inside single-step chains | Use the definition in R3 |

## Project Structure

### Documentation (this feature)

```text
specs/047-unified-performance-tab/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── mock-unified-performance.html
├── contracts/
│   ├── reselect-api.md
│   └── changes-to-existing-apis.md
├── checklists/requirements.md
└── tasks.md              # created by /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── requestChain.ts                      # + ReselectRequest/Outcome types, isChainEdited, seededOperationKeys, isPlanEdited

backend/src/
├── api/chainPlans.ts                    # + POST /:planId/reselect (thin: validate, call service, map errors)
└── performance/chain/seed/
    └── reselectService.ts               # new: merge/reset over existing seedFromSpecification pieces
backend/tests/                           # + contract and unit tests for reselect

frontend/src/
├── App.tsx                              # one `performance` view; `onOpenChainPlan` keeps its name and opens the Plan step; mount flag
├── components/
│   ├── workflowCatalog.ts, sectionCatalog.ts, EntryIllustration.tsx   # one entry, reuse plans tone
│   └── performance/path/                # new
│       ├── PerformanceStepper.tsx       # five steps, lock reasons as text, aria-current
│       ├── SourcePicker.tsx             # four source cards
│       ├── SourceStep.tsx, OperationsStep.tsx
│       ├── PlanStep.tsx, LoadStep.tsx, RunStep.tsx   # host the extracted plan panes
│       ├── ChangeOperationsPanel.tsx    # side panel, reuses OperationSelection
│       ├── DraftBanner.tsx
│       ├── PerformancePath.tsx          # header, stepper, step body, Back and Next
│       ├── EnvironmentForCredentials.tsx   # shared with SeedPlanDialog
│       └── pathState.ts                 # pure: step gating, entry step, transitions (unit-testable)
├── components/requestChain/
│   ├── useChainPlanSession.ts           # new: extracted from ChainPlanEditor (load, save, analysis, runs, environments)
│   ├── ChainPlanEditor.tsx              # becomes a thin composition, kept while Phase 1 lands, then removed
│   ├── OperationSelection.tsx           # + text and method filters
│   ├── ChainsPane.tsx, SetupPane.tsx, RunPane.tsx   # new: tab bodies extracted from ChainPlanEditor, hosted by the path steps
│   └── PlansIntro.tsx, SeedPlanDialog.tsx   # PlansIntro retired; SeedPlanDialog stays for the other entry points
├── components/performance/
│   ├── PerformanceHome.tsx, RecentRuns.tsx   # new: picker, plans table, recent runs (fan-out over 10 plans), legacy runs
├── pages/
│   ├── PerformancePage.tsx              # new: hosts the home and the path
│   ├── QuickPerformancePage.tsx, RequestChainPlansPage.tsx   # removed after parity
├── services/requestChainClient.ts       # + reselectPlan()
└── hooks/usePerformancePath.ts          # new: PathState reducer over pathState.ts, in memory
frontend/tests/unit/                     # new tests per component; reshaped tests per research R13
docs/USER_MANUAL.md, docs/architecture.md, specs/ROADMAP.md      # updated at completion
```

**Structure Decision**: Web application layout already in use. New UI lives in `components/performance/path/` next
to the existing performance components; plan editing logic moves into one hook so each step renders a slice of the
same state, avoiding duplicate load/save logic (CLAUDE.md §59, §60). Pure step/gating logic sits in `pathState.ts`
so it is unit-tested without rendering (CLAUDE.md §25, §43).

## Delivery phases

| Increment | Stories | Content | Backend |
|---|---|---|---|
| 1 (MVP) | US1, US2 | Unified tab shell, entry screen, path with the specification source, hook and pane extraction, saved plans and recent runs, open-plan flow, catalogue and routing merge, reshaped tests | reworded message only |
| 2 | US3 | Reselect endpoint and shared helpers, Change operations panel, merge, edited-removal warning, Reset to seed, source-changed guard | one endpoint |
| 3 | US4 | Empty plan, collection and workflow sources in the path, hand-over wiring from Import & Run and the guided workflow | none |
| 4 | US5, then US6 | Draft parking and Resume, Start-screen badge, specification replacement | none |

Each increment is shippable alone once increment 1 is complete. The two old tabs keep working, untouched, until the
removal task at the end of US2 (T030); nothing is demoed or merged before US1 and US2 are both done. Until increment 2
lands, Operations on an existing plan is a read-only summary (T029).

## Risks

- **Hook extraction** (largest): `ChainPlanEditor` is about 600 lines with a save queue and revision handling. Only
  the first 140 lines and the tab structure were read in detail for this plan; confirm the split during Phase 1 task
  breakdown and keep behaviour covered by the existing editor tests before moving code.
- **Reselect correctness**: the credentials chain and chain naming are the subtle part; contract tests in
  `contracts/reselect-api.md` are the guard.
- **Catalogue churn**: eight test files and several modules reference the old ids; do the rename as one commit-sized
  step with the test updates.
- **Mock drift**: the mock shows simplified forms; reviewers should judge it for flow and navigation, not for step or
  load detail.

## Complexity Tracking

No constitution violations. One deliberate exception, recorded for traceability:

| Exception | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Re-deriving newly selected chains on an existing plan (narrows 037 FR-026 "never re-derived") | Lets an engineer change the selection without losing edits, the core promise of FR-016 | Delete-and-recreate loses work; client-side copying duplicates server logic and can leave stray plans (R2) |
