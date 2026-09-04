<!--
Sync Impact Report
==================
Version change: 2.1.0 → 2.1.1 (patch: traceability note, no principle changes)

Trigger: implementation of `011-ai-prompt-batching`, a hardening spec that lets AI-assisted
dependency detection (AP-008) and scenario enhancement (AP-005) run against large
specifications via deterministic request batching instead of being silently skipped.

Added principles: none.
Modified principles: none — the plan's Constitution Check confirmed the design satisfies
  existing principles (II. Deterministic Before AI, VI. AI Provider Independence,
  IX. Separation of Concerns, XVI. Executable Artifacts Must Be Deterministic,
  XXI. Testability at Every Boundary, XXIV. Reproducibility) without requiring an amendment.
Removed principles: none.
Removed sections: none.
Deferred TODOs: none.

------------------------------------------------------------------------------------------------

Sync Impact Report (previous amendment)
==================
Version change: 2.0.0 → 2.1.0 (minor: new principles added)

Trigger: a real end-to-end usability test of the shipped AP-009 guided workflow, run against a
real production OpenAPI specification (51 operations, 371 generated scenarios, 8 detected
dependency workflows), surfaced two gaps this constitution had no principle covering: review
screens with no bulk decision actions (impractical at real API sizes), and a fully-wired UI
shipped with no consistent presentation applied (raw unstyled markup).

Added principles:
  - XXXII. Human Review Must Remain Practical at Real Scale (extends XI)
  - XXXIII. Presentation Must Be Consistent, Coherent, and Usable (tightens XXXI)

Modified principles (expanded, not redefined):
  - XXXI. Definition of Done — now explicitly cross-references XXXII and XXXIII for features
    that include a review interface or user-facing UI.

Removed principles: none.
Removed sections: none.
Deferred TODOs: none.

------------------------------------------------------------------------------------------------

Sync Impact Report (previous amendment)
==================
Version change: 1.0.0 → 2.0.0 (major governance restructuring)

Modified principles (renamed / redefined / expanded):
  - I. Specification-First Engineering → I. Specification Is the Source of Truth (expanded scope)
  - II. Deterministic Before AI → II. Deterministic Before AI (retained, expanded with explicit list)
  - III. Structured AI Output → split into III. AI Is an Assistant, Not the Authority and
    IV. AI Output Must Be Structured and Validated
  - IV. Framework-Independent Test Model → VIII. Framework-Independent Test Model (absorbs former
    XII. Postman Is an Output, Not the Domain)
  - V. Human-in-the-Loop → XI. Human-in-the-Loop (retained)
  - VI. Explainability and Traceability → XIII. Test Provenance and Traceability (renamed)
  - VII. No Silent Assumptions → XIV. No Silent Assumptions (retained)
  - VIII. Security and Sensitive API Specifications → XVII. Security and Privacy by Design
    (expanded; secrets handling split into XVIII, logging split into XX)
  - IX. Testability → XXI. Testability at Every Boundary (retained)
  - X. Incremental Delivery → XXV. Incremental Delivery (retained)
  - XI. Separation of Concerns → IX. Separation of Concerns (retained)
  - XIII. Quality Over Test Quantity → XII. Quality Over Quantity (retained)

Removed as standalone principles (content redistributed, not lost):
  - XII. Postman Is an Output, Not the Domain (merged into VIII)
  - XIV. Compatibility and Maintainability (redistributed into XXVII and XXVIII)

Added principles:
  - V. Local-First AI
  - VI. AI Provider Independence
  - VII. Model Selection Is an Engineering Decision
  - X. Domain Model First
  - XV. API Dependency Inference Must Be Conservative
  - XVI. Executable Artifacts Must Be Deterministic
  - XVIII. Secrets Must Never Be Part of Generated Artifacts
  - XIX. Fail Safely
  - XX. Observability Without Sensitive Logging
  - XXII. AI Evaluation Is Part of Engineering
  - XXIII. Version AI Contracts
  - XXIV. Reproducibility
  - XXVI. Specification Traceability
  - XXVII. Prefer Simple Architecture
  - XXVIII. Technology Is Replaceable, Domain Concepts Are Not
  - XXIX. Local-First Does Not Mean Local-Only Forever
  - XXX. Explicit Trade-offs

