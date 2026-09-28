# Data Model: Quick Performance Test from a Specification (AP-032)

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

AP-032 adds no new plan, run or result entity. A quick plan is an AP-029 `PerformancePlan`
([specs/031 data-model.md](../031-k6-performance-testing/data-model.md)) with a different source.
This document lists only what changes or is added. Shared types live in
`packages/shared-domain/src/performance.ts` and stay framework- and k6-agnostic
(constitution VIII, X).

## Changes to existing shared types

### `PerformancePlan`

| Change | Field | Type | Rule |
|---|---|---|---|
| Removed | `scope` | `"selection" \| "all"` | FR-022. The operations in scope are the guided workflow's selection, or every operation when there is none; a quick plan always has every operation (research Q7). `PerformanceScope` is removed. |
| Added | `source` | `"guided" \| "quick"` | Where the plan was built (FR-013, spec Key Entities). Part of the fingerprint. Snapshots recorded before AP-032 have none and are read as `guided`. |
| Added | `credentialProducerOperationKeys` | `string[]` | Derived, excluded from the fingerprint like `stepsNeedingExpectedStatus`. The operation keys of the login operations the plan's chained-login token sources call, sorted in code-unit order (FR-003a, research Q5). Empty when the plan uses no chained login. |
| Unchanged, new default | `excludedOperationKeys` | `string[]` | For a quick plan, it starts as `credentialProducerOperationKeys`. For a guided plan, it starts empty, as in AP-029. |
| Unchanged, narrower | `omitted` | `OmittedOperation[]` | Computed only over the operations in scope, so an operation outside the guided selection is never listed (FR-023, SC-005). |

The fingerprint covers `source`, `excludedOperationKeys`, `omitted`, `journeys`, `thinkTimeMs`,
`loadProfile`, `thresholds`, `userSuppliedValues`, `uniqueValueFields` and `upstreamFingerprint`.

**Removal reason (derived, UI only)**: a removed operation whose key is in
`credentialProducerOperationKeys` shows "used to acquire the run's credentials"; any other removed
operation shows "Removed". The reason is not stored.

### `PerformanceRun` and `PerformanceRunSummary`

| Change | Field | Type | Rule |
|---|---|---|---|
| Added | `planSource` | `"guided" \| "quick"` | Copied from `planSnapshot.source` when the run is created. Stored in `performance_runs.plan_source` (research Q12). Each path's `GET /runs` lists only its own source. |

### Report provenance

The report's provenance section, rendered from `planSnapshot`, adds one line for a quick plan:
"Plan built by the quick performance test from generated positive scenarios that were not
reviewed." (FR-013). A guided plan's report is unchanged.

## New shared types

### `WriteOperationSummary` (derived; never stored)

Computed by `summarizeWriteOperations(journeys)` on every render (FR-009 to FR-012, research Q9).

| Field | Type | Rule |
|---|---|---|
| `total` | `number` | Distinct write operation keys in the plan's journeys. |
| `byMethod` | `{method: WriteMethod, count: number}[]` | Only methods with a count over 0, in the order POST, PUT, PATCH, DELETE. |
| `operations` | `WriteOperationEntry[]` | In plan order, by first appearance. |

`WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE"`.

`WriteOperationEntry = {operationKey, method: WriteMethod, path, effect: WriteEffect, stepIds:
string[]}`. `stepIds` has more than one entry only when an operation appears in several guided
journeys.

`WriteEffect = "creates" | "replaces" | "updates" | "deletes"`, and
`WRITE_EFFECT_LABELS: Record<WriteMethod, string>` is `{POST: "Creates", PUT: "Replaces", PATCH:
"Updates", DELETE: "Deletes"}` (FR-010).

A summary with `total: 0` means the plan sends only read requests (FR-012).

### `StepRequestPreview` (derived on request; never stored)

Returned by `GET <base>/plan/steps/:stepId/request` (FR-008, research Q8). It is built from the
same step request the script sends and never contains a value read from an environment.

| Field | Type | Rule |
|---|---|---|
| `stepId` | `string` | |
| `operationKey` | `string` | |
| `method` | `string` | |
| `pathTemplate` | `string` | The operation's path template, for example `/orders/{id}`. |
| `parameters` | `PreviewParameter[]` | Path, then query, then header parameters, each in request order. |
| `auth` | `PreviewAuth` | |
| `body` | `{contentType: "json" \| "text", text: string, references: PreviewReference[]} \| null` | `text` is the body as sent, with each reference left as `{{name}}`. |

`PreviewParameter = {location: "path" | "query" | "header", name: string, value: PreviewValue}`.

`PreviewValue` is one of:
- `{kind: "generated", text}`: a value from the generated scenario;
- `{kind: "environment", name, secret: boolean}`: a value the target environment supplies, shown by
  name only;
