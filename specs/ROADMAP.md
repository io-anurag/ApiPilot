# ApiPilot — Product Roadmap (Spec-of-Specs)

**Status**: Reference document. AP-001 through AP-010, plus the hardening specs
`011-ai-prompt-batching` and `012-ai-enhancement-progress`, have each been run through
`/speckit-specify` individually, in dependency order. See the Implementation Status table
below for where each one currently stands in the `clarify` → `plan` → `checklist` → `tasks` →
`analyze` → `implement` → `converge` lifecycle. AP-011 (Test Execution & Results) and AP-012
(AI Failure Analysis) — the two post-MVP features — have not been started.

## Implementation Status

| Feature | Status |
|---|---|
| AP-001 — Application Foundation | Implemented (1 minor follow-up task outstanding: a pre-flight `node_modules` dependency guard) |
| AP-002 — OpenAPI Specification Engine | Implemented |
| AP-003 — Deterministic Test Designer | Implemented |
| AP-004 — AI Provider & Local Inference Foundation | Implemented (1 follow-up task outstanding: full manual quickstart validation pass) |
| AP-005 — AI Test Scenario Designer | Implemented (3 follow-up tasks outstanding: broader semantic validation coverage, candidate-ID/low-confidence policy enforcement, all-or-nothing degradation coverage for partial/mixed-invalid provider responses — all marked partial in tasks.md) |
| AP-006 — Test Scenario Review | Implemented |
| AP-007 — Postman Collection Generator | Implemented (1 follow-up task outstanding: the manual Postman-import acceptance step, which needs a real, operator-authorized target this feature deliberately does not provide) |
| AP-008 — API Dependency & Integration Workflow Engine | Implemented |
| AP-009 — End-to-End Test Generation Workflow | Implemented |
| AP-010 — Presentation System & Review Scalability | Implemented |
| Hardening — Bounded AI Prompt Batching (`011-ai-prompt-batching`) | Implemented |
| Hardening — AI Enhancement Progress Visibility (`012-ai-enhancement-progress`) | Implemented (1 follow-up task outstanding: manual real-model UI validation from quickstart.md, optional) |
| AP-011 — Test Execution & Results *(post-MVP)* | Not started |
| AP-012 — AI Failure Analysis *(post-MVP)* | Not started |

Note the numbering collision between the MVP's `AP-011`/`AP-012` (post-MVP features, not
started) and the hardening specs' directory names (`011-ai-prompt-batching`,
`012-ai-enhancement-progress`, both otherwise unrelated to those two post-MVP features) — the
hardening specs are intentionally unnumbered in the Feature Decomposition below precisely to
avoid implying they are the same items as AP-011/AP-012.

Each spec's own `spec.md` still carries a template-default `**Status**: Draft` header — that
field is not maintained after `/speckit-specify` runs and should not be read as the feature's
real implementation status; this table is the accurate source for that.

## Product Vision

ApiPilot is an AI-powered API test engineering platform for QA engineers testing REST APIs, microservices, and service-to-service integrations.

It progressively automates:

```text
OpenAPI / YAML
      ↓
API analysis
      ↓
Test scenario identification
      ↓
Request construction
      ↓
Expected response identification
      ↓
Assertions
      ↓
API dependency identification
      ↓
Integration workflow generation
      ↓
Executable API test artifact
```

The initial executable artifact is a Postman collection.

The architecture must remain framework-independent so future outputs can include Playwright, Serenity/JS, Newman, or other API test frameworks.

---

## Core Architectural Model

```text
OpenAPI
   ↓
ApiModel
   ↓
TestModel
   ↓
Approved TestModel
   ↓
Artifact Generator
```

The `TestModel` is the core domain abstraction.

It must not depend on Postman or any other specific execution/artifact framework.

The same TestModel should be capable of supporting future targets such as:

```text
TestModel
 ├── Postman
 ├── Playwright
 ├── Serenity/JS
 ├── Newman
 └── Future test frameworks
```

---

## AI Philosophy

ApiPilot follows a **deterministic-before-AI** architecture.

### Deterministic processing

The following should be handled deterministically wherever possible:

- OpenAPI parsing
- OpenAPI validation
- `$ref` resolution
- API extraction
- HTTP method extraction
- parameter extraction
- request schema extraction
- response schema extraction
- status-code extraction
- security scheme extraction
- schema constraints
- required-field detection
- deterministic validation scenarios
- deterministic boundary scenarios
- deterministic assertions
- TestModel validation
- artifact generation

### AI capabilities

AI should be used where semantic reasoning adds meaningful value, including:

- semantic test scenario generation
- meaningful negative scenarios
- business-oriented edge cases
- semantic coverage recommendations
- API relationship inference
- integration workflow suggestions
- test explanations
- future failure analysis

AI output is an inference, never authoritative API contract information.

AI-generated output must be structured, schema-validated, semantically validated, and deduplicated before it becomes part of the TestModel.

AI-generated information must remain distinguishable from:

- specification-derived information
- deterministic rule-derived information
- user-defined information
- runtime observations

### Local-first AI

The initial MVP must provide a fully functional local AI inference path and must not require a cloud AI provider for core AI functionality.

The initial local inference implementation may use Hugging Face Transformers.js, but ApiPilot must not be permanently coupled to Transformers.js or a particular model.

AI inference must occur behind an `AIProvider` abstraction.

The system must never silently fall back from local inference to a cloud provider.

Model selection must be evidence-driven and evaluated using representative ApiPilot workloads.

---

# Feature Decomposition

## AP-001 — Application Foundation

### Objective

Establish the local web application foundation and engineering infrastructure for ApiPilot.

### Scope

- Web application foundation
- Frontend
- Backend/API layer
- TypeScript development environment
- project/module structure
- shared domain package structure
- automated testing infrastructure
- local development workflow
- configuration infrastructure
- basic error handling
- development documentation

The initial implementation may use React and Node.js, subject to validation during `/speckit.plan`.

### Constraints

- No AI functionality is required.
- No OpenAPI-specific business logic is required.
- Architecture should establish clean boundaries for subsequent specifications.

### Output

A working local ApiPilot application that can be developed, tested, and extended.

---

## AP-002 — OpenAPI Specification Engine

### Objective

Build the deterministic engine responsible for understanding OpenAPI specifications.

### Scope

- YAML file upload
- YAML parsing
- OpenAPI validation
- OpenAPI 3.x support
- `$ref` resolution
- API discovery
- HTTP method extraction
- parameter extraction
- request body extraction
- response extraction
- response status-code extraction
- schema extraction
- security scheme extraction
- examples where available
- normalized `ApiModel`
- API analysis summary

### Output

```text
OpenAPI → ApiModel
```

### Constraints

- No AI inference.
- API contract information must come from the specification.
- The engine must expose ambiguity or unsupported constructs rather than silently inventing information.

---

## AP-003 — Deterministic Test Designer

### Objective

Generate a baseline API test suite entirely from specification-derived information and deterministic QA rules.

### Scope

- positive scenarios
- required-field scenarios
- missing-field scenarios
- null-value scenarios
- empty-value scenarios
- invalid-type scenarios
- invalid-enum scenarios
- numeric boundary scenarios
- string boundary scenarios
- array boundary scenarios
- deterministic response assertions
- schema-based assertions
- deterministic test deduplication

### Output

```text
ApiModel → TestModel
```

### Constraints

- No LLM dependency.
- Generated scenarios must have deterministic provenance.
- Tests must be meaningful and avoid unnecessary duplication.

This baseline becomes the foundation that AI later enhances.

---

## AP-004 — AI Provider & Local Inference Foundation

### Objective

Establish the AI infrastructure required by ApiPilot without coupling the domain to a specific AI runtime, model, or vendor.

### Scope

- `AIProvider` abstraction
- local inference provider
- Hugging Face Transformers.js integration
- local model configuration
- local model path handling
- model loading and lifecycle
- model readiness/health checks
- model caching
- offline mode
- CPU inference
- optional accelerator capability detection
- inference configuration
- structured inference request/response infrastructure
- AI error handling
- mock AI provider for automated tests
- model evaluation/benchmarking harness
- model selection criteria

### Model selection

