# AP-005 Research

## Decision: Extend the Existing Scenario and Provenance Model Additively

**Decision**: Keep one `TestModel.scenarios` collection and extend `Provenance` with an AI
source discriminator and optional AI-specific traceability fields. Add a separate
`AIScenarioCandidate` contract for provider output before conversion to `TestScenario`.

**Rationale**: AP-003 already defines the framework-independent scenario shape and
deduplication key. A separate executable scenario hierarchy would fragment the model and
make later approval and artifact generation more complex. Optional fields preserve existing
RULE scenarios without changing their serialized shape.

**Alternatives considered**:

- A parallel `AIScenario` executable type was rejected because downstream consumers would
  need to handle two scenario collections.
- A union of unrelated scenario types was rejected because it weakens the stable TestModel
  contract.

## Decision: Three Validation Stages Before Model Assembly

**Decision**: Process provider content through JSON/contract validation, candidate structural
validation, and ApiModel semantic validation before conversion or deduplication.

**Rationale**: Parseable JSON can still contain unknown operations, fields, methods, or
status codes. Separating stages makes failures actionable and prevents unsupported AI
inferences from becoming executable tests.

**Alternatives considered**:

- Prompt-only enforcement was rejected because model output cannot be trusted as a contract
  boundary.
- Validation only after TestModel conversion was rejected because malformed candidates would
  already be mixed with executable domain objects.

## Decision: Reuse Canonical Deterministic Deduplication

**Decision**: Convert validated candidates to `TestScenario`, combine them after the supplied
deterministic scenarios, and reuse the existing canonical request/assertion equivalence
algorithm. Track AI duplicate origins in an AI-specific provenance field.

**Rationale**: Existing deduplication already sorts nested request/assertion keys and retains
first-seen ordering. Putting deterministic scenarios first ensures the baseline remains the
representative when an AI candidate is equivalent.

**Alternatives considered**:

- A second AI-only deduplicator was rejected because it could drift from deterministic
  equivalence semantics.
- Replacing the existing rule provenance list with a generic list was rejected because it
  would break AP-003 consumers and obscure origin categories.

## Decision: Stateless HTTP Enhancement Boundary

**Decision**: Expose `POST /api/test-models/enhance`, accepting the complete `ApiModel` and
`TestModel`, and return a structured enhancement result. Keep business logic in
`backend/src/testDesign` and use the existing `getAIProvider()` factory.

**Rationale**: AP-003 already uses stateless JSON endpoints with caller-supplied domain
models. This enables frontend integration without introducing persistence and keeps the
route thin.

**Alternatives considered**:

- A frontend-only integration was rejected because AI validation and TestModel assembly must
  remain server-side domain behavior.
- Persisting enhancement sessions was rejected because no AP-005 requirement needs storage
  and specifications are sensitive.

## Decision: Stable Enhancement Ordering, Supplied Baseline Identity

**Decision**: Preserve the input deterministic scenario order and IDs. Order valid new AI
scenarios by provider response order after validation; use a stable canonical candidate
identity for AI duplicate reporting. Repeated enhancement is identical when the provider
returns equivalent validated content.

**Rationale**: The enhancement service must not rewrite existing baseline identity, while
deterministic merging must be reproducible for equivalent provider output. AP-003's existing
UUID generation is outside this feature's responsibility because AP-005 receives, rather than
regenerates, the baseline model.

**Alternatives considered**:

- Rebuilding all scenario IDs was rejected as a breaking change for consumers of the
  deterministic endpoint.
- Sorting by model-generated prose was rejected because it is unstable and not domain
  meaningful.

## Decision: Fail Softly to the Deterministic Baseline

**Decision**: Provider unavailable, timeout, malformed response, and semantically invalid
response outcomes return the unchanged deterministic model plus a structured outcome and
safe diagnostic message. Partial provider output is never applied.

**Rationale**: AP-005 is explicitly an enhancement and the constitution requires visible
failure without fabricated coverage. The existing AIProvider already exposes typed failure
categories.

**Alternatives considered**:

- Returning only an HTTP error was rejected because it would unnecessarily hide the usable
  deterministic baseline.
- Silently returning an empty enhanced model was rejected because it would confuse provider
  failure with zero semantic opportunities.

## Decision: No New Dependency

**Decision**: Use the existing TypeScript, Express, Vitest, Supertest, shared-domain, and
AIProvider infrastructure. Use explicit typed validation helpers for the bounded AP-005
response shape.

**Rationale**: The repository has no schema-validation dependency and AP-005 can keep its
validation surface small and domain-specific without dependency proliferation.

**Alternatives considered**:

- Adding a general validation package was deferred because it would expand the dependency
  surface for one focused contract and is not required by current repository patterns.
