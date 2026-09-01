# Implementation Plan: AI Test Scenario Designer

**Branch**: `005-ai-test-scenario-designer` | **Date**: 2026-09-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-ai-test-scenario-designer/spec.md`

## Summary

AP-005 enhances the deterministic `TestModel` with semantically useful AI scenario
candidates while preserving deterministic coverage as the authoritative baseline. The
implementation adds framework-independent shared contracts for AI provenance, candidates,
validation findings, and enhancement outcomes; a backend service that validates and merges
candidates; and a thin HTTP endpoint for the existing web application workflow. Invalid,
unsupported, duplicate, or low-confidence candidates remain outside the executable model.

## Technical Context

**Language/Version**: TypeScript on Node.js 20 LTS

**Primary Dependencies**: Existing npm workspaces, Express, Vitest, Supertest, and the
framework-independent `@apipilot/shared-domain` package; no new dependency required.

**Storage**: N/A; enhancement requests are stateless and do not persist specifications,
prompts, candidates, or results.

**Testing**: Vitest unit tests, Supertest integration tests, and the existing deterministic
mock AI provider. Real-model tests remain opt-in.

**Target Platform**: Local Node.js web service used by the React/Vite application.

**Project Type**: TypeScript monorepo with an Express web service, React frontend, and shared
domain package.

**Performance Goals**: Return the deterministic baseline immediately when the provider is
unavailable or invalid; under normal conditions, enhancement must respect the configured AI
provider timeout and must not perform unbounded candidate processing.

**Constraints**: Local-first provider selection; no direct runtime dependency outside the AI
boundary; no fabricated contract facts; bounded confidence; schema and semantic validation
before model assembly; stable ordering; no unnecessary sensitive prompt/specification
logging; no automatic approval or execution authorization.

**Scale/Scope**: One analyzed `ApiModel` and its deterministic `TestModel` per request; a
bounded list of AI candidates; one enhancement result. Cross-specification reasoning,
human review workflows, dependency workflows, artifact generation, and execution are out of
scope.

## Constitution Check

The design passes the constitution gate:

- Deterministic scenarios remain the baseline; AI is limited to semantic reasoning.
- AI output flows through structured response validation, domain validation, deduplication,
  and only then `TestModel` assembly.
- AI provenance remains distinct from rule/specification provenance, with confidence and
  rationale exposed.
- The service depends only on `AIProvider` and shared domain contracts, not Transformers.js,
  a model, or a provider implementation.
- Invalid or ambiguous candidates fail safely and provider failures preserve the baseline.
- The domain model remains framework-independent; the HTTP route only adapts input and maps
  the enhancement result.
- No persistence, cloud fallback, execution authorization, or sensitive payload logging is
  introduced.

**Gate status**: PASS. No constitution violation requires a complexity exception.

## Project Structure

### Documentation (this feature)

```text
specs/005-ai-test-scenario-designer/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── enhanced-test-models-api.md
└── tasks.md                 # Created by /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── api/
│   │   └── enhancedTestModels.ts       # HTTP adaptation and response mapping
│   └── testDesign/
│       ├── enhanceTestModel.ts         # orchestration and deterministic merge
│       ├── validateAICandidate.ts       # structural and semantic validation
│       └── aiScenarioPrompt.ts          # versioned provider input construction
└── tests/
    ├── integration/
    │   └── enhancedTestModels.test.ts
    └── unit/testDesign/
        ├── enhanceTestModel.test.ts
        └── validateAICandidate.test.ts

packages/shared-domain/
└── src/
    ├── testModel.ts                     # additive AI provenance fields
    └── aiScenarioDesign.ts              # candidate and enhancement contracts
```

**Structure Decision**: Extend the existing backend `testDesign` boundary and shared domain
package. Add the route beside `testModels.ts` and register it in `app.ts`, following the
existing thin-route pattern. No frontend changes are required for this domain/API phase;
later review work can consume the enhancement result through a service client.

## Implementation Sequence

1. Add backward-compatible shared types for AI provenance, candidate status, validation
   findings, and enhancement results.
2. Define the versioned structured AI scenario response and build its provider request from
   the supplied `ApiModel` and deterministic `TestModel`.
3. Parse and structurally validate provider content, including bounded confidence,
   categories, rationale, and required target fields.
4. Semantically validate operation, parameter, request/response field, schema, and documented
   status-code references against `ApiModel`.
5. Convert valid candidates to `TestScenario` values with AI provenance, preserve stable
   ordering, and reuse the existing canonical deduplication behavior while recording AI
   duplicate origins separately from rule origins.
6. Return the enhanced model and candidate outcomes through `POST /api/test-models/enhance`;
   preserve the deterministic model for provider failures and invalid responses.
7. Add unit, integration, and contract-focused tests using the mock provider.

## Complexity Tracking

No constitution violations. No complexity exceptions required.
