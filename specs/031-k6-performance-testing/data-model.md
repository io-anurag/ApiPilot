# Data Model: k6 Performance Testing (AP-029)

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

The types below go in `packages/shared-domain/src/performance.ts` and are exported from the
package index. They are framework-agnostic and contain no k6 syntax (constitution VIII, X).
k6-specific structures, such as the rendered script, CLI arguments and the metrics line format,
stay inside `backend/src/performance/k6/`.

## Plan (held in guided-workflow state, not persisted; spec Assumptions)

### `PerformancePlan`

| Field | Type | Rule |
|---|---|---|
| `scope` | `"selection" \| "all"` | FR-001. `selection` uses `selectedOperationKeys`; `all` uses every analyzed operation. |
| `excludedOperationKeys` | `string[]` | Operations the user removed (FR-004), sorted. |
| `omitted` | `OmittedOperation[]` | In scope but left out: `{operationKey, reason: "no-positive-scenario"}` (FR-005). |
| `journeys` | `PerformanceJourney[]` | In the user's order (FR-006, FR-007). |
| `thinkTimeMs` | `number` | 0 or more, 0 by default (FR-008). |
| `loadProfile` | `LoadProfile` | FR-017. |
| `thresholds` | `PerformanceThreshold[]` | Empty by default. Set by the user only (FR-018). |
| `userSuppliedValues` | `UserSuppliedValueRequirement[]` | FR-013, sorted by name. |
| `uniqueValueFields` | `UniqueValueField[]` | FR-016, D13. |
| `fingerprint` | `string` | SHA-256 over the canonical JSON of every field above, including each step's expected statuses, plus the ids of the scenarios and workflows used. It is the out-of-date check (FR-023). |
| `stepsNeedingExpectedStatus` | `string[]` | Derived, not part of the fingerprint: the ids of steps whose `expectedStatuses` is empty, in plan order. Script generation is refused while it is non-empty (FR-012a, D26). |

### `PerformanceJourney`

| Field | Type | Rule |
|---|---|---|
| `id` | `string` | Content-derived: from the workflow id, or `op:<operationKey>`. |
| `source` | `{kind: "workflow", workflowId} \| {kind: "operation"}` | D5. |
| `steps` | `PerformanceStep[]` | In order. The reorder rule is in D5. |

### `PerformanceStep`

| Field | Type | Rule |
|---|---|---|
| `id` | `string` | Content-derived, from the journey id and operation key (`identifiers.ts` style). It is also the `step` metrics tag. |
| `operationKey` | `string` | `"METHOD /path"`. The path is the template, never a resolved URL (FR-040). |
| `method` | `HttpMethod` | Shown in the plan (FR-004). |
| `scenarioId` | `string` | The chosen positive scenario (FR-002). |
| `scenarioChoice` | `"rule-generated" \| "only-positive" \| "ai-enhanced-no-rule-alternative"` | Plus `tieBrokenByLowestId: boolean` (FR-003, D4). |
| `consumes` / `produces` | `string[]` | Workflow variable names. |
| `dependency` | `{relationshipIds: string[], confidence: "CONFIRMED" \| "LIKELY"} \| null` | Why the step is in the journey (FR-039). |
| `expectedStatuses` | `ExpectedStatus[]` | FR-012, D26. Pre-filled with the operation's documented 2xx codes and `2XX` range, in code-unit order. Empty only when none is documented and the user has not set one yet. |
| `auth` | `StepAuth` | The method name and producer kind (`oauth2-client-credentials`, `chained-login`, `static-credential`, `none`), plus the scheme name. Never a value. |
| `requiredValues` | `string[]` | The names of the user-supplied values this step needs. |

### `ExpectedStatus`

`{code: string, source: "specification" | "user"}`. `code` is an exact code (`^[1-5]\d\d$`) or a
range (`^[1-5]XX$`). `source` is `specification` when the code is in the step's pre-fill set and
`user` otherwise. The server computes it and never accepts it from the client (FR-039, D26).

### `LoadProfile`

