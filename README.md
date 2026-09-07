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

ApiPilot is an AI-powered API test engineering platform that transforms OpenAPI/YAML
specifications into intelligent, executable, and explainable API test suites — deterministically
by default, with local/offline AI as an optional enhancement.

```text
OpenAPI spec → Analysis → Deterministic tests → AI enhancement (optional) → Scenario review →
Dependency analysis → Workflow review → Postman collection
```

## Why ApiPilot

- **Deterministic by default** — the baseline test suite (positive, boundary, and negative
  scenarios) is produced by fixed rules evaluated against the specification's own declared
  constraints. No LLM and no randomness are involved in the baseline.
- **AI as an enhancement, never a replacement** — an optional local, offline model
  (Transformers.js) can propose additional scenarios and operation relationships. It runs
  entirely on the local machine, is never silently substituted for the deterministic baseline,
  and never sends specifications or prompts to a cloud service.
- **Explainable** — every scenario and relationship carries provenance: which deterministic
  rule, or which AI call (with rationale and confidence), produced it.
- **Specification-grounded** — expected status codes and assertions come only from what the
  OpenAPI document itself documents; nothing is fabricated.
- **Reviewable** — a human explicitly accepts or rejects every scenario and every multi-step
  integration workflow before an artifact is generated.

## Quick start

Prerequisites: Node.js 20 LTS (see [.nvmrc](./.nvmrc)) and npm.

```powershell
npm install
npm run dev
```

- Backend: `http://localhost:4000` (health check at `GET /api/health`)
- Frontend: `http://localhost:5173` — opens the guided test-generation workflow and proxies
  `/api/*` to the backend (no CORS configuration needed in development)

`Ctrl+C` then `npm run dev` (or `npm run stop`) returns the application to a clean state.
Because the in-progress workflow is tracked server-side, reloading the page — or restarting
only the frontend — resumes it rather than losing it.

