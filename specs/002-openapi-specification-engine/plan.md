# Implementation Plan: OpenAPI Specification Engine

**Branch**: `002-openapi-specification-engine` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-openapi-specification-engine/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Build the deterministic engine that turns an uploaded OpenAPI 3.x YAML specification into a
normalized, framework-independent `ApiModel`: parse the YAML, validate it as OpenAPI 3.x,
resolve internal `$ref` references (detecting unresolved/circular/external refs instead of
guessing), discover every operation, and extract parameters, request bodies, responses,
schema constraints, examples, and security requirements exactly as declared. The backend
exposes an upload endpoint and analysis summary; the frontend (built on the AP-001
foundation) lets a QA engineer upload a spec and browse the discovered operations and any
flagged ambiguities. No AI inference is used anywhere in this feature (constitution II, XIV).

## Technical Context

**Language/Version**: TypeScript 5.x throughout, running on Node.js 20 LTS (backend) and
compiled to ES2022 for the browser bundle (frontend) — same stack established by AP-001

**Primary Dependencies**: `js-yaml` (YAML parsing), `@apidevtools/swagger-parser`
(OpenAPI 3.x validation, `$ref` dereferencing, and circular-reference detection — a mature,
widely-used library preferred over a hand-rolled validator per constitution XXVIII),
`multer` with in-memory storage (Express file-upload middleware, enforcing the max file
size at the HTTP boundary) — no new frontend dependencies beyond AP-001's React/Vite stack

**Storage**: N/A — uploaded specifications and the derived `ApiModel` are held in memory
only for the duration of a single analysis request/session and are not persisted to disk or
a database (see research.md Decision: "No persistence"); consistent with constitution XVII
(avoid unnecessary persistence of potentially sensitive specifications)

**Testing**: Vitest (single test runner, per AP-001), Supertest for the backend upload/
analysis integration tests, React Testing Library for the frontend upload and results-view
components

**Target Platform**: Local developer machine (Windows/macOS/Linux), same as AP-001; no new
platform requirements

**Project Type**: Web application — extends AP-001's `backend/`, `frontend/`, and
`packages/shared-domain/` workspaces; no new workspaces are introduced

**Performance Goals**: A typical specification (50-100 operations) is fully parsed,
validated, and analyzed in under 30 seconds (SC-001)

**Constraints**: Uploaded files are capped at a documented maximum size (~10 MB default,
FR-015); only internal (same-document) `$ref` resolution is performed — external file/URL
refs are reported as unresolved, never fetched (FR-005, FR-006); uploaded specification
content is never executed as code (FR-016); no AI/LLM inference is used (FR-014); must
continue to run fully offline/local, consistent with AP-001

