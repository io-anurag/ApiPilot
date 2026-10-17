# Feature Specification: Sidebar Shell and Shared Visual Language

**Feature Branch**: `054-sidebar-shell-redesign`

**Created**: 2026-10-17

**Status**: Draft

**Input**: User description: "Redesign the ApiPilot application shell and visual language across every screen, based on the approved design mock (design-reference/apipilot-design.html, Lodgify-inspired): a persistent left sidebar, one single-accent palette sampled from the Lodgify Figma in light and dark, and the same patterns (stat tiles, cards, chips, steppers, tables, banners, empty states, dialogs) on every screen, with a drawer on narrow windows, left-aligned text, and a Home screen that shows only data that exists."

## Background

Today every screen sits under one top header with a tab menu, and the first screen is a start screen (AP-038). Colour answers "where am I?" with eight section hues plus four workflow hues (AP-041), and every paragraph is justified. Each workflow page has grown its own anatomy: AP-042, AP-047, AP-050 and AP-051 each restyled one page, but no two share a shell or a pattern set.

The user approved a design mock (kept beside this spec in `design-reference/`) that replaces this with a persistent left sidebar, a page header, and one set of patterns used by every screen. The palette was sampled from the Lodgify design (lime, mint, sage, olive on an off-white surface). The mock covers Home, Guided Workflow (API Review, Scenario Review), Import & Run Collection, Performance, Run k6 Script, Coverage, the help dialog, the command palette and a pattern library, each in light, dark and mobile.

A test that injected only the new colours into the running app showed the colours flow through every screen unchanged in layout, so the palette alone does not make the screens look alike. The shell and the shared patterns are what do.

This feature changes how the application looks and is navigated. It changes no behaviour of any workflow, no backend contract, no stored data and no shared-domain type.

**Supersedes**: the per-section accent colours of AP-041 (one accent replaces eight section hues and four workflow hues); the top tab menu, the "Back to start" controls and the start-screen layout of AP-038 (Home replaces the start screen). **Keeps**: every workflow rule of the specs each screen already follows.

## Clarifications

### Session 2026-10-17

- Q: Should Home include a "Recent runs" list built from the runs the screens already keep for this browser session, or leave out every history-based widget? → A: Include a "Recent runs" list from runs already held this session, with status and a link to each run's results; still no chart or trend, and no new storage.
- Q: Should each screen have its own browser address (Back, forward, refresh and bookmarks return to it), or stay as today where a refresh returns to Home? → A: Give each destination a simple address, including each viewable Guided Workflow stage, using no new routing library; in-progress state is not restored from the address.
- Q: Should input fields, selects and other control outlines be dark enough to meet the 3:1 contrast standard, or keep the mock's light outlines? → A: Darken control outlines (inputs, selects, checkboxes, secondary buttons) to at least 3:1 in both themes; card edges and dividers stay light.
- Q: What should happen to the mock's "Local-first AI" sidebar card with an "AI settings" button, when ApiPilot has no AI settings screen? → A: Remove it; the sidebar holds navigation only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navigate from one persistent sidebar (Priority: P1)

An engineer on any screen sees the same sidebar and can reach any workflow, the Coverage results and Home in one action, without a "Back to start" detour and without losing work in progress.

**Why this priority**: Navigation is the frame every other change sits in. Without it the new patterns would sit under the old header and the app would still look like several products.

**Independent Test**: Open each screen in turn from the sidebar, then return to one with unfinished work and confirm the work is still there.

**Acceptance Scenarios**:

1. **Given** any screen, **When** the engineer looks at the sidebar, **Then** it lists Home, Guided Workflow, Import & Run Collection, Performance, Run k6 Script and Coverage, and marks the current one in words and by appearance.
2. **Given** the Guided Workflow is open, **When** the sidebar is read, **Then** its eleven stages are listed under Prepare, Design, Organize and Execute, and each is shown as done, current, or locked in words or an icon with a text label, not by colour alone.
3. **Given** a stage is locked, **When** the engineer tries to open it, **Then** it does not open and the reason it is locked is available as text; **Given** a stage is done, **Then** it can be viewed as it can today.
4. **Given** a Guided Workflow, an Import & Run selection, a Performance draft or a script with unsaved edits, **When** the engineer opens another destination and comes back, **Then** the work is exactly as left, as "Back to start" preserved it before.
5. **Given** any screen, **When** the page header is read, **Then** it names the screen and its parent (for example "Guided Workflow › Design" over "Review Generated Scenarios").
6. **Given** the engineer has visited several destinations, **When** they use the browser's Back and Forward buttons, **Then** the app moves between those destinations in the order visited; **When** they refresh, **Then** the same destination opens; **When** they open a bookmarked address, **Then** that destination opens.
7. **Given** an address whose destination cannot be shown (a locked stage, or a stage with no workflow behind it), **When** it is opened, **Then** the nearest valid destination opens with a text explanation, never a blank page or an error.

