# Research: Unified Performance Tab (AP-047)

Findings come from reading the current code (`QuickPerformancePage`, `RequestChainPlansPage`, `ChainPlanEditor`,
`SeedPlanDialog`, `RunLaunchCard`, `seedService`, `seedFromSpecification`, `ImportRunStepper`, `App.tsx`,
`workflowCatalog`) and the earlier specs (032, 037, 040, 042). Each item lists what was found, the decision and
what was rejected. Items marked **Spec impact** change or contradict the written spec and need a decision before
`/speckit-tasks` (collected in `plan.md`, "Spec reconciliation").

## R1. The mock simplifies what a plan is

**Found**: A real plan (`ChainPlan`, `packages/shared-domain/src/requestChain.ts`) is chains of steps, each with
URL, query, headers, body, expected statuses, extractors, checks, repetition and think time, plus data sets, a staged
load profile, thresholds, a target environment and a seeding report. `ChainPlanEditor` has three tabs (`chains`,
`setup`, `runs`) over one draft-and-save state machine (`draftRef`, whole-plan `savePlan` with a revision check,
local plan analysis on every edit, debug run, script generation). The mock's plan step (a flat list with up, down,
remove) and load step (users, duration, threshold) stand in for these.

**Decision**: The path hosts the existing panes; it does not rebuild them. Steps map to existing content:

| Path step | Hosts |
|---|---|
| Source | New: source summary, quick-test upload and reuse (`fetchQuickTest`, `uploadQuickTest`) |
| Operations | `OperationSelection` for a specification (existing); see R8 for the other sources |
| Plan | The `chains` tab: `ChainTree`, `StepEditor`, `DataSetsPanel`, `PlanIssues`, seeding report |
| Load | The `setup` tab without its launch card: environment, `LoadProfileEditor`, `ThresholdEditor`, think time |
| Run | `RunLaunchCard`, `ChainRunPanel` results, Runs and reports (the `runs` tab) |

**Rejected**: Rebuilding simplified forms (would regress step-level editing and break plan fidelity); keeping the tabs
inside a single Plan step (hides Load and Run, defeating the path).

## R2. Re-selecting operations on an existing plan has no backend support today

**Found**: `POST /api/chain-plans/seed` is create-only. A specification plan is one single-step chain per selected
operation (named by `operationKey`), preceded by a "Credentials" chain only for token sources a selected step
uses (`seedFromSpecification`). Each step records `source: { kind: "operation", operationKey }`, a `seedDigest` and a
derived `changed` flag, so the previous selection and each step's edit state can be derived from the stored plan with
no stored-data change. Spec 037 FR-026 states a plan is "never re-derived from its source".

**Decision**: Add one additive endpoint, `POST /api/chain-plans/:planId/reselect` (contract in
`contracts/reselect-api.md`), covering the merge and the reset. It re-derives only the newly selected operations'
chains and removes deselected seeded chains; it never rewrites a chain the engineer kept. Specification plans only in
the first delivery. This is a narrow, explicit exception to "never re-derived", driven by the selection the engineer
makes, and 037 FR-026 should be annotated.

**Rejected**: (a) Client-only: seed a throwaway plan and copy chains across (leaves stray plans on failure, bypasses
revision checks, duplicates server logic). (b) Forbid re-selection (leaves the engineer with delete-and-recreate,
the problem the spec exists to remove). (c) Re-seed the whole plan on every change (violates FR-016).

**Spec impact**: The spec's Assumptions say no existing API contract changes. The endpoint is additive, but the
description said "no backend change"; this is the one backend addition and needs sign-off.

## R3. Definition of "edited"

**Found**: `ChainStep.changed` is derived on save (content differs from the seed). Steps the engineer added have
`source.kind = "added"` and `seedDigest = null`.

**Decision**: A seeded chain is *edited* when any of its steps has `changed = true` or when it contains a step with
`source.kind = "added"`. Chains the engineer created are not part of the selection and are never removed by a merge.
The plan-level "edited by you" badge is true when any chain is edited, any engineer-created chain exists, or the
chain order differs from the seed order. Reordering chains does not by itself mark a single chain edited.
The FR-016 warning lists the *edited* seeded chains that the new selection would remove, by operation key.

