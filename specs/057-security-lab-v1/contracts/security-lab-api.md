# Contract: Security Lab HTTP API (v1)

**Status**: new public interface. **Spec**: FR-003 to FR-004, FR-028 to FR-065. All routes are under `/api/security-lab`, are scoped by the
existing session cookie and the owner cookie below (no id in the URL, header or body), return JSON unless stated, and are served by one thin router
(`backend/src/api/securityLab.ts`) that delegates to `securityLab/securityLabService.ts`. Routes validate and adapt input,
call the service, and map typed errors; they hold no domain logic (CLAUDE.md §22).

Common rules: bodies are bounded by the existing JSON limit; every list endpoint is paginated (`page`, `pageSize`, max 100)
and returns `total`; every error body is `{ "error": "<snake_code>", "message": "<safe text>", ...details }` with no stack, path or
secret (CLAUDE.md §24).

**Two identities.** The router sits behind the session middleware (session data: profiles, evidence) and a Security Lab owner
middleware that reads or issues the `apipilotOwner` cookie (retained work: scenarios, runs, results, findings, settings; research R22).
Neither id appears in a URL, header or body.

**Specification dependence (FR-004).** Routes marked **M** need a loaded specification and return `409 no_specification` without
one: `GET /analysis`, `GET /scope`, `POST /scenarios/generate`, `POST /scenarios/suggest`, `PATCH /scenarios/:id`, `POST /scenarios/review`
(approve, submit and reopen only), `POST /runs/preview`, `POST /runs`, `GET /export/postman`. Every other route reads retained work
and works without one; scenario responses then carry `specificationNotLoaded: true` and no `stale` or `orphaned` flags.

## Analysis and registry

| Method and path | Purpose | Success | Notes |
|---|---|---|---|
| `GET /categories` | The registry: id, name, support level, executable, prerequisites, taxonomy edition and ids with relation | 200 `{ edition, categories[] }` | Static. |
| `GET /analysis` | The current `SecurityAnalysis` | 200 | Recomputed from the loaded model; deterministic. `?configuredSensitiveFields=a,b` is **not** accepted; configured names come from a stored setting (below). |
| `GET /settings` · `PUT /settings` | User-configured sensitive field names (recorded as `user-configured`) | 200 | Names only, validated, max 100 entries. Retained (owner-scoped). |
| `GET /scope` **M** | Default generation scope: `{ mode: "selection" \| "all", selectedCount, totalCount }` | 200 | `mode` is `all` when the guided workflow made no selection. Analysis and Overview ignore it. |

## Scenarios

| Method and path | Purpose | Success | Errors |
|---|---|---|---|
| `POST /scenarios/generate` **M** | Deterministic generation for the loaded model. Body `{ scope?: { mode: "selection" \| "all" \| "custom"; operationKeys?: string[] }; categories?: string[]; profileId?: string }`. `scope` defaults to `selection` (research R23) | 200 `{ scope: { mode, included, excluded }, generated, kept, newVersions, rejected[], skippedByCategory[] }` | `400 invalid_request`, `400 category_not_generatable`, `409 retention_limit_reached` |
| `GET /scenarios` | List. Query: `q`, `operation`, `category`, `severity`, `reviewState`, `executionStatus`, `flag` (`stale|orphaned|blocked|executable`), `profileId` (to derive prerequisites), `page`, `pageSize` | 200 `{ items[], total, counts }` | |
| `GET /scenarios/ids` | The ids and current versions matching the same filters, no pagination, capped at 5000 | 200 `{ items: {id, version}[], total, capped }` | Used by the UI to show and pass an explicit batch. |
| `GET /scenarios/:id` | Detail: current version, all versions with approval records, derived flags and prerequisites, results summary | 200 | `404 scenario_not_found` |
| `PATCH /scenarios/:id` | Edit. Body `{ expectedVersion, changes: {...}, note? }` | 200 `{ scenario, newVersion, material }` | `409 stale_version`, `422 scenario_invalid` (with `violations[]` as JSON pointers), `409 scenario_rejected` |
| `POST /scenarios/review` | Batch or single review. Body `{ action: "submit"|"approve"|"reject"|"reopen"|"withdraw", items: {id, version}[], reason?, destructiveConfirmations?: string[] }` | 200 `{ applied[], refused[] }` per item with a reason code | `400 invalid_request`; per-item `stale_version`, `invalid_transition`, `destructive_confirmation_required`, `not_executable_content` |
| `POST /scenarios/suggest` | AI suggestions (optional). Body `{ operationKeys?: string[]; categories?: string[] }` | 200 `{ accepted[], rejected[{reason}] }` | `503 ai_unavailable` with the readiness reason; nothing else degrades |

