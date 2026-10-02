# Research: User-Defined Journeys and Captured Values (AP-035)

Decisions R1 to R20 for [plan.md](./plan.md). Each records the decision, its rationale and the
alternatives considered. Requirement ids without a prefix are this spec's. AP-029 ids refer to
`specs/031-k6-performance-testing/spec.md`, AP-032 to `specs/032-quick-performance-test`, AP-033 to
`specs/033-edit-step-request-body`.

The design rests on the code as it stands at 19.15.0, read on 2026-10-02:
- **Building the plan:** `backend/src/performance/plan/buildPlan.ts` and `buildJourneys.ts`.
- **Requests:** `stepRequest.ts` and `planStepRequest.ts`.
- **Order check:** `validateOrder.ts`.
- **Script:** `backend/src/performance/k6/renderScript.ts`.
- **Report:** `backend/src/performance/report/aggregate.ts`, `findings.ts` and `renderHtmlReport.ts`.
- **Run snapshot:** `plan/runSnapshot.ts`.
- **Restore:** `frontend/src/components/performance/restoreFromRun.ts`.

## R1. Where user-defined journeys live: plan choices, re-applied on every assembly

**Decision**: User-defined journeys are stored as definitions in `PlanChoices` (`userJourneys`)
and on `PerformancePlan` (`userJourneys`). `assemblePlan` turns them into `PerformanceJourney`
values on every assembly, after `buildJourneys` has built the proposed and single-step journeys.
`choicesOf(plan)` carries them through `rebuildPlan`, so a guided rebuild (when the upstream
fingerprint changes) and every `PUT /plan` keep them. A definition holds:
- an id;
- a name;
- an origin (defined by the engineer, or based on a workflow);
- its ordered steps, each with an operation key, its captures and its bindings.

A definition holds no values (FR-020).

**Rationale**: This is the pattern AP-033 already uses for body and parameter edits. They are
choices keyed by step, re-applied by `assemblePlan`, and survive a rebuild with "discarded" lists
when they no longer apply. Using the same pattern keeps one assembly point (constitution XXVII). It
also gives FR-025 (keep the definition while an operation is missing) and FR-016 (mark a binding
whose target disappeared) for free, because each assembly re-resolves the definition against the
current scenarios.

`POST /plan/reset` keeps `defined` definitions and `alsoStandalone` through `choicesOf`, as it keeps
expected statuses, and reverts each `based-on-workflow` definition with R14's carry-back (spec Edge
Cases, "Resetting the plan").

**Alternatives considered**:
- Storing user journeys as already-built `PerformanceJourney` values and not rebuilding them. This
  was rejected: a rebuild that changes a scenario would leave stale requests and break FR-016.
- A separate journey store beside the plan. This was rejected: it gives two sources of truth for
  one plan, and restore, snapshot and fingerprint would each need to join them.

## R2. Identifiers that allow an operation more than once per journey (FR-002)

**Decision**:
- **User journey ids** are `j_` plus 16 hex characters of SHA-256 over `user:<n>`. Here `n` is a
  per-plan sequence number the server assigns on creation, kept in the plan as
  `nextUserJourneyNumber`.
- **User journey step ids** are `s_` plus 16 hex characters over `<journeyId>:<k>`. Here `k` is a
  per-journey step number assigned on add, kept as `nextStepNumber`.
- Ids never change on rename or reorder.
- Proposed and single-step journeys keep `journeyIdFor` and `stepIdFor` unchanged, so their ids,
  and the golden fixture's ids, do not move.

**Rationale**:
- `stepIdFor(journeyId, operationKey)` collides when an operation appears twice in one journey,
  which FR-002 requires.
- Expected statuses, body edits and parameter edits are already keyed by step id. Stable,
  occurrence-based ids therefore give each occurrence its own settings without new keying.
- Sequence numbers are deterministic for a given sequence of edits. They are stored in the plan,
  so the same plan always renders the same script (FR-021, XVI). No randomness or clock is used.

**Alternatives considered**:
- Random UUIDs. Rejected under XVI and the repository's determinism rules.
- Ids derived from position. Rejected: a reorder would change the id and orphan the step's edits.
- Client-chosen ids. Rejected: they are untrusted input, would need collision checks, and lose
  nothing by being assigned on the server.

