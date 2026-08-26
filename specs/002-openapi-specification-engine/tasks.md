---

description: "Task list template for feature implementation"
---

# Tasks: OpenAPI Specification Engine

**Input**: Design documents from `/specs/002-openapi-specification-engine/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required for user stories), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: This feature is a deterministic parsing/validation/extraction pipeline governed
by constitution XXI (Testability at Every Boundary) and XIV (No Silent Assumptions), so
test tasks are included for each pipeline stage and for the upload contract, in addition to
the acceptance-scenario-driven tests per user story.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Extends the AP-001 web application monorepo (per [plan.md](./plan.md) Project Structure):

- `backend/src/openapi/`, `backend/src/api/`, `backend/tests/`
- `frontend/src/pages/`, `frontend/src/components/`, `frontend/src/services/`, `frontend/tests/`
- `packages/shared-domain/src/`, `packages/shared-domain/tests/`
- Root: `README.md`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add new dependencies and test fixtures needed before any parsing logic exists

- [X] T001 [P] Add backend dependencies `js-yaml`, `@apidevtools/swagger-parser`, `multer`, and their type packages (`@types/js-yaml`, `@types/multer`) to `backend/package.json`
- [X] T002 [P] Create fixture specifications in `backend/tests/fixtures/openapi/`: `valid.yaml` (well-formed OpenAPI 3.x), `invalid-yaml.txt` (corrupted/non-YAML content), `unsupported-version.yaml` (Swagger 2.0), `circular-ref.yaml`, `unresolved-ref.yaml`, `external-ref.yaml`, `duplicate-operation-id.yaml`

**Checkpoint**: Dependencies installable and fixtures available for all later test tasks

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core parsing/validation infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Define `ApiModel` domain types (`ApiModel`, `ApiOperation`, `Parameter`, `RequestBody`, `Response`, `SchemaConstraint`, `SecurityRequirement`, `SecuritySchemeDefinition`, `AnalysisSummary`, `AnalysisIssue`) in `packages/shared-domain/src/apiModel.ts` per [data-model.md](./data-model.md)
- [X] T004 [P] Implement `parseYaml.ts` in `backend/src/openapi/parseYaml.ts`: YAML text → object, throwing a typed `InvalidYamlError` on parse failure (FR-002, FR-004) (depends on T001)
- [X] T005 Implement `validateSpec.ts` in `backend/src/openapi/validateSpec.ts`: reject documents whose `openapi` field does not start with `"3."` via a typed `UnsupportedVersionError`; pre-scan for external (`$ref` not starting with `#/`) references and record them as issues; use `swagger-parser` to dereference internal refs; detect circular references and record them as issues (FR-003, FR-004, FR-005, FR-006; research.md) (depends on T001, T003)
- [X] T006 [P] Configure `multer` middleware (`memoryStorage`, `limits.fileSize` matching the FR-015 default) in `backend/src/uploadMiddleware.ts` (extracted from `app.ts` to avoid a circular import with the specifications route), imported by `app.ts` (depends on T001)
- [X] T007 Extend `backend/src/app.ts` error-handling middleware to map `InvalidYamlError` → 400 `invalid_yaml`, `UnsupportedVersionError` → 400 `unsupported_version`, and multer's file-size error → 413 `file_too_large`, per [contracts/specifications-api.md](./contracts/specifications-api.md) (depends on T004, T005, T006)

**Checkpoint**: Parse + validate pipeline works and is independently unit-testable before any endpoint exists

---

## Phase 3: User Story 1 - Upload and Parse an OpenAPI Specification (Priority: P1) 🎯 MVP

**Goal**: A QA engineer can upload an OpenAPI 3.x YAML file and receive an accepted analysis
summary, or a clear rejection for invalid/unsupported/oversized input.

**Independent Test**: Upload a well-formed spec and confirm an analysis summary is
returned; separately upload an invalid, unsupported-version, and oversized file and confirm
each is rejected with a specific error.

### Tests for User Story 1

- [X] T008 [P] [US1] Integration test for `POST /api/specifications` in `backend/tests/integration/specifications.test.ts` using Supertest: valid spec → 200 with a summary; invalid YAML → 400 `invalid_yaml`; unsupported version → 400 `unsupported_version`; ambiguous refs → 200 with flagged issues, per [contracts/specifications-api.md](./contracts/specifications-api.md) (uses fixtures from T002)

