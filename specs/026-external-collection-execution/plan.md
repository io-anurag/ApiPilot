# Implementation Plan: External Postman Collection Import & Execution

**Branch**: `026-external-collection-execution` | **Date**: 2026-09-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/026-external-collection-execution/spec.md`

## Summary

Let a QA engineer upload an existing Postman collection.json + environment.json pair — authored
outside ApiPilot — and run it through the same per-request pass/fail reporting AP-017
(specs/018-test-execution-results) already provides, as a standalone capability independent of
the OpenAPI-driven guided workflow. Reuses the existing Newman-based execution engine, session
store/repository patterns, and encrypted-at-rest credential handling almost entirely as-is;
the primary new work is a parallel, workflow-independent upload/store/execute path and a pair of
sibling types, `UploadedRequestResult`/`UploadedCollectionExecutionRun`, kept structurally
parallel to but distinct from `RequestResult`/`ExecutionRun` — which remain completely unmodified
(research.md D6/D8). FR-010's visible distinction is satisfied by the two kinds always appearing
in their own separate, source-homogeneous UI surfaces (research.md D9), not by a shared field on
the existing `ExecutionRun` contract.

## Technical Context

**Language/Version**: TypeScript on Node.js 22 LTS (repository baseline, unchanged).

**Primary Dependencies**: Express (routes), `postman-collection` (promoted from transitive-via-
`newman` to an explicit direct backend dependency — see research.md D1), `newman` (existing
execution engine, reused as-is), `multer` (existing upload middleware, reused), `better-sqlite3`
(existing persistence layer). React + Vite + Tailwind on the frontend, no new frontend
dependency.

**Storage**: SQLite via the existing `SqliteConnection`/`CredentialCipher` (specs/025-local-
persistence-layer), extended with one new table (`uploaded_collections`) following the exact
session-keyed, encrypted-variable-values pattern `environments` already uses.

**Testing**: Vitest + Supertest (backend unit/integration), Vitest + React Testing Library
(frontend) — existing conventions, no new test tooling.

**Target Platform**: Existing local-first Express backend + React frontend; no new deployment
target.

**Project Type**: Web application (existing `backend/` + `frontend/` + `packages/shared-domain/`
workspace structure) — Option 2 below.

**Performance Goals**: None beyond what specs/018 already established (per-request timeout,
sequential execution) — Clarifications 2026-09-20 explicitly decided against a new limit.

**Constraints**: Reuses the existing `MAX_UPLOAD_BYTES` (10 MB, `backend/src/uploadMiddleware.ts`)
for both uploaded files (FR-012) rather than a new limit. Script execution MUST stay inside
Newman's own existing sandboxed script engine — no new sandboxing layer is introduced or needed
(constitution XVII exception, 2026-09-20 amendment).

**Scale/Scope**: Single-session, single-operator, local-first — consistent with the rest of the
product. One execution in progress at a time per session, now shared across both a generated
and an uploaded run (FR-015).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Specification Is the Source of Truth | N/A | This feature has no OpenAPI specification input at all (FR-011) — the uploaded Postman collection is itself the source of truth for what it sends, not a derived artifact. |
| II. Deterministic Before AI | PASS | No AI involved. Execution and pass/fail determination are entirely deterministic (Newman running the collection's own assertions). |
| VIII. Framework-Independent Test Model | PASS (N/A by design) | This feature deliberately does **not** flow through `ApiModel`/`TestModel` — it is a parallel, "bring your own artifact" capability, not an extension of the generation pipeline. Does not weaken VIII's guarantee for the existing pipeline. |
| IX. Separation of Concerns | PASS | New code lives in its own module (`backend/src/externalCollections/`), sibling to `execution/`, reusing but not modifying the existing generation pipeline. |
| XI. Human-in-the-Loop | PASS | FR-007's mandatory, explicit, per-artifact confirmation before first run is a stronger human-in-the-loop gate than AP-017's own (which only triggers for staging/production/destructive operations). |
| XIII. Test Provenance and Traceability | PASS (extended) | `UploadedCollectionExecutionRun.source: "uploaded"` (data-model.md) satisfies FR-010's traceability requirement without a `TestScenario` to point to. `RequestResult`/`ExecutionRun` are untouched (research.md D8) — the existing generated-run path needs no new discriminant since it is never rendered in the same list as an uploaded run (research.md D9). |
| XVII. Security and Privacy by Design | PASS (post-amendment) | Full-fidelity script execution (FR-008) conflicted with "avoid arbitrary code execution" as originally written. Resolved 2026-09-20 by an explicit, narrow constitutional amendment (Sync Impact Report, `.specify/memory/constitution.md` v2.2.0) rather than a silent plan-level deviation, per Governance's conflict-resolution procedure. The amendment's own conditions (per-artifact confirmation, Newman's existing sandbox, no broader applicability) are exactly FR-007/FR-008 as specified. |
| XVIII. Secrets Must Never Be Part of Generated Artifacts | PASS | This feature does not generate artifacts containing secrets; FR-009 requires the same encrypted-at-rest handling `Environment.variableValues` already has for any credential-like uploaded value. |
| XIX. Fail Safely | PASS | FR-002/FR-003/FR-004 all require explicit, specific refusals rather than silent repair or guessing. |
| XX. Observability Without Sensitive Logging | PASS | No new logging surface introduces raw scripts, bodies, or credentials — mirrors the existing `logger` conventions in `execution/`. |
| XXI. Testability at Every Boundary | PASS | New module boundaries (upload validation, store, execution orchestration) are each independently unit-testable; no AI dependency to mock. |
| XXVII. Prefer Simple Architecture | PASS | No new infrastructure — reuses Newman, SQLite, the existing session model. Two separate run stores (generated vs. uploaded) sharing one cross-checked in-progress slot is the smallest change that satisfies FR-015 without touching AP-017's already-shipped contract (research.md D7). |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | PASS | Explicitly reuses the official Postman collection/environment formats via `postman-collection` rather than inventing a custom schema (research.md D1). |
| XXXII/XXXIII (review scale / presentation consistency) | PASS | No new bulk-review surface is introduced; UI reuses `StatusBadge`/`HttpMethodBadge`/Tailwind conventions already established. |

No unresolved violations remain. The one real conflict found (XVII vs. FR-008) was resolved by
constitutional amendment before this plan proceeded — see Sync Impact Report in
`.specify/memory/constitution.md` (v2.1.1 → v2.2.0, 2026-09-20).

### Post-Phase-1 re-check

Re-evaluated against the completed design (research.md, data-model.md, contracts/,
quickstart.md): no new violation was introduced. The two parallel types
(`UploadedRequestResult`/`UploadedCollectionExecutionRun` alongside `RequestResult`/
`ExecutionRun`) were considered against IX/XXVII/XXVIII during design (research.md D8) and kept
because the underlying data — arbitrary named tests vs. typed assertions — is genuinely not the
same shape; forcing one into the other's vocabulary would itself have been the constitution I/XIV
violation ("MUST NOT fabricate... no silent assumptions"). Gate remains PASS.

## Project Structure

### Documentation (this feature)

```text
specs/026-external-collection-execution/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── externalCollections.ts   # UploadedCollectionSet, UploadedRequestResult,
                              # UploadedCollectionExecutionRun, PostmanRawItem/PostmanRawEvent/
                              # PostmanRawRequest types; sibling to, not an extension of,
                              # ExecutionRun/RequestResult, which remain unmodified (data-model.md,
                              # research.md D6/D8)

