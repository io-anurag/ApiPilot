# Implementation Plan: Deterministic Test Designer

**Branch**: `003-deterministic-test-designer` | **Date**: 2026-08-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-deterministic-test-designer/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Build the deterministic engine that turns an analyzed specification's `ApiModel` into a
baseline, framework-independent `TestModel`: a positive scenario per operation, plus
missing/null/empty-value, invalid-type, invalid-format, invalid-enum, and numeric/string/
array boundary scenarios for every applicable field and parameter (including fields nested
at any depth in the request body, and a location-appropriate reduced set for path
parameters), each carrying deterministic response assertions and rule provenance, with
per-operation deduplication of equivalent scenarios. No AI/LLM inference is used anywhere
in this feature (constitution II, XIV). Because the existing `ApiModel.SchemaConstraint`
(from AP-002) does not yet capture `minLength`/`maxLength`/`minItems`/`maxItems`, this
feature also extends that extraction to supply the missing boundary data the Deterministic
Test Designer needs.

## Technical Context

**Language/Version**: TypeScript 5.x throughout, running on Node.js 20 LTS (backend) and
compiled to ES2022 for the browser bundle (frontend) — same stack established by AP-001/AP-002

**Primary Dependencies**: None new. Scenario/value generation is plain deterministic
TypeScript (no fuzzing/property-testing library, no new HTTP client); scenario IDs use
Node's built-in `crypto.randomUUID()`. No new frontend dependencies beyond the existing
React/Vite stack.

**Storage**: N/A — a `TestModel` is generated in-memory for a single request from a
caller-supplied `ApiModel` and is not persisted, consistent with AP-002's "no persistence"
decision and constitution XVII (avoid unnecessary persistence)

**Testing**: Vitest (unit tests per rule module), Supertest for the new backend
integration test, React Testing Library for the frontend baseline-suite view

**Target Platform**: Local developer machine (Windows/macOS/Linux), same as AP-001/AP-002;
no new platform requirements

**Project Type**: Web application — extends AP-001/AP-002's `backend/`, `frontend/`, and
`packages/shared-domain/` workspaces; no new workspaces are introduced

**Performance Goals**: A typical analyzed specification (50-100 operations) has its
baseline `TestModel` generated in under 30 seconds (SC-001)

**Constraints**: No AI/LLM inference (FR-014); every generated scenario must be traceable
to a documented status code/schema already present in the `ApiModel` (FR-008, FR-010,
SC-006) — assertions are never fabricated when no applicable documented response exists
(see research.md); deduplication is scoped per operation (spec.md Assumptions); must
continue to run fully offline/local, consistent with AP-001/AP-002

**Scale/Scope**: Single local user, one `ApiModel` processed per request; semantic/
business-rule scenario generation is explicitly out of scope (covered by the later AI Test
Scenario Designer feature, AP-005)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Specification Is the Source of Truth | PASS | Every generated scenario, value, and assertion derives only from fields/constraints/status codes already present in the `ApiModel` (FR-008, FR-010, FR-015, SC-006); nothing is fabricated |
| II. Deterministic Before AI | PASS | 100% of scenario/value/assertion generation is deterministic (FR-014); no AI is involved |
| III–VII. AI structured output / local-first / provider independence / model selection | N/A | No AI functionality in scope for this feature |
| VIII. Framework-Independent Test Model | PASS | This feature defines the core `TestModel`/`TestScenario`/`Assertion` domain types with no Postman (or any artifact-format) dependency, per roadmap `ApiModel → TestModel` |
| IX. Separation of Concerns | PASS | Rule evaluation, value generation, assertion building, and deduplication are separated into distinct modules independent of the HTTP/UI layers |
| X. Domain Model First | PASS | `TestModel`, `TestScenario`, `ScenarioCategory`, `Assertion`, `Provenance` are added to `packages/shared-domain`, framework-independent, reused by backend and frontend |
| XI. Human-in-the-Loop | N/A | Scenario review/approval is a later feature (AP-006); this feature only produces the baseline `TestModel` |
| XII. Quality Over Quantity | PASS | Per-operation deduplication (FR-012) and "no basis, no scenario" (FR-015) keep the suite meaningful rather than exhaustive-but-noisy |
| XIII. Test Provenance and Traceability | PASS | Every scenario carries a `Provenance.rule` value (FR-013), distinguishing it as `RULE`-sourced from any future `AI`/`USER` scenario |
| XIV. No Silent Assumptions | PASS | Negative scenarios whose operation has no documented error response are surfaced with an explicit assertion gap rather than fabricating a status code (see research.md); unresolved/unsupported constructs are skipped and reported (FR-018) |
| XV. API Dependency Inference Must Be Conservative | N/A | Dependency inference is a later feature (AP-008) |
| XVI. Executable Artifacts Must Be Deterministic | PASS | The same `ApiModel` input always produces an equivalent `TestModel` output; no randomness beyond scenario `id` generation, which does not affect scenario content |
| XVII. Security and Privacy by Design | PASS | No new persistence, no new file upload surface; the new endpoint accepts an already-validated `ApiModel` shape only |
| XVIII. Secrets Must Never Be Part of Generated Artifacts | PASS | Generated request values for security-related fields use synthetic placeholder values, never real credentials (this feature does not collect or handle real secrets) |
| XIX. Fail Safely | PASS | When no documented basis exists for an assertion or scenario category, the system omits it and reports the gap rather than inventing one (FR-015, FR-018) |
| XX. Observability Without Sensitive Logging | PASS | No new logging of request bodies/specs is introduced beyond AP-001/AP-002's existing error-handling conventions |
| XXI. Testability at Every Boundary | PASS | Each rule module (positive, required-field, invalid-type, invalid-format, invalid-enum, boundary categories, assertions, dedup) is independently unit-testable; an integration test covers the new endpoint end-to-end |
| XXII–XXIV. AI evaluation / versioned AI contracts / reproducibility | N/A (AI parts) / PASS (reproducibility) | No AI involved; deterministic generation is inherently reproducible for the same `ApiModel` input |
| XXV. Incremental Delivery | PASS | Third increment in the roadmap's incremental sequence (Deterministic Test Intelligence), independently testable and demonstrable |
| XXVI. Specification Traceability | PASS | This plan traces to spec.md, which traces to roadmap AP-003 and the constitution |
| XXVII. Prefer Simple Architecture | PASS | Pure, dependency-free TypeScript rule modules; no new infrastructure, queues, or external services |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | PASS | `TestModel`/`TestScenario`/`Assertion`/`Provenance` are the stable domain concepts; no artifact-format (Postman, etc.) concepts leak into them |