Retained unchanged in substance:
  - XXXI. Definition of Done (formerly XV)

Added sections: none beyond Core Principles (Governance expanded with explicit enforcement
lifecycle and conflict-resolution procedure).
Removed sections: none.
Deferred TODOs: none.

Note: specs/constitution.md is a separate, manually maintained copy outside the Spec Kit
governance path (.specify/memory/constitution.md is authoritative). It was not modified by
this update; consider syncing or removing it to avoid drift.
-->

# ApiPilot Constitution

ApiPilot transforms OpenAPI/YAML specifications into intelligent, reviewable, and executable
API test suites using deterministic API analysis and local-first AI inference. It is built
primarily for QA engineers who test REST APIs, microservices, and service-to-service
integrations, and it progressively automates the workflow from understanding an API
specification through executing tests and analyzing failures.

ApiPilot MUST distinguish, at all times and without silently mixing them, between:
1. Information explicitly defined by the API specification.
2. Test cases deterministically derived from the specification.
3. Test cases inferred by AI.
4. User-provided assumptions or configuration.
5. Runtime observations from executed tests.

The initial executable artifact is a Postman collection, but the architecture MUST NOT be
designed exclusively around Postman, one AI provider, one inference runtime, or one UI
framework. Technology-specific decisions belong in feature plans unless they represent a
fundamental architectural constraint covered by a principle below.

## Core Principles

### I. Specification Is the Source of Truth

The API specification MUST be treated as the authoritative source for endpoints, HTTP
methods, parameters, request bodies, schemas, required fields, data types, enums,
constraints, response schemas, documented status codes, security definitions, and examples.
ApiPilot MUST NOT fabricate endpoints, HTTP methods, request or response fields, status
codes, or authentication mechanisms that are not supported by the specification or explicit
user configuration. When the specification is incomplete or ambiguous, ApiPilot MUST expose
the uncertainty rather than silently assuming a value.

**Rationale**: Generated tests are only trustworthy if they reflect the real contract; any
invented contract detail undermines the credibility of the entire platform.

### II. Deterministic Before AI

Deterministic software MUST be used whenever the required result can be reliably derived
from the specification, including: YAML parsing, OpenAPI validation, `$ref` resolution, API
discovery, parameter/schema/response extraction, status-code extraction, required-field and
type/enum detection, boundary calculation, schema-based test generation and assertions,
TestModel validation, and Postman collection generation. AI SHOULD be reserved for semantic
reasoning such as negative testing candidates, business-rule candidates, meaningful edge
cases, API relationship inference, workflow suggestions, coverage recommendations, failure
analysis, and natural-language explanations. Deterministic evidence MUST always be preferred
over probabilistic inference.

**Rationale**: Deterministic logic is reproducible, debuggable, and cheap; AI is reserved for
judgment calls that genuinely require it.

### III. AI Is an Assistant, Not the Authority

AI-generated information MUST be treated as inference, never as authoritative contract
information. ApiPilot MUST distinguish AI-generated information from specification-derived
information at all times. Every AI-generated artifact that affects test design MUST, where
applicable, expose source, confidence, rationale, and assumptions. An AI inference MUST NOT
be silently promoted into a specification fact (e.g., a specification-required field and an
AI-suggested business-rule scenario MUST remain distinguishable).

**Rationale**: Conflating inference with fact would let unverified guesses masquerade as
contract truth.

### IV. AI Output Must Be Structured and Validated

Raw AI output MUST NOT directly become an executable test artifact. AI interaction MUST
flow through: AI request → AI response → schema validation → domain validation →
deduplication → TestModel → artifact generation. Invalid AI responses MUST be rejected or
safely repaired. Syntactically valid JSON is not sufficient; semantic validation against the
domain (e.g., rejecting a response that references a non-existent API field) is also
REQUIRED.

**Rationale**: Structured, validated contracts between AI and application code prevent
malformed or unsafe output from corrupting generated test artifacts.

### V. Local-First AI