---

### User Story 2 - One colour language in light and dark (Priority: P1)

An engineer sees one accent (lime) for the current location, primary actions and selection, mint and sage tints for surfaces and series, and a deeper olive wherever lime would be too pale for text or thin lines. Success, warning and failure keep their own colours and always carry an icon and a word. HTTP methods keep their saturated identity colours. A dark theme derived from the same palette is available and remembered.

**Why this priority**: Colour is what the user first called out, and it must be settled in both themes before the patterns are built on it.

**Independent Test**: Open every in-scope screen in both themes and run the colour checks of SC-003 and SC-007.

**Acceptance Scenarios**:

1. **Given** any screen in either theme, **When** it is read, **Then** every text and background pair meets 4.5:1, and the outline of every input, select, checkbox and secondary button and every meaningful graphic meets 3:1; card edges and dividers that only decorate may stay lighter.
2. **Given** a primary action, **Then** it is lime with dark text in both themes; no control puts white text on lime.
3. **Given** a state (completed, in progress, failed, locked, selected), **Then** it is also written as text or marked with an icon.
4. **Given** the screens that used a blue "info" colour or a per-section accent, **Then** none shows a blue or section-coloured accent, except HTTP method badges and the Postman, k6 and OpenAPI logos.
5. **Given** the engineer chose a theme, **When** the app is reopened, **Then** the same theme is shown; with no choice, the operating system's preference applies, as today.

---

### User Story 3 - The same patterns on every screen (Priority: P1)

Every in-scope screen is built from one pattern set: stat tiles (with one mint highlight), white widget cards, pill chips, task cards, steppers, tables with tinted headers and a pager, warning banners, empty states, drop zones and dialogs. The three workflow steppers keep their steps: Import & Run (Collection, Review requests, Run, Results), Performance (Source, Operations, Plan, Load, Run) and Run k6 Script (k6 Script, Check, Confirm, Run); the Guided Workflow shows its four groups with stage chips.

**Why this priority**: The user asked for "similar patterns everywhere". This is the visible change.

**Independent Test**: Walk the screen list of FR-013 in both themes and compare each against the pattern library in the design reference.

**Acceptance Scenarios**:

1. **Given** any in-scope screen, **When** it is compared with the pattern library, **Then** each group of content uses one of the library's patterns and no screen introduces a pattern that is not in the library.
2. **Given** any in-scope screen, **Then** every control, label, field, validation message, blocked reason and error that existed before still exists with the same accessible name and the same behaviour.
3. **Given** a table of reviewable items, **Then** its bulk actions, filters and paging that existed before (Scenario Review, API Review, Coverage gaps) are still present and work as before.

---

### User Story 4 - Use it on a narrow window (Priority: P2)

On a narrow window (a phone) the sidebar becomes a drawer opened from a menu button; the header controls fit on one tidy row; grids collapse; tables scroll inside their card; and the page never scrolls sideways.

**Why this priority**: Responsive behaviour already exists and must not regress; the drawer is new, so it needs its own story.

**Independent Test**: Open every in-scope screen at 390 px and 320 px wide, and open and close the drawer with touch, keyboard and the Escape key.

**Acceptance Scenarios**:

1. **Given** a window narrower than the shell's breakpoint, **Then** the sidebar is hidden, a menu button opens it as a drawer over a dimmed page, and choosing a destination closes it.
2. **Given** the drawer is open, **When** the engineer presses Escape or chooses the dimmed area, **Then** it closes and focus returns to the menu button; while it is open, focus stays inside it.
3. **Given** a narrow window, **Then** the application name is not truncated and no header control is clipped.

---

