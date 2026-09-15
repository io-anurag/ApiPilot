# Phase 0 Research: Automatic Auth-Credential Chaining

All Technical Context fields were resolved directly from the existing codebase and constitution;
no NEEDS CLARIFICATION markers remained after `/speckit.clarify` (three rounds of clarification on
2026-09-15 resolved every open product decision, including extending producer-candidate discovery
to the primary scheme and excluding `http`/`basic`). This document records the architecture
decisions made while reading the existing `backend/src/postman/automaticChaining.ts`,
`credentialProducers.ts`, `authMapping.ts`, `generateCollection.ts`, `assertionScripts.ts`,
`backend/src/dependencies/analyzeDependencies.ts`, `deterministicMatching.ts`, and
`packages/shared-domain/src/apiDependency.ts`, each of which had a real, non-obvious alternative.

## D1 — Auth-credential relationships are built at export time, in `postman/`, not inside `/dependencies/analyze`

**Decision**: A new module, `backend/src/postman/authCredentialRelationships.ts`, computes auth-
credential `ApiDependencyRelationship`s from the `ApiModel` and the (extended) `credentialProducers`
output, called from `generateCollection.ts` and merged into the relationship list passed to
`planAutomaticChains`. `backend/src/dependencies/analyzeDependencies.ts` and the `/dependencies/
analyze` HTTP contract are untouched.

**Rationale**: Spec FR-002's producer-candidate discovery explicitly reuses specs/021's
`findCredentialProducers`, which already lives in `backend/src/postman/` and is computed inside
`generateCollection.ts`'s export pipeline using `apiModel.operations` and the scheme-variable
`plan` — data that is only assembled at export time, not during the separate `/dependencies/
analyze` request that produces the schema-field-matched `ApiDependencyGraph` `automaticChaining.ts`
otherwise reads from. `backend/src/postman/` already depends on `backend/src/dependencies/`
(`automaticChaining.ts` imports `resolveProducerDisambiguation` from `../dependencies/
mergeRelationships`; the new module imports `producerFieldSchemas` from `../dependencies/
fieldExtraction`) — a one-directional dependency. Building auth-credential relationships inside
`analyzeDependencies.ts` instead would either duplicate `planSchemeVariables`/
`findCredentialProducers` into `dependencies/` or invert that dependency direction, both violating
Separation of Concerns (constitution IX) for a mechanism spec 021 already placed in `postman/`.
Spec 023's own root-cause framing ("the dependency graph (008) that automatic chaining (019) reads
from has no concept of...") is a description of the *type* gap (`ApiDependencyGraph`/
`ApiDependencyRelationship`, both shared-domain), not a mandate that the relationships be computed
inside the analysis endpoint specifically — `automaticChaining.ts` already merges a precomputed
graph with export-time-only information today (it has no other choice: `workflowContext?.
automaticChaining?.graph` is the only graph available to it).

**Alternatives considered**:
- *Extend `analyzeDependencies.ts` to also compute auth relationships.* Rejected: requires either
  moving `planSchemeVariables`/`findCredentialProducers` into `dependencies/` (churns 021's already-
  shipped, tested module for no behavioral gain) or importing `postman/` from `dependencies/`
  (inverts the existing layering). It would also change the `/dependencies/analyze` response shape
  and its own contract/tests, which spec 023 gives no evidence of intending to touch.

## D2 — Confidence: every resolved auth-credential relationship is `CONFIRMED`

**Decision**: `authCredentialRelationships.ts` assigns `confidence: "CONFIRMED"` and
`source: "deterministic"` to every relationship it builds; there is no LIKELY/POSSIBLE tier for
this relationship kind.

**Rationale**: `automaticChaining.ts`'s `isEligibleRelationship` only ever applies a chain for
CONFIRMED or LIKELY relationships (`automaticChaining.ts:162`). FR-002–FR-004 already gate relationship
*existence* on uniqueness at every step (one producer candidate, one plausible credential field, one
scheme key) — by the time a relationship is built at all, there is no remaining ambiguity for a
confidence tier to express; a LIKELY/POSSIBLE tier would misrepresent a deterministic, uniquely-
resolved match as merely probable. This mirrors `deterministicMatching.ts`'s own CONFIRMED tier
(`classifyDeterministicEvidence`), which is reached only when a name match *and* a resource/type/
format signal both hold — auth-credential relationships have an even stronger evidentiary basis
(operation-level "requires no auth" plus scheme-key stem match plus response-shape uniqueness), so
CONFIRMED is the correct, not merely convenient, classification (constitution XV).

## D3 — `unresolvedCredentialProducerLimitations` now also covers the primary scheme, and is driven by relationship resolution, not producer-candidate discovery alone

