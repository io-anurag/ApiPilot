# Feature Specification: Automatic Workflow Chaining for Postman Export

**Feature Branch**: `019-auto-workflow-chaining`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "Auto-chained Postman export for dependent path parameters: extend
the existing dependency/workflow chaining mechanism (specs 008-dependency-workflow-engine,
016-workflow-aware-postman) so that high-confidence producer→consumer resource relationships (e.g.
GET /orders returning an id later needed by GET /orders/{id}, DELETE /orders/{id}, PATCH
/orders/{id}) are captured and rendered as chained Postman requests (pm.environment.set on the
producer, {{variable}} substitution on the consumer) by default, instead of requiring a human to
manually detect and approve an IntegrationWorkflow first. Today, any scenario not swept into an
approved IntegrationWorkflow falls back to an unresolved-path-parameter limitation (a bare {{id}}
variable the user must fill in manually before running the collection) — this currently accounts
for the vast majority of "Known limitations" entries in generated Postman exports (e.g. 701 of 709
limitations in a recent export). Goal: sharply reduce the number of unresolved path-parameter
variables in generated collections/environments by making dependency-based chaining the default
behavior for clear, deterministic, low-risk cases, while preserving explainability/provenance and
avoiding incorrect chaining of unrelated resources. Must stay consistent with the project's
determinism, specification-grounded, and explicit-failure principles — no fabricated
relationships, no silent behavior a user can't see or override."

## Clarifications

### Session 2026-09-13

- Q: When an engineer wants to opt out of automatic chaining, should that control apply to the
  whole export at once, or let them exclude individual relationships while keeping the rest
  chained? → A: Per-export only — one flag disables automatic chaining for the whole export; there
  is no per-relationship exclusion.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get a Runnable Collection Without Manually Filling IDs (Priority: P1)

As a QA engineer, when my approved scenarios include an operation that returns a resource
identifier (e.g. `GET /orders`) and a later operation that needs that same identifier as a path
parameter (e.g. `GET /orders/{id}`, `PATCH /orders/{id}`, `DELETE /orders/{id}`), I want the
exported Postman collection to capture the identifier from the producing response and substitute
it automatically into the consuming request, so I can run the collection immediately after import
instead of first hunting down real IDs for every unresolved variable.

**Why this priority**: This is the entire premise of the request — the overwhelming majority of
today's "Known limitations" entries (701 of 709 in a representative export) are unresolved path
parameters that this capability directly eliminates.

**Independent Test**: Export an approved scenario set containing `GET /orders` and `DELETE
/orders/{id}` where dependency analysis reports a CONFIRMED relationship between them, but where
no human has manually assembled/approved an `IntegrationWorkflow` for that pair. Verify the
exported collection extracts the identifier from the `GET /orders` response into a variable and
substitutes that variable into the `DELETE /orders/{id}` request, and that this pair no longer
appears in the "unresolved-path-parameter" limitations.

**Acceptance Scenarios**:

1. **Given** approved scenarios for a producer operation and a consumer operation connected by a
   CONFIRMED dependency relationship, **When** the collection is exported, **Then** the producer
   request captures the relevant response value into a named variable and the consumer request
   references that variable in place of an unfilled placeholder.
2. **Given** the same producer/consumer pair and relationship, **When** the collection is exported
   twice without changes, **Then** the chaining decision, variable name, and substitution are
   identical both times.
3. **Given** a consumer operation whose path parameter has no CONFIRMED or LIKELY producer
   relationship available anywhere in the exported scenario set, **When** the collection is
   exported, **Then** that parameter is reported exactly as it is today — an explicit
   unresolved-path-parameter limitation and a variable left for the user to fill in.

---

### User Story 2 - Trust and Audit Which Chains Were Applied Automatically (Priority: P1)

As a QA engineer, I want every automatically applied chain to be visibly explained — which
relationship caused it, what evidence supports it, and which two requests it connects — so I can
verify the collection is correct before I run it against a real environment, and so an incorrect
chain is never silently invisible.

**Why this priority**: Explainability and provenance are non-negotiable project principles;
automating a decision that used to require human approval must not reduce the reviewer's ability to
understand or override what the tool did.

**Independent Test**: Export a collection containing at least one automatically applied chain and
inspect the accompanying summary/README. Verify each automatic chain is listed with the source
operations, the field/variable involved, and the relationship confidence and evidence that
justified it, distinctly from chains that came from a manually approved `IntegrationWorkflow`.

**Acceptance Scenarios**:

1. **Given** a collection containing at least one automatically applied chain, **When** the
   engineer reads the export summary/README, **Then** every automatic chain is listed with its
   producer operation, consumer operation, variable name, and the relationship confidence/evidence
   that justified applying it.
2. **Given** a collection containing both automatically applied chains and chains from manually
   approved workflows, **When** the engineer reads the export summary, **Then** the two origins are
   distinguishable rather than presented as the same kind of decision.
3. **Given** an automatically applied chain, **When** the engineer wants to disable it for a
   specific export, **Then** the system provides an explicit, documented per-export opt-out (a
   single flag that disables automatic chaining for the whole export) rather than requiring the
   collection to be hand-edited afterward or requiring per-relationship exclusions.

---

### User Story 3 - Never Guess When Evidence Is Weak or Ambiguous (Priority: P1)

As a QA engineer, I want automatic chaining to apply only where the evidence is strong and
unambiguous, and to fall back to today's explicit unresolved-variable behavior whenever it is not,
so that a low-confidence guess never gets silently wired into my test data.

**Why this priority**: Incorrectly chaining unrelated resources (e.g. substituting a `productId`
into an `orders/{id}` delete) would be worse than today's blank-variable behavior, because it looks
correct while being wrong. This story protects the trustworthiness of the whole feature.

**Independent Test**: Export a scenario set where a path parameter has two or more competing
candidate producer relationships, and another set where the only available relationship is
POSSIBLE confidence. Verify the first case deterministically resolves to one producer (or falls
back if resolution is not possible) and the second case is left as an unresolved-path-parameter
limitation, never guessed.

**Acceptance Scenarios**:

1. **Given** a path parameter with only a POSSIBLE-confidence candidate relationship available,
   **When** the collection is exported, **Then** no automatic chain is applied and the parameter is
   reported as an unresolved-path-parameter limitation.
2. **Given** a path parameter with more than one CONFIRMED/LIKELY candidate producer, **When** the
   collection is exported, **Then** the system deterministically resolves to exactly one producer
   using the same tie-break rule already used for manual workflow assembly, and this choice is
   visible in the export summary.
3. **Given** a candidate relationship that would require a producer scenario that was not itself
   approved/included in the export, **When** the collection is exported, **Then** no chain is
   applied for that consumer and it falls back to the unresolved-path-parameter limitation.
4. **Given** a candidate relationship that would form a cycle or otherwise ambiguous ordering,
   **When** the collection is exported, **Then** no chain is applied for the operations in that
   cycle and each falls back to its unresolved-path-parameter limitation.

---

### Edge Cases

- A consumer operation's path parameter matches a CONFIRMED relationship, but the producing
  operation was itself rejected (not part of the approved scenario set) or excluded from this
  export: the consumer falls back to the unresolved-path-parameter limitation rather than
  referencing a request that will not exist in the collection.
- The same producer operation is a valid source for several different consumer operations (e.g.
  `GET /orders` feeds `GET /orders/{id}`, `PATCH /orders/{id}`, and `DELETE /orders/{id}`): one
  producer capture is reused by all matching consumers rather than being captured redundantly per
  consumer.
- A relationship's producer field is nested inside the response body (e.g. `{ order: { id } }`)
  rather than a top-level field: the same extraction rules already defined for manually approved
  workflows apply; if the value cannot be resolved, the consumer falls back to the
  unresolved-path-parameter limitation rather than guessing a JSON path.
- A destructive operation (e.g. `DELETE /orders/{id}`) becomes a chain consumer: it is treated the
  same as any other consumer — chained when evidence is strong, reported plainly in the summary so
  the engineer knows the identifier came from another request's response rather than manual input.
- An operation participates in both a manually approved `IntegrationWorkflow` and an
  automatic-chaining candidate relationship: the manually approved workflow takes precedence and
  the automatic mechanism does not duplicate or conflict with it.
- The scenario set contains no CONFIRMED or LIKELY relationships at all: export proceeds exactly as
  it does today, with no automatic chains and the existing set of unresolved-path-parameter
  limitations.
- A relationship connects a producer and consumer operation, but rendering the producer's request
  after the consumer's (rather than before it) would be required for the collection's existing,
  unmodified ordering rules: the chain is not applied and the parameter falls back to the
  unresolved-path-parameter limitation, rather than reordering the collection to make the chain
  work.
- A relationship's producer or consumer operation belongs to an `IntegrationWorkflow` that a human
  has explicitly rejected during workflow review: that relationship is not used for automatic
  chaining, even though it independently meets the CONFIRMED/LIKELY eligibility bar — an explicit
  human rejection is never overridden by automatic behavior.
