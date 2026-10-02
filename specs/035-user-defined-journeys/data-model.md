# Data Model: User-Defined Journeys and Captured Values (AP-035)

The shared types live in `packages/shared-domain/src/performance.ts`; every change there is
additive. `R` references are to [research.md](./research.md). No type holds a captured value
(FR-020).

## New types

### `CaptureSource`

```ts
type BodyPathSegment = { field: string } | { index: number };

type CaptureSource =
  | { kind: "body"; path: string; segments: BodyPathSegment[] }  // path: canonical text (R6)
  | { kind: "header"; name: string };                            // lowercased token (R8)
```

### `Capture`

| Field | Type | Rule |
|---|---|---|
| `name` | `string` | `^[A-Za-z_][A-Za-z0-9_]{0,63}$` and unique within the journey (FR-007, FR-026, R11). |
| `source` | `CaptureSource` | A body path passes R6; a header name passes R8. |
| `documented` | `boolean \| null` | Derived on assembly. `false` adds the "Not documented in the specification" warning, which never blocks. `null` for header captures (R9). |
| `relationshipId?` | `string` | Present only on a capture converted from a workflow variable (R14). |

### `BindingTarget` and `ValueBinding`

```ts
type BindingTarget =
  | { kind: "path" | "query" | "header"; name: string }
  | { kind: "body"; fieldPath: string };              // R6 grammar
```

| Field | Type | Rule |
|---|---|---|
| `target` | `BindingTarget` | A documented parameter of the step's operation, or a field of its current base body. It must not be a header the authentication covers, and at most one binding may name a target (R10). |
| `captureStepId` | `string` | A step **before** this one in the same journey (FR-011, FR-015). |
| `captureName` | `string` | A capture of that step. |
| `state` | `"active" \| "target-missing"` | Derived on assembly (FR-016). |
| `confidence?` | `"CONFIRMED" \| "LIKELY"` | Present only when converted from a workflow (FR-024). |
| `relationshipId?` | `string` | Present only when converted from a workflow (FR-024). |

### `UserJourneyStepDefinition`

| Field | Type | Rule |
|---|---|---|
| `id` | `string` | `s_` + 16 hex of SHA-256(`<journeyId>:<k>`) (R2). It is absent on input for a new step. |
| `operationKey` | `string` | `"METHOD /path"` of an operation of the plan's analysis. |
| `fromProposedStepId?` | `string` | Server-set on conversion (R14). Used on revert to carry settings back to the proposed step. Never accepted from the client. |
| `captures` | `Capture[]` | At most 10 (FR-007). |
| `bindings` | `ValueBinding[]` | Sorted by target kind, then name or field path. |

### `UserJourneyDefinition`

| Field | Type | Rule |
|---|---|---|
| `id` | `string` | `j_` + 16 hex of SHA-256(`user:<n>`) (R2). It is absent on input for a new journey. |
| `name` | `string` | Trimmed, 1 to 100 characters, no control characters (R11). |
| `origin` | `{kind: "defined"} \| {kind: "based-on-workflow"; workflowId: string}` | The second form is created only by `editProposedJourney` (R14). |
| `steps` | `UserJourneyStepDefinition[]` | 1 to 20 (FR-002). |
| `nextStepNumber` | `number` | Server-maintained (R2). |

## Changes to existing types

### `PerformanceJourneySource` (extended)

```ts
| { kind: "workflow"; workflowId: string }            // existing: proposed from a workflow
| { kind: "operation" }                               // existing: single-step
| { kind: "user"; userJourneyId: string; name: string;
    basedOnWorkflowId?: string }                      // NEW (FR-022, FR-027)
```

### `PerformanceJourney` (extended)

| New field | Type | Meaning |
|---|---|---|
| `incompleteReason?` | `{missingOperationKeys: string[]}` | Present only for an incomplete user journey. Such a journey is not rendered into the script (FR-025, R4). |

### `PerformanceStep` (extended)

