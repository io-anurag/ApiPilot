# ApiPilot — GitHub Copilot Instructions

## 1. Project Overview

ApiPilot is an AI-powered API test engineering platform that transforms OpenAPI specifications into intelligent, executable, and explainable API test suites.

The project's core principles are:

1. Specification-driven development
2. Deterministic test generation
3. Specification-grounded assertions
4. Explainable test provenance
5. Local-first AI inference
6. Reproducible execution
7. Strong type-safe contracts
8. Secure handling of API specifications
9. High-quality automated testing
10. Clear separation of domain, infrastructure, API, and presentation concerns

AI is an enhancement to the deterministic testing foundation. AI must not silently replace deterministic behavior, introduce unexplained randomness, or compromise reproducibility.

Treat ApiPilot as a production-quality developer/test-engineering platform rather than a generic CRUD application or AI demo.

---

# 2. Repository Structure

ApiPilot is an npm-workspaces monorepo.

Primary areas:

```text
backend/
frontend/
packages/shared-domain/
specs/
.github/
```

## Backend

`backend/` contains the Express + TypeScript API.

Important areas:

```text
backend/src/app.ts
backend/src/server.ts
backend/src/api/
backend/src/openapi/
backend/src/testDesign/
backend/src/ai/
```

### `backend/src/app.ts`

Responsible for:

- Express application assembly
- middleware registration
- route registration
- centralized error handling

### `backend/src/server.ts`

Responsible for:

- application startup
- configuration loading
- HTTP listener startup
- startup failure handling

### `backend/src/api/`

Contains HTTP/API route modules.

Routes should remain thin.

Do not put substantial business logic into route handlers.

### `backend/src/openapi/`

Responsible for:

- OpenAPI parsing
- validation
- normalization
- OpenAPI analysis
- API model construction

### `backend/src/testDesign/`

Responsible for:

- deterministic scenario generation
- rule evaluation
- test value generation
- assertions
- deduplication
- test model construction

### `backend/src/ai/`

Responsible for:

- AI provider abstraction
- local inference
- mock inference
- provider readiness
- inference queueing
- model configuration
- AI benchmarking

---

# 3. Frontend

`frontend/` contains the React + Vite + TypeScript application.

Important areas include:

```text
frontend/src/App.tsx
frontend/src/components/
frontend/src/services/
```

React components should primarily handle:

- presentation
- user interaction
- UI state

API communication should live in service/client modules.

Do not scatter HTTP calls throughout React components.

Business/domain logic should not be unnecessarily embedded in JSX.

---

# 4. Shared Domain

`packages/shared-domain/` contains framework-agnostic TypeScript contracts shared between backend and frontend.

Examples include concepts such as:

```text
ApiModel
ApiOperation
TestModel
TestScenario
GeneratedRequest
Assertion
Provenance
AIProvider
InferenceRequest
InferenceResponse
ReadinessState
AnalysisIssue
```

The shared-domain package is the canonical source for cross-layer contracts.

If a type is required by both backend and frontend:

1. Define it in `packages/shared-domain/`.
2. Export it from the shared package.
3. Consume it from backend/frontend.

Do not create duplicate backend and frontend versions of the same domain model without a documented architectural reason.

The shared-domain package must remain framework-agnostic.

Do not add Express, React, browser-specific, or Node-specific dependencies to it.

---

# 5. Technology Baseline

Respect the repository's existing technology choices.

The current repository baseline includes:

- Node.js 20 LTS
- npm
- npm workspaces
- TypeScript
- Express
- React
- Vite
- Vitest
- Supertest
- React Testing Library
- jsdom
- Transformers.js for local AI inference
- Tailwind CSS v4 as the intended frontend styling direction; preserve the Tailwind
  conventions below when frontend styling is introduced or migrated

Do not replace an existing framework, package manager, test framework, or styling system simply because another technology is personally preferred.

Before introducing a dependency:

1. Check whether the existing codebase already provides the capability.
2. Check whether an existing dependency can solve the problem.
3. Consider bundle size and runtime impact.
4. Consider offline/local-first requirements.
5. Consider security and licensing.
6. Prefer the smallest dependency that solves the actual requirement.

Avoid dependency proliferation.

---

# 6. Specification-Driven Development

