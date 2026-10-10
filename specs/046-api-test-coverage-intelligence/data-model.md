# Data Model: API Test Coverage Intelligence (AP-046)

> **Refinement 2026-10-10**: [coverage-rules.md](./coverage-rules.md) is stricter than this document in several places (operation-level counts OC1 to OC5, typed failure causes, scenario verdicts, requirement-partition category coverage with runtime figures, check scopes). Its §15 lists the differences. Where they conflict, coverage-rules.md wins; this file is updated when the types change.

All types live in `packages/shared-domain/src/coverage.ts` and are exported from its `index.ts`. No new persistence: every value is derived per request.

## Enumerations

- `CoverageDimensionKind`: `operation | parameter | request-schema | response-code | response-schema | scenario-category`.
- `CoverageState` (exactly one per requirement): `not-covered | generated-not-executed | executed-failed | verified | inconclusive | stale`.
- `ScenarioCategoryGroup`: `positive | negative | boundary | security`.
- `Priority`: `high | medium | low`.

### State precedence (documented, applied in `classify.ts`)

Evaluated top-down for one requirement, over the attributable evidence of its mapped scenarios:

1. No mapped scenario → `not-covered`.
2. Mapped scenarios exist, no attributable executed result → `generated-not-executed`.
3. `stale` is reserved: it is part of the contract for attributable evidence flagged for revalidation, but no rule in this feature produces it. Results that join to no current scenario never enter classification; they are counted in `execution.unattributedResults` (clarified 2026-10-10).
4. At least one attributable, non-stale result failed a check relevant to this requirement → `executed-failed` (a failure outranks a pass).
5. At least one attributable, non-stale result passed every relevant check that was evaluated, and no relevant check was `could-not-evaluate` → `verified`.
6. Otherwise (response received but no relevant check evaluated, `could-not-evaluate`, edited item, or `not-attempted` only) → `inconclusive`.

"Relevant check" per dimension: operation = any result received; parameter = result of a scenario that targets it and whose status assertion passed; request-schema element = same, targeted scenario; response-code = the `status-code` assertion for that code; response-schema = the `schema-conformance` assertion. Runtime-verified never follows from a received response alone.

## Entities