ApiPilot MUST prioritize local AI inference for the initial product so that sensitive API
specifications can remain on the user's machine (User → local ApiPilot → local AI inference
→ TestModel). The initial local inference implementation MAY use Hugging Face
Transformers.js, but the constitution MUST NOT permanently couple ApiPilot to
Transformers.js or any specific model. The AI architecture MUST support local inference,
future alternative local runtimes, optional cloud providers, configurable models, and
offline operation. When local-only mode is enabled, the system MUST NOT silently send API
specifications or inference inputs to external services.

**Rationale**: Local-first inference gives users a meaningful, verifiable privacy boundary
for confidential API specifications.

### VI. AI Provider Independence

All AI-powered features MUST communicate through an AI provider abstraction rather than a
concrete inference implementation. The domain layer MUST NOT directly depend on
Transformers.js, a specific model, OpenAI, Ollama, ONNX Runtime, WebGPU, or any other
specific inference technology; such details belong behind the provider boundary.

**Rationale**: This allows ApiPilot to evolve its model strategy without rewriting domain
logic.

### VII. Model Selection Is an Engineering Decision

The largest or newest model MUST NOT be assumed to be the best choice. Candidate models MUST
be evaluated against representative API testing tasks, considering correctness, structured-
output reliability, schema adherence, scenario quality, hallucination rate, reasoning
quality, latency, memory/CPU/GPU consumption, model size, startup time, licensing, and
offline suitability. Model decisions MUST be evidence-driven rather than based solely on
general-purpose benchmarks.

**Rationale**: Generic benchmarks do not predict task-specific reliability for structured API
test generation.

### VIII. Framework-Independent Test Model

ApiPilot's core domain MUST contain a framework-independent representation of test intent
(OpenAPI → ApiModel → TestModel → Artifact Generator). The TestModel MUST NOT contain
Postman-specific implementation details. The same TestModel MUST be able to eventually
support Postman, Playwright, Serenity/JS, Newman, and future test frameworks; Postman is an
output target, not the core domain.

**Rationale**: Decoupling test intent from any single output format protects long-term
extensibility and avoids vendor lock-in.

### IX. Separation of Concerns

The architecture MUST clearly separate specification processing, ApiModel construction,
deterministic test design, AI test design, TestModel assembly, dependency/workflow analysis,
artifact generation, execution, and failure analysis. Each stage MUST have a clearly defined
responsibility, and changes in one stage MUST NOT unnecessarily propagate into unrelated
stages. External tools and frameworks MUST remain behind appropriate boundaries.

**Rationale**: Clear boundaries prevent changes in one concern (e.g., swapping the AI
provider) from rippling through unrelated parts of the system.

### X. Domain Model First

ApiPilot MUST define stable domain models for concepts including API, parameter, schema,
request, response, test scenario, assertion, test suite, API dependency, workflow, workflow
variable, AI inference, provenance, and confidence. These models MUST represent business
intent rather than external tool formats; external representations MUST be converted into
and out of the domain model at its boundaries.

**Rationale**: A stable domain vocabulary keeps the system coherent as external tool formats
change around it.

### XI. Human-in-the-Loop

ApiPilot MUST augment QA engineers rather than remove human ownership of quality decisions.
AI-generated scenarios MUST be reviewable, and where appropriate users MUST be able to
accept, reject, edit, regenerate, prioritize, or disable them. The system MUST clearly
distinguish specification-backed, rule-generated, AI-generated, and user-defined content. The
user remains responsible for deciding whether inferred scenarios are appropriate.

**Rationale**: QA engineers remain accountable for release quality; AI must augment their
judgment, not replace their authority over what ships.

### XII. Quality Over Quantity

ApiPilot MUST optimize for useful test coverage rather than the number of generated tests.
The system MUST avoid duplicate scenarios, trivial scenarios, semantically meaningless
tests, redundant boundary tests, repeated AI-generated variants, and tests with no
meaningful expected outcome. Every generated test MUST have a clear purpose.

**Rationale**: Large volumes of low-value tests increase maintenance burden and erode
confidence in the test suite without improving real coverage.

### XIII. Test Provenance and Traceability

Every test scenario MUST be traceable to its origin using provenance values such as
SPECIFICATION, RULE, AI, USER, WORKFLOW, or RUNTIME. Where practical, ApiPilot SHOULD
maintain a trace from test scenario → reason → source → underlying API/schema/rule/AI
inference, supporting future specification-change impact analysis.

