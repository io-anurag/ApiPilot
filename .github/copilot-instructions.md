# ApiPilot — GitHub Copilot Instructions

## 1. Project Identity

You are contributing to **ApiPilot**, an AI-powered API test engineering platform.

ApiPilot transforms OpenAPI 3.x specifications into intelligent, executable API test suites.

The project has two fundamental engineering principles:

1. **Specification-driven API test generation**
2. **Deterministic, explainable, locally executable test engineering**

AI is an enhancement to the deterministic testing foundation. AI must never silently replace deterministic behavior, introduce unexplained randomness, or compromise reproducibility.

Treat this repository as a production-quality test engineering platform rather than a prototype or generic CRUD application.

---

## 2. Repository Architecture

ApiPilot is an npm-workspaces monorepo with these primary workspaces:

- `backend/`
- `frontend/`
- `packages/shared-domain/`
- `specs/`

### Backend

`backend/` contains the Express + TypeScript HTTP API.

Important areas:

- `backend/src/app.ts`

  - Express application assembly
  - middleware registration
  - route registration
  - centralized error handling

- `backend/src/server.ts`

  - application/process entry point
  - configuration loading
  - HTTP listener startup
  - startup failure handling

- `backend/src/api/`

  - HTTP route modules
  - Keep route modules thin
  - Business logic should live outside route handlers

- `backend/src/openapi/`

  - OpenAPI parsing
  - validation
  - normalization
  - API model construction

- `backend/src/testDesign/`

  - deterministic test scenario generation
  - value generation
  - rule evaluation
  - assertions
  - deduplication
  - test model orchestration

- `backend/src/ai/`

  - AI provider abstraction
  - local inference
  - mock provider
  - readiness state
  - request queue
  - model configuration
  - benchmarking

### Frontend

`frontend/` contains the React + Vite + TypeScript application.

Important areas:

- `frontend/src/App.tsx`
- `frontend/src/components/`
- `frontend/src/services/`

Keep API communication inside service/client modules rather than embedding HTTP calls throughout React components.

### Shared Domain

`packages/shared-domain/` contains framework-agnostic TypeScript contracts shared by backend and frontend.

Examples include:

- `ApiModel`
- `ApiOperation`
- `TestModel`
- `TestScenario`
- `GeneratedRequest`
- `Assertion`
- `Provenance`
- `AIProvider`
- `InferenceRequest`
- `InferenceResponse`
- `ReadinessState`

Shared domain types are the canonical contracts between backend and frontend.

Do not duplicate these contracts independently in backend and frontend.

---

# 3. Technology Baseline

Respect the existing technology choices unless a feature specification explicitly requires a change.

Current baseline:

- Node.js 20 LTS
- npm
- npm workspaces
- TypeScript
- Express
- React 18
- Vite 5
- Vitest
- Supertest
- React Testing Library
- jsdom
- Transformers.js for local AI inference

Do not introduce an alternative framework, package manager, test framework, or architectural pattern merely because you prefer it.

Before adding a dependency:

1. Check whether the existing platform can solve the problem.
2. Check whether an existing dependency already provides the required capability.
3. Consider bundle size and runtime impact.
4. Consider whether the dependency works offline.
5. Consider whether it introduces security, licensing, or maintenance concerns.
6. Prefer the smallest dependency that solves the actual requirement.

Avoid dependency proliferation.

---

# 4. Specification-Driven Development

ApiPilot uses specification-driven development.

The `specs/` directory is part of the project's engineering source of truth.

When implementing a feature:

1. Read the relevant specification first.
2. Read its plan and tasks when present.
3. Inspect existing implementation patterns.
4. Identify the affected domain contracts.
5. Implement the smallest coherent change.
6. Add or update tests.
7. Run validation.
8. Only then consider refactoring.

Do not implement functionality based solely on a high-level user request if a repository specification exists for that feature.

If the requested change conflicts with an existing specification, stop and identify the conflict instead of silently choosing one interpretation.

---

# 5. Spec-Kit Workflow

