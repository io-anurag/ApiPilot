# Data Model: Sidebar Shell and Shared Visual Language

The feature stores nothing and adds no backend or shared-domain type (FR-025). These are the presentation-level models the frontend needs. All are derived from state the application already holds and live in `frontend/src`.

## Destination

A place the sidebar leads to. Derived from a fixed catalog plus the current workflow; never stored.

| Field | Type | Notes |
|---|---|---|
| `id` | `"home" \| "guided" \| "import" \| "performance" \| "k6" \| "coverage"` | The six top-level destinations. Maps to the existing `TopLevelView` (`guided-workflow`, `import-collection`, `performance`, `user-script`, `coverage`) plus `home`. |
| `label` | string | The workflow title from `workflowCatalog` (single source), or "Home" / "Coverage". |
| `parent` | string \| null | Breadcrumb parent: "Workspace", "Workflows" or "Results"; for a stage, "Guided Workflow › {phase}". |
| `stage` | `WorkflowStageId \| null` | Set only for a Guided Workflow stage destination. |
| `state` | `current \| done \| available \| locked` | `locked` carries `lockReason`. |
| `lockReason` | string \| null | From `getLockReason` ("Complete {stage} first"); null unless locked. |

**Stage destinations** are the eleven `WorkflowStageId` values grouped by `WORKFLOW_PHASES`: Prepare (`upload`, `analysis`, `apiReview`), Design (`deterministicGeneration`, `aiEnhancement`, `scenarioReview`), Organize (`dependencyAnalysis`, `workflowReview`), Execute (`postmanGeneration`, `execution`, `performanceTesting`, the last optional). Stage `state` maps from `StageStatus`: `complete`, `skipped` and `partial` read as done; `active` as current when it is the stage on screen; `stale` as done with an "Needs to be redone" label; `not-yet-reached` as locked.

**Rules**: exactly one destination is `current`; a locked destination is never navigable; a done destination is viewable (the page's existing `viewedStageId`).

## Route

The address of a destination.

| Field | Type | Notes |
|---|---|---|
| `view` | the `id` above | |
| `stage` | `WorkflowStageId \| undefined` | Only with `view = "guided"`. |

Textual form and resolution are specified in `contracts/routes.md`. A route carries identifiers only (FR-029).

### RouteResolution

The result of resolving a requested route against current state.

| Field | Type | Notes |
|---|---|---|
| `route` | Route | The route to show (the requested one, or the nearest valid). |
| `notice` | string \| null | Text explaining a redirect; null when the request was shown as asked. |
| `replace` | boolean | True when the browser address should be replaced, not pushed. |

State transitions: `request -> valid` (shown), `request -> redirected` (nearest valid with notice). There is no failed state: every address resolves to something shown.

## Palette

Named colours with light and dark values, defined once in `frontend/src/index.css` as plain hex (so the contrast test can read them). Names and the required pairings are in `contracts/tokens.md`. Groups: neutrals (surface, background, borders, text), accent (`accent`, `on-accent`), brand ramp (`brand-50` to `brand-900`), tints (`lime-pale`, `mint`, `sage`, `olive`), control border, status (`success`, `warning`, `danger`, each with a tint and text pair), `info` (palette-neutral), method colours (unchanged), chart series.

## Pattern

A reusable presentation with states. Documented live by the pattern library preview (`?mock=pattern-library`).

| Pattern | States | Replaces / reuses |
|---|---|---|
| Stat tile | default, highlight | extends `StatTile` |
| Card | default, flat | new `Card` |
| Pill | accent, mint, line, ok, warn, bad | new `Pill`; `StatusBadge` keeps its status API |
| Task card | default, highlighted | new `TaskCard` |
| Step trail | done, current, locked (+ hint, lock reason) | new `StepTrail`; used by `ImportRunStepper`, `PerformanceStepper`, `ScriptTabs`, and the Guided tracker's phase tiles |
| Banner | warning, info-neutral, error | new `Banner` |
| Drop zone | idle, active, disabled | new `DropZone` |
| Table | header tint, pager | existing tables + `Pagination` |
| Empty state | with icon, text, optional action | existing `EmptyState` |
| Dialog | default | existing `Dialog` (+ shared `useFocusTrap`) |

## Home figure

A value shown on Home, never stored. Each has a source and a fallback text; the table is `contracts/home-data.md`.

| Field | Notes |
|---|---|
| `id` | e.g. `spec-coverage`, `runtime-verified`, `open-gaps`, `pending-scenarios` |
| `value` | number or null |
| `state` | `loading \| ready \| unavailable` |
| `reason` | text, required when `state = unavailable`; the figure is not rendered |

**Rule**: a figure with `value = null` renders its `reason` and no number (FR-019).

## RecentRun

One row of Home's recent-runs list; a view of an existing record, never persisted.

| Field | Type | Notes |
|---|---|---|
| `key` | string | `${workflow}:${runId}` for list identity |
| `workflow` | `import \| performance \| k6` | |
| `subject` | string | Collection name (`uploadedCollectionSnapshot.name`), plan name (from `ChainPlanSummary.name`), or script name (`snapshot.scriptName`) |
| `startedAt` | ISO string | Sort key, newest first |
| `status` | `in-progress \| completed \| cancelled \| failed` | Shown as words: In progress, Completed, Cancelled, Failed |
| `target` | `{ workflow, ownerId, runId }` | `ownerId` is the collection id, plan id or script id; used for the deep link |

**Rules**: at most 8 rows shown, 10 owners read per source; a source that cannot be read is skipped and named in words; the list is empty with a text reason when no source returns a run; a Debug run never appears (it creates no record).

## Viewport mode

`wide` (sidebar visible) at or above `lg` (1024 px), `narrow` (drawer) below. Pure CSS; no stored state except the drawer's open/closed flag in the shell, reset when a destination is chosen.
