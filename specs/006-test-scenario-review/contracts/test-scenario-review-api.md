# API Contract: Test Scenario Review

AP-006 provides a stateless review boundary for a supplied `ApiModel` and `TestModel`. Review
state is returned to the caller and is not persisted by the service.

## `POST /api/test-models/reviews`

Creates or applies review state for the supplied model.

### Request

```json
{
  "apiModel": { "operations": [] },
  "testModel": { "scenarios": [] },
  "review": {
    "workspaceRevision": 0,
    "updates": [
      {
        "scenarioId": "scenario-1",
        "revision": 0,
        "action": "accept"
      },
      {
        "scenarioId": "scenario-2",
        "revision": 0,
        "action": "reject",
        "reason": "This scenario duplicates an approved case."
      }
    ]
  }
}
```

`updates` may be empty to initialize a review workspace. Each update applies to one scenario
ID and must include the caller's observed scenario revision. `action` is `accept` or `reject`.
A rejection reason is required and must be non-empty after trimming.

### Success Response: `200 OK`

```json
{
  "review": {
    "workspaceRevision": 1,
    "scenarios": [],
    "summary": {
      "total": 2,
      "pending": 0,
      "accepted": 1,
      "rejected": 1,
      "requiresReview": 1
    }
  },
  "approvedTestModel": { "scenarios": [] },
  "outcomes": []
}
```

The response includes current review state, summary counts, update outcomes, and an approved
TestModel view. The approved view contains only scenarios eligible under the active review
policy. It never contains pending or rejected scenarios.

### Update Outcomes

An update outcome identifies `scenarioId`, whether the update was applied, the resulting
revision/state, and an optional finding. Findings include actionable categories such as:

- `scenario-not-found`
- `invalid-rejection-reason`
- `stale-revision`
- `duplicate-scenario`
- `invalid-edit`
- `policy-requires-review`

A stale or invalid update does not overwrite the current scenario. The caller must refresh the
review workspace and retry explicitly.

## `POST /api/test-models/reviews/edit`

Validates and applies a supported edit to one scenario. The request identifies the scenario and
observed revision and supplies the edited test intent. A successful edit increments the revision,
retains prior history, marks the content as user-modified, and returns the scenario as `pending`.
A failed edit leaves the current scenario unchanged.

## `POST /api/test-models/reviews/regenerate`

Requests an AI replacement for one AI-derived scenario through the existing AI provider boundary.
The request identifies the scenario and observed revision. A valid replacement increments the
revision, preserves prior history and AI provenance, and returns the replacement as `pending`.
Provider failure, timeout, malformed output, or unsupported content leaves the current scenario
and review decision unchanged with an explicit failure outcome.

## Error Responses

- **400 Bad Request** — the request shape itself is malformed (missing `apiModel`, `testModel`,
  or a required field such as `scenarioId`/`revision` on the edit and regenerate endpoints):

  ```json
  { "error": "invalid_test_scenario_review_request", "message": "..." }
  ```

- **405 Method Not Allowed** — a method other than the documented method is used.
- **409 Conflict** — on the `edit` and `regenerate` endpoints only, when the submitted revision
  is stale; the response identifies the affected scenario, its current revision, and the
  `stale-revision` finding without exposing sensitive values.

`POST /api/test-models/reviews` always returns `200 OK` for a structurally valid request, even
when one or more `updates` could not be applied (invalid rejection reason, stale revision,
duplicate scenario, scenario not found). This lets a batch of updates apply partially: each
update's outcome is reported independently in `outcomes[]`, and a failed update never overwrites
the current scenario. A caller must inspect `outcomes[].applied` and `outcomes[].finding` to
detect per-update failures rather than relying on the HTTP status code.

## Safety and Workflow Rules

- The boundary does not execute API requests.
- Accepting a scenario is a review decision, not execution authorization.
- Artifact generation consumes only an approved TestModel through its later workflow boundary.
- AI, RULE, specification, and user-modified provenance remain distinguishable.
- The service does not log or return credentials, bearer tokens, or unnecessary sensitive request
  values.
- Review state is deterministic for identical workspace state and ordered updates.
- Concurrent or stale updates are surfaced rather than silently overwritten.