**Decision**: `generateCollection.ts`'s `unresolvedCredentialProducerLimitations` drops its
`entry.isPrimary` skip (`generateCollection.ts:219`) and its "resolved" set is redefined as the
schemes that actually received an `authCredentialRelationships.ts` relationship, not merely the
schemes with a discovered producer *operation* (`credentialProducers`).

**Rationale**: Two independent things can each fail for a scheme, and FR-004 requires both to fall
back to the same limitation: (a) no unauthenticated operation uniquely matches the scheme's stem
(`findCredentialProducers` returns nothing for it — pre-existing 021 behavior, now also reachable
for the primary scheme per the Clarifications), or (b) a producer operation is found, but its
documented response has zero or more than one plausible credential-shaped field (FR-003/FR-004,
new in this feature). Deriving "resolved" from the relationship-builder's actual output — rather
than from `credentialProducers` alone — is what makes case (b) correctly fall through to the
limitation instead of silently reporting nothing (constitution XIV). Extending the skip to include
the primary scheme reflects the Clarifications' extension of discovery scope to it: an ordinary
single-bearer-scheme specification whose login endpoint's path/`operationId` does not happen to
contain the scheme key's stem will now correctly surface an explicit, actionable limitation instead
of the credential silently staying unresolved with no explanation — consistent with how every other
unresolved case in this pipeline is already reported (Fail Safely, constitution XIX).

**Consequence acknowledged**: specifications with a single bearer/apiKey scheme (the common case)
that previously never triggered `unresolved-credential-producer` (021 always skipped primary) may
now do so, whenever the login endpoint's naming doesn't happen to contain the scheme key's stem.
This is an intentional widening of an existing, already-understood limitation category — not a new
kind, not a regression against specs/021 SC-001 (which constrains only the auth block/variable-name
*shape*, unaffected here), and not a change to determinism (SC-004): the same specification always
produces the same limitation set.

## D4 — `findAuthConsumerTargets`: every operation declaring a scheme is unconditionally a target, unlike path parameters

**Decision**: A new `automaticChaining.ts`-local function, `findAuthConsumerTargets`, returns one
`ConsumerTarget` per `{scenario, operation}` pair in the standalone set whose operation has a
declared security requirement, keyed by `operation.security[0]?.schemes[0]?.name` (the same scheme
key `mapOperationAuth`/`unresolvedCredentialProducerLimitations` already treat as "the" scheme an
operation depends on). Unlike `findUnresolvedPathConsumers`, there is no "already supplied" check —
every such operation is always a target.

**Rationale**: A path parameter is only a chaining target when the approved scenario left it
unresolved (`scenario.request.pathParameters[name] === undefined`); a scenario can legitimately
already carry a concrete value. An operation's auth block has no equivalent "already supplied"
state at the scenario level — `authMapping.ts` always emits a reference to the scheme's credential
variable (`{{token}}`), which starts empty regardless of the scenario — so every operation
declaring the scheme is unconditionally eligible to receive the chained value (spec FR-005,
Acceptance Scenario 2: "every operation declaring that scheme"). Restricting the scheme key to the
operation's *first* declared requirement's *first* scheme mirrors `mapOperationAuth`'s own
precedence rule exactly (`authMapping.ts:166-177`), so a chain is only ever attempted for the same
scheme the rendered auth block actually configures.

## D5 — `applyChainGroup` branches on `consumer.location`; no scenario mutation for an auth consumer

**Decision**: `automaticChaining.ts`'s `applyChainGroup` is extended to check each relationship's
`consumer.location`. For `"path"` (existing behavior): call `applyWorkflowSubstitutions` as today.
For `"auth"`: skip `applyWorkflowSubstitutions` entirely — the scenario/request is not mutated — and
record the consumer for reporting only.

**Rationale**: `applyWorkflowSubstitutions` (`workflowVariables.ts:20-41`) only knows how to write a
`{{var}}` placeholder into `pathParameters`/`queryParameters`/`headers`/a dotted body field; it has
no "auth" case, so calling it unchanged would silently no-op rather than error — an implicit,
untested assumption this feature must not rely on (constitution XIV). It is also unnecessary: per
FR-007, an auth-credential chain "MUST NOT alter... any operation's auth block structure — it only
supplies a value for a variable that structure already references." The operation's `PostmanAuth`
block, built independently by `mapOperationAuth`/`buildRequestItem` (`requestItem.ts:374`), already
references `{{token}}` whether or not any chain ever resolves it; the chain's only remaining job is
to make sure something populates that variable at runtime, which is entirely the extraction script's
responsibility (D6), not a request-shape rewrite.

## D6 — Extraction and chain variable name: an explicit override, not a second `workflowVariableName` derivation