ApiPilot follows specification-driven development.

The specification artifacts are part of the engineering source of truth. If
`.specify/memory/constitution.md` exists, treat it as authoritative for governance;
otherwise use the available `specs/` artifacts and report any apparent governance drift
between them.

When implementing a feature:

1. Read the relevant specification.
2. Read its plan and tasks when present.
3. Inspect existing implementation patterns.
4. Identify affected domain contracts.
5. Implement the smallest coherent change.
6. Add or update tests.
7. Run validation.
8. Review the resulting diff.

Do not implement substantial functionality based only on a high-level user request when a repository specification exists.

If the requested behavior conflicts with an existing specification, identify the conflict rather than silently choosing an interpretation.

---

# 7. Spec-Kit Workflow

For substantial feature work, use the repository's Spec-Driven Development workflow.

Conceptually:

```text
Constitution
    ↓
Specification
    ↓
Clarification
    ↓
Technical Plan
    ↓
Tasks
    ↓
Consistency Analysis
    ↓
Implementation
    ↓
Validation
```

Use the repository's existing Spec Kit conventions and artifacts.

Relevant commands/concepts may include:

```text
/speckit.constitution
/speckit.specify
/speckit.clarify
/speckit.plan
/speckit.tasks
/speckit.analyze
/speckit.checklist
/speckit.implement
```

Do not bypass specification work for substantial architectural or product changes.

The specification defines **what** the system must do.

The plan defines **how** it should be implemented.

Tasks define **what implementation work remains**.

---

# 8. Core Engineering Principles

## 8.1 Determinism First

ApiPilot must produce reproducible results wherever deterministic behavior is expected.

Do not introduce uncontrolled:

- randomness
- timestamps
- random IDs
- ordering
- external service dependencies
- environment-dependent behavior

If randomness is required, isolate it behind an explicit abstraction and make it controllable in tests.

---

## 8.2 Explainability

Generated test scenarios must be explainable.

Preserve provenance such as:

- scenario category
- generating rule
- description
- merged/duplicate rules
- relevant specification information

Do not generate opaque scenarios whose reason for existence cannot be determined.

---

## 8.3 Specification-Grounded Behavior

The OpenAPI specification is the primary source of truth for API behavior.

Do not fabricate:

- expected response codes
- response schemas
- validation behavior
- request fields
- constraints

when those values are not supported by the specification or an explicit product rule.

---

## 8.4 Explicit Failure

Do not silently recover from invalid or ambiguous input.

Prefer:

- typed errors
- structured error responses
- meaningful diagnostics
- explicit failure states

Avoid:

- swallowed exceptions
- empty objects representing failures
- silent input mutation
- unrelated fallback behavior

---

# 9. OpenAPI Processing

Keep the OpenAPI pipeline independent from Express.

Preferred architecture:

```text
HTTP Route
    ↓
OpenAPI Pipeline
    ↓
Parse
    ↓
Validate
    ↓
Analyze
    ↓
Build ApiModel
```

Do not put OpenAPI business logic into Express route handlers.

## Parsing

Malformed YAML must produce an appropriate typed error such as `InvalidYamlError`.

Do not silently repair malformed documents.

## OpenAPI Version

ApiPilot targets OpenAPI 3.x.

Unsupported versions must produce the appropriate validation/error behavior.

Do not silently convert Swagger 2.0 documents.

## `$ref`

Do not automatically fetch external `$ref` URLs.

Do not introduce network access or filesystem traversal merely to resolve external references.

Internal references may be processed according to the existing specification.

Unresolved/circular references should remain visible as analysis issues when required by the product contract.

## Unsupported Constructs

Do not reject an entire specification merely because it contains an unsupported construct when the existing product contract expects an `AnalysisIssue`.

Examples include:

- callbacks
- links
- discriminator
- `oneOf`
- `anyOf`
- `allOf`
- webhooks

Do not fabricate support for these constructs unless explicitly required by a specification.

---

# 10. Deterministic Test Designer

The deterministic test designer is a core product capability.

It generates a baseline test suite from an analyzed `ApiModel`.

The deterministic test designer must not depend on an LLM.

Preferred pipeline:

```text
ApiModel
    ↓
Rule Evaluation
    ↓
Generated Values
    ↓
Scenarios
    ↓
Assertions
    ↓
Deduplication
    ↓
TestModel
```

