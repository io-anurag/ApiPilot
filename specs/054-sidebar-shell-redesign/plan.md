# Implementation Plan: Sidebar Shell and Shared Visual Language

**Branch**: `054-sidebar-shell-redesign` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/054-sidebar-shell-redesign/spec.md`

## Summary

Replace the top header, tab menu and start screen with one shell: a persistent left sidebar and a page header, with a drawer below 1024 px. Retire the eight section hues and four workflow hues in favour of one lime accent in a literal, testable token set with a derived dark theme, darker control outlines (3:1), and left-aligned text. Rebuild every in-scope screen from one pattern set (stat tile, card, pill, task card, step trail, banner, drop zone, table, dialog), unify the three steppers on one component, give each destination a hash address with a pure route module, and replace the start screen with a Home that shows only figures backed by existing data, including a "Recent runs" list assembled from the runs the three workflows already hold.

The work is frontend only. No backend endpoint, payload, shared-domain type, stored datum or workflow rule changes (FR-025). It is delivered in six slices (below), each leaving a working application, ordered so the colour change lands first and the screens last.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (existing).

**Primary Dependencies**: React 18.3, Vite 8, Tailwind CSS v4 with the `@tailwindcss/vite` plugin and `@theme` tokens in `frontend/src/index.css` (existing). IBM Plex Sans and JetBrains Mono via `@fontsource` (existing). No new runtime or dev dependency (FR-027).

**Storage**: None added. The existing `apipilot-theme` localStorage key is unchanged. Addresses carry identifiers only; nothing is persisted from them.

**Testing**: Vitest 4 with React Testing Library and jsdom (existing). New pure-function tests for routes and contrast; component tests for shell, sidebar, drawer, patterns and Home hooks; scripted visual review for the screen matrix (quickstart).

**Target Platform**: Modern evergreen browsers on desktop and phone; local-first web app served by Vite in development.

**Project Type**: Web application (npm workspaces: backend, frontend, packages/shared-domain). Only `frontend/` changes.

**Performance Goals**: Home issues a bounded number of reads once per visit (coverage, workflow, AI status, one collections list plus runs for at most ten collections, one plans list plus runs for at most ten plans, one k6 runs list) and renders each widget as its data arrives, so a slow source never blocks the rest. No polling. Navigation between already-mounted pages must not refetch (stay-mounted pattern).

**Constraints**: WCAG 2.1 AA contrast in both themes with 3:1 control outlines (FR-009); state never by colour alone; no `matchMedia` unguarded (jsdom has none); addresses leave the query string untouched (AP-049 token, `?mock=`); existing test identifiers and accessible names preserved (shell-accessibility contract); no inline colour styles and no arbitrary Tailwind values for colour or spacing (CLAUDE.md sections 26 to 32).

**Scale/Scope**: 149 `.tsx` files (about 24,000 lines); 489 `brand-*` uses in 89 files; 41 white-on-accent fills to migrate; six top-level destinations and eleven guided stages; about 125 test files, of which 5 are replaced and about 12 need selector changes (research D12).

## Constitution Check

*Gate: passes before Phase 0 and re-checked after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I Specification is the source of truth; XIV No silent assumptions | Home shows only existing data or a text reason; no figure is invented (FR-019). Pass. |
| V Local-first AI; XVII Security and privacy; XVIII Secrets; XX Observability without sensitive logging | No data leaves the machine (FR-025). Addresses carry identifiers only, never names, content, values or tokens, so URLs in history, logs or sharing leak nothing (routes contract). The AI tile shows state and provider, never model identifiers. The AP-049 token and `?mock=` addresses are untouched. Pass. |
| IX Separation of concerns; XXI Testability at every boundary | Route logic is a pure module; Home reads are hooks over existing clients; presentation primitives are stateless. Pass. |
| XIX Fail safely | An address that cannot be shown resolves to the nearest valid destination with a text notice, never a blank page; a failing Home source is named and skipped. Pass. |
| XXV Incremental delivery | Six slices, each independently shippable (below). Pass. |
| XXVII Prefer simple architecture; XXVIII Technology is replaceable | Hash routing with no library; one shared stepper instead of three; no store. Pass. |
| XXXI Definition of done; XXXII Review at real scale; XXXIII Presentation consistent | Bulk actions, filters and paging of the review screens are preserved (FR-015); the pattern set makes presentation consistent by construction. Pass. |
| II, III, IV, VI to VIII, X to XIII, XV, XVI, XXII to XXIV, XXVI, XXIX, XXX | Not touched: no AI, generation, domain-model or provenance behaviour changes. Not applicable. |

No principle is violated; no constitution amendment is needed. The trade-off recorded for XXX: darker control outlines (D4) deliberately depart from the approved mock to meet the accessibility rule the spec requires.

**Post-design re-check**: the design adds no persistence, no new external call beyond existing endpoints (`/api/ai/status` is existing, only a frontend client is new), and no logging of addresses or content. Result unchanged: pass.

## Project Structure

### Documentation (this feature)

```text
specs/054-sidebar-shell-redesign/
├── plan.md                    # This file
├── research.md                # Phase 0: decisions D1 to D15
├── data-model.md              # Phase 1: Destination, Route, Palette, Pattern, Home figure, RecentRun
├── quickstart.md              # Phase 1: validation scenarios and commands
├── contracts/
│   ├── routes.md              # Address grammar, resolution, history
│   ├── tokens.md              # Token table, contrast pairings, guards
│   ├── home-data.md           # Home sources, next steps, recent runs, deep links
│   └── shell-accessibility.md # Landmarks, names, test ids, drawer, motion
├── design-reference/          # Approved mock (apipilot-design.html, .css)
├── checklists/requirements.md
└── tasks.md                   # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── index.css                      # tokens rebuilt (literal hex, accent/on-accent, border-control); section and wf tokens removed; justify rule removed
│   ├── App.tsx                        # route-driven; AppShell; stay-mounted pages kept; chooser, Tabs and Back-to-start branches removed
│   ├── navigation/                    # NEW
│   │   ├── routes.ts                  #   parseRoute / formatRoute / resolveRoute (pure)
│   │   ├── destinations.ts            #   destination catalog + stage list from workflowStageViewModel
│   │   └── useRoute.ts                #   hash listener, navigate, redirect
│   ├── components/
│   │   ├── shell/                     # NEW: AppShell, Sidebar, SidebarStages, PageHeader, Drawer, SkipLink, RouteNotice
│   │   ├── patterns/                  # NEW: Card, Pill, TaskCard, StepTrail, Banner, DropZone
│   │   ├── home/                      # NEW: LaunchTiles, SummaryTiles, CoverageByArea, MethodBreakdown, NextSteps, RecentRuns, AiStatusTile
│   │   ├── controlStyles.ts           # FIELD_STYLES added; BUTTON_STYLES.primary -> accent/on-accent
│   │   ├── workflowCatalog.ts         # tone colour fields removed; titles, ids, artifacts kept
│   │   ├── sectionCatalog.ts          # DELETED with the section tokens
│   │   ├── EntryChooser.tsx, EntryIllustration.tsx, EntryFeatureIcon.tsx   # DELETED (Home replaces; icons that other screens use are moved)
│   │   ├── AppHeader.tsx              # DELETED (PageHeader replaces)
│   │   ├── Dialog.tsx                 # uses extracted useFocusTrap
│   │   ├── CommandPalette.tsx, paletteCommands.ts, HelpDialog.tsx   # "Go to Home"; card style
│   │   ├── WorkflowStageTracker.tsx   # restyled on StepTrail; testids kept; section colouring removed
│   │   ├── ImportRunStepper.tsx, performance/path/PerformanceStepper.tsx, userScript/ScriptTabs.tsx   # render via StepTrail
│   │   └── (in-scope screens)         # API Review, Scenario Review, Import & Run, Performance, Run k6 Script, Coverage restyled in slice 4
│   ├── hooks/
│   │   ├── useFocusTrap.ts            # NEW (extracted from Dialog)
│   │   ├── useWorkflowSnapshot.ts     # NEW: current workflow for sidebar and Home
│   │   ├── useRecentRuns.ts, useAiStatus.ts   # NEW (Home)
│   ├── services/
│   │   ├── aiStatusClient.ts          # NEW: GET /api/ai/status (existing endpoint)
│   │   └── userScriptClient.ts        # + fetchAllRuns() (GET /api/user-scripts/runs without scriptId)
│   └── pages/
│       ├── HomePage.tsx               # NEW
│       ├── PatternLibraryPage.tsx     # NEW (?mock=pattern-library)
│       ├── TestGenerationWorkflowPage.tsx   # + onWorkflowChange; stageRequest from the route
│       ├── PerformancePage.tsx        # OpenPerformancePlanRequest + optional runId
│       └── UserScriptPage.tsx         # + openRunRequest prop
└── tests/
    ├── unit/navigation/               # routes.test.ts, destinations.test.ts
    ├── unit/shell/                    # shell, sidebar stages, drawer, skip link, notice
    ├── unit/home/                     # data hooks, figures, recent runs, next steps
    ├── unit/contrast.test.ts, colourTokens.test.ts   # NEW (split from sectionCatalog.test.ts)
    └── (replaced and adjusted tests per research D12)