**Initial Constitution Check: PASS** — no violations; Complexity Tracking is empty.

**Post-Design Constitution Check (after Phase 1)**: PASS — `data-model.md` defines only
framework-independent domain types (no Postman/artifact concepts), `contracts/test-models-api.md`
defines a minimal, non-speculative endpoint that accepts/returns those types, and
`quickstart.md` requires no AI/cloud credentials. The `SchemaConstraint` extension
(`minLength`/`maxLength`/`minItems`/`maxItems`) is an additive, backward-compatible change
to an existing domain type, not a new architectural concept. No new violations were
introduced by the Phase 1 design; Complexity Tracking remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-deterministic-test-designer/
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
│   │   └── testModels.ts         # POST /api/test-models (ApiModel -> TestModel)
│   ├── openapi/
│   │   └── buildApiModel.ts      # extended: extract minLength/maxLength/minItems/maxItems
│   ├── testDesign/
│   │   ├── generateTestModel.ts  # ApiModel -> TestModel (orchestrates rules + dedup)
│   │   ├── rules/
│   │   │   ├── positiveScenario.ts
│   │   │   ├── requiredFieldScenarios.ts   # missing/null/empty, recursive + parameter-aware
│   │   │   ├── invalidTypeScenarios.ts
│   │   │   ├── invalidFormatScenarios.ts   # format/pattern violations
│   │   │   ├── invalidEnumScenarios.ts
│   │   │   ├── numericBoundaryScenarios.ts
│   │   │   ├── stringBoundaryScenarios.ts
│   │   │   └── arrayBoundaryScenarios.ts
│   │   ├── assertions.ts         # documented-response-based assertion selection
│   │   ├── valueGenerators.ts    # deterministic synthetic value helpers per type/format
│   │   └── deduplicate.ts        # per-operation scenario deduplication
│   └── app.ts                    # existing Express app, extended with the test-models route
└── tests/
    ├── unit/
    │   ├── openapi/               # buildApiModel boundary-field extraction tests
    │   └── testDesign/            # one test file per rule module + assertions + dedup
    └── integration/
        └── testModels.test.ts     # Supertest: ApiModel -> TestModel end-to-end

frontend/
├── src/
│   ├── pages/
│   │   └── SpecificationUploadPage.tsx   # extended: "Generate Baseline Test Suite" action
│   ├── components/
│   │   ├── TestScenarioList.tsx          # scenarios grouped by operation + category
│   │   └── TestScenarioDetail.tsx        # request, assertions, provenance for one scenario
│   └── services/
│       └── testModelsClient.ts           # calls POST /api/test-models
└── tests/
    └── unit/

packages/
└── shared-domain/
    └── src/
        ├── apiModel.ts    # extended: SchemaConstraint gains minLength/maxLength/minItems/maxItems
        └── testModel.ts   # TestModel, TestScenario, ScenarioCategory, GeneratedRequest,
                            # Assertion, Provenance types
```

**Structure Decision**: Extends the existing AP-001/AP-002 web application layout — no new
workspaces. Deterministic rule/value/assertion logic is isolated in a new
`backend/src/testDesign/` module (constitution IX, Separation of Concerns), one file per
rule so each is independently unit-testable (constitution XXI). The resulting domain types
are added to `packages/shared-domain` (constitution X) alongside a minimal, additive
extension to the existing `ApiModel.SchemaConstraint` type so the frontend and backend
share identical shapes without duplication.

## Complexity Tracking

> No Constitution Check violations were identified for this feature; this table is
> intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
