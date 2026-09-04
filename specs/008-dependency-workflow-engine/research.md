# AP-008 Research

## Decision: Which evidence signals are actually computable from the current ApiModel

**Decision**: Implement deterministic evidence using exactly the signals `ApiModel` can supply today
— field name match, data type match, format match, resource/path relationship, and tag alignment —
plus AI semantic similarity from the AI-assisted pass. Do not implement schema-description
similarity or example-value matching as evidence in this feature.

**Rationale**: Constitution XV and spec FR-003 list description similarity and examples as
*illustrative* corroborating signals ("such as"), not a mandate to implement every one.
`packages/shared-domain/src/apiModel.ts` gives `Parameter` no `description` field and
`SchemaConstraint` no `description` or `example` field; only `Response.description` and
`Response.examples` exist, and both are attached to a status code, not to an individual field. There
is no field-level text or example to compare. Fabricating a similarity score from data that is not
actually there would violate constitution I/XIX (no invented evidence). If a future OpenAPI-engine
enhancement adds field-level descriptions or examples to `SchemaConstraint`, this evidence type can
be added to `DeterministicDependencyEvidence` without changing the relationship contract's shape.

**Alternatives considered**:

- Approximate "description similarity" using the operation-level `Response.description`: rejected
  because it describes the response as a whole, not the specific field being matched, so scoring it
  as field-level evidence would misrepresent what was actually compared.

## Decision: Confidence classification is a fixed, documented scoring rule