**Rationale**: Traceable origins let engineers quickly assess trust level and debug
unexpected or low-value test scenarios.

### XIV. No Silent Assumptions

ApiPilot MUST NOT silently make material assumptions. When information is missing, the
system MUST, in order of preference: use deterministic evidence if available; ask the user
when necessary; mark an inference explicitly; and expose uncertainty. An AI-inferred value
(with confidence) MUST never be presented as if it were part of the API contract.

**Rationale**: Hidden assumptions produce tests that silently diverge from real API
behavior, eroding trust in generated artifacts.

### XV. API Dependency Inference Must Be Conservative

Dependency detection between APIs MUST distinguish confirmed, likely, and possible
relationships. Only sufficiently confident relationships MAY automatically become executable
workflows. The system MUST NOT create workflows solely because two fields have similar
names; dependency inference SHOULD use multiple signals where available, including field
names, types, schema descriptions, endpoint semantics, request/response relationships, API
tags, examples, and AI semantic similarity.

**Rationale**: Overconfident dependency inference can generate dangerous or incorrect
workflows that QA engineers may not catch before execution.

### XVI. Executable Artifacts Must Be Deterministic

Once a TestModel has been approved, artifact generation MUST be deterministic (e.g.,
Approved TestModel → Postman Generator → collection.json). Generators MUST NOT invoke AI to
convert an approved test scenario into an artifact. The same TestModel MUST produce
equivalent artifacts across repeated generation. This principle applies to all current and
future generators.

**Rationale**: Deterministic generation is what makes an approved TestModel a reliable,
reviewable contract rather than a moving target.

### XVII. Security and Privacy by Design

API specifications may contain confidential enterprise information and MUST be treated as
potentially sensitive. The system MUST avoid unnecessary persistence, avoid logging
sensitive API specifications or credentials, keep provider credentials server-side, validate
uploaded files, enforce reasonable file-size limits, prevent path traversal, avoid arbitrary
code execution, avoid executing uploaded specifications or generated scripts on the server,
and clearly indicate when data leaves the local machine. Local-only mode MUST provide a
meaningful privacy boundary.

**Rationale**: API specifications frequently describe proprietary or sensitive systems and
must be protected with the same rigor as any confidential customer data.

### XVIII. Secrets Must Never Be Part of Generated Artifacts

Generated collections MUST NOT contain real secrets unless explicitly supplied by the user
for that purpose. Variables and placeholders (e.g., `{{baseUrl}}`, `{{token}}`, `{{apiKey}}`,
`{{userId}}`) MUST be preferred, and credentials MUST be stored using appropriate
environment/configuration mechanisms rather than embedded directly in source code or
generated artifacts.

**Rationale**: Secrets embedded in shareable artifacts are a direct path to credential
leakage.

### XIX. Fail Safely

When ApiPilot cannot confidently generate a test, it MUST fail safely rather than fabricate
one — for cases such as an unknown schema, missing response definition, unresolved
reference, invalid AI response, ambiguous dependency, unavailable local model, or
insufficient information. The system MUST surface the limitation and MUST NOT hide
uncertainty to make generation appear successful.

**Rationale**: A visible failure is recoverable; a silently fabricated result is not.

### XX. Observability Without Sensitive Logging

ApiPilot MUST provide sufficient diagnostics to understand failures without becoming a
data-exfiltration mechanism. Logs SHOULD prefer request ID, operation ID, processing stage,
duration, model identifier, error category, and validation result over raw YAML, raw
credentials, raw request bodies, raw AI prompts, or raw AI responses. Sensitive payload
logging MUST be disabled by default.

**Rationale**: Diagnostics must not become a second, less-guarded channel for the same
sensitive data the platform is otherwise protecting.

### XXI. Testability at Every Boundary

Every major transformation MUST be independently testable, at minimum covering: YAML →
OpenAPI parser → ApiModel → Rules → TestModel → AI provider → validated AI output → final
TestModel → artifact generator. AI-dependent tests MUST support deterministic mock
providers; the core test suite MUST NOT require a large local model to execute every test.
Model evaluation tests MUST be isolated from normal unit tests.

**Rationale**: A pipeline this complex can only be trusted if each transformation stage can
be verified in isolation and in CI without heavyweight model dependencies.

### XXII. AI Evaluation Is Part of Engineering