## R3. One write model: the full list of definitions in `PUT /plan`

**Decision**: `PUT /plan` gains these optional fields:
- `userJourneys`: the complete list of definitions. New journeys, steps, captures and bindings come
  without ids; existing ones keep theirs.
- `alsoStandalone`: the operation keys that keep a single-step journey (FR-003).
- `editProposedJourney`: a proposed journey id to convert (FR-024, R14).
- `revertProposedJourney`: a based-on-workflow journey id to revert (FR-024, R14).

The server validates the whole list against the current plan before applying anything. This is
`applyPlanUpdate`'s existing all-or-nothing rule. The server then assigns ids, assembles the plan
and returns it.

Delete (FR-004) is a list without that definition. Revert (FR-024) has its own field, because it moves settings between step ids (R14). Restore (FR-028) sends the
snapshot's list unchanged (R12).

**Rationale**:
- `PUT /plan` is already declarative: `stepOrder`, `bodyEdits` and `parameterEdits` replace
  state rather than patching it.
- A full list makes refusals easy to state, because every check sees the result of the edit.
- A full list makes restore a single field.
- The definitions are small: at most 20 steps and 10 captures per step, and names and paths only.

**Alternatives considered**:
- One route per command (add step, add capture, bind…): about ten new routes, ten validators, ten
  client methods, and a restore that replays commands. Rejected under XXVII.
- JSON Patch: it gives an untrusted client structural control over a domain object. Rejected.

## R4. Which journeys the plan contains (FR-003, FR-005, FR-025)

**Decision**: `assemblePlan` builds the journey list as follows:
1. Proposed workflow journeys, except those replaced by a "based on workflow" definition (R14).
2. User-defined journeys, each resolved against the current scenarios (R5). A journey with a step
   whose operation is excluded, out of scope, or has no positive scenario is kept as
   **incomplete**. It is listed with `incompleteReason` naming the operation keys, it is not
   rendered into the script, and it is not counted as a step to test (FR-025).
3. Single-step journeys for every operation in scope that is not in a proposed journey and not in a
   complete or incomplete user journey, plus those listed in `alsoStandalone`.

A new user journey is appended to `journeyOrder`. The existing order re-application then places it
like any other journey (FR-005).

An incomplete journey does not block script generation (spec FR-025, Clarifications 2026-10-02).
It is listed as a non-blocking note in the pending bar, beside the existing missing-values note,
and `PerformanceRunPanel`'s trigger names each incomplete journey. A plan whose only journeys are
incomplete has nothing to test, which is the existing `422 nothing_to_test`.

**Rationale**: FR-003 says an operation leaves the single-step list when first added to a user
journey. Deriving this on each assembly, rather than storing "removed" flags, means deleting the
journey returns the operation automatically (FR-004). An operation removed from the plan stays
removed everywhere, because the exclusion is applied first (spec Edge Cases).

**Alternatives considered**:
- Blocking generation while any journey is incomplete. Rejected: the engineer may be removing
  operations deliberately.
- Showing the state only in the operations table. Rejected: a run would then cover less than the
  engineer composed without saying so at the trigger.

## R5. Captures and bindings reuse the workflow-variable substitution path

**Decision**: A binding is resolved into the same `consumes` entry a workflow variable produces
today. `{{key}}` is written at the target by `applyWorkflowSubstitutions`, so these keep working
unchanged:
- `buildStepRequest`;
- `envNames` (a bound value is no longer an environment value, FR-012);
- the request preview;
- body-edit references and the "Replaced at run time" list (FR-013);
- `validateStepOrder` (FR-015, through `producerStepId`).

The key is `apipilot_c_<producer step id without "s_">_<capture name>`. It is unique per step and
capture, and stays the same when the producing step moves. The prefix `apipilot_c_` is added to
`reservedNamesOf`, so an engineer's `{{name}}` in an edited body or parameter cannot reach a
capture.