Keep rules independently testable.

Prefer pure functions:

```text
operation → TestScenario[]
```

Avoid global mutable state.

---

# 11. Scenario Generation

Scenario categories include concepts such as:

- positive scenarios
- missing required fields
- invalid types
- invalid formats
- invalid enum values
- numeric boundaries
- string boundaries
- array boundaries

When adding a rule:

1. Keep it deterministic.
2. Create a dedicated rule module when appropriate.
3. Add focused unit tests.
4. Define provenance.
5. Verify deduplication behavior.
6. Ensure assertions remain specification-grounded.

Do not modify unrelated rules without a clear reason.

---

# 12. Generated Test Values

Generated values must be:

- deterministic
- specification-aware
- reproducible
- safe
- minimal

Positive scenarios must respect the relevant schema.

Negative scenarios should deliberately violate the intended constraint.

Examples:

```text
wrong type
invalid format
invalid enum
missing required property
below minimum
above maximum
below minimum length
above maximum length
```

Do not generate arbitrary invalid data when a specific constraint violation is required.

The generated value should make the scenario's purpose obvious.

---

# 13. Assertions

Assertions must be grounded in the OpenAPI specification.

Do not fabricate expected status codes such as:

```text
400
401
403
404
500
```

unless justified by:

- the OpenAPI document
- an explicit product rule
- an established specification

If there is no documented response expectation, an empty assertion set may be valid.

Do not fabricate assertions merely to make the generated test appear complete.

---

# 14. Deduplication

Scenario deduplication is intentional.

If multiple rules produce an identical request/assertion combination:

- retain one representative scenario
- preserve provenance
- record contributing rules when supported

Deduplication must remain deterministic and stable.

Do not remove provenance simply to simplify output.

---

# 15. AI Architecture

All AI functionality must go through the `AIProvider` abstraction.

Do not call Transformers.js directly from arbitrary application code.

Preferred architecture:

```text
Feature
    ↓
AIProvider
    ↓
Provider Implementation
    ├── Local Provider
    └── Mock Provider
```

Only the designated local provider should directly depend on the local inference library.

This keeps AI-dependent features testable without requiring a real model.

---

# 16. AI Provider Modes

Respect the project's provider configuration, including concepts such as:

```text
AI_PROVIDER_MODE=local
AI_PROVIDER_MODE=mock
```

Automated tests should default to the mock provider.

Ordinary tests must not:

- download models
- require GPU hardware
- require internet access
- execute expensive inference
- depend on external model availability

Real-model tests must remain explicitly opt-in.

---

# 17. Explicit AI Provider Selection

AI must remain local-first for the current product scope. The current AP-004 implementation
supports local and mock providers only. A future cloud or hybrid provider may be added only
through an explicit specification, configuration mode, privacy review, and provider
abstraction.

Never silently:

- send API specifications to a cloud AI service
- send prompts to an external provider
- fall back from local AI to cloud AI

An explicitly configured future external provider must still:

- keep provider credentials server-side
- clearly indicate when data leaves the local machine
- preserve structured contracts, validation, provenance, and error handling
- never be substituted automatically when local inference fails

If the configured provider is unavailable:

- expose the failure
- preserve readiness state
- return a structured error
- support explicit retry where specified

Do not introduce hidden background retries or implicit provider switching.

---

# 18. AI Readiness

AI readiness is represented as explicit state.

Existing concepts include:

```text
not-loaded
loading
ready
unavailable
```

Do not silently transition between states without respecting the existing state-machine semantics.

Unavailable providers should expose a meaningful reason.

Do not hide provider failures.

---

# 19. AI Request Queue

The current architecture uses an in-process FIFO request queue.

Preserve:

- FIFO semantics
- deterministic behavior
- controlled queue behavior
- explicit error propagation

Do not introduce Redis, RabbitMQ, Kafka, or another external queue unless a specification explicitly requires distributed queueing.

---

# 20. Local Inference

Local inference must remain local by default.

Never:

- transmit API specifications externally
- transmit sensitive prompts externally
- silently use cloud inference
- log sensitive prompts/responses unnecessarily

If accelerator execution is configured but unavailable, follow the existing explicit CPU fallback behavior.

