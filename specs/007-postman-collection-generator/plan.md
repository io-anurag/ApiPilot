# Implementation Plan: Postman Collection Generator

**Branch**: `007-postman-collection-generator` | **Date**: 2026-09-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-postman-collection-generator/spec.md`

## Summary

AP-007 turns an approved TestModel into three deliverable artifacts — an executable Postman
collection, a companion environment, and a README documenting coverage and limitations — through a
purely deterministic transformation that never calls AI and never issues a request to the API under
test.

The approach: a backend generator module that maps each approved `TestScenario` to one collection
item, deriving grouping from `ApiModel` tags, authentication from declared security schemes, request
body content type from the same helper AP-003 used, and expected-response checks from the assertions
the scenario already carries. Identifiers and ordering are content-derived so repeated exports are
byte-identical and a single review change produces a single-item diff. Artifacts are validated
against the emitted format subset before delivery, and an invalid artifact is refused rather than
returned. Nothing is persisted; a stateless endpoint returns all three artifacts in one response and
the frontend writes them as files.

Two things this plan deliberately does **not** do: it does not vendor the official Postman schema
(deferred, with the trade-off recorded), and it does not render multi-step workflows (AP-008 owns
that contract; workflow-bearing input is refused explicitly rather than flattened).

## Technical Context

**Language/Version**: TypeScript 5.5 on Node.js 20 LTS

**Primary Dependencies**: None added. Generation uses Node's built-in `crypto` for content-derived
identifiers; the existing Express, React, and shared-domain workspaces carry everything else. `ajv@8`
is already in the tree via `@apidevtools/swagger-parser` should schema validation be adopted later.

**Storage**: None. The export is stateless and retains nothing (FR-024).

**Testing**: Vitest across all three workspaces; Supertest for the endpoint; React Testing Library
for the export UI. No AI provider and no model download is involved, so no mock-provider wiring is
needed for this feature's tests.

**Target Platform**: Local developer machine; Node 20 backend and a browser frontend.

**Project Type**: Web application in an npm-workspaces monorepo (backend + frontend + shared domain).

**Performance Goals**: 500 approved scenarios exported in under 10 seconds (SC-010). Generation is a
single linear pass over scenarios plus one sort, so this is comfortable; the test asserts it rather
than assuming it.

**Constraints**: Byte-identical output for identical input (FR-018). No network access during export
(FR-023, SC-012). No credential value in the collection, README, or diagnostics (FR-011, FR-025). No
AI inference anywhere in the feature (FR-019). No fabricated status code, schema, or auth mechanism
(FR-006, FR-009).

**Scale/Scope**: One new shared-domain contract module, one backend generator area (~6 modules), one
endpoint, one frontend service plus one export component, and one small refactor extracting
credential-detection predicates already present in AP-006.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Gate | Status |
| --------- | ---- | ------ |
| I. Specification Is the Source of Truth | No fabricated status code, schema, field, or auth mechanism | PASS — `default` status codes and unsupported auth schemes become recorded limitations, never guesses (research.md; data-model.md assertion table) |
| II. Deterministic Before AI | Artifact generation is entirely deterministic | PASS — no AI path exists in this feature |
| VIII. Framework-Independent Test Model | Postman details stay out of the domain | PASS — `TestModel` is unchanged; Postman types live in a separate `postmanArtifact` contract module consumed only at the artifact boundary |
| IX. Separation of Concerns | Generation isolated from routing and UI | PASS — route adapts input and maps failures; generation, validation, and document rendering are pure modules |
| XII. Quality Over Quantity | No filler output | PASS — one request per approved scenario, no padding, no invented checks |
| XIII. Provenance and Traceability | Artifact traceable to scenario | PASS — item ids are a pure function of scenario id; README reports counts by origin |
| XVI. Executable Artifacts Must Be Deterministic | Same TestModel, equivalent artifact | PASS — content-derived ids, fixed ordering, locale-independent comparison; asserted by a dedicated determinism test |
| XVII. Security and Privacy by Design | No unnecessary persistence, no leakage | PASS — stateless, retains nothing, no payload or credential in diagnostics |
| XVIII. Secrets Never in Generated Artifacts | Variables, not values | PASS — `{{baseUrl}}`, `{{token}}`, `{{apiKey}}`; supplied values only in the environment artifact, typed secret |
| XIX. Fail Safely | Refuse rather than fabricate | PASS — empty approved set, unknown operation, workflow intent, and validation failure are all explicit refusals |
| XX. Observability Without Sensitive Logging | Diagnostics carry no payloads | PASS — validation problems name locations and expectations only |
| XXI. Testability at Every Boundary | Each transformation independently testable | PASS — scenario→item, schema conversion, auth mapping, validation, and README rendering are separately unit-testable pure functions |
| XXIV. Reproducibility | Same input, same output | PASS — asserted directly, including under shuffled input order |
| XXVII. Prefer Simple Architecture | No speculative infrastructure | PASS — zero new dependencies; no archive format, no persistence, no workflow engine |
| XXVIII. Standards Over Custom Code | Do not reinvent standards implementations | PARTIAL — see Complexity Tracking; validation checks the emitted subset rather than the official schema |
| XXIX. Local-First | No external calls | PASS — no network access at generation time |
| XXX. Explicit Trade-offs | Trade-offs documented | PASS — recorded in research.md and Complexity Tracking |

**Post-Phase-1 re-check**: unchanged. The design added no dependency, no persistence, and no AI path.
The single partial gate is unchanged in substance and remains justified below.

## Project Structure

### Documentation (this feature)

```text
specs/007-postman-collection-generator/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── postman-collection-api.md
├── checklists/
│   ├── requirements.md  # Built-in spec-quality checklist
│   └── export.md        # Requirements-quality review checklist (/speckit-checklist)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── postmanArtifact.ts              # Artifact contracts: variables, collection subset,
                                    # environment, limitations, validation report, export result

