# Data Model: Test Execution Gap Closure

Every change here is additive. No existing field, type member, or meaning changes. The
shared-domain changes are in `packages/shared-domain/src/execution.ts`, and the backend-internal
changes are in `backend/src/postman/`. `specs/026` types (`UploadedRequestResult` and the others)
are untouched.

## Shared domain (`packages/shared-domain/src/execution.ts`)

### New: `RequestProcessingStage`

```ts
export type RequestProcessingStage = "not-sent" | "no-response" | "response-received";
```

| Value | Meaning | Allowed with |
|-------|---------|--------------|
| `"not-sent"` | The request was never dispatched. | `outcome: "not-attempted"` only |
| `"no-response"` | The request was dispatched, but no response arrived (connection refused/reset, unreachable, DNS/TLS failure, or timeout). | `outcome: "failed"` with `failureCategory` `"connectivity-failure"` or `"timeout"` |
| `"response-received"` | A response arrived and the request's assertions were evaluated against it. | `outcome: "passed"`, or `outcome: "failed"` with `failureCategory` `"assertion-failed"`, `"unexpected-status"`, or `"could-not-evaluate"` |

### New: `UnmetDependency`

```ts
export interface UnmetDependency {
  scenarioId: string;
  operationPath: string;
  operationMethod: string;
}
```

This identifies one earlier request in the same run whose blocking outcome (spec.md FR-001)
left a dependency unmet. The
three fields are the same identifiers that request's own `RequestResult` carries, so a caller
can match the two. It never carries a value, variable name, or credential (spec.md FR-017).

### Changed: `RequestResult` (two optional fields added)

| Field | Type | Rule |
|-------|------|------|
| `processingStage` | `RequestProcessingStage?` | Set on every result produced after this feature ships, consistent with the table above (FR-008, FR-009). Absent on results stored before it (FR-015). |
| `unmetDependencies` | `UnmetDependency[]?` | Present if and only if `notAttemptedReason === "dependency-not-met"`. It has at least one entry, in execution order, with no duplicates (FR-002). |

Invariants a test can check on every new result:

- `outcome === "not-attempted"` ⇔ `processingStage === "not-sent"`.
- `failureCategory ∈ {"connectivity-failure", "timeout"}` ⇔ `processingStage === "no-response"`.
- `unmetDependencies !== undefined` ⇔ `notAttemptedReason === "dependency-not-met"`.
- Every `unmetDependencies[i].scenarioId` is the `scenarioId` of an earlier result in the same
  run's `results` (SC-002).

### Unchanged, with activated values

- `NotAttemptedReason`: `"dependency-not-met"` has been declared since `specs/018` and is now
  produced for the first time.
- `ExecutionConfirmationRequirement`: its shape is unchanged. Its `destructiveOperations` list is
  now built from approved scenarios (research.md D6), which is what its doc comment already
  states.

## Backend-internal (`backend/src/postman/`)

These types are shared between two backend modules only (`postman/` and `execution/`). They do
not cross the frontend boundary, so per `.claude/CLAUDE.md` §4 they stay out of shared-domain.

### Changed: `AutomaticChain` (`automaticChaining.ts`)

| Field | Type | Rule |
|-------|------|------|
| `kind` | `"data" \| "credential"` | `"credential"` exactly when the chain's consumer relationship location is `"auth"` (AP-023). Otherwise `"data"` (AP-019). This records the `isAuthChain` decision `applyChainGroup()` already makes. |

### New: `ExecutionDependencyMap` (`generateCollection.ts`)

```ts
/** Consuming item id → ids of the items it takes data values from, in execution order. */
export type ExecutionDependencyMap = ReadonlyMap<string, readonly string[]>;
```

- Keys and values are `PostmanRequestItem.id`s of items in the same generated collection.
- It holds only data links: approved-workflow `WorkflowVariable`s and `AutomaticChain`s with
  `kind === "data"`. It never holds credential chains or OAuth2 token-fetch items (spec.md FR-006,
  FR-007).
- Every producer id comes before its consumer id in execution order (research.md D3).
- It is deterministic: the same inputs produce the same map (constitution XVI).

### New: `generateExecutableCollection(...)`

It takes the same parameters as `generateCollection()` and returns either the same failure
(`{ ok: false, failure }`) or `{ ok: true, result: ExportResult, dataDependencies:
ExecutionDependencyMap }`. `generateCollection()` becomes a thin wrapper that drops
`dataDependencies`, and its output stays byte-for-byte identical.

## State transitions (one item within a run)

```text
                 ┌── cancel requested ──────────────► not-attempted / "cancelled"            (not-sent)
                 │
 item reached ───┼── any data producer blocked ──────► not-attempted / "dependency-not-met"  (not-sent)
                 │                                     + unmetDependencies; item added to blocked set
                 │
                 └── dispatched ──┬── no response ───► failed / connectivity-failure|timeout (no-response)
                                  └── response ──────► passed | failed / other categories    (response-received)
                                                       failed, category ≠ assertion-failed ⇒ added to blocked set

 internal error in the loop ───────────────────────► remaining: not-attempted / "run-ended-before-reached" (not-sent)
```

The checks run in this order: cancellation first (FR-005), then dependency, then dispatch.
"Blocked" means a blocking outcome (spec.md FR-001): not attempted, or failed with
`connectivity-failure`, `timeout`, `unexpected-status`, or `could-not-evaluate`. A failure with
`assertion-failed` (schema mismatch only) does not block dependents.
