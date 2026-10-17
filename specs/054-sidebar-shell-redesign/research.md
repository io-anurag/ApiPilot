# Research: Sidebar Shell and Shared Visual Language

Phase 0 output for `specs/054-sidebar-shell-redesign`. The spec has no open clarifications; the items below are the technical decisions the plan rests on, each with the evidence read from the repository. Paths are relative to the repository root.

## D1 - Addresses: hash routes, a pure route module, no router library

**Decision**: Each destination gets a hash address (`#/`, `#/guided`, `#/guided/<stageId>`, `#/import`, `#/performance`, `#/k6`, `#/coverage`). Parsing, formatting and "nearest valid destination" resolution are pure functions in `frontend/src/navigation/routes.ts`; one hook, `useRoute`, reads `location.hash`, listens to `hashchange` and exposes `navigate` (push) and `redirect` (replace).

**Rationale**: FR-029 forbids a new runtime dependency and the code has no router today (App.tsx comment: "no react-router: a handful of views does not warrant a routing dependency"). A hash leaves the query string untouched, which keeps the AP-049 access token (carried in the dev address) and the `?mock=performance-plan-scale` preview working, and needs no server fallback rule for deep links. The browser's own history gives Back, Forward, refresh and bookmarks. Pure functions satisfy constitution XXI (every boundary independently testable).

**Alternatives rejected**: path routes (need a server fallback and would touch the query-string token handling); a routing library (FR-027); restoring in-progress state from the address (clarified out of scope; needs persistence).

**Evidence**: `frontend/src/App.tsx` holds `started`, `activeTab`, `tabsVisible` and five `*Mounted` flags in component state; no test sets the URL (`frontend/tests/setup.ts` has no location reset), so tests need `history.replaceState` reset between cases.

## D2 - Shell: AppShell, Sidebar, PageHeader and a drawer; App keeps its mount-once pages

**Decision**: Replace the header + tab menu + chooser branching in `App.tsx` with `AppShell` (sidebar + header + main). `App` derives the open destination from the route instead of `started`/`activeTab`/`tabsVisible`, but keeps the existing pattern where a page, once reached, stays mounted and is hidden rather than unmounted.