### Implementation for User Story 1

- [X] T009 [US1] Implement `buildApiModel.ts` in `backend/src/openapi/buildApiModel.ts`: from the validated/dereferenced document, discover every operation (path, method, `operationId`) and produce an `AnalysisSummary` (`operationCount`, `schemaCount`, `securitySchemeCount`), carrying forward ref-related issues from `validateSpec` (FR-007, FR-012) (depends on T003, T005)
- [X] T010 [US1] Implement `POST /api/specifications` route in `backend/src/api/specifications.ts` wiring `multer` + `parseYaml` + `validateSpec` + `buildApiModel`, returning the `ApiModel` per [contracts/specifications-api.md](./contracts/specifications-api.md) (depends on T006, T007, T009)
- [X] T011 [US1] Register the specifications route in `backend/src/app.ts` (depends on T010)
- [X] T012 [P] [US1] Implement `specificationsClient.ts` in `frontend/src/services/specificationsClient.ts` calling `POST /api/specifications`
- [X] T013 [US1] Implement `SpecificationUploadPage.tsx` (`frontend/src/pages/`) and `AnalysisSummary.tsx` (`frontend/src/components/`) providing an upload control and displaying summary counts (depends on T012)
- [X] T014 [US1] Document the specification upload/analysis workflow in a new "OpenAPI Specification Engine" section of root `README.md`

**Checkpoint**: User Story 1 is fully functional and independently testable/demoable

---

## Phase 4: User Story 2 - Review Discovered APIs and Extracted Details (Priority: P2)

**Goal**: A QA engineer can browse every discovered operation and drill into its parameters,
request body, responses, and security requirements, matching the source specification
exactly.

**Independent Test**: Upload a specification with known operations and confirm every
discovered operation, parameter, schema, and security requirement shown matches the source
file exactly.

### Tests for User Story 2

- [X] T015 [P] [US2] Unit tests for parameter/request-body/response/security extraction in `backend/tests/unit/openapi/buildApiModel.test.ts`, covering path/query/header/cookie parameters, request body schemas, response schemas per status code, and OR-of-ANDs security requirements

### Implementation for User Story 2

- [X] T016 [US2] Extend `buildApiModel.ts` to extract full per-operation details: parameters, request body, responses per status code, and schema constraints (required fields, types, enums, formats, min/max, patterns) and documented examples (FR-008, FR-009, FR-010) (depends on T015)
- [X] T017 [US2] Extend `buildApiModel.ts` to extract security requirements onto each operation as OR-of-ANDs and populate `ApiModel.securitySchemes` from `components.securitySchemes` (FR-008; research.md "Security requirement representation") (depends on T016)
- [X] T018 [P] [US2] Implement `OperationList.tsx` in `frontend/src/components/` listing discovered operations
- [X] T019 [US2] Implement `OperationDetail.tsx` in `frontend/src/components/` showing parameters, request body, responses, and security requirements for a selected operation (depends on T018)
- [X] T020 [US2] Wire `OperationList`/`OperationDetail` into `SpecificationUploadPage.tsx` after a successful upload (depends on T013, T019)
- [X] T021 [US2] Document the `backend/src/openapi/` module boundaries and `ApiModel` shape in an "Architecture" section of root `README.md`

**Checkpoint**: User Stories 1 AND 2 both work independently

---

## Phase 5: User Story 3 - Understand Specification Ambiguities and Unsupported Constructs (Priority: P3)

**Goal**: A QA engineer sees any part of the specification that could not be fully resolved
or understood clearly flagged, rather than silently omitted.

**Independent Test**: Upload a specification with a deliberately unresolved `$ref`, a
circular reference, or an unsupported construct, and confirm the analysis summary
explicitly calls it out.

### Tests for User Story 3

- [X] T022 [P] [US3] Unit tests for ambiguity detection in `backend/tests/unit/openapi/validateSpec.test.ts` and `backend/tests/unit/openapi/buildApiModel.test.ts`, covering unresolved, circular, and external `$ref`s, and duplicate `operationId`/path+method combinations (uses fixtures from T002)

### Implementation for User Story 3

