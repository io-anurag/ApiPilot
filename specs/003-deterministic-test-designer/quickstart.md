# Quickstart: Deterministic Test Designer

This guide validates that AP-003 works end-to-end on top of the AP-001/AP-002 foundation.

## Prerequisites

- AP-001 (Application Foundation) and AP-002 (OpenAPI Specification Engine) are set up and
  running (`npm install`, `npm run dev`).
- A sample OpenAPI 3.x YAML file with at least one required field, one enum, one numeric
  or string boundary constraint, and one path parameter (e.g., the well-known Petstore
  example, or the existing `backend/tests/fixtures/openapi/valid.yaml` fixture).

## Steps

1. **Start the app** (if not already running):
   ```
   npm run dev
   ```
2. **Analyze a specification**: Upload a well-formed OpenAPI 3.x YAML file via the
   Specification Upload page (AP-002) and confirm the Analysis Summary appears.
3. **Generate the baseline test suite**: Trigger "Generate Baseline Test Suite" (calls
   `POST /api/test-models` with the `apiModel` from step 2 — see
   [contracts/test-models-api.md](./contracts/test-models-api.md)).
   - Expected: a positive scenario and the applicable missing/null/empty-value,
     invalid-type, invalid-format, invalid-enum, and boundary scenarios appear, grouped by
     operation and category.
4. **Inspect a generated scenario**: Open any scenario in the list.
   - Expected: its category, targeted field/parameter, generated request, expected
     assertions, and rule provenance are all shown (spec.md User Story 2).
5. **Confirm nested and parameter handling**: For an operation with a required field
   nested inside a sub-object, confirm it received its own missing/null/empty-value
   scenarios; for a required path parameter, confirm no missing/null/empty-value scenario
   was generated for it, only invalid-type/invalid-enum/boundary as applicable.
6. **Confirm no duplicates**: For a specification where two rules would otherwise produce
   an identical request/assertion combination on the same operation, confirm only one
   scenario appears in the generated suite (SC-004).
7. **Run the automated tests**:
   ```
   npm test
   ```
   - Expected: all backend `testDesign/` unit tests (one per rule module, plus assertions
     and deduplication), the `testModels` integration test, and the frontend baseline-suite
     view tests pass (SC-002, SC-003, SC-005, SC-006).

## Validation Checklist

- [X] A positive scenario is generated for every operation, using a documented success
      response when one exists (FR-001, spec.md Edge Cases)
- [X] Required fields at any nesting depth receive missing/null/empty-value scenarios; required path parameters do not (FR-002, FR-009)
- [X] Fields/parameters with declared type, format/pattern, enum, and numeric/string/array constraints receive their applicable invalid-type/invalid-format/invalid-enum/boundary scenarios (FR-003–FR-008)
- [X] No scenario references a field, parameter, or status code absent from the source `ApiModel` (SC-006)
- [X] No duplicate scenarios (identical request + assertions) appear within the same operation (SC-004)
- [X] Every scenario carries an identifiable rule provenance (SC-005)
- [X] A baseline suite for 50-100 operations generates in under 30 seconds (SC-001)
- [X] `npm test` passes with zero failures
