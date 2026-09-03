# AP-006 Research

## Decision: Session-scoped review state

**Decision**: Keep review workspaces transient for the initial feature. The review state is held
by the active client workflow and represented by framework-independent domain contracts; no
server database or long-term audit store is introduced.

**Rationale**: The current repository has no persistence layer and AP-006 is a review boundary,
not a retention or collaboration feature. Session-scoped state preserves the product's local,
non-persistent behavior while allowing later persistence to be specified independently.

**Alternatives considered**:

- Add a database-backed review repository: rejected because it expands scope into retention,
  identity, permissions, and migration concerns not defined by AP-006.
- Store review state on the source TestModel: rejected because review decisions and user edits
  are workflow metadata and should not mutate the generated baseline.

## Decision: Shared review domain contracts

**Decision**: Define review state, decisions, summaries, policy, and edit history in the
framework-independent shared-domain package.

**Rationale**: The frontend displays and changes review state while backend boundaries validate
review updates and future artifact generation will consume approved state. A shared contract
prevents divergent representations and keeps Postman or UI details out of the domain.

**Alternatives considered**:

- Define review types only in React: rejected because downstream backend/artifact boundaries
  would need duplicate models.
- Extend provenance with review state: rejected because provenance describes origin, while
  review state describes a human workflow decision.

## Decision: Deterministic per-scenario state transitions

**Decision**: Use explicit `pending`, `accepted`, and `rejected` states. An accept or reject
operation replaces the active decision, while prior decisions remain in a bounded review
history. Rejection requires a non-empty reason.

**Rationale**: A discriminated state makes approval eligibility unambiguous, supports the
summary counts, and avoids contradictory active states. Requiring a reason makes rejection
feedback actionable.

**Alternatives considered**:

- Boolean `approved` plus optional rejection text: rejected because it cannot distinguish
  pending from rejected and permits contradictory combinations.
- Append-only decisions with no current state: rejected because consumers need a deterministic
  current eligibility result.

## Decision: Versioned optimistic updates

**Decision**: Review updates carry the scenario revision observed by the client. The review
engine accepts an update only when that revision matches the current revision and returns a
stale-update finding otherwise. The initial session boundary does not claim cross-user durable
conflict resolution.

**Rationale**: This catches duplicate browser submissions and stale UI state without introducing
persistence. It also leaves a clear upgrade path for a future collaborative review feature.

**Alternatives considered**:

- Last-write-wins without detection: rejected because it silently overwrites review decisions.
- Locking or server-side sessions: rejected because the repository has no corresponding
  persistence/session infrastructure.

## Decision: Review edits are validated before replacement

**Decision**: Treat edits as candidate TestScenario changes validated against the available
ApiModel and existing AP-005 supported test intent. A successful edit receives user-modified
provenance while retaining the original AI or RULE origin in edit history.

**Rationale**: The API specification remains authoritative and user changes must not erase the
inference trail. Reusing existing semantic validation avoids a second, inconsistent contract
validator.

**Alternatives considered**:

- Allow arbitrary JSON editing: rejected because it could create executable scenarios that do
  not correspond to the API contract.
- Replace AI provenance with USER provenance: rejected because it hides how the scenario began.

## Decision: Regeneration remains explicitly pending

**Decision**: Regenerated AI suggestions replace only the current suggestion content, retain
prior review history, and always enter `pending` state. Provider failures preserve the current
scenario and review decision.

**Rationale**: Regeneration is an enhancement request, not approval. Explicit pending state
keeps human ownership and AP-005's provider-failure guarantees intact.

**Alternatives considered**:

- Auto-accept regenerated output: rejected by the human-in-the-loop constitution principle.
- Delete the prior suggestion: rejected because it destroys review traceability.

## Decision: Sensitive-value minimization

**Decision**: Display and diagnostic surfaces use redaction for credential-like headers,
tokens, and explicitly sensitive values. The review model carries test intent, but secrets are
never required for review decisions.

**Rationale**: Reviewers need to understand intent and contract coverage, not inspect secret
material. This follows the existing local-first and sensitive-logging constraints.

**Alternatives considered**:

- Display all request values verbatim: rejected because generated examples may contain tokens
  or secrets.
- Drop all request details: rejected because request intent is necessary for a useful review.