`planStepRequest.ts`'s `stepRequestFor` recomputes consumes and produces from the workflow by step
position. It is changed to read them from `step.variableBindings` and the step's captures, which
are now the single source for both journey kinds. The refactor must leave the golden script for a
plan without user journeys unchanged, apart from R7, and the golden test proves it.

**Rationale**: The existing path already does everything FR-011 to FR-013 need, for every target
kind (path, query, header, dotted body field). A second path would duplicate the
serialization rules (AP-029 FR-011) and the reference bookkeeping.

**Alternatives considered**: A capture-specific template marker (for example `{{capture:…}}`).
Rejected: it would need its own resolver branch, preview text and envNames exclusion, for no
difference in behaviour.

## R6. Body field paths: a strict grammar, stored as segments (FR-008)

**Decision**:
- **Grammar.** A capture's body source is written as `field(.field | [n])*`. A field is one or more
  of `A–Z a–z 0–9 _ - $`, and `n` is a non-negative integer of at most 6 digits. The path is at most
  256 characters, with at most 16 segments.
- **Storage.** The path is parsed into segments (`{field}` or `{index}`) and stored in that form
  and as its canonical text.
- **Refusals.** `*`, `?`, `..`, `[]` and quotes are refused with `capture_path_invalid`, naming the
  position. So are filter syntax, function calls, any other character, and an empty segment.
- **Bindings.** A body binding's target uses the same grammar, and must name a field that exists
  in the step's current base body (FR-011, "a field of the step's body").

**Rationale**:
- FR-008 requires names and positions only. A closed grammar parsed on the server means a path can
  only ever become a list of strings and integers in the script's data (FR-018).
- The character set covers usual JSON keys, including kebab-case.
- The caps bound the walk and the data size.
- Keys containing `.` or `[`: the grammar cannot express them, and this is recorded as a
  limitation.

**Alternatives considered**:
- JSONPath or JMESPath. Refused by FR-008 (filters and wildcards).
- Accepting any string and splitting on `.`, as the existing `jsonField` does. Rejected: it cannot
  tell an index from a key named `0`, and gives a refusal nowhere to point.

## R7. One runtime rule for every capture, including workflow variables (FR-010, FR-018)

**Decision**: The fixed `RUNTIME` in `renderScript.ts` changes once, for every plan:
- **Status gate.** A step's captures are attempted only when `statusOk(status, expected)`. On an
  unexpected status, every capture of that step counts as failed and the journey is cut short.
- **Scalar values.** A capture succeeds only for a string, a finite number or a boolean, sent as
  `String(value)`. A missing field, `null`, `""`, an object or an array fails.
- **Header source.** `response.headers` is searched case-insensitively. The value is taken as k6
  reports it, never split (R8).
- **Body walk.** It walks the stored segments. A field reads own properties of an object, as
  today. An index reads an array element.

The rendered step data replaces `produces: {key, variable, field}` with `captures: {key, name,
source}`. Here `source` is `{body: segments}` or `{header: lowercaseName}`. Workflow variables are
rendered through the same shape, with their field split on `.`, which is today's meaning of
`items.0.id`.

This **amends AP-029 FR-010** for proposed workflow journeys. Two behaviours change:
- A producer that returns an unexpected status now cuts its journey short. Today the field is still
  read.
- An object or array value now fails the capture. Today it is sent as `[object Object]` or a
  comma-joined text.

The golden `script.js` is regenerated once and its diff reviewed, as under AP-034 R23. The
generated script must still pass AP-034's script check.

**Rationale**:
- FR-018 requires the script's code to be identical for every plan.
- FR-024 converts workflow variables into captures.
- Two capture semantics would make an edited proposed journey behave differently from the one it
  was based on.
- The old behaviours are defects rather than features: an object is never a usable path value, and
  reading a field from an error response sends a value the API did not mean as an id.

**Alternatives considered**: A per-capture "strict" flag in the data, set only for user captures.
It is allowed by FR-018, since it is data, but rejected: it keeps a known-wrong behaviour for
workflow journeys and doubles the test matrix. **The engineer confirmed the amendment on
2026-10-02 (spec FR-033).**

## R8. Header captures: case-insensitive match, the value as k6 reports it

