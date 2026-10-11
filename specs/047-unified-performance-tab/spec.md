# Feature Specification: Unified Performance Tab

**Feature Branch**: `047-unified-performance-tab`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Unified Performance tab: merge the Quick Performance Test and Performance Plans tabs into a single Performance tab, as a blend of a source-first entry and a guided five-step path (Source, Operations, Plan, Load, Run)." Design reference: `specs/047-unified-performance-tab/mock-unified-performance.html` (earlier explorations: `specs/037-request-chain-performance/mock-unified-performance*.html`).

## Background

Today two tabs cover one journey. *Quick Performance Test* only uploads a specification and lets the engineer pick operations, then hands over to *Performance Plans*, where the plan is edited, given a load profile and run. The hand-over is a tab hop, the two screens repeat the same introduction, and an engineer returning to adjust a plan has to know which tab holds which part.

This feature merges them into one **Performance** tab. It changes the journey, not what a plan is: saved plans, duplication, deletion, runs, reports and the read-only history of retired plans are unchanged.

## Clarifications

### Session 2026-10-11

- Q: Before a run that sends write requests, should Run keep today's banner next to Start (no extra gate) or add a new acknowledgement tick-box? → A: Keep the banner, no extra gate (FR-028).
- Q: Should starting from a guided workflow let the engineer choose which approved workflows to include? → A: No; seed all approved workflows as today (FR-008, US4).
- Q: May we add one new backend operation so an existing plan's operation selection can be merged or reset? → A: Yes, one additive operation, specification plans only (FR-015 to FR-017).
- Q: What should Reset to seed discard on an existing plan? → A: Chains and steps only; name, data sets, load profile, thresholds, environment and runs are kept (FR-017).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Go from a specification to a running load test in one path (Priority: P1)

An engineer opens Performance, picks "OpenAPI specification" as the source, and is guided through Operations, Plan, Load and Run without leaving the tab. The path shows where they are, what is done and what is next.

**Why this priority**: This is the whole reason for the merge. It removes the hand-over between two tabs and is the most common way a first plan is created.

**Independent Test**: With no plans and no uploaded specification, upload a specification, choose operations, reach Run, read the named environment and listed write steps beside Start, and start a run. Everything happens inside the Performance tab and a result is shown.

**Acceptance Scenarios**:

1. **Given** Performance is open and no specification was uploaded in this session, **When** the engineer picks "OpenAPI specification", **Then** the path opens on Source with the upload ready, and Next stays unavailable until the specification has been analysed.
2. **Given** a specification was already uploaded in this session, **When** the engineer picks "OpenAPI specification", **Then** the path opens on Operations, Source is shown as done and remains selectable, and every operation starts selected.
3. **Given** the engineer is on Operations, **When** they select at least one operation and press Next, **Then** a plan is created from the selected operations, saved, and the path moves to Plan.
4. **Given** the engineer is on Plan, **When** they rename the plan, reorder, remove or add steps and press Next, **Then** the path moves to Load with those edits kept.
5. **Given** the engineer is on Load, **When** a field is invalid, **Then** the field shows what is wrong and Next stays unavailable until it is fixed.
6. **Given** the engineer is on Run and the plan has write steps, **When** the step is shown, **Then** the target environment and every write step are named next to Start, and nothing is sent until Start is pressed. No additional confirmation is required.
7. **Given** a run finishes, **When** the result is shown, **Then** the engineer can run again, edit the load profile (returns to Load) or go back to the plans.

---

### User Story 2 - Open a saved plan and continue (Priority: P1)

An engineer returning to a plan opens it from the entry screen and lands on Plan, with the whole path available to jump to, including straight to Load or Run.

**Why this priority**: Most use after the first plan is returning use. The merged tab must not make that slower than today.

**Independent Test**: With saved plans, open one and reach Run in no more than two interactions after opening it.

**Acceptance Scenarios**:

1. **Given** saved plans exist, **When** the engineer opens one, **Then** the path opens on Plan with that plan's name, a "seeded from" indication, and every step selectable.
2. **Given** a plan is open, **When** the engineer selects Load or Run in the path, **Then** that step opens directly with the plan's current values.
3. **Given** a plan is open, **When** the engineer looks at Source, **Then** it shows the plan's source and does not allow changing it; starting a test from another source is done from the entry screen.
4. **Given** a plan is open, **When** the engineer edits its name, steps or load profile, **Then** the plan is saved and the entry screen shows the updated plan.

---

### User Story 3 - Change the selection of an existing plan without losing edits (Priority: P2)

An engineer who has hand-edited a plan realises they need two more operations. They change the selection from the Plan step (a "Change operations" panel) or by stepping back to Operations, and their edits survive.

**Why this priority**: Without a safe way to re-select, editing a plan and re-selecting would force a choice between losing work and starting over.

**Independent Test**: Reorder a step in a seeded plan, add an operation through the panel, and confirm the reorder is kept and the new step appears at the end.

**Acceptance Scenarios**:

1. **Given** a plan whose steps were edited, **When** the engineer applies a new selection (from the panel or from Operations), **Then** unselected steps are removed, newly selected ones are added at the end, and the order and edits of the remaining steps are kept.
2. **Given** a plan, **When** the engineer chooses "Reset to seed", **Then** they are asked to confirm, and on confirmation the chains and steps are rebuilt from the plan's recorded selection and the "edited" indication clears; the plan's name, data sets, load profile, thresholds, environment and saved runs are kept; on cancel nothing changes.
3. **Given** the engineer cancels the Change operations panel, **Then** the plan is unchanged.
4. **Given** a plan that was never edited, **When** the engineer applies a new selection, **Then** the steps simply follow the selection.
5. **Given** a selection that would remove an edited step, **When** the engineer applies it, **Then** a confirmation names the edited steps that would be removed; confirming removes them, cancelling leaves the plan unchanged.

---

### User Story 4 - Start from a workflow, a collection or an empty plan (Priority: P2)

The same entry screen and path serve every source. A guided workflow is seeded whole, as today, and a collection's requests are chosen with the same selection used in Import & Run; an empty plan goes straight to Plan.

**Why this priority**: These sources exist today as separate entry points; the merged tab must keep them reachable.

**Independent Test**: Start a plan from a collection and from an empty plan and reach Run from each.

**Acceptance Scenarios**:

1. **Given** the entry screen, **When** the engineer picks "Guided workflow", **Then** the path opens on Operations showing a read-only summary of the approved workflows that will be seeded (one chain each), with no selection to make, and states what must be finished first if the workflow is not ready.
1a. **Given** the entry screen, **When** the engineer picks "Postman collection", **Then** the path opens on Operations with a collection picker and the request selection and order used in Import & Run, all requests selected by default.
2. **Given** the entry screen, **When** the engineer picks "Empty plan", **Then** an empty plan is created and the path opens on Plan with Operations shown as skipped.
3. **Given** an empty plan with no steps, **When** the engineer is on Plan, **Then** Next is unavailable until a step is added.
4. **Given** another part of the product offers to create a plan from a collection or workflow (for example from Import & Run), **When** the engineer accepts, **Then** the Performance tab opens on that plan's Plan step.

---

### User Story 5 - Leave mid-way and pick up later (Priority: P2)

An engineer starting a test is interrupted. They go back to the entry screen, the start screen or another tab. Their unfinished test is kept and offered again.

**Why this priority**: Today "Back to start" keeps the quick test; the merged path must not lose work that is further along than an upload.

**Independent Test**: Start a test, leave from the Operations step, return, and resume with the selection intact.

**Acceptance Scenarios**:

1. **Given** a test with no plan yet, **When** the engineer goes back to the entry screen, **Then** the unfinished test is kept as a draft and the entry screen offers Resume and Discard.
2. **Given** a draft exists, **When** the engineer views the start screen, **Then** the Performance card shows that a draft is in progress.
3. **Given** a draft exists, **When** the engineer picks a source, **Then** they are asked before the draft is replaced; cancelling keeps the draft.
4. **Given** the engineer is anywhere in the path, **When** they use "Back to start" or switch to another tab and return, **Then** the path is where they left it.
5. **Given** a plan already exists (step 3 or later), **When** the engineer goes back to the entry screen, **Then** the plan is simply saved and no draft is created.

---

### User Story 6 - Replace the uploaded specification safely (Priority: P3)

An engineer realises the wrong specification is loaded and uploads a different one.

**Why this priority**: Needed for correctness but infrequent.

**Independent Test**: Replace the specification while plans and runs exist and confirm they remain.

**Acceptance Scenarios**:

1. **Given** a specification is loaded, **When** the engineer chooses to upload a different one, **Then** they are asked to confirm before anything is replaced.
2. **Given** the engineer confirms, **When** the new specification is analysed, **Then** the selection resets to the new specification's operations, and plans, runs and reports made from the old one are kept.
3. **Given** the engineer cancels, **Then** the current specification stays loaded.

---

### Edge Cases

- The uploaded file is not valid or is over the size limit: the existing error is shown on Source, Next stays unavailable, and the previous specification (if any) is kept.
- Everything is unselected on Operations or in the Change operations panel: Next/Apply is unavailable and the reason is shown.
- Merging would remove a step the engineer had edited: the engineer is asked first, naming the steps, and cancelling changes nothing (FR-016).
- A plan is deleted while it is open or is the subject of a draft: the path closes and the entry screen shows the plan gone, with its runs and reports kept.
- The source of an existing plan is a specification that has since been replaced: the plan keeps working from its saved steps and the "seeded from" label names the original source; Change operations is unavailable for that plan, with the reason "This plan was seeded from NAME; the uploaded specification is now NAME2", and nothing is changed.
- A run is in progress and the engineer leaves the path: the run continues and its progress or result is shown when they return to that plan's Run step.
- A source offers only credential steps or no testable operations: the empty-selection rules apply.
- Narrow screens: the path, the selection list, the plan steps and the tables remain usable without the page scrolling sideways; the Change operations panel takes the full width.
- Keyboard and screen-reader use: the current step is announced, unavailable steps are not focusable targets for activation, dialogs trap focus and close with Escape, and state is never conveyed by colour alone.

## Requirements *(mandatory)*

### Functional Requirements

**One tab and the entry screen**

- **FR-001**: The product MUST offer a single **Performance** entry in the main navigation and on the start screen, replacing the separate Quick Performance Test and Performance Plans entries.
- **FR-002**: The entry screen MUST show, together, a source picker (OpenAPI specification, Guided workflow, Postman collection, Empty plan), the saved plans, and the recent runs.
- **FR-003**: With no saved plans the entry screen MUST show the source picker with an introduction and empty states, not an empty table.
- **FR-004**: Saved plans MUST keep Open, Duplicate and Delete (with confirmation) exactly as today, including the statement that deleting a plan keeps its runs and reports.
- **FR-005**: The read-only history of runs from retired plan kinds MUST remain reachable from the Performance tab.

**The guided path**

- **FR-006**: Picking a source MUST open a path of five steps in this order: Source, Operations, Plan, Load, Run. The current step MUST be indicated visibly and to assistive technology, completed steps MUST be marked, and any step already reached MUST be selectable.
- **FR-007**: The path MUST open on Operations when the source is a specification already uploaded in this session, a workflow or a collection; on Source when a specification must still be uploaded; and on Plan for an empty plan.
- **FR-008**: The label of the Operations step MUST match the source: "Operations" (specification), "Workflows" (guided workflow, a read-only summary: approved workflows are seeded whole and cannot be individually chosen) or "Requests" (collection, using the Import & Run request selection). For an empty plan it MUST be shown as skipped and not selectable.
- **FR-009**: Next MUST be unavailable, with the reason shown, until the current step is valid: a source and (for a specification) an analysed upload on Source; at least one selected item on Operations; a non-empty name and at least one step on Plan; valid load values on Load.
- **FR-010**: Back MUST return to the previous step without discarding anything. Reaching a step by selecting it MUST also keep all state.
- **FR-011**: A plan MUST be created and saved when the engineer first moves past Operations (or immediately for an empty plan), and from then on every edit MUST be saved and shown as saved.
- **FR-012**: The header of the path MUST show the plan name (or "New performance test"), whether it is a draft or saved, and for a saved plan where it was seeded from.

