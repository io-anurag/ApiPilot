# AP-007 Quickstart Validation

This guide validates deterministic Postman artifact generation from an approved TestModel. Nothing
in it executes a generated request or contacts an API described by the specification.

## Prerequisites

- Node.js 20 LTS or newer
- npm dependencies installed from the repository root
- A normalized AP-002 `ApiModel`
- An approved `TestModel` from `POST /api/test-models/reviews` (see
  `specs/006-test-scenario-review/contracts/test-scenario-review-api.md`)

No AI provider is required. No model download is required. AP-007 uses neither.

## Automated Validation

From the repository root:

```powershell
npm test --workspace @apipilot/shared-domain -- --run tests/unit/postman-artifact.test.ts
npm test --workspace @apipilot/backend -- --run tests/unit/postman tests/integration/postmanCollection
npx vitest run --project frontend
npm run build
npm run lint
```

Expected outcomes:

- Every approved scenario produces exactly one request; no pending or rejected scenario appears.
- Generating twice from identical input produces byte-identical collection, environment, and README.
- Removing one scenario changes only that scenario's item; all other items and ids are unchanged.
- Requests carry only the checks their approved scenario's assertions defined; scenarios with no
  assertions produce a request with no test script and a recorded limitation.
- Every URL begins with `{{baseUrl}}`; no literal host appears in any artifact.
- Credential values appear only in the environment artifact, typed as secret.
- A collection that fails validation is refused, not returned.

## Manual Validation

### 1. Generate artifacts end to end

Start the application:

```powershell
npm run dev
```

Then, in the browser: upload an OpenAPI document, generate the deterministic test model, enhance and
review the scenarios, accept a representative set, and use the export action on the review page.

Confirm:

- One click produces `collection.json`, `environment.json`, and `README.md` (FR-022).
- The page reports the validation result and lists the recorded limitations (FR-014, FR-017).
- The README states the request count, folder organization, counts by origin, and the variables to
  supply before running (FR-016).

### 2. Confirm the artifact is importable and runnable

This is the manual acceptance step for SC-007; the automated suite deliberately does not depend on a
collection runner.

1. Import `collection.json` and `environment.json` into Postman.
2. Select the imported environment and fill in `baseUrl` and any credential variables.
3. Confirm every request resolves its address and no request needs a manual edit to run.

Run the collection only against an environment you are authorized to call. AP-007 generates the
artifact; it never executes it, and generating it is not authorization to run it (FR-023).

### 3. Confirm no secret leaked

With a specification whose operations declare authentication, export while supplying a recognizable
placeholder credential, then search the artifacts:

- `collection.json` must contain the variable reference, never the supplied value.
- `README.md` must name the variable and its purpose, never its value.
- The server log for the export must contain neither the value nor any request payload (FR-025).

### 4. Confirm the empty and refusal paths

- Reject every scenario, then export: the export is refused with an explicit empty-result outcome,
  not an empty collection presented as success (FR-020).
- Supply a `variableValues` name the collection does not reference: the request is refused with
  `unknown_variable` rather than silently ignored.

## Determinism check

```powershell
npm test --workspace @apipilot/backend -- --run tests/unit/postman/determinism.test.ts
```

The determinism test generates from the same input twice in one process and asserts identical
serialized output, and generates from a shuffled scenario order to assert the ordering rule does not
depend on input order.
