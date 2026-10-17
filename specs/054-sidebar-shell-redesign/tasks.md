---

description: "Task list for AP-054 Sidebar Shell and Shared Visual Language"
---

# Tasks: Sidebar Shell and Shared Visual Language

**Input**: Design documents from `/specs/054-sidebar-shell-redesign/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included. The spec requires them (FR-028, SC-003, SC-005, SC-011) and the repository treats tests as part of the feature. Test tasks come before the code they cover and should fail first.

**Scope**: Frontend only (`frontend/`). No backend endpoint, shared-domain type, payload or stored datum changes (FR-025). No new dependency (FR-027). Do not run `git commit`; leave changes for review.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 to US6 from the spec
- Paths are relative to the repository root. Frontend tests live under `frontend/tests/unit/`.

## Phase order and slice mapping

| Phase | Plan slice | Story |
|---|---|---|
| 1 Setup, 2 Foundational | before slice 1 | none |
| 3 | 1 Tokens and guards | US2 (P1) |
| 4 | 2 Shell and routes | US1 (P1) |
| 5 | 3 Patterns and 4 Screens | US3 (P1) |
| 6 | verification of 2 to 4 on narrow windows | US4 (P2) |
| 7 | 5 Home | US5 (P2) |
| 8 | dialogs and text | US6 (P3) |
| 9 | 6 Close-out | none |

US2 precedes US1 on purpose: the colour change lands first, on the old shell, so each slice leaves a working app. Phases 3 and 4 may ship alone.

---

## Phase 1: Setup

- [X] T001 Run `npm test`, `npm run lint` and `npm run build` at the repository root before changing anything; record the pass counts and any pre-existing failure under "Notes" at the end of this file so later regressions are attributable.
- [X] T002 Confirm the isolated dev servers from `quickstart.md` are running (backend on 4100 with `AI_PROVIDER_MODE=mock`, frontend on 5183); the backend is already running in this session, so only start the frontend if it is not. Do not start a second backend.
- [X] T003 [P] Add an address reset to `frontend/tests/setup.ts` (`history.replaceState(null, "", "/")` in the existing per-test cleanup) so hash addresses never leak between tests.

**Checkpoint**: baseline recorded; tests isolated from the address.

---

## Phase 2: Foundational (blocks every story)

- [X] T004 Create `frontend/tests/unit/colourTokens.test.ts` by copying the "no hex colour in `.ts`/`.tsx`" and "no Tailwind palette utility" scans out of `frontend/tests/unit/sectionCatalog.test.ts` (keep `components/WorkflowIcon.tsx` as the one hex exception). Leave `sectionCatalog.test.ts` untouched here; it is deleted in T022. Run it green. This must land before any section code is removed (research D5).
- [X] T005 [P] Extract the focus-trap, Escape and focus-return logic of `frontend/src/components/Dialog.tsx` into `frontend/src/hooks/useFocusTrap.ts`, make `Dialog` use it, and add `frontend/tests/unit/useFocusTrap.test.tsx` (traps Tab and Shift+Tab, Escape calls the close handler, focus returns to the opener). `frontend/tests/unit/Dialog.test.tsx` and `ConfirmDialog.test.tsx` must pass unchanged.

**Checkpoint**: the guards exist independently of the section catalog; the shared trap exists for the drawer and dialogs.

---

## Phase 3: User Story 2 - One colour language in light and dark (Priority: P1)

**Goal**: One lime accent, the literal palette in both themes, 3:1 control outlines, no section, workflow or blue-info colour, left-aligned text. The old shell still stands, recoloured.

**Independent Test**: Open each in-scope screen in both themes; `npm test -w frontend -- contrast` and `-- colourTokens` pass; no white text on lime; no blue or section accent remains except method badges and the three logos (SC-003, SC-007, SC-010).

### Tests first

- [X] T006 [US2] Create `frontend/tests/unit/contrast.test.ts`: parse the light and dark token blocks of `frontend/src/index.css`, compute WCAG relative-luminance contrast, and assert every pairing in `contracts/tokens.md` ("Required pairings") at 4.5:1 (text) or 3:1 (control outlines, focus, charts) in both themes; fail if any token in the contract table is missing from either theme. It fails until T008.
- [X] T007 [US2] Extend `frontend/tests/unit/colourTokens.test.ts` with guards 3 to 6 of `contracts/tokens.md`: no `text-white` with `bg-brand-*`/`bg-accent`/a pale tint in one class list (method badges excluded), no `data-section`/`section-*`/`wf-*` reference, both themes define every contract token, and no `text-align: justify` rule in `index.css` or `text-justify` utility in components. Guards 3, 4 and 6 fail until the tasks below pass.

### Implementation

- [X] T008 [US2] Rebuild the palette in `frontend/src/index.css` as literal hex for light and dark exactly as the table in `contracts/tokens.md`: `accent`, `on-accent`, `lime-pale`, `mint`, `sage`, `olive`, `border-control`, the literal `brand-50..900` ramp, status text and tint pairs, palette-neutral `info`, `chart-1..6`; surfaces and text per the table; method colours unchanged. Additive first: keep the old section and workflow tokens until T021. Tune values only as `contrast.test.ts` requires (FR-007).
- [X] T009 [US2] In `frontend/src/components/controlStyles.ts` add `FIELD_STYLES` (input, select, textarea and checkbox outline on `border-control`, visible focus ring) and change `BUTTON_STYLES.primary` to `bg-accent text-on-accent` with a visible focus ring; secondary buttons use `border-control`.
- [X] T010 [P] [US2] Route form controls in `frontend/src/components/*.tsx` (root files only) through `FIELD_STYLES`/`border-control`: search with `grep -rn "border-border-strong" frontend/src/components --include=*.tsx` and change only input, select, textarea, checkbox and secondary-button outlines. Leave card edges and dividers on `border`/`border-strong`.
- [X] T011 [P] [US2] Same change in `frontend/src/components/apiCoverage/` (replace the private `FIELD` string in `GapFilters.tsx` with `FIELD_STYLES`) and `frontend/src/components/performance/` (including `path/`).
- [X] T012 [P] [US2] Same change in `frontend/src/components/requestChain/`, `userScript/`, `liveRun/` and `frontend/src/pages/`.
- [X] T013 [P] [US2] Migrate white-on-brand fills to `bg-accent text-on-accent` (plus a 2 px `brand-500` edge where the fill marks a selected or current state) in the stepper files: `frontend/src/components/ImportRunStepper.tsx`, `performance/path/PerformanceStepper.tsx`, `userScript/ScriptTabs.tsx`, `WorkflowStageTracker.tsx`.
- [X] T014 [P] [US2] Same migration in the action files: `performance/path/SourcePicker.tsx`, `requestChain/RunLaunchCard.tsx`, `userScript/UserScriptRunTrigger.tsx`, `userScript/ScriptProblems.tsx`, `liveRun/LiveRunChart.tsx`, `pages/PerformancePlanScaleMockPage.tsx`, `EntryFeatureIcon.tsx`.
- [X] T015 [US2] Sweep for remaining fills: `grep -rnE "bg-brand-(600|700|800)[^\"']*text-white|text-white[^\"']*bg-brand-(600|700|800)" frontend/src`; fix every hit (expected total with T013 and T014: the 41 sites in the audit). `httpMethodStyles.ts` white method-label text stays; confirm the colour-token guard ignores it.
- [X] T016 [US2] Replace remaining blue or `info`-accent uses with palette-neutral tokens plus an icon and text: `grep -rnE "info|sky|blue|indigo" frontend/src --include=*.tsx --include=*.ts` filtered to colour usage; status chips and banners keep an icon and a word (FR-010).
- [X] T017 [US2] Remove the global justified rule `p:not(.font-mono){ text-align: justify; hyphens: auto }` from `frontend/src/index.css` (keep `font-variant-ligatures: none` for monospace) and the `text-justify`/`hyphens-auto` utilities in `frontend/src/components/EntryChooser.tsx` and `frontend/src/components/HelpDialog.tsx` (re-run `grep -rn "justify\|hyphens" frontend/src`; fix any third hit).
- [X] T018 [US2] Remove `data-section` and section-accent use from consumers: `frontend/src/App.tsx` (the minimal edit only; US1 rewrites the file), `AppHeader.tsx`, `Tabs.tsx` and any other hit of `grep -rn "data-section\|sectionCatalog\|section-accent\|section-solid" frontend/src`. Tabs keeps its behaviour (it is used by `ExternalCollectionRunPanel` and `StepEditor`).
- [X] T019 [US2] Remove the tone colour fields from `frontend/src/components/workflowCatalog.ts` (keep ids, titles, artifacts) and update every consumer (`grep -rn "tone\|wf-" frontend/src/components`); replace the colour and chooser cases in `frontend/tests/unit/workflowCatalog.test.ts` with assertions on titles, ids and artifacts.
- [X] T020 [US2] Replace the accent and workflow-marker cases in `frontend/tests/unit/Tabs.test.tsx` and the section-accent cases in `frontend/tests/unit/App.test.tsx`; list each replaced test and its reason under "Replaced tests" at the end of this file (FR-028).
- [X] T021 [US2] Delete the retired tokens from `frontend/src/index.css`: `--solid-*` (eight), `--color-section-*`, `--section-solid`, `--section-accent`, the `[data-section]` blocks, `--color-wf-*` (four), and the `:root,[data-section]` brand derivation with its `@theme inline` indirection. Only after `grep -rn "solid-\|section-\|wf-\|data-section" frontend/src` returns nothing outside comments.
- [X] T022 [US2] Delete `frontend/src/components/sectionCatalog.ts` and `frontend/tests/unit/sectionCatalog.test.ts` (their guards now live in `colourTokens.test.ts`, T004 and T007); record the deletion under "Replaced tests".
- [X] T023 [US2] Run `npm test -w frontend`, `npm run lint`, `npm run build`; run `contrast` and `colourTokens` suites; fix remaining failures; tune only token values (not tests) to meet contrast. Record the contrast result per theme under "Notes" (SC-003).
- [X] T024 [US2] Open every in-scope screen in light and dark in the running app (old shell): confirm lime primary actions with dark text, no blue or section hue, readable text on lime, mint and lime-pale, theme remembered after reload and OS preference used when no choice is stored (acceptance scenarios 1 to 5).

**Checkpoint**: US2 complete and shippable alone.

---

## Phase 4: User Story 1 - Navigate from one persistent sidebar (Priority: P1)

**Goal**: One shell (sidebar, header, main) replaces the header, tab menu, start-screen mode and every "Back to start"; each destination has a hash address; work in progress is never discarded; below 1024 px the sidebar is a drawer.

**Independent Test**: Open each destination from the sidebar, return to one with unfinished work and find it unchanged; Back, Forward and refresh work; `#/guided/scenarioReview` with no workflow lands on a valid screen with a notice (SC-002, SC-008, SC-009, SC-011).

### Tests first

- [X] T025 [P] [US1] Create `frontend/tests/unit/navigation/routes.test.ts` per `contracts/routes.md`: round trip for all six routes and eleven stages; rejection of malformed, mixed-case, extra-segment and unknown-stage hashes; every resolution row (no workflow, locked, active, complete, stale, unparseable); no formatted address contains `?`, `=`, a dot-extension or a space.
- [X] T026 [P] [US1] Create `frontend/tests/unit/navigation/destinations.test.ts`: the stage list equals `WORKFLOW_PHASES` (Prepare 3, Design 3, Organize 2, Execute 3), labels come from `STAGE_LABELS`, state mapping (`complete`, `skipped`, `partial` -> done; `stale` -> done "Needs to be redone"; `not-yet-reached` -> locked with `getLockReason`), exactly one current destination.
- [X] T027 [P] [US1] Create `frontend/tests/unit/shell/Sidebar.test.tsx`: landmark and order (skip link, `nav` "Primary", header, main), `aria-current="page"` on the current destination, Guided Workflow disclosure with `aria-expanded`, a locked stage is not a link and exposes its reason in text, a done stage is a link, current stage has `aria-current="step"`.
- [X] T028 [P] [US1] Create `frontend/tests/unit/shell/Drawer.test.tsx`: menu button has `aria-label="Open navigation"`, `aria-expanded`, `aria-controls`; opening moves focus inside and traps Tab; Escape, choosing a destination and clicking the dimming layer close it; focus returns to the menu button; `matchMedia` is never called.
- [X] T029 [P] [US1] Create `frontend/tests/unit/shell/AppShell.test.tsx`: connection status keeps `data-testid="connection-status"` with the words Connecting, Connected and Disconnected (`role="alert"` for Disconnected); page header shows `<h1>` and breadcrumb ("Guided Workflow › Design" over a stage); palette button, theme control and help control present; route notice region is `role="status"`; palette and help dialogs return focus to their buttons (re-homed from `AppHeader.test.tsx`).

### Implementation

- [X] T030 [US1] Create `frontend/src/navigation/routes.ts`: `Route`, `RouteResolution`, `parseRoute`, `formatRoute`, `resolveRoute` as pure total functions exactly per `contracts/routes.md`; the only place a redirect is decided. Makes T025 pass.
- [X] T031 [US1] Create `frontend/src/navigation/destinations.ts`: destination catalog (six top-level plus eleven stages) built from `workflowCatalog` titles and `workflowStageViewModel` (`WORKFLOW_PHASES`, `STAGE_LABELS`, `getPhaseProgress`, `getLockReason`); no second copy of the stage model. Makes T026 pass.
- [X] T032 [US1] Create `frontend/src/navigation/useRoute.ts`: reads `location.hash`, listens to `hashchange`, exposes `route`, `navigate` (push) and `redirect` (replace) and the resolved notice; never reads or writes the path or query string; opening with no hash shows Home without rewriting the address.
- [X] T033 [P] [US1] Create `frontend/src/hooks/useWorkflowSnapshot.ts` (current workflow for the sidebar and Home via `fetchCurrentWorkflow()`, fetched once on load, updated by `onWorkflowChange`; failure leaves no done stages and never throws) with `frontend/tests/unit/useWorkflowSnapshot.test.tsx`.
- [X] T034 [US1] In `frontend/src/pages/TestGenerationWorkflowPage.tsx` add an `onWorkflowChange` callback (beside `onSectionChange`) and accept stage requests from the route through the existing `stageRequest` mechanism; keep the `lastHandoffKey` resume guard unchanged. Add a regression case to `frontend/tests/unit/TestGenerationWorkflowPage.test.tsx`: navigating away and back does not repeat the execution hand-off.
- [X] T035 [P] [US1] Create `frontend/src/components/shell/SkipLink.tsx` ("Skip to main content", first in tab order, visible on focus) and `RouteNotice.tsx` (polite live region, cleared on next navigation, `data-testid="route-notice"`).
- [X] T036 [P] [US1] Create `frontend/src/components/shell/SidebarStages.tsx`: the eleven stages grouped Prepare, Design, Organize, Execute with an icon labelled "Done", `aria-current="step"` for the current stage, locked stages not links with `aria-disabled="true"` and the reason in `aria-describedby` text; `data-testid="sidebar-stage-{stageId}"`.
- [X] T037 [US1] Create `frontend/src/components/shell/Sidebar.tsx`: brand, logo and `VersionBadge` at the top, then Home, Guided Workflow (button with `aria-expanded`), Import & Run Collection, Performance, Run k6 Script, Coverage as `<a href="#/...">` named by the workflow title; navigation only (no card, no dead link; FR-002); `data-testid="sidebar"` and `sidebar-destination-{id}`. Makes T027 pass.
- [X] T038 [P] [US1] Create `frontend/src/components/shell/PageHeader.tsx`: `<h1>`, breadcrumb, command-palette button with Ctrl+K / ⌘ K hint, connection status (moved from `AppHeader.tsx` with `data-testid="connection-status"`), `ThemeToggle`, help button, and the menu button (`data-testid="menu-button"`) shown below `lg`.
- [X] T039 [US1] Create `frontend/src/components/shell/Drawer.tsx` using `useFocusTrap` (T005): slides in only under `motion-safe:`, dimming layer, closes on Escape, destination choice or dimming-layer click, returns focus to the menu button; layout switch is CSS only (`lg:` utilities), no script reads `matchMedia`. Makes T028 pass.
- [X] T040 [US1] Create `frontend/src/components/shell/AppShell.tsx` (`data-testid="app-shell"`): composes SkipLink, Sidebar (in flow at `lg` and above, in the Drawer below), PageHeader and `<main id="main">` with the notice live region; at `lg` and above no menu button. Makes T029 pass.
- [X] T041 [US1] Rewrite `frontend/src/App.tsx` to be route-driven: derive the visible destination from `useRoute` (replace `started`, `activeTab`, `tabsVisible`); keep the five `*Mounted` flags and the stay-mounted-and-hidden pattern; keep `importRunRequest`, `guidedStageRequest`, `performanceDraft`, `coverageEntry` and their tokens; remove the chooser branch, `Tabs` menu and `handleExitToStart`; render the existing `EntryChooser` content as Home's body for now (replaced in US5); honour `?mock=performance-plan-scale` unchanged; fetch the workflow once via `useWorkflowSnapshot`.
- [X] T042 [P] [US1] Remove the "Back to start" and Exit controls and the `onExit` prop from `frontend/src/pages/ExternalCollectionsPage.tsx`, `PerformancePage.tsx`, `UserScriptPage.tsx`, `TestGenerationWorkflowPage.tsx`, `components/performance/PerformanceHome.tsx` and `components/performance/path/PerformancePath.tsx` (its top row keeps Plans, plan name and status), and fix their tests (`UserScriptPage.test.tsx`, `PerformanceHome.test.tsx`, `PerformancePath.test.tsx`, `ScriptEditor.test.tsx`). Unsaved-changes questions stay where they are today (script editor view switch, exit with edits).
- [X] T043 [P] [US1] Update `frontend/src/components/paletteCommands.ts` so "Back to start" becomes "Go to Home" (navigates to `#/`), always available; other commands navigate by address and keep their behaviour; update `frontend/tests/unit/paletteCommands.test.ts` and `CommandPalette.test.tsx`.
- [X] T044 [US1] Wire shared navigation: Coverage's "Open scenarios" and the other in-page links (`frontend/src/pages/CoveragePage.tsx`, `components/apiCoverage/*`) use route navigation plus the existing stage request; update `frontend/tests/unit/apiCoverage/CoverageNavigation.test.tsx`.
- [X] T045 [US1] Delete `frontend/src/components/AppHeader.tsx` and `frontend/tests/unit/AppHeader.test.tsx` once T029 covers its connection-status, palette and help-focus behaviours; record under "Replaced tests".
- [X] T046 [US1] Update `frontend/tests/unit/App.test.tsx`: replace the "entry chooser first" and guided-section cases; adjust selectors (workflows are now reached by sidebar links; Home tiles stay buttons); stub the new reads. Add cases: stay-mounted (returning to Import & Run makes no second `/api/external-collections` request), Back and Forward across four destinations, refresh keeps the destination, `#/guided/scenarioReview` with no workflow and with a workflow on API Review and `#/nonsense` each open a valid screen with a notice, locked stage does not open.
- [X] T047 [US1] Run `npm test -w frontend`, `npm run lint`, `npm run build`; walk quickstart scenario 1 in the running app at 1440 px and 390 px; record the result under "Notes".

**Checkpoint**: US1 complete; with US2 the app has the new shell and palette (slices 1 and 2).

---

## Phase 5: User Story 3 - The same patterns on every screen (Priority: P1)

**Goal**: Every in-scope screen is built from one pattern set, documented live; the three steppers and the Guided tracker share one component.

**Independent Test**: Open `/?mock=pattern-library`, then walk Guided (API Review, Scenario Review), Import & Run, Performance, Run k6 Script and Coverage in both themes; each content group is a library pattern and every pre-existing control still works (FR-013 to FR-017).

### Tests first (pattern primitives)

- [X] T048 [P] [US3] Tests for the primitives, one file each under `frontend/tests/unit/patterns/`: `Card.test.tsx`, `Pill.test.tsx` (states carry text or an icon with an accessible name), `TaskCard.test.tsx`, `StepTrail.test.tsx` (done, current and locked states in words or icons, `aria-current`, hint and lock reason text, locked step not activatable), `Banner.test.tsx` (warning, neutral, error with icon and text), `DropZone.test.tsx` (idle, active, disabled; keyboard activation; file input reachable). Extend `frontend/tests/unit/StatTile.test.tsx` for the highlight variant.

### Primitives

- [X] T049 [P] [US3] Create `frontend/src/components/patterns/Card.tsx` (default and flat) and `Pill.tsx` (accent, mint, line, ok, warn, bad; each state also text or icon). `StatusBadge` keeps its status API.
- [X] T050 [P] [US3] Create `frontend/src/components/patterns/TaskCard.tsx` and `Banner.tsx`.
- [X] T051 [P] [US3] Create `frontend/src/components/patterns/StepTrail.tsx` (done, current, locked; hint and lock reason; accessible list semantics) and `DropZone.tsx`.
- [X] T052 [US3] Extend `frontend/src/components/StatTile.tsx` with a highlight (mint) variant and card-based layout; keep `data-testid="stat-tile"` and existing props.
- [X] T053 [US3] Create `frontend/src/pages/PatternLibraryPage.tsx` documenting every pattern of FR-014 with live examples in both themes (stat tile and highlight, widget card, pill, task card, stepper states, table with tinted header and pager, banner, empty state, drop zone, key-value block, buttons primary/secondary/disabled, form fields, status chips, method badges, dialog); mount it at `?mock=pattern-library` the way `?mock=performance-plan-scale` is mounted in `frontend/src/App.tsx`; add a render test `frontend/tests/unit/PatternLibraryPage.test.tsx`.

### Steppers on one component

- [X] T054 [P] [US3] Render `frontend/src/components/ImportRunStepper.tsx` through `StepTrail` (Collection, Review requests, Run, Results; keep `importRunSteps.ts` logic, hints, lock reasons, `aria-current`); existing `importRunSteps.test.ts` and `ExternalCollectionsPage.test.tsx` pass unchanged.
- [X] T055 [P] [US3] Render `frontend/src/components/performance/path/PerformanceStepper.tsx` through `StepTrail` (Source, Operations, Plan, Load, Run; keep `performance-step-*` test ids); `PerformanceStepper.test.tsx` and `PerformancePath.test.tsx` pass.
- [X] T056 [P] [US3] Render `frontend/src/components/userScript/ScriptTabs.tsx` through `StepTrail` (k6 Script, Check, Confirm, Run); `UserScriptPage.test.tsx` and `ScriptEditor.test.tsx` pass.
- [X] T057 [US3] Restyle `frontend/src/components/WorkflowStageTracker.tsx` on `StepTrail` (four groups with stage chips); keep `workflow-stage-tracker`, `workflow-position`, `phase-tile-*`, `stage-status-*` test ids; `WorkflowStageTracker.test.tsx` and `workflowTrackerTestUtils.ts` pass unchanged.

### Screens (each ends with that screen's tests green before the next starts)

- [X] T058 [US3] Rebuild API Review from the patterns: `frontend/src/components/ApiReviewStage.tsx`, `OperationList.tsx`, `OperationDetail.tsx`, `AnalysisSummary.tsx`, `SummaryPanel.tsx`; tables keep semantic headers, tinted header and pager; every filter, count and paging control preserved. `ApiReviewStage.test.tsx` passes.
- [X] T059 [US3] Rebuild Scenario Review from the patterns: `frontend/src/components/ScenarioReviewStage.tsx` and `TestScenarioReview*.tsx`, `TestScenarioList.tsx`, `TestScenarioDetail.tsx`; bulk accept and reject, filters and paging preserved (FR-015). `TestScenarioReview*.test.tsx` and `TestScenarioReviewAccessibility.test.tsx` pass unchanged.
- [X] T060 [US3] Rebuild Import & Run Collection: `frontend/src/pages/ExternalCollectionsPage.tsx`, `components/ImportRunHero.tsx`, `ExternalCollectionUpload.tsx` (DropZone; keep `external-collection-upload` test id), `ExternalCollectionList.tsx`, `ExternalCollectionRunPanel.tsx`, `CollectionRunSetupCard.tsx`. All `ExternalCollection*.test.tsx` pass.
- [X] T061 [US3] Rebuild Performance: `frontend/src/pages/PerformancePage.tsx`, `components/performance/PerformanceHome.tsx`, `RecentRuns.tsx`, `performance/path/*` (DraftBanner and warnings become `Banner`, SourcePicker and plan cards become `Card`/`TaskCard`; keep `performance-path` and `performance-step-*` test ids). `PerformanceHome.test.tsx`, `PerformancePath.test.tsx`, `PerformanceDraft.test.tsx`, `PerformanceSources.test.tsx` and related tests pass; selector adjustments only where markup changed.
- [X] T062 [US3] Rebuild Run k6 Script: `frontend/src/pages/UserScriptPage.tsx`, `components/userScript/ScriptWorkspace.tsx`, `ScriptList.tsx`, `ScriptPanel.tsx`, `ScriptProblems.tsx`, `UserScriptRunActivity.tsx`, `UserScriptRunTrigger.tsx`, `ScriptConfirmDialog.tsx`; unsaved-changes questions and the confirmation dialog preserved. `UserScript*.test.tsx` and `ScriptEditor.test.tsx` pass.
- [X] T063 [US3] Rebuild Coverage: `frontend/src/pages/CoveragePage.tsx` and `components/apiCoverage/*` (hero, metric groups, category coverage, gaps table with filters and pager, recommendations); keep `coverage-page` test id. `frontend/tests/unit/apiCoverage/` suites pass.
- [X] T064 [P] [US3] Wide tables and code blocks scroll inside their own card, never the page, and keep semantic headers (FR-017): `frontend/src/components/CodeBlock.tsx`, `apiCoverage/GapsTable.tsx`, `performance/LatestRequestsTable` equivalents (`grep -rln "<table" frontend/src`).
- [X] T065 [US3] Guided stages 6 to 11 (Dependency Analysis through Performance Testing) inherit only shell and colours: open each in both themes, fix any leftover retired-token or contrast defect, and make no pattern changes (follow-up spec). Record each stage as checked under "Notes".
- [X] T066 [US3] Audit states shown by colour alone (SC-007): for every in-scope screen confirm each state (completed, in progress, failed, locked, selected, status chip, banner) has text or an icon with an accessible name; fix any gap. Record under "Notes".
- [X] T067 [US3] List every deliberately reworded visible label under "Reworded labels" at the end of this file (FR-015) and run `npm test -w frontend`, `npm run lint`, `npm run build`; walk quickstart scenario 3.

**Checkpoint**: US3 complete (slices 3 and 4); the patterns and screens are consistent in both themes.

---

## Phase 6: User Story 4 - Use it on a narrow window (Priority: P2)

**Goal**: Everything reads and works at 390 px and 320 px; no page scrolls sideways at 320, 390, 768, 1280 and 1920 px. The drawer itself is built in US1; this phase verifies and fixes the screens against it.

**Independent Test**: At 390 and 320 px open the drawer by touch and keyboard, then every in-scope screen; `document.documentElement.scrollWidth <= window.innerWidth` everywhere (SC-004, SC-009).

- [X] T068 [US4] Write a throwaway headless Edge/Chrome script outside the repository (scratchpad, DevTools protocol over the Node 24 global WebSocket, no dependency) that, for each in-scope screen, theme (set via the `apipilot-theme` local-storage key) and width (320, 390, 768, 1280, 1920), opens the address, takes a full-page screenshot and records `scrollWidth` against `innerWidth`; run it against the isolated servers and save the output sheets outside the repo. Reused by T089.
- [X] T069 [P] [US4] Fix header and brand fit on narrow windows in `frontend/src/components/shell/PageHeader.tsx` and `Sidebar.tsx`: application name never truncated, no header control clipped at 320 px, long stage or document names wrap or shorten with the full text in a tooltip or accessible name.
- [X] T070 [P] [US4] Collapse grids to one or two columns and fix overflow on Home's current body, Guided (API Review, Scenario Review), Import & Run and Coverage: `frontend/src/components/ImportRunHero.tsx`, `ApiReviewStage.tsx`, `ScenarioReviewStage.tsx`, `apiCoverage/*`.
- [X] T071 [P] [US4] Same for Performance and Run k6 Script: `frontend/src/components/performance/**`, `userScript/**`.
- [X] T072 [US4] Run T068 across the matrix; fix every `scrollWidth > innerWidth` result at its source (tables and code blocks scroll inside their cards); re-run until zero (SC-004).
- [X] T073 [US4] Verify browser zoom at 200% with a 320 px window, forced-colours mode (current item and each state distinguishable), and reduced motion (`prefers-reduced-motion`: drawer appears with no animation and nothing depends on it, FR-011); record under "Notes".
- [X] T074 [US4] Keyboard-only walk-through (SC-009): open the drawer, the help dialog and the palette, reach every sidebar item, close each with Escape, confirm focus is visible and returns correctly each time; record under "Notes". Walk quickstart scenario 4.

**Checkpoint**: US4 complete.

---

## Phase 7: User Story 5 - A Home that shows only what is real (Priority: P2)

**Goal**: Home replaces the start screen: launch tiles, summary tiles, coverage by area, operations by method, next steps, recent runs and AI status, each from data the application already holds, otherwise a text reason.

**Independent Test**: Open Home with no specification, then after scenarios exist, and compare each figure with Coverage; run one of each workflow and see all three in Recent runs (SC-006).

### Tests first

- [X] T075 [P] [US5] Create `frontend/tests/unit/home/homeViewModel.test.ts`: every figure from a fixture `CoverageSnapshot` (`spec-operations`, `runtime-operations`, `totals.gaps` high priority, `context.scenarioCounts`, `categoryCoverage` with a group `reason`, operations-by-method counts); `no-workflow` and `error` states give a reason and no number; next steps appear in the contract order and only when true, with "Nothing is waiting on you." when none; SC-006 cross-check: the same fixture feeds Home and the Coverage view model (`apiCoverage/coverageViewModel.ts`) and the figures are equal.
- [X] T076 [P] [US5] Create `frontend/tests/unit/home/recentRuns.test.ts`: merge by `startedAt` newest first, 8-row cap, status mapping to In progress, Completed, Cancelled, Failed, a failing source skipped and named, empty state with a text reason, Debug runs never present.
- [X] T077 [P] [US5] Create `frontend/tests/unit/aiStatusClient.test.ts`: maps the ready, loading/not-loaded and unavailable payload shapes of `GET /api/ai/status`, never exposes `modelId`, `lastKnownReadiness` or `latestBenchmarkRun`; add a case for `fetchAllRuns` in `frontend/tests/unit/userScriptClient.test.ts` (new file if absent).
- [X] T078 [P] [US5] Create `frontend/tests/unit/home/HomePage.test.tsx` with a stubbed `fetch`: launch tiles keep their accessible names and the Recommended and Draft-in-progress cues and artifact entry points; no coverage number with no workflow; Home issues no request while hidden; with the backend failing it still renders and the status says Disconnected.

### Implementation

- [X] T079 [P] [US5] Create `frontend/src/services/aiStatusClient.ts` with `fetchAiStatus()` over the existing `GET /api/ai/status` (read `state`, `provider`, `reason` only; typed result, explicit error); no backend change.
- [X] T080 [P] [US5] Add `fetchAllRuns()` to `frontend/src/services/userScriptClient.ts` (`GET /api/user-scripts/runs` without `scriptId`; typed, explicit error).
- [X] T081 [US5] Create `frontend/src/components/home/homeViewModel.ts` (pure): Home figures with `ready | unavailable` state and reason text from `contracts/home-data.md`, next-steps derivation, operations-by-method counts, and the recent-runs merge, status mapping and 8-row cap. Verify at this point that `assertionOutcomes` and `operationCounts.withFailures` exist on `CoverageSnapshot` as the contract assumes; if a field is absent, derive next step 4 only from the field that exists and amend `contracts/home-data.md` in the same change.
- [X] T082 [P] [US5] Create `frontend/src/hooks/useAiStatus.ts` and `useRecentRuns.ts`: read only while Home is the visible destination, once per visit, abort on leaving, never poll; Import & Run via `fetchUploadedCollections()` then `fetchUploadedCollectionRuns(id)` for the ten most recently updated; Performance via `listPlans()` then `chainRunsClient(planId).fetchRuns()` for the ten most recently updated plans (no legacy runs, `RECENT_RUNS_PLAN_LIMIT`); Run k6 Script via `fetchAllRuns()`; each source failure is isolated and reported.
- [X] T083 [P] [US5] Create the Home widgets in `frontend/src/components/home/`: `LaunchTiles.tsx` (buttons whose whole accessible name is the workflow title; artifact controls keep "{title}, for {artifact phrase}"; Recommended and Draft-in-progress cues), `SummaryTiles.tsx` (stat tiles, mint highlight), `CoverageByArea.tsx`, `MethodBreakdown.tsx` (labelled "Operations in scope"; omitted with "Needs a specification." when none), `NextSteps.tsx` (links to where each is done), `RecentRuns.tsx` (workflow, subject, start time, status in words, link to results), `AiStatusTile.tsx` (state in words, provider, reason when unavailable). No chart over time, no trend, no placeholder number.
- [X] T084 [US5] Create `frontend/src/pages/HomePage.tsx` (`data-testid="home-page"`, recent runs `home-recent-runs`): composes the widgets; each widget renders as its own data arrives; every unavailable figure shows its text reason; uses `useCoverage({}, active)`, `useWorkflowSnapshot`, `useAiStatus`, `useRecentRuns` and the `performanceDraft` flag passed from `App`.
- [X] T085 [P] [US5] Deep-link plumbing: add optional `runId` to `OpenPerformancePlanRequest` in `frontend/src/pages/PerformancePage.tsx` (pass to the existing `open(planId, runId?)`); add an `openRunRequest: { runId: string; token: number }` prop to `frontend/src/pages/UserScriptPage.tsx` that opens the owning script on its Runs & reports view; Import & Run keeps its existing `openRunRequest`. Add test cases to `UserScriptRunsScreen.test.tsx` and `PerformanceHome.test.tsx`.
- [X] T086 [US5] In `frontend/src/App.tsx` render `HomePage` for Home (replacing the temporary chooser body), hold run-open requests in state with tokens (the `importRunRequest` and `guidedStageRequest` pattern), and set the destination address to the screen's address with no id in it (`contracts/routes.md`).
- [X] T087 [US5] Delete `frontend/src/components/EntryChooser.tsx`, `EntryIllustration.tsx`, `EntryFeatureIcon.tsx` (first move any icon another screen still imports: `grep -rn "EntryFeatureIcon\|EntryIllustration" frontend/src`) and `frontend/tests/unit/EntryChooser.test.tsx`; the launch-tile cases live in `HomePage.test.tsx` (T078). Record under "Replaced tests".
- [X] T088 [US5] Update `frontend/tests/unit/App.test.tsx` fetch stubs for Home's reads (it rejects unknown URLs) and add: Home reads nothing while another destination is shown; each Recent runs row opens its results on the right screen. Run `npm test -w frontend`, `npm run lint`, `npm run build`; walk quickstart scenario 5 (including stopping the backend) and record.

**Checkpoint**: US5 complete (slice 5).

---

## Phase 8: User Story 6 - Dialogs, palette and reading text (Priority: P3)

**Goal**: The help dialog and the command palette use the page card style; paragraphs are left-aligned.

**Independent Test**: Open the help dialog and the palette in both themes with the keyboard only; read a long paragraph at 390 px.

- [X] T089 [P] [US6] Restyle `frontend/src/components/Dialog.tsx` to the card style and align `ConfirmDialog.tsx`, `PromptDialog.tsx`, `MoveItemDialog.tsx`, `performance/path/EditedRemovalDialog.tsx` and `userScript/ScriptConfirmDialog.tsx`; focus trap, Escape and focus return unchanged. `Dialog.test.tsx` and `ConfirmDialog.test.tsx` pass.
- [X] T090 [P] [US6] Restyle `frontend/src/components/HelpDialog.tsx` (keep `data-testid="help-dialog"` and the name "Keyboard shortcuts and workflows"; its workflow descriptions use the new pattern vocabulary) and `CommandPalette.tsx` (keep `data-testid="command-palette"`, name "Command palette", Ctrl+K / ⌘ K, and "Go to Home"); `HelpDialog.test.tsx` and `CommandPalette.test.tsx` pass.
- [X] T091 [US6] Confirm Ctrl+K is ignored inside text fields and over another dialog (existing behaviour), the palette's Go to Home does what "Back to start" did, and paragraphs are left-aligned at 390 px; walk quickstart scenario 6 in both themes.

**Checkpoint**: US6 complete.

---

## Phase 9: Polish and close-out (slice 6)

- [X] T092 Run the visual matrix (T068 script) over every in-scope screen in light, dark and 390 px (and 1440 px); review the sheets against `specs/054-sidebar-shell-redesign/design-reference/apipilot-design.html`; record the result and any deliberate departure under "Notes" (SC-001).
- [X] T093 Verify the standalone reports are unbroken (FR-026): open the performance report and the run report (HTML and PDF) once with each theme chosen; confirm they render unchanged; do not restyle them.
- [X] T094 Final guard pass: `npm test -w frontend -- contrast` and `-- colourTokens` zero findings (SC-003, SC-010); `grep -rn "Back to start" frontend/src frontend/tests` shows no remaining control or assertion; no unused exports left by the removed chooser, header and section catalog.
- [X] T095 Run the full repository checks: `npm test`, `npm run lint`, `npm run build`; compare with the T001 baseline; all behaviour tests pass unchanged except those listed under "Replaced tests" (SC-005). State any failure with its output.
- [X] T096 Walk every quickstart scenario (1 to 7) and record each as performed under "Notes".
- [X] T097 Update `README.md` (sidebar navigation, Home, hash addresses, pattern library preview `?mock=pattern-library`, palette note) and `specs/ROADMAP.md` (AP-054 delivered, follow-ups: Guided stages 6 to 11 and deep steps adopt the patterns, Home coverage-over-runs trend needs its own spec); set the spec Status to Implemented.
- [X] T098 Run `npm run version:bump` once, after the checks pass (repository convention). Do not run `git commit`; leave the working tree for the owner's review.

---

## Dependencies and execution order

- **Phase 1 -> Phase 2 -> every story.** T004 (guards) must land before T022 (deleting the section catalog). T005 (`useFocusTrap`) must land before T039 (Drawer) and T089 (dialogs).
- **US2 (Phase 3)**: independent of the others; T008 before T009 to T017; T018 to T020 before T021; T021 and T022 only after the greps in T018 and T019 return nothing.
- **US1 (Phase 4)**: needs Phase 2 and US2's removal of `data-section` (T018). T030 -> T031 -> T032 -> T041. T035 to T040 can proceed beside T030 to T033. T041 needs T030 to T040. T042 and T043 need T041.
- **US3 (Phase 5)**: needs US2 (tokens) and US1 (shell). Primitives (T049 to T052) before the stepper adoption (T054 to T057), which come before the screens (T058 to T063). T053 can follow any primitive.
- **US4 (Phase 6)**: needs US1 (drawer) and the screens of US3.
- **US5 (Phase 7)**: needs US1 (`useWorkflowSnapshot`, routes) and US3 (patterns). T079, T080 and the tests T075 to T078 can start as soon as Phase 2 is done.
- **US6 (Phase 8)**: needs US1 (Go to Home) and US3 (card style). T089 and T090 can run beside US5.
- **Polish (Phase 9)** last.

Story completion order for a release: US2, US1, US3 (the three P1 stories), then US4 and US5, then US6.

## Parallel examples

- After Phase 2: T006 and T007 (tests) while T009 to T012 touch disjoint folders.
- US1: T025 to T029 (five test files) together; T035, T036, T038 (distinct shell files) together.
- US3: T048 and T049 to T051 (distinct primitive files) together; T054 to T056 (three steppers) together.
- US5: T075 to T080 together; T082 and T083 together.
- US4: T069 to T071 together.

## Implementation strategy

1. **MVP**: Phases 1 to 3 (US2). A recoloured, guarded, left-aligned app that ships alone.
2. **Navigation**: Phase 4 (US1). Shell, addresses and drawer; chooser temporarily serves as Home. Ships alone.
3. **Patterns**: Phase 5 (US3) one screen at a time, each green before the next; the user-visible redesign.
4. **Narrow and Home**: Phases 6 and 7.
5. **Edges and close-out**: Phases 8 and 9.

Each phase ends with `npm test`, `npm run lint` and `npm run build` passing and the app usable.

## Notes

(Recorded during implementation.)

- **T001 baseline** (before changes): `npm run lint` clean; `npm run build` passes. `npm test -w frontend` is load-sensitive on this machine: a first run overlapping my own edits showed 130 to 185 failures, mostly 5 s test timeouts and `window is not defined` in the node-environment dev-access suites (caused by my own first `setup.ts` edit, since guarded); an undisturbed run after the Phase 3 changes was 128 files, 1334 tests, all passing. No pre-existing functional failure was found.
- **T022/SC-003 (contrast)**: `contrast.test.ts` (201 cases, both themes) passes. Tuning needed: `danger-600` `#dc2626` to `#d92222` (4.48 to 4.63:1 on `surface-subtle`). The contract's "text-primary/secondary and brand-700 on accent" pairings apply to the light theme only: in the dark theme lime is a bright fill and only `on-accent` text sits on it (recorded in the test).
- **Departures from the plan, Phase 3**: the retired tokens were removed in the same change as the new ones (T008, T021 together) because the consumers had to move at once; `Tabs` keeps its `accent` prop and `markerClassName` (still used by `ExternalCollectionRunPanel` and `StepEditor`), so `Tabs.test.tsx` only swaps a class string. `FIELD_STYLES` is used by `GapFilters`, `EnvironmentForm`, `StepEditor`, `ReferenceField` and `ScriptPanel`; the other form controls keep their own class strings with `border-border-control`. Success, warning and danger status fills with white text stay (status colours, AA verified by the 600 steps).
- **Phase 4 (shell)**: full frontend suite 133 files, 1423 tests pass; lint and build clean. New tests: `navigation/routes` (47), `navigation/destinations` (8), `shell/AppShell`, `shell/Sidebar`, `shell/Drawer`, `useWorkflowSnapshot`, App address cases and two page-level reporting cases. Departures: the sidebar's Guided Workflow entry is a link plus a separate disclosure button (the contract is updated), so the Home tile keeps the only button of that name; the page header wraps its controls to a second row below `sm`; the stage address is synchronised by the page reporting its viewed stage (`onViewedStageChange`), replacing the address without a history entry. Screens checked in headless Edge at 1440 and 390 px (Home light, Guided dark, Performance, and the open drawer at 390 px).
- **Phases 5 to 8 (patterns, screens, Home, dialogs)**: primitives, `StatTile` highlight, `EmptyState` mint tile and the pattern library page are built and tested (`patterns/*`, `PatternLibraryPage`). Import & Run, Performance and the script views render their steppers through `StepTrail`; the Guided tracker is restyled in the same step vocabulary (mint done, pale lime with an olive edge current, dashed locked) but keeps its own markup, because its phase tiles toggle a chip list rather than select a step (departure from plan T057). API Review and Scenario Review, Import & Run, Performance, Run k6 Script and Coverage were rebuilt from the patterns by four parallel workers, each with its own tests green and no behaviour change; the full suite is the check. Run k6 Script's stepper shows the script's three real views (Script, Run setup, Runs & reports), not the mock's four invented steps; its empty landing previews the Check, Confirm and Run steps as locked with reasons. The API Review and Scenario Review lists stay `<ul>` with row buttons (their accessible names and tests depend on it), not `<table>`; the mint header is the pattern. The T076 recent-runs cases live in `home/homeViewModel.test.ts` and `home/HomePage.test.tsx` rather than a separate file. Home reads coverage, workflow, AI status and run lists once per visit and only while visible (App-level test).
- **Phase 6 (narrow)**: headless Edge matrix (`matrix.mjs`, outside the repo) over Home, Guided, Import & Run, Performance, Run k6 Script and Coverage at 320, 390, 768, 1440 and 1920 px (light, dark at 1440 and 390), and with a seeded workflow over Scenario Review, API Review, Coverage and Home at 320, 390, 768 and 1440: `scrollWidth` equals `innerWidth` in every capture (no page scrolls sideways). The header wraps its controls to a second row below `sm`; tables scroll inside their cards. Forced-colours: the current sidebar item, stage and step also get an outline (backgrounds and shadows are dropped in that mode); not exercised in a real forced-colours browser here. Reduced motion: every transition is `motion-safe:` and the global reduced-motion rule remains. 200% zoom and a manual screen-reader pass were not performed; keyboard behaviour (drawer trap, Escape, focus return, palette, help) is covered by `shell/Drawer.test.tsx`, `shell/AppShell.test.tsx` and the existing dialog tests.
- **Stages 6 to 11**: they inherit the shell and tokens only; the colour guard and contrast tests cover them, but a seeded run past Scenario Review was not captured visually (the AI-dependent stages need a longer driven run), so they were not individually inspected.
- **FR-026 reports**: no backend or report code changed (`git diff -- backend packages` is empty), and the in-app report frames render the same backend HTML; the standalone report pages were not opened in a browser in this pass.
- **Quickstart**: scenario 1 (sidebar, addresses, stay-mounted, redirects) and 5 (Home with and without a specification, three run sources, disconnected backend) are asserted by `App.test.tsx`, `home/HomePage.test.tsx` and the shell tests; scenarios 2 to 4 and 6 were walked through the screenshot matrix and the dialog tests; scenario 7 is limited to the note above.
- **Final checks**: `npm run lint` clean, `npm run build` passes, frontend 138 files and 1479 tests pass; the root `npm test` showed one backend timeout (`newmanSandbox.test.ts`, 30 s under full-suite load) that passes alone in 2 s, in code this feature does not touch. Version bumped 19.56.0 to 19.57.0 with `npm run version:bump -- feature`; `README.md`, `docs/USER_MANUAL.md`, `docs/architecture.md` and `specs/ROADMAP.md` updated. Nothing was committed.
- **T024 visual check** (old shell, recoloured, headless Edge): Home light and Performance dark reviewed; lime accent, no blue or section hue, paragraphs left-aligned.

### Replaced tests (FR-028)

| Test | Reason | Task |
|---|---|---|
| `frontend/tests/unit/sectionCatalog.test.ts` | Asserts retired section accents; hex and palette guards moved to `colourTokens.test.ts` | T022 |
| `Tabs.test.tsx` "draws an optional colour marker" | Class string `bg-wf-guided` changed to `bg-brand-600` (the prop remains) | T020 |
| two AP-041 cases in `App.test.tsx` ("sets the section accent…", "starts the guided workflow in the Specification section") | Retired section accents | T020 |
| `data-section` and `WORKFLOW_SECTIONS` assertions in `apiCoverage/CoverageNavigation.test.tsx` | Retired section accents | T020 |
| "gives every workflow its own colour" in `workflowCatalog.test.ts` | Tone colours removed; replaced by a title and id uniqueness case | T019 |
| `frontend/tests/unit/AppHeader.test.tsx` | Header replaced by the shell; behaviours re-homed in `shell/AppShell.test.tsx` | T045 |
| App cases "entry chooser first, no tab menu", "Exit workflow", "Back to start on Import & Run", the Performance and guided "Back to start" cases, the "tab menu" palette cases | Start-screen mode and tab menu replaced by the shell; each now asserts the same behaviour (state kept, no refetch, handoff once, palette opens a workflow) through the sidebar and addresses | T046 |
| `PerformanceHome.test` "offers a way back to the start screen", `PerformancePath.test` Back-to-start click, `UserScriptPage.test` empty-state Back to start | The exit controls were removed (FR-001); each now asserts there is none | T042 |
| `ScriptEditor.test` "asks before leaving unsaved changes" (exit step only) | No exit action exists; the view-switch question and Cancel-keeps-text remain | T042 |
| `CommandPalette.test`, `paletteCommands.test` Back-to-start cases | Command renamed Go to Home and shown away from Home | T043 |
| `apiCoverage/CoverageNavigation.test` tab-menu assertions | Destinations are sidebar links with `aria-current` | T044 |
| `frontend/tests/unit/EntryChooser.test.tsx` | Chooser replaced by Home; cases re-homed in `home/HomePage.test.tsx` | T087 |

### Reworded labels (FR-015)

| Before | After | Why |
|---|---|---|
| "Back to start" (palette command) | "Go to Home" | Spec FR-024; Home replaces the start screen |
| "Back to start" and "Exit ..." buttons on the workflow pages | removed (sidebar replaces) | FR-001 |
| Run k6 Script landing facts "CHECKED / CONFIRMED / LOCAL" literals | "Checked", "Confirmed", "Local" (displayed in the same uppercase) | T062 |
| Run k6 Script landing steps Check, Confirm, Run | Preview with a lock reason in place of the plain hint, as every locked step shows | T062 |
| Performance threshold empty message | "No thresholds set." then "The report will show…" (split into message and description; same words) | T061 |
| Run k6 Script "exit with unsaved edits" question | Retired with the exit control: leaving the page by the sidebar discards nothing (FR-005); the view-switch question remains | FR-001, FR-005 |
