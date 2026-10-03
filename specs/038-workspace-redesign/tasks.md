---

description: "Task list for AP-038 Workspace Redesign (Design A)"
---

# Tasks: Workspace Redesign (Design A, "Artifact hero")

**Input**: Design documents from `/specs/038-workspace-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md,
quickstart.md

**Tests**: The spec asks for them (React Testing Library for the start screen, palette, help
dialog, header and tabs), so test tasks are included.

**Organization**: Tasks are grouped by user story so that each story can be implemented and
tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks).
- **[Story]**: The user story the task belongs to (US1–US4).

---

## Phase 1: Setup

- [X] T001 Remove the unused serif face (research D1):
  - run `npm uninstall @fontsource/ibm-plex-serif -w frontend`, so `frontend/package.json` and
    `package-lock.json` update through npm;
  - in `frontend/src/main.tsx`, drop the two `@fontsource/ibm-plex-serif` imports and add
    `@fontsource/ibm-plex-sans/700.css`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The workflow catalog, the icons and the lifted theme state, which US1, US3 and US4
all use.

- [X] T002 [P] Create `frontend/src/components/workflowCatalog.ts` (research D4, data-model
  WorkflowEntry and ArtifactChoice). Rules:
  - `WORKFLOWS` is a readonly array in today's tab order, with fields `id`, `title`, `tabLabel`,
    `description`, `icon`, `recommended` and `tone` (`marker`, `text`, `solid`, `tint`);
  - `tone` values are literal Tailwind class strings using `wf-*` tokens;
  - `ARTIFACT_CHOICES` covers openapi → guided-workflow and quick-performance, postman →
    import-collection, and k6 → user-script;
  - add `workflowById(id)`;
  - move the `EntryChoice` union here and re-export it from `EntryChooser.tsx`, so existing
    imports keep working.
- [X] T003 [P] Create `frontend/src/components/WorkflowIcon.tsx` (research D11):
  - `WorkflowIcon` takes `{ name: WorkflowIconName | ArtifactIconName; className?: string }`;
  - inline SVG, `aria-hidden`, `currentColor` stroke;
  - five workflow icons and three artifact icons.
- [X] T004 [P] Add `frontend/tests/unit/workflowCatalog.test.ts`. It checks:
  - five entries whose ids equal the `EntryChoice` values, in tab order;
  - titles, tab labels and descriptions equal today's strings verbatim;
  - only Guided Workflow is recommended;
  - every artifact's workflows exist in the catalog.
- [X] T005 Lift the theme state (research D5). Changes:
  - `frontend/src/App.tsx` calls `useTheme()`;
  - `frontend/src/components/AppHeader.tsx` takes `{ health, theme, onThemeChange }` and no
    longer calls `useTheme`;
  - `frontend/tests/unit/AppHeader.test.tsx` renders with the new props; its existing four
    assertions stay unchanged.

**Checkpoint**: `npm test -w frontend` passes; the app looks unchanged.

---

## Phase 3: User Story 1 – Start from the artifact I already have (Priority: P1) 🎯 MVP

**Goal**: A compact Design A hero with an illustration, three artifact choices and five
colour-coded cards, all opening workflows through the existing `onSelect`.

**Independent test**: quickstart scenarios 1 and 2. In `EntryChooser.test.tsx`, artifact
controls and cards call `onSelect` with the same id.

- [X] T006 [P] [US1] Create `frontend/src/components/EntryIllustration.tsx` (FR-008):
  - an `aria-hidden` wrapper with `hidden lg:block`;
  - a dark code card reading "openapi: 3.0.0 / paths: / /users: get: post:";
  - the existing `/logo-icon.png` in a rounded tile;
  - three output tiles (Test scenarios, Postman collection, k6 performance tests) using
    `WorkflowIcon` tinted with the guided, import and quick tones;
  - dashed SVG connectors in `text-wf-plans`;
  - token colours only, no arbitrary hex.
- [X] T007 [US1] Rewrite `frontend/src/components/EntryChooser.tsx` (FR-008 to FR-012,
  contracts/ui-contract.md):
  - keep `data-testid="entry-chooser"` and the `onSelect` prop;
  - hero grid: text column, plus `EntryIllustration` on the right at `lg`;
  - eyebrow, then an h2 "Start with the artifact you have." with "artifact" in `text-wf-plans`;
  - the existing lead sentence;
  - the artifact row: one `role="group"` per `ARTIFACT_CHOICES` entry, labelled by the artifact,
    with its icon. Each workflow is a `button` named "`{title}`, for a/an `{artifact}`" with a
    colour marker and the visible title;
  - a section with "Choose a workflow", an h2 "Launch a test session"
    (`id="entry-paths-heading"`), and the session note with an info icon;
  - a grid of five card buttons (`sm:grid-cols-2 lg:grid-cols-5`). Each card has the accessible
    name = title, `aria-describedby` = description id, an icon tile, a "Recommended" text label
    on guided, the description, and a solid round arrow (`aria-hidden`);
  - `motion-safe:` transitions and visible focus rings;
  - remove the old vertical centring (`min-h-[calc(100vh-9rem)]`).
- [X] T008 [P] [US1] Add `frontend/tests/unit/EntryChooser.test.tsx`. It checks:
  - the headline and the "Launch a test session" heading;
  - three artifact groups with their workflow controls;
  - each artifact control and each card calls `onSelect` with the matching id (SC-002);
  - card accessible names equal the titles, and descriptions are linked;
  - "Recommended" is present as text on the guided card only;
  - the illustration is `aria-hidden`.
- [X] T009 [US1] Make the start-screen query in `frontend/tests/unit/UserScriptPage.test.tsx`
  ("is offered on the start screen") exact: `{ name: "Run k6 Script" }`. This is an intentional
  change (plan.md, research D9).
- [X] T010 [US1] (Amended after the user's feedback that the page felt crammed: Design A
  spacing restored; SC-001 now requires the section heading in the first screen.) Check the fold
  (SC-001, quickstart scenario 2): with the dev server running,
  take headless Chrome screenshots at 1366 × 657 in light and dark theme, and confirm all five
  cards are fully visible. If not, tighten the hero spacing in `EntryChooser.tsx` (research
  D10's fallback).

**Checkpoint**: The start screen works and is tested; `App.test.tsx` passes unchanged.

---

## Phase 4: User Story 2 – One consistent look on every page, in both themes (Priority: P1)

**Goal**: Sans-serif headings, the navy dark theme, the cool light background and per-workflow
colours across every page.

**Independent test**: quickstart scenario 6 (SC-004, SC-005); `Tabs.test.tsx` marker test.

- [X] T011 [US2] Update `frontend/src/index.css` (research D2, D3):
  - `--font-display` uses IBM Plex Sans;
  - light token values: background, surface, chrome, border, muted;
  - `--color-wf-guided|import|quick|plans|k6` in `@theme`;
  - dark overrides of all of these under `:root[data-theme="dark"]`;
  - body text colours `#121a26` and `#e6ecf5`;
  - `.technical-grid` becomes a top blue radial glow over a faint neutral grid in both themes;
  - update the token comments.