**Rationale**: FR-005 requires that nothing "Back to start" preserved is lost. The stay-mounted pattern is exactly what preserves it (the comment in App.tsx on the guided page's resume guard explains why unmounting would re-trigger the execution hand-off). The route changes which page is visible, not which are mounted.

**Alternatives rejected**: unmounting inactive pages (loses drafts, selections and editor changes); a global store (constitution XXVII, no need).

## D3 - Token model: one accent, a literal brand ramp, a new on-accent pair

**Decision**: In `frontend/src/index.css` (still the single definition, FR-008): add `--color-accent` (lime) and `--color-on-accent` (dark) for fills that carry text; remap the `brand-*` scale to a literal olive ramp used for text, lines, borders and focus (`brand-50` lime-pale, `brand-100` lime, `brand-600` lines, `brand-700` text), written as plain hex in both themes. Remove the section accents, the eight `--solid-*` hues, the four `--color-wf-*` tokens, the `[data-section]` blocks and the `:root,[data-section]` recompute with its `@theme inline` indirection. Add `--color-border-control`. Retune `--color-info*` into the palette (neutral mint family, always with icon and text).

**Rationale**: The audit found 489 `brand-*` uses across 89 files, so keeping the name avoids touching them, but 41 white-on-`brand-600` fills cannot stay (lime cannot carry white text, FR-009). Writing the ramp as literals lets a unit test read `index.css` and compute contrast (SC-003); the old derivation used `color-mix`, which cannot be evaluated outside a browser. Dropping `data-section` removes machinery that no longer has a purpose.

**Fill migration**: every `bg-brand-600|700 ... text-white` becomes `bg-accent text-on-accent`. Known sites (from `grep`): `components/ImportRunStepper.tsx:51`, `performance/path/PerformanceStepper.tsx:48`, `userScript/ScriptTabs.tsx:75`, `performance/path/SourcePicker.tsx:87`, `requestChain/RunLaunchCard.tsx:14`, `userScript/UserScriptRunTrigger.tsx:37`, `WorkflowStageTracker.tsx:133`, `controlStyles.ts` (`BUTTON_STYLES.primary`), `EntryFeatureIcon.tsx:48`, plus `PerformancePlanScaleMockPage.tsx`. A guard test forbids the pairing from returning.

**Computed pairings** (WCAG relative luminance, hand-checked; the test is the authority): olive text `#5B7314` is about 5.4:1 on white, 5.0:1 on lime-pale, 4.6:1 on mint; muted text `#66706A` is 5.1:1 on white but only 4.4:1 on mint, so muted text must not sit on mint (use secondary text); lime fill with dark `#2A3010` text is far above 4.5:1; status text on its tint is 5.9 to 6.1:1.

## D4 - Control outlines at 3:1 through one token

**Decision**: Add `--color-border-control` (proposed light `#7C8680`, dark `#6F7D74`) and a shared field style (`FIELD_STYLES` in `controlStyles.ts`) used by inputs, selects, textareas, checkboxes and secondary buttons. Card edges and dividers keep `border`/`border-strong`.

**Rationale**: 107 form controls exist and 23 uses of `border-border-strong`; routing them through one constant makes the change auditable and testable. `GapFilters.tsx` already defines its own `FIELD` string, which shows the duplication risk the shared constant removes. Selected and current states also get a 3:1 deep-olive edge, because lime on white is only about 1.15:1 and the spec's 3:1 rule covers meaningful graphics.

**Alternatives rejected**: darkening `border-strong` globally (would darken decorative card edges against FR-009's exemption); hover-only borders (leaves resting controls non-compliant).

## D5 - Guard tests: split before deleting

**Decision**: Move the hex-colour and Tailwind-palette-utility guards out of `frontend/tests/unit/sectionCatalog.test.ts` into a new `colourTokens.test.ts` first, then delete the section checks together with `sectionCatalog.ts` and the CSS section blocks in one change. Add `contrast.test.ts` (reads `index.css`, computes the pairings of `contracts/tokens.md` for both themes) and a guard that fails on white text over an accent fill.

**Rationale**: The agent inventory found that the section guard file also holds the only "no hex / no palette utilities" scans, and its check (b) requires the section tokens to exist while the file does. Deleting out of order would either fail the suite or silently drop the guards.

## D6 - Pattern primitives, one stepper, one library page

**Decision**: New presentational primitives in `frontend/src/components/patterns/`: `Card`, `Pill`, `TaskCard`, `StepTrail`, `Banner`, `DropZone`; extend `StatTile` with a highlight variant and a card-based layout; reuse the existing `EmptyState`, `StatusBadge`, `HttpMethodBadge`, `Pagination` and `Dialog`. `ImportRunStepper`, `PerformanceStepper` and `ScriptTabs` render through `StepTrail` while keeping their logic, step names, hints, lock reasons and `aria-current`. FR-014's documented pattern set is a live preview page, `?mock=pattern-library` (`pages/PatternLibraryPage.tsx`), not a sidebar entry, following the existing `?mock=performance-plan-scale` precedent.

**Rationale**: Three steppers already implement the same idea with different markup (`ImportRunStepper` 86 lines, `PerformanceStepper` 78, `ScriptTabs` 106). One component makes "same pattern everywhere" true by construction. FR-002 limits the sidebar to six navigation destinations, so the mock's "Pattern library" sidebar entry is not carried over.

## D7 - Guided Workflow: derive the sidebar from the existing stage model

**Decision**: The sidebar's stage list is built from `WORKFLOW_PHASES`, `STAGE_LABELS`, `getPhaseProgress` and `getLockReason` in `components/workflowStageViewModel.ts`, with no second copy. The stage groups are therefore Prepare (3 stages), Design (3), Organize (2: dependency analysis, workflow review) and Execute (3: Postman generation, execution, performance testing, the last optional). The design mock grouped them 3/3/3/2; the mock is wrong and the model wins. `TestGenerationWorkflowPage` gains an `onWorkflowChange` callback (beside `onSectionChange`), and App fetches the current workflow once on load so the sidebar is accurate before the guided page has ever mounted. A stage address maps to the existing `stageRequest` mechanism.

**Rationale**: `getLockReason` already produces the "Complete X first" text the spec requires for locked stages, and `stageRequest` already lets another screen ask the page to show a stage (Coverage's "Open scenarios" uses it).

## D8 - Home data: only existing sources, bounded fan-out

| Home content | Source (existing) |
|---|---|
| Coverage %, runtime-verified %, open gaps, pending scenarios, coverage by area, operations by method, next steps | `useCoverage({}, active)` returning `CoverageSnapshot`: metric ids `spec-operations` and `runtime-operations`, `totals.gaps`, `context.scenarioCounts.pending`, `categoryCoverage`, `operations[].method` |
| Guided Workflow state and unfinished stage | `fetchCurrentWorkflow()` (also feeds the sidebar), `activeStageId`, `stages` |
| Performance draft cue | the `performanceDraft` flag already held by App |
| AI provider status | new frontend client for the existing `GET /api/ai/status` (fields `state`, `provider`, `reason`); no backend change |
| Recent runs, Import & Run | `fetchUploadedCollections()` then `fetchUploadedCollectionRuns(id)` for the ten most recently updated collections (the loop `ExternalCollectionsPage` already runs) |
| Recent runs, Performance | `listPlans()` then `chainRunsClient(planId).fetchRuns()` for the ten most recently updated plans, as `RecentRuns.tsx` does; retired legacy runs (`legacyRunsClient`) are not included, matching that component |
| Recent runs, Run k6 Script | the existing `GET /api/user-scripts/runs` called without `scriptId` (the backend already allows it); a small client function is added in the frontend |

**Bounds and behaviour**: Home reads only while it is the visible destination, once per visit, aborts on leaving, never polls, merges by start time, shows the newest eight and says in words when a source could not be read. Debug runs create no run record on either path (verified in the debug-run services), so they never appear.

**Deep links to a run**: Import & Run already accepts `openRunRequest`; Performance's `OpenPerformancePlanRequest` gains an optional `runId` (its internal `open(planId, runId)` already supports it); Run k6 Script gains an `openRunRequest` prop with the same shape as Import & Run's. All three are frontend changes only.

**Status words** differ by source (Import & Run has no "failed" value); the Home list maps each to one shared set: In progress, Completed, Cancelled, Failed.

## D9 - AI status uses an existing endpoint

The spec assumes the AI tile appears only if state "can be read from what the interface already receives" and forbids a new endpoint. `GET /api/ai/status` exists (`backend/src/api/aiStatus.ts`) but no frontend client reads it. Adding a client function is a frontend change; the endpoint, payload and security are untouched. The tile shows the state in words, the provider (local or mock) and the reason when unavailable, and never the model identifier or benchmark data.

## D10 - Narrow-window breakpoint and drawer

**Decision**: The drawer applies below Tailwind's `lg` (1024 px), using standard utilities and no arbitrary value. The drawer reuses the focus-trap and Escape logic of `Dialog.tsx` through an extracted `useFocusTrap` hook that `Dialog` also uses.

**Rationale**: At 248 px the sidebar leaves too little width for the content grids between 900 and 1024 px. Extracting the hook keeps one tested implementation of trap, Escape and focus return (FR-022, FR-024); `Dialog` has existing tests that guard the refactor. The sidebar must not call `matchMedia` unguarded, because jsdom has none (`useTheme.ts` already uses `window.matchMedia?.`); layout switches use CSS, not script.

## D11 - Sidebar labels and test contract

**Decision**: Sidebar entries are links (`<a href="#/...">`) whose text is the workflow title from `workflowCatalog` (so "Import & Run Collection", not the mock's shortened "Import & Run"), and Home's launch tiles stay buttons with the same names. By-role queries therefore stay unique per role, and the mock's shortened label is dropped, resolving the terminology item deferred at clarification.

**Rationale**: Existing App tests locate workflows with `findByRole("button", { name: "Guided Workflow" })`. Links and buttons are different roles, so no query becomes ambiguous.

## D12 - Test plan from the inventory

Replace: `EntryChooser.test.tsx`, `AppHeader.test.tsx` (re-home its connection-status, palette-button and help-focus-return behaviour in a shell test), `sectionCatalog.test.ts` (after D5), the accent and workflow-marker cases in `Tabs.test.tsx` (Tabs itself stays, it is used by `ExternalCollectionRunPanel` and `StepEditor`), and three `App.test.tsx` cases (entry chooser first, section accent, guided section). Adjust selectors in the remaining `App.test.tsx` cases, `apiCoverage/CoverageNavigation.test.tsx`, `paletteCommands.test.ts`, `CommandPalette.test.tsx`, `UserScriptPage.test.tsx`, `PerformanceHome.test.tsx`, `PerformancePath.test.tsx`, `ScriptEditor.test.tsx` and the colour and chooser cases of `workflowCatalog.test.ts`. Add: routes, shell, sidebar stages, drawer, Home hooks, contrast, colour guard. Keep the stay-mounted assertion (no second `/api/external-collections` fetch) under sidebar navigation. App tests stub `fetch` and reject unknown URLs, so Home's new reads need stubs in those tests.

## D13 - Left-aligned text

Remove the `p:not(.font-mono){ text-align: justify; hyphens: auto }` rule in `index.css` and the three `text-justify`/`hyphens-auto` utilities in components. No test asserts justification.

## D14 - Reports and verification

Standalone reports are verified, not restyled (FR-026): open the performance report and the run report (HTML and PDF) once per theme setting. Visual verification (SC-001, SC-004, SC-007) uses a scripted headless browser over the matrix of screens, themes and widths, run from a script kept outside the product, so no dependency is added. See `quickstart.md`.

## D15 - Documentation and version

Per the repository convention, finishing the feature updates `README.md`, `specs/ROADMAP.md` and bumps the version with `npm run version:bump`; the pattern library page and `design-reference/` are the pattern documentation required by FR-014.
