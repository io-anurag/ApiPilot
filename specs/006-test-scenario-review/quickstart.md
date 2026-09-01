# AP-006 Quickstart Validation

This guide validates human review of a generated TestModel without executing API requests or
requiring durable storage.

## Prerequisites

- Node.js 20 LTS or newer
- npm dependencies installed from the repository root
- A normalized AP-002 `ApiModel`
- A deterministic or AP-005 enhanced `TestModel`

## Automated Validation

From the repository root:

```powershell
npm test --workspace @apipilot/shared-domain -- --run tests/unit/test-scenario-review.test.ts
npm test --workspace @apipilot/backend -- --run tests/unit/testDesign/reviewTestModel.test.ts tests/unit/testDesign/reviewTestModel.edit.test.ts tests/unit/testDesign/reviewSensitiveValues.test.ts tests/integration/testScenarioReview.test.ts tests/integration/testScenarioReviewRefinement.test.ts tests/integration/testScenarioReviewSafety.test.ts
npx vitest run --project frontend
npm run build
npm run lint
```

Expected outcomes:

- Review summaries count pending, accepted, rejected, and policy-required scenarios correctly.
- Accept and reject decisions update only the addressed scenario and retain provenance.
- Rejections require a reason and failed updates leave the last valid state unchanged.
- Pending and rejected scenarios never appear in the approved TestModel view.
- Stale revisions are surfaced as explicit conflicts rather than silently overwritten.
- Supported edits are validated before replacement, marked as user-modified, and returned to
  pending review.
- Regeneration failures preserve the current scenario and decision; successful replacements are
  also pending review.
- Equivalent accepted scenarios are not emitted as duplicate approved executable scenarios.
- The review UI exposes loading, empty, success, and error states and keeps AI provenance visible.

## HTTP Contract Check

Start the backend in its normal development or test configuration and send the request shape in
[contracts/test-scenario-review-api.md](contracts/test-scenario-review-api.md) to
`POST /api/test-models/reviews`.

Verify:

1. An empty update list initializes a review response with deterministic summary counts.
2. Accepting and rejecting scenarios returns updated states and an approved TestModel.
3. A rejected scenario without a reason returns `200 OK` with an `invalid-rejection-reason`
   finding for that update, and does not change the scenario's state, so batches of updates can
   apply partially.
4. A stale scenario revision submitted to the `edit` or `regenerate` endpoint returns `409` and
   does not overwrite current review state; a stale revision inside a batch `updates` request
   returns `200 OK` with a `stale-revision` finding for that update.
5. The approved TestModel contains no pending or rejected scenario.
6. Review actions do not execute requests or authorize artifact generation.

## Traceability References

- Requirements and acceptance scenarios: [spec.md](spec.md)
- Review entities and invariants: [data-model.md](data-model.md)
- Request/response behavior: [contracts/test-scenario-review-api.md](contracts/test-scenario-review-api.md)

## Validation Record

Repository-wide validation was executed at the end of AP-006 implementation:

- `npm test` (root, all three workspaces via `vitest.workspace.ts`): **176 passed, 1 skipped**
  (the pre-existing opt-in `localProvider.real.test.ts`), 0 failed.
- `npm run lint` (repository-wide ESLint): passed, no errors (a pre-existing informational
  warning about the TypeScript version supported by `@typescript-eslint/typescript-estree` is
  unrelated to AP-006).
- `npm run build` (all three workspaces): passed.
- No unrelated regressions were observed. One AP-006-caused build error was found and fixed
  during this validation pass: `ScenarioActionBody` was missing an `edit?: unknown` field used
  by the `/test-models/reviews/edit` route, which only surfaced under `tsc` strict compilation
  (not under the Vitest/esbuild transform used by the test run) — resolved by adding the field.
- `vitest.workspace.ts`'s frontend project `include` pattern was extended from
  `["tests/**/*.test.tsx"]` to also include `"tests/**/*.test.ts"`, since AP-006 introduced the
  first frontend service-layer test file without JSX (`reviewsClient.test.ts`), which the
  original pattern silently excluded from the aggregate `npm test` run.