- [X] T012 [US2] Extend `frontend/src/components/Tabs.tsx` with an optional
  `TabItem.markerClassName`. When set, an `aria-hidden` 8 px rounded square renders before the
  label. In `frontend/src/App.tsx`, build `TABS` from `WORKFLOWS` (`tabLabel`, `tone.marker`)
  (FR-013).
- [X] T013 [P] [US2] Extend `frontend/tests/unit/Tabs.test.tsx`: a marker renders, is
  `aria-hidden`, and leaves the button's accessible name and `aria-current` unchanged.
- [X] T014 [P] [US2] Restyle the header in `frontend/src/components/AppHeader.tsx` and
  `frontend/src/components/ThemeToggle.tsx` to Design A (FR-006, FR-007):
  - a larger logo tile;
  - a bold sans name with the version badge;
  - a rounded theme pill with the active sun in amber (light) or moon in indigo (dark);
  - a rounded connection pill with no chevron.
  Keep all roles, names, the `data-testid`, `truncate` and the alert semantics.
- [X] T015 [US2] Sweep dark theme (FR-004, SC-004):
  - grep `frontend/src` for `dark:` `*-800|900|950` surfaces, hex literals and `font-serif`, and
    recolour any green-black surface to tokens;
  - take headless screenshots of the start screen and each view in dark theme, and record the
    result in `specs/038-workspace-redesign/validation.md`.

