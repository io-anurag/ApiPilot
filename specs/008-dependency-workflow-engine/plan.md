# Implementation Plan: API Dependency & Integration Workflow Engine

**Branch**: `008-dependency-workflow-engine` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-dependency-workflow-engine/spec.md`

## Summary

AP-008 analyzes an `ApiModel` to find where one operation's response can plausibly supply a value
another operation consumes, classifies each candidate CONFIRMED/LIKELY/POSSIBLE using multiple
corroborating signals (never a name match alone), and assembles the CONFIRMED/LIKELY relationships
into ordered, multi-step integration workflows with explicit variable hand-offs.

The approach: a backend analysis module that (1) extracts candidate producer fields from 2xx
response schemas and candidate consumer fields from parameters and request-body schemas, reusing the
existing `walkFields` traversal; (2) scores each candidate pair on five deterministic signals (name,
type, format, resource/path relationship, tag alignment) against a fixed classification table; (3)
optionally runs one batched AI inference call, through the existing `AIProvider` abstraction, for
semantically related fields deterministic matching cannot find, merging any AI-found duplicate of a
deterministic relationship rather than reporting it twice; (4) builds a directed graph over the
disambiguated relationships, detects cycles, and enumerates bounded maximal paths as workflow
candidates. Everything is exposed through one stateless endpoint that takes an `ApiModel` and returns
the full result; nothing is persisted, and no request is ever issued to an API described by the
specification.

This plan deliberately does **not** implement two of the constitution's illustrative deterministic
evidence signals — schema-description similarity and example-value matching — because the current
`ApiModel` carries no field-level description or example data to compare (research.md); it also adds
no new frontend page, since relationship/workflow review and approval UI is explicitly out of this
feature's scope (delegated to AP-006's extension and AP-009).

## Technical Context

**Language/Version**: TypeScript 5.5 on Node.js 20 LTS

**Primary Dependencies**: None added. Content-derived identifiers use Node's built-in `crypto`
(mirroring `backend/src/postman/identifiers.ts`); field discovery reuses the existing `walkFields`
generator (`backend/src/testDesign/requestHelpers.ts`); AI-assisted detection reuses the existing
`AIProvider` abstraction and candidate-pipeline shape (`backend/src/testDesign/enhanceTestModel.ts`).

**Storage**: None. The analysis is stateless and retains nothing, matching every prior backend-engine
feature (AP-002, AP-003, AP-005, AP-007).

**Testing**: Vitest across the backend and shared-domain workspaces. AI-dependent tests use the
existing deterministic mock provider; no real model download or GPU is required.

**Target Platform**: Local developer machine; Node 20 backend. No frontend changes in this feature.

**Project Type**: Web application in an npm-workspaces monorepo — this feature touches only the
backend and shared-domain workspaces.

**Performance Goals**: A 200-operation `ApiModel` completes dependency analysis and workflow
assembly, including one bounded AI-assisted pass, in under 15 seconds, or fails explicitly (SC-008,
resolved in clarification). The AI call uses a request-scoped 8-second timeout override rather than
the global 60-second default so a slow/unavailable provider cannot blow the budget (research.md).

**Constraints**: Deterministic relationships, classifications, and workflows MUST be identical for
identical input (FR-010, FR-016). CONFIRMED/LIKELY classification MUST NOT rest on a field-name match
alone (FR-003, SC-002). No network access to any API described by the ApiModel during analysis
(FR-019, SC-009). AI corroboration MUST NOT change a merged relationship's classification (FR-006a).
No specification content or AI prompts/responses in diagnostics (FR-020).

**Scale/Scope**: One new shared-domain contract module (`apiDependency.ts`, ~10 types), one new
backend analysis area (`backend/src/dependencies/`, ~10 modules), one endpoint. No frontend changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Gate | Status |
| --------- | ---- | ------ |
| I. Specification Is the Source of Truth | No fabricated field, evidence type, or relationship | PASS — description-similarity and example-match evidence are explicitly not implemented because `ApiModel` carries no field-level data to support them (research.md), rather than approximating them from the wrong granularity |
| II. Deterministic Before AI | Deterministic detection is independent of AI; AI only extends what determinism cannot reach | PASS — deterministic pass requires no `AIProvider`; AI is reserved for dissimilar-name semantic relationships (FR-004, FR-005) |
| III. AI Is an Assistant, Not the Authority | AI relationships never presented as confirmed fact | PASS — AI-only relationships capped at LIKELY/POSSIBLE, never CONFIRMED (data-model.md); every AI-derived/corroborated relationship carries model, confidence, rationale |
| IV. AI Output Must Be Structured and Validated | AI candidates validated before use | PASS — mirrors `enhanceTestModel.ts`'s parse → shape-validate → semantic-validate pipeline; an AI relationship referencing a nonexistent field/operation is rejected (FR-008) |
| VI. AI Provider Independence | No direct inference-runtime dependency | PASS — the analysis module depends only on `AIProvider`, injected the same way `enhancedTestModelsRouter` already does |
| VIII. Framework-Independent Test Model | No Postman-specific structures | PASS — `ApiDependencyRelationship`/`IntegrationWorkflow` are ApiModel/domain-level (FR-017); `TestModel` is untouched |
| IX. Separation of Concerns | Dependency/workflow analysis isolated from test design and artifact generation | PASS — new `backend/src/dependencies/` area, sibling to `testDesign/` and `postman/`, not nested inside either |
| X. Domain Model First | Stable domain concepts for dependency, workflow, workflow variable, confidence | PASS — this feature is the first to define exactly the concepts constitution X and XXVIII name explicitly |
| XII. Quality Over Quantity | No duplicate or meaningless relationships | PASS — FR-006a merges deterministic/AI duplicates into one relationship rather than reporting both |
| XIII. Provenance and Traceability | Relationships and workflows traceable to evidence | PASS — every relationship carries `evidence`/`aiCorroboration`; every workflow carries its `relationshipIds` (FR-022) |
| XIV. No Silent Assumptions | Missing/ambiguous cases surfaced, not guessed | PASS — empty results, POSSIBLE-confidence manual-confirmation candidates, and cycle findings are all explicit outputs, never silently dropped |
| XV. API Dependency Inference Must Be Conservative | Confirmed/likely gated on multiple signals | PASS — this is the plan's central gate: the fixed classification table (data-model.md) enforces it directly, and is exhaustively unit-testable |
| XVI. Executable Artifacts Must Be Deterministic | Same input, equivalent workflow output | PASS — workflow assembly (graph build, cycle detection, path enumeration, tie-break) is pure and deterministic; asserted by a dedicated determinism test |
| XVII. Security and Privacy by Design | No unnecessary persistence or leakage | PASS — stateless; no specification content or AI prompt/response in logs (FR-020) |
| XIX. Fail Safely | Ambiguous/contradictory cases surfaced explicitly | PASS — cycles, empty results, and AI unavailability/timeout are all explicit, non-fabricated outcomes |
| XX. Observability Without Sensitive Logging | Diagnostics carry no payloads | PASS — logs carry request id, operation counts, duration, `aiOutcome` only |
| XXI. Testability at Every Boundary | Each transformation independently testable | PASS — field extraction, classification, merge/dedup, disambiguation, cycle detection, and path enumeration are separate, independently unit-testable pure functions |
| XXIV. Reproducibility | Deterministic output stable; AI output best-effort | PASS — deterministic portion is fully guaranteed; AI portion explicitly scoped to constitution XXIV's own distinction (research.md) |
| XXVII. Prefer Simple Architecture | No speculative infrastructure | PASS — no graph database, no new queue, no new dependency; plain in-memory graph algorithms sized for the stated 200-operation/15s budget |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | Stable domain abstractions | PASS — introduces exactly the `ApiDependency`/`Workflow`/`WorkflowVariable` abstractions constitution XXVIII names, decoupled from any artifact format |
| XXX. Explicit Trade-offs | Trade-offs documented | PASS — recorded in research.md (evidence-signal gaps, AI timeout budget, reproducibility scoping) |

**Post-Phase-1 re-check**: unchanged. The design added no dependency, no persistence, and stayed
within the AI architecture AP-004/AP-005 already established.

## Project Structure

### Documentation (this feature)

```text
specs/008-dependency-workflow-engine/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── api-dependency-workflow-api.md
├── checklists/
│   └── requirements.md  # Built-in spec-quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── apiDependency.ts                 # FieldRef, DeterministicDependencyEvidence,
                                      # AIDependencyCorroboration, ApiDependencyRelationship,
                                      # ApiDependencyGraph, WorkflowVariable, WorkflowStep,
                                      # IntegrationWorkflow, ManualConfirmationCandidate,
                                      # DependencyCycleFinding, DependencyAnalysisResult