### User Story 5 - A Home that shows only what is real (Priority: P2)

Home replaces the start screen. It offers the four workflows as launch tiles (keeping the Recommended and Draft-in-progress cues and the artifact entry points), and shows summary tiles, coverage by area, next steps, a list of recent runs and AI provider status, but only where ApiPilot already holds the data. A tile or widget with no data says why, as text, and shows no number.

**Why this priority**: It is the first impression the mock changed most, but it carries the highest risk of inventing data, so it follows the shell and patterns.

**Independent Test**: Open Home with no specification, then after the guided workflow has produced scenarios, and compare each figure with the Coverage screen.

**Acceptance Scenarios**:

1. **Given** no specification is loaded, **When** Home is opened, **Then** the launch tiles work, no coverage figure is shown, and the coverage tile says what is needed (a specification from the Guided Workflow).
2. **Given** a specification and scenarios exist, **When** Home is opened, **Then** each coverage figure equals the same figure on the Coverage screen.
3. **Given** runs exist in this session in Import & Run, Performance or Run k6 Script, **When** Home is opened, **Then** a "Recent runs" list shows each run's workflow, what was run, when it started and its status in words, newest first, and each entry opens that run's results; **Given** no run exists, **Then** the list says so in words.
4. **Given** a widget needs history or data the application does not keep (coverage over runs, a pass-rate trend, any chart over time), **Then** it is not shown; no placeholder number appears anywhere.
5. **Given** an unfinished Performance test or an unfinished Guided Workflow, **Then** Home says so in words on that workflow's tile and in next steps.
6. **Given** the connection to the backend fails, **Then** Home still renders and the connection status says Disconnected in words.

---

### User Story 6 - Dialogs, palette and reading text (Priority: P3)

The help dialog and the command palette use the same card style as the pages. Ctrl+K (⌘ K on macOS) still opens the palette, and its commands (open a workflow, open Coverage, go to Home, switch theme) behave as before. Paragraph text is left-aligned everywhere.

**Why this priority**: Small in effort, visible at the edges, and low risk.

**Independent Test**: Open the help dialog and the palette in both themes with the keyboard only, and read a long paragraph on a narrow window.

**Acceptance Scenarios**:

1. **Given** a dialog is open, **Then** focus is inside it, Escape closes it, and focus returns to what opened it.
2. **Given** the palette, **When** "Go to Home" is chosen, **Then** it does what "Back to start" did.
3. **Given** any paragraph, **Then** it is left-aligned and not justified.

### Edge Cases

