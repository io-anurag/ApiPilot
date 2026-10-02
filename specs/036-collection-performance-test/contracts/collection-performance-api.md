# Contract: Collection Performance Test API (AP-036)

Every path is under `/api`. The session comes from the existing session cookie. Every collection id is
looked up in the caller's session, so another session's id answers `404 uploaded_collection_not_found` (AP-026).
Error bodies use the existing `{ error, message }` shape from `performanceHttp.ts`. `R` references point
to [research.md](../research.md).

## Route family

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/collection-performance` | Build the session's collection plan (new). |
| `GET` | `/collection-performance` | Read it (new). |
| `POST` | `/collection-performance/rebuild` | Rebuild from the collection's current content (new). |
| `POST` | `/collection-performance/environment` | New environment from this collection (new, R17). |
| AP-029 routes | `/collection-performance/plan`, `/plan/reset`, `/plan/values`, `/plan/steps/:stepId/request`, `/plan/removed-operation`, `/plan/response-fields`, `/script`, `/script/download`, `/readiness`, `/runs`, `/runs/:runId`, `/runs/:runId/cancel`, `/runs/:runId/report` | Registered by `registerPerformanceRoutes` for the `collection` source. Their behaviour is AP-029's, except as stated below. |

With no collection plan in the session, every route except `POST /collection-performance` answers
`404 collection_plan_not_found`.

## `POST /collection-performance`

Request:

```json
{ "collectionId": "…", "orderedRequestIds": ["item-1", "item-2"], "replaceExisting": false }
```

- `orderedRequestIds` is required. Use the run panel's ordered selection (R18).

| Status | `error` | When |
|---|---|---|
| 200 | | `{ collectionTest: CollectionPerformanceTestView }` |
| 400 | `invalid_request` | The body is not of the shape above. |
| 400 | `invalid_run_order`, `no_requests_selected` | `resolveRunOrder` refused the ids (AP-026). |
| 404 | `uploaded_collection_not_found` | |
| 409 | `collection_plan_exists` | A plan exists and `replaceExisting` is not `true`. |
| 422 | `too_many_requests` | More than 100 ids. `message` names the count. |

Building never runs a script and never sends a request (FR-005). A plan whose every request is left
out is still built. It has no steps, and `POST /script` refuses it with AP-029's existing
`nothing_to_test` error.

```ts
interface CollectionPerformanceTestView {
  collection: { id: string; name: string; tier: EnvironmentTier;
                state: "current" | "changed" | "deleted" };
  plan: PerformancePlan;          // source "collection", plan.collection set
  script: ScriptStatus | null;
}
```

## `GET /collection-performance`

`200 { collectionTest: CollectionPerformanceTestView }`. `collection.state` is recomputed on every
read (R13).

## `POST /collection-performance/rebuild`

There is no body.
- `200 { collectionTest, notKept: { stepId; itemId; name; settings: ("expected-statuses" |
  "captures" | "bindings")[] }[], droppedRequestIds: string[] }`.
- `409 collection_deleted` when the collection no longer exists.

Rebuilding resets the review (R14), keeps the R13 settings, and marks the script out of date when the
fingerprint changes.

## `POST /collection-performance/environment`

Request: `{ "name": "perf from APIFoundry" }`.

| Status | `error` | When |
|---|---|---|
| 201 | | `{ environment: { id: string; name: string } }`. No values in the response. |
| 400 | `invalid_request` | Missing or empty name. |
| 409 | `duplicate_environment_name` | Existing environments rule. |
| 409 | `collection_deleted` | |
| 422 | `base_url_missing` | The base-URL variable has no resolved value, or the plan has no base-URL variable. |

## Changes to the shared routes for this source

- **`GET /plan`** returns the plan with `plan.collection` set. `collectionState` and
  `review.reviewed` are derived on read.
- **`PUT /plan`** accepts:
  - `excludedRequestIds: string[]`;
  - `stepOrder`, `expectedStatuses` (keys may be step ids or credential-request ids), `thinkTimeMs`,
    `loadProfile` and `thresholds`, as AP-029;
  - `addedCaptures: { [stepId]: Capture[] }` and `addedBindings: { [stepId]: { name, captureStepId,
    captureName }[] }`, each a full replacement (FR-019);
  - `conversionReviewed: true` (R14).

  It refuses with `400 not_supported_for_collection_plan`, naming the field: `bodyEdits`,
  `parameterEdits`, `userJourneys`, `nextUserJourneyNumber`, `journeyOrder`, `editProposedJourney`,
  `revertProposedJourney`, `alsoStandalone` and `excludedOperationKeys`.

  It refuses an invalid added capture or binding with AP-035's existing codes and statuses:
  `capture_name_invalid`, `capture_name_taken`, `capture_path_invalid`, `capture_header_invalid`,
  `too_many_captures`, `binding_capture_unknown` (also for a capture that is not on an earlier step)
  and `capture_in_use`. It refuses a step order that places a binding before its capture with
  AP-029's existing `dependency_order_violation`, naming the value.
- **`POST /plan/reset`** rebuilds the plan with default settings from the plan's current
  `orderedRequestIds`, and keeps `addedCaptures` and `addedBindings`, as AP-035 keeps user journeys.
  It resets the review.
- **`GET /plan/steps/:stepId/request`** returns a `StepRequestPreview` for a step or a credential
  request:
  - `pathTemplate` is the path, and `parameters` lists the URL query parameters and headers, with
    values shown as `template` or reference values;
  - `auth` uses `collection-auth`;
  - `body` is the body with references;
  - `bodyEdit` and `parameterEdit` are `null`;
  - generated values appear as `generated-value` references, and secrets are never shown.
- **`GET /plan/removed-operation?operationKey=<itemId>`**: for a collection plan the key is an item id.
  It returns the step the request would be if restored.
- **`GET /plan/response-fields`** answers `404 not_applicable` for a collection plan, because there is
  no specification. The capture editor then accepts typed paths with "Not documented in a
  specification".
- **`POST /script`** additionally refuses:
  - `409 collection_plan_out_of_date` with `{state}`;
  - `409 conversion_not_reviewed`;
  - AP-029's `422 expected_status_missing`, which now also names credential requests that lack an
    expected status.
- **`POST /runs`** additionally refuses `409 collection_plan_out_of_date`. Everything else is AP-029's:
  the trigger names the environment, and the one-run slot is shared.
- **`GET /runs`** lists runs with `planSource = "collection"`.

## Environments gate

`requireEnvironmentAccess` also passes when `hasCollectionPlan()` is true (R17).

## Logging

Request logs keep the existing fields: route, status, duration and error code. The collection
routes add only `collectionPlanSteps`, `leftOutCount`, `findingCount` and `credentialRequestCount`
on build and rebuild. Logs never contain collection names, request names, URLs, variable names,
script text, excerpts or values (R16, FR-026).