backend/src/
├── api/
│   └── apiDependencies.ts           # POST /api/api-models/dependencies; thin adapter
└── dependencies/
    ├── fieldExtraction.ts           # ApiModel -> candidate producer/consumer FieldRef lists
                                      # (reuses testDesign/requestHelpers.ts's walkFields)
    ├── deterministicMatching.ts     # Field pairs -> evidence + classification table
    ├── aiDependencyPrompt.ts        # ApiModel -> single batched AI inference request
    ├── parseAIDependencyResponse.ts # Raw AI JSON -> AIDependencyCandidate[] shape
    ├── validateAIDependencyCandidate.ts # Shape + semantic validation against the ApiModel
    ├── mergeRelationships.ts        # FR-006a dedup/merge + FR-013a producer disambiguation
    ├── analyzeDependencies.ts       # Orchestrates deterministic + AI passes -> ApiDependencyGraph
    ├── buildDependencyGraph.ts      # Cycle detection (Kahn's algorithm) over resolved edges
    ├── assembleWorkflows.ts         # Bounded maximal-path enumeration -> IntegrationWorkflow[]
    └── identifiers.ts               # Content-derived, deterministic ids (relationships, workflows)

backend/tests/
├── unit/dependencies/               # Per-module unit tests, incl. determinism.test.ts,
│                                     # performance.test.ts
└── integration/apiDependencies.test.ts

packages/shared-domain/tests/unit/
└── api-dependency.test.ts           # Contract shape tests
```

**Structure Decision**: The existing web-application layout is used unchanged, but this feature adds
no frontend code (research.md: relationship/workflow review UI is out of scope, delegated to AP-006's
extension). Dependency/workflow analysis gets its own top-level backend area
(`backend/src/dependencies/`), a sibling to `testDesign/` and `postman/` rather than nested inside
either — this is what constitution IX requires at the directory level: test design, dependency
analysis, and artifact generation are named as separate pipeline stages, and a future AP-009
end-to-end assembly or AP-006 review extension can depend on this area without pulling in unrelated
test-generation or Postman-specific code.

## Complexity Tracking

No Constitution Check violations require justification. No new dependency is introduced; no
persistence, distributed infrastructure, or additional AI provider is added.