## R4. "Reset to seed" scope

**Decision**: Reset rebuilds the chains from the plan's recorded selection, discarding chain and step edits,
reordering and engineer-added chains. It keeps the plan name, data sets, load profile, thresholds, environment and
saved runs. The confirmation says exactly this. Implemented as `mode: "reset"` on the same endpoint.

**Spec impact**: FR-017 says "rebuilt from the source" and lists "edits to order, removed steps and added steps". It
does not mention data sets, load profile or thresholds; this decision keeps them, and the spec should say so.

## R5. Load step content

**Found**: The real load profile is a list of stages (`LoadStage`: duration, target users), with starting stages for
`smoke`, `load`, `stress`, `spike` and `soak` (`LOAD_PROFILE_STARTING_STAGES`), plus thresholds, think time and an
environment picker. The mock's "VUs, duration, p95 threshold" fields are an illustration.

**Decision**: Load hosts the existing editors unchanged. **Spec impact**: FR-026 should read "the existing load
profile, threshold, think-time and environment controls, with their validation and starting profiles"; remove the
three-preset and four-field wording.

## R6. Write acknowledgement conflicts with existing behaviour

**Found**: Spec 032 (and AP-029 before it) states there is no extra confirmation on any tier; instead `RunLaunchCard`
names the target and lists every write it sends beside the Start button (AP-040). The mock's tick-box
acknowledgement is new.

**Decision**: Keep the existing behaviour (named target and listed writes next to Start; no new gate). The run is
still only ever started by the engineer's explicit act (constitution XVII).

**Spec impact (conflict)**: FR-028, Acceptance 1.6 and SC-005's "explicit acknowledgement" clause add a gate that
contradicts the established product rule. Either amend them to "names the environment and lists every write beside
Start" (recommended) or record a deliberate behaviour change with its own rationale. CLAUDE.md §63 and §68 require
this to be decided, not assumed.

## R7. Session state and "Back to start"

**Found**: `App.tsx` keeps each standalone view mounted once reached (`quickPerformanceMounted`,
`performancePlansMounted`), so React state survives "Back to start" and tab switches; the quick test also lives
server-side for the session. A browser reload clears React state but not the server-held quick test or saved plans.

**Decision**: Draft, open plan, step, selection and unsaved fields live in the mounted page's React state (in memory),
exactly like the other views. Nothing new is persisted. After a reload the draft is gone, saved plans and the uploaded
specification remain. The spec's "until the engineer discards it or the session ends" is met with that meaning.

**Rejected**: Persisting drafts to storage (new storage surface, privacy review, not asked for).

## R8. Workflow and collection sources in the path

**Found**: Workflow seeding takes no selection: `{ kind: "workflow" }` seeds one chain per approved workflow and
one per other operation, and requires the guided workflow to be complete through Postman generation. Collection
seeding needs `collectionId` and `orderedRequestIds`; choosing and ordering requests today lives in
`ExternalCollectionRunPanel`. The spec's Operations step ("Workflows", "Requests", all selected) assumes selection
UIs and, for workflows, a selection API that do not exist.

**Decision (delivery in phases, see plan)**: Phase 1 supports specification and empty plan fully. Workflow and
collection cards in the picker start the path on a source summary step (what will be seeded, and any precondition
such as "finish the guided workflow first") using the existing seed contracts, with the selection controls reused
from the collection run panel for collections. A workflow selection (choose which approved workflows) is out of
scope until a spec amendment adds `selectedWorkflowIds` to the seed contract.

**Spec impact**: US4 Acceptance 1 ("lists that source's workflows or requests, all selected") over-promises for
workflows. Amend to: workflows are seeded whole, as today; collections show a collection picker and request
selection reused from Import & Run.

## R9. Stepper component

**Found**: `ImportRunStepper` (AP-042) already provides the pattern: clickable steps, lock reasons as text,
`aria-current="step"`, theme tokens with no `dark:` overrides.