- [X] T023 [US3] Extend `buildApiModel.ts` to detect duplicate `operationId` values and duplicate path+method combinations, recording each as an `AnalysisIssue` (FR-013; research.md "accept and flag") (depends on T022)
- [X] T024 [US3] Add unsupported-construct detection to `buildApiModel.ts`/`validateSpec.ts` against a documented list of OpenAPI 3.x constructs the engine does not process, recording each as an `AnalysisIssue` (FR-013) (depends on T023)
- [X] T025 [US3] Display `AnalysisSummary.issues` prominently and visually distinct from the success state in `AnalysisSummary.tsx` (depends on T013, T024)
- [X] T026 [US3] Manually validate: upload the `unresolved-ref.yaml` and `circular-ref.yaml` fixtures and confirm each issue is listed with its location (Acceptance Scenarios US3.1, US3.2)

**Checkpoint**: All three user stories are independently functional (SC-002, SC-003, SC-005)

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T027 [P] Add clear frontend error messaging for 413 (`file_too_large`) and 400 (`invalid_yaml`/`unsupported_version`) responses in `SpecificationUploadPage.tsx`
- [X] T028 [P] Add a documented `$ref` resolution safeguard (maximum depth/timeout) in `validateSpec.ts` for deeply nested, non-circular reference chains
- [X] T029 Final pass on root `README.md` for the "OpenAPI Specification Engine" section (setup, architecture, and testing coverage)
- [X] T030 Execute the full [quickstart.md](./quickstart.md) validation checklist end-to-end and confirm every item passes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational completion only
- **User Story 2 (Phase 4)**: Depends on Foundational completion; extends `buildApiModel.ts` and the UI introduced in US1
- **User Story 3 (Phase 5)**: Depends on Foundational completion; extends `buildApiModel.ts`/`validateSpec.ts` and the UI introduced in US1/US2
- **Polish (Phase 6)**: Depends on all three user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies on other stories
- **User Story 2 (P2)**: Builds on the `buildApiModel.ts` and UI shell introduced by US1 (same file, later tasks) — not independently deployable in parallel with US1, but independently testable once its own tasks are done
- **User Story 3 (P3)**: Builds on the same `buildApiModel.ts`/`validateSpec.ts` and UI shell — independently testable once its own tasks are done

### Within Each User Story

- Tests before implementation (T008 before T009-T010; T015 before T016; T022 before T023)
- Shared/domain types before consumers
- Backend extraction logic before frontend consumption of that data
- Story complete before moving to the next priority

### Parallel Opportunities

- T001 and T002 (Setup) can run in parallel
- T004 and T006 (Foundational) can run in parallel once T001 is done
- T008 (US1 test) can be written in parallel with T004-T007 once T002 exists
- T012 (US1 frontend client) can run in parallel with T009-T011 (backend)
- T015 (US2 test) and T018 (US2 frontend list) can run in parallel with each other
- T022 (US3 test) can run in parallel with US1/US2 polish work
- T027 and T028 in Polish can run in parallel

---

## Parallel Example: User Story 1

```bash
# Backend pipeline and frontend client can be built in parallel:
Task: "Implement buildApiModel.ts in backend/src/openapi/buildApiModel.ts"
Task: "Implement specificationsClient.ts in frontend/src/services/specificationsClient.ts"

# Then, within User Story 1:
Task: "Integration test for POST /api/specifications in backend/tests/integration/specifications.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Upload `valid.yaml`, confirm a 200 response with an analysis summary; upload `invalid-yaml.txt`, confirm a clear 400
5. This is a demoable MVP: "ApiPilot understands an uploaded OpenAPI specification"

### Incremental Delivery

1. Complete Setup + Foundational → parsing/validation pipeline ready
2. Add User Story 1 → Validate manually → Demo (MVP!)
3. Add User Story 2 → Validate manually → Demo (full extraction detail proven accurate)
4. Add User Story 3 → Validate manually → Demo (ambiguities are never silently dropped)
5. Polish → Final quickstart validation

### Parallel Team Strategy

With multiple developers, after Setup + Foundational are done:

- Developer A: User Story 1 (upload endpoint + summary UI)
- Developer B: User Story 2 (detailed extraction + operation browsing UI), starting once US1's `buildApiModel.ts`/UI shell exist
- Developer C: User Story 3 (ambiguity detection + issue display), starting once US1's `buildApiModel.ts`/UI shell exist
