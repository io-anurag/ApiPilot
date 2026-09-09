# Implementation Plan: Workflow-Aware Postman Generation

**Branch**: `016-workflow-aware-postman` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/016-workflow-aware-postman/spec.md`

## Summary

Make the workflow-review decision affect the generated Postman artifact by passing approved
integration workflows into the existing deterministic generator. Render each supported workflow
as a distinct ordered folder with response-value extraction and later variable references, while
retaining the current standalone scenario export for approved scenarios not covered by a rendered
workflow. Unsupported workflows are omitted as complete sequences and reported as explicit
limitations; no partial or invented workflow intent is emitted.

## Technical Context

**Language/Version**: TypeScript on Node.js 20 LTS

**Primary Dependencies**: Existing Express API, framework-independent shared-domain package,
existing Postman artifact generator, Vitest, Supertest

**Storage**: None; export and workflow state remain in-memory/stateless as currently defined

**Testing**: Vitest unit tests, Supertest integration/contract tests, TypeScript build, repository lint

**Target Platform**: Node.js backend and the existing React/Vite workflow client

**Project Type**: Web application with a stateless artifact-generation API and an in-process guided workflow

**Performance Goals**: Preserve the existing export target for 500 scenarios under 10 seconds; add
workflow processing without network access or AI inference.

**Constraints**: Deterministic output; no API execution; no AI during export; no credentials in
collection, README, or diagnostics; framework-independent domain contracts; existing AP-007
single-scenario behavior remains valid.

**Scale/Scope**: Existing single-user, one-workflow-in-process model; workflows are bounded by the
existing AP-008 maximum of 10 steps; mixed workflow and standalone exports are supported.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Specification Is the Source of Truth**: PASS. Workflow order, handoffs, operations, and
  request values come only from the approved workflow, dependency graph, ApiModel, and approved
  scenarios; unsupported cases are exposed.
- **II. Deterministic Before AI**: PASS. Export uses deterministic workflow validation, selection,
  naming, extraction, and ordering; it does not invoke AI.
- **VIII. Framework-Independent Test Model**: PASS. Workflow context extends the artifact boundary;
  it does not add Postman-specific fields to TestScenario or IntegrationWorkflow.
- **IX. Separation of Concerns**: PASS. Workflow review state is adapted at the workflow/export
  boundary, while Postman rendering remains in the artifact generator.
- **X. Domain Model First**: PASS. Workflow and handoff concepts reuse IntegrationWorkflow and
  WorkflowVariable; export-specific metadata is represented in shared artifact contracts.
- **XI. Human-in-the-Loop**: PASS. Only explicitly approved workflow IDs are rendered.
- **XIII. Test Provenance and Traceability**: PASS. Requests, variables, and limitations retain
  workflow, step, scenario, and relationship references.
- **XVI. Executable Artifacts Must Be Deterministic**: PASS. Stable selection and ordering rules
  are defined for workflows, scenarios, variables, and documentation.
- **XVIII. Secrets Must Never Be Part of Generated Artifacts**: PASS. Existing environment-only
  credential handling remains in force.
- **XIX. Fail Safely**: PASS. An unsupported workflow is reported and omitted as a complete unit;
  invalid generated collections are withheld.
- **XX. Observability Without Sensitive Logging**: PASS. Diagnostics carry categories and safe
  identifiers only, not payloads or credentials.
- **XXI. Testability at Every Boundary**: PASS. Shared contracts, pure generator helpers, route
  behavior, and end-to-end workflow export each receive focused tests.
- **XXIV. Reproducibility**: PASS. No timestamps, random identifiers, network calls, or live AI
  affect generated output.

No constitution violations require complexity tracking.
