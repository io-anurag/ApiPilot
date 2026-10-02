# Contract: User-Defined Journeys in the Performance Plan API (AP-035)

These routes are registered once per path by `registerPerformanceRoutes`:
- guided base `/api/test-generation-workflow/performance`;
- quick base `/api/quick-performance`.

Each path keeps its gate:
- guided: `409 postman_generation_incomplete`;
- quick: `404 quick_test_not_found`.

Types are in [data-model.md](../data-model.md) and decisions in [research.md](../research.md).
This contract extends `specs/031-k6-performance-testing/contracts/performance-api.md` (`PUT /plan`)
and `specs/033-edit-step-request-body/contracts/body-edits-api.md`.

## `PUT /plan` (extended)

There are three new optional fields. As before, the fields not sent are unchanged, and the whole
body is validated against the current plan before anything is applied.

```json
{
  "userJourneys": [
    {
      "id": "j_…",
      "name": "Customer lifecycle",
      "steps": [
        { "id": "s_…", "operationKey": "POST /api/v1/customers",
          "captures": [{ "name": "customer_id", "source": { "kind": "body", "path": "id" } }],
          "bindings": [] },
        { "operationKey": "PUT /api/v1/customers/{id}",
          "captures": [],
          "bindings": [{ "target": { "kind": "path", "name": "id" },
                         "captureStepId": "s_…", "captureName": "customer_id" }] }
      ]
    }
  ],
  "alsoStandalone": ["GET /api/v1/customers/{id}"],
  "editProposedJourney": "j_…",
  "revertProposedJourney": "j_…"
}
```

Field rules:
- **`userJourneys`** is the complete list of definitions, and replaces the current list (research
  R3).
  - A journey or step without `id` is new, and the server assigns its id (R2).
  - An `id` the plan does not hold is refused.
  - `origin` is never accepted from the client. It is kept for existing ids, and is `defined` for
    new ones.
  - On input, a capture's `source` is `{kind: "body", path}` or `{kind: "header", name}`. The
    server parses and canonicalises it.
  - On input, `documented`, `state`, `confidence` and `relationshipId` are ignored. The server
    derives them, or keeps them from the stored definition.
  - A binding's `captureStepId` may name a new step only by its position. That form is
    `"captureStepIndex": 0` in place of `captureStepId`, and is resolved to the assigned id.
- **Restore (research R12).** When the same request also sends `nextUserJourneyNumber` (an
  integer of at least 1), the definitions of a past run are accepted with their own ids: a journey
  id must match `^j_[0-9a-f]{16}$` and a step id `^s_[0-9a-f]{16}$`, neither used by a proposed or
  single-step journey of the plan, and a restored journey's `nextStepNumber` is kept. The plan's
  sequence numbers become the larger of the plan's and the run's, so no new id repeats a restored
  one. Without `nextUserJourneyNumber`, an id the plan does not hold is refused.
- **Kept bindings.** A binding sent back unchanged (same step, target, capture) is not checked
  against its target again: if a rebuild removed the target, the plan marks it
  `target-missing` (FR-016) instead of refusing every other edit.
- **Documented path parameters.** A path target is documented when the operation declares it or
  when its path template has `{name}`: the analysis reads operation-level parameters only, so one
  declared on the path item is found through the template.
- **`alsoStandalone`** replaces the list. Each key must be an operation in a user journey.
- **`editProposedJourney`** names a proposed workflow journey, on the guided path only. It
  converts that journey into a `based-on-workflow` definition (R14).
- **`revertProposedJourney`** names a `based-on-workflow` user journey. It removes that journey and
  carries the settings of its converted steps back to the proposed steps (R14, FR-024). The
  frontend confirms first, naming the added steps whose settings are discarded.
- `editProposedJourney` and `revertProposedJourney` cannot be combined with each other or with
  `userJourneys` in the same request.

**Success:** `200 {plan, script}`.
- `plan.journeys` reflects the definitions (R4).
- `plan.bindingsNeedingAttention` lists steps with a `target-missing` binding.
- When the fingerprint changed, `script.outOfDate` is `true` (FR-021).

**Errors.** Each is `400` unless stated, and leaves the plan unchanged. No error quotes a value.