The initial model must be selected during the `/speckit.plan` phase using evidence from representative ApiPilot workloads.

Evaluation should consider:

- test-scenario quality
- correctness
- hallucination rate
- structured-output reliability
- latency
- memory consumption
- CPU performance
- accelerator performance where applicable
- model size
- startup time
- licensing
- offline suitability

### Constraints

- AP-004 must not implement API-specific test scenario generation.
- AP-004 must not contain API business rules.
- Higher-level features must not import Transformers.js directly.
- Local-only mode must not attempt remote model downloads.
- There must be no automatic fallback to a cloud provider.
- AI-dependent tests must be able to use a deterministic mock provider.

### Output

```text
AI-powered feature
       ↓
   AIProvider
       ↓
Local Transformers.js Provider
       ↓
Local Model
```

---

## AP-005 — AI Test Scenario Designer

### Objective

Enhance deterministic TestModel coverage with semantic test scenarios using the AI infrastructure established by AP-004.

### Input

```text
ApiModel
+
Deterministic TestModel
+
AIProvider
```

### Output

```text
Enhanced TestModel
```

### Scope

- semantic negative scenarios
- business-rule candidates
- meaningful edge cases
- semantic coverage gaps
- AI-generated scenarios
- confidence scoring
- rationale generation
- AI provenance
- deterministic/AI scenario deduplication
- AI output schema validation
- semantic contract validation
- scenario relevance validation

### Constraints

AI must enhance deterministic coverage rather than regenerate the entire test suite.

AI-generated scenarios must not invent:

- endpoints
- HTTP methods
- parameters
- request fields
- response fields
- status codes

unless explicitly identified as an inference and validated as such.

AI-generated scenarios that cannot be validated against the ApiModel must be rejected or clearly surfaced as non-executable suggestions.

---

## AP-006 — Test Scenario Review

### Objective

Provide a human-in-the-loop experience for reviewing generated API test scenarios before executable artifacts are produced.

### Scope

- scenario list
- scenario categorization
- provenance display
- confidence display
- rationale display
- accept
- reject
- edit
- regenerate
- search
- filtering
- review summary
- scenario comparison
- approval state

The UI should clearly distinguish:

```text
Specification-derived
Rule-derived
AI-derived
User-defined
```

### Constraints

AI-generated scenarios must be reviewable before they become approved executable artifacts.

Review requirements should be policy-driven so deterministic, specification-backed scenarios do not unnecessarily require manual approval.

---

## AP-007 — Postman Collection Generator

### Objective

Generate deterministic, executable Postman artifacts from the approved, framework-independent TestModel.

### Scope

- Postman collection
- folders
- HTTP requests
- headers
- query parameters
- path parameters
- request bodies
- authentication configuration
- environment variables
- test scripts
- assertions
- response extraction
- workflow variables
- collection validation
- environment generation
- README generation

### Output

```text
collection.json
environment.json
README.md
```

### Constraints

- Generation from an approved TestModel must be deterministic.
- The generator must never invoke AI.
- The generator must not become the core domain model.
- Generated artifacts must use variables/placeholders such as:
  - `{{baseUrl}}`
  - `{{token}}`
  - `{{userId}}`
- Real secrets must never be embedded by default.

---

## AP-008 — API Dependency & Integration Workflow Engine

### Objective

 Identify relationships between APIs and construct multi-step integration workflows independently of any specific artifact format.

### Scope

- response-field analysis
- parameter matching
- request/response relationship analysis
- dependency confidence
- API dependency graph
- workflow generation
- workflow ordering
- variable extraction
- workflow variables
- deterministic dependency detection
- AI-assisted semantic dependency detection
- dependency explanation

### Dependency confidence

Relationships should be classified as:

```text
CONFIRMED
LIKELY
POSSIBLE
```

Only sufficiently high-confidence relationships should automatically become executable workflows.

Field-name similarity alone must never be sufficient evidence for an executable dependency.

### Example

```text
POST /users
    ↓
userId
    ↓
GET /users/{userId}
    ↓
PUT /users/{userId}
    ↓
DELETE /users/{userId}
```

### Constraints