AI functionality MUST NOT be considered correct merely because the model returns valid JSON,
the application does not crash, or the output looks plausible. AI functionality MUST be
evaluated using representative API specifications, measuring scenario correctness, schema
compliance, hallucination, duplication, relevance, coverage, confidence calibration,
latency, and resource usage. AI model changes MUST be evaluated against a known test corpus
before being adopted.

**Rationale**: Plausibility is not correctness; AI features need the same evidence-based
scrutiny as any other engineering change.

### XXIII. Version AI Contracts

Prompt templates, structured output schemas, and AI evaluation datasets MUST be treated as
versioned engineering assets. Changes to prompt templates, model, model configuration,
output schema, or inference parameters may change system behavior and MUST be testable.
Hidden prompt changes that materially alter generated tests without traceability MUST be
avoided.

**Rationale**: Untracked prompt or schema drift is indistinguishable from a silent behavior
regression.

### XXIV. Reproducibility

ApiPilot SHOULD strive for reproducible behavior wherever technically possible. Deterministic
processing MUST produce the same output for the same input. AI processing reproducibility
SHOULD be maximized through versioned prompts, versioned schemas, recorded model identity,
controlled inference parameters, deterministic settings where supported, and evaluation
fixtures. AI outputs MUST be treated as potentially variable.

**Rationale**: Reproducibility is what makes regressions detectable and fixes verifiable.

### XXV. Incremental Delivery

ApiPilot MUST be built in independently valuable increments, progressing approximately
through: Application Foundation → OpenAPI Understanding → Deterministic Test Design → Local
AI Infrastructure → AI Test Design → Human Review → Postman Generation → API Workflows →
Execution → Failure Analysis. The entire product MUST NOT be implemented as one feature.
Each specification MUST have a clear boundary and independently testable acceptance
criteria.

**Rationale**: Incremental delivery reduces risk, shortens feedback loops, and keeps the
system demonstrable at every stage.

### XXVI. Specification Traceability

Every implementation MUST be traceable through: Constitution → Feature Specification →
Clarifications → Technical Plan → Tasks → Implementation → Tests → Convergence.
Implementation decisions MUST NOT silently contradict the constitution or feature
specification. When requirements change, the appropriate specification MUST be updated
rather than introducing undocumented behavior in code.

**Rationale**: Traceability across the Spec Kit lifecycle is what keeps specifications and
code from silently diverging over time.

### XXVII. Prefer Simple Architecture

Infrastructure MUST NOT be introduced solely because it may be useful in the future. Simple
local execution, minimal dependencies, clear module boundaries, standard protocols, mature
libraries, and explicit interfaces MUST be preferred. Distributed inference, microservice
deployment, vector databases, agent frameworks, multi-agent systems, complex orchestration,
and autonomous execution MUST NOT be introduced unless a later specification establishes a
concrete need.

**Rationale**: Premature infrastructure adds cost and risk without a corresponding, proven
requirement.

### XXVIII. Technology Is Replaceable, Domain Concepts Are Not

Technology choices such as a specific UI framework, web framework, inference runtime,
Postman SDK, LLM, or database MUST remain replaceable unless explicitly justified. Core
domain abstractions — ApiModel, TestModel, TestScenario, Assertion, ApiDependency, Workflow,
AIProvider, and Provenance — MUST remain stable and MUST be preferred over reinventing
standards implementations (e.g., OpenAPI and Postman collection schemas) with custom code.

**Rationale**: Stable domain abstractions let the platform absorb technology churn without
architectural rewrites.

### XXIX. Local-First Does Not Mean Local-Only Forever

The MVP MUST prioritize local AI inference, but the architecture MUST permit users or
organizations to configure alternative providers (e.g., LOCAL, CLOUD, HYBRID, OFFLINE modes)
when appropriate. The active mode MUST be explicit. ApiPilot MUST NOT silently switch from
local inference to cloud inference because a local model is unavailable.

**Rationale**: An explicit mode switch preserves the privacy guarantee that local-first is
meant to provide.

### XXX. Explicit Trade-offs

Architectural decisions involving meaningful trade-offs (e.g., model quality vs. resource
usage, local privacy vs. inference performance, test quantity vs. execution cost, AI
flexibility vs. deterministic behavior, convenience vs. security, abstraction vs.
complexity) MUST be documented. Decisions SHOULD be evidence-driven and revisitable.