Do not hide the fallback.

---

# 21. AI Benchmarking

AI model selection should be evidence-based.

Benchmarking should consider metrics such as:

- structured-output success rate
- average latency
- peak memory
- selection rationale

Do not select a model merely because it is newer, larger, or more popular.

Do not commit downloaded model artifacts unless explicitly required.

---

# 22. Backend API Architecture

Keep HTTP routes thin.

Preferred architecture:

```text
HTTP Request
    ↓
Route Validation / Adaptation
    ↓
Application / Domain Logic
    ↓
Domain Result
    ↓
HTTP Response
```

Routes should primarily:

- receive input
- validate/adapt input
- invoke domain/application logic
- map results to HTTP responses
- delegate errors

Do not place large algorithms in route modules.

---

# 23. API Contracts

When modifying an endpoint, inspect the relevant contracts under:

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

update the specification/contract when the change is intentional.

Do not casually break an existing API contract.

---

# 24. Error Handling

Use centralized backend error handling.

Expected application errors should be mapped consistently.

Do not expose to clients:

- stack traces
- filesystem paths
- secrets
- environment variables
- internal model details
- internal debugging information

Production-facing `5xx` responses must remain safe.

Detailed diagnostics belong in controlled server-side logging.

---

# 25. Frontend Architecture

React components should primarily manage:

- presentation
- interaction
- local UI state

API calls belong in:

```text
frontend/src/services/
```

Reusable UI belongs in:

```text
frontend/src/components/
```

Do not put substantial business logic inside JSX.

If logic is domain logic rather than presentation logic, consider whether it belongs in:

- `shared-domain`
- backend domain/application logic

---

# 26. Frontend Styling — Tailwind CSS

ApiPilot uses **Tailwind CSS v4** as its primary frontend styling system.

Use Tailwind for:

- layout
- spacing
- typography
- colors
- borders
- shadows
- responsive behavior
- interaction states
- transitions
- sizing
- positioning

Do not introduce another general-purpose styling framework.

Do not introduce:

- Bootstrap
- Material UI
- Chakra UI
- Ant Design
- styled-components
- Emotion

for ordinary application UI.

Tailwind should be integrated using the official Vite integration.

---

# 27. Tailwind CSS v4 Configuration

Use Tailwind CSS v4 conventions.

Prefer:

```css
@import "tailwindcss";
```

and CSS-first configuration using `@theme`.

Do not introduce legacy Tailwind v3 configuration patterns into new code.

Avoid creating:

```text
tailwind.config.js
```

unless a specific dependency or compatibility requirement genuinely requires it.

Use `@theme` for project design tokens.

Example:

```css
@import "tailwindcss";

@theme {
  --color-brand-500: ...;
  --color-brand-600: ...;
  --color-success-500: ...;
  --color-warning-500: ...;
  --color-danger-500: ...;
}
```

Tailwind v4's theme variables should be treated as the project's design-token layer.

---

# 28. ApiPilot Visual Language

ApiPilot is a developer/API engineering product.

The UI should communicate:

- technical precision
- reliability
- clarity
- confidence
- information density
- engineering quality

Think of the visual language as:

**Developer Tool + API Observatory**

The primary workflow should remain visually clear:

```text
OpenAPI
   ↓
Analysis
   ↓
Test Design
   ↓
Generated Tests
   ↓
Results
```

Prefer:

- dense but readable data panels
- strong information hierarchy
- HTTP method badges
- API path typography
- status indicators
- JSON/YAML code blocks
- test scenario tables/cards
- provenance indicators
- analysis issue severity
- command-oriented actions

Avoid excessive:

- gradients
- decorative illustrations
- oversized cards
- excessive border radius
- unnecessary shadows
- visual noise
- ornamental UI
- large marketing-style typography

The interface should prioritize usability over decoration.

---

# 29. Design Tokens

Maintain a coherent design system.

Define reusable tokens for:

- brand colors
- semantic success/warning/error colors
- backgrounds
- surfaces
- borders
- text
- typography
- shadows
- radius
- breakpoints when customization is necessary

Prefer semantic names such as:

```text
brand
success
warning
danger
info
surface
background
muted
border
```

Do not scatter unrelated color choices throughout the application.

If a value is repeatedly used, consider making it a design token.

