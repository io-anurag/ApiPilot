# Implementation Plan: Automatic Workflow Chaining for Postman Export

**Branch**: `019-auto-workflow-chaining` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-auto-workflow-chaining/spec.md`

## Summary

Today, a path parameter with no approved value is exported as a bare `{{name}}` Postman variable
and reported as an `unresolved-path-parameter` limitation — this accounts for 701 of 709 known
limitations in a representative export. This feature closes most of that gap by letting the
Postman generator automatically apply an already-detected CONFIRMED/LIKELY dependency relationship
(from 008-dependency-workflow-engine) as a chained producer→consumer pair — capturing the
producer's response value into a variable and substituting it into the consumer's request — for
any *standalone* scenario (one not already covered by a manually approved `IntegrationWorkflow`),
without requiring a human to first assemble and approve that pair as a workflow.

The technical approach adds one new, narrowly scoped stage — an "automatic chaining pass" — between
the existing `planApprovedWorkflows()` call and the standalone request-building loop in
`generateCollection.ts`. It reuses the *already-existing, already-tested* leaf primitives built for
approved-workflow rendering (`applyWorkflowSubstitutions`, `workflowVariableName`,
`appendWorkflowExtractions`) and the existing deterministic tie-break
(`resolveProducerDisambiguation`) rather than reimplementing any dependency-graph or ordering logic.
It deliberately does **not** reuse the full multi-step `IntegrationWorkflow` rendering pipeline
(`planWorkflow`) — that pipeline's all-or-nothing "every step needs approved scenario data" gate is
appropriate for a human-approved narrative, but would turn many partially-covered candidate
workflows into one large `workflow-unsupported-*` limitation instead of the fine-grained,
per-parameter resolution this feature needs. Automatic chaining therefore operates at the level of
individual, direct (single-hop) relationships, each independently eligible or not.

## Technical Context

**Language/Version**: TypeScript 5.5 (`^5.5.4`), Node.js ≥20 (repo `engines.node`)

**Primary Dependencies**: Express 4.19 (`backend/src/api`), no new runtime dependency required —
this feature reuses existing `backend/src/postman/*` and `packages/shared-domain` modules only.

**Storage**: N/A — the existing non-persistent, in-memory `TestGenerationWorkflow` record
(`workflowStore.ts`) and stateless direct-export HTTP contract are unchanged.

**Testing**: Vitest 4.1 (`vitest run`), Supertest 7.0 for the HTTP contract
(`backend/src/api/postmanCollections.ts`), following the existing fixture/assertion patterns in
`backend/tests/unit/postman/` and `backend/tests/fixtures/postman/`.

**Target Platform**: Existing backend Node service; no new deployment target.

**Project Type**: Web service + shared library (existing npm-workspaces monorepo:
`backend/`, `frontend/` unaffected, `packages/shared-domain/`).

**Performance Goals**: No new performance target. Automatic chaining consumes the
`ApiDependencyGraph` already computed by 008 during dependency analysis (`dependencyAnalysis.graph`)
— it performs no new schema/response analysis and no re-invocation of dependency detection, so it
does not add to the 15-second/200-operation budget already established by 008-dependency-workflow-
engine (spec 008 SC-008); it only adds bounded per-export lookups (grouping relationships by
producer, one deterministic tie-break call, one ordering comparison) over data that already exists
in memory.

**Constraints**: Must remain fully deterministic (constitution II, XVI, XXIV) with no new AI
invocation at export time (constitution V, VI); must not reorder the existing collection to make a
chain "work" (spec FR-015); must not fabricate a relationship, evidence, or extraction path beyond
what 008's dependency analysis already produced (spec FR-013, constitution I, XIV, XIX).

**Scale/Scope**: Same representative scale as 008/016 (up to ~200 operations, up to ~100 workflow
steps) — automatic chaining adds a bounded per-relationship pass over the same data, not a new
scale dimension.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Specification Is the Source of Truth | No new response codes, schemas, or fields are fabricated; only already-detected relationships and already-approved scenario data are used. | PASS |
| II. Deterministic Before AI | Automatic chaining is pure deterministic logic over precomputed `ApiDependencyGraph` data; no AI call at export time. | PASS |
| VIII. Framework-Independent Test Model | Chaining decisions are expressed via existing domain types (`ApiDependencyRelationship`, `TestScenario`); no new Postman-specific domain leakage into `TestModel`. | PASS |
| IX. Separation of Concerns | New logic lives in `backend/src/postman/` (artifact-generation concern), consuming — not modifying — 008's dependency-analysis output and 006's scenario-approval output. | PASS |
| XI. Human-in-the-Loop / XV. Conservative Dependency Inference | XV explicitly permits "sufficiently confident relationships" to "automatically become executable workflows" — this feature exercises exactly that allowance, restricted to CONFIRMED/LIKELY, with an explicit-rejection override (FR-016) so an actual human "no" is never automated over. | PASS |
| XIV. No Silent Assumptions / XIX. Fail Safely | Every applied chain is reported with its evidence (FR-010); every disqualified case (ordering, cycle, rejection, missing producer, ambiguous producer) falls back to the existing explicit `unresolved-path-parameter` limitation rather than guessing. | PASS |
| XVI. Executable Artifacts Must Be Deterministic / XXIV. Reproducibility | Same approved scenario set + same dependency graph + same export options ⇒ byte-identical chaining decisions (spec SC-004); no new non-deterministic input. | PASS |
| XXVII. Prefer Simple Architecture | Reuses existing leaf rendering functions and the existing tie-break function unchanged; adds one new narrowly-scoped module rather than a new subsystem. | PASS |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | Extends existing domain types (`WorkflowExportContext`, `ExportOptions`, `ArtifactVariable`) additively; does not introduce a parallel domain model. | PASS |

No violations requiring Complexity Tracking.

**Post-design re-check** (after Phase 0/1, research.md + data-model.md + contracts/): unchanged —
still PASS on every row above. The Phase 0 research decisions (D3: not reusing whole-workflow
rendering; D6: never reordering the collection; D7: respecting explicit rejections; D8: single-hop
only) each narrow the feature's blast radius further rather than introducing new risk, and the
Phase 1 contracts add only optional, additive fields to existing shared-domain types.

## Project Structure

### Documentation (this feature)

```text
specs/019-auto-workflow-chaining/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── automatic-chaining-export.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/shared-domain/
└── src/
    ├── postmanArtifact.ts        # extend ExportOptions, WorkflowExportContext, ArtifactVariable, ExportSummary
    └── apiDependency.ts          # no changes — existing types are read-only inputs here

backend/
├── src/
│   ├── postman/
│   │   ├── automaticChaining.ts       # NEW — planAutomaticChains(): the eligibility + grouping pass
│   │   ├── generateCollection.ts      # call planAutomaticChains() between planApprovedWorkflows() and the standalone build loop
│   │   ├── workflowVariables.ts       # unchanged — applyWorkflowSubstitutions() reused as-is
│   │   ├── assertionScripts.ts        # unchanged — appendWorkflowExtractions() reused as-is
│   │   ├── workflowRendering.ts       # unchanged — workflowVariableName() reused as-is
│   │   ├── ordering.ts                # unchanged — compareRequestSortKeys() read (not modified) to evaluate FR-015
│   │   └── readme.ts                  # extend to list automatic chains distinctly from workflow chains (FR-010)
│   ├── dependencies/
│   │   └── mergeRelationships.ts      # unchanged — resolveProducerDisambiguation() reused as-is
│   ├── testGenerationWorkflow/
│   │   └── postmanGenerationStage.ts  # forward dependencyAnalysis.graph/cycles + workflowDecisions into WorkflowExportContext.automaticChaining
│   └── api/
│       └── postmanCollections.ts      # extend isExportOptions/isWorkflowContext validators for the new optional fields
└── tests/
    ├── unit/postman/
    │   └── automaticChaining.test.ts  # NEW
    ├── fixtures/postman/
    │   └── dependencyFixtures.ts      # NEW — ApiDependencyRelationship/graph/cycle fixture builders
    └── integration/
        └── postmanWorkflowCollection.test.ts  # extend with an automatic-chaining end-to-end case
```

**Structure Decision**: No new project or workspace. All changes live inside the existing
`backend/src/postman/` artifact-generation module and additive fields on the existing
`packages/shared-domain` contracts, consistent with the monorepo's established layout
(`backend/`, `frontend/`, `packages/shared-domain/`).

## Complexity Tracking

*No entries — Constitution Check reported no violations.*
