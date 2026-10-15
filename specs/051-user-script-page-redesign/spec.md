# Feature Specification: Run k6 Script Page Redesign

**Feature Branch**: `051-user-script-page-redesign`

**Created**: 2026-10-15

**Status**: Implemented

**Input**: User description: "Redesign each component of the Run k6 Script page, all its buttons, tabs and so on, following the designs and colour schemes of the existing pages."

## Background

AP-034 added Run k6 Script. Its start screen already follows the other landing pages, but everything after it (the script list, the workspace for one script, its three views, the editor, the run setup, the run trigger, the run history and the confirmation dialog) is a stack of plain bordered boxes with no shared anatomy. Next to the Performance path (AP-047, restyled by AP-050) and Import & Run Collection (AP-042) it reads as unfinished: tabs are the app-wide underline tabs, action buttons are an unordered row, the load choice is two bare radio buttons, and the run trigger is a text block with one button.

This feature changes how the page and its components look and are laid out. It changes no behaviour: the upload, the check, the confirmation of exact content, the unsaved-changes questions, settings, the trigger and its blocked reasons, runs, reports and the history are exactly those of specs/034-run-user-k6-script.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One look for every panel (Priority: P1)

An engineer moving from the start screen to a script sees the same card anatomy used by the Performance Source step: an accent bar, a header with a title, a meta line and a state at the right (a dot and a word), and a body.

**Independent Test**: Open Run k6 Script, upload a script, and open each view.

**Acceptance Scenarios**:

1. **Given** a script is open, **When** any of its views is shown, **Then** each group of content (script, check, target, values, load, thresholds, trigger, run target, failure, history) is one card of that anatomy.
2. **Given** any state shown by a dot or a colour, **Then** the state is also written (Accepted, Refused, Confirmed, Needs confirmation, Ready to run, Not ready to run yet, Failed), never colour alone.

---

### User Story 2 - Views that read like the other workflows' steps (Priority: P1)

The three views of a script (Script, Run setup, Runs & reports) are a boxed navigation in the style of the stepper of Import & Run Collection and the Performance path, each with a one-line hint, instead of underline tabs.

**Acceptance Scenarios**:

1. **Given** a script is open, **When** the views are shown, **Then** the open one is marked by `aria-current="page"` and by its look, and each button keeps its existing accessible name (Script, Run setup, Runs & reports).
2. **Given** a run is in progress or runs exist, **Then** the hint of Runs & reports says so in words.
3. **Given** unsaved editor changes, **When** another view is chosen, **Then** the discard question appears as before.

---

### User Story 3 - A script document that looks like a document (Priority: P1)

The stored script and the editor are one component: a bar with the script name, its line count and "Read only" or "Editing", the editing actions at the right of the bar, the highlighted text with its line gutter, and a footer with the file actions (Rename, Replace with upload, Download, Delete). Choosing Edit changes the same view into the editable one without the layout jumping.

**Acceptance Scenarios**:

1. **Given** a stored script, **When** the Script view is shown, **Then** its text is shown highlighted with line numbers and marked "Read only"; the editor still never runs it.
2. **Given** Edit is chosen, **Then** the same document becomes editable and Save and Cancel replace Edit, with the same enabled and disabled rules as before.
3. **Given** the check refused a line, **Then** the gutter marks it with "!" and the reasons are listed by line, as before.

---

### User Story 4 - Run setup and Runs & reports that read like Performance's (Priority: P2)

Run setup is one Configuration card of marked rows (target environment, values the script receives, load, thresholds, the script), as Performance's, with the thresholds collapsed behind Edit. Runs & reports follows Performance's Run step: the launch card leads (verdict, the debug run and the run or Cancel run, the run's status line, a facts strip of target, base URL, load, script and hosts, the values the script receives, the hosts, and a note that ApiPilot cannot tell what the script writes), then the live dashboard, Last run with Run again, what the run used, the runs list and the report. The load choice is two option cards.

**Acceptance Scenarios**:

1. **Given** the script cannot run, **Then** the launch card says "Not ready to run yet" and gives the same reason as before; **Given** it can, **Then** it says "Ready to run", names the target by environment name, tier and base URL, and lists the hosts written in the script.
2. **Given** the trigger is pressed, **Then** nothing changes in what is sent (spec 034 FR-019, FR-023); nothing runs otherwise.

### Edge Cases

- A narrow window stacks the cards, the view navigation shows one column, tables scroll inside their card and the page never scrolls horizontally.
- Dark theme uses only existing theme tokens.
- A script over 256 KiB keeps highlighting off with the existing note.

## Requirements *(mandatory)*

- **FR-001**: Every group of content on the page after the start screen MUST be a card with the anatomy of User Story 1.
- **FR-002**: The three views MUST be a boxed navigation (User Story 2) that keeps `aria-current="page"` and each view's accessible name.
- **FR-003**: The stored script and the editor MUST be one component with a read-only and an editable state (User Story 3), keeping the credentials note, the line-ending note, the highlighting limit and its note, the gutter marks, and the single labelled focusable layer.
- **FR-004**: The run trigger MUST be a launch card (User Story 4) with the same blocked reasons, the same start button label and the same start call.
- **FR-005**: The load choice MUST be two option cards that remain two radio buttons with their existing labels and the existing disabled rule and reason.
- **FR-006**: The confirmation dialog MUST keep its three statements, the hosts, the exact SHA-256, Cancel focused first and the same two actions, in the dialog layout of this feature.
- **FR-007**: The refusal list, the value mapping editor and the run history MUST keep their content, accessible names and behaviour (spec 034 FR-004, FR-011, FR-025, FR-026, FR-035).
- **FR-008**: No behaviour, request, route, contract or shared-domain type MAY change; no stored data is affected. The shared Performance components (environment picker, load profile editor, threshold editor), Tabs, CodeBlock and the dialogs are not changed.
- **FR-009**: All colour MUST come from existing design tokens, usable in light and dark, with no new dependency and no new token.

## Success Criteria

- **SC-001**: Every behaviour test of specs/034 for this page passes unchanged, except where a visible label was reworded.
- **SC-002**: No horizontal page scroll at 390 px; no vertical scrollbar appears on the view navigation.

## Assumptions

- The design reference is the Performance Source step (specs/050) and the Import & Run stepper (specs/042); there is no separate mock.
- The start screen is not restyled: it already follows the landing pages.
- The environment picker, load profile editor and threshold editor are shared with the Performance path, so they keep their own look inside the new cards.
