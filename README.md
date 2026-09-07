# ApiPilot

[![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20_LTS-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.x-6BA539?logo=openapiinitiative&logoColor=white)](https://www.openapis.org/)
[![Vitest](https://img.shields.io/badge/Vitest-testing-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![ESLint](https://img.shields.io/badge/ESLint-enabled-4B32C3?logo=eslint&logoColor=white)](https://eslint.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/io-anurag/ApiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/io-anurag/ApiPilot/actions/workflows/ci.yml)
[![stars - ApiPilot](https://img.shields.io/github/stars/io-anurag/ApiPilot?style=social)](https://github.com/io-anurag/ApiPilot)
[![forks - ApiPilot](https://img.shields.io/github/forks/io-anurag/ApiPilot?style=social)](https://github.com/io-anurag/ApiPilot)
[![GitHub tag](https://img.shields.io/github/tag/io-anurag/ApiPilot?include_prereleases=&sort=semver&color=blue)](https://github.com/io-anurag/ApiPilot/releases/)
[![issues - ApiPilot](https://img.shields.io/github/issues/io-anurag/ApiPilot)](https://github.com/io-anurag/ApiPilot/issues)

ApiPilot is a local-first API test engineering platform for QA engineers testing REST APIs, microservices, and service-to-service integrations. It transforms OpenAPI 3.x YAML into reviewable, explainable, reproducible API test intent and exports approved single-operation scenarios as Postman artifacts.

```text
OpenAPI YAML -> ApiModel -> deterministic TestModel -> optional AI enhancement
             -> human review -> dependency workflows -> Postman artifacts
```

The deterministic path is the product foundation. AI contributes bounded, validated suggestions; it never replaces specification facts, deterministic scenarios, or explicit human approval.

## Quick start

Prerequisites: Node.js 20 LTS or newer and npm.

```powershell
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:4000/api/health`

`npm run dev` stops stale local processes before starting both workspaces. Use `Ctrl+C` or `npm run stop` to stop development servers. Copy [.env.example](.env.example) to `.env` only to override defaults. No cloud account, AI credential, or external paid service is needed to run ApiPilot.

## Guided workflow

ApiPilot's UI is one ordered workflow; individual stages cannot be opened independently outside an active workflow.

1. **Upload**: submit one OpenAPI 3.x YAML document, up to the configured upload limit (10 MB by default).
2. **Analysis**: parse, validate, resolve same-document `$ref`s, and construct `ApiModel`; gaps become visible analysis issues.
3. **API review**: inspect operations, parameters, schemas, responses, security requirements, examples, and constraints.
4. **Deterministic generation**: build the rule-based baseline `TestModel` from documented facts only.
5. **AI enhancement**: optionally request local semantic scenarios and coverage gaps; deterministic work remains usable on every AI outcome.
6. **Scenario review**: inspect, accept, reject with rationale, edit supported content, regenerate suggestions, or apply confirmed bulk decisions.
7. **Dependency analysis**: identify producer-to-consumer relationships and generate ordered integration-workflow candidates.
8. **Workflow review**: approve or reject dependency workflows.
9. **Postman generation**: download a collection, environment, and artifact README from approved scenarios.

The backend keeps one workflow instance in process memory. Browser reloads or reconnects resume it while the backend stays alive; backend restarts discard it. An upstream decision marks dependent completed stages stale and blocks artifact download until those stages are redone.

## Product capabilities and specification status

The [roadmap](specs/ROADMAP.md) is authoritative for implementation status. Individual `spec.md` files retain a template `Draft` header that does not represent implementation state.

| Capability                                       | Status                                      | Scope                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-001 Application Foundation                    | Implemented; dependency-preflight follow-up | npm workspaces, Express backend, React/Vite frontend, shared contracts, health check, local configuration, and test infrastructure.                                                    |
| AP-002 OpenAPI Specification Engine              | Implemented                                 | YAML OpenAPI 3.x upload, deterministic parsing/validation/normalization, internal `$ref`, operation/schema/security extraction, and visible analysis issues.                           |
| AP-003 Deterministic Test Designer               | Implemented                                 | Framework-independent baseline scenarios, specification-grounded assertions, stable per-operation deduplication, and rule provenance.                                                  |
| AP-004 AI Provider and Local Inference           | Implemented; manual quickstart follow-up    | `AIProvider`, local Transformers.js and deterministic mock providers, readiness, FIFO serial queue, timeout, offline cache, CPU baseline, accelerator fallback, and benchmark harness. |
| AP-005 AI Test Scenario Designer                 | Implemented; validation-policy follow-ups   | Structured candidates, semantic validation, confidence/rationale/provenance, stable merging, and deterministic-baseline degradation.                                                   |
| AP-006 Test Scenario Review                      | Implemented                                 | Inspection, pending/accepted/rejected decisions, feedback, validated edits, regeneration, policy-aware approval, and stale/failure visibility.                                         |
| AP-007 Postman Collection Generator              | Implemented; manual import follow-up        | Deterministic collection, environment, and artifact README from approved scenarios, with validation, credential variables, limitations, and provenance.                                |
| AP-008 Dependency and Workflow Engine            | Implemented                                 | Conservative deterministic and optional AI-assisted relationship inference, confidence/evidence, stable workflow ordering, and explicit hand-offs.                                     |
| AP-009 End-to-End Test Generation Workflow       | Implemented                                 | Exclusive guided orchestration, stage gating, stale-state propagation, AI-unavailable continuation, and artifact download gating.                                                      |
| AP-010 Presentation and Review Scalability       | Implemented                                 | Consistent accessible presentation, filtering, multi-select bulk decisions, confirmation, partial-failure counts, and progress.                                                        |
| Hardening: AI prompt batching (`011`)            | Implemented                                 | Deterministic serial batches, small-input compatibility, partial retention, and honest full/partial/not-completed outcomes.                                                            |
| Hardening: AI enhancement progress (`012`)       | Implemented; optional manual UI validation  | Live batch progress, per-batch outcomes, incremental scenario visibility, final outcomes, and concurrency protection.                                                                  |
| Hardening: AI enhancement viability (`013`)      | In progress                                 | Instruction framing, true capacity planning, smaller prompts, viable output/time budgets, pre-flight refusal, cancellation, phases, elapsed time, and user-safe failures.              |
| Hardening: AI batching policy and pacing (`014`) | In progress                                 | Small deterministic work units, caller-specific sizing, run ceilings, retained partial results, responsive cancellation, reply-shape reliability, and paced dependency analysis.       |
| AP-011 Test Execution and Results                | Post-MVP, not started                       | Execute generated artifacts and report results.                                                                                                                                        |
| AP-012 AI Failure Analysis                       | Post-MVP, not started                       | Analyze execution failures using AI as an explicitly bounded assistant.                                                                                                                |

## Specification behavior

### OpenAPI processing

ApiPilot accepts a single YAML OpenAPI 3.x document. It discovers every path/method and extracts parameters, request bodies, documented responses/statuses/schemas, security requirements, constraints, and examples. It never uses AI, executes uploaded content, silently repairs malformed input, or fetches external `$ref` URLs. Invalid YAML/version, oversized uploads, unresolved/circular references, duplicate operations, and unsupported constructs are explicit errors or `AnalysisIssue`s. A valid specification with zero operations or no security schemes remains valid and accurately represented.

### Deterministic test coverage

Every operation receives a positive scenario with specification-conformant values. Applicable constraints produce missing/null/empty scenarios for required nested body fields and required query/header parameters; path parameters intentionally omit those routing-level cases. Other rules cover invalid type, enum, format/pattern, numeric minimum/maximum, string length, and array-size boundaries. Assertions reference only documented response codes and schemas; no expected outcome is invented. Equivalent request/assertion pairs are deduplicated per operation with their rule origins retained. Unresolved source portions are reported and skipped rather than guessed.

### Local AI

All AI use passes through `AIProvider`. Supported modes are `local` and deterministic `mock`; there is no cloud fallback. Cached local models can operate offline. Readiness is explicit: `not-loaded`, `loading`, `ready`, or `unavailable`. Requests run serially; failures, timeouts, and model load errors remain distinguishable, and a failed load requires explicit retry. An unavailable explicitly enabled accelerator falls back to CPU with notice.

AI may suggest semantic scenarios and relationships but cannot add executable endpoints, methods, fields, status codes, or authentication absent from `ApiModel`. Candidates require structured output, full-model semantic validation, bounded confidence, rationale, assumptions, and AI provenance. Invalid, trivial, duplicate, or non-executable candidates are rejected or surfaced separately; deterministic scenarios never change. Large specifications use deterministic serial batching: every operation belongs to one unit, successful units merge with established validation/deduplication, mixed outcomes are partial, and total failure returns the deterministic baseline explicitly. The active hardening work adds CPU-viable units, run ceilings, viability refusal, cancellation, incremental results, and clear explanations.

### Review, dependency analysis, and export

Review states are pending, accepted, and rejected. Pending/rejected scenarios are ineligible downstream. Edits preserve and revalidate provenance; failed edits or regeneration retain the last valid state. Filtered and manually selected bulk actions require explicit confirmation and create the same per-item decision record as individual actions. Bulk rejection uses a shared justification.

Dependency relationships are `CONFIRMED`, `LIKELY`, or `POSSIBLE`. Field names alone never justify confirmed/likely classifications; corroborating type, format, path, tag, description, or example evidence is needed. Only confirmed/likely edges automatically assemble into workflows; possible edges remain review candidates. Workflows use stable tie-breaks and named producer/consumer hand-off variables. Cycles, unresolved order, batching limitations, and AI unavailability are visible rather than fabricated away.

Postman export is deterministic, invokes no AI, and does not execute requests. It emits exactly one request per approved single-operation scenario, preserves deliberate negative values, applies only approved assertions, validates output, and generates an environment plus README. Base URLs, credentials, and absent values are declared variables rather than literals or guesses. Empty sets, unsupported auth/content, missing assertions, and analysis issues are reported as limitations. Rendering ordered multi-step workflows is a documented future extension.

## Core guarantees

- **Specification authority**: API facts come from OpenAPI or explicit user input, never guesswork.
- **Determinism first**: parsing, validation, test generation, assertions, deduplication, review gating, and artifacts are reproducible without an LLM.
- **Explainability**: scenarios, relationships, workflows, and artifacts retain specification, rule, AI, or user provenance.
- **Human ownership**: AI validation is not approval, and exporting does not authorize API execution.
- **Privacy**: specifications, prompts, and credentials are not sent to cloud AI; sensitive content stays out of normal diagnostics and artifacts.
- **Explicit failure**: unsupported, ambiguous, unavailable, invalid, partial, stale, empty, and cancelled outcomes are never presented as success.
- **Framework independence**: `ApiModel`, `TestModel`, and workflow contracts do not depend on Postman.

## Architecture

ApiPilot is an npm-workspaces monorepo with thin UI/HTTP adapters around shared contracts and independently testable pipeline modules.

```text
frontend (React + Vite)              backend (Express + TypeScript)
Workflow UI -> service clients  ->  thin routes -> domain pipeline modules
         ^                                      |
         |                                      v
         +---------------- shared-domain contracts ----------------+

OpenAPI YAML -> ApiModel -> TestModel -> approved TestModel -> Postman artifacts
                         \-> AI suggestions / dependency workflows -> review
```

| Area                                             | Responsibility                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [backend](backend)                               | Express assembly, configuration, upload handling, centralized errors, and domain pipeline modules.              |
| [frontend](frontend)                             | React/Vite guided workflow UI, reusable components, hooks, and service clients.                                 |
| [packages/shared-domain](packages/shared-domain) | Canonical framework-agnostic API, test, AI, review, dependency, workflow, and artifact contracts.               |
| [docs/architecture.md](docs/architecture.md)     | Detailed boundaries, data flow, state lifecycle, AI model, security constraints, and deployment topology.       |
| [specs](specs)                                   | Constitution, roadmap, feature specifications, plans, data models, contracts, research, quickstarts, and tasks. |

## Configuration

See [.env.example](.env.example) for the maintained variable list and guidance.

| Variable                             | Purpose                                  | Default                                |
| ------------------------------------ | ---------------------------------------- | -------------------------------------- |
| `BACKEND_PORT`                       | Backend HTTP listener                    | `4000`                                 |
| `FRONTEND_DEV_PORT`                  | Vite development server                  | `5173`                                 |
| `AI_PROVIDER_MODE`                   | `local` or deterministic `mock` provider | `mock` in tests; `local` otherwise     |
| `AI_MODEL_ID`                        | Local Hugging Face model identifier      | `onnx-community/Qwen2.5-0.5B-Instruct` |
| `AI_MODEL_CACHE_DIR`                 | Local model cache                        | `~/.apipilot/models`                   |
| `AI_MODEL_DTYPE`                     | Optional ONNX weight precision           | unset by default                       |
| `AI_INFERENCE_TIMEOUT_MS`            | Per-request inference limit              | see `.env.example`                     |
| `AI_USE_ACCELERATOR`                 | Enable optional accelerator attempt      | `false`                                |
| `AI_ENHANCEMENT_OPERATIONS_PER_UNIT` | Work-bounded enhancement batch size      | `1`                                    |

## Development and validation

```powershell
npm test
npm run lint
npm run build

# May download local candidate models on first run.
npm run ai:benchmark -w backend

# Opt-in local-model test; excluded from npm test.
npm run test:ai-real -w backend
```

The root test command uses [vitest.workspace.ts](vitest.workspace.ts), including the `jsdom` environment required by frontend component tests. AI-dependent automated tests use mock or scripted fake providers, so routine validation does not require GPU hardware, a real model, or network access.

ApiPilot versions root, backend, and frontend packages with semantic versioning. Before committing a product change, run `npm run version:bump -- feature`. Use `spec` for a product specification/contract capability, `feature` for a compatible enhancement, and `bugfix` for fixes, tests, or documentation. Bump the independently published shared-domain package when public types change.

## Scope and limitations

- Input is one OpenAPI 3.x YAML file. Swagger 2.0, JSON input, external `$ref` retrieval, and executing uploaded content are unsupported.
- ApiPilot creates and reviews test intent but does not contact APIs from the specification. Execution/results and AI failure analysis are post-MVP.
- Workflow state is single-instance, process-memory only, and not multi-user or durable across a backend restart.
- Postman export is currently limited to approved single-operation scenarios; multi-step workflow rendering is a planned extension.
- Local model provisioning may require an initial download. Normal tests do not download models.
- Specifications `013` and `014` are actively being completed; their task lists describe remaining work.

## Documentation map

- [Architecture reference](docs/architecture.md)
- [Product roadmap and implementation status](specs/ROADMAP.md)
- [Project constitution](specs/constitution.md)
- [AP-001 foundation](specs/001-application-foundation/spec.md)
- [AP-002 OpenAPI engine](specs/002-openapi-specification-engine/spec.md)
- [AP-003 deterministic designer](specs/003-deterministic-test-designer/spec.md)
- [AP-004 local AI provider](specs/004-ai-provider-local-inference/spec.md)
- [AP-005 AI scenario designer](specs/005-ai-test-scenario-designer/spec.md)
- [AP-006 scenario review](specs/006-test-scenario-review/spec.md)
- [AP-007 Postman generator](specs/007-postman-collection-generator/spec.md)
- [AP-008 dependency workflows](specs/008-dependency-workflow-engine/spec.md)
- [AP-009 end-to-end workflow](specs/009-e2e-test-generation-workflow/spec.md)
- [AP-010 review scalability](specs/010-presentation-review-scalability/spec.md)
- [AI prompt batching](specs/011-ai-prompt-batching/spec.md)
- [AI enhancement progress](specs/012-ai-enhancement-progress/spec.md)
- [AI enhancement viability](specs/013-ai-enhancement-viability/spec.md)
- [AI batching policy](specs/014-ai-batching-policy/spec.md)

Each feature directory contains the normative specification, implementation plan, task list, data model, research, quickstart, and API contracts where relevant.

## Deployment

[vercel.json](vercel.json) deploys frontend and backend as separate Vercel services. Requests under `/api/*` route to the backend and all other paths route to the frontend.

## License

Released under the [MIT License](LICENSE) by [@io-anurag](https://github.com/io-anurag).
