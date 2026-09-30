# Data Model: Edit a Performance Step's Request Body (AP-033)

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

All types live in `packages/shared-domain/src/performance.ts`, next to the AP-029 and AP-032
performance types. They stay framework-agnostic: no k6, Express or React types. Every change is
additive.

## New types

### `BodyEdit` (stored in the plan)

The engineer's replacement for one step's base body (research R1, R2).

| Field | Type | Rule |
|---|---|---|
| `stepId` | `string` | A step of the plan, or the step a removed operation would have (R9). |
| `operationKey` | `string` | `"METHOD /path"`. Used to keep the edit while the operation is removed. |
| `scenarioId` | `string` | The step's scenario when the edit was saved. A rebuild that changes it discards the edit (R9). |
| `kind` | `"json" \| "text"` | Must match the operation's primary request content type (R6). |
| `json` | `unknown` | Present when `kind` is `json`. The parsed value: any JSON value (R6). |
| `text` | `string` | Present when `kind` is `text`. |

As a discriminated union:

```text
BodyEdit = { stepId; operationKey; scenarioId } & ({ kind: "json"; json: unknown } | { kind: "text"; text: string })
```

Invariants:
- At most one edit per `stepId`. The list is sorted by `stepId` in code-unit order.
- The serialized size is at most 64 KiB.
- No reserved reference appears in it (R4).
- Every `format: password` field present in a JSON edit holds exactly one `{{name}}` reference
  (R8).
- An edit equal to the generated base body is never stored.

### `BodyEditInput` (request only)

What `PUT /plan` accepts per step: `{ kind: "json" | "text"; text: string }`. `null` resets the
step. For JSON the text is parsed on the server.

### `BodyEditNotice` (derived, not fingerprinted)

A reference that an edited body no longer carries (FR-010).

| Field | Type |
|---|---|
| `stepId` | `string` |
| `kind` | `"workflow-variable-dropped" \| "unique-field-dropped"` |
| `name` | `string`: the workflow variable's name, or the unique field's path. |

### `BodyMismatch` (derived, returned with the preview)

One difference between an edited JSON body and the request schema (FR-005, research R7).

| Field | Type |
|---|---|
| `fieldPath` | `string`: dotted, with `[n]` for array items; `""` for the root. |
| `rule` | `"required" \| "type" \| "enum" \| "format" \| "minimum" \| "maximum" \| "minLength" \| "maxLength" \| "minItems" \| "maxItems"` |
| `message` | `string`: plain words, for example "`quantity` is required by the specification and missing." |

### `StepBodyStatus`

`"sent" | "not-documented" | "documented-not-sent" | "unsupported-content-type"` (FR-001).

### `StepBodyEditModel` (returned with the preview)

What the editor needs for one step.

| Field | Type | Meaning |
|---|---|---|
| `kind` | `"json" \| "text"` | The kind an edit must have. |
| `text` | `string` | The base body to edit: the edit if there is one, otherwise the generated base body. JSON is formatted with `JSON.stringify(value, null, 2)`. It is empty when the step sends no body (`documented-not-sent`). |
| `edited` | `boolean` | Whether an edit is stored for the step. |
| `mismatches` | `BodyMismatch[]` | Empty unless `edited` and `kind` is `json`. |
| `replacements` | `{ fieldPath; reference: PreviewReference }[]` | FR-009: the JSON fields ApiPilot fills at run time (workflow variable, unique value, credential), found by comparing the body as sent with the base body. The engineer's own `{{name}}` references are not listed. Empty for text bodies. (Added during implementation, 2026-09-29.) |

## Changed types

### `PerformancePlan`

| Field | Change |
|---|---|
| `bodyEdits: BodyEdit[]` | New. It is fingerprinted only when not empty (R10), and emptied in run snapshots (R11). |
| `bodyEditNotices: BodyEditNotice[]` | New, derived by `assemblePlan`, not fingerprinted. |
| `discardedBodyEdits: string[]` | New. Operation keys whose edits a rebuild discarded (R9). Not fingerprinted; cleared by the next `PUT /plan` or rebuild. |

