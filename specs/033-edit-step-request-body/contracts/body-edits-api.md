# Contract: Step Body Edits (AP-033)

Applies to both plan bases, through the shared `registerPerformanceRoutes`:
- guided: `/api/test-generation-workflow/performance`
- quick: `/api/quick-performance`

Each path keeps its gate: `409 postman_generation_incomplete` (guided) and
`404 quick_test_not_found` (quick). Types are in [data-model.md](../data-model.md). Decisions are
in [research.md](../research.md) R6 to R12.

## `PUT <base>/plan`: new field `bodyEdits`

It can be sent alone or with any other `PUT /plan` field. The update is all or nothing: nothing is
saved if any field fails.

```json
{
  "bodyEdits": {
    "<stepId>": { "kind": "json", "text": "{\n  \"productId\": \"SKU-1\",\n  \"quantity\": 2\n}" },
    "<otherStepId>": null
  }
}
```

- An object sets the step's edit. For `kind: "json"` the text is parsed on the server, and the
  formatting is not kept (R2).
- `null` resets the step to its generated body (FR-017). "Reset all" sends every edited step as
  `null` in one request.
- An edit equal to the generated base body clears the edit.

**Success**: `200 {plan, script}`, as for every `PUT /plan`.
- `plan.bodyEdits` holds the stored edits, and each edited step has `bodyEdited: true`.
- `plan.bodyEditNotices` lists the dropped workflow variables and unique fields (FR-010).
- `plan.userSuppliedValues` includes environment values the edited bodies reference (FR-011).
- The fingerprint changes, so `script.outOfDate` is `true` when a script had been generated
  (FR-007).
- `plan.discardedBodyEdits` is cleared (R9).

**Errors** (all 400, body `{error, message, stepId, ...}`, nothing saved), checked in this order:

| `error` | Extra fields | When |
|---|---|---|
| `invalid_request` | none | `bodyEdits` is not an object, or an entry is neither `null` nor `{kind, text}` with `kind` `json` or `text` and `text` a string. |
| `invalid_body_edit` | `stepId` | The step is not in the current plan (unknown, or its operation is removed or left out). |
| `body_not_accepted` | `stepId` | The operation documents no request body, its primary content type is neither JSON-like nor `text/*`, or `kind` does not match it. |
| `body_too_large` | `stepId`, `limitBytes: 65536` | The text is larger than 64 KiB in UTF-8. |
| `invalid_body` | `stepId`, `line`, `column` (1-based) | JSON text that does not parse. The message is ApiPilot's own and never quotes the text. |
| `reserved_reference` | `stepId`, `reference` | A `{{name}}` using a name ApiPilot reserves: an `apipilot_unique_` token, a workflow variable of the plan, or a token source's variable (R4). |
| `body_secret_literal` | `stepId`, `fieldPath` | A `format: password` field present in the edited body holds anything other than one `{{name}}` reference, including an unchanged generated value (R8, FR-012a). |

## `GET <base>/plan/steps/:stepId/request`: new preview fields

**Success**: `200 {request: StepRequestPreview}`, now with:

```json
{
  "bodyStatus": "sent",
  "body": { "contentType": "json", "text": "…as sent, with references…", "references": [] },
  "bodyEdit": {
    "kind": "json",
    "text": "{\n  \"customerEmail\": \"user@example.com\",\n  \"quantity\": 1\n}",
    "edited": true,
    "mismatches": [
      { "fieldPath": "quantity", "rule": "minimum", "message": "`quantity` is below the documented minimum of 1." }
    ],
    "replacements": [
      { "fieldPath": "customerEmail", "reference": { "kind": "unique-per-iteration", "name": "apipilot_unique_0", "format": "email" } }
    ]
  }
}
```

- `bodyEdit.replacements` lists the JSON fields ApiPilot fills at run time, for the editor's
  "Replaced at run time" list (FR-009). The engineer's own `{{name}}` references are not listed.

- `bodyStatus` is `not-documented` (and `body` and `bodyEdit` are `null`) when the operation
  documents no request body.
- `bodyStatus` is `documented-not-sent` when the operation documents one that the scenario does
  not send. `body` is `null`, and `bodyEdit.text` is `""` so the engineer can add one.
- `bodyStatus` is `unsupported-content-type` for form and multipart bodies. `bodyEdit` is `null`,
  and `body` is shown as before, when present.
- `bodyEdit.mismatches` is empty unless the step has a JSON edit. Mismatches never block anything
  (FR-005).
- No value from an environment ever appears (AP-032 FR-008, unchanged).

Errors are unchanged: `404 step_not_found`, plus the gates.

## `GET <base>/plan/removed-operation?operationKey=`

The response shape is unchanged (`{step, request}`), and `request` carries the new fields.
- An edit kept for a removed operation is shown, and `step.bodyEdited` is `true` (FR-018).
- The client never offers editing in this view (FR-003).

## `POST <base>/plan/reset`

Body edits are kept, like exclusions, expected statuses and thresholds. Only order is reset (R9).

## `POST <base>/runs` and reports

- The stored `planSnapshot` has `bodyEdits: []` and `discardedBodyEdits: []`. Its steps keep
  `bodyEdited` (FR-014, R11).
- `GET /runs/:runId` returns that snapshot.
- `GET /runs/:runId/report` marks edited steps "Body edited by you" and states their count in the
  provenance section. No body content appears in any run response or report.

## Amendment 2026-09-30: `PUT <base>/plan` field `parameterEdits` (FR-020 to FR-022)

`parameterEdits: {[stepId]: {parameters: [{location, name, action: "set", value} | {location,
name, action: "omit"}]} | null}`. Each step's entry replaces that step's changes; `null` resets
it. Steps are checked in code-unit order of step id and entries by location, then name; nothing
is applied unless every entry passes. Entries equal to the generated request are dropped.

| Status | `error` | When | Extra fields |
|---|---|---|---|
| 400 | `invalid_request` | Not an object; an entry without `parameters`; a location other than path, query or header; a missing name | — |
| 400 | `invalid_parameter_edit` | Unknown step; undocumented parameter; a parameter listed twice; neither `set` with a string nor `omit`; a control character | `stepId`, `location`, `name` |
| 400 | `parameter_not_editable` | A parameter a workflow variable fills; a new value for an array or object parameter | `stepId`, `location`, `name` |
| 400 | `parameter_required` | Leaving out a required or path parameter; an empty path parameter | `stepId`, `location`, `name` |
| 400 | `parameter_too_long` | A value over 2,048 bytes in UTF-8 | `stepId`, `location`, `name`, `limitBytes` |
| 400 | `reserved_reference` | A `{{name}}` ApiPilot reserves | `stepId`, `location`, `name`, `reference` |
| 400 | `parameter_secret_literal` | Anything but one `{{name}}` in a `format: password` parameter | `stepId`, `location`, `name` |

No message or field quotes the value. `GET <base>/plan/steps/:stepId/request` returns
`parameterEdit` (data-model.md). Run snapshots have `parameterEdits: []` and
`discardedParameterEdits: []`, their steps keep `parametersEdited`, and the report marks those
steps "Parameters edited by you".
