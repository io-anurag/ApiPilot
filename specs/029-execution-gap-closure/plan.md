# Implementation Plan: Test Execution Gap Closure

**Branch**: `029-execution-gap-closure` (spec directory; work currently on `main`) | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/029-execution-gap-closure/spec.md`

## Summary

This closes three gaps between `specs/018-test-execution-results` and the shipped AP-017
generated-collection execution path.

1. **FR-018**: a request is not sent when an earlier request it takes a data value from has a
   blocking outcome (spec.md FR-001). A schema mismatch alone is not blocking, and this
   deliberately narrows `specs/018` FR-018's "never sent with a missing value" edge case.
2. **FR-016**: every result records its processing stage.
3. **FR-007**: the destructive-request confirmation is based on approved scenarios instead of the
   whole specification.

Technical approach: the Postman generator already works out every data hand-off between items
while it builds the collection. A new backend-internal variant, `generateExecutableCollection()`,
returns those links next to the unchanged `ExportResult`, and `runExecution.ts` checks them before
dispatching each item. `RequestResult` gains two optional fields. `confirmationRequirement()`
filters by approved scenarios. The exported artifact, every other contract, `specs/026`, and the
frontend are not changed.

## Technical Context

**Language/Version**: TypeScript on Node.js 20 LTS

**Primary Dependencies**: Existing Express API, shared-domain package, Postman generator
(`backend/src/postman/`), execution module (`backend/src/execution/`), and Newman. No new
dependency.

**Storage**: Existing SQLite-backed `executionRunRepository.ts` (`specs/025`). Results are a JSON
array, so the new optional fields need no migration (research.md D7).

**Testing**: Vitest unit tests (`tests/unit/execution/`, `tests/unit/postman/`,
`tests/unit/persistence/`) and Supertest integration tests (`tests/integration/execution/`). Both
run against the local `TargetServer` fixture, with no external network.

**Target Platform**: Node.js backend only.

**Project Type**: Web application (npm-workspaces monorepo). Only the backend and shared-domain
workspaces change.

**Performance Goals**: No measurable change. The dependency check is one map lookup and a
set-membership test per item. Building the links adds one pass over the workflow plans and chains
the generator already computes.

**Constraints**: The export must stay byte-identical (constitution XVI). API changes must be
additive (FR-014). Stored results must stay readable (FR-015). No raw values may appear in the new
fields (FR-017). There must be no change to `specs/026` or the frontend (FR-016), and no change to
the OAuth2 token-fetch path (FR-007).

**Scale/Scope**: Three source modules and one type file get substantive changes
(`generateCollection.ts`, `automaticChaining.ts`, `runExecution.ts`, `mapNewmanResult.ts`,
`destructiveOperations.ts`, `execution.ts`). The route gets one changed call argument.

No NEEDS CLARIFICATION items remain. The spec's FR-006 question was resolved on 2026-09-23, and
the question of how data and credential hand-offs are told apart is resolved in research.md D2.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Specification Is the Source of Truth | PASS | Every change restates a `specs/018` requirement the code missed. The one refinement, FR-001's blocking outcome narrowing `specs/018` FR-018, was clarified with the user and is recorded in spec.md (Clarifications 2026-09-23), and T019 records it in `specs/018`. |
| II. Deterministic Before AI | PASS | No AI is involved. Dependency links come from deterministic generator plans. |
| VIII. Framework-Independent Test Model | PASS | `TestScenario`/`TestModel` are untouched. The new shared fields describe results, not Postman concepts. The Postman-specific link map stays in `backend/src/postman/`. |
| IX. Separation of Concerns | PASS | The generator owns link construction, the execution loop owns enforcement, and the route only passes one more argument. |
| X. Domain Model First | PASS | `RequestProcessingStage` and `UnmetDependency` are defined in shared-domain before they are used. |
| XI. Human-in-the-Loop | PASS | The confirmation gate keeps its tier rule, and staging/production are always gated (FR-012). Only confirmations that list nothing destructive for local/dev/qa go away. |
| XIII. Test Provenance and Traceability | PASS | A withheld request names its unmet producers by scenario identifiers. |
| XIV. No Silent Assumptions | PASS | A withheld request is recorded explicitly with its reason. It is never skipped silently. |
| XV. API Dependency Inference Must Be Conservative | PASS | Only links the generator already turned into executable hand-offs are enforced. No new inference. |
| XVI. Executable Artifacts Must Be Deterministic | PASS (explicit decision) | `generateCollection()` output is unchanged, and the link map is deterministic (research.md D1). |
| XVII. Security and Privacy by Design | PASS | Fewer requests with unresolved values reach a real target. No new data is stored. |
| XIX. Fail Safely | PASS | A request whose prerequisite had a blocking outcome is not sent. In the one case still sent (the prerequisite's only failure was a schema mismatch), the request fails visibly in its own result and is never hidden. |
| XX. Observability Without Sensitive Logging | PASS | `processingStage` is one of the diagnostics XX names. `unmetDependencies` carries identifiers only. |
| XXI. Testability at Every Boundary | PASS | Link construction, stage mapping, dependency enforcement, and confirmation are each unit-tested on their own (research.md D8). |
| XXVII. Prefer Simple Architecture | PASS | One forward pass with a set. There is no graph library, no new module, and no new dependency. |
| XXX. Explicit Trade-offs | PASS | research.md D1, D5, and D6 record rejected alternatives. |
| XXXIII. Presentation | N/A | There is no UI change. |

*Post-Phase-1 re-check*: data-model.md and contracts/execution-api-delta.md add no concerns. The
shared additions are optional fields. The backend-internal types stay out of shared-domain because
no frontend consumer exists (`.claude/CLAUDE.md` §4). The only behavior an existing caller can see
is the FR-007 change, which the delta contract documents. Gate remains PASS.

## Project Structure

### Documentation (this feature)

```text
specs/029-execution-gap-closure/
├── spec.md
├── plan.md                         # This file
├── research.md                     # D1–D8
├── data-model.md
├── quickstart.md
├── contracts/
│   └── execution-api-delta.md      # Additive amendment to specs/018 contracts/execution-api.md
├── checklists/requirements.md
└── tasks.md                        # /speckit-tasks output (not created by this command)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── execution.ts                    # MODIFIED: RequestProcessingStage, UnmetDependency;
                                    #   RequestResult.processingStage?, .unmetDependencies?

