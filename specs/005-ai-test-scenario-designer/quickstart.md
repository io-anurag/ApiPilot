# AP-005 Quickstart Validation

This guide validates the AI enhancement boundary without requiring a real model. It uses
the deterministic mock provider for ordinary tests; real-model validation remains opt-in.

## Prerequisites

- Node.js 20 LTS or newer
- npm dependencies installed from the repository root
- The AP-002 normalized `ApiModel` and AP-003 deterministic `TestModel` fixtures

## Automated Validation

From the repository root:

```powershell
npm test --workspace @apipilot/backend -- --run tests/unit/testDesign/validateAICandidate.test.ts tests/unit/testDesign/enhanceTestModel.test.ts tests/integration/enhancedTestModels.test.ts
npm run build
npm run lint
```

Expected outcomes:

- Valid candidates targeting existing operations can be added.
- Unknown operations, fields, methods, schemas, and status codes are rejected or marked
  non-executable.
- AI candidates equivalent to deterministic scenarios do not create duplicate executable
  scenarios and their provenance remains traceable.
- Provider unavailable, timeout, malformed, and semantically invalid cases preserve the
  deterministic baseline with an explicit outcome.
- Repeated enhancement with equivalent validated provider output preserves scenario order and
  deduplication results.
- The current candidate contract validates operation, parameter, request-body field, response
  schema, and documented status-code references; detailed response-field and authentication
  reference validation remains outside the current AP-005 payload contract.

## HTTP Contract Check

Start the backend in its normal test or development configuration and send the request shape
described in [contracts/enhanced-test-models-api.md](contracts/enhanced-test-models-api.md) to
`POST /api/test-models/enhance`.

Verify:

1. A valid request returns `200` and an enhancement-result-shaped response.
2. The response retains the supplied deterministic scenarios.
3. AI-derived scenarios are visibly marked with AI provenance, rationale, and bounded
   confidence.
4. Invalid request shapes return `400`; non-POST methods return `405`.
5. Provider degradation returns the deterministic model and an explicit provider outcome.

## Traceability References

- Entity fields and invariants: [data-model.md](data-model.md)
- Request/response and safety behavior: [contracts/enhanced-test-models-api.md](contracts/enhanced-test-models-api.md)
- Feature acceptance scenarios: [spec.md](spec.md)