**Scale/Scope**: Single local user, single specification analyzed at a time; multi-file
specifications, Swagger 2.0, and JSON-format OpenAPI documents are explicitly out of scope
(see spec.md Assumptions)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Specification Is the Source of Truth | PASS | This feature exists to extract exactly what the OpenAPI document declares, fabricating nothing (FR-009, FR-014, SC-005) |
| II. Deterministic Before AI | PASS | YAML parsing, OpenAPI validation, `$ref` resolution, and extraction are 100% deterministic (FR-014); no AI is involved |
| III–VII. AI structured output / local-first / provider independence / model selection | N/A | No AI functionality in scope for this feature |
| VIII. Framework-Independent Test Model | N/A | `TestModel` is introduced in a later feature (AP-003); this feature only produces `ApiModel` |
| IX. Separation of Concerns | PASS | Parsing, validation, `$ref` resolution, and extraction are separated into distinct modules (`openapi/parseYaml`, `openapi/validateSpec`, `openapi/buildApiModel`), independent of the HTTP and UI layers |
| X. Domain Model First | PASS | `ApiModel` and its constituent types (Operation, Parameter, RequestBody, Response, SchemaConstraint, SecurityScheme, AnalysisSummary) are defined in `packages/shared-domain`, framework-independent, reused by backend and frontend |
| XIV. No Silent Assumptions | PASS | Unresolved/circular/external refs and unsupported constructs are explicitly surfaced (FR-006, FR-013) rather than silently dropped |
| XVII. Security and Privacy by Design | PASS | Documented file-size limit (FR-015), no code execution (FR-016), no unnecessary persistence (Storage: N/A), validated uploads only |
| XIX. Fail Safely | PASS | Invalid/unsupported specs are rejected with clear errors (FR-004); ambiguous constructs are flagged, never fabricated (FR-013) |
| XXI. Testability at Every Boundary | PASS | Each stage (YAML parse → validate → resolve refs → extract → `ApiModel`) is independently unit-testable; integration test covers the upload endpoint end-to-end |
| XXV. Incremental Delivery | PASS | Second increment in the roadmap's incremental sequence (OpenAPI Understanding), independently testable and demonstrable |
| XXVI. Specification Traceability | PASS | This plan traces to spec.md, which traces to roadmap AP-002 and the constitution |
| XXVII. Prefer Simple Architecture | PASS | Reuses mature, standard libraries (`swagger-parser`, `js-yaml`, `multer`) instead of a hand-rolled OpenAPI validator or custom upload handling; no new infrastructure |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | PASS | `swagger-parser`/`js-yaml`/`multer` are implementation details behind the `openapi/` module boundary; `ApiModel` is the stable domain concept |

**Initial Constitution Check: PASS** — no violations; Complexity Tracking is empty.

**Post-Design Constitution Check (after Phase 1)**: PASS — `data-model.md` defines only
framework-independent domain types, `contracts/specifications-api.md` defines a minimal,
non-speculative upload/analysis endpoint, and `quickstart.md` requires no AI/cloud
credentials. No new violations were introduced by the Phase 1 design; Complexity Tracking
remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-openapi-specification-engine/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── api/
│   │   └── specifications.ts   # POST /api/specifications (upload + analyze)
│   ├── openapi/
│   │   ├── parseYaml.ts        # YAML text -> raw JS object (js-yaml)
│   │   ├── validateSpec.ts     # OpenAPI 3.x validation + $ref resolution (swagger-parser),
│   │   │                       # detects unresolved/circular/external refs
│   │   └── buildApiModel.ts    # validated document -> ApiModel (operations, params,
│   │                            # bodies, responses, schemas, security, analysis summary)
│   └── app.ts                  # existing Express app, extended with the upload route
└── tests/
    ├── unit/
    │   └── openapi/            # parseYaml, validateSpec, buildApiModel unit tests
    └── integration/
        └── specifications.test.ts  # Supertest: upload + analyze end-to-end

frontend/
├── src/
│   ├── pages/
│   │   └── SpecificationUploadPage.tsx
│   ├── components/
│   │   ├── AnalysisSummary.tsx      # counts + flagged ambiguities
│   │   ├── OperationList.tsx        # list of discovered operations
│   │   └── OperationDetail.tsx      # parameters/body/responses/security for one operation
│   └── services/
│       └── specificationsClient.ts  # calls POST /api/specifications
└── tests/
    └── unit/

packages/
└── shared-domain/
    └── src/
        └── apiModel.ts   # ApiModel, ApiOperation, Parameter, RequestBody, Response,
                           # SchemaConstraint, SecurityScheme, AnalysisSummary types
```

**Structure Decision**: Extends the existing AP-001 web application layout — no new
workspaces. Parsing/validation/extraction logic is isolated in a new `backend/src/openapi/`
module (constitution IX, Separation of Concerns), while the resulting domain types are
added to `packages/shared-domain` (constitution X, Domain Model First) so the frontend can
render the exact same `ApiModel` shapes the backend produces without duplicating type
definitions.

## Complexity Tracking

> No Constitution Check violations were identified for this feature; this table is
> intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