| Code | Extras | When |
|---|---|---|
| `invalid_user_journey` | `journeyId?` | Wrong shape; unknown id; a name that is empty, over 100 characters or contains control characters; no steps. |
| `journey_too_long` | `journeyId` | More than 20 steps (FR-002). |
| `unknown_operation` | `operationKey` | An operation key outside the plan's analysis. This is the existing code. |
| `too_many_captures` | `stepId` | More than 10 captures on a step (FR-007). |
| `capture_name_invalid` | `name` | Fails FR-026 (R11). |
| `capture_name_taken` | `name`, `journeyId` | The name is already used in the journey. |
| `capture_path_invalid` | `path`, `position` | Fails the R6 grammar: wildcards, filters, expressions, code (FR-008). |
| `capture_header_invalid` | `name` | Not an HTTP token of 1 to 128 characters (R8). |
| `binding_capture_unknown` | `stepId`, `captureName` | No such capture on the named step. |
| `dependency_order_violation` | `variable` (the capture name), `producerStepId`, `consumerStepId` | The capture's step is not before the binding's step. This is the existing code (FR-015). |
| `capture_in_use` | `capture`, `stepIds` | Removing a step or capture still used by a binding (FR-015). |
| `binding_target_unknown` | `stepId`, `target` | Not a documented path, query or header parameter; not a field of the base body; or a header the authentication covers (FR-011). |
| `binding_target_taken` | `stepId`, `target` | Two bindings name the same target. |
| `parameter_edited` | `stepId`, `name` | The parameter has an AP-033 edited value. Send the same request with a `parameterEdits` entry for the step that leaves it out (FR-014). |
| `invalid_standalone` | `operationKey` | An `alsoStandalone` key that is not in any user journey. |
| `not_a_proposed_journey` | `journeyId` | `editProposedJourney` names a journey that is not a proposed workflow journey, or the request is on the quick path. |
| `not_based_on_workflow` | `journeyId` | `revertProposedJourney` names a journey that is not a `based-on-workflow` user journey. |
| `invalid_request` | — | The existing code: the body is not an object, a field has the wrong shape, or `editProposedJourney` or `revertProposedJourney` is combined with another of the three journey fields. |

The existing `stepOrder` and `journeyOrder` accept user journey and step ids. `expectedStatuses`,
`bodyEdits` and `parameterEdits` accept user journey step ids. `bodyEdits` that remove a bound field
drop the binding and add a `capture-binding-dropped` notice (FR-013).

## `POST /plan/reset` (extended)

Reset still rebuilds the proposed plan from the current approvals (AP-029). In addition (spec Edge
Cases, "Resetting the plan"):
- definitions with `origin: defined` and `alsoStandalone` are kept, and re-resolved against the
  rebuilt plan, so a journey can become incomplete (FR-025) and a binding `target-missing`
  (FR-016);
- each `based-on-workflow` definition is reverted as by `revertProposedJourney` (R14): its converted
  steps' settings return to the proposed steps, and its added steps' settings are discarded.

The frontend's reset confirmation names the edited workflow journeys that will be reverted. The
response is unchanged: `200 {plan, script}`.

## `GET /plan/response-fields?operationKey=<key>` (new)

**Success:** `200 {fields: DocumentedResponseField[], truncated: boolean}` (R9), where:

```ts
type DocumentedResponseField = { path: string; type: string | null; statusCodes: string[] };
```

The list is sorted by `path`. It contains names and types only, and never an example value.

**Errors:**
- `400 invalid_request`: `operationKey` is missing.
- `400 unknown_operation`.
- The path's gate.

## `POST /script` (extended)

A new refusal is checked after the existing two:
- `422 binding_target_missing {stepIds}` when `plan.bindingsNeedingAttention` is non-empty
  (FR-016).

The order of refusals is `nothing_to_test`, then `expected_status_missing`, then
`binding_target_missing`. Incomplete journeys do not block (R4).

## `GET /plan/steps/:stepId/request` (extended)

It accepts user journey step ids. A bound target's value is `{reference: {kind: "capture",
captureName, producerStepId, source}}` and never a value (FR-012).

## Logging

Logs record journey ids, step ids, counts and error codes. They never record capture names, field
paths or header names in full: these are specification-derived and treated as potentially
sensitive (XVII, XX). They never record values.