- A Guided Workflow is in progress and the engineer opens another workflow, then returns: the workflow resumes at its current stage; nothing is discarded or restarted.
- A bookmarked or shared address names a stage the viewer cannot open (locked, or another session's workflow): the nearest valid destination opens with a text explanation, and the address never reveals what the stage contained.
- The session expires or the workflow was discarded elsewhere: the sidebar shows no done stages and the Guided Workflow opens at Upload, as the app does today.
- No specification is loaded: Coverage stays reachable and says what it needs, as today; the stage list shows only Upload as available.
- A long stage or document name: it wraps or is shortened with the full text available, and never pushes the sidebar or header out of place.
- Browser zoom of 200% and a 320 px window: the drawer layout applies and no content is cut off.
- A person who prefers reduced motion: the drawer and any transition work without animation, and nothing depends on animation.
- A keyboard-only person: every sidebar item, drawer control and dialog is reachable in a sensible order with a visible focus mark.
- High-contrast or forced-colours mode: the current location and every state remain distinguishable.
- The backend is unreachable: the shell, sidebar and the last-shown data still render, and the status says Disconnected.
- Backend-rendered reports (the performance report, the run report in HTML and PDF) are standalone documents opened outside the shell; they are not restyled by this feature and are checked only to confirm they are not broken by it.

## Requirements *(mandatory)*

### Functional Requirements

**Shell and navigation**

- **FR-001**: Every screen MUST be shown inside one shell: a persistent sidebar and a page header. The top tab menu, the start screen as a separate mode and every "Back to start" control MUST be removed, replaced by Home.
- **FR-002**: The sidebar MUST list Home, Guided Workflow (expandable), Import & Run Collection (named as the workflow is titled everywhere else), Performance, Run k6 Script and Coverage, mark the current destination in words and by appearance, expose it to assistive technology as the current page, and be reachable by keyboard. Apart from the brand, logo and version at its top, it MUST hold navigation only: no promotional or informational card and no control that leads to a screen that does not exist.
- **FR-003**: Under Guided Workflow the sidebar MUST list the eleven stages grouped as Prepare, Design, Organize and Execute, each shown as done, current or locked with a text label or icon, the current stage's group expanded. A done stage MUST be viewable as today; a locked stage MUST NOT open and MUST state why.
- **FR-004**: The page header MUST show the screen title with its parent as a breadcrumb, the command-palette control with its shortcut, the connection status, the theme control and the help control. The connection status MUST keep its existing test identifier and the three states Connecting, Connected and Disconnected, each in words.
- **FR-005**: Moving between destinations MUST NOT discard or reset any work in progress. Everything "Back to start" preserved (Guided Workflow progress, Import & Run selection, Performance draft and open plan, script drafts and editor changes, Coverage filters) MUST be preserved by every route out of and back to a screen, and the existing unsaved-changes questions MUST still appear where they appear today.

- **FR-029**: Every destination (Home, each workflow, Coverage and each Guided Workflow stage that can be viewed) MUST have its own browser address, so that opening an address shows that destination, a refresh keeps it, a bookmark returns to it, and the browser's Back and Forward buttons move between the destinations visited, in order. This MUST be built with no new runtime dependency. An address MUST carry only a destination identifier: never specification content, file or collection names, script text, values, credentials or tokens. An address for a destination that cannot be shown (a locked stage, or one with no workflow behind it) MUST open the nearest valid destination with a text explanation. Addresses restore the destination only; in-progress state that the application keeps in the open page is not restored from an address, and what the server already holds for the session resumes as it does today. The address must not disturb the access token that protected network access relies on (AP-049) or the existing preview address used for the Performance mock.

**Colour and themes**

- **FR-006**: The application MUST use one accent for location, selection, primary actions and focus. The eight section accents and four workflow identity colours MUST be retired; where they conveyed location or workflow identity, text, icons and the sidebar state MUST convey it instead.
- **FR-007**: The palette MUST be: lime `#E7F68F` (primary actions, current item, with dark text), lime-pale `#F3FCC7`, mint `#D5F6E5`, sage `#BDD9CA`, olive `#CCD97F`, an off-white `#F8F8F8` application surface with white cards, and a deeper olive (text `#5B7314`, lines `#6F8A1F`) wherever the tints are too pale for text or thin lines. Exact values may be tuned only to meet FR-009.
- **FR-008**: A dark theme derived from the same palette MUST be provided, chosen by the engineer, remembered, and defaulting to the operating system's preference, as today. Both themes MUST be defined in one place.
- **FR-009**: Every text and background pairing MUST meet 4.5:1, in both themes. The outline of every input, select, checkbox and secondary button, every focus mark and every meaningful graphic MUST meet 3:1 against the surface it sits on, in both themes; this makes control outlines darker than the design reference shows, which is a deliberate change. Card edges and dividers that only decorate are exempt and stay light. No control MAY put white text on lime or another pale tint.
- **FR-010**: Success, warning and failure colours MUST stay independent of the accent, and every state shown by colour MUST also be written as text or an icon with an accessible name. A blue "info" colour MUST NOT remain as an accent. HTTP method badges MUST keep their saturated identity colours with their labels. The Postman, k6 and OpenAPI logo colours stay as their owners define them.
- **FR-011**: Focus marks MUST stay visible on every interactive element in both themes, and reduced-motion preferences MUST be honoured, with no function depending on animation.
- **FR-012**: Paragraph text MUST be left-aligned application-wide; the global justified-text rule is removed. Code, paths and identifiers keep their monospace presentation and are never hyphenated.

**Shared patterns and screens**

- **FR-013**: The following MUST be rebuilt from the shared pattern set, in both themes and on a narrow window: Home; the Guided Workflow's progress tracker and its stages (this feature restyles API Review and Scenario Review to the library, and every other stage inherits the shell and colours); Import & Run Collection; Performance; Run k6 Script; API Test Coverage; the help dialog and the command palette. Guided stages 6 to 11 (Dependency Analysis through Performance Testing) adopt the shell and colours here, and their content adopts the patterns in a follow-up specification once they have been mocked.
- **FR-014**: The pattern set MUST be documented with an example of each: stat tile (with a highlight variant), widget card, pill chip, task card, stepper (with done, current and locked states), table with header tint and pager, warning banner, empty state, drop zone, key-value block, buttons (primary, secondary, disabled), form fields, status chips, method badges and dialogs. A screen MUST NOT introduce a pattern that is not in the set without adding it to the set.
- **FR-015**: Every control, label, field, validation message, blocked reason, bulk action, filter, pager and error that exists on an in-scope screen MUST remain, with the same accessible name and behaviour. Where a visible label is deliberately reworded, the change MUST be listed in this feature's tasks. The start-screen controls MUST keep their accessible names (a workflow's title as the whole name, and "…, for an OpenAPI specification" style names on artifact controls).
- **FR-016**: Steppers MUST keep their steps, hints and lock reasons: Import & Run (Collection, Review requests, Run, Results), Performance (Source, Operations, Plan, Load, Run) and Run k6 Script (k6 Script, Check, Confirm, Run), and MUST show done, current and locked in words or icons, never colour alone.
- **FR-017**: Large code, JSON and YAML blocks and wide tables MUST scroll horizontally inside their own card, never the page, and every table MUST keep semantic headers.