`items` must be explicit `{id, version}` pairs; a filter is never accepted by the server (FR-031). `reject` requires a non-empty `reason`.
`approve` refuses a destructive scenario unless its id is in `destructiveConfirmations`; the UI lists each one by operation.

## Profiles

| Method and path | Purpose | Success | Errors |
|---|---|---|---|
| `GET /profiles` | List with derived `valid` and `problems[]` | 200 | |
| `POST /profiles` · `PUT /profiles/:id` | Create or replace. Body is `SecurityProfile` input (no secret values; an identity names its schemes) | 201 / 200 | `422 profile_invalid` with `violations[]` (for example `production_tier_refused`, `base_url_not_allowed`, `address_range_not_permitted_for_tier`, `limit_above_ceiling`, `unknown_security_scheme`, `test_data_looks_secret`) |
| `DELETE /profiles/:id` | Delete | 204 | `409 profile_in_use` while a run uses it |
| `POST /profiles/:id/check` | Dry validation: re-validate the stored profile and resolve the base URL under the destination policy **without sending a request** | 200 `{ valid, problems[], destination: { host, port, resolvedClass } }` | Resolving DNS is allowed; connecting is not. |

| `PUT /profiles/:id/credentials` | Write-only. Body `{ identity, scheme, kind: "active" | "expired", value }`; an empty `value` clears it | 204 | `404 profile_not_found`, `422 profile_invalid` (unknown identity or scheme), `400 invalid_request` |
| `GET /profiles/:id/credentials` | Which credentials are set: `{ credentialStatus: { identity, scheme, kind, set }[] }`. **Never a value** | 200 | `404 profile_not_found` |

Credential values are accepted only by `PUT /profiles/:id/credentials`, are encrypted at rest, are never returned by any route, log line, evidence record, finding, report or export, and are removed with the session (FR-048, research R8).

### Target environments

A profile's target is an ordinary environment, created and edited through thin Security Lab routes that carry **only** `name`, `tier` and `baseUrl` (never `variableValues`):

| Method and path | Purpose | Success | Errors |
|---|---|---|---|
| `GET /environments` | The session's environments as `{ id, name, tier, baseUrl }[]` | 200 | |
| `POST /environments` · `PUT /environments/:id` | Create or replace one. Body `{ name, tier, baseUrl }` | 200 `{ environment }` | `400 invalid_request`, `409 duplicate_environment_name`, `404 environment_not_found` |

They write the same session-scoped environment store as the rest of the product and leave `requireEnvironmentAccess()` and every existing environment route unchanged.

## Runs

| Method and path | Purpose | Success | Errors |
|---|---|---|---|
| `POST /runs/preview` | Body `{ profileId, items: {id, version}[], limits?: { maxRequests?, maxConcurrency?, timeoutMs? } }`. Validates everything a run would, **sends nothing** | 200 `{ summary, planDigest, problems[] }` | `422 run_plan_invalid` (the same codes as the run, with each blocked item and reason) |
| `POST /runs` | Start. Body `{ planDigest, confirmation: { targetName, targetBaseUrl, authorizationAttested: true, destructiveScenarioIds: string[] } }` plus the preview's `profileId`, `items`, `limits` | 202 `{ run }` | `400 invalid_request`, `409 execution_in_progress`, `409 plan_changed` (digest mismatch), `409 confirmation_required` (with what is missing), `422 run_plan_invalid` |
| `GET /runs` | Summaries, newest first | 200 | |
| `GET /runs/:id` | Run with progress counters, per scenario outcomes (each with its observed summary) and cleanup results; `?evidence=true&scenarioId=…` adds the redacted evidence for that scenario | 200 `{ run, evidence?: { available: boolean, records[] } }` | `404 run_not_found`. When the session has expired, `evidence.available` is `false` and `records` is empty. |
| `POST /runs/:id/cancel` | Request cancellation | 202 | `409 no_run_in_progress` |