backend/src/externalCollections/     # New module, sibling to execution/ (constitution IX)
├── uploadedCollectionParsing.ts     # FR-002/FR-003/FR-004: structural validation via
│                                    # postman-collection; variable-reference extraction
├── destructiveRequests.ts          # FR-013: generalizes execution/destructiveOperations.ts's
│                                    # DESTRUCTIVE_METHODS to walk a Postman collection's items
├── uploadedCollectionStore.ts       # Session-scoped CRUD (mirrors execution/environmentStore.ts)
├── uploadedCollectionExecutionStore.ts  # Session-scoped run store (mirrors
│                                    # execution/executionRunStore.ts); cross-checked against
│                                    # execution/executionRunStore.ts for the shared FR-015 slot
├── runUploadedCollectionExecution.ts # Orchestrator (mirrors execution/runExecution.ts): walks the
│                                    # collection via postman-collection's forEachItem() and reuses
│                                    # execution/newmanRunner.ts's runSingleItem() (widened item
│                                    # type only, research.md D6) — execution/mapNewmanResult.ts is
│                                    # NOT reused; see mapUploadedResult.ts below
├── mapUploadedResult.ts             # New, smaller result mapper (research.md D6) — reads
│                                    # testOutcomes directly off Newman's execution.assertions[]
│                                    # rather than interpreting them against a TestScenario
└── errors.ts                        # UploadedCollectionNotFoundError, DuplicateNameError, etc.

backend/src/persistence/
└── uploadedCollectionRepository.ts  # SQLite-backed (mirrors environmentRepository.ts exactly:
                                      # encrypted variableValues column via the shared
                                      # CredentialCipher)

backend/src/api/
└── externalCollections.ts           # New standalone route file, mounted independently of
                                      # api/testGenerationWorkflow.ts (FR-011) — see
                                      # contracts/external-collections-api.md

backend/src/persistence/connection.ts  # + one new CREATE TABLE / ensureColumn block for
                                        # uploaded_collections (mirrors environments table)
backend/src/api/testGenerationWorkflow.ts  # + one small cross-check in execution/start so the
                                            # existing generated-run start also refuses while an
                                            # uploaded-collection run is in progress (FR-015)

frontend/src/services/
└── externalCollectionsClient.ts     # One client for contracts/external-collections-api.md

frontend/src/components/
├── ExternalCollectionUpload.tsx     # Upload form (name, tier, collection file, environment file)
├── ExternalCollectionList.tsx       # FR-016/FR-017: list, select, remove
└── ExternalCollectionRunPanel.tsx   # Reuses ExecutionResultsPanel's row/detail sub-components
                                      # where the shape matches (RunOverview, ExecutionResultList)

frontend/src/App.tsx                 # + a lightweight top-level view switcher (two tabs: "Guided
                                      # Workflow" / "Import & Run Collection") — no react-router
                                      # added (research.md D9, mirrors AP-009's original decision)

backend/tests/unit/externalCollections/       # Unit tests per new backend module
backend/tests/integration/externalCollections/ # Full upload → run → results integration tests
frontend/tests/unit/ExternalCollection*.test.tsx
```

**Structure Decision**: Existing web-application layout (Option 2: `backend/` + `frontend/` +
`packages/shared-domain/`). The feature is additive: one new backend module
(`externalCollections/`), one new persistence table, one new standalone route file, and three
new frontend components plus a small `App.tsx` view switcher. No existing AP-017 file is
rewritten — `execution/newmanRunner.ts`, `execution/mapNewmanResult.ts`, and
`components/ExecutionResultsPanel.tsx`'s sub-components are reused, not modified, except for the
one small cross-check noted above in `api/testGenerationWorkflow.ts` (required for FR-015's
shared execution slot to actually hold).

## Complexity Tracking

*No unresolved Constitution Check violations remain — the one real conflict (XVII vs. FR-008)
was resolved by an explicit constitutional amendment rather than a plan-level exception (see
Constitution Check above). This table is intentionally empty.*