**Rationale**: Undocumented trade-offs are frequently re-litigated or silently reversed
without anyone noticing the original reasoning.

### XXXI. Definition of Done

A feature is not complete merely because the code compiles or the UI appears functional. A
feature is complete only when its specification is satisfied, acceptance criteria pass,
appropriate automated tests exist, security requirements are satisfied, architectural
boundaries are respected, constitution principles are satisfied — including, where the feature
includes a human review interface or user-facing UI, the review-scalability requirements of
XXXII and the presentation-consistency requirements of XXXIII — documentation is updated where
necessary, known limitations are documented, and the implementation has been reviewed against
the specification and plan.

**Rationale**: A single, explicit bar for "done" prevents partially-finished work from being
treated as shippable.

### XXXII. Human Review Must Remain Practical at Real Scale

Any interface where a user reviews, accepts, rejects, approves, or otherwise decides on
deterministically-derived or AI-generated content (including but not limited to test scenarios,
API dependency relationships, and integration workflows) MUST remain practical to complete
against realistic API specifications, not only against small fixtures. Where the number of
reviewable items can reasonably exceed what a person can decide on individually, the interface
MUST provide efficient grouped or bulk decision actions (e.g., accept/reject/approve by filter,
category, operation, or selection) in addition to per-item review; a per-item-only interaction
pattern MUST NOT be treated as sufficient once realistic scale is known. A review gate MUST NOT
block progress in a way that is impractical to satisfy at real-world scale.

**Rationale**: A review step a QA engineer cannot realistically complete does not provide human
oversight — it replaces automation with an impractical bottleneck, defeating the purpose
Human-in-the-Loop (XI) is meant to serve.

### XXXIII. Presentation Must Be Consistent, Coherent, and Usable

ApiPilot MUST present specification-derived, deterministic, AI-generated, and user-provided
information through one internally consistent visual and interaction system, applied uniformly
across the product, rather than through ad hoc, inconsistent, or unstyled default markup. The
specific presentation technology remains replaceable (XXVIII) and is chosen in project
engineering conventions, not this constitution. A feature MUST NOT be considered done merely
because its markup is functionally wired and renders without error; it MUST also be visually
legible, consistent with the rest of the product's established presentation system, and
accessible.

**Rationale**: A feature that works but cannot be comfortably read or operated does not deliver
the trust and clarity the product exists to provide — "it renders" is not the same bar as "a QA
engineer can use it."

## Governance

This constitution supersedes all other engineering practices, coding conventions, and
informal team agreements for ApiPilot. Every specification, clarification, plan, task list,
implementation, code review, and convergence pass MUST be evaluated against these
principles.

**Conflict resolution**: When a future feature appears to conflict with this constitution,
the implementation MUST NOT silently bypass the principle. Instead: (1) identify the
conflict; (2) determine whether the feature is actually incompatible; (3) if the principle
must change, explicitly amend the constitution; (4) document the rationale; (5) update
affected specifications if necessary.

**Amendment procedure**: Amendments are proposed via a pull request that modifies
`.specify/memory/constitution.md` directly, including the rationale for the change and the
resulting version bump. Amendments MUST be reviewed and approved before merge, and MUST
update the Sync Impact Report at the top of this file.

**Versioning policy**: This constitution follows semantic versioning:
- **MAJOR**: Backward-incompatible governance changes, or removal/redefinition of an
  existing principle.
- **MINOR**: Addition of a new principle or materially expanded guidance.
- **PATCH**: Clarifications, wording, typo fixes, and other non-semantic refinements.

**Compliance review**: All feature specs, clarifications, plans, task lists,
implementations, and pull requests MUST verify compliance with these principles. Any
deviation (e.g., use of AI where deterministic logic is feasible, coupling the domain model
to Postman, coupling AI features to a specific provider or runtime, or silently switching
inference modes) MUST be explicitly justified in the relevant plan's complexity/deviation
tracking, or rejected. Complexity introduced by a design MUST be justified against these
principles.

**Version**: 2.1.1 | **Ratified**: 2026-08-26 | **Last Amended**: 2026-09-04