**Checkpoint**: Every page follows the new tokens; all tests pass.

---

## Phase 5: User Story 3 – Switch workflow or theme from the keyboard (Priority: P2)

**Goal**: A Ctrl/⌘+K command palette over the five workflows, "Back to start" and the theme
switch, reusing the existing navigation handlers.

**Independent test**: quickstart scenario 4; `paletteCommands.test.ts`, `CommandPalette.test.tsx`
and the `App.test.tsx` palette cases.

- [X] T016 [P] [US3] Create `frontend/src/components/paletteCommands.ts` (research D7,
  data-model Command), with these pure functions:
  - `buildCommands({ workflowShown, theme })`;
  - `filterCommands(commands, query)`;
  - `isPaletteShortcut(event)`;
  - `isEditableTarget(target)`;
  - `isMacPlatform(nav)`;
  - `shortcutLabel(isMac)`, which returns "⌘ K" or "Ctrl K".
- [X] T017 [P] [US3] Add `frontend/tests/unit/paletteCommands.test.ts`. It covers:
  - command order;
  - Back to start only when a workflow is shown;
  - the opposite-theme entry;
  - case-insensitive filtering that keeps order;
  - the shortcut matching Ctrl/Meta+K in either case and rejecting Alt or Shift;
  - editable detection for input, textarea, select and contentEditable;
  - Mac detection.
- [X] T018 [P] [US3] Add an optional `onBackdropClick` to `frontend/src/components/Dialog.tsx`,
  fired only when the backdrop element itself is clicked. Extend
  `frontend/tests/unit/Dialog.test.tsx`:
  - a backdrop click calls it;
  - a panel click does not;
  - when it is omitted, nothing happens (existing behaviour).
- [X] T019 [US3] Create `frontend/src/components/CommandPalette.tsx` (FR-015 to FR-017, FR-022,
  contracts):
  - `Dialog` with `testId="command-palette"` and a visually hidden heading;
  - a combobox input, autofocused, named "Filter commands";
  - a listbox "Commands" with `option`s, a `WorkflowIcon` and colour marker per workflow, and
    icons for back and theme;
  - Down and Up wrap; Enter runs; clicking runs;
  - a "No matching commands" status;
  - `onBackdropClick` closes;
  - props `{ commands, onRun, onClose, shortcutHint }`.
- [X] T020 [P] [US3] Add `frontend/tests/unit/CommandPalette.test.tsx`. It covers:
  - the input has focus and the first option is selected;
  - typing filters;
  - the empty status shows;
  - arrow wrap updates `aria-selected` and `aria-activedescendant`;
  - Enter and click call `onRun` with the command;
  - Escape and backdrop clicks call `onClose`.
- [X] T021 [US3] Wire the palette in `frontend/src/App.tsx` and
  `frontend/src/components/AppHeader.tsx` (FR-015, FR-018, FR-019; research D7, D8):
  - `paletteOpen` state;
  - one document `keydown` listener using the pure helpers. It opens only when the shortcut
    matches, the target is not editable and no `[aria-modal="true"]` element exists. It calls
    `preventDefault` when it opens, or when the palette is already open;
  - `runCommand`: a workflow calls `handleTabChange` when `started && tabsVisible`, otherwise
    `handleSelect`; back calls `handleExitToStart`; theme calls `setTheme`;
  - an `AppHeader` `onOpenCommandPalette` prop and an "Open command palette" button with the
    shortcut hint (hidden below `sm`).
