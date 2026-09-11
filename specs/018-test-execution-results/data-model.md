# Phase 1 Data Model: Test Execution & Results

New types live in `packages/shared-domain/src/execution.ts` (framework-agnostic, per constitution
VIII/X), re-exported from `packages/shared-domain/src/index.ts`. Nothing here changes
`TestGenerationWorkflow`'s existing shape (research.md D3); an `ExecutionRun` references its
originating workflow by id rather than being embedded in it.

## `EnvironmentTier`

```ts
export type EnvironmentTier = "local" | "dev" | "qa" | "staging" | "production";
```

`"staging"` and `"production"` are the two tiers FR-007's additional confirmation step applies to
(spec.md).

## `Environment`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Session-scoped identifier (`crypto.randomUUID()`), assigned on creation. |
| `name` | `string` | User-supplied, unique within the session (FR-001, FR-003 — the selection UI needs a distinguishable label). |
| `tier` | `EnvironmentTier` | FR-002. |
| `baseUrl` | `string` | Substituted for the collection's `{{baseUrl}}` variable. |
| `variableValues` | `Record<string, string>` | Every other value the collection's declared variables need (FR-001), keyed by the same variable names `generateCollection()`'s `options.variableValues` already accepts — including credential-like values (FR-005), retained in memory for the session per the resolved clarification. |
| `requestDelayMs` | `number` | FR-011; `0` (no pause) by default. Applies to every run started against this environment. |

Retained only for the current session's lifetime (research.md D3's store; no durable
persistence), matching `specs/017-session-workflow-isolation`'s existing model.

## `ExecutionRunStatus`

```ts
export type ExecutionRunStatus = "in-progress" | "completed" | "cancelled";
```

There is no stored `"not-started"` value: a run record is only created once execution actually
starts (FR-006). "Not yet started" is the absence of a current run, observable at the workflow
level without a dedicated status value.

## `NotAttemptedReason` / `FailureCategory`

```ts
export type NotAttemptedReason = "cancelled" | "dependency-not-met" | "run-ended-before-reached";

export type FailureCategory =
  | "assertion-failed"
  | "unexpected-status"
  | "connectivity-failure"
  | "timeout"
  | "could-not-evaluate";
```

Kept as two separate small unions rather than one: a `not-attempted` request was never sent (no
failure occurred to categorize), while a `FailureCategory` always describes a request that *was*
sent and did not pass (FR-012). `"run-ended-before-reached"` is the defensive fallback for any
request the loop never reaches for a reason other than an explicit cancellation (constitution
XIX — Fail Safely: every request gets an explicit, named outcome, never an unlabeled gap).

## `AssertionOutcome`

| Field | Type | Notes |
|---|---|---|
| `assertionIndex` | `number` | Position within the originating `TestScenario.assertions` array. |
| `type` | `Assertion["type"]` | `"status-code" \| "schema-conformance"`, reused from `testModel.ts` — no new assertion vocabulary. |
| `outcome` | `"passed" \| "failed" \| "could-not-evaluate"` | Per research.md D5. |
| `detail` | `string?` | Non-sensitive summary only (e.g. "expected status 201, got 500"; "response was not valid JSON") — never a raw response body (FR-017, constitution XX). |

## `RequestResult`

| Field | Type | Notes |
|---|---|---|
| `scenarioId` | `string` | Ties back to the originating `TestScenario.id` (FR-016). |
| `operationPath` / `operationMethod` | `string` | Locates it in the original collection (FR-016). |
| `outcome` | `"passed" \| "failed" \| "not-attempted"` | |
| `failureCategory` | `FailureCategory?` | Present only when `outcome === "failed"`. |
| `notAttemptedReason` | `NotAttemptedReason?` | Present only when `outcome === "not-attempted"`. |
| `startedAt` | `string` (ISO 8601) | |
| `durationMs` | `number` | `0` for `not-attempted`. |
| `responseStatusCode` | `number?` | Absent for `not-attempted` and for `connectivity-failure`/`timeout` (no response was received). |
| `assertionOutcomes` | `AssertionOutcome[]` | Empty for `not-attempted`. |

Deliberately excludes raw request/response bodies and header values (FR-017); a future
diagnostics enhancement that needs them must add explicit, separately-gated opt-in fields rather
than default to including them.

## `ExecutionRunSummary`

| Field | Type |
|---|---|
| `total` | `number` |
| `passed` | `number` |
| `failed` | `number` |
| `notAttempted` | `number` |
| `durationMs` | `number` |

Recomputed from `ExecutionRun.results` whenever it changes; not an independently-mutable field.

## `ExecutionRun`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `crypto.randomUUID()`. |
| `workflowId` | `string` | The originating `TestGenerationWorkflow.id`, for traceability (constitution XIII) — not a live reference, since the workflow's own `approvedTestModel` must not be able to retroactively change an already-recorded run. |
| `environmentId` | `string` | |
| `environmentSnapshot` | `Pick<Environment, "name" \| "tier" \| "baseUrl">` | Captured at start time (FR-018/FR-020: a run must remain meaningful even if the `Environment` it targeted is later edited). Excludes `variableValues`/credentials — never persisted into a run record (FR-017). |
| `status` | `ExecutionRunStatus` | |
| `startedAt` / `completedAt` | `string` (ISO 8601) | `completedAt` absent while `status === "in-progress"`. |
| `summary` | `ExecutionRunSummary` | |
| `results` | `RequestResult[]` | Appended to in execution order as each item settles; a client polling mid-run sees a growing prefix (FR-013/FR-014's "in-progress must be visible" is satisfied by this array's length and the `status` field together). |

## Lifecycle

```text
(no run for this collection+environment)
   │ POST .../execution/start (FR-006/007/008 all satisfied)
   ▼
{ status: "in-progress", results: [] }
   │ each item in workflowRendering.ts's ordered list settles in turn (research.md D2)
   │ (pacing delay before each item per Environment.requestDelayMs; cancellation flag
   │  checked before each item; results appended as they settle)
   ├─────────────────────────────┐
   │ every item reached a         │ POST .../execution/cancel while items remain
   │ terminal outcome              │
   ▼                              ▼
{ status: "completed",     { status: "cancelled",
  completedAt: now }         completedAt: now,
                              results: [...settled, ...not-attempted/"cancelled"] }
```

A cancelled or completed run is retained, unmodified, for the rest of the session (FR-019/
FR-020); starting a new run against the same collection+environment creates a new `ExecutionRun`
with a new `id`, never mutating a previous one.

## Confirmation requirement (not a stored entity — a response shape)

```ts
export interface ExecutionConfirmationRequirement {
  environmentTier: EnvironmentTier;
  destructiveOperations: Array<{ operationPath: string; operationMethod: string }>;
}
```

Computed on demand from the selected `Environment.tier` and the approved `TestModel`'s
operations (any `POST`/`PUT`/`PATCH`/`DELETE`, per spec.md's Assumptions) — never stored; see
contracts/execution-api.md for how `POST .../execution/start` surfaces this (FR-007).