---

# 30. Tailwind Utility Usage

Prefer Tailwind utilities over one-off CSS classes.

Use responsive variants and state variants directly:

```tsx
className="
  rounded-md
  bg-brand-600
  px-4
  py-2
  text-sm
  font-medium
  text-white
  hover:bg-brand-700
  focus:outline-none
  focus:ring-2
  focus:ring-brand-500
  disabled:cursor-not-allowed
  disabled:opacity-50
"
```

Do not create a CSS class merely to avoid writing a reasonable Tailwind utility list.

---

# 31. Avoid Arbitrary Tailwind Values

Avoid arbitrary values when standard utilities or design tokens are sufficient.

Avoid unnecessary patterns such as:

```text
w-[437px]
mt-[13px]
text-[17px]
bg-[#123456]
```

Use arbitrary values only when they represent a genuine product/design requirement.

If the same arbitrary value appears repeatedly, create a design token instead.

---

# 32. Inline Styles

Do not use React inline styles for ordinary styling.

Avoid:

```tsx
style={{
  padding: "12px",
  color: "#333",
  backgroundColor: "white",
}}
```

Prefer Tailwind utilities.

Inline styles may be appropriate for genuinely dynamic runtime values that cannot reasonably be represented through Tailwind.

---

# 33. Custom CSS

Custom CSS is allowed when Tailwind is not the appropriate tool.

Appropriate cases include:

- complex pseudo-elements
- specialized animations
- third-party component overrides
- browser-specific behavior
- specialized code editor styling
- complex selectors
- CSS features that would be less readable as utilities

Do not create custom CSS merely to avoid using Tailwind.

Keep custom CSS limited and intentional.

Do not use CSS Modules for ordinary application styling unless there is a genuine architectural reason.

---

# 34. `@apply`

Use `@apply` sparingly.

Do not use `@apply` to recreate a traditional CSS framework.

Prefer:

- reusable React components
- Tailwind utilities
- component variants

Use `@apply` only where it materially improves maintainability.

---

# 35. Reusable UI Components

When a visual/behavioral pattern is repeated, consider a reusable component.

Potential components include:

```text
Button
Badge
Card
Panel
Input
Select
Dialog
Tabs
CodeBlock
StatusBadge
EmptyState
ErrorState
LoadingState
```

Do not build a complete design system prematurely.

Create abstractions when they provide meaningful reuse, accessibility, consistency, or behavior.

Do not abstract two components merely because they share a few classes.

---

# 36. Responsive Design

New UI should be responsive unless explicitly designed for a fixed environment.

Use mobile-first Tailwind responsive variants.

Prioritize:

1. readability
2. information preservation
3. sensible stacking
4. appropriate horizontal overflow

Do not hide important API/test information merely to make mobile layouts visually simpler.

Large JSON/YAML/code blocks should support horizontal scrolling without causing the entire page to overflow.

---

# 37. Dark Mode

Design new UI so dark mode can be supported consistently.

Consider:

- backgrounds
- surfaces
- borders
- text contrast
- disabled states
- code blocks
- API payloads
- success/error/warning states

Use Tailwind dark-mode variants where appropriate.

Do not implement independent theme systems inside individual components.

Theme behavior should remain centralized.

---

# 38. Accessibility

Accessibility is mandatory.

Interactive elements must provide:

- semantic HTML
- accessible names
- keyboard accessibility
- visible focus states
- sufficient color contrast
- meaningful disabled states

Prefer:

```tsx
<button>
```

over:

```tsx
<div onClick={...}>
```

Do not remove focus indicators merely for visual reasons.

Do not communicate important state through color alone.

For example, an API validation error must include text or another accessible indicator in addition to red styling.

---

# 39. Loading, Empty, and Error States

Data-driven UI must distinguish between:

```text
loading
success
empty
error
```

Do not represent API failures as empty results.

Use consistent UI patterns for:

- loading indicators/skeletons
- empty states
- error messages
- recovery actions

Users should understand what the application is doing and why content is unavailable.

---

# 40. API/Test Engineering UI

ApiPilot displays technical information including:

- HTTP methods
- API paths
- parameters
- request bodies
- response schemas
- generated scenarios
- assertions
- provenance
- analysis issues

These should be highly scannable.

