# Quickstart: OpenAPI Specification Engine

This guide validates that AP-002 works end-to-end on top of the AP-001 foundation.

## Prerequisites

- AP-001 (Application Foundation) is set up and running (`npm install`, `npm run dev`).
- A sample OpenAPI 3.x YAML file (e.g., the well-known Petstore example) available locally.

## Steps

1. **Start the app** (if not already running):
   ```
   npm run dev
   ```
2. **Upload a valid specification**: In the frontend, navigate to the Specification Upload
   page and upload a well-formed OpenAPI 3.x YAML file.
   - Expected: an Analysis Summary appears showing operation/schema/security-scheme counts
     and zero flagged issues.
3. **Browse discovered operations**: Click into the discovered operations list.
   - Expected: every path + method from the source file is listed; opening one shows its
     parameters, request body, responses, and security requirements exactly as declared in
     the source file.
4. **Upload an invalid file**: Upload a non-YAML file (e.g., a `.txt` file with random
   content).
   - Expected: a clear "could not be parsed as YAML" error is shown; no analysis summary is
     produced.
5. **Upload a spec with an unresolved reference**: Upload a specification containing a
   `$ref` pointing to a nonexistent internal location.
   - Expected: the upload still succeeds (200), but the Analysis Summary explicitly lists
     the unresolved reference and its location.
6. **Run the automated tests**:
   ```
   npm test
   ```
   - Expected: all backend `openapi/` unit tests, the `specifications` integration test,
     and the frontend upload/results component tests pass (SC-002, SC-003, SC-005).

## Validation Checklist

- [ ] A well-formed OpenAPI 3.x spec produces a complete, accurate Analysis Summary (SC-001, SC-002)
- [ ] An invalid (non-YAML) upload is rejected with a specific error, not a generic failure (FR-004)
- [ ] An unresolved/circular `$ref` is explicitly flagged, never silently dropped (FR-006, FR-013, SC-003)
- [ ] Every parameter/response/security requirement shown matches the source file exactly, with nothing invented (SC-005)
- [ ] `npm test` passes with zero failures
