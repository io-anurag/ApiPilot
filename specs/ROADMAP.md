# ApiPilot — Product Roadmap (Spec-of-Specs)

**Status**: Reference document. AP-001 through AP-028 have each been run through
`/speckit-specify` individually, in dependency order. See the Implementation Status table below
for where each one currently stands in the `clarify` → `plan` → `checklist` → `tasks` →
`analyze` → `implement` → `converge` lifecycle. Of the two originally post-MVP features, AP-017
(Test Execution & Results) is implemented; AP-018 (AI Failure Analysis) has not been started.
AP-019 through AP-025 are further hardening/extension features layered on top of the shipped MVP
and AP-017, mirroring how AP-011 through AP-016 relate to their own prerequisites (see their own
Feature Decomposition sections below). AP-026 is a standalone capability layered on top of AP-017
(it reuses, but does not extend, AP-017's execution engine) rather than a hardening fix to an
existing defect. AP-027 (frontend design system and application shell) is a presentation-layer
feature that changes no backend contract or workflow rule, and AP-028 (Postman-style collection
and variable editor) is a pre-run editing surface layered on top of AP-026.

AP-011 through AP-016 were originally tracked as unnumbered "hardening" specs to avoid a
numbering collision with the post-MVP features, which were numbered AP-011/AP-012 at the time.
That collision has since been resolved by renumbering the post-MVP features to AP-017/AP-018 and
folding the hardening specs into the main AP-numbering sequence, matching each one's existing
`specs/0NN-...` directory number. Directory and git-branch names are unchanged
(`011-ai-prompt-batching` through `016-workflow-aware-postman`); `AP-0NN` is the canonical
feature identifier used everywhere else (this document, README.md, cross-spec references).

## Implementation Status

| Feature | Status |
|---|---|
| AP-001 — Application Foundation | Implemented (1 minor follow-up task outstanding: a pre-flight `node_modules` dependency guard) |
| AP-002 — OpenAPI Specification Engine | Implemented |
| AP-003 — Deterministic Test Designer | Implemented |
| AP-004 — AI Provider & Local Inference Foundation | Implemented (1 follow-up task outstanding: full manual quickstart validation pass) |
| AP-005 — AI Test Scenario Designer | Implemented (3 follow-up tasks outstanding: broader semantic validation coverage, candidate-ID/low-confidence policy enforcement, all-or-nothing degradation coverage for partial/mixed-invalid provider responses — all marked partial in tasks.md) |
| AP-006 — Test Scenario Review | Implemented |
| AP-007 — Postman Collection Generator | Implemented (1 follow-up task outstanding: the manual Postman-import acceptance step, which needs a real, operator-authorized target this feature deliberately does not provide). Amended 2026-09-23: a path parameter with no approved value is exported as a resource-qualified variable (`/users/{id}` → `{{user_id}}`) so same-named parameters on different resources no longer share one value |
| AP-008 — API Dependency & Integration Workflow Engine | Implemented |
| AP-009 — End-to-End Test Generation Workflow | Implemented. Amended 2026-09-20 (`execution` becomes the tenth, optional stage) and 2026-09-23 (API review records an explicit operation selection that scopes deterministic generation and AI enhancement). Amended again 2026-09-23 to specify the execution-stage hand-off to "Import & Run Collection" (Next Actions #20, #22) |
| AP-010 — Presentation System & Review Scalability | Implemented |
| AP-011 — Bounded AI Prompt Batching | Implemented |
| AP-012 — AI Enhancement Progress Visibility | Implemented (1 follow-up task outstanding: manual real-model UI validation from quickstart.md, optional) |
| AP-013 — AI Enhancement Viability | Implemented with follow-up validation outstanding: benchmark workload/dtype evidence, endpoint integration coverage, fake-timer UI coverage, and regression checklist |
| AP-014 — AI Batching Policy & Run Pacing | Implemented (2 tasks blocked on an uncached real local model — validating a conditional-example batching rule and re-measuring decode throughput — plus two startup-validation items for the run-budget env var deliberately deferred, per tasks.md) |
| AP-015 — AI Batch Retry | Implemented |
| AP-016 — Workflow-Aware Postman Generation | Implemented |
| Session-Scoped Concurrent Workflow Isolation (`specs/017-session-workflow-isolation`) | Implemented |
| AP-017 — Test Execution & Results *(post-MVP)* | Implemented (`specs/018-test-execution-results`) — all 49 tasks complete, full backend/frontend suites passing, real end-to-end quickstart walkthrough recorded in Next Actions #13. Since 2026-09-23 its endpoints are an API-only path; the UI runs generated collections through AP-026 after the guided workflow's hand-off, and its unrendered frontend components were removed (Next Actions #22, #23) |
| AP-018 — AI Failure Analysis *(post-MVP)* | Not started |
| AP-019 — Automatic Workflow Chaining (`specs/019-auto-workflow-chaining`) | Implemented — all tasks (T001–T037) complete |
| AP-020 — Frontend Application Logging (`specs/020-frontend-application-logging`) | Implemented — all tasks (T001–T028) complete |
| AP-021 — Distinct-Credential Token Provisioning (`specs/021-multi-credential-token-provisioning`) | Implemented — all 22 tasks complete |
| AP-022 — Specification-Conformant Parameter Serialization (`specs/022-openapi-parameter-serialization`) | Implemented — all 25 tasks complete |
| AP-023 — Automatic Auth-Credential Chaining (`specs/023-auto-auth-credential-chaining`) | Implemented — all 23 tasks complete |
| AP-024 — OAuth2 Client-Credentials Auth Support (`specs/024-oauth2-client-credentials-auth`) | Implemented — all 30 tasks complete, re-validated against the PayPal Invoicing API fixture (0/22 operations unsupported, down from 22/22) |
| AP-025 — Local Persistence Layer (`specs/025-local-persistence-layer`) | Implemented — all 34 tasks complete |
| AP-026 — External Postman Collection Import & Execution (`specs/026-external-collection-execution`) | Implemented — all 46 tasks complete (1 manual-browser-walkthrough task explicitly not performed, no browser tool available; substituted with real Supertest-driven integration coverage of every quickstart scenario). FR-004 superseded 2026-09-23: an unresolved variable no longer refuses a run, which also retires the script-set-variable limitation originally recorded here |
| AP-027 — Frontend Design System & Application Shell (`specs/027-frontend-design-system`) | Implemented — all 57 tasks complete |
| AP-028 — Postman-Style Collection & Variable Editor (`specs/028-collection-editor-ui`) | Implemented — all 72 tasks complete. Generated collections are covered through the guided workflow's hand-off, which the spec records as satisfying FR-008 (Clarifications 2026-09-23; Next Actions #22) |

AP-012's follow-up real-model validation surfaced the local inference capacity and
output-reliability defects addressed by AP-013.

Hardening continued in dependency order: AP-014 corrects a stale batch-sizing default from AP-011
and sizes AI requests to bounded units of work rather than raw context-window capacity; AP-015
lets a single failed batch from that same batched run be retried without discarding
already-succeeded batches; AP-016 is unrelated to the batching/enhancement chain and instead
makes the AP-008/AP-009 workflow review decision consequential by having AP-007's Postman
generator emit approved workflows as ordered, dependency-aware request sequences.

`specs/017-session-workflow-isolation` is a further hardening feature on AP-009/AP-012, isolating
the previously single, backend-wide in-progress workflow (AP-009 FR-018) per browser session so
concurrent users no longer collide. Despite the directory-number coincidence, this is **not** the
`AP-017` post-MVP feature below (Test Execution & Results) — see that spec's own "Relationship to
Existing Specifications" section for why the two are unrelated and how to tell them apart.

Each spec's own `spec.md` still carries a template-default `**Status**: Draft` header — that
field is not maintained after `/speckit-specify` runs and should not be read as the feature's
real implementation status; this table is the accurate source for that.

AP-019 through AP-024 trace directly back to real-world Postman-export gaps found while
exercising AP-017: AP-021 (distinct credential variables), AP-022 (parameter serialization), and
AP-024 (OAuth2 client-credentials) each fix a defect a real specification actually triggered, and
AP-019/AP-023 extend the existing dependency-chaining engine (AP-008) so those exports need less
manual workflow assembly. AP-020 (frontend logging) is unrelated infrastructure closing a gap
between the backend's existing structured logging and the frontend's total absence of one.
AP-025 (local persistence layer) is the most consequential of the seven for this document's own
claims: it makes environments, execution run history, and AI readiness/benchmark diagnostics
survive a backend restart via a local SQLite database, which **supersedes every earlier statement
in this roadmap and the project's other documentation that environments/execution history are
"in-memory only"** — guided-workflow generation progress itself remains in-memory only and
unaffected. See AP-025's own Feature Decomposition section below for the precise scope.

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

## AP-011 — Bounded AI Prompt Batching

### Objective

Let AI-assisted dependency detection (AP-008) and AI-assisted scenario enhancement (AP-005)
actually run against large OpenAPI specifications, instead of being silently skipped whenever a
specification's full `ApiModel` exceeds the configured AI provider's usable request capacity.
This is a hardening feature against two already-shipped features (AP-005, AP-008), not a new
pipeline stage — its directory is `specs/011-ai-prompt-batching`.

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

## AP-012 — AI Enhancement Progress Visibility

### Objective

Let a user watching AI-assisted scenario enhancement (AP-005) run against a specification large
enough to need multiple batches (AP-011) see live, batch-level progress while it runs, instead
of a single unchanging wait followed by one final outcome that reads as ambiguous or alarming
even when the workflow has actually advanced correctly. This is a hardening feature against an
already-shipped feature (AP-005), not a new pipeline stage — its directory is
`specs/012-ai-enhancement-progress`.

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
  success/partial/skipped outcome semantics already defined by AP-011 — only how progress
  through that existing computation is surfaced changes.
- Specifications whose enhancement completes in a single batch MUST see no behavior change
  (same total time to result, same information shown).
- A user's review decision on a scenario revealed from an already-succeeded batch MUST be
  preserved regardless of how later batches in the same run conclude.
- MUST NOT introduce a new transport mechanism, external dependency, or persistence layer
  (constitution XXVII) — progress is carried through the existing workflow-state polling
  endpoint the frontend already uses.

### Dependencies

Requires AP-005 (AI Test Scenario Designer) and AP-011 (Bounded AI Prompt Batching) to already
exist, since it adds visibility into their existing batched execution rather than introducing a
new AI-assisted pass.

---

## AP-013 — AI Enhancement Viability

### Objective

Make AI-assisted scenario enhancement actually able to succeed on local CPU inference. Five
compounding defects — missing instruction framing, a pessimizing weight precision, an inflated
input-capacity estimate, an output allowance and time budget that cannot fit each other, and an
oversized prompt — combined to make every run fail. This feature corrects all five and replaces
the resulting five-minute silent timeout with an honest, interruptible, explained wait.

### Input

```text
ApiModel
+
Deterministic TestModel
+
AIProvider (local)
```

### Output

```text
Enhanced TestModel (actually reachable)
+
Pre-flight viability refusal
+
Cancellable, phase-aware progress
```

### Scope

- conversational prompt framing for instruction-tuned models
- model-signalled stop instead of always exhausting the output allowance
- true positional input capacity, not an inflated tokenizer maximum
- reduced, task-scoped prompt content
- an output allowance sized to fit within the run's time budget
- a pre-flight viability estimate with immediate refusal when work cannot fit
- preparing-vs-generating phase visibility and elapsed time
- user cancellation with prompt resource release
- plain-language, categorized failure explanations with no internal identifiers

### Constraints

- Must not introduce a replacement default model, hardware acceleration, or a cloud/hosted
  inference path.
- Must preserve AP-011's batching/outcome semantics and AP-012's progress/concurrency guarantees;
  this feature deliberately supersedes AP-012's decision to hide progress for single-batch runs.
- Deterministic scenarios must remain unaffected by any AI outcome, including refusal,
  cancellation, and failure.
- Model selection stays evidence-based; a replacement model is a separate decision if
  implementation evidence requires one.

### Dependencies

Requires AP-004 (`AIProvider`, readiness, queueing, timeout), AP-005 (the enhancement prompt,
validation, provenance), AP-011 (batch planning and outcome semantics), and AP-012 (progress
reporting and the concurrency guard) — all of which this feature corrects and finally makes
reachable.

---

## AP-014 — AI Batching Policy and Run Pacing

### Objective

Make AI-assisted work — scenario enhancement and dependency analysis — size its requests by a
small fixed amount of work rather than by remaining model context capacity, so a realistic
specification actually splits into multiple batches. Without this, one oversized request absorbed
an entire run, so the streaming, progress, cancellation, and partial-retention behavior AP-011,
AP-012, and AP-013 already built never activated in practice.

### Input

```text
ApiModel
+
AIProvider (local)
```

### Output

```text
Work-bounded batches
+
Run-level time ceiling
+
Honest retryable/non-retryable failure explanations
```

### Scope

- fixed, caller-specific unit sizing: small for scenario enhancement, larger for dependency
  analysis, which needs several operations in view at once to infer a relationship
- a context-capacity check retained only as an upper bound
- a run-level wall-clock ceiling, distinct from the existing per-request timeout
- pre-flight viability evaluation wired into the actual enhancement call path
- a worked-example prompt shape for request-body operations, to reduce truncation
- retryable-vs-non-retryable failure classification
- the same work-bounded pacing applied to dependency analysis's AI-assisted pass

### Constraints

- Unit derivation MUST be fully deterministic: the same specification always yields the same
  units, in the same order.
- A failing or not-attempted unit MUST NOT discard other units' results; the run settles
  `partial` and retains everything already produced.
- The run ceiling governs only the AI-assisted pass; it must not alter deterministic matching,
  scenario generation, or workflow assembly.
- Must preserve every guarantee already established by AP-011 (outcome semantics), AP-012
  (progress reporting), and AP-013 (pre-flight refusal, phase visibility, cancellation).
- Must not change the default model or move inference off the main thread.

### Dependencies

Requires AP-011 (corrects its stale batch-sizing default) and extends AP-013 (viability
estimation, honest failure). Applies to both AP-005 (scenario enhancement) and AP-008 (dependency
analysis) call paths.

---

## AP-015 — AI Batch Retry

### Objective

Let a user retry a single failed or not-attempted batch from a settled AI-enhancement run,
without re-running every batch that already succeeded and without disturbing any review decision
already recorded on another batch's scenarios.

### Input

```text
Settled AI Enhancement run
(per-batch terminal status + retryability)
```

### Output

```text
Updated batch outcome
+
Recomputed stage-level status
```

### Scope

- persisted per-batch terminal status and human-readable failure reason, visible after the run
  settles rather than only while it is in progress
- a per-batch retry action, offered only for batches whose status is failed/not-attempted and
  whose failure is classified retryable
- retry scoped to exactly that batch's original operations, replacing only that batch's scenarios
  and status
- automatic recomputation of the AI Enhancement stage's overall status from every batch's current
  terminal status after each retry
- rejection of retry once scenario review has been finalized, matching the existing whole-stage
  retry rule

### Constraints

- Must not affect any scenario, review decision, or status belonging to a batch other than the
  one retried.
- Must not allow two AI operations — a whole-stage run, or any batch retry — to run concurrently
  against the same workflow.
- Deterministic scenarios must remain completely unaffected by any batch retry.
- No history of earlier retry attempts is retained; each retry overwrites that batch's own record
  in place.

### Dependencies

Requires AP-014 (the batches and retryability classification being retried) and preserves
AP-011/AP-012/AP-013's determinism, provenance, and explicit-failure conventions.

---

## AP-016 — Workflow-Aware Postman Generation

### Objective

Make the workflow-review decision (AP-008/AP-009) consequential to the generated artifact by
rendering each approved integration workflow as an ordered, dependency-aware Postman request
sequence with named data handoffs, instead of exporting its operations as unrelated
single-operation requests.

### Input

```text
Approved integration workflows
+
Approved scenario set
+
Dependency relationships
```

### Output

```text
collection.json (workflow sequences + standalone requests)
environment.json
README.md (rendered / omitted workflows, handoffs, limitations)
```

### Scope

- ordered request sequences for each supported approved workflow, preserving approved step order
- response-to-request variable extraction for documented data handoffs
- explicit unsupported-workflow reporting (missing step data, unresolved order, cycles,
  unrepresentable auth/content) instead of a misleading partial sequence
- continued standalone rendering of approved scenarios not covered by a rendered workflow
- deterministic, collision-free naming and stable output across repeated exports

### Constraints

- Must not fabricate a step order, extraction, handoff, assertion, or request value unsupported
  by the approved workflow, dependency data, approved scenario, or specification.
- Must not execute generated requests or contact any API described by the specification.
- Must preserve existing single-operation export behavior for inputs with no workflow intent
  (backward compatible).
- Must retain existing credential/base-URL variable protections; no secrets embedded in the
  collection or diagnostics.
- Does not change how dependencies are discovered or how scenario/workflow approval decisions are
  made.

### Dependencies

Requires AP-007 (Postman Collection Generator) and AP-009 (End-to-End Test Generation Workflow);
otherwise independent of the AP-011–AP-015 batching/enhancement chain.

---

## Session-Scoped Concurrent Workflow Isolation (`specs/017-session-workflow-isolation`)

### Objective

Let multiple browser sessions run the guided workflow (AP-009) at the same time without one
session's actions overwriting, hiding, or exposing another's in-progress workflow, by replacing
the single backend-wide `TestGenerationWorkflow` instance with one instance per unguessable
session identity — while preserving today's single-user continuity across reloads and additional
tabs.

Despite the directory-number coincidence, this is **not** the `AP-017` post-MVP feature below
(Test Execution & Results); see the spec's own "Relationship to Existing Specifications" section
for why the two are unrelated.

### Input

```text
Unguessable per-browser session identity
+
Existing single-instance TestGenerationWorkflow (AP-009)
```

### Output

```text
One isolated in-progress workflow per active session
+
Explicit "session expired" notice on idle eviction
```

### Scope

- an unguessable, cryptographically random session identifier requiring no login or personal
  data
- one in-progress workflow per session, with the existing "starting a new workflow replaces the
  current one" behavior scoped to that session only
- continuity of a session's own workflow across page reloads and additional tabs in the same
  browser
- idle-session eviction after 60 minutes with an explicit expiry notice, distinct from a
  genuinely new session's empty state
- correct per-session behavior of AP-012's batch-level AI-enhancement progress reporting

### Constraints

- The shared local AI provider's readiness state and single serialized inference queue (AP-004)
  remain one process-wide resource; only workflow progress, decisions, and generated content are
  isolated per session.
- No workflow state is persisted to durable storage; a backend restart still clears every
  session's workflow, unchanged from AP-009.
- Introduces session isolation, not authentication — no login, accounts, or cross-device identity
  linking.
- Must not regress AP-009's reconnect guarantee or AP-012's reconnect/progress-visibility design
  for the single-user case.

### Dependencies

Requires AP-009 (End-to-End Test Generation Workflow, whose single global instance it replaces)
and AP-012 (AI Enhancement Progress Visibility, whose reconnect design assumed no session
identity and must remain compatible).

---

## AP-019 — Automatic Workflow Chaining for Postman Export

### Objective

Extend the deterministic Postman export path so a standalone scenario's unresolved path parameter
can be automatically resolved from a corroborated dependency relationship, without requiring a
human to first assemble and approve a full integration workflow. This closes the dominant class of
"unresolved path parameter" limitations found while exercising AP-017 against a real specification
(701 of 709 limitations in one representative export).

### Scope

- Match each standalone (non-workflow) scenario's unresolved path parameter against the existing
  `ApiDependencyGraph` (AP-008).
- Apply the substitution only when the relationship is `CONFIRMED` or `LIKELY` and the producing
  operation has an approved positive-outcome scenario in the same export.
- Capture the producer's response value once and reuse it across every consumer that needs it
  (fan-out).
- Single-hop resolution only; no multi-hop chain assembly.
- Deterministic tie-break when more than one candidate producer exists.
- An explicit per-export opt-out (`disableAutomaticChaining`) that also governs AP-023's later
  auth-credential chaining.

### Constraints

- Never applies to a `POSSIBLE`-confidence relationship.
- Never reorders the collection to make a chain work; falls back to the existing
  unresolved-parameter limitation instead.
- Never conflicts with or duplicates an already-rendered, human-approved `IntegrationWorkflow`
  (AP-016), which always takes precedence.
- Respects an explicit human rejection of the underlying dependency/workflow.
- Fully deterministic and reproducible across repeated exports of the same approved input.
- Introduces no new AI call at export time.

### Dependencies

Requires AP-008 (dependency graph and confidence classification) and AP-016 (workflow-aware
chained-rendering primitives), which it reuses rather than replaces.

---

## AP-020 — Frontend Application Logging

### Objective

Give the frontend a structured, persistent logging trail equivalent to the backend's existing
`backend/src/logger.ts`, so runtime frontend errors are diagnosable instead of visible only in a
developer's own browser console.

### Scope

- A frontend logger (`frontend/src/logger.ts`) with `info`/`warn`/`error` levels, timestamps, and
  component/event naming.
- Global `window` `error`/`unhandledrejection` handlers wired in at application bootstrap.
- Every existing service-client module logs its own caught errors.
- `warn`/`error` entries are additionally forwarded, best-effort, to a new backend endpoint and
  persisted through the existing server-side logger under a dedicated component name.

### Constraints

- No new runtime dependency; uses the browser's native `fetch`.
- Logged context is restricted to primitive values; objects, arrays, and functions are dropped
  rather than serialized.
- A credential-shaped field-name denylist (token, API key, password, secret, authorization,
  credential, cookie) is enforced independently on both the frontend logger and the backend
  ingestion endpoint.
- A forwarding failure never throws or blocks the UI, and is never retried.
- Nothing is ever sent to an external/cloud service — only the local backend.
- Out of scope: a log-viewer UI, cross-log correlation IDs, and log persistence beyond the
  existing server-side logging destination.

### Dependencies

None on other AP-### features; reuses the backend's existing logging pattern.

---

## AP-021 — Distinct-Credential Token Provisioning for Postman Export

### Objective

Fix a Postman export defect: every security scheme of the same type (e.g., two distinct bearer
schemes) collided on one shared credential variable (`{{token}}`), silently overwriting one
scheme's value with another's. Hardens AP-007/AP-016's export path.

### Scope

- One credential variable per distinctly-keyed `components.securitySchemes` entry, not per type.
- The first-declared scheme of a type keeps the existing variable name; later schemes of the same
  type get a name derived from their own scheme key.
- Discovers a candidate unauthenticated "producer" operation that could obtain a given credential
  (by path/operation-ID similarity to the scheme key), recorded for AP-023 to consume — this
  feature does not itself wire the value in.

### Constraints

- A specification with only one scheme per type is byte-identical to prior export output.
- Tag/folder names are never used as a naming signal — only the declared scheme key.
- No fabricated token-issuing request is invented; an unresolved producer is reported as an
  explicit limitation.
- Fully deterministic and stable across repeated exports.

### Dependencies

Hardens AP-007 and AP-016; feeds AP-019's chaining option and AP-023's auth-credential wiring.

---

## AP-022 — Specification-Conformant Parameter Serialization

### Objective

Fix a Postman export defect: array/object query and header parameters were JSON-stringified into
the request rather than following the OpenAPI 3.x `style`/`explode` serialization rules declared
for that parameter, and neither the URL nor header values were percent-encoded.

### Scope

- Resolves each parameter's effective `style`/`explode` (spec-declared value, or the
  OpenAPI-defined per-location default) and renders array/object values accordingly — repeated
  keys, comma-joined, space/pipe-delimited, or `deepObject`, as applicable.
- Percent-encodes every key/value emitted into a request URL or header.
- Reports an explicit limitation for styles this feature does not implement (`matrix`, `label`,
  content-based parameters) instead of guessing.

### Constraints

- Does not change which parameters are populated, `GeneratedRequest`'s shape, or any rule module's
  generated value — this is a rendering-correctness fix only.
- A negative scenario's deliberately wrong-shaped value (e.g., a scalar substituted for an array)
  still renders as given; serialization never "repairs" an intentional constraint violation.

### Dependencies

Hardens the existing AP-003 deterministic designer's output as rendered by AP-007/AP-016's Postman
export; no dependency on the credential-chaining features.

---

## AP-023 — Automatic Auth-Credential Chaining

### Objective

Extend AP-019's dependency chaining to authentication: a token or API key obtained from one
operation's response (e.g., `POST /auth/token`) previously had no path into the `Authorization`
header/variable of operations that require it, even after AP-021 had already given that scheme its
own named variable.

### Scope

- Adds `auth` as a new dependency field location alongside the existing path/query/header/body
  locations.
- When a producer identified by AP-021 has a response with exactly one plausible string-typed
  credential field, its value is captured and written into the same variable AP-021 already
  named — no separate chain-scoped variable.
- Reuses AP-019's existing `disableAutomaticChaining` opt-out; no second flag.

### Constraints

- `http`/`basic` schemes are explicitly excluded from automatic chaining and always fall to the
  existing unresolved-credential limitation.
- Ambiguity — zero or multiple plausible response fields, or zero or multiple producer
  candidates — never guesses; it falls through to AP-021's unresolved-producer limitation.
- Never reorders the collection to make a chain work.
- Fully deterministic and stable across repeated exports; no real credential value is fabricated
  and no request is executed.

### Dependencies

Requires AP-021 (credential-variable naming and producer discovery) and AP-008/AP-019 (the
dependency graph and chaining engine it extends).

---

## AP-024 — OAuth2 Client-Credentials Auth Support for Postman Export

### Objective

Recognize OpenAPI `oauth2` security schemes using the `clientCredentials` flow, which previously
fell through entirely to an "unsupported auth scheme" limitation — found to affect 22 of 22
operations on a real-world validation specification.

### Scope

- Classifies `oauth2` schemes with a `clientCredentials` flow as supported; `authorizationCode`,
  `implicit`, and password-only flows remain explicitly unsupported.
- Provisions `clientId`/`clientSecret`/`accessToken` credential variables per scheme, named per
  AP-021's convention.
- Synthesizes exactly one token-fetch request per required scheme — HTTP Basic client
  authentication, `grant_type=client_credentials`, optional `scope`, resolved against the declared
  token URL — placed in a prepended "OAuth2 Token Setup" folder.
- The token-fetch request is included regardless of the `disableAutomaticChaining` option, which
  governs only scenario-to-scenario chaining.

### Constraints

- The token-fetch request targets the specification's own declared token URL — the user's own
  target API — never a third-party or cloud AI service; this is unrelated to the project's
  AI-provider rules.
- The client secret is provisioned as an empty, user-filled placeholder variable, never fabricated,
  logged, or sent elsewhere.
- A failed token fetch is not retried and does not silently fall back.

### Dependencies

Requires AP-019 (the chaining-option contract), AP-021 (credential-variable naming), and AP-023
(the credential-wiring pattern it extends to a new grant type).

---

## AP-025 — Local Persistence Layer

### Objective

Let data currently held only in in-memory maps — environments and their credentials, execution run
history, and AI readiness/benchmark diagnostics — survive a backend restart, using a lightweight
local SQLite database (`better-sqlite3`), without introducing a networked or shared database or
changing the product's session-scoped, no-login model.

### Scope

- Persists `Environment` definitions (including credential configuration), `ExecutionRun` history
  (status, timing, per-request results), and AI readiness-state/benchmark-result history, each for
  as long as its owning browser session remains active.
- Automatically initializes and loads the local storage file on startup, with no manual migration
  step.
- Distinguishes an execution run interrupted by a backend restart from one the user explicitly
  cancelled, via a `cancelReason` field.
- Encrypts environment credential values at rest (AES-256-GCM, via Node's built-in `node:crypto`)
  with the symmetric key held in a separate sibling file, so a copied database file alone cannot be
  decrypted.
- The storage file's location is configurable (`APIPILOT_DB_PATH`), with a safe default requiring
  no configuration.

### Constraints

- Guided-workflow generation progress and session-registry bookkeeping remain in-memory only and
  are explicitly out of scope — this feature does not make an in-progress workflow durable.
- Corrupted or unreadable storage fails startup explicitly rather than being silently discarded or
  partially loaded.
- No credential value ever appears in plaintext in logs, error responses, or diagnostic output.
- Automated tests never read from or write to the storage location a real running instance uses.
- Execution run history is retained indefinitely (no automatic pruning) for as long as its owning
  session remains active; it is removed when that session is idle-evicted, matching the platform's
  existing 60-minute session-timeout behavior rather than being retained beyond it.
- Restart-time recovery adds under 500ms at a representative local data volume (a few hundred
  environments/runs).

### Dependencies

Builds on AP-017 (`specs/018-test-execution-results`, the `Environment`/`ExecutionRun` types it
persists), `specs/017-session-workflow-isolation` (the session-scoping/idle-eviction model that
bounds persistence lifetime), and AP-004 (the AI readiness/benchmark contracts it extends with
historical fields).

---

## AP-026 — External Postman Collection Import & Execution

### Objective

Let a QA engineer upload an existing, externally-authored Postman collection.json +
environment.json pair — never generated by ApiPilot — and run it through the same per-request
pass/fail reporting AP-017 already provides, as a standalone capability that requires no OpenAPI
specification and no active guided workflow.

### Scope

- Uploads and validates a Postman Collection v2.1 JSON file and a Postman Environment JSON file as
  a paired, named, session-scoped unit; multiple pairs may exist at once, listed and removable
  independently.
- Executes the collection's own requests, one at a time, in its own document order (including
  arbitrarily nested folders), with full pre-request/test-script fidelity via Newman's existing
  sandbox — not a fixed, script-disabled literal replay.
- Reports each request's outcome, duration, and response status, deriving pass/fail from the
  collection's own named `pm.test(...)` results rather than a fabricated status-code/schema
  classification.
- Requires an explicit, once-per-artifact "unverified content" confirmation before a newly
  uploaded collection's first-ever run, and the existing staging/production/destructive-request
  confirmation on every run start.
- Shares the existing single session-wide "one execution in progress at a time" slot with
  guided-workflow runs.
- Visibly distinguishes an uploaded-collection run from a generated-collection run everywhere run
  history/detail is shown.

### Constraints

- Does not flow through `ApiModel`/`TestModel` — this is a parallel "bring your own artifact"
  path, not an extension of the OpenAPI-driven generation pipeline.
- Does not modify AP-017's shipped `ExecutionRun`/`RequestResult` contract; a sibling pair of
  types reports the uploaded-collection shape instead.
- No new script-execution sandbox is introduced; execution happens inside Newman's own existing
  sandbox, under an explicit, narrow constitution XVII amendment (2026-09-20) scoped only to this
  feature.
- No additional request-count or run-duration limit beyond the existing per-request timeout and
  upload file-size cap.
- ~~Known, documented limitation: a variable an uploaded collection's own pre-request script sets
  at runtime, if also referenced via `{{...}}` in a static request URL/header/body, is not
  currently distinguished from a genuinely missing one.~~ Retired 2026-09-23 when FR-004 was
  superseded: unresolved variables are shown before a run (the collection view's
  `unresolvedVariables` and the variable panel's missing indicator) but no longer refuse it, so a
  value an earlier request's script captures (`pm.environment.set`) can feed a later request in
  the same run. A request that still sends an unresolved variable records its own failed/errored
  outcome. The generated-collection `execution/start` (AP-017) still refuses with
  `400 missing_variable_values`.

### Dependencies

Reuses AP-017's (`specs/018-test-execution-results`) execution engine (`newmanRunner.ts`) and
session/store patterns, and AP-025's (`specs/025-local-persistence-layer`) encrypted-at-rest
persistence pattern for the uploaded environment's credential-like values.

---

## AP-027 — Frontend Design System & Application Shell

### Objective

Give every ApiPilot page one coherent presentation layer — design tokens, a reusable component
library, and a workflow-aware application shell — without changing backend contracts, workflow
rules, or existing component behavior.

### Scope

- Design tokens (color, typography, spacing, radius, shadow) for light and dark mode, defined in a
  Tailwind v4 `@theme` block.
- A manual light/dark theme toggle, persisted per browser and defaulting to the operating
  system's preference.
- Shared components for recurring concepts: buttons and inputs, status/decision badges, HTTP
  method indicators, AI-vs-deterministic provenance indicators, tabs, dialogs, and
  empty/error/loading states.
- One reusable workflow-progress indicator showing the product's real ten stages with
  completed/active/pending/locked status and an explanation for why a locked stage is unavailable.

### Constraints

- No backend API contract, workflow/business rule, or existing component behavior changes
  (FR-012).
- Status and decision indicators carry a text label or icon in addition to color; every
  interactive element is keyboard-operable with a visible focus indicator.
- The navigation shows only stages that exist in the product today; no "History" entry until a
  History page exists (Clarifications 2026-09-20).

### Dependencies

Presentation-only; builds on AP-010's accessibility and review-scalability conventions and applies
across AP-009's guided workflow and AP-026's standalone page.

---

## AP-028 — Postman-Style Collection & Variable Editor

### Objective

Let an operator see and adjust exactly what a collection run will send — every request's method,
URL, headers, body, test script, and variable values — before starting the run, instead of only
seeing what was sent afterwards in the results.

### Scope

- A navigable folder/request tree in the collection's own order, with add, delete, rename, and
  reorder for requests and folders.
- A tabbed request editor (Headers/Body/Tests) with a resolved-vs-raw preview in which unresolved
  `{{variable}}` placeholders stay visibly marked.
- A variable panel listing every referenced variable, its value, its resolved-or-missing status,
  and which scope wins (collection default, environment, or user override), with live preview
  updates as values change.
- Edits persisted as an override layered on the original request, reflected in the record of any
  run made with them, and discarded rather than reapplied when the request no longer exists.
- A selective-run checklist (an optional `selectedRequestIds` on AP-026's `execution/start`).
- The whole editor read-only while a run of that collection is in progress (FR-017).
- Display-only "implied" authentication headers for `bearer` and header-located `apikey` auth, so
  a request does not look unauthenticated when its auth block adds a header at run time.

### Constraints

- Does not change how a collection or its `TestScenario`/`GeneratedRequest` is generated, and never
  mutates generated provenance in place.
- FR-006 superseded 2026-09-23 alongside AP-026 FR-004: unresolved variables are marked missing
  but do not block a run.

### Dependencies

Requires AP-026 (`UploadedCollectionSet` storage and execution) and AP-027 (shared components).
FR-008 also names ApiPilot-generated collections handed to execution (AP-017); those are covered
by the guided workflow's hand-off, which makes them uploaded collections (Clarifications
2026-09-23, research.md D1).

---

# Post-MVP Features

## AP-017 — Test Execution & Results

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

## AP-018 — AI Failure Analysis

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
                         AP-017
                            │
                            ▼
                         AP-018
```

AP-007 and AP-008 may be developed in parallel after their prerequisites are satisfied, provided their shared domain contracts are stable.

AP-011 through AP-016 are hardening features layered onto already-shipped MVP features rather
than new pipeline stages, so they are omitted from the main pipeline above. Their dependencies:
AP-011 requires AP-004, AP-005, and AP-008; AP-012 requires AP-005 and AP-011; AP-013 hardens
AP-012's local-inference assumptions; AP-014 requires AP-011 (corrects its batch-sizing default)
and extends AP-013; AP-015 requires AP-014; AP-016 requires AP-007 and AP-009 and is otherwise
independent of the AP-011–AP-015 batching/enhancement chain.

AP-019 through AP-025 are a further round of hardening/extension features, layered onto AP-017 and
the already-shipped export/dependency chain, and are likewise omitted from the main pipeline above.
Their dependencies: AP-019 requires AP-008 and AP-016; AP-020 is independent of every other
AP-### feature; AP-021 hardens AP-007/AP-016; AP-022 hardens AP-003 as rendered by AP-007/AP-016;
AP-023 requires AP-021 and AP-008/AP-019; AP-024 requires AP-019, AP-021, and AP-023; AP-025
requires AP-017 (`specs/018-test-execution-results`), `specs/017-session-workflow-isolation`, and
AP-004. See each feature's own Feature Decomposition section above for detail.

AP-026 through AP-028 are likewise omitted from the main pipeline. AP-026 requires AP-017 and
AP-025; AP-027 is presentation-only and depends on no backend feature; AP-028 requires AP-026 and
AP-027.

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
AP-017  Test Execution & Results
AP-018  AI Failure Analysis
```

AP-011 through AP-016, and AP-019 through AP-028 (hardening/extension features layered onto
AP-004/AP-005/AP-007/AP-008/AP-009/AP-017, plus the standalone collection import, design system,
and collection editor), are also outside the formal MVP boundary above, but — unlike AP-018 — all
sixteen are already implemented; see the Implementation Status table.

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
   AP-011 (Bounded AI Prompt Batching) — see the Implementation Status table above.
5. ~~Run the complete Spec Kit lifecycle for AP-001 before moving to AP-002.~~ Done for
   AP-001–AP-011.
6. ~~Complete AP-012 (AI Enhancement Progress Visibility): run `/speckit-tasks` →
   `/speckit-analyze` → `/speckit-implement` → `/speckit-converge` (spec and plan are already
   done).~~ Tasks, analysis, and implementation are done (`npm test`, `npm run lint`,
   `npm run build` all pass) — see the Implementation Status table above. Run
   `/speckit-converge` next; the one outstanding item is the optional manual real-model UI
   validation step in `specs/012-ai-enhancement-progress/quickstart.md`.
7. ~~During AP-004 `/speckit.plan`, evaluate and select the initial local AI model using
   representative ApiPilot workloads rather than assuming a model in advance.~~ Done — see
   `specs/004-ai-provider-local-inference/` and `npm run ai:benchmark -w backend`.
8. Address the outstanding follow-up tasks noted in the Implementation Status table above
   (AP-001, AP-004, AP-005, AP-007, AP-012, AP-013, AP-014) where practical, or explicitly defer
   them with a documented reason if they remain out of scope.
9. Do not begin AP-017 (Test Execution & Results) or AP-018 (AI Failure Analysis) — both
   post-MVP — until the full MVP boundary (AP-001 through AP-010) has been validated
   end-to-end against a real specification, per the MVP Boundary section above.
   **2026-09-11: CLOSED for the PayPal Invoicing API v2 spec** — see Next Actions #10 (the
   blocking defect found) and #11 (the fix and the confirming passing rerun). AP-017 speccing
   may proceed. A second real-world spec pass (`swagger.yaml`, FST.BE, 69 operations) is recorded
   separately as an additional data point (Next Actions #12).
10. **End-to-end MVP validation pass attempted against a real specification (2026-09-11) —
    blocked by a genuine defect, gate remains open.** Ran the complete guided AP-009 journey
    (upload → analyze → API review → deterministic generation → AI enhancement → scenario
    review → dependency analysis → workflow review → Postman generation → download) through
    the actual running backend against PayPal's official public Invoicing API v2 specification
    (22 operations, OpenAPI 3.0.3, no external `$ref`s — chosen because no real-world-scale spec
    was already available in-repo; the "51 operations / 371 scenarios / 8 workflows" pass cited
    in AP-010's spec has no recorded artifact and could not be reused). Every stage completed
    without a runtime error and produced a structurally valid Postman collection, environment,
    and README — but the run surfaced a genuine, previously-undiscovered defect rather than
    validating the MVP:
    - **Deterministic generation produced 0 scenarios for all 22 operations** (AP-003).
      Root cause: `hasBlockingIssue` in `backend/src/testDesign/generateTestModel.ts` (~line
      31-38) skips scenario generation for an entire operation whenever *any*
      `unsupported-construct`/`unresolved-ref` analysis issue's location string starts with
      that operation's path prefix — including issues found deep in a *response* schema
      unrelated to the operation's own parameters. Real-world specs commonly compose schemas
      with `allOf` (flagged as unsupported per constitution/FR-013), so on this spec every
      operation picked up at least one such issue and none of AP-003's rule modules ever ran —
      including for operations with plain, non-`allOf` path parameters. This is a
      **construct-vs-operation-level scoping bug**, not the accepted behavior: AP-003's FR-018
      (`specs/003-deterministic-test-designer/spec.md`) specifies skipping generation "for that
      construct", not for the whole operation. A secondary, lower-severity gap was also found:
      `extractSchemaConstraint` (`backend/src/openapi/buildApiModel.ts` ~line 34-68) drops
      rather than merges `allOf` branches, which would still legitimately limit (not fabricate)
      scenarios for the specific composed fields once the primary bug is fixed.
    - **Knock-on effect**: with a 0-scenario deterministic baseline, AI enhancement
      (AP-005/011/012/013/014) ran all 22 batches without error over ~7 minutes on the local
      Qwen2.5-0.5B model (including one real per-request TIMEOUT that correctly retried and
      succeeded — good evidence AP-013/014's retry/partial-outcome mechanics work under real
      load) but retained only **1 net scenario out of 22 operations** (`addedCount:1,
      rejectedCount:2, totalBatches:22`). Dependency analysis then correctly found 0
      relationships/workflows from a single scenario. The mechanical pipeline is sound, but the
      resulting test suite (1 scenario for a 22-operation API) does not meet the MVP's
      qualitative bar of a meaningful generated baseline.
    - **Recommendation before re-attempting this gate**: fix the `hasBlockingIssue`
      construct-vs-operation scoping defect first (highest priority — it silently voids AP-003's
      core deterministic guarantee on any real spec using `allOf`, independent of AI quality),
      then re-run this same validation pass and assess AI-enhancement yield separately
      once a non-empty deterministic baseline exists.
    - Validation driver scripts and captured output are session-scratch artifacts, not
      committed to the repository; this entry is the durable record.
11. **Fix applied and gate re-validated as passing (2026-09-11).** Two genuine defects
    surfaced by Next Actions #10 were fixed, each with new regression tests, the full backend
    suite (654 tests), lint, and build all passing:
    - `hasBlockingIssue` removed entirely from `backend/src/testDesign/generateTestModel.ts`.
      `buildApiModel.ts`'s schema extraction already degrades an unresolved/unsupported schema
      node to an empty constraint (`{required: [], properties: {}}`) rather than fabricating
      one, so removing the operation-wide check lets every rule naturally skip only the
      affected construct (FR-018) while still generating scenarios for the rest of the
      operation — no replacement blocking logic was needed.
    - A second, previously-masked defect surfaced once real scenario generation actually ran
      against this spec's parameters: `backend/src/testDesign/valueGenerators.ts`'s
      `stringBoundaryValues`/`arrayBoundaryValues` built exact-length boundary values directly
      from declared `maxLength`/`maxItems` — and this spec (like other real-world APIs)
      declares several of these as literally `2147483647` (INT32_MAX) as an "effectively
      unbounded" placeholder, which crashed `String.repeat`/`Array.from` with a `RangeError`.
      Fixed by capping generation at a safe practical length/count and omitting (not
      fabricating a smaller, misleadingly-labeled) that specific boundary variant when the
      declared bound is unrealistic.
    - **Confirming rerun, same PayPal Invoicing API v2 spec (22 operations)**: deterministic
      generation now produces **806 scenarios** (was 0); AI enhancement settles `partial`
      (`addedCount:1, rejectedCount:5`, one batch failed with a genuine `INVALID_RESPONSE` from
      the local model — expected real-model behavior, not a bug) for **807 total scenarios**;
      dependency analysis finds **2 relationships/workflows**; all 807 scenarios reviewed,
      approved, and exported to a valid Postman collection (807 requests across 5 folders),
      environment, and README. Full pipeline traversal confirmed end-to-end at real-world scale.
    - The MVP end-to-end validation gate (Next Actions #9) is now CLOSED for this specification.
      AP-017 speccing may proceed.
12. **Second real-world validation pass — `swagger.yaml` (FST.BE, OpenAPI 3.0.1, 57 paths / 69
    operations, user-supplied, untracked in the repo) — passed cleanly, no new defects.** Run as
    an additional real-world data point after #11's fix, at roughly 3x the operation count of
    the PayPal spec. Deterministic generation produced **691 scenarios** with no crash (the
    `valueGenerators.ts` safety caps were not even triggered here — this spec did not use the
    INT32_MAX-placeholder pattern PayPal's did, but the earlier crash risk remains real for any
    spec that does). AI enhancement settled `success` (`addedCount:1, rejectedCount:15,
    totalBatches:69, notAttemptedCount:0`) for **692 total scenarios**; dependency analysis
    found **37 relationships/workflows** (this spec's much larger, more interconnected resource
    model, vs. PayPal's 2); all 692 scenarios reviewed and approved; Postman generation produced
    **739 requests across 55 folders**, with **37 workflows fully rendered as ordered sequences**
    (0 unsupported, vs. PayPal's 2/2 unsupported) — a stronger confirmation of AP-016's
    workflow-aware export than the PayPal run gave. One scaling observation, not a defect:
    bulk-accepting ~700-800 individual review decisions and dependency analysis over 69
    operations both took on the order of 1-2 minutes each — worth keeping an eye on if a much
    larger specification is validated in the future, but well within this run's practical
    bounds.
13. **AP-017 (Test Execution & Results) implemented end-to-end (2026-09-11).** Full Spec Kit
    lifecycle completed (`specs/018-test-execution-results`): spec → clarify → plan → tasks →
    implement, all 49 tasks in `tasks.md` marked done.
    - **Design**: reuses the existing, already-deterministic `generateCollection()` (AP-007)
      populated with a session-scoped `Environment`'s real `baseUrl`/`variableValues`, executed
      one request at a time through `newman` (the standard Postman collection runner) under a new
      `backend/src/execution/` orchestration loop — never a hand-rolled HTTP/assertion engine.
      See `specs/018-test-execution-results/research.md` for the six recorded decisions,
      including a mid-implementation correction (D2 addendum): Newman's Node API does not expose
      `pm.collectionVariables.set(...)` mutations back to the caller between per-item
      invocations, discovered empirically via throwaway probes — AP-016's workflow-handoff
      extraction script was switched from `pm.collectionVariables.set` to `pm.environment.set`
      (`backend/src/postman/assertionScripts.ts`), which Newman *does* expose via
      `summary.environment`, with no change to any documented contract and no regression in
      either module's existing test suite.
    - **New capability**: `Environment` definitions (tier, base URL, variable values, pacing) and
      `ExecutionRun` history are session-scoped, sibling stores to the guided workflow (not a
      10th `WorkflowStageId` — runs are repeatable, the workflow's stages are not). New routes:
      `GET/POST /environments`, `PUT /environments/:id`, `POST /execution/start` (fire-and-poll,
      never blocks on the whole run), `POST /execution/cancel`, `GET /execution/runs`,
      `GET /execution/runs/:runId`. Failure categorization
      (`assertion-failed`/`unexpected-status`/`connectivity-failure`/`timeout`/
      `could-not-evaluate`) is derived from Newman's own per-item result shape and the stable
      `pm.test` names `assertionScripts.ts` already assigns — verified empirically against a real
      Newman run (connection refused, timeout, schema mismatch, non-JSON body) before being
      encoded in `mapNewmanResult.ts`. Destructive (`POST`/`PUT`/`PATCH`/`DELETE`) or
      Staging/Production runs require an explicit `confirmed: true` resubmission; only one run may
      be in progress per session; cancellation lets the in-flight request finish and marks every
      remaining item `not-attempted`/`"cancelled"`.
    - **Validation**: 49 new backend tests (unit + Supertest integration against a local Express
      fixture target, per constitution XXI — no test depends on real external network access) and
      10 new frontend RTL tests, all passing; full repository suite **885 tests passing** (2
      pre-existing skips, unrelated), `npm run lint` and `npm run build` clean across all
      workspaces. A genuine end-to-end walkthrough of every scenario in
      `specs/018-test-execution-results/quickstart.md` was then run against the actual dev
      backend (`npm run dev`), the real local AI provider (Qwen2.5-0.5B, not mocked), and a real
      local target HTTP server: the guided workflow reached `postmanGeneration` complete (26
      scenarios; AI enhancement genuinely completed in ~31s), a run against a reachable target
      executed all 26 requests for real (19 passed / 7 failed on this deliberately simplistic
      target — a real, non-fabricated mixed result) with the summary counts matching
      `results.length`; stopping the target and re-running produced `connectivity-failure` for
      every request, never `assertion-failed`; an environment missing a declared variable was
      refused with `400 missing_variable_values` naming it; a Staging-tier environment was refused
      with `409 confirmation_required` naming the tier and its one destructive operation; and
      `GET .../execution/runs` correctly listed both completed runs. Cancellation mid-flight was
      not re-run manually here since it is already covered by a real-timing automated integration
      test (start a run with a configured request delay, cancel mid-run, confirm the in-flight
      request keeps its real outcome and every remaining item is recorded
      `not-attempted`/`"cancelled"`).
    - **Known limitation, honestly recorded**: the new frontend components
      (`EnvironmentForm.tsx`, `ExecutionResultsPanel.tsx`) were verified via React Testing Library
      component tests (real rendering, real user interaction, real state transitions) and a
      passing TypeScript build, but **not** via a live browser session — no browser-automation
      tool was available in this session. This is a real, un-closed gap in visual/interactive
      verification, not a claim of full UI validation.
14. **AP-019 through AP-025 implemented (2026-09-11 through 2026-09-16), closing gaps found by
    exercising AP-017 against real specifications, plus one durability gap.** Each ran the full
    Spec Kit lifecycle independently; see the Implementation Status table and each feature's own
    Feature Decomposition section above for scope. In short: AP-021 (distinct credential
    variables), AP-022 (OpenAPI-conformant parameter serialization), and AP-024 (OAuth2
    client-credentials support) each fix a Postman-export defect a real specification actually
    triggered; AP-019 and AP-023 extend AP-008's dependency-chaining engine so fewer exports need
    manual workflow assembly; AP-020 (frontend application logging) closes an unrelated
    backend/frontend logging-infrastructure gap; and AP-025 (local persistence layer) adds a
    SQLite-backed durability layer for environments, execution run history, and AI
    readiness/benchmark diagnostics, superseding this roadmap's and the project's other
    documentation's earlier blanket "in-memory only" claims for that data — guided-workflow
    generation progress itself remains in-memory only, unaffected.
15. **README.md, docs/architecture.md, and docs/USER_MANUAL.md brought into sync with AP-019
    through AP-025 (2026-09-16)**, correcting the persistence-related claims AP-025 changed and
    adding the six export/logging features to each document's capability/feature listings.
16. **AP-026 (External Postman Collection Import & Execution) implemented (2026-09-20)**, run
    through the full Spec Kit lifecycle (`/speckit-specify` → two `/speckit-clarify` passes →
    `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`). Analysis
    caught two real design defects before implementation: reusing `postmanArtifact.ts`'s
    generator-only Postman item types for arbitrary uploaded content (which cannot represent a
    pre-request script or a non-`"raw"` body mode at all), and a tasks.md draft that would have
    added a `source` field to the already-shipped `ExecutionRun` type in direct contradiction of
    the plan's own data-model.md — both were corrected before implementation began rather than
    discovered mid-build. Required a narrow, explicit amendment to constitution XVII (Security and
    Privacy by Design) to permit executing an uploaded collection's own scripts inside Newman's
    existing sandbox, resolved via the constitution's documented conflict-resolution procedure
    (amend, not silently bypass). All 46 implementation tasks completed; the full repository
    suite (1225 tests, 2 pre-existing skips) passes, along with `npm run lint` and `npm run build`
    across all four workspaces. One task (a manual browser walkthrough of quickstart.md) was
    explicitly not performed — no browser tool was available in the implementing session — and is
    recorded as such in tasks.md rather than claimed complete; every quickstart scenario is
    instead covered by a real Supertest-driven integration test against the actual Express app,
    SQLite, and Newman. One real, narrow limitation was discovered and documented rather than
    silently patched: a variable an uploaded collection's own pre-request script sets at runtime
    is not distinguished from a genuinely missing one if also referenced statically elsewhere in
    the same request.
17. **README.md, docs/architecture.md, and docs/USER_MANUAL.md brought into sync with AP-026
    (2026-09-20)**, adding the standalone import/execution capability, its API routes, its module
    boundary, and its one documented limitation to each document's capability/feature listings —
    mirroring how Next Action #15 synced the same three documents for AP-019 through AP-025.
18. **AP-027 (Frontend Design System & Application Shell) implemented (2026-09-21)**, all 57 tasks
    complete. Adds Tailwind v4 `@theme` design tokens for light and dark mode, a persisted manual
    theme toggle keyed off a `data-theme` attribute, a shared component library (status,
    HTTP-method, and provenance badges; dialogs; tabs; empty/error/loading states), and one
    reusable workflow stage tracker, with no backend contract or workflow-rule change (FR-012).
19. **AP-028 (Postman-Style Collection & Variable Editor) implemented for uploaded collections
    (2026-09-21 to 2026-09-22)**, 71 of 72 tasks complete. A post-implementation addendum added
    request test-script editing, selective run (`selectedRequestIds` on AP-026's
    `execution/start`), a tabbed editor layout, and folder creation. Of the 14 usability issues in
    `specs/028-collection-editor-ui/ui-bugfix-tracker.md`, 13 are recorded as resolved and #6
    (run summary readability) as partially resolved. Open items:
    - T050, a documentation-only cross-reference from `specs/018` to this feature.
    - FR-008 names ApiPilot-generated collections handed to execution as well as uploaded ones.
      The editor is mounted only in `ExternalCollectionsPage.tsx`. Since #20's execution hand-off,
      a generated collection reaches it by being uploaded; the spec should either record that as
      satisfying FR-008 or keep the gap open.
    Both items were closed on 2026-09-23 (#22).
20. **Workflow and execution amendments (2026-09-21 to 2026-09-23)**, each with regression tests:
    - AP-009, API review operation selection (spec Clarifications 2026-09-23): the user checks the
      operations to test; `selectedOperationKeys` scopes deterministic generation, AI enhancement,
      and single-batch retry, while the stored `apiModel` stays unnarrowed. Absent or empty keeps
      every operation for existing API clients; unknown keys return `400 unknown_operation_key`.
    - AP-009, execution hand-off (commit `37d30b3`, 2026-09-21): continuing from Postman
      generation pre-fills the "Import & Run Collection" upload form with the generated collection
      and environment instead of running it inside the guided workflow. The operator still picks a
      tier and submits. The guided workflow's specs/018 environment and execution routes remain
      mounted but have no UI caller, and `EnvironmentForm.tsx`/`ExecutionResultsPanel.tsx` are no
      longer rendered by any page. This was governance drift until 2026-09-23, when `specs/009`
      and `specs/018` gained clarifications for it (#22).
    - AP-009, scenario review finalize lock: decisions, edits, and regeneration are refused while
      a finalize's dependency analysis is in flight, and the UI disables review controls for that
      window.
    - AP-007, resource-qualified path-parameter variables (spec Clarifications 2026-09-23):
      `/users/{id}` → `{{user_id}}`.
    - AP-026/AP-028, FR-004/FR-006 superseded: an unresolved variable no longer refuses an
      uploaded-collection run, and the environment Newman returns after each request is written
      back to the collection's stored values. This retires the script-set-variable limitation
      recorded in #16.
    - AP-028, display-only implied auth headers (`ImpliedAuthHeader`) for `bearer` and
      header-located `apikey`, and a security-requirement note in scenario review detail.
    - Guided workflow resume: after "Back to start", reselecting "Guided Workflow" shows the
      workflow instead of immediately repeating the hand-off.
21. **README.md, docs/architecture.md, and docs/USER_MANUAL.md brought into sync with AP-027,
    AP-028, and #20 (2026-09-23).** Also corrected earlier inaccuracies: the documents described
    AP-028 edits as an override layered on the original request (research.md D4 mutates the
    stored uploaded copy in place, with an `_apipilotEdited` marker), described a guided-workflow
    Run & Results panel that the hand-off replaced, and cited a `vercel.json` that no longer
    exists. The full repository suite passed at this point: 1407 tests passed, 2 skipped, across
    204 test files.22. **Spec drift from #19 and #20 resolved through clarifications (2026-09-23).** Documentation
    and specification only; no code changed.
    - `specs/009` (Clarifications 2026-09-23, FR-001 note, superseded Assumptions entry): the
      `execution` stage hands a generated collection off to "Import & Run Collection" with its
      upload form pre-filled, and never uploads, confirms, or runs anything on the user's behalf.
    - `specs/018` (Clarifications 2026-09-23, `contracts/execution-api.md` note): its environment
      and execution endpoints are retained as an API-only path with unchanged contracts. Its
      second clarification is the cross-reference to `specs/028` (closing `specs/028` T050).
    - `specs/028` (Clarifications 2026-09-23, FR-008 rewritten): the hand-off satisfies FR-008, as
      research.md D1 already assumed, so no second editor over `specs/018`'s endpoints is built.
    - Remaining follow-up at that point: remove `EnvironmentForm.tsx` and
      `ExecutionResultsPanel.tsx` (no page renders them) and their tests. The execution stage's
      `skip`/`finish` endpoints also had no UI caller and no entry in any contract. `specs/028`
      FR-009/FR-009a still described variable edits saved into `Environment.variableValues` and
      request edits as a layered override, whereas research.md D4 and the code store both on the
      `UploadedCollectionSet` in place. All three were closed by #23.
23. **Follow-ups from #22 closed (2026-09-23).**
    - Removed the unrendered specs/018 frontend: `EnvironmentForm.tsx`, `ExecutionResultsPanel.tsx`,
      the frontend `executionClient.ts` that only they used, the three matching unit-test files,
      and the unused `skipExecutionStage`/`finishExecutionStage` client functions. Every backend
      endpoint is unchanged and still covered by backend tests (`specs/018` Clarifications
      2026-09-23 updated).
    - Documented `POST /execution/skip` and `/execution/finish` in `specs/009`'s
      `contracts/test-generation-workflow-api.md`, as API-only endpoints matching the existing
      implementation and its integration tests.
    - `specs/028` Clarifications 2026-09-23 (second entry): FR-009/FR-009a reworded to the in-place
      design research.md D4 chose. Edits are saved on the `UploadedCollectionSet` and marked for
      FR-011, and generated `TestScenario` provenance is untouched because the edited collection
      is a downstream copy.
    - Validation after the removal: `npm run lint` and `npm run build` clean; `npm test` 1392
      passed, 2 skipped, across 201 test files (down from 1407/204 by exactly the removed files).