The dependency engine must operate on ApiModel/TestModel/domain workflow concepts.

It must not depend on Postman-specific structures.

Postman variable propagation belongs to the artifact-generation layer.

---

## AP-009 — End-to-End Test Generation Workflow

### Objective

Integrate the completed generation capabilities into the first complete ApiPilot MVP workflow.

### User journey

```text
1. Upload OpenAPI/YAML
        ↓
2. Analyze specification
        ↓
3. Review discovered APIs
        ↓
4. Generate deterministic scenarios
        ↓
5. Enhance scenarios with local AI
        ↓
6. Review generated scenarios
        ↓
7. Analyze API dependencies
        ↓
8. Review/approve workflows
        ↓
9. Produce approved TestModel
        ↓
10. Generate Postman collection
        ↓
11. Download collection/environment
```

### Constraints

Executable artifact generation must occur only from an approved TestModel.

AI-generated content must not automatically imply execution authorization.

The workflow must preserve provenance and traceability throughout the generation process.

---

## AP-010 — Presentation System & Review Scalability

### Objective

Make the AP-001–AP-009 guided workflow actually usable by a QA engineer against real-world
specifications, not only against small fixtures. This closes gaps found during a real
end-to-end usability pass against a production specification (51 operations, 371 generated
scenarios, 8 detected dependency workflows): every workflow screen renders as unstyled default
HTML, and the Scenario Review (AP-006) and Workflow Review (AP-008/AP-009) screens support only
one-at-a-time decisions with no bulk action, making full review of 371 scenarios or several
dozen workflows impractical.

This feature satisfies constitution principles XXXII (Human Review Must Remain Practical at
Real Scale) and XXXIII (Presentation Must Be Consistent, Coherent, and Usable), introduced in
response to this same finding.

### Scope

- Apply the project's established presentation system (Tailwind CSS v4, per
  `.claude/CLAUDE.md` / `.github/copilot-instructions.md`) consistently across every existing
  workflow screen and component (`TestGenerationWorkflowPage` and its stage components; the
  AP-002 analysis/operation views; the AP-006 scenario-review components; the AP-008/AP-009
  workflow-review view; the AP-007/AP-009 Postman export view), including HTTP-method
  badges, status/severity indicators, and consistent loading/empty/error states.
- Add grouped/bulk decision actions to Scenario Review: accept/reject by the existing
  operation and category filters, and accept/reject a multi-selection, alongside the existing
  per-scenario decision (which remains available for individual overrides).
- Add a bulk approve/reject action to Workflow Review for the discovered integration
  workflows.
- Remove the duplicate AI-enhancement-skipped banner currently shown twice on Scenario Review
  (`WorkflowStageTracker` and `AiEnhancementStage` both render it).
- Accessibility pass over the affected screens (keyboard operability of bulk selection,
  focus management, accessible names for grouped actions).

### Constraints

- Presentation-only and additive-interaction changes: this feature MUST NOT alter `ApiModel`,
  `TestModel`, review/workflow domain contracts, or any deterministic generation, AI, or
  dependency-analysis behavior.
- A bulk decision MUST resolve to the same explicit per-scenario/per-workflow decision records
  already produced by the existing single-item endpoints — bulk actions are a UI convenience
  over the existing review/decision model, not a new decision semantics.
- Existing single-item accept/reject/approve/reject actions MUST remain available; bulk actions
  are additive.
- No new frontend styling framework may be introduced (constitution XXVIII, and
  `.claude/CLAUDE.md` §26–27); this feature applies the framework the project has already
  chosen.

### Dependencies

Requires AP-006 (Test Scenario Review), AP-008 (API Dependency & Integration Workflow Engine),
and AP-009 (End-to-End Test Generation Workflow) to already exist, since it styles and extends
their screens rather than introducing new ones.

---

## Hardening — Bounded AI Prompt Batching (`011-ai-prompt-batching`)

### Objective

Let AI-assisted dependency detection (AP-008) and AI-assisted scenario enhancement (AP-005)
actually run against large OpenAPI specifications, instead of being silently skipped whenever a
specification's full `ApiModel` exceeds the configured AI provider's usable request capacity.
This is a hardening spec against two already-shipped features, not a new pipeline stage, so it
is intentionally not numbered `AP-###` in the Feature Decomposition above.