### `UserSuppliedValueSource`

Gains `"body-reference"`: a value referenced only by a `{{name}}` the engineer wrote in an edited
body. `secret` is true when that reference fills a `format: password` field, or when the name is
secret elsewhere in the plan (research R4).

### `PerformanceStep`

| Field | Change |
|---|---|
| `bodyEdited?: true` | New and optional: present only on a step with an edit. Not written into the script (`RenderedStep` does not carry it). |

### `StepRequestPreview`

| Field | Change |
|---|---|
| `bodyStatus: StepBodyStatus` | New (FR-001). |
| `bodyEdit: StepBodyEditModel \| null` | New. `null` when the operation's body cannot be edited (`not-documented`, `unsupported-content-type`). |
| `body` | Unchanged: the as-sent body with its references, from `stepRequestFor`. |

### `PerformanceRun.planSnapshot`

Same type. It is written through `planSnapshotForRun`, which leaves `bodyEdits: []` and
`discardedBodyEdits: []`, while the steps keep `bodyEdited` (FR-014). When a row from before this
feature is read, missing fields default to empty.

## Relationships and flow

```text
BodyEditInput (PUT /plan)
   │ validate (R6, R8) ── refuse → 400, nothing saved
   ▼
PerformancePlan.bodyEdits ──► assemblePlan
                                 ├─ effectiveScenario(scenario, edit)      (R3)
                                 │    ├─ buildJourneys.makeStep → requiredValues, unique candidates
                                 │    └─ stepRequestFor → script body = preview body
                                 ├─ bodyEditNotices                          (R4)
                                 ├─ step.bodyEdited
                                 └─ fingerprint (+bodyEdits when not empty)  (R10)
POST /runs ──► planSnapshotForRun(plan): bodyEdits [] ; bodyEdited kept     (R11)
```

## State transitions for one step's body

```text
generated ──save(edit ≠ base)──► edited ──save(edit)──► edited
    ▲                              │
    └──── reset / save(edit = base)┘
edited ──operation removed──► edited (kept, not sent) ──restored──► edited
edited ──rebuild with a different scenario──► generated (+ discardedBodyEdits notice)
```

Every transition into or out of `edited`, and every change of an edit, changes the plan
fingerprint, so a generated script becomes out of date (FR-007).

## Amendment 2026-09-30: parameter edits (FR-020 to FR-023)

### `ParameterEdit` (stored in the plan)

`{stepId, operationKey, scenarioId, parameters: ParameterEditEntry[]}`, kept and discarded
exactly as `BodyEdit` (R9). `parameters` holds only changes from the generated request, sorted by
location (`path`, `query`, `header`), then name.

`ParameterEditEntry = {location: "path" | "query" | "header", name} & ({action: "set", value:
string} | {action: "omit"})`.

### `ParameterEditInput` (request only)

`{parameters: ParameterEditEntry[]}`: the step's full set of changes; `null` resets the step.

### `StepParameterEditModel` (returned with the preview as `parameterEdit`)

`{rows: StepParameterEditRow[], edited: boolean}`, or `null` when the operation documents no
path, query or header parameter. A row is `{location, name, required, type, format, enum,
generated, edit, notEditable, secret}`: `generated` is the text the scenario sends (a path
parameter's `{{name}}` environment reference), or `null`; `notEditable` is
`"filled-at-run-time"` (a workflow variable fills it) or `"structured-value"` (array or object),
or `null`; `secret` is true for `format: password`.

### Changed types

- `PerformancePlan` gains `parameterEdits: ParameterEdit[]` (fingerprinted only when not empty,
  emptied in run snapshots) and `discardedParameterEdits: string[]` (not fingerprinted, cleared
  by the next edit or rebuild). Stored run snapshots without them read them as empty.
- `PerformanceStep` gains `parametersEdited?: true`, present only on an edited step.
- `UserSuppliedValueSource` gains `"parameter-reference"`.
- `StepRequestPreview` gains `parameterEdit: StepParameterEditModel | null`.