**Decision**: The header name is stored lowercased, and must match the HTTP token grammar
(RFC 9110 `tchar`, 1 to 128 characters). At run time the runtime walks
`Object.entries(response.headers)` and takes the first entry whose lowercased key matches.

The capture takes that entry's value exactly as k6 reports it, and never splits it. If k6
combines a repeated header into one value, the combined text is captured (spec Edge Cases,
Clarifications 2026-10-02). The opt-in real-k6 test (R19) records how k6 presents a repeated
header, so the user manual can describe it. The behaviour does not depend on the result.

**Rationale**:
- Header names are case-insensitive (RFC 9110 §5.1).
- k6 canonicalises header keys in `response.headers`, so a case-insensitive match is needed
  whatever case the engineer types.
- Splitting on `, ` would corrupt legitimate values that contain commas.

**Alternatives considered**: Splitting joined values on `,`. Rejected for the corruption above,
and by the engineer on 2026-10-02.

## R9. Documented response fields for the capture picker (FR-009)

**Decision**: A pure function `documentedResponseFields(operation)` walks the
`SchemaConstraint`s of the operation's 2xx `Response.contentTypes` for `application/json` and
`+json` media types. These are the ApiModel's already-resolved `properties` and `items`, available
on both paths through `PerformanceContext.apiModel`. It returns each reachable scalar field as a
path in the R6 grammar, with `[0]` for array items, its type and the status codes that document
it.

Detail of the walk:
- **Order.** The list is sorted by canonical path in code-unit order.
- **Limits.** It stops at depth 8 and at 300 fields, with a `truncated` flag the picker states.
- **Constructs it cannot follow.** Composed or unresolved schemas reach the ApiModel as empty
  constraints with an `AnalysisIssue`, so they contribute no fields and nothing is fabricated.

The ApiModel does not record response headers (`Response` has `statusCode`, `description`,
`contentTypes` and `examples` only). Header captures are therefore typed by name, are never listed,
and are never marked "Not documented in the specification": FR-009 asks for documented body
fields only. Extending the OpenAPI pipeline to keep response headers is out of scope.

The picker marks a field whose last segment equals a parameter name of a later step in the same
journey. This is a presentation hint, `laterStepParameterMatches` in `shared-domain`, and it binds
nothing (FR-006).

It is served by `GET <base>/plan/response-fields?operationKey=`, so the frontend does not need the
`ApiModel`.

**Rationale**:
- XXXII requires review to stay practical at scale. A bounded, sorted list keeps the picker usable
  on large schemas.
- Not following composition constructs matches the repository rule that unsupported constructs
  are not fabricated.
- A body path the list does not contain is still accepted, with the "Not documented in the
  specification" warning (FR-009). This is `documented: false` on the capture, re-derived on each
  assembly. Header captures carry `documented: null`, meaning not applicable.

**Alternatives considered**: Sending the whole response schema to the frontend to walk. Rejected:
it duplicates domain logic in the UI, and sends more of the specification to the browser than
needed.

## R10. Refusals that protect bindings (FR-014, FR-015, FR-016)

**Decision**: These checks run in `applyPlanUpdate`, on the proposed result, before anything is
applied:
- **Order and placement.** A binding must name a capture of a step before its own step in the same
  journey. A violating reorder gives the existing `400 dependency_order_violation`, with `variable`
  set to the capture name, so the existing frontend message applies. Removing a step, or a capture,
  that a binding still uses gives `400 capture_in_use {capture, stepIds}`.
- **Duplicate targets.** Two bindings on one target give `400 binding_target_taken`.
- **Bound parameter that also has an edit.** This gives `400 parameter_edited {stepId, name}`.
  The frontend asks first (FR-014). On confirmation it sends the binding together with a
  `parameterEdits` entry for that step without the parameter, in the same `PUT`, so the result is
  consistent.
- **Not editable once bound.** AP-033's parameter edit already refuses a parameter "filled at run
  time" (AP-033 FR-021). A bound parameter is filled at run time, so it can no longer be edited as
  a value (FR-014).
- **Targets that can never be bound.** A target the specification does not document gives
  `400 binding_target_unknown`. So do a body field absent from the base body, and a header the
  authentication covers.