- `{kind: "workflow-variable", variable, producerStepId}`: guided plans only;
- `{kind: "unique-per-iteration", format: "email" | "uuid"}`: AP-029 D13;
- `{kind: "template", text, references: PreviewReference[]}`: a value that mixes text and
  references.

`PreviewReference = {name} & ({kind: "environment", secret: boolean} | {kind: "workflow-variable",
producerStepId} | {kind: "unique-per-iteration", format} | {kind: "credential", schemeName})`.

`PreviewAuth = {kind: StepAuthKind, schemeName: string | null, location: "header" | "query" | null,
references: PreviewReference[]}`. A token acquired by the plan (OAuth2 client credentials or a
chained login) is a `credential` reference; a static credential is an `environment` reference with
`secret: true`.

## Backend-only state

### `QuickPerformanceTest` (in memory, one per session; not a shared type)

Held in `backend/src/performance/quick/quickTestStore.ts`, a `Map<sessionId,
QuickPerformanceTest>` cleared on session expiry (research Q1). Not persisted.

Naming: the spec's **Quick Performance Plan** entity is `QuickPerformanceTest.plan`, a
`PerformancePlan` with `source: "quick"`. `QuickPerformanceTest` (the "quick test" in the plan,
tasks and UI copy) is the session entry that holds that plan together with the specification
model, the generated scenarios and the script.

| Field | Type | Rule |
|---|---|---|
| `id` | `string` | A random UUID. Identifies the entry only; it appears in no plan, script or template. |
| `specification` | `{filename: string, info?: ApiInfo, operationCount: number}` | For display. `info` is the document's own title and version, when declared. |
| `apiModel` | `ApiModel` | From the unchanged parse, validate and build pipeline (FR-002). |
| `scenarios` | `TestScenario[]` | Positive scenarios only (FR-004), with quick ids (below). |
| `plan` | `PerformancePlan` | `source: "quick"`. |
| `script` | `GeneratedScript \| undefined` | AP-029's backend-only type (`scriptStore.ts`), kept here rather than in `scriptStore`. |

Its `PerformanceContext` is `{apiModel, approvedScenarios: scenarios, workflows: [],
relationships: [], selectedOperationKeys: undefined, source: "quick"}`, so there is no chaining
(FR-006) and every operation is in scope (FR-003). `PerformanceContext` gains the `source` field;
`contextFromWorkflow` sets `"guided"`.

### Quick scenario identifiers

`q<rank>-<hex>` (research Q4):
- `rank` is the two-digit index of the generating rule in the positive rule order:
  `00` positive-scenario, `01` enum-positive-scenarios, `02` minimal-positive-scenario.
- `hex` is the first 24 hex characters of `sha256Hex(canonicalJson({operationKey, rule, request,
  assertions}))`.

Deterministic for the same specification, and ordered so that AP-029's "lowest identifier" rule
picks the full happy-path scenario when it exists. Provenance (`source: "RULE"`, rule,
description, `duplicateOfRules`) is unchanged.

### `TokenSource` (backend, `plan/stepRequest.ts`)

It gains `producerOperationKey?: string`, set for `chained-login` sources only. The plan's
`credentialProducerOperationKeys` is read from it.

## API responses (new)

### `QuickPerformanceTestView`

`{specification: {filename, info?, operationCount}, plan: PerformancePlan, script: ScriptStatus |
null}`. Returned by `POST /api/quick-performance` and `GET /api/quick-performance`
([contract](./contracts/quick-performance-api.md)). No response carries the script text, a
scenario body outside the step preview, or an environment value.

## Storage change

`performance_runs` gains `plan_source TEXT NOT NULL DEFAULT 'guided'`, added with the existing
idempotent `ensureColumn` helper in `persistence/connection.ts`. It is not encrypted: it holds no
value. No other table changes.

## Validation rules (server-enforced)

- AP-029's plan validation applies unchanged to a quick plan (invalid load profile, threshold,
  order and expected status; `422 nothing_to_test` and `422 expected_status_missing`).
- `PUT /plan` with a `scope` field returns `400 invalid_request`, on both paths (research Q7).
- `excludedOperationKeys` must name analyzed operations (`400 unknown_operation`), as today. A
  credential producer can be restored by leaving it out of the list.
- `GET /plan/steps/:stepId/request` with an unknown step returns `404 step_not_found`.
- `POST /api/quick-performance` stores nothing unless parsing, validation and model building all
  succeed (FR-002).

## State transitions

A quick test has no stage machine.

```text
(none) ──POST /api/quick-performance──────────────────────────▶ quick test (plan, no script)
quick test ──POST /script──────────────────────────────────────▶ quick test (plan, current script)
quick test ──PUT /plan changing the fingerprint────────────────▶ script out of date
quick test ──POST /api/quick-performance?replaceExisting=true──▶ new quick test (runs kept)
quick test ──session expiry or backend restart─────────────────▶ (none) (runs kept, AP-029 D18)
```

Runs follow AP-029's transitions unchanged.