**Opening and editing an existing plan**

- **FR-013**: Opening a saved plan MUST open the path on Plan with all five steps selectable.
- **FR-014**: Once a plan exists its source MUST NOT be changeable from the path; Source MUST show it read-only.
- **FR-015**: On the Plan step the engineer MUST be able to open a "Change operations" panel (offered only for plans seeded from a specification; plans seeded from a workflow, a collection or created empty show their source read-only) that lists the source's items with the plan's current selection, can be cancelled without effect, and applies the selection on confirm.
- **FR-016**: Applying a new selection to an existing plan, from the panel or by returning to Operations and pressing Next, MUST merge: remove the unselected steps, append newly selected steps at the end, and keep the order and edits of the rest. Reordering, renaming and editing MUST survive. When the merge would remove one or more steps the engineer had edited, the product MUST first list those steps and ask for confirmation (a seeded chain counts as edited when any of its steps was changed after seeding or the engineer added a step to it); cancelling MUST leave the plan and the selection exactly as they were.
- **FR-017**: The only action that discards edits MUST be "Reset to seed", offered on the Plan step when the plan has been edited, requiring confirmation that states what will be lost (step edits, reordering, added chains, and thresholds set on steps that no longer exist) and what is kept (name, data sets, load profile, run-wide thresholds, environment and saved runs), and clearing the "edited" indication when applied.
- **FR-018**: The Plan step MUST show an "edited by you" indication once the engineer has reordered, removed or added steps, and MUST state that every request is editable.

**Drafts, navigation and state**

- **FR-019**: Leaving a path that has no plan yet for the entry screen MUST keep it as a draft; the entry screen MUST offer Resume and Discard, and the start-screen card MUST show that a draft is in progress.
- **FR-020**: Picking a source while a draft exists MUST ask before replacing it, and cancelling MUST keep the draft untouched.
- **FR-021**: "Back to start" and switching to another main tab MUST keep the whole Performance state (draft, open plan, step, selection, load values, run progress) until the engineer discards it or the session ends.
- **FR-022**: Leaving a path that already has a plan MUST NOT create a draft; the plan is already saved.

**Specification handling**

- **FR-023**: The specification uploaded in this session MUST be offered for reuse whenever a specification-based test is started, shown with its file name and operation count.
- **FR-024**: Replacing the uploaded specification MUST ask first, state that plans, runs and reports made from it are kept, and on confirmation reset the selection to the new specification's operations.
- **FR-025**: Upload validation, supported formats and the size limit MUST be exactly those of the existing quick performance upload; upload errors MUST be shown on Source.

**Load and Run**

- **FR-026**: Load MUST host the plan's existing load controls unchanged: environment, the staged load profile with its starting profiles, thresholds and think time, each with its existing validation and explanatory messages.
- **FR-027**: Run MUST summarise the plan (steps, load values, environment) before it starts, and MUST NOT send any request until the engineer presses Start.
- **FR-028**: When the plan contains write steps, Run MUST name the target environment and list every write step next to Start, as the existing run launch card does. Start MUST NOT require an additional acknowledgement or confirmation (specs 032 and AP-029).
- **FR-029**: Run MUST show progress with a way to stop, and on completion a result with the threshold verdict stated in text, the key figures, and actions to run again, edit the load profile (returning to Load), open the full report, or return to the plans.
- **FR-030**: Plans, runs, reports and the data behind them MUST be unchanged by this feature; no stored plan, run or report may need migration.