ApiPilot follows a Spec-Driven Development workflow compatible with GitHub Spec Kit.

When a change is substantial enough to require specification work, prefer the following lifecycle:

1. Constitution
2. Specification
3. Clarification
4. Technical plan
5. Task breakdown
6. Consistency analysis
7. Implementation
8. Validation

Use the repository's existing Spec Kit artifacts and conventions.

Relevant concepts include:

- `/speckit.constitution`
- `/speckit.specify`
- `/speckit.clarify`
- `/speckit.plan`
- `/speckit.tasks`
- `/speckit.analyze`
- `/speckit.checklist`
- `/speckit.implement`

Do not bypass the specification process for architectural changes simply because implementation appears straightforward.

The specification defines **what** the system must do.

The plan defines **how** it should be implemented.

Tasks define **what implementation work remains**.

Keep those concerns separate.

---

# 6. Core Engineering Principles

Follow these principles for every change.

## 6.1 Determinism First

ApiPilot must produce reproducible results wherever deterministic behavior is expected.

Do not introduce:

- uncontrolled randomness
- timestamps as hidden inputs
- random IDs affecting assertions
- non-deterministic ordering
- dependency on external services
- environment-specific behavior without explicit configuration

If randomness is genuinely required, isolate it behind an explicit abstraction and make it controllable in tests.

---

## 6.2 Explainability

Every generated test scenario should be explainable.

Prefer explicit provenance over opaque behavior.

For generated scenarios, preserve information such as:

- scenario category
- generating rule
- description
- duplicate/merged rules
- source specification information

Never fabricate an expected API response merely because one would be convenient for a test.

Expected behavior must originate from the API specification or an explicitly defined product rule.

---

## 6.3 Fail Explicitly

Do not silently recover from invalid or ambiguous input.

Prefer:

- typed errors
- explicit error categories
- structured error responses
- meaningful diagnostic information

Avoid:

- swallowing exceptions
- returning empty objects for failures
- silently changing user input
- silently falling back to unrelated behavior

---

## 6.4 No Silent AI Fallback

AI behavior must remain explicit.

The project supports local AI inference and deterministic mock inference.

Do not introduce a silent fallback from local AI to a cloud provider.

If the configured AI provider is unavailable:

- expose the failure
- preserve the readiness state
- return a typed/structured error
- allow explicit retry where supported

Never send user/API specification data to an external AI provider unless an explicit, documented product requirement authorizes it.

---

# 7. OpenAPI Processing Rules

The OpenAPI processing pipeline is intentionally separated from Express.

Maintain the separation:

```text
HTTP route
    ↓
OpenAPI pipeline
    ↓
parse
    ↓
validate
    ↓
build API model
```

Keep the core pipeline framework-independent and unit-testable.

Do not put OpenAPI business logic inside Express route handlers.

### Parsing

Malformed YAML must produce a typed `InvalidYamlError`.

Do not attempt to guess or repair malformed YAML silently.

### Version validation

ApiPilot currently targets OpenAPI 3.x.

Non-OpenAPI-3.x specifications must produce the appropriate typed unsupported-version error.

Do not silently convert Swagger 2.0 documents.

### `$ref` handling

External `$ref`s must not be fetched automatically.

Do not introduce:

- network access
- filesystem traversal
- arbitrary URL fetching

merely to resolve external references.

Internal references may be dereferenced according to the existing pipeline rules.

Unresolved or circular references should remain visible as analysis issues where the current product contract specifies that behavior.

### Unsupported constructs

Do not reject an entire specification merely because it contains an unsupported construct when the existing product contract says the construct should be flagged as an `AnalysisIssue`.

Examples include:

- callbacks
- links
- discriminator
- `oneOf`
- `anyOf`
- `allOf`
- webhooks

Do not fabricate support for these constructs unless the relevant specification explicitly requires it.

---

# 8. Canonical Domain Models

The shared-domain package is the canonical location for cross-layer contracts.

If a model is required by both backend and frontend:

1. Define it in `packages/shared-domain`.
2. Export it from the shared package.
3. Consume it from backend/frontend.

Do not create duplicate representations.

Avoid unnecessary transformations such as:

```text
Shared ApiModel
    ↓
BackendApiModel
    ↓
FrontendApiModel
```

unless there is a genuine architectural boundary requiring transformation.

Prefer:

```text
OpenAPI
    ↓
Backend
    ↓
Shared ApiModel
    ↓
Frontend
```

The shared model should remain framework-agnostic.

Do not put Express, React, browser, or Node-specific dependencies into `shared-domain`.

---

# 9. Deterministic Test Designer

The test designer is a core product capability.

Its purpose is to generate a deterministic baseline suite from an analyzed `ApiModel`.

The test designer must not depend on an LLM.

Do not use AI to decide baseline scenarios unless a future specification explicitly changes this contract.

The deterministic pipeline consists conceptually of:

```text
ApiModel
   ↓
Rule evaluation
   ↓
Generated values
   ↓
Scenarios
   ↓
Assertions
   ↓
Deduplication
   ↓
TestModel
```

Each rule should remain independently testable.

Prefer pure functions:

```text
(operation) => TestScenario[]
```

Avoid global mutable state.

---

# 10. Scenario Generation Rules

Existing scenario categories include concepts such as:

- positive scenarios
- missing required fields
- invalid types
- invalid formats
- invalid enum values
- numeric boundaries
- string boundaries
- array boundaries

When adding a new rule:

1. Create a dedicated rule module when appropriate.
2. Keep the rule deterministic.
3. Add focused unit tests.
4. Define its provenance.
5. Ensure it interacts correctly with deduplication.
6. Verify that it does not fabricate assertions.

Do not modify unrelated rules to accommodate a new scenario unless the domain model requires it.

---

# 11. Generated Values

Generated test data must be:

- deterministic
- specification-aware
- safe
- minimal
- reproducible

Values should respect the API schema whenever generating positive/conformant requests.

For negative scenarios, deliberately violate the relevant constraint.

Examples:

- wrong type
- invalid format
- invalid enum
- missing required field
- below minimum
- above maximum
- below minimum length
- above maximum length

Do not create arbitrary invalid data when the rule requires a specific constraint violation.

The generated request should make the reason for the scenario obvious.

---

# 12. Assertions

Assertions must be grounded in the OpenAPI specification.

Use documented responses when determining expected status codes or response-schema expectations.

Do not invent:

```text
400
401
403
404
500
```

unless the specification or explicit product rules justify them.

An empty assertions array may represent a legitimate documentation gap.

When there is no applicable documented response:

- preserve the empty assertion set
- explain the gap through provenance
- do not fabricate a status code

---

# 13. Deduplication

Scenario deduplication is intentional behavior.

If multiple rules generate an identical request and assertion set:

- retain one representative scenario
- preserve provenance
- record the rules that would otherwise have generated duplicates

Do not remove provenance simply to simplify the output.

Deduplication must be deterministic and stable.

---

# 14. AI Architecture

AI functionality must go through the `AIProvider` abstraction.

Do not call Transformers.js directly from arbitrary application code.

The only module that should directly depend on the local inference library is the designated local provider implementation.

Preferred architecture:

```text
Feature
  ↓
AIProvider
  ↓
Provider implementation
  ├── Local provider
  └── Mock provider
```

This makes AI-dependent features testable without downloading or executing a real model.

---

# 15. AI Provider Modes

Respect:

```text
AI_PROVIDER_MODE=local
AI_PROVIDER_MODE=mock
```

Automated tests should default to the mock provider.

Do not make ordinary tests:

- download models
- require GPU hardware
- require internet access
- execute expensive inference
- depend on Hugging Face availability

Real-model tests must remain explicitly opt-in.

---

# 16. AI Readiness

AI readiness is a state machine.

Respect the existing states:

- `not-loaded`
- `loading`
- `ready`
- `unavailable`

An unavailable provider must expose a meaningful reason.

Do not silently convert:

```text
unavailable → loading → ready
```

without an explicit retry operation when the architecture specifies that retry is manual.

Do not introduce hidden background retries.

---

# 17. AI Request Queue

The current architecture uses an in-process FIFO request queue.

Preserve:

- FIFO semantics
- bounded/controlled behavior where specified
- deterministic tests
- explicit error propagation

Do not introduce Redis, RabbitMQ, Kafka, or another external broker for a feature that only requires the existing in-process queue.

A distributed queue would be an architectural decision requiring specification and planning.

---

# 18. Local Inference

Local inference must remain local by default.

Never:

- transmit prompts to an external service
- transmit API specifications to an external AI provider
- silently fall back to cloud inference
- log sensitive prompts/responses unnecessarily

If accelerator execution is configured but unavailable, follow the existing visible CPU fallback behavior.

Do not conceal the fallback.

---

# 19. AI Benchmarking

Model selection must be evidence-based.

The benchmarking system exists to compare candidate local models using measurable criteria.

When modifying benchmarking:

Preserve metrics such as:

- structured-output success rate
- average latency
- peak memory
- selection rationale

Do not select a model solely because it is newer, larger, or popular.

Do not commit downloaded model artifacts unless explicitly required.

---

# 20. Backend API Design

Keep route handlers thin.

Prefer:

```text
HTTP request
   ↓
route validation / adaptation
   ↓
domain/service function
   ↓
domain result
   ↓
HTTP response
```

Avoid putting large algorithms directly into:

```text
backend/src/api/*.ts
```

Route handlers should primarily:

- receive input
- invoke application/domain logic
- map results to HTTP responses
- delegate errors to centralized handling

---

# 21. Error Handling

ApiPilot uses centralized backend error handling.

All expected application errors should be mapped consistently.

Do not expose:

- stack traces
- internal filesystem paths
- model internals
- environment variables
- secrets
- implementation-specific debugging information

to API clients.

Production-facing `5xx` responses must remain safe.

Detailed diagnostics belong in controlled server-side logging where appropriate.

---

# 22. API Contracts

When changing an API endpoint, inspect the corresponding contract under:

```text
specs/**/contracts/
```

Before changing:

- request shape
- response shape
- status code
- error code
- validation behavior
- content type

update the relevant specification/contract first when the change is intentional.

Do not casually break an existing API contract.

---

# 23. Frontend Architecture

React components should primarily manage:

- presentation
- user interaction
- local UI state

API calls belong in:

```text
frontend/src/services/
```

Prefer reusable components in:

```text
frontend/src/components/
```

Avoid embedding large data-processing algorithms inside JSX components.

If a computation is domain logic rather than presentation logic, consider whether it belongs in `shared-domain` or the backend.

---

# 24. Frontend State and UX

The UI must distinguish between:

- loading
- success
- empty
- invalid input
- backend unavailable
- domain error

Do not use ambiguous states such as an empty list to represent a failed API call.

Error messages should be understandable to the user without exposing backend internals.

Maintain the application's existing visual language rather than introducing a new UI framework or design system for isolated features.

---

# 25. Testing Philosophy

Tests are a first-class part of every feature.

Every meaningful behavior change should include appropriate tests.

Use the correct test layer.

### Unit tests

Use for:

- pure functions
- rule modules
- value generators
- parsers
- domain transformations
- state machines

### Backend integration tests

Use for:

- Express routes
- HTTP contracts
- error mapping
- request/response behavior

Use Supertest where appropriate.

### Frontend component tests

Use React Testing Library for:

- component behavior
- user interaction
- rendering states
- API-driven UI behavior

### AI tests

Default AI tests to the deterministic mock provider.

Real-model tests must remain opt-in.

---

# 26. Test Quality Requirements

Do not write tests merely to increase coverage.

Tests should verify behavior and invariants.

Prefer tests that answer:

- What behavior is guaranteed?
- What input boundary matters?
- What failure mode is prevented?
- What contract must remain stable?
- Why is this scenario generated?

Avoid brittle tests that depend on:

- implementation details
- CSS class names when semantic queries are possible
- exact incidental ordering
- internal function calls
- arbitrary timing

---

# 27. Deterministic Tests

A test should produce the same result when run repeatedly.

Avoid:

```text
Math.random()
new Date()
network calls
external APIs
real model downloads
machine-specific paths
```

unless the test explicitly exists to validate that behavior.

Where time is required, inject or control it.

Where randomness is required, inject a deterministic source.

Where AI is required, prefer the mock provider.

---

# 28. Validation Before Completion

Before considering a change complete, run the smallest relevant validation and then the repository-wide checks when practical.

Standard commands:

```bash
npm test
npm run build
npm run lint
```

For AI-specific changes, also consider:

```bash
npm run ai:benchmark -w backend
```

and, only when explicitly needed:

```bash
npm run test:ai-real -w backend
```

Do not claim tests pass unless they were actually executed.

If a command cannot be executed, state that explicitly.

---

# 29. Build and Lint Discipline

Do not leave:

- TypeScript errors
- ESLint errors
- unused imports
- dead code
- accidental `any`
- broken workspace references

behind.

Avoid weakening compiler or linter settings simply to make new code pass.

Do not add `eslint-disable` comments unless there is a documented and justified reason.

---

# 30. TypeScript Standards

Use TypeScript's type system to express domain invariants.

Prefer:

- explicit domain types
- discriminated unions
- narrow types
- readonly structures where appropriate
- typed error classes
- type-safe function boundaries

Avoid:

```typescript
any;
```

unless there is a compelling technical reason.

When `any` is unavoidable, isolate it at the boundary and convert it into a safe internal type as early as possible.

Do not use type assertions to silence legitimate type errors.

Prefer correcting the underlying type design.

---

# 31. Immutability and Side Effects

Keep domain logic as pure as practical.

Prefer:

```text
input → result
```

over hidden mutation.

Avoid modifying shared objects unexpectedly.

Especially protect:

- parsed OpenAPI documents
- `ApiModel`
- `TestModel`
- scenario definitions
- shared domain objects

If mutation is required for performance or library compatibility, make it explicit and localized.

---

# 32. Security Requirements

ApiPilot processes API specifications, which may contain sensitive information.

Treat uploaded specifications as potentially sensitive.

Never:

- log entire specifications unnecessarily
- log authorization headers
- log API keys
- expose secrets in frontend error messages
- persist uploaded specifications unless explicitly required
- fetch arbitrary external `$ref` URLs
- execute content from an uploaded specification

Respect the existing requirement that OpenAPI uploads are processed without persistence beyond the request unless a future specification explicitly changes this behavior.

---

# 33. File Upload Safety

The current OpenAPI upload limit is 10 MB.

Preserve explicit size validation.

Do not increase limits casually.

Validate:

- file size
- accepted file types/extensions
- content/parsing validity

Do not trust the filename alone to establish document validity.

---

# 34. Environment Configuration

Configuration should be explicit and environment-driven where appropriate.

Existing configuration includes values such as:

```text
BACKEND_PORT
FRONTEND_DEV_PORT
AI_PROVIDER_MODE
AI_MODEL_ID
AI_MODEL_CACHE_DIR
AI_INFERENCE_TIMEOUT_MS
AI_USE_ACCELERATOR
```

Do not hard-code environment-specific values into application logic.

Do not commit secrets.

Update `.env.example` when introducing a new required environment variable.

Document new configuration values.

---

# 35. Dependency Management

Use npm and the existing workspace structure.

Do not introduce another package manager.

When adding dependencies:

1. Add them to the correct workspace.
2. Update the lockfile.
3. Avoid duplicate libraries serving the same purpose.
4. Prefer mature, actively maintained packages.
5. Consider whether the package works in the project's offline/local-first architecture.

Never modify `package-lock.json` manually when npm can generate the correct changes.

---

# 36. Logging

Logs should be useful for diagnosing failures without exposing sensitive information.

Do not log:

- secrets
- API keys
- bearer tokens
- full uploaded specifications
- complete prompts/responses containing potentially sensitive data

Prefer structured, contextual information:

```text
operation
error category
request correlation information
duration
provider state
```

where supported by the existing architecture.

---

# 37. API and Domain Naming

Follow existing naming conventions.

Prefer names that describe domain intent.

Examples:

```text
ApiModel
TestModel
TestScenario
GeneratedRequest
AnalysisIssue
AIProvider
ReadinessState
```

Avoid generic names such as:

```text
Data
Manager
Helper
Utils
Processor
Thing
```

unless the existing module convention clearly establishes the meaning.

Do not rename public/shared domain concepts without a strong reason because these names form part of the project's conceptual model.

---

# 38. Module Boundaries

Respect existing module boundaries.

In particular:

```text
backend/src/openapi/
```

owns OpenAPI analysis.

```text
backend/src/testDesign/
```

owns deterministic scenario generation.

```text
backend/src/ai/
```

owns AI provider infrastructure.

```text
packages/shared-domain/
```

owns shared contracts.

Do not move logic between these areas merely to make an individual implementation shorter.

A module boundary should represent architectural responsibility, not file convenience.

---

# 39. Avoid Premature Abstraction

Do not create abstractions for hypothetical future requirements.

Before introducing an interface, factory, strategy, registry, framework, or plugin architecture, establish that the current requirement actually benefits from it.

Prefer simple code with clear boundaries.

However, preserve abstractions that already exist intentionally, especially:

- `AIProvider`
- domain contracts
- provider factories
- rule modules

Do not collapse intentional architecture merely to reduce line count.

---

# 40. Backward Compatibility

When modifying existing functionality, preserve behavior unless the feature specification explicitly changes it.

Before changing behavior, identify:

- existing consumers
- API contracts
- shared-domain consumers
- tests
- frontend assumptions
- specification requirements

Prefer additive changes over breaking changes.

If a breaking change is unavoidable, update:

1. specification
2. contract
3. shared domain
4. backend
5. frontend
6. tests
7. documentation

as one coherent change.

---

# 41. Documentation

Update documentation when behavior or architecture changes.

Documentation should explain:

- why the behavior exists
- important constraints
- configuration
- usage
- architectural boundaries

Avoid documenting obvious implementation details that will become stale quickly.

The README should remain focused on user/developer onboarding and product capabilities.

Detailed implementation rationale belongs in specifications or architecture documentation.

---

# 42. Git and Change Discipline

Keep changes focused.

Do not mix unrelated refactoring with feature work.

Avoid:

- mass formatting unrelated files
- renaming unrelated symbols
- dependency upgrades unrelated to the feature
- changing configuration without necessity
- rewriting working modules unnecessarily

A pull request should be understandable from its diff.

---

# 43. Working With Existing Code

Before creating new code:

1. Search for an existing implementation.
2. Search for similar tests.
3. Search the shared-domain package.
4. Search the specifications.
5. Search for existing utilities.
6. Follow the established pattern when it is appropriate.

Do not duplicate existing behavior because you failed to discover it.

Prefer extending an existing abstraction over creating a parallel abstraction.

---

# 44. AI-Generated Code Review

Treat generated code as untrusted until validated.

For every AI-generated change, verify:

- correctness
- type safety
- test coverage
- determinism
- security
- architectural boundaries
- specification compliance
- error behavior
- performance implications

Do not accept generated code simply because it compiles.

Compilation is not sufficient validation.

---

# 45. Implementation Workflow

For a normal feature, follow this sequence:

### Step 1 — Understand

Read:

- relevant specification
- relevant plan
- relevant tasks
- affected source files
- existing tests

### Step 2 — Identify boundaries

Determine:

- backend changes
- frontend changes
- shared-domain changes
- API contract changes
- AI changes
- test changes

### Step 3 — Implement domain behavior

Prefer implementing pure/domain behavior before HTTP/UI wiring.

### Step 4 — Define contracts

Update shared types and API contracts where required.