| Field | Type | Rule |
|---|---|---|
| `kind` | `"smoke" \| "load" \| "stress" \| "spike" \| "soak"` | |
| `stages` | `{durationMs: number, targetVirtualUsers: number}[]` | At least 1 stage. Durations over 0, and targets of 0 or more. No maximum and no warning (FR-019). |
| `plannedDurationMs` | `number` | Derived: the sum of stage durations. |

The starting stages are editable, and are not recommendations (spec Assumptions):

| Profile | Starting stages (duration → target virtual users) |
|---|---|
| smoke | 1 min → 1 |
| load | 2 min → 10, 5 min → 10, 1 min → 0 |
| stress | 2 min → 20, 5 min → 20, 2 min → 40, 5 min → 40, 2 min → 0 |
| spike | 1 min → 5, 30 s → 50, 1 min → 50, 30 s → 5, 1 min → 5, 30 s → 0 |
| soak | 5 min → 10, 60 min → 10, 5 min → 0 |

### `PerformanceThreshold`

`{id, scope: {kind: "run"} | {kind: "step", stepId}, metric: "p50" | "p90" | "p95" | "p99" |
"error-rate", comparator: "<=" , limit: number}`. Latency limits are in ms and error-rate limits in
percent, 0 to 100. The `id` is content-derived.

### `UserSuppliedValueRequirement`

`{name, secret: boolean, neededBySteps: string[], source: "path-parameter" | "credential" |
"oauth2-client" | "base-url"}`. The value itself is the target environment's
`variableValues[name]` (clarification 2026-09-24). Presence is computed per environment and
returned as `UserSuppliedValueStatus = requirement & {present: boolean}`. The value is never
returned.

### `UniqueValueField`

`{stepId, location: "body", fieldPath: string, format: "email" | "uuid"}`.

### Generated script (backend workflow state only; not a shared type)

`{planFingerprint, scriptSha256, environmentTemplateSha256, script: string,
environmentTemplate: string, stepCount}`. The script is stale when `planFingerprint` differs from
the current plan's fingerprint. The stage also becomes stale through `staleness.ts` when upstream
approvals change.

## Readiness

### `K6Readiness`

`{state: "ready", version: string, checkedAt} | {state: "unavailable", reason: K6UnavailableReason,
detail?: string, checkedAt}`, where `K6UnavailableReason = "not-found" | "not-executable" |
"version-unreadable" | "unsupported-version"`. `detail` carries, for example, `found 0.49.0, need
≥ 1.0.0`. It never carries the binary's path.

## Runs (persisted; table `performance_runs`, D20)

### `PerformanceRun`

| Field | Type | Rule |
|---|---|---|
| `id` | `string` | A random UUID, as with the other run tables. |
| `status` | `"in-progress" \| "completed" \| "cancelled" \| "failed"` | See the transitions below. |
| `cancelReason` | `"user-requested" \| "backend-restart"` | Only when `cancelled`. |
| `failure` | `{category: "k6-unavailable" \| "script-integrity-failed" \| "k6-exited-with-error" \| "metrics-unreadable"}` | Only when `failed`. Metadata only. |
| `environment` | `{id, name, tier, baseUrl}` | A snapshot. No `variableValues` (FR-025, FR-039). |
| `planSnapshot` | `PerformancePlan` | It holds no values. |
| `scriptSha256` | `string` | Identifies exactly what ran (FR-026). |
| `k6Version` | `string` | FR-039. |
| `plannedDurationMs` | `number` | |
| `startedAt` / `endedAt` | ISO string | |
| `cancelRequested` | `boolean` | |
| `progress` | `{elapsedMs, currentVirtualUsers, requestsSoFar}` | While in progress (FR-030). |
| `result` | `PerformanceResult` | Written at settle, and at checkpoints so that partial results survive a cancel. |

State transitions:

```text
in-progress ──(k6 exits 0 after its last stage)──────────────────▶ completed
in-progress ──(user cancel)──────────────────────────────────────▶ cancelled (user-requested)
in-progress ──(backend restart found it in progress)─────────────▶ cancelled (backend-restart)
in-progress ──(k6 missing at spawn, integrity mismatch,
               non-zero exit without results, unreadable stream)──▶ failed
```

There is no transition back to `in-progress`, and nothing re-runs a run (FR-024, FR-032).

### `PerformanceResult`