Use consistent visual semantics for HTTP methods and statuses.

Use monospace typography selectively for:

- API paths
- JSON
- YAML
- request payloads
- response payloads
- generated test data
- code

Do not use monospace typography for the entire application.

---

# 41. Tables

Use semantic tables for structured API/test information.

Tables should have:

- clear headers
- consistent alignment
- readable spacing
- accessible structure
- horizontal scrolling where appropriate

Do not replace complex data tables with cards solely for aesthetic reasons.

Responsive behavior must preserve access to important information.

---

# 42. Animation

Use animation sparingly.

Animations should communicate:

- loading
- state transitions
- expansion/collapse
- navigation
- user feedback

Avoid decorative animation.

Prefer subtle, short transitions.

Respect reduced-motion preferences.

Do not make functionality dependent on animation.

---

# 43. Styling and Business Logic

Styling should remain separate from business logic.

Avoid embedding application/business decisions directly into large class-name expressions.

Prefer typed visual variants.

For example:

```tsx
const variant = getScenarioStatusVariant(status);

<StatusBadge variant={variant} />;
```

rather than mixing business rules directly into `className`.

---

# 44. TypeScript Standards

Use TypeScript's type system to express domain invariants.

Prefer:

- explicit domain types
- discriminated unions
- narrow types
- readonly structures where appropriate
- typed errors
- type-safe boundaries

Avoid `any` unless there is a compelling technical reason.

When `any` is unavoidable, isolate it at the external boundary and convert it to a safe internal type.

Do not use type assertions merely to silence errors.

Fix the underlying type design where practical.

---

# 45. Immutability and Side Effects

Keep domain logic as pure as practical.

Prefer:

```text
input → result
```

over hidden mutation.

Avoid unexpectedly modifying:

- parsed OpenAPI documents
- `ApiModel`
- `TestModel`
- scenarios
- shared-domain objects

If mutation is required, keep it explicit and localized.

---

# 46. Security

API specifications may contain sensitive information.

Treat uploaded specifications as potentially sensitive.

Never:

- log complete specifications unnecessarily
- log authorization headers
- log API keys
- expose secrets
- expose environment variables
- send specifications to external AI providers without explicit authorization
- execute content from uploaded specifications
- automatically fetch arbitrary external `$ref` URLs

Respect the existing local/non-persistent processing model unless a future specification explicitly changes it.

---

# 47. File Upload Safety

Preserve the existing OpenAPI upload size limit.

Do not increase limits casually.

Validate:

- file size
- accepted input types
- document content
- parsing validity

Do not trust filenames alone to determine document validity.

---

# 48. Environment Configuration

Configuration should be explicit and environment-driven.

Existing configuration includes concepts such as:

```text
BACKEND_PORT
FRONTEND_DEV_PORT
AI_PROVIDER_MODE
AI_MODEL_ID
AI_MODEL_CACHE_DIR
AI_INFERENCE_TIMEOUT_MS
AI_USE_ACCELERATOR
```

Do not hard-code environment-specific values.

When adding a required environment variable:

1. Update `.env.example`.
2. Document the variable.
3. Provide safe defaults where appropriate.
4. Validate configuration at startup when necessary.

Never commit secrets.

---

# 49. Logging

Logs should help diagnose problems without exposing sensitive data.

Do not log:

- secrets
- API keys
- bearer tokens
- complete API specifications
- sensitive prompts
- sensitive AI responses

Prefer contextual information such as:

```text
operation
error category
duration
provider state
correlation information
```

where supported by the architecture.

---

# 50. Dependency Management

Use npm and the existing workspace architecture.

Do not introduce another package manager.

When adding dependencies:

1. Add them to the correct workspace.
2. Update the lockfile through npm.
3. Avoid duplicate libraries.
4. Consider maintenance and security.
5. Consider local/offline behavior.

Do not manually edit `package-lock.json` when npm can generate the correct change.

---

# 51. Testing Philosophy

Tests are part of the feature, not an afterthought.

Use the appropriate test layer.

## Unit Tests

Use for:

- pure functions
- OpenAPI processing
- scenario rules
- value generation
- domain transformations
- state machines

## Backend Integration Tests

Use for:

- Express routes
- HTTP contracts
- error mapping
- request/response behavior

