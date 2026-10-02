# Contract: Changes to Existing APIs and Modules (AP-035)

Most changes are additive. Three amend earlier specifications and are marked **Amendment**. Each
amendment needs a pointer in the amended spec when it is implemented.

## AP-029 generated script (`performance/k6/renderScript.ts`)

- **Amendment to AP-029 FR-010 (research R7).** The fixed runtime changes once, for every plan:
  - **Status gate.** A step's captures, which now include workflow variables, are attempted only
    on an expected status. On any other status, every capture of the step fails.
  - **Scalar values.** A capture succeeds only for a string, a finite number or a boolean.
  - **Header source.** Header captures are matched case-insensitively.
  - **Body walk.** The walk follows stored segments: an object field, or an array index.
  - **Metrics.** A new counter, `apipilot_capture {step, journey, capture, outcome}`, is added.
    `apipilot_cut_short` gains a `capture` tag.
- The rendered step data is `captures: {key, name, source}`, replacing `produces`.
- `JOURNEYS` leaves out incomplete journeys.
- The runtime text is identical for every plan (FR-018), which a test asserts. The script stays
  byte-identical for the same plan (AP-029 FR-020).
- The golden `backend/tests/fixtures/performance/golden/script.js` is regenerated once, and the
  diff reviewed. A second golden, for a plan with user journeys, is added.
- The script must still pass AP-034's `checkUserScript` (AP-029 FR-022a). This is the existing test.
- `buildK6Args`, `buildChildEnv`, the environment template format and `VALUE_ENV` are unchanged.

## AP-029 plan assembly (`performance/plan/`)

- **`buildPlan.ts`.** `PlanChoices`, `defaultChoices`, `choicesOf`, `assemblePlan` and
  `planFingerprint` gain user journeys (R1, R4, R17). A plan without user journeys keeps its
  journeys, ids and fingerprint.
- **`planStepRequest.ts`.** `stepRequestFor` reads consumes and captures from the step's bindings
  and captures, rather than recomputing them from the workflow by position (R5). The behaviour is
  unchanged for proposed journeys, apart from R7.
- **`validateOrder.ts`.** It is unchanged. User bindings appear as `consumes` with
  `producerStepId`.
- **`bodyEdits.ts`.** `reservedNamesOf` adds the `apipilot_c_` prefix. A body edit that removes a
  bound field drops the binding, with a `capture-binding-dropped` notice.
- **`runSnapshot.ts`.** The snapshot keeps `userJourneys`, `alsoStandalone` and
  `nextUserJourneyNumber` (R12).
- **New modules.**
  - `userJourneys.ts`: validate, assign ids, resolve, assemble.
  - `capturePath.ts`: the R6 grammar.
  - `responseFields.ts`: R9.
  - `convertWorkflowJourney.ts`: R14.
  - All are pure.

## AP-029 report (`performance/report/`)

- **`aggregate.ts`.** It reads `apipilot_capture` and the `capture` tag. `StepResult.captures` and
  `JourneyResult.cutShortByCapture` are optional.
- **Amendment.** `findings.ts`'s `cut-short-journeys` finding names a capture (FR-029), and
  `PERFORMANCE_FINDINGS_RULESET_VERSION` is now 2. Older runs keep the report they were given.
- **`renderHtmlReport.ts`.**
  - Each step's request block lists bound values with capture, step and source.
  - Its response block lists captures with success and failure counts.
  - Its provenance states the journey's origin (AP-029 FR-039).

## AP-032 write-operation summary (`shared-domain` `summarizeWriteOperations`)

- **Amendment to AP-032 FR-009 and FR-011 (research R15).** `total` and `byMethod` count steps
  that send a write. Each entry lists its steps with their journey label. Incomplete journeys are
  excluded.
- This differs from today only for an operation that is in more than one step.

## AP-032 quick path

- **Amendment to AP-032 FR-006 (FR-030).** Assembly still infers no chaining: the quick context
  keeps `workflows: []` and `relationships: []`. The engineer's user journeys are applied as on the
  guided path.
- Uploading a new specification replaces the plan, including its user journeys. This is the
  existing replacement path (spec Edge Cases).

## AP-033 parameter and body editors

- A bound parameter row has `notEditable: "filled-at-run-time"`. This is the existing value, and
  it is reused, so AP-033 FR-021's refusal applies (FR-014).
- `StepBodyEditModel.replacements` lists bound fields with a `capture` reference (FR-013).

## Frontend (`frontend/src/`)

- **`services/performanceTestingClient.ts`.**
  - `PlanUpdate` gains `userJourneys`, `alsoStandalone`, `editProposedJourney` and `revertProposedJourney`.
  - `PerformanceClient` gains `fetchResponseFields(operationKey)`.
  - `STRING_EXTRAS` gains `capture`, `captureName`, `name`, `operationKey`, `journeyId` and
    `path`. `NUMBER_EXTRAS` gains `position`. The array extras `stepIds` and `target` are handled
    as typed fields.
- **`components/performance/JourneyList.tsx`.**
  - The journey origin label replaces the hard-coded "Workflow".
  - It adds the incomplete state, the user-journey controls and the step badges (R16).
  - The inspector gains a Captures tab.
- **New components**, each tested with React Testing Library:
  - `UserJourneyControls.tsx`;
  - `AddStepDialog.tsx`;
  - `CaptureEditor.tsx`;
  - `BindingSourceControl.tsx`.
- **Changed components.**
  - `StepParameterEditor.tsx` and `StepBodyEditor.tsx`: binding source choice.
  - `PreviewReferenceNote.tsx`: wording for capture references.
  - `ValuesChecklist.tsx`: unchanged, because bound values are no longer requirements.
- **`PerformancePlanScreen.tsx`.**
  - The pending bar gains a `bindings` item (FR-016), and a non-blocking note listing incomplete
    journeys (FR-025).
- **`PerformanceRunPanel.tsx`.** The run trigger names each incomplete journey that will not run
  (FR-025).
  - `explain()` maps `capture_in_use` and `parameter_edited`.
  - `generateBlockedReason` adds "A captured value's target no longer exists".
- **`restoreFromRun.ts`.** It restores `userJourneys` and `alsoStandalone`, and names steps that
  came back incomplete or with a missing target (FR-028).
- **`pages/QuickPerformancePage.tsx`.** The scope note follows FR-031.
- **`performanceViewModel.ts`.** It holds the labels: origin, "Defined by you", "Based on
  workflow", "Incomplete", "Target no longer exists", "Not documented in the specification".