- **Targets that disappear after a rebuild.** When a target disappears because of a rebuild rather
  than an edit, assembly marks the binding `state: "target-missing"`. It also adds the step to
  `plan.bindingsNeedingAttention`. `POST /script` then refuses with
  `422 binding_target_missing {stepIds}` (FR-016). This is listed in the pending bar with the
  other blockers.
- **Body edits that remove a bound field.** A body edit that removes a bound field drops the
  binding. It records a `capture-binding-dropped` body-edit notice, the existing
  `bodyEditNotices` mechanism, which the step's details show (FR-013).

**Rationale**: Every refusal names the capture and the steps (FR-015) and is never silently
corrected (AP-029 FR-007, XIV). A disappearing target is not refused, because the engineer did not
cause it. It is shown and blocks, matching how `expected_status_missing` already works.

**Alternatives considered**: Silently dropping bindings whose target vanished. Rejected by FR-016
and XIV.

## R11. Names and limits (FR-002, FR-007, FR-026)

**Decision**:
- **Capture names** match `^[A-Za-z_][A-Za-z0-9_]{0,63}$` and are unique within their journey.
  Other names are refused with `capture_name_invalid` or `capture_name_taken`. The 64-character
  cap is an implementation bound, to keep the derived key well within k6 tag and identifier sizes.
- **Journey names** are trimmed, 1 to 100 characters, with no control characters.
- **Limits.** A journey has at most 20 steps (`journey_too_long`). A step has at most 10 captures
  (`too_many_captures`).
- **No limit on the number of user journeys.** The spec sets none, and `PUT /plan`'s existing JSON
  body limit bounds the request.