**Decision**: `WorkflowExtraction` (`assertionScripts.ts:171`) gains an optional
`finalVariableName?: string`. When present, `extractionLines` writes `pm.environment.set(finalVariableName, ...)`
directly instead of computing `workflowVariableName(extraction.workflowId, extraction.variableName)`.
`AutomaticChain.variableName` is likewise the credential variable name directly for an auth chain
group, not `workflowVariableName(chainId, producerField)`. Both come from the same source: the
scheme's resolved variable name already computed by `planSchemeVariables`
(`SchemeVariablePlanEntry.variableNames.token`/`.apiKey`), threaded into `planAutomaticChains`'s
input as a small `Map<string, string>` (scheme key → variable name) built once in
`generateCollection.ts` alongside the existing `plan`.

**Rationale**: `workflowVariableName(workflowId, name)` unconditionally produces
`${workflowId}_${name}` (`workflowRendering.ts:48-50`) — there is no input that makes it equal a
bare `token`/`adminToken`. Per the spec's third Clarification, the chain variable "is renamed to
exactly that same credential-variable name... so the operation's already-emitted auth block...
needs no separate rewrite" — the auth block's reference is fixed by `authMapping.ts` independently
of chaining, so the chain must target that exact name, not derive a new one. An optional override
field is the smaller change: every existing path-parameter call site passes no
`finalVariableName` and is byte-for-byte unaffected (mirrors specs/021 D4's precedent of adding an
optional parameter rather than a second function).

**Alternatives considered**:
- *Post-process the rendered extraction script to rename the variable after the fact.* Rejected:
  string-rewriting generated JavaScript is fragile and harder to test than passing the already-known
  final name through the same typed path every other field already travels.

## D7 — A producer group is split by consumer-location kind, never mixed

**Decision**: `automaticChaining.ts`'s existing `groupByKey(resolved, relationshipProducerKey)`
(fan-out grouping, `automaticChaining.ts:261`) is refined so relationships sharing the same producer
field but differing in `consumer.location` (`"path"` vs `"auth"`) form separate groups (and
therefore separate chains/variables/extractions), never one mixed group.

**Rationale**: It is structurally possible — though expected to be rare in practice — for the same
producer field to independently qualify as both an auth-credential producer (FR-003) and a schema-
field producer matched by `deterministicMatching.ts`'s ordinary name-based rule (e.g. a login
response's sole string field happens to also be named after some other operation's path parameter).
If such a producer's relationships were grouped together, the chain's single `variableName` would
have to be either the fixed credential name (D6) or the generic derived name — never both — silently
dropping one interpretation's guarantee. Splitting by location keeps each chain's meaning and naming
rule exactly what its own FR requires, at the cost of two independent (but individually correct and
harmless) `pm.environment.set` lines on the producer's test script when this rare overlap occurs.
This keeps FR-006's guarantee ("never a separate chain-scoped name a consuming operation's auth
block does not already reference") unconditionally true rather than true-except-in-this-corner-case.

**As built** (refinement made during `/speckit-implement`): the grouping key for an `"auth"`
consumer also includes the scheme key (`consumer.field`), not just the producer field and the
`"path"`/`"auth"` kind. Reason: it is *also* structurally possible for the same producer operation
to independently qualify as a producer candidate for two distinctly-keyed schemes whose stems
happen to coincide (e.g. two scheme keys that both normalize to the same stem) — `credentialProducers`
already permits this per-scheme, since each scheme's candidate search is independent. Without the
extra partition, two such schemes' relationships would land in one group and `applyChainGroup`
would resolve `credentialVariableNames.get(first.consumer.field)` using only the *first*
relationship's scheme key, silently assigning every consumer — including the other scheme's — the
wrong credential variable. This is exactly the SC-002 cross-scheme-leakage guarantee D7 exists to
protect, just via a second, independently-discovered path to the same failure mode; the fix is the
same technique (split the group), extended by one more key component. See
`relationshipProducerGroupKey` in `automaticChaining.ts`.

## D8 — `http`/`basic` needs no new exclusion code; specs/021 already declines it

**Decision**: No change to `credentialProducers.ts`'s existing `if (entry.type === "basic")
continue;` (line 32). `authCredentialRelationships.ts` only ever receives `bearer`/`apiKey`
candidates as input, so it naturally never builds a relationship for a `basic` scheme.

**Rationale**: Confirmed by reading the shipped 021 code (`credentialProducers.ts:28-32`,
`credentialProducers.ts` module doc) before writing this spec's Clarifications: the exclusion
already exists, already-tested, and already matches this feature's Q2 answer exactly. Re-
implementing it here would be pure duplication.