Use Supertest where appropriate.

## Frontend Tests

Use React Testing Library for:

- rendering
- interaction
- UI states
- API-driven behavior

## AI Tests

Default AI tests to the mock provider.

Real-model tests must remain opt-in.

---

# 52. Test Quality

Do not write tests merely to increase coverage.

Tests should verify:

- contractual behavior
- business/domain behavior
- important boundaries
- failure modes
- invariants
- regressions

Avoid brittle tests based on:

- implementation details
- incidental ordering
- internal function calls
- arbitrary timing
- CSS class names when semantic queries are possible

---

# 53. Deterministic Testing

Tests must produce reproducible results.

Avoid uncontrolled:

```text
Math.random()
new Date()
network calls
external APIs
real model downloads
machine-specific paths
```

unless the test explicitly validates that behavior.

Inject time/randomness where necessary.

Use the mock AI provider for AI-dependent tests.

---

# 54. Build and Validation

Before considering a change complete, run the smallest relevant checks and, when practical, the repository-wide checks.

Standard validation:

```bash
npm test
npm run lint
npm run build
```

For AI-specific changes, also consider:

```bash
npm run ai:benchmark -w backend
```

Only run real-model tests when explicitly required:

```bash
npm run test:ai-real -w backend
```

Never claim a command passed unless it was actually executed.

If validation cannot be run, state that clearly.

---

# 55. Build and Lint Discipline

Do not leave behind:

- TypeScript errors
- ESLint errors
- unused imports
- dead code
- unnecessary `any`
- broken workspace references

Do not weaken compiler or lint configuration merely to make new code pass.

Avoid `eslint-disable` unless justified and localized.

Do not disable tests to hide failures.

---

# 56. Backward Compatibility

Preserve existing behavior unless the specification explicitly changes it.

Before changing behavior, identify:

- API consumers
- frontend assumptions
- shared-domain consumers
- tests
- contracts
- specifications

Prefer additive changes.

If a breaking change is necessary, update the affected layers coherently:

```text
Specification
    ↓
Contract
    ↓
Shared Domain
    ↓
Backend
    ↓
Frontend
    ↓
Tests
    ↓
Documentation
```

---

# 57. Documentation

Update documentation when behavior or architecture changes.

Documentation should explain:

- what changed
- why it changed
- configuration
- usage
- important constraints

Avoid documenting trivial implementation details that are likely to become stale.

Keep README content focused on product/developer onboarding.

Use specifications and architecture documentation for detailed engineering decisions.

---

# 58. Git and Change Discipline

Keep changes focused.

Do not mix unrelated:

- refactoring
- formatting
- dependency upgrades
- renaming
- configuration changes

into a feature unless required.

Avoid mass-formatting unrelated files.

A pull request should be understandable from its diff.

---

# 59. Working With Existing Code

Before creating new code:

1. Search for existing implementations.
2. Search for similar tests.
3. Search shared-domain types.
4. Search specifications.
5. Search existing utilities.
6. Follow established patterns where appropriate.

Do not duplicate functionality because an existing implementation was overlooked.

Prefer extending an existing abstraction over creating a parallel abstraction.

---

# 60. Avoid Premature Abstraction

Do not introduce abstractions for hypothetical future requirements.

Before creating a:

- factory
- strategy
- registry
- plugin system
- framework
- additional abstraction layer

confirm that the current requirement benefits from it.

However, preserve intentional existing abstractions such as:

- `AIProvider`
- shared domain contracts
- rule modules
- provider factories

Do not collapse intentional architecture merely to reduce line count.

---

# 61. AI-Generated Code Review

Treat generated code as untrusted until validated.

For every AI-generated change, verify:

- correctness
- type safety
- tests
- determinism
- security
- architecture
- specification compliance
- error handling
- performance

Do not accept generated code merely because it compiles.

Compilation is not sufficient validation.

---

# 62. Feature Implementation Workflow

For normal feature work:

### Step 1 — Understand

Read:

- specification
- plan
- tasks
- affected source files
- existing tests

### Step 2 — Identify Boundaries

Determine:

- backend changes
- frontend changes
- shared-domain changes
- API contract changes
- AI changes
- test changes

### Step 3 — Implement Domain Behavior

