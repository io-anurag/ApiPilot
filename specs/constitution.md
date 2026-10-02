<!--
Sync Impact Report
==================
Version change: 2.7.0 → 2.8.0 (minor: XVII's 2026-09-24 exception extended to AP-037)

Trigger: the governance prerequisite for AP-037 (Request-Chain Performance Plans;
specs/037-request-chain-performance, Governance and Clarifications 2026-10-02). AP-037 replaces
the derived AP-029, AP-032, AP-033 and AP-036 performance plans, in phases, with a request-chain
plan whose steps the user owns, seeded once and never re-derived, with saved plans and CSV data
sets. The exception names its plans by feature and MUST NOT be cited for other content. Its
meanings of "approved" (a derived plan, a reviewed AP-032 plan, a reviewed AP-036 conversion) do
not fit a plan the user authors. Its conditions route every value through the run's environment,
which a data set does not use.

Bump reasoning: the old plans keep running until AP-037's second phase retires them, so their
meanings and conditions are left unchanged and request-chain plans are added beside them with one
self-contained set of conditions. This is materially expanded guidance (MINOR). No existing
principle or exception is removed or redefined. The user's request to consolidate the k6
exceptions is met for request-chain plans now. Removing the legacy paragraphs is deferred to the
amendment that accompanies AP-037's retirement phase (see Deferred TODOs).

Added principles: none.
Modified principles:
  - XVII. Security and Privacy by Design: the 2026-09-24 exception now also covers AP-037. For a
    request-chain plan, "approved" means the user reviewed the plan at the run trigger, which
    lists every chain and its step count, every write step, every host and every data set, and
    then triggered the run. The paragraphs on AP-032, user-edited inputs and AP-036 do not apply
    to it. Every first-list condition applies, except that data set values have one added route.
    In addition: seeding never executes, evaluates or sends anything, and reads scripts only as
    text against enumerated forms; step content, statuses, extractors and checks are written only
    as data for the one fixed runtime, with no expression, pattern, filter or function; dynamic
    variables come from ApiPilot's own code for a fixed list; no environment value, data set value
    or literal credential reaches the plan, script or template, and literal credentials become
    secret environment values; extracted values stay in virtual-user memory; data set values are
    encrypted at rest and reach k6 only at run time, through the environment or a per-run copy
    read by a fixed name and removed afterwards, with no other file read and no script bytes
    depending on the content; requests go only to the base URL and literal hosts, each listed,
    and a host from another variable is refused; the plan, snapshot and report name each step's
    seed source or that the user added it, mark changed steps, and state that the content is the
    user's and unverified, with no content or value; saved plans are local, session-owned,
    secret-free and never logged, sent to AI or produced by AI. The closing exclusion paragraph
    and the rationale record the reasoning. The 2026-09-20 and 2026-09-30 exceptions are
    unchanged.
Removed principles: none.
Removed sections: none.
Deferred TODOs:
  - TODO(XVII_LEGACY_PLAN_TEXT): when AP-037's second phase (FR-036) retires the AP-029, AP-032,
    AP-033 and AP-036 plan models, amend XVII to remove their paragraphs and meanings of
    "approved", leaving request-chain plans as the one k6 plan rule. Removing guidance is
    expected to be a MAJOR bump.
  - The enumerated check forms, statement forms and dynamic-variable list stay in the feature's
    specification and plan by design.

Mirror: specs/constitution.md, the manually maintained copy, was resynced to this version in
the same change.

------------------------------------------------------------------------------------------------

Sync Impact Report (previous amendment)
==================
Version change: 2.6.0 → 2.7.0 (minor: XVII's 2026-09-24 exception extended to AP-036)

Trigger: the governance prerequisite for AP-036 (Performance Test from a Postman Collection;
specs/036-collection-performance-test, Clarifications 2026-10-02). AP-036 builds a Performance
Plan from a Postman collection stored in Import & Run Collection and runs the k6 script ApiPilot
generates from it. The 2026-09-24 exception names AP-029 and AP-032, whose plans ApiPilot derives
from a TestModel or a specification, and MUST NOT be cited for other content. A plan whose
requests the user authored is not covered. The user chose a performance plan over handing a
converted script to Run k6 Script under the 2026-09-30 exception (2026-10-02). The extension widens
which plans the exception covers and adds conditions for them, which is materially expanded
guidance (MINOR); no existing principle or exception is removed or redefined.

Added principles: none.
Modified principles:
  - XVII. Security and Privacy by Design: the 2026-09-24 exception now also covers AP-036. For an
    AP-036 plan, "approved" means the user reviewed the plan's conversion (every request and its
    source, every captured value and its script line, every request left out and statement not
    converted, every write and every host, on the plan and at the run trigger) and then triggered
    the run. Every existing condition applies unchanged, and in addition: building the plan never
    executes the collection's scripts, evaluates their expressions or sends a request, and reads
    them only as text against forms the specification enumerates; collection request content is
    written only as data, and dynamic variables are produced by ApiPilot's own code for a fixed
    list; no variable value or literal credential reaches the script; requests go only to the base
    URL and to hosts written in the collection, each listed; the plan, snapshot and report name the
    collection, state its requests were not generated or verified by ApiPilot, and record each
    captured value's source without any value; a rebuilt plan needs a new review. The collection's
    scripts are never executed under this exception, only under the 2026-09-20 exception. The
    introductory sentence now says the conditions apply to every feature the exception covers.
    The rationale records the reasoning. The 2026-09-20 and 2026-09-30 exceptions are unchanged.
Removed principles: none.
Removed sections: none.
Deferred TODOs: none. The recognised statement forms and the dynamic-variable list are left to the
feature's specification and plan by design.

Mirror: specs/constitution.md, the manually maintained copy, was resynced to this version in
the same change.

------------------------------------------------------------------------------------------------

Sync Impact Report (previous amendment)
==================
Version change: 2.5.0 → 2.6.0 (minor: XVII gains a narrow exception for user-supplied k6 scripts)

Trigger: the user asked to "upload a k6 script & configure & run" (2026-09-30). The 2026-09-24
exception covers only a script ApiPilot generated, byte-identical, and states that "a script that
was uploaded, imported, pasted or edited by a user … is never executed under this exception"; it
MUST NOT be cited for other content. Running a user's script therefore needs its own exception,
made before that feature's `/speckit-specify`, on the footing of the 2026-09-20 exception for
externally-authored Postman collections. A new exception is materially expanded guidance (MINOR);
no existing principle or exception is removed or redefined.

Decisions (the user's, 2026-09-30): a confirmation per script content, bound to its SHA-256 and
asked again on any change; a single file importing only allowlisted k6 built-in modules, with
remote and file imports, `open()` of local files and extension modules refused; every host found
in the script listed at the confirmation and at the run trigger, with a statement that ApiPilot
cannot restrict where the script sends requests; and an in-app script editor, whose saved edits
count as new content needing a new confirmation.

Added principles: none.
Modified principles:
  - XVII. Security and Privacy by Design: adds the 2026-09-30 exception. A user-supplied k6
    script MAY run only when: it is one file of allowlisted k6 built-ins, checked before it is
    stored; the user confirmed its exact bytes, with the hosts it contains and the statement that
    they cannot be restricted; the executed bytes are the confirmed bytes, never rewritten, with
    configuration passed only as k6 options and environment variables; each run is the user's
    explicit trigger naming the target and repeating the hosts, never automatic; the k6 binary is
    the user's, with local outputs only; the script is kept locally, never logged and never sent
    to or produced by AI; and the run and report state that the script was user-supplied. A
    generated script that the user changes and supplies again falls under this exception, not
    the 2026-09-24 one. The rationale records the reasoning. The 2026-09-20 and 2026-09-24
    exceptions are unchanged.
Removed principles: none.
Removed sections: none.
Deferred TODOs: none. The module allowlist is left to the feature's specification by design.

Mirror: specs/constitution.md, the manually maintained copy, was resynced to this version in
the same change.

------------------------------------------------------------------------------------------------

Sync Impact Report (previous amendment)
==================
Version change: 2.4.0 → 2.5.0 (minor: XVII's 2026-09-24 exception covers user-edited plan inputs)

Trigger: the governance prerequisite for AP-033 (Edit a Performance Step's Request Body;
specs/033-edit-step-request-body, Clarifications 2026-09-29). AP-033 lets the user edit the
request body a performance step sends, and the generated k6 script sends the edited body. The
exception covers "a k6 script that ApiPilot generated deterministically from a Performance Plan
the user approved" and excludes a script "edited by a user"; whether a user-edited plan input
falls on the permitted side was left to interpretation. The user chose an explicit amendment
before AP-033's `/speckit-plan`, as was done for AP-029 and AP-032, over reading the wording as
already covering it. The amendment adds conditions that apply to user-edited plan inputs, which
is materially expanded guidance (MINOR), not a wording fix.

Added principles: none.
Modified principles:
  - XVII. Security and Privacy by Design: the 2026-09-24 exception now states that plan inputs
    the user edits in the plan, including a step's request body (AP-033), are part of the
    approved plan and not an edit to the script. Such a script is covered only when every
    existing condition holds and, in addition: user-edited content is written into the script
    only as data, never as code; it carries no secret value (secrets only as references resolved
    from the run's environment, and a literal value in a `format: password` field is refused);
    and the plan, run snapshot and report mark which steps carry user-edited content without
    containing it. Editing the generated script itself, or supplying script code in a plan input,
    stays excluded. The rationale records the reason. The 2026-09-20 exception is unchanged.
Removed principles: none.
Removed sections: none.
Deferred TODOs: none.

Mirror: specs/constitution.md, the manually maintained copy, was resynced to this version in
the same change.

------------------------------------------------------------------------------------------------

Sync Impact Report (previous amendment)
==================
Version change: 2.3.0 → 2.4.0 (minor: XVII's 2026-09-24 exception extended to AP-032)

Trigger: the governance prerequisite for AP-032 (Quick Performance Test from a Specification;
specs/032-quick-performance-test, Clarifications 2026-09-27). AP-032 builds an AP-029 Performance
Plan directly from an uploaded specification, with generated positive scenarios and no scenario
review, and runs its generated k6 script. The 2026-09-24 exception names AP-029 only and MUST NOT
be cited for other content, so relying on its wording ("a Performance Plan the user approved")
was rejected in favour of an explicit amendment before AP-032's `/speckit-plan`, as was done for
AP-029. The extension widens which plans the exception covers, which is materially expanded
guidance (MINOR), not a wording fix.

Added principles: none.
Modified principles:
  - XVII. Security and Privacy by Design: the 2026-09-24 exception now also covers AP-032. For an
    AP-032 plan, "approved" means the user reviewed the plan, with every write operation it will
    send listed on the plan and at the run trigger (specs/032 FR-009, FR-011), and then triggered
    the run. Every existing condition applies unchanged (per-run trigger naming the target,
    byte-identical generated script, user-installed k6, no secrets, local-only results and no AI,
    statement of where load comes from). Adds that the uploaded specification an AP-032 plan is
    derived from is never itself executed. The rationale records that AP-032 lacks scenario review
    (XI) and rests on write-operation visibility instead. The 2026-09-20 exception is unchanged.
Removed principles: none.
Removed sections: none.
Deferred TODOs: none.

Mirror: specs/constitution.md, the manually maintained copy, was resynced to this version in
the same change.

------------------------------------------------------------------------------------------------

Sync Impact Report (previous amendment)
==================
Version change: 2.2.0 → 2.3.0 (minor: a second narrow, explicit exception added to XVII)

Trigger: the governance prerequisite for AP-029 (k6 Performance Testing; specs/ROADMAP.md,
"AP-029 — Governance prerequisite" and Next Actions #24). AP-029 requires ApiPilot to run the
k6 script it generates when the user triggers the run from within ApiPilot (decision
2026-09-23); leaving the run to the user outside ApiPilot was rejected. Read literally, that
conflicts with XVII's "avoid executing ... generated scripts on the server", and the 2026-09-20
exception is limited to specs/026 and MUST NOT be cited for other content. Per Governance's
conflict-resolution procedure, resolved by a second explicit amendment before AP-029's
`/speckit-plan`, rather than a plan-level carve-out.

Added principles: none.
Modified principles:
  - XVII. Security and Privacy by Design — added a second narrow, explicit exception: ApiPilot
    MAY execute a k6 script it generated deterministically from a user-approved Performance
    Plan, only on the user's explicit action within ApiPilot for that run, unchanged from the
    generated bytes, with a user-installed k6 binary that ApiPilot does not bundle, download or
    install, with no secrets in the script (XVIII), with results kept on the local machine and
    no AI in generation, execution or reporting. It does not apply to AI output, uploaded
    specifications, uploaded, imported or user-edited scripts, or any other generated artifact,
    and MUST NOT be cited for any other content. The 2026-09-20 exception is unchanged.
Removed principles: none.
Removed sections: none.
Deferred TODOs: none.

Mirror: specs/constitution.md, the manually maintained copy, was resynced to this version in
the same change. It had been left at 2.1.1 and was missing the 2.2.0 amendment.

------------------------------------------------------------------------------------------------

Sync Impact Report (previous amendment)
==================
Version change: 2.1.1 → 2.2.0 (minor: narrow, explicit exception added to XVII)

Trigger: `/speckit-plan` for specs/026-external-collection-execution (standalone import and
execution of an externally-authored Postman collection/environment pair, deferred out of
specs/018-test-execution-results during that feature's Run & Results UI enhancement). That
feature's FR-008 requires executing an uploaded collection's own pre-request/test scripts with
full Newman/Postman fidelity (specs/026 Clarifications 2026-09-20), which read literally
conflicted with XVII's "avoid arbitrary code execution" and "avoid executing uploaded
specifications or generated scripts on the server." Per Governance's conflict-resolution
procedure, resolved by an explicit amendment rather than a silent plan-level carve-out.

Added principles: none.
Modified principles:
  - XVII. Security and Privacy by Design — added one narrow, explicit exception: a user-initiated
    feature that knowingly imports and runs an externally-authored Postman collection MAY execute
    that collection's own pre-request/test scripts inside the same sandboxed script engine
    Newman/Postman itself already uses, gated behind an explicit, per-artifact user confirmation
    naming that the scripts were not generated or verified by ApiPilot (specs/026 FR-007). Does
    not apply to ApiPilot-generated artifacts, AI output, or uploaded OpenAPI specifications, and
    MUST NOT be read as loosening the general rule for anything else.
Removed principles: none.
Removed sections: none.
Deferred TODOs: none.

------------------------------------------------------------------------------------------------

Sync Impact Report (previous amendment)
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

**Exception (2026-09-20 amendment)**: A user-initiated feature that knowingly imports and runs
an externally-authored Postman collection (specs/026-external-collection-execution) MAY execute
that collection's own pre-request/test scripts inside the same sandboxed script engine
Newman/Postman itself already uses. This exception applies only when execution is gated behind
an explicit, per-artifact user confirmation naming that the scripts were not generated or
verified by ApiPilot. It does not apply to ApiPilot-generated artifacts, AI output, or uploaded
OpenAPI specifications, and MUST NOT be cited to justify executing any other uploaded or
generated content elsewhere in the system.

**Exception (2026-09-24 amendment, extended 2026-09-27, 2026-09-29 and 2026-10-02 for AP-036 and
AP-037)**: A performance-testing feature (AP-029, k6 Performance Testing; AP-032, Quick Performance
Test from a Specification; AP-036, Performance Test from a Postman Collection; and AP-037,
Request-Chain Performance Plans) MAY execute a k6 script that
ApiPilot generated deterministically (XVI) from a Performance Plan the user approved, only when all
of the following hold. For AP-032, whose plan is built directly
from an uploaded specification with generated positive scenarios that no one reviewed,
"approved" means the user reviewed that plan, with every write operation it will send listed on the plan and at the run
trigger (specs/032-quick-performance-test FR-009, FR-011), and then triggered the run. For AP-036,
"approved" has the meaning and the added conditions stated below. The following conditions apply
to every feature this exception covers:
- the run starts only on the user's explicit action within ApiPilot for that run, and that
  action identifies the target environment by name, tier label and base URL. Generating a
  script never starts a run, and ApiPilot never starts or repeats one automatically, on a
  schedule, or as a retry;
- the script executed is byte-identical to the script ApiPilot generated. A script that was
  uploaded, imported, pasted or edited by a user, and any AI output, is never executed under
  this exception;
- execution uses a k6 binary the user installed. ApiPilot does not bundle, download or install
  it, and a missing or unusable binary is reported as an explicit failure;
- the script contains no secrets; credentials reach it only through the run's environment
  (XVIII);
- results stay on the local machine: no k6 Cloud, Grafana Cloud or other remote output, and no
  AI in script generation, execution or reporting;
- the user interface states that load is generated from the machine running the ApiPilot
  backend.

A Performance Plan's inputs that the user edits in the plan, including a request body edited
for one step (AP-033, specs/033-edit-step-request-body), are part of the plan the user approved,
not an edit to the script. A script generated from such a plan is still the script ApiPilot
generated, and falls under this exception only when every condition above holds and, in
addition:
- ApiPilot writes user-edited content into the script only as data, never as script code;
- user-edited content carries no secret value: secrets reach it only as references resolved from
  the run's environment (XVIII), and a literal value in a field the request schema declares
  sensitive (`format: password`) is refused before it is saved;
- the plan marks each step that carries user-edited content, and the run's snapshot and report
  record which steps did (XIII) without containing that content.

Editing the generated script itself, or supplying script code in any plan input, remains
excluded.

AP-036 (specs/036-collection-performance-test) builds its plan from a Postman collection the user
stored in ApiPilot, uploaded or handed off from the guided workflow. Its requests were therefore
authored or edited outside ApiPilot's generators. For AP-036, "approved" means two things. First,
the user reviewed the plan's conversion. It lists every request the plan sends and the collection
request it came from, every value captured from a response and the script line it came from, every
request left out, and every script statement not converted. Every write operation and every host
the plan sends to are listed on the plan and at the run trigger. Second, the user then triggered
the run. Every condition above applies unchanged, and in addition:
- building the plan never executes the collection's pre-request or test scripts, evaluates any
  expression in them, or sends any request. Scripts are read only as text, against a fixed set of
  statement forms that the feature's specification enumerates. Nothing in them reaches the
  generated script as code: a converted statement becomes only a variable name, a field path, a
  header name or an expected status code;
- the collection's request content (URLs, query parameters, headers and bodies) is written into the
  script only as data, never as code. Postman dynamic variables are produced by code ApiPilot
  writes, for a fixed list the specification defines, never by code taken from the collection;
- no variable value and no literal credential reaches the script. Every variable is an environment
  reference resolved at run time. A literal value in an auth field, or in an `Authorization`,
  `Proxy-Authorization` or `Cookie` header, becomes a secret environment value (XVIII);
- the script sends requests only to the target environment's base URL and to hosts written
  literally in the collection's requests, and the plan and the run trigger list each such host;
- the plan, the run's snapshot and the report identify the collection the plan came from. They
  state that its requests were not generated or verified by ApiPilot, name each step's source
  request, and record each captured value's source without containing any value (XIII);
- a plan rebuilt after its collection changes needs a new review before its script can be
  generated or run.

AP-037 (specs/037-request-chain-performance) replaces these derived plans, in phases, with a
request-chain plan. Such a plan holds chains of steps the user owns. Each step is a concrete
request with expected statuses, extractors, checks and a setting for how often it runs. A plan is
seeded once from a specification, from approved workflows or from a stored collection, or built
from nothing, and is never re-derived from its source. Whatever it was seeded from, every step is
content the user authored, which ApiPilot does not verify. Until AP-037's second phase retires
them, AP-029, AP-032, AP-033 and AP-036 plans keep the meanings and conditions above unchanged.
For a request-chain plan, the paragraphs above on AP-032, on user-edited plan inputs and on AP-036
do not apply. Instead, "approved" means the user reviewed the plan at the run trigger, which lists
every chain and its number of steps, every write step, every host the plan sends to and every data
set, and then triggered the run. Every condition in the first list above applies unchanged, except
that data set values may also reach the script by the route stated below, and in addition:
- seeding never executes a collection's pre-request or test scripts, evaluates any expression in
  them, or sends any request. Scripts are read only as text, against the fixed statement forms
  the specification enumerates;
- step content (URLs, query parameters, headers and bodies), expected statuses, extractors and
  checks are written into the script only as data that ApiPilot's one fixed runtime interprets,
  never as code. An extractor is only a name with a field path or a header name. A check is only
  one of the forms the feature's specification enumerates. No expression, pattern, filter or
  function is accepted. Dynamic variables are produced by code ApiPilot writes, for a fixed list
  the specification defines;
- no environment value, data set value or literal credential reaches the plan, the script or the
  environment template. A literal value in an `Authorization`, `Proxy-Authorization` or `Cookie`
  header, or in a field the request schema declares sensitive (`format: password`), becomes a
  secret environment value when the step is saved, and the step keeps only the reference (XVIII);
- values extracted during a run exist only in the virtual user's memory during that run. They are
  never stored, shown, logged or reported;
- data set values, from a CSV file the user uploads to the plan, are encrypted at rest with the
  same protection as environment values. They reach k6 only at run time, through the run's
  environment or through a copy that ApiPilot writes for that run alone. The script reads that
  copy by a fixed name ApiPilot chose, and ApiPilot removes the copy when the run ends. The script
  reads no other file, and its bytes do not depend on a data set's content;
- every step URL starts with the target environment's base URL or with a literal scheme and host.
  The script sends requests only to those hosts, and the plan and the run trigger list each one.
  A URL whose host comes from any other variable is refused before the script is generated;
- the plan, the run's snapshot and the report name each step's seed source, or state that the
  user added it, mark each step the user changed since seeding, and state that step content is
  authored by the user and not verified by ApiPilot. They contain no step content and no value
  (XIII);
- saved plans are kept locally, owned by the session and removed with it, hold no secret value,
  and are never logged, sent to AI or produced by AI.

This exception does not apply to AI output, uploaded OpenAPI specifications, uploaded, imported
or user-edited scripts, or any other generated artifact, and MUST NOT be cited to justify
executing any other content elsewhere in the system. A script generated from an AP-032 plan is
ApiPilot's own output; the uploaded specification it was derived from is never itself executed.
Likewise, a script generated from an AP-036 plan is ApiPilot's own output. The collection's own
scripts are never executed under this exception; they run only in Import & Run Collection, under
the 2026-09-20 exception. A script generated from a request-chain plan is also ApiPilot's own
output: the user's steps reach it only as data, and a data set reaches it only at run time.

**Exception (2026-09-30 amendment)**: A user-initiated performance-testing feature that knowingly
runs a k6 script the user supplies (uploaded, or written or edited in ApiPilot's script editor)
MAY execute that script with k6, only when all of the following hold:
- the script is a single file, and before it is stored ApiPilot checks that it imports only k6
  built-in modules on an allowlist the feature's specification defines, and refuses it otherwise
  with the reason. Remote URL imports, relative or absolute file imports, `open()` of local files,
  extension modules (`k6/x/…`), and any module that reaches the local filesystem, starts a
  process or starts a browser are never allowed;
- before its first run, the user explicitly confirms that exact content. The confirmation names
  that the script was not generated or verified by ApiPilot, lists every host ApiPilot finds in
  the script, and states that ApiPilot cannot restrict where the script sends requests. The
  confirmation is bound to the SHA-256 of the script's bytes; any change, whether a new upload or
  an edit saved in ApiPilot's editor, needs a new confirmation before the next run;
- the bytes executed are the confirmed bytes, checked at run start. ApiPilot never rewrites,
  wraps, injects into or appends to the script. Configuration the user sets in ApiPilot (load
  stages, virtual users, duration, thresholds, the target environment's base URL and values)
  reaches the script only as k6 command-line options and environment variables;
- the run starts only on the user's explicit action within ApiPilot for that run, and that
  action names the target environment by name, tier label and base URL and repeats the hosts
  found in the script. ApiPilot never starts or repeats a run automatically, on a schedule, or as
  a retry;
- execution uses a k6 binary the user installed, run with only ApiPilot's local outputs and no
  usage report; no k6 Cloud, Grafana Cloud or other remote output is ever passed. Results stay on
  the local machine;
- the script is treated as potentially sensitive: kept locally, owned by the session like other
  execution artifacts, never logged, and never sent to or produced by AI. The editor does not
  execute the script, and the user interface states that credentials belong in environment
  values, not in the script (XVIII), since ApiPilot cannot verify a user's script holds none;
- the run's record and report state that the script was supplied by the user and not generated
  by ApiPilot (XIII), identify it by its SHA-256, and report only k6's own metrics; the user
  interface states that load is generated from the machine running the ApiPilot backend.

A script ApiPilot generated that the user downloads, changes and supplies again is a
user-supplied script under this exception, never ApiPilot's output under the 2026-09-24
exception. This exception does not apply to AI output, uploaded OpenAPI specifications or any
other artifact, and MUST NOT be cited to justify executing any other content elsewhere in the
system.

**Rationale**: API specifications frequently describe proprietary or sensitive systems and
must be protected with the same rigor as any confidential customer data. The narrow exception
above exists because a QA engineer knowingly running their own already-trusted Postman
collection is a materially different, user-initiated act than the platform executing scripts of
its own generation or an uploaded specification — the explicit confirmation requirement keeps
that distinction visible rather than eroding the general rule. The 2026-09-24 exception rests on
a different footing: the script is ApiPilot's own deterministic output from a plan the user
reviewed, so what runs is known and reproducible. The conditions exist to keep it that way.
Executing only the unmodified generated bytes closes the path by which arbitrary content could
reach the runner, and the per-run trigger keeps load generation a deliberate human act. The
local-only and no-secrets conditions preserve the privacy boundary. The 2026-09-27 extension to
AP-032 keeps that footing: the script is still deterministic output from a plan the user
reviewed. What AP-032 lacks is scenario review (XI), so the extension rests on the plan making
every write operation visible before the run rather than on any loosened condition. The
2026-09-29 clarification for AP-033 keeps the same footing again: what the user edits is an input
to the plan they review, ApiPilot still generates every byte of the script, and writing edited
content only as data keeps arbitrary content from reaching the runner as code. Stating this
explicitly, rather than reading "edited by a user" as covering only the script, removes an
ambiguity the exception would otherwise carry into every future plan edit. The 2026-10-02
extension to AP-036 keeps the same footing for the script: ApiPilot still writes every byte of it,
deterministically, from a plan the user reviewed. What differs is the origin of the requests. They
come from a collection, so their author is the user, not ApiPilot's generators. The 2026-09-20
exception already accepts that position for a functional run of the same collection. The
extension also keeps out what that exception lets in: the collection's scripts, which a functional
run executes in Postman's sandbox, are never run here. A fixed recognizer turns a narrow set of
statements into data, and everything else is shown to the user rather than guessed (XIV, XIX).
Requests can reach hosts written literally in the collection, outside the target environment, so
listing them, as the 2026-09-30 exception does, keeps that risk visible to the person accepting
it. The second 2026-10-02 extension, for AP-037, keeps AP-036's footing: ApiPilot writes every
byte of the script, deterministically, from a plan the user reviewed, while the requests are the
user's. A request-chain plan is not re-derived from its source, so there is no conversion to
review again. Approval instead rests on the run trigger, which makes every chain, write, host and
data set visible before the run. Seeding inherits AP-036's rule that scripts are read only as text
and never run. Data sets add one route by which values enter a run, a file, and the conditions
narrow it: one copy per run, read by a fixed name, removed afterwards, with no other file read.
This lets ApiPilot's own runtime read its own data without opening file access to user-supplied
scripts, which the 2026-09-30 exception keeps closed. The 2026-09-30
exception returns to the footing of the 2026-09-20 one: a QA engineer knowingly running their
own script is a user-initiated act, not the platform executing content of its own generation.
Because ApiPilot cannot know what a user's script does, the conditions narrow what it can reach
instead: one file of allowlisted k6 built-ins closes local file access, process and browser
launch, extensions and remote code; binding the confirmation to the exact bytes means no edit
or re-upload runs unconfirmed; and listing hosts while stating plainly that they cannot be
restricted keeps the one remaining risk, where requests go, visible to the person accepting it.

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

**Version**: 2.8.0 | **Ratified**: 2026-08-26 | **Last Amended**: 2026-10-02