`summary` in the preview names the profile, tier, base URL, scenario count, planned request count, every destructive scenario
(operation and method), the distinct hosts and ports that will be contacted, the limits, the TLS policy, and the fixed
statement "real requests will be sent to this target". `planDigest` is a hash of the profile snapshot, the ordered
`{id, version}` list and the limits; a start whose digest differs from a fresh recomputation is refused with
`409 plan_changed`, so the executed plan is the confirmed plan (FR-042). Staging-like tiers additionally require
`targetName` and `targetBaseUrl` to equal the profile's values exactly and `authorizationAttested` to be `true`; local tier
requires only the digest and `authorizationAttested`.

A run is never started by any other route, on a schedule, or as a retry (FR-042). The run response never contains a secret.

## Findings, overview, reports, export

| Method and path | Purpose | Success | Errors |
|---|---|---|---|
| `GET /findings` | Filter by `severity`, `status`, `category`, `operation`, `runId`, `assessment`, `unreviewed=true`; paginated. One row per scenario version, with `occurrenceCount` | 200 | |
| `GET /findings/:id` | The finding, its occurrences (each with its observed summary and `evidenceAvailable`), links (`scenario`, `run`, `specElementPointer`, `supersedes`) | 200 | `404 finding_not_found` |
| `GET /findings/:id/occurrences/:resultId/evidence` | The redacted evidence for one occurrence | 200 `{ available, records[] }` | `404`; `available: false` once the session has expired |
| `PATCH /findings/:id` | Body `{ status?, severity?, acknowledgeOccurrences?: true, note }`; `note` required when changing status or severity | 200 | `422 invalid_finding_update`, `404` |

Findings are created and extended only by the run service, never by a route (FR-054): a `failed` result creates the finding for its
scenario version or appends an occurrence; the reopening and `unreviewedOccurrence` rules are in
[evaluation-and-findings-rules.md](evaluation-and-findings-rules.md).

## Retained data management

| Method and path | Purpose | Success | Errors |
|---|---|---|---|
| `GET /data` | Counts of retained work and session data for this owner, per assessment (`assessmentKey`, `assessmentLabel`, scenarios, runs, findings), the retention caps, and which data is removed with the session | 200 | |
| `DELETE /assessments/:assessmentKey` | Hard-delete one assessment's retained work in one transaction. Body `{ confirm: "<assessmentLabel>" }` | 204 | `409 execution_in_progress` if one of its runs is in progress; `404 assessment_not_found`; `422 confirmation_mismatch` |
| `DELETE /data` | Hard-delete all of this owner's retained work and session data. Body `{ confirm: "DELETE ALL" }` | 204 | `409 execution_in_progress`; `422 confirmation_mismatch` |
| `GET /overview` | `SecurityOverview` | 200 | Every count has a matching list filter. |
| `GET /report?format=html|json&runIds=…` | `SecurityReport`; html is a self-contained attachment | 200 | Headers `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` as the coverage report. `409 nothing_to_report` |
| `GET /export/postman` | Collection and environment template for approved scenarios at their approved versions, delivered the way the existing Postman export is | 200 | `409 no_approved_scenarios`, `422 export_failed` with the generator's code |

## Typed error codes

`no_specification`, `invalid_request`, `category_not_generatable`, `scenario_not_found`, `stale_version`, `scenario_invalid`,
`scenario_rejected`, `invalid_transition`, `destructive_confirmation_required`, `not_executable_content`, `profile_invalid`,
`profile_in_use`, `run_plan_invalid`, `plan_changed`, `confirmation_required`, `execution_in_progress`, `no_run_in_progress`,
`run_not_found`, `finding_not_found`, `invalid_finding_update`, `ai_unavailable`, `nothing_to_report`, `no_approved_scenarios`,
`export_failed`, `retention_limit_reached`, `assessment_not_found`, `confirmation_mismatch`. Unexpected failures map to `500 internal_server_error` with a category-only server log.

## Compatibility

Additive. No existing route, request or response changes, and `requireEnvironmentAccess()` is untouched (revised during implementation, research R8). The one
observable effect on an existing route is the execution slot: a Security Lab run makes `execution/start` return `409 execution_in_progress`, as other run
kinds already do. The `apipilotOwner` cookie is set only by responses from `/api/security-lab` routes; no other route sees
or sets it.