Optionally copy [.env.example](./.env.example) to `.env` to override the default ports or the
AI provider settings — see [Configuration](#configuration).

## The guided workflow

The frontend's only entry point is a nine-stage guided workflow:

1. **Upload** — an OpenAPI 3.x YAML specification (up to 10 MB).
2. **Analysis** — operations, schemas, security requirements, and any specification
   ambiguities, surfaced as `AnalysisIssue`s rather than causing a rejection.
3. **API review** — confirm the analyzed surface before generating tests.
4. **Deterministic generation** — a baseline `TestModel`: positive, missing-required-field,
   invalid-type/format/enum, and numeric/string/array-boundary scenarios.
5. **AI enhancement** _(optional)_ — the local model proposes additional, validated scenarios;
   provider failure or unavailability falls back to the deterministic baseline, visibly rather
   than silently.
6. **Scenario review** — accept, reject, edit, or regenerate scenarios, individually or in bulk.
7. **Dependency analysis** — operations are analyzed for producer/consumer relationships and
   assembled into ordered integration workflows.
8. **Workflow review** — confirm or discard the proposed multi-step workflows.
9. **Postman generation** — export the accepted scenarios as a runnable Postman collection,
   environment, and README.

Every stage's underlying capability is also independently reachable as its own stateless HTTP
endpoint — see the feature table below for each one's contract.

## Features

| Feature                                           | What it does                                                                                                                                                | Details                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-001 — Application Foundation                   | npm-workspaces monorepo: Express backend, React/Vite frontend, shared-domain package, one dev/test workflow                                                 | [spec](./specs/001-application-foundation/spec.md)                                                                                                   |
| AP-002 — OpenAPI Specification Engine             | Parses, validates, and normalizes an OpenAPI 3.x document into an `ApiModel`; flags unsupported constructs instead of rejecting the upload                  | [spec](./specs/002-openapi-specification-engine/spec.md) · [API](./specs/002-openapi-specification-engine/contracts/specifications-api.md)           |
| AP-003 — Deterministic Test Designer              | Generates a rule-based baseline `TestModel` from the `ApiModel` — no AI, no randomness                                                                      | [spec](./specs/003-deterministic-test-designer/spec.md) · [API](./specs/003-deterministic-test-designer/contracts/test-models-api.md)                |
| AP-004 — AI Provider & Local Inference            | Local-first `AIProvider` abstraction (Transformers.js) with a deterministic mock provider, a readiness endpoint, and a model-selection benchmarking harness | [spec](./specs/004-ai-provider-local-inference/spec.md) · [API](./specs/004-ai-provider-local-inference/contracts/ai-status-api.md)                  |
| AP-005 — AI Test Scenario Designer                | Validates AI-proposed scenarios against the `ApiModel` and merges only executable, non-duplicate ones into the `TestModel`                                  | [spec](./specs/005-ai-test-scenario-designer/spec.md) · [API](./specs/005-ai-test-scenario-designer/contracts/enhanced-test-models-api.md)           |
| AP-006 — Test Scenario Review                     | Accept/reject/edit/regenerate scenarios; produces the approved `TestModel` downstream features consume                                                      | [spec](./specs/006-test-scenario-review/spec.md) · [API](./specs/006-test-scenario-review/contracts/test-scenario-review-api.md)                     |
| AP-007 — Postman Collection Generator             | Deterministic Postman collection + environment + README from the approved `TestModel`; credentials are never written into the artifact                      | [spec](./specs/007-postman-collection-generator/spec.md) · [API](./specs/007-postman-collection-generator/contracts/postman-collection-api.md)       |
| AP-008 — Dependency & Integration Workflow Engine | Detects producer/consumer relationships between operations and assembles confident ones into ordered multi-step workflows                                   | [spec](./specs/008-dependency-workflow-engine/spec.md) · [API](./specs/008-dependency-workflow-engine/contracts/api-dependency-workflow-api.md)      |
| AP-009 — End-to-End Test Generation Workflow      | Chains AP-002 through AP-008 into one resumable, server-tracked journey; the app's sole UI entry point                                                      | [spec](./specs/009-e2e-test-generation-workflow/spec.md) · [API](./specs/009-e2e-test-generation-workflow/contracts/test-generation-workflow-api.md) |
| AP-010 — Presentation & Review Scalability        | Filtered and multi-select bulk accept/reject so reviewing hundreds of scenarios stays practical                                                             | [spec](./specs/010-presentation-review-scalability/spec.md)                                                                                          |
| Bounded AI Prompt Batching                        | Splits a large specification's AI-assisted work into multiple sequential requests instead of skipping it                                                    | [spec](./specs/011-ai-prompt-batching/spec.md)                                                                                                       |
| AI Enhancement Progress Visibility                | Live per-batch progress and an unambiguous success/partial/failed outcome for the enhancement stage                                                         | [spec](./specs/012-ai-enhancement-progress/spec.md)                                                                                                  |

Two further hardening efforts are in progress:
[013-ai-enhancement-viability](./specs/013-ai-enhancement-viability/spec.md) (making local CPU
inference actually complete within its time budget) and
[014-ai-batching-policy](./specs/014-ai-batching-policy/spec.md) (pacing and sizing AI batches
realistically). See [specs/ROADMAP.md](./specs/ROADMAP.md) for the authoritative, up-to-date
implementation status of every feature.

## Architecture

An npm-workspaces monorepo with three packages:

```text
backend/                     Express + TypeScript API
  src/app.ts                   Express app assembly, middleware, routes, centralized error handling
  src/server.ts                 process entry point, configuration, HTTP listener startup
  src/api/                       one thin route module per endpoint
  src/openapi/                   parse -> validate -> analyze pipeline (AP-002), independent of Express
  src/testDesign/                deterministic scenario generation, review, and regeneration (AP-003, AP-006)
  src/postman/                   Postman artifact generation (AP-007)
  src/dependencies/              relationship detection and workflow assembly (AP-008)
  src/testGenerationWorkflow/    the guided-workflow state machine (AP-009)
  src/ai/                        AIProvider abstraction, local/mock providers, request batching, benchmarking (AP-004)

frontend/                    React + Vite + TypeScript UI
  src/App.tsx                   root component; renders the guided workflow
  src/pages/                     TestGenerationWorkflowPage.tsx - the sole composition root
  src/components/                per-stage workflow UI and reusable components
  src/services/                  HTTP clients; no API calls live in components

packages/shared-domain/      Framework-agnostic TypeScript contracts shared by backend and frontend
                              (ApiModel, TestModel, TestScenario, AIProvider, ReviewState, ...)
```

Routes stay thin; business logic lives in `openapi/`, `testDesign/`, `postman/`, `dependencies/`,
`testGenerationWorkflow/`, and `ai/`, each independent of Express and independently unit-testable.
Cross-layer types are defined once in `packages/shared-domain/` and consumed unchanged by both
`backend/` and `frontend/`. Each feature's own spec (linked in the table above) documents its
internal module boundaries in full detail.

## Testing

```powershell
npm test
```

Runs [Vitest](https://vitest.dev) once across all three workspaces (via
[vitest.workspace.ts](./vitest.workspace.ts)):

- `backend` — integration tests (Supertest against the Express app) and unit tests
- `frontend` — component tests (React Testing Library, jsdom environment)
- `shared-domain` — unit tests

Output is grouped and labeled per workspace, so pass/fail results are easy to attribute.
AI-dependent tests default to the deterministic mock provider — they never download a model,
require a GPU, or need network access. Re-running `npm test` with no code changes produces
identical results.

## Other scripts

- `npm run build` — builds all workspaces (TypeScript compilation; Vite production build for
  the frontend)
- `npm run lint` — runs ESLint across the repository
- `npm run stop` — stops any dev servers left running from a previous `npm run dev`
- `npm run ai:benchmark -w backend` — runs the AI model-selection benchmarking harness
  (downloads candidate models on first run)
- `npm run test:ai-real -w backend` — the opt-in real-model integration test (downloads and
  loads the configured model; excluded from `npm test`)

## Configuration

Configuration is environment-driven; see [.env.example](./.env.example) for the full, current
list with rationale. Common variables:

| Variable                  | Purpose                                                                                                                | Default                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `BACKEND_PORT`            | Backend HTTP port                                                                                                      | `4000`                                 |
| `FRONTEND_DEV_PORT`       | Frontend Vite dev server port                                                                                          | `5173`                                 |
| `AI_PROVIDER_MODE`        | `local` (Transformers.js) or `mock` (deterministic, no real model)                                                     | `mock` in tests, `local` otherwise     |
| `AI_MODEL_ID`             | Hugging Face repo id of the local model                                                                                | `onnx-community/Qwen2.5-0.5B-Instruct` |
| `AI_MODEL_CACHE_DIR`      | Local cache directory for downloaded model files                                                                       | `~/.apipilot/models`                   |
| `AI_MODEL_DTYPE`          | ONNX weight quantization; leave unset on CPU (fp32 measured faster and more accurate than q8 on the reference profile) | unset                                  |
| `AI_INFERENCE_TIMEOUT_MS` | Per-request inference timeout                                                                                          | `60000`                                |
| `AI_USE_ACCELERATOR`      | Attempt hardware-accelerated inference; falls back to CPU with a visible notice if unavailable                         | `false`                                |

AI features never send a specification or prompt to a cloud service, and never fall back from
the local provider to a cloud provider on failure — a failed or unavailable provider is reported
explicitly, and the deterministic baseline is always preserved.

## Deployment

[vercel.json](./vercel.json) deploys the frontend and backend as separate Vercel services from
this monorepo, rewriting `/api/*` to the backend service and everything else to the frontend.

## Documentation

- [specs/constitution.md](./specs/constitution.md) — the project's governing engineering
  principles
- [specs/ROADMAP.md](./specs/ROADMAP.md) — feature-by-feature implementation status
- `specs/<NNN-feature-name>/` — each feature's spec, plan, data model, API contracts, and
  quickstart

## License

Released under [MIT](/LICENSE) by [@io-anurag](https://github.com/io-anurag).