backend/src/
├── api/
│   └── postmanCollections.ts       # POST /api/test-models/postman-collection; thin adapter
├── postman/
│   ├── generateCollection.ts       # Approved TestModel + ApiModel -> ExportResult
│   ├── requestItem.ts              # One scenario -> one collection item (URL, headers, body)
│   ├── assertionScripts.ts         # Assertions -> test script; SchemaConstraint -> JSON Schema
│   ├── authMapping.ts              # SecuritySchemeDefinition -> collection auth + variables
│   ├── folders.ts                  # Grouping, naming, disambiguation
│   ├── ordering.ts                 # Locale-independent comparator, sort keys, serializer
│   ├── artifactVariables.ts        # Canonical ArtifactVariable declarations
│   ├── environment.ts              # ArtifactVariable set -> environment artifact
│   ├── readme.ts                   # ExportResult -> accompanying document
│   ├── validateCollection.ts       # Pre-delivery validation of the emitted subset
│   └── identifiers.ts              # Content-derived, deterministic ids
└── testDesign/
    └── sensitiveValueDetection.ts  # Extracted predicates, shared with reviewSensitiveValues.ts

frontend/src/
├── services/
│   └── postmanCollectionsClient.ts # Export call + file writing
└── components/
    ├── PostmanExportPanel.tsx      # Export action, states, validation and limitation reporting
    └── PostmanExportLimitations.tsx

backend/tests/
├── unit/postman/                   # Per-module unit tests, incl. determinism.test.ts
└── integration/postmanCollection.test.ts

frontend/tests/unit/                # Export panel rendering, states, and download behaviour
packages/shared-domain/tests/unit/  # Contract shape tests
```

**Structure Decision**: The existing web-application layout is used unchanged. Postman generation
gets its own top-level backend area (`backend/src/postman/`) rather than living under `testDesign/`,
because it is an artifact-generation stage, not a test-design stage — keeping it separate is what
enforces constitution VIII and IX at the directory level and makes a future Playwright or Newman
generator a sibling rather than a fork. The frontend follows the established service-plus-component
split and, per research.md, introduces no styling framework.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Constitution XXVIII (partial): collection validation checks ApiPilot's emitted subset rather than the official Postman v2.1.0 JSON Schema | FR-014 requires a validation gate before delivery. The official schema is not available offline in the dependency tree, and vendoring it means committing a large third-party file whose licence must be reviewed first — a review this feature does not otherwise need. The emitted subset is small and fully under our control, so a targeted validator catches generator defects with no dependency and no network access (constitution XVII, XXIX). | Vendoring the official schema and validating with the already-present `ajv@8` is the stronger guarantee and is the named follow-up, deferred rather than rejected. Validating by importing into Newman was rejected outright: Newman is an AP-010 concern and FR-023/SC-012 forbid this feature from executing anything. The residual risk — a self-written validator encodes our understanding of the format, not the format itself — is mitigated by checked-in fixture artifacts and by keeping SC-007 (import and run in a real runner) as a manual acceptance step. |