**Presentation**

- **FR-031**: The tab MUST follow the product's existing visual language, theme tokens, dark mode, responsive behaviour and accessibility rules (semantic controls, visible focus, keyboard operation, state not conveyed by colour alone), and loading, empty, error and success states MUST be distinct.

### Key Entities

- **Plan**: A saved performance plan: name, source kind and label, ordered steps, an "edited" indication, a load profile, last-updated time. Unchanged by this feature.
- **Draft test**: An unfinished path with no plan yet: chosen source, current step, selection. Exists only for the session and is never listed as a plan.
- **Source**: Where a plan is seeded from: specification, guided workflow, Postman collection, or none (empty plan).
- **Selection**: The set of source items (operations, workflows or requests) a plan is built from; merged into the plan's steps when applied.
- **Load profile**: Virtual users, duration, environment and latency threshold.
- **Run / Result**: A single execution of a plan and its outcome (latency figure, error rate, request count, threshold verdict). Unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An engineer with a specification can go from opening Performance to a started run in a single tab, without switching tabs at any point (0 tab changes).
- **SC-002**: An engineer opening a saved plan reaches its Run step in no more than 2 interactions after opening it.
- **SC-003**: In 100% of selection changes applied to an existing plan, steps the engineer did not remove keep their order and edits; no edit is lost except by an explicit, confirmed "Reset to seed" or a removal the engineer confirmed after the warning in FR-016.
- **SC-004**: In 100% of cases where an unfinished test, an open plan or a run in progress exists, leaving to the start screen or another tab and returning shows it unchanged.
- **SC-005**: No request is sent to any environment before Start is pressed, and 100% of runs of plans with write steps show the target environment and the listed writes next to Start.
- **SC-006**: The main navigation and start screen each show exactly one performance-testing entry (previously two).
- **SC-007**: All existing saved plans, runs and reports remain available and unchanged after the change, with no manual migration.
- **SC-008**: Every step of the path and both dialogs and the panel can be operated with the keyboard alone, and remain usable at phone width without sideways page scrolling.
- **SC-009**: In a usability check with engineers new to the product, at least 8 of 10 can create and start their first run from a specification without help.

## Assumptions

- The one-specification-per-session behaviour of the quick performance test is kept: a single uploaded specification is held for the session and reused.
- Retiring the hand-over from Quick Performance Test is a navigation change only; the specification upload, analysis and plan-seeding behaviour behind it is reused as is, so no stored data and no existing API contract change. The only backend addition is one new operation that applies a changed operation selection to an existing specification plan (merge or reset, FR-015 to FR-017); it is additive and applies to plans seeded from a specification. This narrows the earlier rule that a plan is never re-derived from its source (spec 037 FR-026) to the operations the engineer explicitly selects.
- A Performance entry reached from elsewhere (for example "Create request-chain plan" in Import & Run) opens the unified tab directly on that plan's Plan step.
- Merging a selection keeps hand edits; the only ways edits are lost are "Reset to seed" and removing an edited step after the explicit warning in FR-016.
- The earlier labels "Quick Performance Test" and "Performance Plans" disappear from navigation and start-screen copy, and user documentation is updated to describe the single tab.
- The simulated run in the design mock illustrates states only; real run behaviour, gates and wording stay as specified for earlier performance features (031, 036, 037, 039, 040).
- Mobile phone width is supported for reading and editing; heavy plan editing is expected on larger screens.
- Existing automated tests that assume two tabs will be reshaped as part of this feature.

## Dependencies

- Builds on the plan, seeding, load and run behaviour of AP-032, AP-037, AP-039 and AP-040, and on the shared workflow colours and theme from AP-038 and AP-041.
- Needs the product's existing session-state retention for "Back to start" (AP-032 FR-025).