### Scope

- Deterministically split a large `ApiModel` into multiple smaller batches of operations, each
  sized to fit the provider's usable capacity (`AIProvider.getInputBudget()`).
- Issue one AI request per batch, strictly sequentially, and merge every successful batch's
  results with the deterministic baseline using the same validation, deduplication, and
  provenance rules as a single-request call today.
- Report a `"partial"` outcome — distinct from full success and full failure — when at least
  one batch succeeds while at least one other fails, times out, or is skipped once the existing
  analysis time budget is exhausted.

### Constraints

- Specifications that already fit in a single AI request MUST see no behavior change (same
  single `infer()` call, identical output).
- Batching MUST be fully deterministic: the same specification and provider configuration MUST
  always produce the same batch grouping (constitution: Determinism First / XXIV
  Reproducibility).
- Batching MUST NOT exceed the overall performance budget the enhanced analysis already
  respects (e.g. AP-008's existing 15-second dependency-analysis budget).
- A total failure (every batch fails) MUST remain reported identically in meaning to today's
  single-request failure — never surfaced as `"partial"`.

### Dependencies

Requires AP-004 (`AIProvider` abstraction), AP-005 (AI Test Scenario Designer), and AP-008 (API
Dependency & Integration Workflow Engine) to already exist, since it extends their AI-assisted
passes rather than introducing a new one.

---

## Hardening — AI Enhancement Progress Visibility (`012-ai-enhancement-progress`)

### Objective

Let a user watching AI-assisted scenario enhancement (AP-005) run against a specification large
enough to need multiple batches (`011-ai-prompt-batching`) see live, batch-level progress while
it runs, instead of a single unchanging wait followed by one final outcome that reads as
ambiguous or alarming even when the workflow has actually advanced correctly. This is a
hardening spec against an already-shipped feature, not a new pipeline stage, so it is
intentionally not numbered `AP-###` in the Feature Decomposition above.

### Scope

- Show which batch is currently being processed, and each already-finished batch's
  success/failure, while a multi-batch enhancement run is still in progress.
- Reveal each batch's AI-derived scenarios into scenario review as soon as that batch
  succeeds, rather than only once every batch finishes.
- Present exactly one unambiguous final status (fully completed / partially completed / not
  completed) once a run finishes, clearly distinct from the in-progress state.
- Prevent a second AI enhancement run from starting for the same workflow while one is already
  in progress.

### Constraints

- MUST NOT change the deterministic batch grouping, merge/deduplication rules, or the
  success/partial/skipped outcome semantics already defined by `011-ai-prompt-batching` — only
  how progress through that existing computation is surfaced changes.
- Specifications whose enhancement completes in a single batch MUST see no behavior change
  (same total time to result, same information shown).
- A user's review decision on a scenario revealed from an already-succeeded batch MUST be
  preserved regardless of how later batches in the same run conclude.
- MUST NOT introduce a new transport mechanism, external dependency, or persistence layer
  (constitution XXVII) — progress is carried through the existing workflow-state polling
  endpoint the frontend already uses.

### Dependencies

Requires AP-005 (AI Test Scenario Designer) and `011-ai-prompt-batching` (Bounded AI Prompt
Batching) to already exist, since it adds visibility into their existing batched execution
rather than introducing a new AI-assisted pass.

---

# Post-MVP Features

## AP-011 — Test Execution & Results

### Objective

Execute approved/generated API test artifacts against explicitly configured environments and provide structured results.

### Initial execution path

```text
Postman Collection
       ↓
Newman
       ↓
Execution
       ↓
Results
```

### Scope

- collection execution
- environment selection
- environment configuration
- execution policy
- pass/fail results
- response information
- assertion failures
- execution summary
- failure categorization
- execution logs
- result persistence where appropriate

### Execution Authorization

Generated tests or workflows must not constitute authorization to execute.

Execution must require:

- explicit user action, or
- an explicitly configured execution policy

AI must never autonomously authorize execution.

### Environment Safety

The execution system must treat environments as potentially sensitive and destructive.

It should support environment classification such as:

```text
LOCAL
DEV
QA
STAGING
PRODUCTION
```

Destructive operations should be identifiable and subject to appropriate execution safeguards.

ApiPilot must not silently execute generated destructive workflows against production or other protected environments.

### Diagnostics

Diagnostics should favor:

- operation IDs
- request/execution IDs
- processing stage
- duration
- error categories
- assertion identifiers

over raw:

- credentials
- request bodies
- sensitive payloads

Sensitive payload logging must remain disabled by default.

---

## AP-012 — AI Failure Analysis

### Objective

Analyze API test failures using AI without allowing AI to execute APIs or alter test execution autonomously.

### Scope

- failure summarization
- likely-cause analysis
- affected API identification
- dependency analysis
- evidence extraction
- suggested investigation
- potential specification mismatch
- potential environment issue
- potential downstream-service issue
- confidence
- explanation provenance

### Input

```text
Execution Results
+
TestModel
+
ApiModel
+
Workflow/Dependency Context
```

### Output

```text
Failure Analysis
```

### Constraints

AI consumes execution results; it does not execute APIs directly.

AI-generated explanations are inferences and must not be presented as confirmed root causes without supporting evidence.

When confidence is low or evidence is insufficient, ApiPilot must explicitly surface the limitation rather than fabricate a cause.

AI failure analysis must be evaluated using the same evidence-driven evaluation principles as other AI capabilities.

---

# Dependency Graph

```text
                         AP-001
                            │
                            ▼
                         AP-002
                            │
                            ▼
                         AP-003
                            │
                            ▼
                         AP-004
                            │
                            ▼
                         AP-005
                            │
                            ▼
                         AP-006
                            │
                 ┌──────────┴──────────┐
                 ▼                     ▼
              AP-007                AP-008
            Postman             Dependencies
                 │                     │
                 └──────────┬──────────┘
                            ▼
                         AP-009
                            │
                            ▼
                         AP-010
                       Presentation &
                     Review Scalability
                            │
                     ───── MVP ─────
                            │
                            ▼
                         AP-011
                            │
                            ▼
                         AP-012
```

AP-007 and AP-008 may be developed in parallel after their prerequisites are satisfied, provided their shared domain contracts are stable.

---

# MVP Boundary

The first ApiPilot MVP consists of:

```text
AP-001  Application Foundation
AP-002  OpenAPI Specification Engine
AP-003  Deterministic Test Designer
AP-004  AI Provider & Local Inference Foundation
AP-005  AI Test Scenario Designer
AP-006  Test Scenario Review
AP-007  Postman Collection Generator
AP-008  API Dependency & Integration Workflow Engine
AP-009  End-to-End Test Generation Workflow
AP-010  Presentation System & Review Scalability
```

AP-010 is part of the MVP boundary, not a post-MVP feature: an MVP whose guided workflow is
impractical to review at real scale, or is presented as unstyled default markup, does not meet
the "viable" bar (constitution XXXII, XXXIII).

The following are explicitly outside the first MVP:

```text
AP-011  Test Execution & Results
AP-012  AI Failure Analysis
```

---

# Product Milestones

## M0 — Governed

```text
Constitution
     +
Spec-of-Specs
```

ApiPilot has established engineering governance and a feature decomposition.

## M1 — API Understanding

```text
OpenAPI → ApiModel
```

ApiPilot can reliably understand an OpenAPI specification.

## M2 — Deterministic Test Intelligence

```text
ApiModel → TestModel
```

ApiPilot can generate a baseline deterministic API test suite without AI.

## M3 — Local AI Foundation

```text
ApiPilot → AIProvider → Local Model → Structured Inference
```

ApiPilot can perform local AI inference without requiring a cloud provider.

## M4 — AI Test Intelligence

```text
ApiModel
+
Deterministic TestModel
+
Local AI
        ↓
Enhanced TestModel
```

AI meaningfully increases test coverage without replacing deterministic testing.

## M5 — Human-Approved Executable Tests

```text
Enhanced TestModel
        ↓
Review
        ↓
Approved TestModel
        ↓
Postman
```

ApiPilot can generate a validated Postman collection from approved test intent.

## M6 — Integration Intelligence

```text
Multiple APIs
      ↓
Dependencies
      ↓
Workflows
```

ApiPilot can identify and represent meaningful API integration workflows.

## M7 — ApiPilot MVP

```text
OpenAPI
  ↓
Analyze
  ↓
Generate
  ↓
AI Enhance
  ↓
Review
  ↓
Workflow
  ↓
Postman
```

This pipeline is only genuinely viable once AP-010 (Presentation System & Review Scalability)
is complete — see the MVP Boundary note above.

## M8 — Execution Platform

```text
Generate
   ↓
Authorize
   ↓
Execute
   ↓
Results
   ↓
Analyze
```

---

# Decomposition Rules

Each `AP-###` specification must be independently understandable and implementable.

Each feature specification must contain, where applicable:

- user stories
- acceptance scenarios
- functional requirements
- non-functional requirements
- edge cases
- constraints
- dependencies
- success criteria
- explicit out-of-scope items

Avoid duplicating requirements between specifications.

Cross-cutting requirements are governed by the project constitution and should be referenced rather than duplicated.

Each specification must define a clear boundary.

Use dependency references rather than copying implementation details from prerequisite specifications.

Technical implementation choices should be deferred to `/speckit.plan` unless required to establish the feature boundary.

AI-specific features must use the `AIProvider` abstraction.

Postman-specific concepts must remain within the Postman artifact-generation boundary.

Execution-specific capabilities must not leak into test-generation features.

---

# Spec Kit Development Lifecycle

For every feature, execute:

```text
/speckit.specify
        ↓
/speckit.clarify
        ↓
/speckit.plan
        ↓
/speckit.checklist
        ↓
/speckit.tasks
        ↓
/speckit.analyze
        ↓
/speckit.implement
        ↓
/speckit.converge
```

The constitution is the governing document for every phase.

The implementation must be verified against:

```text
Constitution
     ↓
Specification
     ↓
Clarifications
     ↓
Plan
     ↓
Tasks
     ↓
Tests
     ↓
Implementation
```

---

# Next Actions

1. ~~Ratify the ApiPilot constitution as the authoritative project governance document.~~ Done
   — see `.specify/memory/constitution.md` (currently v2.1.1).
2. Keep `.specify/memory/constitution.md` as the single authoritative constitution source.
3. ~~Commit this roadmap as the reference Spec-of-Specs document.~~ Done.
4. ~~Start with AP-001 — Application Foundation~~ Done, along with AP-002 through AP-010 and
   the `011-ai-prompt-batching` hardening spec — see the Implementation Status table above.
5. ~~Run the complete Spec Kit lifecycle for AP-001 before moving to AP-002.~~ Done for
   AP-001–AP-010 and `011-ai-prompt-batching`.
6. ~~Complete `012-ai-enhancement-progress`: run `/speckit-tasks` → `/speckit-analyze` →
   `/speckit-implement` → `/speckit-converge` (spec and plan are already done).~~ Tasks,
   analysis, and implementation are done (`npm test`, `npm run lint`, `npm run build` all
   pass) — see the Implementation Status table above. Run `/speckit-converge` next; the one
   outstanding item is the optional manual real-model UI validation step in
   `specs/012-ai-enhancement-progress/quickstart.md`.
7. ~~During AP-004 `/speckit.plan`, evaluate and select the initial local AI model using
   representative ApiPilot workloads rather than assuming a model in advance.~~ Done — see
   `specs/004-ai-provider-local-inference/` and `npm run ai:benchmark -w backend`.
8. Address the outstanding follow-up tasks noted in the Implementation Status table above
   (AP-001, AP-004, AP-005, AP-007, `012-ai-enhancement-progress`) where practical, or
   explicitly defer them with a documented reason if they remain out of scope.
9. Do not begin AP-011 (Test Execution & Results) or AP-012 (AI Failure Analysis) — both
   post-MVP — until the full MVP boundary (AP-001 through AP-010) has been validated
   end-to-end against a real specification, per the MVP Boundary section above.