- An operation has more than one approved scenario (e.g. a positive case and one or more negative/
  invalid-input cases): only its approved positive-outcome scenario is eligible as an automatic-
  chain producer, since a deliberately invalid request's response is not a trustworthy source for a
  real resource identifier and no human is confirming the choice of scenario the way workflow
  approval does today.
- A candidate relationship would only be usable by assembling several hops together (e.g. producer
  → intermediate → consumer, rather than a single producer response feeding a single consumer
  request directly): automatic chaining does not assemble multi-hop chains; only direct,
  single-hop producer-to-consumer relationships qualify. Multi-hop chains remain the domain of a
  manually reviewed `IntegrationWorkflow`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST detect, for every unresolved path parameter in an export, whether a
  CONFIRMED or LIKELY dependency relationship exists to a producer operation whose scenario is also
  present in the same export.
- **FR-002**: The system MUST automatically render an eligible relationship as a chained pair —
  capturing the producer's response value into a named variable and substituting that variable into
  the consumer's request — without requiring any per-relationship or per-export human approval
  step. Every applied chain MUST still be reported in the export summary with its evidence (see
  FR-010), and an engineer MUST be able to opt out at the export level (see FR-011); this is a
  documented, visible-by-default departure from the "workflow approval remains a human decision"
  assumption recorded in 016-workflow-aware-postman, scoped specifically to CONFIRMED/LIKELY
  automatic chains and not to manually assembled `IntegrationWorkflow`s, whose approval requirement
  is unchanged.
- **FR-003**: The system MUST restrict automatic chaining eligibility to CONFIRMED and LIKELY
  confidence relationships — the same eligibility bar 008-dependency-workflow-engine already uses
  for manual workflow assembly.
- **FR-004**: The system MUST NOT apply automatic chaining when a path parameter's only available
  relationship is POSSIBLE confidence; such parameters MUST continue to be reported as
  unresolved-path-parameter limitations exactly as today.
- **FR-005**: The system MUST NOT apply automatic chaining when the required producer scenario is
  not itself present in the same export, and MUST fall back to the existing unresolved-path-parameter
  limitation for that consumer.
- **FR-006**: When more than one CONFIRMED/LIKELY relationship could supply the same consumer path
  parameter, the system MUST deterministically resolve to exactly one producer using the same
  tie-break rule already defined for manual workflow assembly (FR-013a of
  008-dependency-workflow-engine), and MUST NOT vary the chosen producer across repeated exports of
  the same input.
- **FR-007**: The system MUST NOT apply automatic chaining across operations that form a cycle or
  otherwise unresolvable ordering; affected consumers MUST fall back to the existing
  unresolved-path-parameter limitation.
- **FR-008**: When an operation is already part of a manually approved `IntegrationWorkflow`, the
  system MUST use that approved workflow's rendering and MUST NOT additionally apply automatic
  chaining that duplicates or conflicts with it.
- **FR-009**: The system MUST reuse a single producer capture for a given response value when
  multiple eligible consumers depend on it, rather than emitting a redundant capture per consumer.
- **FR-010**: The system MUST report every automatically applied chain in the export
  summary/README, naming the producer operation, consumer operation, variable name, and the
  relationship confidence and evidence that justified it, and MUST distinguish automatic chains
  from chains rendered from a manually approved workflow.
- **FR-011**: The system MUST provide a single, explicit, documented per-export opt-out that
  disables automatic chaining for the entire export when set, rather than requiring the resulting
  collection to be hand-edited to remove an unwanted chain. The system MUST NOT require or expose
  per-relationship exclusions for this feature.
- **FR-012**: The system MUST produce identical automatic-chaining decisions, variable names, and
  substitutions when the same approved scenario set, dependency graph, and export options are used
  repeatedly.
- **FR-013**: The system MUST NOT fabricate a relationship, evidence, or extraction path that is
  not supported by the existing dependency analysis (008-dependency-workflow-engine) output.
- **FR-014**: The system MUST leave all existing unresolved-path-parameter behavior, messages, and
  limitation reporting unchanged for every parameter that does not qualify for automatic chaining.
- **FR-015**: The system MUST NOT apply an automatic chain that would require the collection's
  existing, unmodified deterministic ordering to place the consumer's request before the
  producer's; such a parameter MUST fall back to the existing unresolved-path-parameter limitation
  rather than reordering the collection to accommodate the chain.
- **FR-016**: The system MUST exclude, from automatic chaining, any relationship whose producer or
  consumer operation belongs to an `IntegrationWorkflow` that a human has explicitly rejected during
  workflow review, regardless of the relationship's own confidence classification.