Prefer domain/pure behavior before HTTP/UI wiring.

### Step 4 — Update Contracts

Update shared types and API contracts where necessary.

### Step 5 — Implement Backend

Keep routes thin.

### Step 6 — Implement Frontend

Use service modules and reusable components.

Use Tailwind CSS for styling.

### Step 7 — Add Tests

Test the changed behavior at the appropriate layers.

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
- architecture violations
- missing tests
- accessibility problems
- responsive UI problems
- documentation gaps

---

# 63. Handling Ambiguous Requirements

Do not guess about important product behavior.

If ambiguity affects:

- API contracts
- security
- persistence
- AI behavior
- test semantics
- generated assertions
- expected status codes
- architecture
- domain models

consult the relevant specification or ask for clarification.

For minor implementation details, follow existing repository conventions.

Never invent business rules.

---

# 64. Missing Specifications

If a substantial feature has no specification, do not immediately implement a large solution.

Determine whether the feature should go through the Spec Kit workflow.

For non-trivial changes, establish:

- problem statement
- user story
- functional requirements
- acceptance criteria
- constraints
- edge cases
- technical approach
- testing strategy

Then implement against the agreed specification.

---

# 65. What Copilot Must Not Do

Never:

- introduce cloud AI silently
- send API specifications to external services without explicit authorization
- introduce uncontrolled randomness into deterministic test generation
- fabricate expected API responses
- fabricate expected status codes
- automatically fetch arbitrary external `$ref`s
- put domain logic into route handlers
- duplicate shared domain models
- make real AI model downloads part of ordinary tests
- bypass specifications for substantial changes
- weaken TypeScript/lint configuration
- disable tests to hide failures
- swallow errors
- expose stack traces
- expose secrets
- commit downloaded model artifacts unless required
- introduce unnecessary dependencies
- introduce another CSS/UI framework
- create unnecessary custom CSS instead of using Tailwind
- mix Tailwind v3 configuration patterns into Tailwind v4
- introduce unrelated refactoring
- claim validation passed without running it

---

# 66. Definition of Done

A feature is complete only when:

- [ ] Implementation matches the relevant specification.
- [ ] Architecture and module boundaries are preserved.
- [ ] Shared contracts are updated where necessary.
- [ ] API contracts are preserved or intentionally changed.
- [ ] Determinism is preserved.
- [ ] Security implications are considered.
- [ ] Appropriate tests are added/updated.
- [ ] Existing tests pass.
- [ ] TypeScript passes.
- [ ] Lint passes.
- [ ] Build passes.
- [ ] Frontend styling follows the project's Tailwind conventions when frontend styling is
      changed or introduced.
- [ ] Responsive behavior is considered.
- [ ] Accessibility is considered.
- [ ] Dark-mode implications are considered.
- [ ] No unnecessary custom CSS is introduced.
- [ ] No unnecessary dependencies are introduced.
- [ ] Documentation/specifications are updated where necessary.
- [ ] No unrelated files are changed.
- [ ] No secrets or sensitive information are introduced.
- [ ] AI behavior remains explicit and locally controlled.
- [ ] No silent cloud AI fallback is introduced.
- [ ] The final diff is minimal and reviewable.

---

# 67. Copilot Response Expectations

When asked to modify ApiPilot:

1. Understand the requested change.
2. Identify relevant specifications and modules.
3. Inspect existing implementations before creating new ones.
4. State important assumptions when necessary.
5. Implement the smallest coherent change.
6. Add/update tests.
7. Run appropriate validation.
8. Report exactly what changed.
9. Report validation results honestly.
10. Mention remaining limitations or follow-up work when relevant.

Do not provide lengthy generic explanations when implementation is requested.

Prefer precise engineering terminology.

When explaining changes, focus on architectural reasoning, constraints, and behavior rather than describing every line.

---

# 68. Instruction Priority

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

# 69. ApiPilot North Star

Every change should move ApiPilot toward:

> **Turning API specifications into trustworthy, explainable, reproducible API test engineering assets.**

Trustworthiness requires:

- deterministic generation
- specification-grounded assertions
- explicit provenance
- secure specification handling
- reproducible AI infrastructure
- strong contracts
- comprehensive tests
- transparent failure behavior
- consistent and accessible UI
- maintainable engineering practices