**Decision**: Build `PerformanceStepper` as a sibling that follows the same visual rules and the same lock-reason
mechanism. Do not generalise `ImportRunStepper` in this change (CLAUDE.md §58, §60); note it as a follow-up if a
third stepper appears.

## R10. Catalogue, colour and routing migration

**Found**: Two catalogue entries (`quick-performance`, `performance-plans`) are referenced in `App.tsx`,
`sectionCatalog.ts`, `EntryIllustration.tsx`, `CountedOperationList.tsx`, `legacyRunsClient.ts`, and 8 test files.
Colour tokens `--color-wf-quick` and `--color-wf-plans` exist in light and dark. `legacyRunsClient` labels runs from
the retired quick plan as "Quick performance test".

**Decision**: One entry `performance` (tab label "Performance") reusing the plans tone (`wf-plans`). Remove the quick
entry and its token only after confirming nothing else reads `wf-quick` (the grep found only the catalogue and
the two token blocks). Keep the legacy label text, because it describes historical runs. `onOpenChainPlan` stays as
the handover from other views, keeping its name so no consumer changes, and now opens the unified tab on the Plan step
(spec 037 FR-020 intent preserved). The "spec path hand-over" from the old Quick page disappears with the page.

## R11. Backend quick-performance routes

**Found**: `GET/POST /api/quick-performance` hold the session's uploaded specification and are the seed source.
`seedService` throws "Upload a specification in Quick performance test first." when it is missing.

**Decision**: Keep both routes and their contract unchanged. Reword the one user-visible message to "Upload a
specification in Performance first." (contract text updated in `contracts/changes-to-existing-apis.md`).
No route is renamed (renaming has no user benefit and breaks stored run source labels).

## R12. Review at scale (constitution XXXII)

**Found**: A real specification can have hundreds of operations. `OperationSelection` supports select all and
individual choice; the mock adds search.

**Decision**: The Operations step keeps select-all/clear-all and adds a text filter and a method filter, and the
Change-operations panel reuses the same component. Counts always show chosen of total. No per-item-only interaction.

## R13. Tests to reshape

`App.test.tsx`, `EntryChooser.test.tsx`, `workflowCatalog.test.ts`, `QuickPerformancePage.test.tsx`,
`ChainSeedEntryPoints.test.tsx`, `CountedOperationList.test.tsx`, `LegacyRunsView.test.tsx`,
`WriteOperationSummary.test.tsx` and `performanceFixtures.ts` reference the old ids or pages. They are updated, not
deleted; any test that is removed is replaced by one asserting the same behaviour through the unified tab.

### R10 inventory (T002, 2026-10-11)

References to the old ids and pages before the merge: `App.tsx`, `EntryIllustration.tsx`, `ExternalCollectionRunPanel.tsx`,
`CountedOperationList.tsx` (comment only), `PerformanceTestingStage.tsx`, `SeededPlans.tsx`, `sectionCatalog.ts`,
`workflowCatalog.ts`, `index.css`, `ExternalCollectionsPage.tsx`, `QuickPerformancePage.tsx`, `RequestChainPlansPage.tsx`,
`TestGenerationWorkflowPage.tsx`, `legacyRunsClient.ts` (historical label, kept), `quickPerformanceClient.ts` (kept), eleven
test files, `packages/shared-domain/src/performance.ts` (comments), `docs/USER_MANUAL.md`, `docs/architecture.md`.
`--color-wf-quick` was read only by `workflowCatalog.ts` and defined in `index.css` (light and dark); both are removed.
The merge removed `QuickPerformancePage`, `RequestChainPlansPage`, `ChainPlanEditor` and `PlansIntro`. The editor's state and tab bodies
live on in `useChainPlanSession`, `ChainsPane`, `SetupPane` and `RunPane`, and its 19 tests became `PerformancePlanEditing.test.tsx`
(pending bar and Runs-tab label assertions are replaced by the Run step's launch card, which carries the same blockers).