**Decision**: Score each candidate field pair on five boolean deterministic signals — Name, Type,
Format, Resource (path/resource relationship), Tag (shared tag) — and classify with a fixed rule
(see data-model.md's classification table) rather than a numeric/weighted formula. AI-only
candidates (no deterministic name overlap at all) are capped at LIKELY when the AI-reported
confidence is high and POSSIBLE otherwise; AI can never place a relationship at CONFIRMED on its own.

**Rationale**: FR-003 and constitution XV require that CONFIRMED/LIKELY never rest on name similarity
alone. A small, fixed boolean rule table is exhaustively testable (every input combination has one
documented output) and keeps the classifier auditable by a QA engineer reading the explanation,
which User Story 3 requires. Capping pure-AI relationships below CONFIRMED reflects that an
unverified inference is exactly the "overconfident dependency inference" constitution XV warns
against — a single AI signal is still a single signal, whichever it is.

**Alternatives considered**:

- A weighted numeric score with a threshold: rejected as harder to explain to a reviewer ("why is
  this 0.72?") and more prone to accidental threshold drift between releases than a fixed rule table.
- Letting a very high AI confidence score reach CONFIRMED: rejected; it would let one inference
  automatically become executable-workflow-eligible, which is the exact risk XV's rationale names.

## Decision: Deterministic and AI-derived duplicates merge with deterministic evidence primary

**Decision**: Key every relationship by its resolved field pair (producer operation+field, consumer
operation+field+location). When both the deterministic pass and the AI pass report the same key,
merge into one `ApiDependencyRelationship` that keeps the deterministic classification and evidence,
and attaches the AI output as `aiCorroboration` metadata that never changes the classification.

**Rationale**: This directly implements the spec's resolved clarification (FR-006a) and mirrors the
project's existing merge pattern for AI-derived test scenarios in
`backend/src/testDesign/enhanceTestModel.ts`, which already merges an AI candidate into a matching
rule-derived scenario via `deduplicate`/`scenariosAreEquivalent` rather than listing both. Keeping
classification untouched by AI corroboration is also what keeps FR-010's "identical relationship
results on repeated analysis" achievable in practice: the deterministic classification cannot drift
because of AI output variance (see the reproducibility decision below), even on a merged relationship.

**Alternatives considered**:

- Let the higher-confidence source win: rejected in clarification; it would let AI variance change a
  relationship's classification between runs, undermining FR-010.
- Report both as separate relationships: rejected in clarification; it duplicates the same real-world
  fact and forces the reviewer to reconcile two entries that mean the same thing.

## Decision: Reproducibility guarantee (FR-010, SC-003) covers deterministic output; AI output follows constitution XXIV

**Decision**: FR-010's "identical relationship results... when analyzed repeatedly" is guaranteed in
full for the deterministic detection pass, the classification rule, producer-disambiguation tie-break
(FR-013a), and workflow assembly. The AI-assisted pass's own candidate content follows constitution
XXIV ("AI outputs MUST be treated as potentially variable"): it is exercised deterministically in
automated tests via the existing mock provider (project convention, CLAUDE.md §16), and a live local
model is expected — but not contractually guaranteed byte-for-byte — to be stable across runs of the
same input.

**Rationale**: This is not a new tension AP-008 introduces; `EnhancementResult` in AP-005 has the
same shape (deterministic TestModel scenarios plus AI-derived ones merged in) and the constitution
already resolves it at the principle level (XXIV) rather than per-feature. Restating it here keeps
FR-010/SC-003 honestly scoped: they are proven by tests using the deterministic mock provider (as
every AI-dependent automated test in this codebase already must, per CLAUDE.md §16), not by asserting
byte-identical output from a live model across two separate inference calls.

**Alternatives considered**:

- Require byte-identical AI output across runs: rejected as infeasible for any real local model and
  inconsistent with constitution XXIV, which explicitly anticipates AI variability.

## Decision: One batched AI inference request per analysis, mirroring the existing AI candidate pipeline

**Decision**: The AI-assisted pass issues exactly one `AIProvider.infer` call per dependency
analysis, carrying a serialized summary of the ApiModel's operations and fields, and expects a
structured JSON list of `AIDependencyCandidate` objects in return. The response flows through the
same shape: parse → shape-validate → semantic-validate against the ApiModel → merge, mirroring
`backend/src/testDesign/enhanceTestModel.ts`'s existing `AIScenarioCandidate` pipeline
(`aiScenarioPrompt.ts` → `parseAIScenarioResponse.ts` → `validateAICandidate.ts`).

**Rationale**: Calling the provider once per operation pair (up to ~40,000 pairs for 200 operations)
would be far too slow for local CPU inference and would multiply request-queue load (AP-004's FIFO
queue, constitution XXVII: no new distributed infrastructure). A single batched request is the same
architecture AP-005 already uses successfully for a structurally identical problem (many candidate
scenarios, one inference call, structured JSON list back), so this feature adds no new AI integration
pattern — only a new request/response contract shape (`AIDependencyCandidate` instead of
`AIScenarioCandidate`).

**Alternatives considered**:

- One inference call per candidate operation pair: rejected for latency and queue-load reasons above.
- Skip AI entirely and ship only deterministic detection: rejected; FR-005 and the roadmap's AP-008
  scope explicitly require AI-assisted semantic detection for dissimilar-name relationships that
  deterministic matching cannot find (e.g., `accountRef` → `accountId`).

## Decision: A shorter, request-scoped AI timeout keeps the AI pass inside the SC-008 budget

**Decision**: The dependency-analysis AI call sets `InferenceRequest.timeoutMs` to a short,
feature-specific value (default 8000ms) rather than relying on the global `AI_INFERENCE_TIMEOUT_MS`
default (60000ms, `backend/src/ai/modelConfig.ts:7`). If the AI call does not return within that
window, the analysis proceeds with deterministic-only relationships and reports
`aiOutcome: "timeout"`, exactly as `enhanceTestModel.ts` already does for its own AI call.

**Rationale**: SC-008 requires the full analysis (deterministic + AI-assisted) to complete in under
15 seconds for a 200-operation ApiModel or fail explicitly. The global 60-second default exists as a
ceiling for AP-004's general-purpose inference, not as a target for this specific, time-boxed
analysis step; `InferenceRequest.timeoutMs` already exists precisely to let one call override the
default (`packages/shared-domain/src/aiProvider.ts:21`, FR-017 of AP-004). Using it here needs no new
configuration surface and keeps FR-018 ("continue with deterministic relationships... when the AI
provider is unavailable") satisfied for the slow case as well as the down case.

**Alternatives considered**:

- Lower the global `AI_INFERENCE_TIMEOUT_MS` default: rejected; that is a cross-feature setting other
  AI-dependent features also rely on and changing it is out of this feature's boundary.
- Let the AI call run to the full 60s and treat SC-008 as best-effort: rejected; it would make the
  performance target unverifiable and unpredictable for the common case.

## Decision: Reuse `walkFields` for both producer and consumer field discovery

**Decision**: Extract candidate producer fields from every 2xx response schema and candidate consumer
fields from request-body schemas using the existing `walkFields` generator
(`backend/src/testDesign/requestHelpers.ts:15`), which already recursively walks object-typed schema
properties to a bounded depth (`MAX_TRAVERSAL_DEPTH = 50`, mirroring `buildApiModel.ts`'s own
safeguard). Path, query, and header parameters are added directly from `ApiOperation.parameters`
(already flat, no traversal needed), excluding any parameter that is part of a declared security
requirement for that operation.

**Rationale**: This directly resolves the "nested identifier" edge case (e.g. `{ user: { id } }`)
using a traversal the codebase already trusts, with an already-reviewed depth bound, instead of
writing and re-justifying a second recursive walker. Excluding security-requirement parameters avoids
nonsense relationships like matching a producer's `apiKey`-shaped field to an unrelated operation's
auth header — auth wiring is AP-007's concern (`authMapping.ts`), not a data hand-off.

**Alternatives considered**:

- Only compare top-level fields: rejected; it would silently fail the nested-identifier edge case the
  spec calls out explicitly.
- Write a new traversal helper scoped to this feature: rejected as an unjustified parallel
  implementation of behavior `walkFields` already provides correctly (CLAUDE.md §59).

## Decision: Resource/path relationship is a simple, deterministic path-shape comparison

**Decision**: Two operations have a resource/path relationship when, after stripping `{param}`
segments, one operation's static path segments form a prefix of the other's (e.g. `/users` is a
prefix of `/users/{userId}`, and `/users/{userId}` is a prefix of `/users/{userId}/orders`).

**Rationale**: This is the concrete case the spec's own example (`POST /users` → `GET
/users/{userId}` → `PUT /users/{userId}` → `DELETE /users/{userId}`) exercises, is computable
directly from `ApiOperation.path` with no new ApiModel data, and requires no natural-language or
pluralization heuristics that would themselves need justification and testing.

**Alternatives considered**:

- Fuzzy resource-name matching (e.g. stemming `/users` against `/user`): rejected as an unjustified
  heuristic with failure modes (false positives between unrelated resources) that a simple prefix
  rule avoids.

## Decision: Producer disambiguation tie-break (FR-013a)

**Decision**: When a consuming field has more than one CONFIRMED/LIKELY candidate producer, sort the
candidates by (a) confidence rank (CONFIRMED before LIKELY), then (b) evidence-signal count
descending, then (c) producer operation path, then (d) producer operation method, then (e) producer
field path — all lexicographic on the stable string values already present on the relationship — and
select the first. This ordering is fully deterministic and needs no random or time-based tie-break.

**Rationale**: FR-013a requires a documented, stable rule that never varies across runs of the same
input. Reusing values already on the relationship (confidence, evidence, operation identity) avoids
introducing a new comparison key purely for tie-breaking.

**Alternatives considered**:

- Prefer the producer operation declared earliest in the ApiModel's operation list: rejected as a
  weaker signal than evidence strength, and more fragile to reordering the source specification.

## Decision: Workflow assembly via cycle detection then bounded maximal-path enumeration

**Decision**: Build a directed graph whose nodes are operations and whose edges are the
disambiguated (post-FR-013a) relationships at CONFIRMED/LIKELY confidence. Run cycle detection
(Kahn's algorithm: repeatedly remove zero-in-degree nodes; any nodes left form a cycle) before
assembly. Operations in a detected cycle are excluded from automatic workflow assembly and reported
as a `DependencyCycleFinding` (FR-014); their relationships remain visible in the graph. On the
remaining acyclic graph, enumerate every maximal simple path by depth-first search from each node
with no incoming edge, bounded to a default maximum of 10 steps (`MAX_WORKFLOW_STEPS`, an
implementation default per the spec's Assumptions, informed by SC-008). Each maximal path becomes one
`IntegrationWorkflow`; an operation that is a valid next step for two different chains naturally
produces two separate workflows, satisfying the corresponding edge case.

**Rationale**: Kahn's algorithm is the standard, well-understood way to detect cycles in a directed
graph deterministically and cheaply (linear in nodes plus edges), which comfortably fits the SC-008
budget even at 200 operations. Enumerating maximal paths rather than only the single longest chain is
what the "overlapping chains" edge case requires. A step-count bound prevents pathological path
explosion in a large, densely connected ApiModel without truncating a chain silently — if a chain
would exceed the bound, that is reported explicitly rather than cut off midway (FR-014 pattern
extended to this case).

**Alternatives considered**:

- Only report the single longest chain: rejected; the "operation reused across chains" edge case
  requires multiple distinct workflows to be visible.
- Detect cycles only implicitly via DFS visited-sets during path enumeration: rejected as a weaker
  guarantee — it would silently skip a cyclical branch rather than surfacing it as its own explicit
  finding (FR-014).

## Decision: Content-derived, deterministic identifiers

**Decision**: Derive `ApiDependencyRelationship.id` from a SHA-256 digest over the ordered tuple
(producer path, producer method, producer field, consumer path, consumer method, consumer field,
consumer location), and `IntegrationWorkflow.id` from a digest over its ordered list of relationship
ids, following the same approach `backend/src/postman/identifiers.ts` already established for AP-007.

**Rationale**: FR-010/FR-016 require identical output for identical input, including stable
identifiers. Reusing the established content-derived-id approach (Node's built-in `crypto`, no new
dependency) keeps this feature consistent with the one other generator that already had to solve
exactly this problem.

**Alternatives considered**: Random or sequential ids — rejected outright for the same determinism
reasons AP-007's research.md already recorded.

## Decision: Stateless analysis endpoint, ApiModel-only input, no new frontend UI

**Decision**: Expose `POST /api/api-models/dependencies`, accepting only an `ApiModel` (no
`TestModel` — this feature reasons about operations and schemas, not generated test scenarios), and
returning the full `DependencyAnalysisResult` in one response. Persist nothing. Inject the
`AIProvider` the same way `enhancedTestModelsRouter`/`createEnhancedTestModelsRouter` already do. Add
no new frontend component or page in this feature.

**Rationale**: This matches the stateless boundary every prior backend-engine feature uses (AP-002,
AP-003, AP-005), and the spec's own Out of Scope section places relationship/workflow review and
approval UI outside this feature's boundary (delegated to AP-006 or its extension, and to AP-009's
end-to-end assembly). AP-002 (`ApiModel` construction) and AP-003 (deterministic `TestModel`
generation) are the direct precedent for a pure backend-engine feature with no dedicated frontend
page of its own.

**Alternatives considered**:

- Also accept a `TestModel` for symmetry with the review/export endpoints: rejected; nothing in this
  feature's requirements reads scenario data, and accepting an unused input would be dead surface
  area on the contract.
- Build a minimal read-only dependency-graph viewer now: rejected as scope creep into the review
  experience the spec explicitly defers to AP-006's extension.