- **FR-017**: When an operation has more than one approved scenario, the system MUST restrict
  automatic-chain producer eligibility to that operation's approved positive-outcome scenario, and
  MUST NOT capture a response value from a negative/invalid-input scenario for use as a chained
  identifier.
- **FR-018**: The system MUST restrict automatic chaining to direct, single-hop producer-to-consumer
  relationships; it MUST NOT assemble a multi-hop chain across more than one intermediate operation.

### Key Entities

- **Automatic Chain**: A producer/consumer pair connected by a CONFIRMED or LIKELY dependency
  relationship (from 008-dependency-workflow-engine) that this feature renders as a chained
  extraction/substitution without requiring the relationship to have been assembled into a manually
  approved `IntegrationWorkflow` first.
- **Chain Provenance Entry**: The reported explanation of one automatic chain — its producer
  operation, consumer operation, variable name, and relationship confidence/evidence — surfaced in
  the export summary/README.
- **Chaining Eligibility Decision**: The determination, per unresolved path parameter, of whether an
  automatic chain can be safely applied, or whether the parameter must fall back to today's
  unresolved-path-parameter limitation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In representative exports with clear create/read/update/delete relationships between
  operations, at least 90% of path parameters that previously appeared as unresolved-path-parameter
  limitations are instead resolved as automatic chains. Validated against the feature's own
  representative create/read/update/delete case (one producer feeding three consumers) rather than
  a separate synthetic benchmark corpus — see
  `backend/tests/unit/postman/generateCollection.test.ts`'s "resolves the representative
  create/read/update/delete relationship shape at ≥90%" case (added post-`/speckit-analyze`,
  2026-09-13).
- **SC-002**: 0% of automatic chains are applied using only POSSIBLE-confidence evidence or
  field-name similarity alone.
- **SC-003**: 100% of automatically applied chains are listed in the export summary with their
  supporting evidence, distinguishable from manually approved workflow chains.
- **SC-004**: Repeated exports of the same approved scenario set and dependency graph produce
  byte-identical chaining decisions and collection/environment output in 100% of runs.
- **SC-005**: 0% of automatic chains reference a producer scenario that is not itself present in
  the same export.
- **SC-006**: An engineer reviewing a generated collection's summary can identify, within 30
  seconds, which path parameters were auto-chained and on what evidence, for a representative export
  of up to 50 operations. The 30-second human-timing claim itself is qualitative; what is
  mechanically verified is the structural property that makes it plausible — the README's
  "Automatically chained requests" section stays one bullet per producer with one "used by"
  sub-bullet per consumer (never a duplicated line per consumer), so its length grows with the
  number of distinct producers rather than with fan-out — see
  `backend/tests/unit/postman/readme.test.ts`'s "keeps the automatic-chains section scannable" case
  (added post-`/speckit-analyze`, 2026-09-13).

## Assumptions

- This feature consumes the existing `ApiDependencyGraph` and relationship confidence
  classifications produced by 008-dependency-workflow-engine; it does not change how relationships
  are detected or classified.
- This feature reuses the existing chained-rendering mechanics (response extraction,
  `pm.environment.set`, variable substitution, naming) already built for manually approved
  workflows in 016-workflow-aware-postman, applying them to a broader, automatically selected set of
  producer/consumer pairs rather than introducing a new rendering mechanism.
- A manually approved `IntegrationWorkflow` always takes precedence over automatic chaining for the
  operations it covers; this feature only fills the gap left by scenarios that were never assembled
  into an approved workflow.
- Existing unresolved-path-parameter reporting, messages, and the "Known limitations" aggregation
  remain the fallback for every case this feature does not confidently resolve.

## Out of Scope

- Changing dependency detection, confidence classification, or evidence rules defined in
  008-dependency-workflow-engine.
- Changing how a human reviews or approves a manually assembled `IntegrationWorkflow`.
- Executing generated requests or contacting any API described by the specification.
- Chaining based on AI-only inferred relationships without deterministic corroboration, beyond what
  008-dependency-workflow-engine already classifies as CONFIRMED/LIKELY.
- Non-path-parameter unresolved variables (this spec is scoped to the path-parameter case that
  dominates today's limitations; request-body or header chaining follows the same mechanism but is
  not required for this feature's acceptance).
- Multi-hop automatic chaining (producer → intermediate → consumer spanning more than one
  relationship); only direct, single-hop relationships are rendered automatically, per FR-018.
- Reordering the generated collection's existing item/folder order to accommodate a chain that
  would otherwise run out of order; such cases fall back to the existing unresolved-path-parameter
  limitation instead (FR-015).