- [X] T022 [US3] Add palette cases to `frontend/tests/unit/App.test.tsx`:
  - Ctrl+K opens it on the start screen with no Back to start;
  - choosing Import & Run shows its page and the tab menu;
  - Ctrl+K inside an input does not open it;
  - Ctrl+K while another dialog is open does not open it;
  - the theme entry flips `document.documentElement.dataset.theme` and stores the theme;
  - with Guided Workflow in progress (tab menu hidden), choosing Import & Run matches the card,
    and reselecting Guided resumes it;
  - the header button opens the palette.
  Update `frontend/tests/unit/AppHeader.test.tsx` for the new prop and button.

**Checkpoint**: The palette works by keyboard and pointer; existing navigation tests pass.

---

## Phase 6: User Story 4 – Find the shortcuts and what each workflow is for (Priority: P3)

**Goal**: The help (?) button opens a dialog with the shortcuts and the five workflow purposes.

**Independent test**: quickstart scenario 5; `HelpDialog.test.tsx`.

- [X] T023 [P] [US4] Create `frontend/src/components/HelpDialog.tsx` (FR-021, contracts):
  - `Dialog` with `testId="help-dialog"`, titled "Keyboard shortcuts and workflows";
  - a table named "Keyboard shortcuts" with the three rows;
  - a list of `WORKFLOWS`, each with its marker, title and description;
  - a Close button, which receives initial focus;
  - props `{ shortcutHint, onClose }`.
- [X] T024 [US4] Add the help button ("Keyboard shortcuts and help") and the `HelpDialog` open
  state to `frontend/src/components/AppHeader.tsx`. Focus returns to the button on close, through
  `Dialog`.
- [X] T025 [P] [US4] Add `frontend/tests/unit/HelpDialog.test.tsx` and extend
  `frontend/tests/unit/AppHeader.test.tsx`:
  - the dialog opens from the button and lists the shortcuts and five workflows;
  - Escape and Close close it;
  - focus returns to the help button.

**Checkpoint**: All four stories work on their own.

---

## Phase 7: Polish and cross-cutting concerns

- [X] T026 Run `npm test`, `npm run lint` and `npm run build` at the repository root, and fix any
  failure. Do not weaken configuration.
- [X] T027 [P] Update `docs/USER_MANUAL.md`: the start screen (artifact choices, workflow cards),
  the command palette, the help dialog and the theme look.
- [X] T028 [P] Update `docs/architecture.md`: the frontend shell (workflow catalog, lifted
  theme, palette and shortcut guard, the `Dialog` `onBackdropClick`), and the serif package
  removal.
- [X] T029 Raise the version to 19.20.0 in `package.json`, `backend/package.json`,
  `frontend/package.json` and `packages/shared-domain/package.json`, with `package-lock.json`
  updated through npm.
- [X] T030 Add the AP-038 row and a Next Actions entry to `specs/ROADMAP.md`, recording version
  19.20.0 and the outstanding manual walkthrough.
- [X] T031 Walk through quickstart scenarios 1 to 7 (headless-browser screenshots where
  possible), and record the results in `specs/038-workspace-redesign/validation.md`.

---

## Dependencies and execution order

- Setup (T001) comes first, then Foundational (T002–T005).
- US1 (T006–T010) and US2 (T011–T015) both depend only on Foundational; US2's T012 also needs
  T002.
- US3 (T016–T022) depends on Foundational (T005 lifted theme). T021 also edits the
  `AppHeader.tsx` that T014 restyles, so it runs after T014.
- US4 (T023–T025) depends on Foundational. T024 edits `AppHeader.tsx`, so it runs after T021.
- Polish depends on all stories.

### Parallel opportunities

- T002, T003 and T004 (different files).
- T006 and T008 alongside T011 and T013.
- T016, T017 and T018 together.
- T020 after T019.
- T023 alongside T019.
- T027 and T028 together.

## Implementation strategy

1. **MVP**: Setup, Foundational and US1. The new start screen is usable.
2. Add US2 for the product-wide look, then US3 (palette), then US4 (help).
3. Validate each checkpoint with `npm test -w frontend`. Finish with Polish (docs, version,
   walkthrough). Leave changes uncommitted for review.