```

**Structure Decision**: Web application, `frontend/` only. New code follows the existing conventions: pure catalogs and view models beside components, hooks in `hooks/`, one client module per backend area in `services/`, pages in `pages/`. Pattern primitives get their own folder because they are shared by every screen.

## Delivery slices

Each slice ends with `npm test`, `npm run lint` and `npm run build` passing and the application usable; slices 1 and 2 may ship alone.

| Slice | Content | Spec coverage |
|---|---|---|
| 1. Tokens and guards | New palette in `index.css` (light and dark, literal hex); brand ramp remap; `accent`/`on-accent`; `border-control` and `FIELD_STYLES`; info recolour; fill migration (41 sites); justify rule and `text-justify` removed; `colourTokens.test.ts` extracted first, then section catalog, `data-section` and `wf-*` removed; `contrast.test.ts`. The old shell still stands, recoloured. | FR-006 to FR-012, SC-003, SC-010 |
| 2. Shell and routes | `routes.ts`, `useRoute`, `useWorkflowSnapshot`, AppShell, Sidebar with stages, PageHeader, Drawer and `useFocusTrap`, skip link, route notice; `App.tsx` route-driven; chooser content temporarily rendered as Home's body; Tabs, `AppHeader`, "Back to start" and the Exit buttons removed; palette "Go to Home"; `onWorkflowChange` and stage requests. | FR-001 to FR-005, FR-022 to FR-024, FR-029, SC-002, SC-008, SC-009, SC-011 |
| 3. Pattern primitives | Card, Pill, TaskCard, StepTrail, Banner, DropZone; StatTile highlight; the three steppers and the Guided tracker move onto StepTrail; `PatternLibraryPage`. | FR-014, FR-016 |
| 4. Screens | API Review and Scenario Review, Import & Run, Performance, Run k6 Script, Coverage, help dialog and palette rebuilt from the patterns; wide tables scroll inside cards; selector and test adjustments. Guided stages 6 to 11 inherit shell and colours only. | FR-013, FR-015, FR-017, SC-001, SC-004, SC-005, SC-007 |
| 5. Home | `HomePage`, summary tiles, coverage by area, method breakdown, next steps, recent runs and AI status from the home-data contract; deep-link props on Performance and Run k6 Script; chooser components deleted. | FR-018 to FR-021, SC-006 |
| 6. Close-out | Scripted visual matrix review; reports opened in both themes; documentation (`README.md`, `specs/ROADMAP.md`); version bump. | FR-026, SC-001, quickstart |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Deleting `sectionCatalog.test.ts` drops the only hex and palette guards | Extract them to `colourTokens.test.ts` first (D5). |
| Brand fills with white text slip back in | Guard test 3 in the tokens contract. |
| App tests fail on new fetches from Home | Home reads only while visible and every source handles failure; App tests add stubs; the shared `setup.ts` resets the address between tests. |
| Hash addresses leak between tests | Reset with `history.replaceState` in `setup.ts` (jsdom keeps `location` across cases). |
| Stay-mounted guided page re-triggers its execution hand-off | Keep the existing guard unchanged; add a regression test that navigating away and back does not hand off again. |
| Sidebar stage statuses stale before the guided page mounts | App fetches the current workflow on load (`useWorkflowSnapshot`) and the page reports changes after that. |
| Muted text on mint falls to 4.4:1 | Contract forbids that pairing; contrast test enumerates the allowed ones. |
| Large slice 4 diff | One screen per commit-sized task; each screen keeps its own tests green before the next starts. |

## Complexity Tracking

No constitution violations to justify. Two deliberate departures from the design reference are recorded here instead: control outlines are darker than the mock (D4, spec FR-009), and the mock's shortened "Import & Run" label and its sidebar "Pattern library" entry and "Local-first AI" card are not carried over (D6, D11, spec FR-002).
