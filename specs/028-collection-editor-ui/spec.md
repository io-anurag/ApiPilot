# Feature Specification: Postman-Style Collection & Variable Editor

**Feature Branch**: `028-collection-editor-ui`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "User doesn't have flexibility to edit the collection & provide
values to all variables. I want to implement postman like UI so that user sees what is
happening" — before starting a run, a user should be able to browse a loaded collection's
folders/requests, see exactly what will be sent (including unresolved `{{variable}}`
placeholders), and supply or override every variable value with a live resolved-request
preview, the way Postman's collection/environment editor works.

## Clarifications

### Session 2026-09-21

- Q: Should this view allow direct in-place editing of a request's method/URL/headers/body, or
  is it read-only for request structure and limited to variable value entry only? → A: Full
  editing — method, URL, headers, and body are directly editable, not just variable values.
- Q: Should this capability apply to uploaded external collections only, ApiPilot-generated
  collections only, or both? → A: Both. This extends past specs/018-test-execution-results'
  original boundary ("AP-017 executes only the approved, generated Postman artifact and
  explicitly does not change how that artifact is generated"). The conflict is resolved by
  scoping edits as an *override layer* applied after generation, not a change to generation
  itself: the original `TestScenario`/`GeneratedRequest` and its deterministic provenance are
  never mutated in place (FR-009a), and any edited request that is actually run is visibly
  distinguished in that run's own record from what was originally generated (FR-011). specs/018's
  generation pipeline itself is unaffected — only what happens between "generated" and "executed"
  changes.
- Q: Does an override (variable value or request edit) get saved for future runs, stay a
  session-only draft, or apply once without altering stored data? → A: Persisted for reuse across
  runs — variable overrides are saved into the selected environment's stored values
  (`Environment.variableValues`), and request edits are saved as a persistent override layered on
  the request's original definition (FR-009a), not a one-time or session-only application.

### Session 2026-09-21 (clarify pass)

- Q: Beyond editing an existing request's method/URL/headers/body, should this feature let users
  add, delete, reorder, or rename requests and folders in the collection? → A: Full structural
  editing — add, delete, reorder, and rename requests and folders, in addition to field edits
  (FR-013 through FR-016).
- Q: Should a user be able to edit, add, delete, reorder, or rename a collection's requests/
  folders while a run of that same collection is currently in progress? → A: No — block all edits
  (field, structural, and variable) while any run of that collection is in progress; the view is
  read-only until that run finishes (FR-017).
- Q: Should the variable panel let a user define a brand-new variable the collection doesn't
  currently reference anywhere, or only show/edit variables it already references? → A: Also
  allow defining new, currently-unreferenced variables (e.g., for a request the user plans to add
  later), stored alongside the referenced ones (FR-018).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse the Collection Before Running (Priority: P1)

As a QA engineer, before I run a loaded collection I want to see its full structure — every
folder and request, in the collection's own order — and, for any request I select, its method,
full URL, headers, and body exactly as authored, with every `{{variable}}` placeholder visibly
marked rather than silently resolved, so I understand precisely what is about to be sent.

**Why this priority**: This is the foundational "see what is happening" requirement. Without a
browsable, inspectable view of the collection, none of the other stories have anything to build
on.

**Independent Test**: Load a collection with nested folders and requests that reference
variables; open the new view; verify every folder/request appears in the collection's own order
and selecting a request shows its method/URL/headers/body with placeholders visibly distinct from
literal text.

**Acceptance Scenarios**:

1. **Given** a loaded collection with folders and requests, **When** the user opens the
   collection view, **Then** a navigable tree reproduces the collection's own folder/request
   order, matching how it would appear in Postman.
2. **Given** a request whose URL, headers, or body contain `{{variable}}` placeholders, **When**
   the user selects that request, **Then** the placeholders are shown visibly distinct from
   resolved literal values (not silently substituted without indication).

---

### User Story 2 - Supply and Override Variable Values With Live Preview (Priority: P1)

As a QA engineer, I want a single place to see every variable the loaded collection references,
enter or override its value, and immediately see the fully resolved request (URL, headers, body)
update to reflect that value, so I can confirm every request will be correct before I run
anything.

**Why this priority**: This is the explicit second half of the request — "provide values to all
variables" — and is what turns the read-only browser from Story 1 into something a user can act
on.

**Independent Test**: Load a collection referencing several variables, none yet fully resolved;
enter a value for each; verify the request preview for any request using those variables updates
live, and that attempting to start a run while any required variable remains unset is blocked
with the specific missing variable(s) named.

**Acceptance Scenarios**:

1. **Given** a loaded collection, **When** the user opens the variable panel, **Then** every
   variable referenced anywhere in the collection is listed with its current value (if any) and
   whether it is currently resolved or missing.
2. **Given** a variable currently unresolved, **When** the user enters a value for it, **Then**
   every visible request preview referencing that variable updates immediately to show the
   substituted value, without a page reload or a run.
3. **Given** one or more variables a request depends on remain unresolved, **When** the user
   attempts to start a run, **Then** the run starts; the unresolved variables stay marked missing
   (the Variables toggle's red dot, each request's "Unresolved" list) and an affected request
   records its own outcome. *(Superseded: originally blocked the run — see FR-006.)*

---

### User Story 3 - Know Where Each Variable's Value Came From (Priority: P3)

As a QA engineer, when a variable is already resolved, I want to see whether its value came from
the collection's own defaults, the selected environment, or my own override entered in this view,
so I can tell apart an intentional override from a value I forgot I changed.

**Why this priority**: Improves trust and auditability once Stories 1-2 already deliver the core
workflow; not required for a first usable version.

**Independent Test**: Load a collection whose variable is defined at both collection and
environment scope; verify the variable panel shows which source is currently winning, then
override it and verify the source label updates to reflect the user's own entry.

**Acceptance Scenarios**:

1. **Given** a variable defined at more than one scope, **When** the user views it in the
   variable panel, **Then** the panel shows which scope's value is currently in effect.
2. **Given** the user overrides a variable's value in this view, **When** they view it again,
   **Then** the source label reflects that it is now a user override.

---

### User Story 4 - Edit and Restructure a Collection Before Running (Priority: P2)

As a QA engineer, I want to directly change a request's method, URL, headers, or body in this
view — not just its variables — so I can correct or adapt a request without leaving ApiPilot,
whether it came from an uploaded collection or from ApiPilot's own generated test suite. I also
want to add a new request, delete or rename an existing request or folder, and reorder items
within the collection, so I can shape the collection to match what I actually need to test.

**Why this priority**: Directly required by the original ask ("flexibility to edit the
collection"), confirmed in scope by clarification to include structural changes, not only field
edits. Placed after Stories 1-2 because browsing and variable resolution are prerequisites to
knowing what needs editing.

**Independent Test**: Select a request in a loaded collection, edit its URL and a header value,
and verify the preview reflects the edit; run it and verify the run record shows the edited
request, not the original. Separately, add a new request, delete an existing one, and reorder two
items; verify the collection view reflects all three changes immediately.

**Acceptance Scenarios**:

1. **Given** a selected request, **When** the user edits its method, URL, headers, or body,
   **Then** the change is reflected immediately in the request preview.
2. **Given** the edited request belongs to an ApiPilot-generated collection, **When** the edit is
   saved, **Then** the original generated `TestScenario`/`GeneratedRequest` and its provenance
   remain unchanged and inspectable — the edit is stored as an override layered on top, never an
   in-place mutation of the generated artifact.
3. **Given** an edited request is later run, **When** the user views that run's results, **Then**
   the actually-sent (edited) request is shown, visibly distinguished from the collection's
   original definition.
4. **Given** a folder in the collection, **When** the user adds a new request to it, **Then** the
   new request appears in the tree with the method/URL/headers/body the user specified.
5. **Given** an existing request or folder, **When** the user deletes it, **Then** it no longer
   appears in the collection tree, and deleting a folder also removes every request nested within
   it.
6. **Given** an existing request or folder, **When** the user renames it, **Then** the new name
   is reflected everywhere the collection is displayed.
7. **Given** two requests or folders within the same containing folder, **When** the user
   reorders them, **Then** the collection's own stored order changes to match, and that new order
   is what any subsequent run and view both reflect.

---

### Edge Cases

- What happens when a variable is referenced by the collection but has no value at any scope? It
  is shown as missing/unresolved, distinctly from a resolved variable, consistent with the
  existing missing-variable reporting behavior.
- What happens when the same variable name is defined at more than one scope (e.g. collection
  default and environment)? The panel shows which one currently wins, using the platform's
  existing precedence rules rather than a newly invented one (Story 3).
- What happens with deeply nested folders (three or more levels)? The tree remains fully
  navigable and collapsible without truncating any folder or request.
- What happens when more than one uploaded collection/environment pair exists in the session
  (specs/026 allows multiple)? The collection view and variable panel scope to whichever pair is
  currently selected; switching the selection switches the view.
- What happens when a request body is not JSON (e.g. form-data, raw text, or binary Postman body
  modes)? The preview and editor render and accept each supported body mode faithfully rather
  than corrupting or reinterpreting it as JSON.
- What happens if the user navigates away or closes the view without starting a run? No request
  is ever dispatched merely from browsing, previewing, or editing.
- What happens when a user edits a request that was deterministically generated from an OpenAPI
  operation? The edit is layered as an override; the original generated request/scenario and its
  provenance remain unchanged and inspectable (Story 4, Scenario 2), and any resulting run
  distinguishes the actually-sent request from the originally generated one (FR-011).
- What happens when the user edits a request, then the underlying collection is regenerated (for
  an ApiPilot-generated collection) or re-uploaded (for an external one)? The override is
  associated with the specific request it was made against; if that request no longer exists in
  the new version, the override is discarded rather than silently reapplied to an unrelated
  request.
- What happens to past run history that already recorded results for a request the user later
  renames or deletes? The run's own record keeps whatever it captured at the time it ran (name,
  method, results) — unaffected by a later rename or deletion, consistent with how a run record
  already survives its source being edited or removed elsewhere in the platform.
- What happens if the user deletes every request in the collection (or in a folder), leaving it
  empty? The collection is allowed to become empty; attempting to start a run against a
  collection with zero requests is refused the same way an uploaded, already-empty collection is
  refused today.
- What happens when the user adds a new request? It behaves exactly like any pre-existing one —
  no special-casing for method, variable references, or eligibility for editing/deletion/reorder.
- What happens if the user attempts any edit while a run of that collection is currently in
  progress? The system refuses the edit and indicates the view is read-only until the run
  finishes (FR-017) — it does not queue the edit for after the run, and does not silently drop it
  without telling the user.
- What happens to a user-defined variable (FR-018) that no request currently references? It is
  retained and shown in the variable panel, but never counted as missing/blocking a run (FR-006
  only evaluates variables an actual request references); if the user later adds a request that
  references it, it resolves normally using the value already defined.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display, for any collection loaded for execution, a navigable tree
  of its folders and requests, in the collection's own order, before any request in it is
  executed.
- **FR-002**: For a selected request, the system MUST display its method, full URL, headers, and
  body with every `{{variable}}` placeholder visibly distinguished from resolved literal text.
- **FR-003**: The system MUST list every variable referenced anywhere in the loaded collection,
  showing its current value, its source (collection default, environment value, or user
  override), and whether it is currently resolved or missing.
- **FR-004**: The system MUST let the user set or override the value of any collection- or
  environment-scoped variable from this view.
- **FR-005**: When the user sets or changes a variable's value, the system MUST immediately
  update every visible request preview that references that variable to show the substituted
  value, without requiring a page reload or a run.
- **FR-006**: The system MUST keep every unresolved variable visibly marked missing, and MUST NOT
  block starting a run because of one. *(Superseded: originally "MUST block starting a run while
  any variable a target request depends on remains unresolved". Changed so a value captured by an
  earlier request's test script (`pm.environment.set`) can feed a later request in the same run;
  specs/026 FR-004 changed with it.)*
- **FR-007**: The system MUST allow the user to directly edit a selected request's method, URL,
  headers, and body content, in addition to setting variable values.
- **FR-008**: This capability MUST be available for both uploaded external collections
  (specs/026-external-collection-execution) and ApiPilot-generated collections handed off to
  execution (specs/018-test-execution-results, specs/016-workflow-aware-postman). **Known gap,
  found 2026-09-21 while updating this documentation**: only the uploaded-external-collection half
  is actually wired up — `CollectionTreeView`/`RequestEditorPanel`/`VariablePanel` are mounted
  exclusively in `ExternalCollectionsPage.tsx`, with no equivalent surface in the guided-workflow/
  generated-collection page. Every other FR in this spec (FR-001 through FR-018) is implemented and
  tested, but only against `UploadedCollectionSet`. Extending this view to ApiPilot-generated
  collections is unimplemented, tracked as follow-up work rather than closed.
- **FR-009**: A variable override made in this view MUST be persisted into the selected
  environment's stored values (`Environment.variableValues`), consistent with how
  `EnvironmentForm` already persists variable edits, so it is available and reused across
  subsequent runs rather than discarded when the view closes.
- **FR-009a**: A direct request edit (FR-007) MUST be persisted as an override layered on top of
  the request's original definition, not an in-place mutation of it: for an uploaded collection,
  the override applies to that collection's own stored definition; for an ApiPilot-generated
  request, the override is stored separately from, and MUST NOT alter, the original generated
  `TestScenario`/`GeneratedRequest` or its provenance (constitution: deterministic generation,
  explainable provenance). The override persists for reuse across subsequent runs of that same
  request, mirroring FR-009's persistence for variable overrides.
- **FR-010**: The system MUST NOT dispatch any request as a result of navigating, previewing, or
  editing in this view — starting a run remains a separate, explicit user action.
- **FR-011**: Any request or variable value that was overridden in this view and is subsequently
  run MUST be visibly reflected in that run's own record/results, so a user can tell what was
  actually sent rather than what the collection originally defined.
- **FR-012**: If a request an override was made against no longer exists in a later version of
  the collection (regenerated or re-uploaded), the system MUST discard that override rather than
  silently reapplying it to a different, unrelated request.
- **FR-013**: The system MUST allow the user to add a new request, with a user-specified method,
  URL, headers, and body, to a chosen folder or to the collection's root.
- **FR-014**: The system MUST allow the user to delete an existing request or folder from the
  collection. Deleting a folder MUST delete every request nested within it. Deleting a request or
  folder MUST NOT alter any run already recorded against it (its own snapshot in that run's
  record is unaffected, per FR-011/FR-012's existing "past run keeps its own snapshot" rule).
- **FR-015**: The system MUST allow the user to reorder requests and folders within their
  containing folder (or the collection root); the collection's own stored order MUST reflect the
  new order for every subsequent view and run.
- **FR-016**: The system MUST allow the user to rename an existing request or folder; the new
  name MUST be reflected everywhere the collection is displayed, without altering any run already
  recorded against it under its prior name.
- **FR-017**: The system MUST reject any edit — variable value, field edit, add, delete, reorder,
  or rename — to a collection while a run of that same collection is currently in progress, and
  MUST clearly indicate to the user that the view is read-only until that run finishes.
- **FR-018**: The system MUST allow the user to define a new variable name and value that is not
  currently referenced by any request in the collection, and MUST persist it alongside variables
  discovered by reference (FR-003) for future use.

### Key Entities *(include if feature involves data)*

- **CollectionView**: The read model presented to the user for a loaded collection — its
  folder/request tree in source order, and, per request, the raw (unresolved) and
  variable-substituted (resolved) form of its method/URL/headers/body.
- **VariableBinding**: A variable available to the loaded collection — either discovered because
  a request references it, or defined directly by the user with no request referencing it yet
  (FR-018) — its name, current value, the scope it currently resolves from (collection default,
  environment, or user override), and whether it is currently resolved or missing. Builds on the
  existing `PostmanCollectionVariable` and `Environment.variableValues` concepts rather than
  introducing a parallel variable model.
- **RequestOverride**: A persisted, request-scoped edit to method/URL/headers/body, layered on
  top of a request's original definition (an uploaded collection's own request, or an
  ApiPilot-generated `GeneratedRequest`) without mutating it. Tracks which original request it
  applies to so it can be discarded if that request no longer exists (FR-012), and is surfaced in
  any run record produced from the overridden request (FR-011).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can view the fully resolved form of any request in a loaded collection,
  without running it, within seconds of opening the collection view.
- **SC-002**: 100% of variables referenced by a loaded collection are visible in the variable
  panel with an accurate resolved-or-missing status.
- **SC-003**: 100% of unresolved variables are visibly marked missing before a run starts
  (superseded: originally "100% of such run attempts are blocked" — see FR-006).
- **SC-004**: In usability review, at least 90% of users report they know exactly what will be
  sent before starting a run, compared to the prior results-only view.

## Assumptions

- This feature builds on the existing `PostmanCollection`/`ArtifactVariable` shared-domain types
  (`packages/shared-domain/src/postmanArtifact.ts`), the existing `Environment.variableValues`
  model, and the existing variable-completeness check, rather than introducing a parallel
  variable or collection model.
- This is a pre-run visibility and configuration surface. It does not change how a collection or
  its underlying test scenarios are *generated* (specs/003, 007, 016) — the deterministic
  generation pipeline's output is never mutated in place. What this feature adds is a downstream,
  explicitly-tracked override layer (FR-009a) that sits between "generated" and "executed," with
  every override visibly reflected in the resulting run record (FR-011) so generated-test
  provenance stays intact and inspectable even when a user chooses to run an edited request.
- Variable value entry follows the same interaction pattern already established by
  `EnvironmentForm` (key/value rows), extended with a live substitution preview rather than a
  newly invented editing pattern.
- Because request editing now applies to ApiPilot-generated collections handed off to execution
  (FR-008), this feature extends specs/018-test-execution-results' original scope boundary ("does
  not change how the artifact is generated"). That boundary is preserved at the generation layer;
  this spec adds an execution-time override layer specs/018 did not previously have. Reconciling
  specs/018's text with this addition is a documentation follow-up, not a behavioral conflict.

## Post-implementation follow-up (2026-09-21)

After the initial implementation (tasks.md T001–T049) shipped, live use surfaced additional gaps
addressed directly against this spec and tasks.md rather than through a separate spec-kit pass —
each is additive, none changes an existing FR's behavior:

- **Request test scripts** (FR-002/FR-007 addendum): a request's own `pm.test(...)` script was
  executed on every run but never shown or editable anywhere pre-run. `CollectionRequestView`
  gained `testScript`; `RequestEditorPanel` gained a "Tests" tab (quickstart.md Scenario 8).
- **Selective run**: the run panel gained a Postman-Runner-style checklist to choose which
  requests actually run, backed by a new optional `selectedRequestIds` field on
  specs/026-external-collection-execution's `execution/start` (that spec's own FR-018 addendum).
- **UI layout**: the collection editor's presentation was reworked based on direct usability
  feedback — a tabbed request editor (Headers/Body/Tests, method+URL+Save always visible, resolved
  preview always visible below the tabs) instead of every field stacked vertically; the sidebar
  shows the collection tree with a "Variables" toggle that switches the main pane rather than
  cramming a second panel into the same ~320px rail; per-row add/rename/delete/move controls
  collapsed into one actions menu per row instead of four-to-five individually tiny buttons. No
  FR changed — this is presentation only.
- **Bug fixes discovered through this same usability pass**: `VariablePanel`'s "missing" styling
  used a stale snapshot and didn't clear as soon as a value was typed; a newly added variable had
  no way to type its name (the field was accidentally read-only); the panel's local edit state
  never re-synced after a successful save, so a just-saved variable kept showing "Not yet saved".
  All three are fixed; see `frontend/tests/unit/VariablePanel.test.tsx` for regression coverage.

See tasks.md's Phase 8 for the per-task breakdown of this addendum.