### Step 5 — Add backend behavior

Keep route handlers thin.

### Step 6 — Add frontend behavior

Use service modules and reusable components.

### Step 7 — Test

Add focused tests at the appropriate layers.

### Step 8 — Validate

Run:

```bash
npm test
npm run lint
npm run build
```

### Step 9 — Review

Check for:

- unnecessary complexity
- duplicated logic
- security issues
- architectural violations
- missing tests
- undocumented behavior

---

# 46. When Requirements Are Ambiguous

Do not guess about important product behavior.

If ambiguity affects:

- API contract
- data model
- security
- persistence
- AI behavior
- generated test semantics
- expected status codes
- architecture

ask for clarification or consult the relevant specification.

For minor implementation details, follow existing repository conventions.

Never invent business rules.

---

# 47. When a Specification Is Missing

If a substantial feature has no specification:

Do not immediately implement a large solution.

First determine whether the change should go through the Spec Kit workflow.

For non-trivial product behavior, propose/specify:

- problem
- user story
- functional requirements
- acceptance criteria
- constraints
- edge cases
- technical approach
- testing strategy

Then implement against the agreed specification.

---

# 48. What Not to Do

Never:

- introduce cloud AI silently
- send API specifications to external services without explicit authorization
- add randomness to deterministic test generation
- fabricate expected API responses
- fetch external `$ref`s automatically
- put domain logic into route handlers
- duplicate shared domain models
- make real AI model downloads part of ordinary tests
- bypass existing module boundaries
- weaken lint/type checks to make code pass
- disable tests to hide failures
- swallow errors
- expose stack traces
- commit secrets
- commit downloaded model artifacts unless explicitly required
- add unnecessary dependencies
- rewrite unrelated code
- claim validation passed without running it

---

# 49. Definition of Done

A feature is not complete merely because the implementation exists.

Before declaring completion, confirm:

- [ ] The implementation matches the relevant specification.
- [ ] Existing architecture and module boundaries are preserved.
- [ ] Shared contracts are updated where necessary.
- [ ] API contracts are preserved or intentionally versioned.
- [ ] Determinism is preserved.
- [ ] Security implications were considered.
- [ ] Appropriate tests were added or updated.
- [ ] Existing tests pass.
- [ ] Lint passes.
- [ ] Build passes.
- [ ] Documentation/specification is updated where necessary.
- [ ] No unrelated files were changed.
- [ ] No secrets or sensitive data were introduced.
- [ ] AI behavior remains explicit and locally controlled.
- [ ] No cloud fallback was introduced.
- [ ] The final diff is minimal and reviewable.

---

# 50. Response Expectations for GitHub Copilot

When asked to modify ApiPilot:

1. Briefly explain your understanding of the requested change.
2. Identify the relevant specification and modules.
3. State any important assumptions.
4. Implement the change.
5. Add/update tests.
6. Run appropriate validation.
7. Report exactly what was changed.
8. Report validation results honestly.
9. Mention any remaining limitations or follow-up work.

Do not provide lengthy generic explanations when the user asks for implementation.

Prefer precise engineering language.

When presenting code changes, explain the architectural reason for the change rather than merely describing each line.

---

# 51. Priority of Instructions

When instructions conflict, use this priority:

1. Explicit user requirement
2. Repository specification/contract
3. Project constitution/principles
4. Existing architecture and domain contracts
5. Existing tests and established behavior
6. These Copilot instructions
7. Personal implementation preference

If following a higher-priority requirement requires breaking an existing convention, explicitly identify the conflict and make the smallest necessary change.

---

# 52. ApiPilot North Star

Every change should move ApiPilot toward this goal:

> **Turn API specifications into trustworthy, explainable, reproducible API test engineering assets.**

Trustworthiness requires:

- deterministic generation
- specification-grounded assertions
- explicit provenance
- safe handling of API specifications
- reproducible AI infrastructure
- strong contracts
- comprehensive tests
- transparent failure behavior

Optimize for these properties over cleverness, novelty, or unnecessary abstraction.
