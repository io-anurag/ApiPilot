# ApiPilot

[![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.x-6BA539?logo=openapiinitiative&logoColor=white)](https://www.openapis.org/)
[![Vitest](https://img.shields.io/badge/Vitest-testing-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![ESLint](https://img.shields.io/badge/ESLint-enabled-4B32C3?logo=eslint&logoColor=white)](https://eslint.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/io-anurag/ApiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/io-anurag/ApiPilot/actions/workflows/ci.yml)
[![stars - ApiPilot](https://img.shields.io/github/stars/io-anurag/ApiPilot?style=social)](https://github.com/io-anurag/ApiPilot)
[![forks - ApiPilot](https://img.shields.io/github/forks/io-anurag/ApiPilot?style=social)](https://github.com/io-anurag/ApiPilot)
[![GitHub tag](https://img.shields.io/github/tag/io-anurag/ApiPilot?include_prereleases=&sort=semver&color=blue)](https://github.com/io-anurag/ApiPilot/releases/)
[![issues - ApiPilot](https://img.shields.io/github/issues/io-anurag/ApiPilot)](https://github.com/io-anurag/ApiPilot/issues)

ApiPilot is an AI-powered API test engineering platform that transforms OpenAPI/YAML
specifications into intelligent, executable API test suites.

This repository currently implements:

- **AP-001: Application Foundation** — a local npm-workspaces monorepo with a backend
  (Express/TypeScript), a frontend (React/Vite), and a shared domain package, all wired
  together with a single dev/test workflow.
- **AP-002: OpenAPI Specification Engine** — upload an OpenAPI 3.x YAML specification and
  receive a normalized analysis of its operations, schemas, and security requirements (see
  [OpenAPI Specification Engine](#openapi-specification-engine) below).
- **AP-003: Deterministic Test Designer** — generate a deterministic baseline suite of
  test scenarios (positive, boundary, and negative) from an analyzed specification, with
  no AI/randomness involved (see [Deterministic Test Designer](#deterministic-test-designer)
  below).
- **AP-004: AI Provider & Local Inference Foundation** — a fully offline, local AI
  inference provider (Transformers.js) plus a deterministic mock provider for tests, a
  readiness-status endpoint, and a model-selection benchmarking harness (see
  [AI Provider & Local Inference Foundation](#ai-provider--local-inference-foundation)
  below).
- **AP-005: AI Test Scenario Designer** — optionally enhance a deterministic `TestModel`
  with validated, explainable AI scenarios while preserving the baseline and recording
  provider, model, rationale, confidence, assumptions, and duplicate provenance (see
  [AI Test Scenario Designer](#ai-test-scenario-designer) below).
- **AP-006: Test Scenario Review** — inspect a generated `TestModel` in one workspace, accept
  or reject individual scenarios, edit or regenerate AI-derived suggestions, and produce the
  approved `TestModel` that later artifact-generation features consume (see
  [Test Scenario Review](#test-scenario-review) below).
- **AP-007: Postman Collection Generator** — export the scenarios accepted in review as a
  runnable Postman collection, a companion environment, and a README describing coverage
  and limitations, deterministically and with no credential written into the collection
  (see [Postman Collection Generator](#postman-collection-generator) below).

## Setup

Prerequisites:

- Node.js 20 LTS (see [.nvmrc](./.nvmrc); `node --version`)
- npm (bundled with Node.js)

```powershell
npm install
```

Installs dependencies for every workspace (`backend/`, `frontend/`,
`packages/shared-domain`) in a single step.

Optionally copy [.env.example](./.env.example) to `.env` to override the default ports
(`BACKEND_PORT`, `FRONTEND_DEV_PORT`) or the AI provider settings (`AI_PROVIDER_MODE`,
`AI_MODEL_ID`, `AI_MODEL_CACHE_DIR`, `AI_INFERENCE_TIMEOUT_MS`, `AI_USE_ACCELERATOR`) —
see [AI Provider & Local Inference Foundation](#ai-provider--local-inference-foundation).

## Running the application

```powershell
npm run dev
```

This starts the backend and frontend dev servers in parallel:

- Backend: `http://localhost:4000` (health check at `GET /api/health`)
- Frontend: `http://localhost:5173` (opens the ApiPilot UI, proxies `/api/*` to the
  backend, so no CORS configuration is needed in development)

Stopping (`Ctrl+C`) and re-running `npm run dev` returns the application to the same
working state.

## Architecture

The repository is an npm-workspaces monorepo with three packages:

- `backend/` — Express + TypeScript HTTP API.
  - `src/app.ts` — Express app assembly: middleware, route registration, centralized
    error-handling middleware (never leaks stack traces; always returns a safe JSON
    `5xx` body).
  - `src/server.ts` — process entry point; reads configuration and starts the HTTP
    listener; handles startup failures (port in use, unsupported Node.js version)
    with actionable error messages.
  - `src/api/` — one file per route module (e.g., `health.ts`, `version.ts`).
- `frontend/` — React 18 + Vite 5 + TypeScript UI shell.
  - `src/App.tsx` — root component; shows backend connection status and a
    connection-error state if the backend is unreachable.
  - `src/services/` — API clients (e.g., `healthClient.ts`) that call the backend.
  - `src/components/` — reusable UI components (e.g., `VersionBadge.tsx`).
- `packages/shared-domain/` — framework-agnostic TypeScript types and small pure
  functions shared by both `backend/` and `frontend/` (e.g., `HealthStatus`,
  `VersionInfo`), imported as the `@apipilot/shared-domain` workspace package.

New backend routes and new shared types can be added without modifying unrelated
frontend/backend/shared files — see `backend/src/api/version.ts` and the `VersionInfo`
type in `packages/shared-domain/src/index.ts` for a worked example.

### OpenAPI Specification Engine module boundaries

The specification-analysis pipeline lives entirely in `backend/src/openapi/` and is kept
independent of Express so each stage is unit-testable in isolation:

- `parseYaml.ts` — YAML text → plain object; throws a typed `InvalidYamlError` on
  malformed input.
- `validateSpec.ts` — rejects non-OpenAPI-3.x documents via a typed
  `UnsupportedVersionError`; strips and flags external `$ref`s (never fetched over the
  network or filesystem); dereferences internal `$ref`s; flags any that remain
  unresolved or circular.
- `buildApiModel.ts` — walks the validated document to discover every operation and
  produce the `ApiModel` (operations, security schemes, and an `AnalysisSummary`),
  flagging duplicate operations and unsupported constructs (`callbacks`, `links`,
  `discriminator`, `oneOf`/`anyOf`/`allOf`, `webhooks`) instead of rejecting the upload.
- `errors.ts` — the typed error classes above, mapped to HTTP status codes by
  `app.ts`'s centralized error-handling middleware.

`backend/src/api/specifications.ts` wires these three stages together behind
`POST /api/specifications` (see [contracts/specifications-api.md](./specs/002-openapi-specification-engine/contracts/specifications-api.md)).
The `ApiModel` shape itself (`ApiModel`, `ApiOperation`, `Parameter`, `RequestBody`,
`Response`, `SchemaConstraint`, `SecurityRequirement`, `SecuritySchemeDefinition`,
`AnalysisSummary`, `AnalysisIssue`) is defined once in
`packages/shared-domain/src/apiModel.ts` and consumed unchanged by both the backend
pipeline and the frontend upload page.

## Testing

```powershell
npm test
```

Runs [Vitest](https://vitest.dev) once across all three workspaces (via
[vitest.workspace.ts](./vitest.workspace.ts)):

- `backend` — integration tests (Supertest against the Express app)
- `frontend` — component tests (React Testing Library, jsdom environment)
- `shared-domain` — unit tests

Output is grouped and labeled per workspace (e.g., `|backend|`, `|frontend|`,
`|shared-domain|`), so pass/fail results are easy to attribute. Re-running `npm test`
with no code changes produces identical results.

## Other scripts

- `npm run build` — builds all workspaces (TypeScript compilation; Vite production
  build for the frontend)
- `npm run lint` — runs ESLint across the repository
- `npm run ai:benchmark -w backend` — runs the AI model-selection benchmarking harness
  (downloads candidate models on first run; see
  [AI Provider & Local Inference Foundation](#ai-provider--local-inference-foundation))
- `npm run test:ai-real -w backend` — runs the opt-in real-model integration test
  (downloads and loads the configured model; excluded from the default `npm test` run)

## OpenAPI Specification Engine

Upload an OpenAPI 3.x YAML specification (up to 10 MB) and receive a normalized,
read-only analysis — no data is persisted beyond the request.

1. Start the app with `npm run dev` and open the frontend at
   `http://localhost:5173`.
2. Under "Upload OpenAPI Specification", choose a `.yaml`/`.yml` file.
3. On success, the page shows an analysis summary (operation count, schema count,
   security scheme count, and any flagged issues), a list of discovered operations, and
   — once an operation is selected — its parameters, request body, responses, and
   security requirements.

Uploads are rejected (with a specific error) only for:

- Malformed YAML (`400 invalid_yaml`)
- A document that is not OpenAPI 3.x, e.g. Swagger 2.0 (`400 unsupported_version`)
- A file over the 10 MB limit (`413 file_too_large`)

Everything else — unresolved `$ref`s, circular references, external references, and
duplicate `operationId`/path+method combinations — is accepted and flagged as an
`AnalysisIssue` in the summary rather than rejecting the upload, since these are
ambiguities in the source specification, not reasons to fail. See
[specs/002-openapi-specification-engine/](./specs/002-openapi-specification-engine/)
for the full spec, plan, and API contract.

## Deterministic Test Designer

After uploading a specification, click **"Generate Baseline Test Suite"** to deterministically
generate a `TestModel` — a framework-independent list of `TestScenario`s — from the analyzed
`ApiModel`. No AI/LLM and no randomness are involved anywhere in this pipeline: every scenario
and every generated value is produced by a fixed rule evaluated against the specification's own
declared constraints.

### Module boundaries

The rule-evaluation pipeline lives entirely in `backend/src/testDesign/`, independent of Express:

- `valueGenerators.ts` — deterministic synthetic values: specification-conformant, incompatible-type,
  format/pattern-violating, enum-violating, and boundary-adjacent (below/at/above) numeric, string, and
  array values.
- `requestHelpers.ts` — builds a fully conformant base `GeneratedRequest` for an operation and provides
  dotted-path get/set/delete helpers plus a depth-guarded recursive field walker for nested request bodies.
- `assertions.ts` — selects the expected `status-code`/`schema-conformance` assertions for positive and
  negative scenarios from the operation's own documented responses, or returns an explicit gap
  (empty assertions + a `Provenance.description`) when no applicable documented response exists.
- `rules/` — one rule module per scenario category (`positiveScenario.ts`, `requiredFieldScenarios.ts`,
  `invalidTypeScenarios.ts`, `invalidFormatScenarios.ts`, `invalidEnumScenarios.ts`,
  `numericBoundaryScenarios.ts`, `stringBoundaryScenarios.ts`, `arrayBoundaryScenarios.ts`), each an
  independently unit-testable pure function `(operation) => TestScenario[]`.
- `deduplicate.ts` — merges scenarios sharing an identical request and assertions within the same
  operation, keeping one representative and recording every merged rule in its `Provenance.duplicateOfRules`.
- `generateTestModel.ts` — the orchestrator: iterates every operation, skips ones flagged with an
  unresolved-ref/unsupported-construct issue rather than fabricating a scenario, runs every rule module,
  and deduplicates the result.

`backend/src/api/testModels.ts` wires this pipeline behind `POST /api/test-models` (see
[contracts/test-models-api.md](./specs/003-deterministic-test-designer/contracts/test-models-api.md)).
The `TestModel`/`TestScenario`/`ScenarioCategory`/`GeneratedRequest`/`Assertion`/`Provenance` types are
defined once in `packages/shared-domain/src/testModel.ts`.

### Understanding a scenario

Each `TestScenario` carries:

- `category` — which rule family produced it (e.g. `missing-field`, `invalid-enum`, `numeric-boundary`).
- `request` — the exact `GeneratedRequest` (path/query/header parameters and body) to send.
- `assertions` — the expected `status-code`/`schema-conformance` outcome(s), taken only from what the
  specification itself documents. An **empty `assertions` array is not a bug** — it means the operation
  did not document an applicable response (e.g. no 4xx documented for a negative scenario), and the gap is
  explained in `provenance.description` rather than a status code being invented.
- `provenance` — `{ source: "RULE", rule, description, duplicateOfRules }`, identifying exactly which
  deterministic rule produced the scenario and which other rules would have produced an identical one
  (merged via dedup).

The frontend's `TestScenarioList` groups scenarios by operation and category (FR-016); selecting one
shows its full detail via `TestScenarioDetail`, including the rule, request, and assertions/gap above. See
[specs/003-deterministic-test-designer/](./specs/003-deterministic-test-designer/) for the full spec,
plan, and API contract.

## AI Test Scenario Designer

AP-005 adds a stateless enhancement step after deterministic test generation. It asks the
configured `AIProvider` for structured scenario candidates, validates each candidate against
the normalized `ApiModel`, and merges only executable, non-duplicate scenarios into the
caller-supplied `TestModel`.

The HTTP boundary is:

```text
POST /api/test-models/enhance
Content-Type: application/json
```

Send the normalized models produced by AP-002 and AP-003:

```json
{
  "apiModel": { "operations": [] },
  "testModel": { "scenarios": [] }
}
```

The response contains the enhanced model plus candidate outcome partitions:

- `added` — validated AI scenarios added to the executable model.
- `deduplicated` — valid candidates equivalent to a retained deterministic or AI scenario.
- `rejected` — candidates with malformed structure or invalid metadata.
- `nonExecutable` — structurally valid candidates that reference unsupported API elements.

AI scenarios use `provenance.source: "AI"` and include their candidate identity, provider,
model, rationale, confidence, assumptions, and duplicate information. Deterministic RULE
provenance remains distinct, and deterministic scenarios are retained first when an equivalent
AI scenario is supplied.

Provider failures return `200` with the unchanged deterministic model and an explicit
`aiProviderOutcome` such as `unavailable`, `timeout`, or `invalid-response`. Invalid request
shapes return `400`; non-POST methods return `405`. AP-005 does not execute, approve, persist,
or generate artifacts from scenarios, and does not send specifications or prompts to a cloud
provider.

The enhancement contract and focused validation steps are documented in
[specs/005-ai-test-scenario-designer/](./specs/005-ai-test-scenario-designer/), including the
[API contract](./specs/005-ai-test-scenario-designer/contracts/enhanced-test-models-api.md) and
[quickstart](./specs/005-ai-test-scenario-designer/quickstart.md).

## AI Provider & Local Inference Foundation

AI-powered features run entirely on the local machine by default — no prompt or response
content is ever sent to a cloud API, and requests never silently fall back to a cloud
provider on failure. This foundation introduces the `AIProvider` abstraction that all
future AI-enhanced features (e.g. AP-005) will depend on, plus the infrastructure needed
to develop and test against it without a real model.

- **`AI_PROVIDER_MODE`** (`local` | `mock`) selects the active provider; defaults to
  `mock` during automated tests (`NODE_ENV=test`/Vitest) and `local` otherwise.
- **`GET /api/ai/status`** reports the current readiness state (`not-loaded`, `loading`,
  `ready`, or `unavailable`, the latter always with a non-empty `reason`), whether an
  accelerator was requested and whether it is actually active, and the loaded `modelId`
  (see [contracts/ai-status-api.md](./specs/004-ai-provider-local-inference/contracts/ai-status-api.md)).
- The default `npm test` run always exercises the **mock provider** — it derives
  deterministic output from a hash of the request, never touches the network, and never
  loads a real model, so AI-dependent tests are fast and fully reproducible.
- A **benchmarking harness** (`npm run ai:benchmark -w backend`) evaluates a shortlist of
  candidate local models against representative sample workloads and records comparable
  metrics (structured-output success rate, average latency, peak memory) plus a
  traceable selection rationale, so the initial local model is chosen with evidence
  rather than by default.

### Module boundaries

- `backend/src/ai/modelConfig.ts` — env-driven configuration loader (`AI_MODEL_ID`,
  `AI_MODEL_CACHE_DIR`, `AI_INFERENCE_TIMEOUT_MS`, `AI_USE_ACCELERATOR`), mirroring the
  existing `backend/src/config.ts` convention.
- `backend/src/ai/errors.ts` — shared error-response construction from a closed
  `AIErrorCategory` union (`NOT_READY`, `LOAD_FAILED`, `TIMEOUT`, `INVALID_REQUEST`,
  `INVALID_RESPONSE`, `PROVIDER_UNAVAILABLE`).
- `backend/src/ai/readiness.ts` — the readiness state machine; a failed load is never
  auto-retried, only an explicit `retryLoad()` call attempts loading again.
- `backend/src/ai/requestQueue.ts` — an in-process FIFO queue that serializes inference
  calls (no external broker).
- `backend/src/ai/localProvider.ts` — **the only module that imports
  `@huggingface/transformers`**; wraps a local text-generation model with a
  configurable per-request timeout and automatic-with-visible-notice CPU fallback when
  an enabled accelerator is unavailable at runtime.
- `backend/src/ai/mockProvider.ts` — the deterministic test double described above.
- `backend/src/ai/index.ts` — the provider factory that selects `localProvider.ts` or
  `mockProvider.ts` based on `modelConfig.ts`.
- `backend/src/ai/benchmark/` — `workloads.ts` (representative sample prompts),
  `report.ts` (builds and validates a `BenchmarkReport`), and `runBenchmark.ts` (the
  harness entry point, writing results to
  `specs/004-ai-provider-local-inference/benchmark-results.json`).
- `backend/src/api/aiStatus.ts` — the `GET /api/ai/status` route, built as a testable
  `createAiStatusRouter(provider)` factory so tests can inject a fake `AIProvider`.

Every AI request/response type (`InferenceRequest`, `InferenceResponse`, `ReadinessState`,
`ModelConfig`, `AIProvider`, `BenchmarkReport`, etc.) is defined once in
`packages/shared-domain/src/aiProvider.ts` per
[data-model.md](./specs/004-ai-provider-local-inference/data-model.md). See
[specs/004-ai-provider-local-inference/](./specs/004-ai-provider-local-inference/) for the
full spec, plan, research, and API contract.

## Test Scenario Review

AP-006 is a stateless review boundary between deterministic/AI test generation and downstream
artifact generation: it never executes API requests, and accepting a scenario is a review
decision, not execution authorization.

**`POST /api/test-models/reviews`** takes the normalized `ApiModel` (AP-002), a `TestModel`
(AP-003/AP-005), and an optional prior review snapshot plus a batch of `accept`/`reject`
updates, and returns the current review state, an approved `TestModel` view, and a per-update
outcome. The approved view contains only scenarios the reviewer has explicitly **accepted** —
a pending or rejected scenario, regardless of origin, is never represented as approved (FR-009).
A batch applies partially: each update's outcome (`scenario-not-found`,
`invalid-rejection-reason`, `stale-revision`, `duplicate-scenario`, `invalid-edit`,
`policy-requires-review`) is reported independently, so one bad update never blocks the rest.

Two further endpoints refine individual scenarios, each identified by scenario ID and the
caller's observed revision, each returning `409` on a stale revision, and each leaving the
current scenario unchanged on failure:

- **`POST /api/test-models/reviews/edit`** validates a supported edit to a scenario's request or
  assertions against the `ApiModel` before replacing it; a successful edit is marked
  user-modified, returned as `pending`, and keeps the prior content in `history`.
- **`POST /api/test-models/reviews/regenerate`** asks the configured `AIProvider` for a
  replacement for one AI-derived scenario; a successful replacement is returned as `pending` and
  keeps the prior AI provenance in `history`, and a provider failure, timeout, or unsupported
  response leaves the existing scenario untouched with an explicit failure outcome.

Every response redacts sensitive request values (bearer tokens, credential-shaped headers and
body fields) into a separate `displayRequest` for safe rendering, while the round-trippable
`scenario.request` used for hydration and the approved-model projection is left unaltered.
`DEFAULT_REVIEW_POLICY` marks `AI` and `USER`-modified origins as requiring explicit review; a
scenario's `summary.requiresReview` count reflects this, but approval always requires an
explicit accept regardless of origin.

### Module boundaries

- `backend/src/testDesign/reviewTestModel.ts` — the review workspace state machine: hydrating a
  workspace from a caller-supplied snapshot, applying accept/reject updates and edits, computing
  summary counts, and projecting the approved `TestModel` (deduplicated via the same
  `deduplicate.ts` key used by AP-003).
- `backend/src/testDesign/regenerateReviewScenario.ts` — requests one AI replacement scenario
  through the existing `AIProvider` boundary and validates it before it can replace the current
  scenario.
- `backend/src/testDesign/sensitiveValueDetection.ts` — credential-detection predicates shared
  with AP-007's export redaction, so one definition of "this value is a credential" serves both.
- `backend/src/testDesign/reviewSensitiveValues.ts` — builds the redacted `displayRequest` from
  those predicates.
- `backend/src/api/testScenarioReviews.ts` — wires the three endpoints above behind
  `createTestScenarioReviewsRouter(provider)`, injectable for tests.
- `frontend/src/pages/TestScenarioReviewPage.tsx` and its `TestScenarioReview*` components
  (`List`, `Summary`, `Detail`, `Decision`, `Refinement`) — the review workspace UI, including
  loading, empty, success, and error states, and the entry point to AP-007's export panel once
  scenarios are accepted.

The `ReviewState`, `ReviewScenario`, `ReviewDecision`, `ReviewPolicy`, `ReviewSummary`, and
`ReviewWorkspace` types are defined once in `packages/shared-domain/src/testScenarioReview.ts`.
See [specs/006-test-scenario-review/](./specs/006-test-scenario-review/) for the full spec, plan,
data model, [API contract](./specs/006-test-scenario-review/contracts/test-scenario-review-api.md),
and [quickstart](./specs/006-test-scenario-review/quickstart.md).

## Postman Collection Generator

AP-007 turns the scenarios a reviewer accepted into three deliverable artifacts. It is a purely
deterministic transformation: it uses **no AI**, issues **no request** to any API described by the
specification, and retains nothing.

**`POST /api/test-models/postman-collection`** takes the normalized `ApiModel` (AP-002), the
approved `TestModel` (AP-006), and optional export options, and returns all three artifacts in one
response:

- `collection` — one runnable request per approved scenario, grouped into folders derived from the
  operation's tags (falling back to the first path segment, then a single `Ungrouped` folder). Each
  request carries the approved method, path, path/query parameters, headers, and body exactly as
  approved, including values that deliberately violate the schema, and executable checks for
  exactly the assertions the scenario carried.
- `environment` — every variable the collection references, with credential variables typed
  `secret`. Supplied values appear here and nowhere else.
- `readme` — coverage, folder organization, counts by origin, the variables to supply, how to run
  the artifacts, and every recorded limitation.

Alongside them, `validation` reports the pre-delivery check, `limitations` reports what could not
be expressed, and `summary` reports the request, folder, and per-origin counts.

**Variables, never values.** Every request URL is built from `{{baseUrl}}`; the specification
carries no server address and none is invented. Declared security schemes map to `{{token}}`,
`{{username}}`/`{{password}}`, or `{{apiKey}}`; schemes the export cannot configure (such as
`oauth2`) are recorded as limitations rather than substituted with a plausible-looking guess. A
credential found in an approved request is replaced by a variable reference so the request still
runs. `collection.variable` declares every variable with an empty value, so no value ever lives in
the collection artifact.

**Refusals, not broken artifacts.** An empty approved model, a scenario referencing an unknown
operation, a supplied value for a variable the collection does not reference, and a model carrying
multi-step workflow intent are each refused with `400` and an explicit code. A collection that
fails the pre-delivery check is refused with `500 collection_validation_failed` and its artifacts
are withheld — an invalid artifact is never presented as a successful export. Recorded limitations
never block an export.

**Determinism.** Item ids are a SHA-256 digest of the scenario id and the collection id a digest of
the approved scenario set, so identical input produces byte-identical artifacts and removing one
accepted scenario changes only that scenario's request. Ordering uses a fixed code-unit comparison
rather than `localeCompare`, so output does not vary with the runtime's locale data.

### Module boundaries

- `backend/src/postman/generateCollection.ts` — the whole transformation: refusals, grouping,
  variable aggregation, the validation gate, and artifact assembly.
- `backend/src/postman/requestItem.ts` — one approved scenario to one request, including URL
  composition, body content type re-derived from the `ApiModel`, and credential substitution.
- `backend/src/postman/assertionScripts.ts` — assertions to executable checks, plus
  `SchemaConstraint` to JSON Schema, copying only constraints the specification declared.
- `backend/src/postman/authMapping.ts` — declared security schemes to collection auth.
- `backend/src/postman/folders.ts`, `ordering.ts`, `identifiers.ts`, `artifactVariables.ts` — the
  grouping, ordering, identifier, and variable-declaration primitives that make the output stable.
- `backend/src/postman/validateCollection.ts` — the pre-delivery check over the emitted subset of
  the v2.1.0 format; problems name a location and an expectation, never a payload or a value.
- `backend/src/postman/environment.ts`, `readme.ts` — the companion environment and the
  accompanying document.
- `backend/src/testDesign/sensitiveValueDetection.ts` — credential-detection predicates shared with
  AP-006's review redaction, so one definition of "this value is a credential" serves both.
- `frontend/src/components/PostmanExportPanel.tsx` and
  `frontend/src/services/postmanCollectionsClient.ts` — the export action, its loading, success,
  empty, and failure states, and the three downloads.

The export renders single-operation scenarios only. Multi-step workflow rendering waits on AP-008,
which owns the workflow contract; a model carrying workflow intent is refused explicitly rather
than flattened into unrelated requests. See
[specs/007-postman-collection-generator/](./specs/007-postman-collection-generator/) for the spec,
plan, research, [API contract](./specs/007-postman-collection-generator/contracts/postman-collection-api.md),
and [quickstart](./specs/007-postman-collection-generator/quickstart.md).

## API Dependency & Integration Workflow Engine

AP-008 analyzes a normalized `ApiModel` for relationships between operations — where one
operation's response can plausibly supply a value another operation consumes — and assembles the
confident ones into ordered, multi-step integration workflows. It introduces no frontend page;
relationship/workflow review and approval are delegated to AP-006's extension.

**`POST /api/api-models/dependencies`** takes the `ApiModel` (AP-002, no `TestModel` involved) and
returns the full analysis in one response:

- `graph.relationships` — every candidate relationship found, each classified `CONFIRMED`,
  `LIKELY`, or `POSSIBLE` and carrying an `explanation` that names its specific evidence
  (deterministic) or its model/confidence/rationale (AI-derived).
- `workflows` — ordered `IntegrationWorkflow`s assembled from `CONFIRMED`/`LIKELY` relationships,
  each step naming the variables it produces and consumes and tracing back to the relationships
  that produced it.
- `manualConfirmationCandidates` — `POSSIBLE` relationships, relationships excluded by producer
  disambiguation, and chains that would exceed the step limit — reported for human confirmation
  rather than silently included or discarded.
- `cycles` — contradictory relationship sets (each operation depending on the other), reported
  explicitly rather than assembled into an invalid workflow.
- `aiOutcome` — `success`, `unavailable`, `timeout`, `invalid-response`, or `skipped`, so an AI
  provider that is absent, slow, or wrong never fails the request or fabricates a relationship
  (FR-018); deterministic relationships are always returned regardless.

**Conservative by construction (constitution XV).** A field-name match alone can never reach
`CONFIRMED` or `LIKELY`; deterministic classification requires corroborating evidence (matching
type, format, a shared resource path, or a shared tag), and an AI-only relationship is capped at
`LIKELY` even at high reported confidence — never `CONFIRMED` from inference alone. When both the
deterministic and AI passes independently find the same field pair, they merge into one
relationship that keeps the deterministic classification primary and records the AI output as
corroboration only (FR-006a).

**Never fabricated, never silently dropped.** No operation or field is invented: an AI candidate
referencing one the `ApiModel` does not contain is rejected before it can appear in a result
(FR-008). Cycles, low-confidence relationships, and disambiguation losers are always visible
somewhere in the response, never discarded.

**Determinism and performance.** The deterministic relationships, classifications, and assembled
workflows are identical for identical input, including under shuffled operation order. A
200-operation `ApiModel` completes full analysis — deterministic matching, one AI-assisted pass,
and workflow assembly — in under 15 seconds, or fails explicitly with `500 analysis_timeout` rather
than returning a partial result; the AI call itself uses an 8-second request-scoped timeout so a
slow or unavailable provider cannot exhaust that budget. No request is ever issued to any API
described by the `ApiModel`.

### Module boundaries

- `backend/src/dependencies/fieldExtraction.ts` — candidate producer fields (2xx responses only)
  and candidate consumer fields (parameters and request-body fields), reusing the same
  `walkFields` traversal AP-003 already established.
- `backend/src/dependencies/deterministicMatching.ts` — the five-signal evidence computation and
  the exhaustive classification table.
- `backend/src/dependencies/aiDependencyPrompt.ts`, `parseAIDependencyResponse.ts`,
  `validateAIDependencyCandidate.ts` — the AI-assisted pass: one batched request, response
  parsing, and shape/semantic validation against the `ApiModel`.
- `backend/src/dependencies/mergeRelationships.ts` — producer disambiguation (FR-013a) and the
  deterministic/AI merge rule (FR-006a).
- `backend/src/dependencies/buildDependencyGraph.ts` — the operation-level graph and Kahn's-
  algorithm cycle detection.
- `backend/src/dependencies/assembleWorkflows.ts` — bounded maximal-path enumeration into ordered
  workflows, plus the manual-confirmation and chain-length-exceeded reporting.
- `backend/src/dependencies/analyzeDependencies.ts` — orchestrates the full pipeline and the
  explicit performance-budget guard.
- `backend/src/dependencies/identifiers.ts` — content-derived, deterministic ids.

See [specs/008-dependency-workflow-engine/](./specs/008-dependency-workflow-engine/) for the spec,
plan, research,
[API contract](./specs/008-dependency-workflow-engine/contracts/api-dependency-workflow-api.md),
and [quickstart](./specs/008-dependency-workflow-engine/quickstart.md).

## License

Released under [MIT](/LICENSE) by [@io-anurag](https://github.com/io-anurag).