| Field | Type | Rule |
|---|---|---|
| `totals` | `{requests, errors, errorRatePercent, iterations, journeysCutShort, throughputPerSecond}` | Throughput is requests divided by the actual run duration. `errors` counts failures as defined in D14. `iterations` is k6's completed iterations, each running every journey once (D25). |
| `journeys` | `JourneyResult[]` | In plan order (FR-036). |
| `steps` | `StepResult[]` | In plan order. |
| `timeline` | `{bucketMs, points: {offsetMs, virtualUsers, requests, errors, p95Ms}[]}` | Bucket size from D11. |
| `writeRequests` | `{operationKey, method, sent, succeeded}[]` | FR-036a, for POST, PUT, PATCH and DELETE only. |
| `tokenRefreshes` | `{count, failed, lifetimeStated: boolean, bucketOffsetsMs: number[]}` | FR-015, D12. |
| `thresholdOutcomes` | `{thresholdId, measured, passed: boolean}[]` | Empty with no thresholds (FR-037). |
| `findings` | `PerformanceFinding[]` | D16. |
| `findingsRulesetVersion` | `number` | 1. |
| `latencyPrecision` | `"within-1-percent"` | D11. |

### `JourneyResult`

`{journeyId, requests, latencyMs: {p50, p90, p95, p99}, throughputPerSecond, errorRatePercent,
checkPassRatePercent, runsCutShort}`. The latency percentiles are over every request sent by the
journey's steps. `runsCutShort` counts this journey's runs cut short by a failed extraction (D25).

### `StepResult`

`{stepId, operationKey, method, expectedStatuses: ExpectedStatus[], requests, latencyMs: {p50, p90,
p95, p99}, throughputPerSecond, errorRatePercent, errorsByStatus: {status: string, count}[],
errorsByCategory: {category: FailureCategory, count}[], checkPassRatePercent, notAttempted:
{missingData: number, dependencyNotAttempted: number}, missingVariables: string[]}`.

`errorsByStatus` counts only failures: statuses outside `expectedStatuses`, with `"0"` for no
response (FR-012a).

`FailureCategory = "unexpected-status" | "connection-error" | "timeout" | "extraction-failed" |
"missing-data" | "dependency-not-attempted" | "authentication" | "rate-limited"` (D14). A
response whose status is among the step's expected codes is never categorized, including 401,
403 or 429.

### `PerformanceFinding`

`{ruleId: "threshold-failed" | "slowest-step" | "failures-start" | "cut-short-journeys" |
"missing-data" | "rate-limited" | "authentication-after-expiry" | "connection-errors" |
"refreshes", stepIds: string[], message: string, values: Record<string, number | string>}`. The
message is fixed text built from `values`, so the same data gives the same findings (FR-038).

## Workflow state additions (`TestGenerationWorkflow`)

- `stages.performanceTesting`: a new `WorkflowStageState`. It is optional and may be `skipped`,
  and it is available once `workflowReview` is `completed` (D1).
- `performancePlan?: PerformancePlan`.
- The generated script, backend-only: the frontend receives `{planFingerprint, scriptSha256,
  stepCount, outOfDate: boolean}` and never the script text, except through the download route.

## Validation rules (all enforced on the server)

- Stage durations over 0, virtual-user targets of 0 or more, at least one stage, `thinkTimeMs` of 0
  or more. Otherwise `400 invalid_load_profile`.
- Threshold limits: over 0 for latency, 0 to 100 for error rate. A step-scoped threshold's
  `stepId` must exist. Otherwise `400 invalid_threshold`.
- A reorder must keep every producer before its consumers. Otherwise `400
  dependency_order_violation`, with the variable name (FR-007).
- The step order within a journey must be a permutation of the same steps. Otherwise `400
  invalid_order`.
- An expected-status update must name existing steps, and each list must be non-empty and contain
  only exact codes (`^[1-5]\d\d$`) or ranges (`^[1-5]XX$`). Otherwise `400
  invalid_expected_status`. Duplicates are removed and codes sorted in code-unit order (D26).
- Script generation needs `stepsNeedingExpectedStatus` to be empty. Otherwise `422
  expected_status_missing`, with the step ids (FR-012a).