| New field | Type | Meaning |
|---|---|---|
| `captures?` | `Capture[]` | Present only when non-empty. |
| `bindings?` | `ValueBinding[]` | Present only when non-empty. It is also expressed as `variableBindings` entries with `role: "consumes"` and `producerStepId`, so the order check and the request builder use one path (R5). |
| `userDefined?` | `true` | The step belongs to a user journey. This is the FR-022 marker and the AP-029 FR-039 provenance. |

`StepVariableBinding.location` already covers `path | query | header | body`.

### `PerformancePlan` (extended)

| New field | Type | Fingerprinted | Meaning |
|---|---|---|---|
| `userJourneys` | `UserJourneyDefinition[]` | when non-empty (R17) | The definitions (R1). |
| `alsoStandalone` | `string[]` | when non-empty | Operation keys kept as single-step journeys as well (FR-003). |
| `nextUserJourneyNumber` | `number` | with `userJourneys` | R2. |
| `bindingsNeedingAttention` | `string[]` | derived | Step ids with a `target-missing` binding. Blocks `POST /script` (FR-016). |

The `journeys` array now holds proposed, user (complete and incomplete) and single-step journeys,
in journey order (R4). `stepsNeedingExpectedStatus` ignores the steps of incomplete journeys.

### `BodyEditNotice.kind` (extended)

It gains `"capture-binding-dropped"` with `{stepId, fieldPath, captureName}`, for a body edit that
removed a bound field (FR-013, R10).

### `PreviewReference` (extended)

It gains `{kind: "capture"; captureName: string; producerStepId: string; source: CaptureSource}`.
The preview shows the capture's name and step, never a value (FR-012).

### `PlanChoices` (backend, `buildPlan.ts`)

It gains `userJourneys`, `alsoStandalone` and `nextUserJourneyNumber`. `choicesOf` and
`defaultChoices` set them to `[]`, `[]` and `1`.

### `WriteOperationEntry` (extended, R15)

It gains `steps: {stepId: string; journeyId: string; journeyLabel: string}[]`. `stepIds` is kept
for compatibility. `WriteOperationSummary.total` and `byMethod` count steps.

### Results (extended, all optional, absent on older runs)

| Type | New field | Meaning |
|---|---|---|
| `StepResult` | `captures?: {name: string; succeeded: number; failed: number}[]` | From `apipilot_capture` (R13). |
| `JourneyResult` | `cutShortByCapture?: Record<string, number>` | From the `capture` tag on `apipilot_cut_short`. |
| `PerformanceFinding` | (ruleset version 2) | `cut-short-journeys` names the capture that cut the most journeys short (FR-029). |

### `PerformanceRun.planSnapshot`

`planSnapshotForRun` keeps `userJourneys`, `alsoStandalone` and `nextUserJourneyNumber`. A snapshot
without them is read as `[]`, `[]` and `1` (R12). No captured value exists anywhere to snapshot.

## Rendered script data (`renderScript.ts`, R7)

`RenderedStep.produces` becomes `captures`:

```ts
{ key: string;                       // apipilot_c_<step>_<name>, or the workflow variable key
  name: string;                      // capture or variable name, used for the metric tag
  source: { body: (string | number)[] } | { header: string } }
```

`dependsOn` stays as the list of producer step ids of the step's bindings. Incomplete journeys are
not in `JOURNEYS`. The runtime text is the same for every plan (FR-018).

## State and lifecycle

```text
UserJourneyDefinition
  created ─► complete ─(operation excluded / out of scope / no scenario)─► incomplete
                ▲                                                            │
                └─────────────── operation back in the plan ─────────────────┘
  deleted ─► operations return as single-step journeys unless in another journey (FR-004)
  based-on-workflow ─(revert, confirmed)─► removed; the proposed journey returns (FR-024)

ValueBinding
  active ─(rebuild removes target)─► target-missing ─(remove or re-target)─► active / removed
  active ─(body edit removes field)─► removed, with a capture-binding-dropped notice (FR-013)
```

Each captured value exists only in one virtual user's `scope.vars` for one journey run in one
iteration, and is discarded when that journey run ends (FR-017).