backend/src/
├── postman/
│   ├── automaticChaining.ts        # MODIFIED: AutomaticChain.kind ("data" | "credential")
│   └── generateCollection.ts       # MODIFIED: ExecutionDependencyMap, generateExecutableCollection();
│                                   #   generateCollection() becomes a wrapper (output unchanged)
├── execution/
│   ├── runExecution.ts             # MODIFIED: uses generateExecutableCollection(); failed-item set;
│   │                               #   dependency-not-met + unmetDependencies; processingStage on
│   │                               #   every not-attempted result
│   ├── mapNewmanResult.ts          # MODIFIED: processingStage on dispatched results
│   └── destructiveOperations.ts    # MODIFIED: filter by approved scenarios (signature gains TestModel)
└── api/
    └── testGenerationWorkflow.ts   # MODIFIED: pass approvedTestModel to confirmationRequirement()

backend/tests/
├── unit/postman/
│   └── executionDependencies.test.ts   # NEW: link map for workflows, data chains, credential chains
├── unit/execution/
│   ├── runExecution.test.ts            # EXTENDED: withholding, transitive, cancel precedence, stages
│   ├── mapNewmanResult.test.ts         # EXTENDED: processingStage per category
│   └── destructiveOperations.test.ts   # EXTENDED: approved-scenario filtering
├── unit/persistence/
│   └── executionRunRepository.test.ts  # NEW: stored result without the new fields still reads back
└── integration/execution/
    └── executionRuns.test.ts           # ADJUSTED only where it asserted the old FR-007 over-confirmation

specs/018-test-execution-results/
├── spec.md                          # MODIFIED: one cross-reference note to specs/029
└── contracts/execution-api.md       # MODIFIED: one note pointing to contracts/execution-api-delta.md
specs/ROADMAP.md                     # MODIFIED: AP-030 entry and Implementation Status row
```

Not changed: `frontend/`, `backend/src/externalCollections/` (`specs/026`),
`backend/src/postman/oauth2TokenFetch.ts`, the persistence schema, and the downloaded collection
and environment artifacts.

**Structure Decision**: This stays inside the existing layout. It adds no new module or
workspace. `ExecutionDependencyMap` lives next to the generator that computes it, not in
`execution/`, so the plans it is derived from are never recomputed elsewhere.

## Implementation Order

1. Shared-domain types (data-model.md). This is additive and compiles on its own.
2. `AutomaticChain.kind` and `generateExecutableCollection()`, with link-map tests and the existing
   determinism and golden tests unchanged (User Story 1 foundation).
3. `processingStage` in `mapNewmanResult.ts` and the not-attempted paths (User Story 2). This is
   independent of step 2.
4. Dependency enforcement in `runExecution.ts` (User Story 1). It depends on steps 1 and 2.
5. `confirmationRequirement()` filtering and the route argument (User Story 3). This is independent
   of steps 2 to 4.
6. Documentation: the `specs/018` cross-references, the ROADMAP AP-030 entry, and the
   quickstart run. Then `npm test`, `npm run lint`, and `npm run build`.

## Complexity Tracking

*No entries. The Constitution Check records no violations.*