**Rationale**: These are the spec's limits. The 64-character and 100-character bounds follow
existing name bounds (AP-034's script name is 100), and are recorded so they are not mistaken for
product rules.

**Alternatives considered**: A cap on the number of user journeys. Rejected: it would be a product
rule the spec does not state (CLAUDE.md §63).

## R12. Snapshot and restore (FR-027, FR-028)

**Decision**:
- **Snapshot.** `planSnapshotForRun` keeps `userJourneys` and `alsoStandalone`. They hold names,
  operation keys, field paths and header names, and never a captured value. The rendered
  `journeys` already carry origin and steps. `performance_runs.plan_snapshot` stays unencrypted:
  its content class is unchanged, since it already holds operation keys and field names.
- **Restore.** `restoreSettingsFromRun` adds the snapshot's `userJourneys` and `alsoStandalone` to
  its first `PlanUpdate`. Because assembly keeps an unresolvable step as an incomplete journey
  (R4), and a vanished target as `target-missing` (R10), the restore never fails on them. The
  restore message names each step that came back incomplete or with a missing target, as "not
  restored" (FR-028).
- **Ids and order.** Ids come back unchanged, so `restoreOrderFromRun`'s id-set comparison works
  for user journeys as it does for proposed ones. `nextUserJourneyNumber` and `nextStepNumber` are
  set to at least one above the restored maxima.
- **Older snapshots.** A snapshot from before this feature has no `userJourneys` and is read as
  `[]`. This is the existing defaults-on-read pattern (`BODY_EDIT_DEFAULTS`).

**Rationale**: Restore stays frontend-composed through `PUT /plan`, which is the existing AP-029
FR-024b design, with no new route. Representing "cannot restore" as plan state keeps one rule for
missing operations, whether they are missing after a restore or after a removal.

**Alternatives considered**: A backend restore route. Rejected: it would duplicate `PUT /plan`
validation for one caller.

## R13. Run metrics and report (FR-029)

**Decision**:
- **New counter.** The runtime adds `apipilot_capture` (`Counter`), tagged
  `{step, journey, capture: name, outcome: "ok" | "failed"}`.
- **Cut-short tag.** `apipilot_cut_short` gains a `capture` tag naming the first failed capture.
- **Extraction check.** The existing `extraction` check stays, so `checkPassRatePercent` and older
  reports keep their meaning.
- **Aggregate.** It reads both counters. `StepResult` gains `captures?: {name, succeeded,
  failed}[]`, and `JourneyResult` gains `cutShortByCapture?: Record<name, count>`. Both are
  optional and absent on older runs.
- **Findings.** The `cut-short-journeys` finding names the capture that cut the most journeys
  short, with ties broken by name. `PERFORMANCE_FINDINGS_RULESET_VERSION` becomes 2.
- **HTML report.**
  - The request block lists each bound value as `target ← capture name, from step <label> (body
    field path | header name)`.
  - The response block lists captures with their counts.
  - The step provenance states "In a journey defined by you", "Based on workflow …" or
    "Proposed from workflow …" (AP-029 FR-039).
- **Tag cardinality.** It is bounded by the plan: at most 10 captures per step.

**Rationale**:
- The existing `extraction` check carries no capture name and is mixed into the check rate, so it
  cannot give per-capture counts.
- A dedicated counter keeps the old metric's meaning.
- Only names are tagged, never values (FR-020).

**Alternatives considered**: Adding a `capture` tag to the `extraction` check. Rejected: k6's
check metric is shared with the status check, and the aggregate would have to infer which checks
are captures.

## R14. Editing and reverting a proposed workflow journey (FR-024)

**Decision**: `PUT /plan { editProposedJourney: <journeyId> }` converts a proposed workflow journey,
on the guided path only, into a definition with `origin: {kind: "based-on-workflow",
workflowId}`. The conversion:
- keeps one step per workflow step, in order;
- copies each step's expected status edits, body edit and parameter edit to the new step ids;
- turns each `WorkflowVariable` into a capture on its producer and a binding on its consumer, both
  carrying `relationshipId` and the relationship's confidence.

Capture names are the variable names when valid under FR-026. Otherwise invalid characters become
`_`, a leading digit gets a `_` prefix, and a clash gets `_2`, `_3`, and so on, in variable order.
The confidence is shown on the binding (Story 3, scenario 1).

While a based-on-workflow definition exists, `assemblePlan` leaves out the proposed journey for
that workflow. Each converted step records `fromProposedStepId`, the proposed step it came from.

Revert is `PUT /plan { revertProposedJourney: <userJourneyId> }`, sent after the frontend's
confirmation. It runs on the server because it moves settings between step ids:
- it removes the definition;
- it re-keys the expected statuses, body edit and parameter edits of each step with a
  `fromProposedStepId` back to that proposed step id. AP-033's existing `scenarioId` match still
  applies, so an edit made against a different scenario is discarded as usual;
- it discards the settings of steps the engineer added. The confirmation names those steps
  (spec FR-024, Clarifications 2026-10-02).

The proposed journey then returns, with its original ids.

**Rationale**: The conversion is domain logic, so it runs on the server and is unit-tested. It
does not run in the UI. Keeping the workflow id lets assembly suppress the right proposed journey
and lets the report say "Based on workflow".

**Alternatives considered**: Editing the proposed journey in place. Rejected: it would blur
ApiPilot's inference with the engineer's choices, which XIII and XV require to stay apart.

## R15. Write-operation summary counts steps (FR-023)

**Decision**:
- `summarizeWriteOperations(journeys)` keeps one entry per operation key. Each entry gains
  `steps: {stepId, journeyId, journeyLabel}[]`.
- `total` and `byMethod` now count steps rather than operations.
- Incomplete journeys are excluded, because they are not run.
- The function stays in `shared-domain` and is pure.
- **AP-032 FR-009 and FR-011 amendment.** "count each write operation" now means each step that
  sends one. This differs from before only when an operation occurs in more than one step. On
  the guided path that was already possible when two approved workflow journeys share an
  operation, so such a plan's count rises too (corrected during implementation, 2026-10-02).

**Rationale**: FR-023 asks for it, and the write summary is the AP-032 basis for the constitution
exception ("every write operation it will send listed"). Counting sends rather than operations is
the more conservative reading.

## R16. Presentation (FR-022, FR-031)

**Decision**: The operations table keeps one table (XXXIII, CLAUDE.md §41).
- **Group header.** The hard-coded "Workflow" label becomes an origin label with a text badge:
  "Proposed from workflow", "Defined by you" or "Based on workflow".
- **Incomplete journeys.** They show an "Incomplete" warning badge and the missing operations.
- **Steps.** Steps with captures or bindings show "Captures n" or "Uses captured value" info
  badges.
- **Details tabs.** The inspector gains a **Captures** tab. The parameters tab offers a source
  choice per row (generated or edited value, or "Value captured by an earlier step"). The body
  editor offers a "Bind a field" control, and lists bound fields under "Replaced at run time".
- **Journey controls.** New controls are **New journey** (toolbar), **Add step** (an operation
  picker in `Dialog`), Rename (`PromptDialog`), Delete and Revert (`ConfirmDialog`), and **Also run
  on its own**. Reordering stays button-based.
- **Quick scope note.** It changes to FR-031's text.

All controls are buttons with accessible names. All state is shown in text, not colour alone.
Display labels live in `performanceViewModel.ts`.

**Rationale**: It reuses AP-027 components and the existing JourneyList structure, rather than
adding a parallel journey editor.

**Alternatives considered**: A separate "journey builder" page. Rejected: it splits one plan
across two screens, and duplicates the step inspector.

## R17. Fingerprint and out-of-date marking (FR-021)

**Decision**: `planFingerprint` includes `userJourneys`, `alsoStandalone` and
`nextUserJourneyNumber` only when `userJourneys` is non-empty or `alsoStandalone` is non-empty. This
is the AP-033 pattern for `bodyEdits`, so plans without user journeys keep today's fingerprint.
Any change to the definitions changes the fingerprint and marks a generated script out of date
(AP-029 FR-023).

## R18. No AI, no inference, no new dependency (FR-006, FR-032)

**Decision**:
- No module in this feature imports the AI provider.
- The quick path still passes `workflows: []` and `relationships: []`.
- The only server-built definitions come from `editProposedJourney`, which is an explicit action.
- No new runtime or development dependency is added.

## R19. Testing strategy

**Decision**:
- **Pure unit tests:**
  - path grammar;
  - name rules;
  - the definition validator (every refusal of R10 and R11);
  - assembly (incomplete journeys, single-step suppression, `alsoStandalone`, based-on-workflow
    suppression);
  - id assignment;
  - workflow conversion;
  - documented response fields;
  - write summary;
  - fingerprint stability.
- **Runtime:** in `k6Sandbox` (the Node `vm` with k6 stubbed):
  - per-iteration and per-virtual-user isolation (FR-017);
  - status gate and scalar rule (R7);
  - header capture;
  - cut short with the capture tag;
  - no request for a step whose bound value was not captured;
  - repeated operations.
- **Golden:** regenerated once for R7, and the diff reviewed. A second golden is added for a plan
  with user journeys. Byte-identity is tested ten times (SC-004). A test asserts that the runtime
  text is identical across plans apart from the data block.
- **Integration (Supertest):** `PUT /plan` refusals and success on both paths, `GET
  /plan/response-fields`, `POST /script` blocking, snapshot content, and restore round-trip.
- **Seeded values (SC-005):** the test server returns a seeded id. It is searched for in the plan,
  script, environment template, run record, report and captured logs.
- **Opt-in real-k6 test:** a create/update/delete journey against `TargetServer`, which returns a
  new id per POST and 404 for an unknown id (SC-002). It also covers a capture made to fail
  (SC-003) and a repeated header (R8). It is never part of `npm test`.
- **Frontend (React Testing Library):**
  - new journey;
  - add, reorder and remove a step;
  - the reorder refusal message;
  - capture picker with an undocumented-path warning;
  - binding source;
  - the confirm when an edited parameter is bound;
  - incomplete and target-missing states;
  - restore message;
  - quick scope note.

## R20. Delivery order and version

**Decision**:
- **P1 (Story 1):** definitions, assembly, ids, path grammar, body captures, path-parameter
  bindings, the runtime change, report counts, and the minimal UI (new journey, add step,
  captures tab, path-parameter source).
- **P2 (Story 2):** header captures, query, header and body bindings, repeated operations in UI,
  documented-path warning, write summary.
- **P3 (Story 3):** edit and revert a proposed journey, and restore.
- **Version:** `npm run version:bump -- feature` (19.15.0 → 19.16.0) at the end, as for AP-034.