**Home**

- **FR-018**: Home MUST show the four workflows as launch tiles, keeping the Recommended cue and the Draft-in-progress cue of Performance, and the three artifact entry points (OpenAPI specification, Postman collection, k6 script), each leading to the workflows that accept it.
- **FR-019**: Every figure on Home MUST come from data the application already holds (the specification and scenarios of the current session, the coverage calculation, workflow and performance draft state, the runs each workflow already holds for the session, the backend health check and the AI provider's readiness, where it is exposed to the interface). A figure with no data MUST be omitted or replaced by a text reason; no figure MAY be invented, estimated or left as a placeholder number.
- **FR-020**: Home MUST list recent runs: the runs that Import & Run, Performance and Run k6 Script already hold for the current session, newest first, each with its workflow, what was run, when it started, its status in words and a link to its results. The list MUST NOT add storage, MUST NOT include a run the session does not hold, and MUST say in words when there are none. Home MUST NOT show coverage over runs, a pass-rate trend or any chart over time in this feature, because the application records no per-run coverage or history across sessions; each is deferred to a later specification that defines its data source and privacy treatment.
- **FR-021**: Home's "next steps" MUST be derived from existing state only (for example scenarios awaiting review, operations with no generated test, a Performance draft), each leading to the screen where it is done, and MUST be empty with a text explanation when nothing is pending.

**Narrow windows and dialogs**

- **FR-022**: Below the shell's narrow breakpoint the sidebar MUST become a drawer opened by a menu button with an accessible name, closing on a destination choice, the Escape key or a choice of the dimmed area, keeping focus inside while open and returning it to the menu button on close.
- **FR-023**: On a 390 px window and a 320 px window, no in-scope screen MAY scroll the page sideways; grids MUST collapse to one or two columns; header controls MUST fit without clipping the application name.
- **FR-024**: Dialogs MUST use the card style of the pages, trap focus while open, close on Escape and return focus to the control that opened them. The command palette MUST keep its shortcut, its commands and its behaviour, with "Go to Home" replacing "Back to start".

**Scope guards**

- **FR-025**: No backend endpoint, response shape, stored data, shared-domain type, workflow rule, security rule or test-generation behaviour MAY change. No data MAY leave the machine because of this feature.
- **FR-026**: Backend-rendered standalone reports (the performance report and the run report in HTML and PDF) MUST NOT change in this feature; they MUST be opened once in each theme setting and confirmed unbroken.
- **FR-027**: The change MUST add no runtime dependency that was not already in the application.
- **FR-028**: Existing automated tests that assert behaviour MUST pass unchanged; tests that assert retired visuals (the tab menu, the start screen layout, section accents) MUST be replaced with tests of the new shell and tokens, and each such replacement MUST be recorded in this feature's tasks.

### Key Entities *(include if feature involves data)*

- **Destination**: a place the sidebar leads to (Home, a workflow, Coverage, or a Guided Workflow stage), with a label, a parent, and a state (current, done, available, locked with a reason).
- **Palette**: the named set of colours and their light and dark values, with the pairings that must meet the contrast rules.
- **Pattern**: a named reusable presentation (stat tile, card, chip, stepper and the others of FR-014) with its states and an example in the pattern library.
- **Home figure**: a number or status shown on Home, always tied to an existing source or omitted with a text reason.
- **Recent run**: one run already held by the session in Import & Run, Performance or Run k6 Script, shown on Home with its workflow, subject, start time, status and a link to its results. It is a view of existing records, not a new record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the screens named in FR-013 render inside the shell in light, dark and at 390 px, confirmed by a screenshot review of every screen in each of those three conditions.
- **SC-002**: From any screen, any workflow, Coverage and Home are reachable in one action on a wide window and two on a narrow one (menu, then destination).
- **SC-003**: A contrast check of every text and background pairing and every control boundary in both themes finds zero pairings below 4.5:1 (text) or 3:1 (the outline of every input, select, checkbox and secondary button, focus marks and meaningful graphics), with the results recorded.
- **SC-004**: At 320, 390, 768, 1280 and 1920 px wide, no in-scope screen scrolls the page horizontally.
- **SC-005**: Every existing behaviour test passes unchanged, and every test replaced under FR-028 is listed with its reason; zero behaviours are lost.
- **SC-006**: Every figure on Home matches its source: where Coverage shows the same figure, they are equal in 100% of the cases checked, and with no specification loaded Home shows zero numbers for coverage. Every entry in Recent runs matches a run on its own workflow's screen, and no entry appears for a run that screen does not list.
- **SC-007**: An audit of every in-scope screen finds zero states shown by colour alone; each has text or an icon with an accessible name.
- **SC-008**: On every screen, the page header and the sidebar both name the current location.
- **SC-009**: A keyboard-only walk-through can open the drawer, the help dialog and the palette, reach every sidebar item and close each with Escape, with focus visible and returned correctly each time.
- **SC-010**: No blue accent, per-section accent or justified paragraph remains on any in-scope screen, apart from HTTP method badges and the third-party logos.
- **SC-011**: Opening the address of each destination directly shows that destination in 100% of cases checked; Back and Forward return to the previous and next destinations visited; and an address that cannot be shown never produces a blank page or an error.

## Assumptions

- The approved design mock in `design-reference/` is the visual reference for layout and pattern anatomy. It uses sample data; none of its numbers are requirements. Where it conflicts with this specification, the specification wins: its pale control outlines are superseded by FR-009, its "Recent sessions" table by the "Recent runs" list of FR-020, its coverage-over-runs chart by FR-020's exclusion, and its sidebar footer "Local-first AI" card is removed by FR-002.
- Home's coverage-over-runs chart and pass-rate trend are deferred (FR-020) because the application records no per-run coverage and keeps no history across sessions. Adding either would need its own specification covering data source and privacy. The mock's "Recent sessions" table becomes "Recent runs" (clarified 2026-10-17), built only from the runs each workflow already holds for the session.
- The operations-by-method breakdown may appear on Home only when a specification is loaded in the session, using the operation counts of that specification; otherwise it is omitted with a reason.
- The AI provider status tile appears only if its state can be read from what the interface already receives; otherwise it is omitted, and adding a new endpoint is out of scope.
- Guided stages 6 to 11 and the deeper steps of Performance, Import & Run and Run k6 Script (after the first screen) inherit the shell and colours now, and adopt the patterns in a follow-up specification after they are mocked.
- A single accent means "where am I?" is answered by the sidebar, the breadcrumb and the steppers' text, which the earlier colour hues also did redundantly.
- The dark theme is derived from the light palette and still needs the user's review of the mock before sign-off.
- Standalone reports keep their own styles (as AP-041 already recorded) and are verified, not restyled.
- The brand name, logo and version badge stay as they are, now at the top of the sidebar.
- Destination addresses are a navigation aid only (clarified 2026-10-17). They do not persist work: a refresh restores the screen, and the data the server holds for the session resumes as it does today, but unsaved edits and selections kept only in the open page are lost on refresh, as they are today.
- The Run & Results, live-run dashboard, request-chain editor and other deep components keep their existing internal layout until their own follow-up; they inherit colours and card styling only.