### CoverageRequirement
| Field | Meaning |
|---|---|
| `id` | Stable element id, e.g. `op:POST /orders`, `param:GET /users/{id}:path:id`, `reqprop:POST /orders:application/json:items[].qty`, `resp:GET /users/{id}:404` |
| `kind` | `CoverageDimensionKind` |
| `operationKey` | `"METHOD /path"` (matches `toOperationKey()`) |
| `label` | Human label |
| `contractHash` | SHA-256 of this element's normalized fragment |
| `measurable` | `true`, or `{ reason, issueRef? }` when not measurable (excluded from denominators) |
| `applicable` | `false` for e.g. boundary categories on unconstrained operations (excluded from that category's denominator) |

### CoverageMapping
`requirementId`, `scenarioIds[]` (all contributors, deduplicated, sorted), `rules[]`, `sources[]` (`RULE | AI`), `reviewStates[]`. Absent when the relationship cannot be established.

### EvidenceRef
`runId`, `runKind` (`uploaded | guided`), `scenarioId`, `itemId?`, `outcome`, `checks[]` (`{ kind: status-code|schema-conformance, outcome }`), `startedAt`. Never carries headers, bodies, URLs or `rawCapture`.

### CoverageState record (per requirement)
`requirementId`, `state`, `reason` (text), `mappedScenarioCount`, `evidence: EvidenceRef[]` (bounded, sorted), `staleReason?`.

### CoverageMetric
`id`, `dimension: "specification" | "runtime"`, `kind`, `numerator`, `denominator`, `percentage: number | null` (`null` when denominator is 0), `available: boolean`, `basis` (text defining what qualifies for numerator and denominator).

Rule: `percentage = denominator === 0 ? null : round1(numerator / denominator * 100)`; `numerator <= denominator` is asserted; no NaN or Infinity can be produced.

### CoverageGap
`id`, `operationKey`, `requirementIds[]` (grouped so one underlying gap is one record), `kind`, `state`, `reason`, `evidence[]`, `categoryGroup?`, `priority`, `priorityRationale: { score, factors[] }`.

### Recommendation
`rank`, `gapId`, `operationKey`, `requirement` (label), `why`, `evidence[]`, `priority`, `rationale`, `action: { type: "review-scenario" | "generate-scenario" | "open-result", target }`.

### OperationCoverage (table row)
`operationKey`, `method`, `path`, `specification: {covered, total}`, `runtime: {verified, total}`, `failedCount`, `states` (count per `CoverageState`), `missing[]` (short labels), `priority`, `categoryGroups[]`.

### NotMeasurable
`kind`, `location`, `reason`, `issueKind` (`AnalysisIssue.kind`), listed in the snapshot so limits are visible.

### CoverageSnapshot
| Field | Meaning |
|---|---|
| `specification` | `{ name, version, revision (sha256), operationCount }` |
| `context` | `{ workflowId, generatedAt?, selectedOperationCount, scenarioCounts: { total, accepted, pending, rejected, rule, ai } }` |
| `execution` | `{ source(s), selectedRunId?, runIds[], lastQualifyingExecutionAt?, environment? { name, tier }, unattributedResults }`; `unattributedResults` counts results that join to no current scenario (never verified, reported as possibly from an earlier specification) |
| `scenarioEditedAfterRun` | Per scenario id: true when the scenario was edited in review after its run; informational note only, evidence is not invalidated |
| `metrics` | `CoverageMetric[]` (spec + runtime groups, see spec FR-021) |
| `operations` | `OperationCoverage[]` |
| `gaps` | `CoverageGap[]` |
| `recommendations` | `Recommendation[]` |
| `notMeasurable` | `NotMeasurable[]` |
| `categoryCoverage` | per group `{ group, covered, applicable, available, reason? }`; `security` is `available:false` |
| `notices` | `{ code, severity, message }[]` for stale, incomplete, unattributed, unavailable conditions |
| `outOfScopeOperations` | Operation keys not selected for generation; excluded from every denominator and not gaps |
| `calculatedAt` | injected clock value; the only time-dependent field, excluded from determinism comparisons |

No overall score field exists by design (FR-010).

## Metric denominators (documented, FR-008)

| Metric | Numerator | Denominator |
|---|---|---|
| Operations (spec) | selected operations with ≥1 mapped, non-rejected scenario | selected operations |
| Operations (runtime) | operations in state `verified` for their operation requirement | selected operations |
| Parameters (spec) | documented parameters targeted by ≥1 scenario | documented parameters, path+operation level merged, overrides counted once |
| Request schemas (spec) | measurable request-schema elements with ≥1 mapped scenario | measurable, applicable request-schema elements |
| Response schemas (spec) | documented response schemas with a mapped schema-conformance scenario | documented response schemas |
| Response codes (runtime) | documented codes in state `verified` | documented codes (ranges and `default` counted as their own key) |
| Contract assertions (runtime) | evaluated assertions that passed | evaluated assertions (excludes `could-not-evaluate`) |
| Category (spec) | operations with ≥1 scenario in the group | operations where the group is applicable |

Scenario counts are never used as a numerator or denominator of any coverage metric.

## Additions to existing records

- `buildApiModel`: operation `parameters` now include path-level parameters, operation-level overriding on `(name, in)`. No type change.
- No change to `TestScenario`, `ExecutionRun`, `UploadedCollectionExecutionRun`, or any persisted table.

## Server-side state

None. `GET /api/coverage` reads the current session workflow and the run repositories, computes, and returns. The clock is injected for tests.

## Validation rules

- `runId` query must belong to a run visible to the session, else `404 run_not_found`.
- Filter parameters are validated against closed enumerations; unknown values return `400 invalid_filter`.
- Snapshot invariants asserted in tests: `numerator <= denominator`; every `CoverageGap.requirementIds` exists; every `EvidenceRef.scenarioId` exists in the model; no snapshot field contains a header value, body, URL query string, or `rawCapture`.

## Refinement deltas (2026-10-10; authority: [coverage-rules.md](coverage-rules.md))

Additive unless noted. All in `packages/shared-domain/src/coverage.ts`.

- `CoverageRequirement`: add `group: "positive" | "negative" | "boundary" | "unclassified"` (replaces optional `categoryGroup`) and `source` (specification location). Remove kind `scenario-category` (breaking, but within the unreleased type).
- `CoverageRequirementResult`: add `cause?: CoverageCause`, `tally: { passed, failed, inconclusive, notExecuted }`, and for stale `staleReason?`, `staleSince?`, `reExecutionRequired?`.
- `CoverageCause`: `assertion-failed | transport-error | check-not-evaluated | no-relevant-check | request-edited | blocked-by-dependency | run-cancelled | not-reached | never-run | not-in-selected-run`.
- `CoverageEvidenceRef`: add `cause?`; keep `note`.
- `OperationCoverage`: add `scenarioVerdicts: { passed, failed, inconclusive, notExecuted }` and `scenarioCount`; keep `stateCounts`. No single-status field.
- `CoverageSnapshot`: add `operationCounts: { eligible, withScenarios, withPassingVerification, withFailures, withNoScenarios }`; `categoryCoverage` becomes `{ group, available, eligible, specCovered, verified, counts: Record<CoverageState, number>, reason? }[]` plus `unclassified: { requirements: { operationKey, label }[], scenarios: number }`; `execution.evidenceMode: "latest-per-scenario" | "single-run"`, `execution.evidenceByRun: { runId, scenarios }[]`, `execution.environments[]`; assertion metric `{ passed, failed, notEvaluated }`.
- `CoverageFilter.gapKind`: `"missing" | "failed" | "insufficient" | "stale"`.
- Invariants asserted in tests: `withScenarios + withNoScenarios = eligible`; `withPassingVerification` and `withFailures` are each at most `withScenarios`; per category `sum(counts) = eligible`; scenario verdicts sum to `scenarioCount`.
