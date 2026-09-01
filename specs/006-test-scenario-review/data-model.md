# AP-006 Data Model

## Review State

A review state is the current decision for one scenario:

- `pending`: no active approval decision exists, or the scenario changed and requires review.
- `accepted`: the reviewer has explicitly accepted the current scenario revision.
- `rejected`: the reviewer has rejected the current revision and supplied a reason.

Only `accepted` scenarios are eligible for an approved TestModel. State is separate from
`Provenance` and never changes whether a scenario originated from a rule, AI, specification, or
user edit.

## Review Scenario

A Review Scenario wraps a stable TestScenario identity with workflow metadata:

| Field        | Meaning                          | Invariant                                                         |
| ------------ | -------------------------------- | ----------------------------------------------------------------- |
| `scenarioId` | Referenced TestScenario ID       | Must identify one scenario in the source TestModel                |
| `revision`   | Current editable revision number | Starts at 0 and increases after a successful edit or regeneration |
| `state`      | Current ReviewState              | Exactly one of pending, accepted, rejected                        |
| `decision`   | Current decision metadata        | Required for accepted/rejected; absent for pending                |
| `history`    | Prior decisions and edits        | Ordered oldest to newest; retained for traceability               |

## Review Decision

A decision contains:

- `state`: `accepted` or `rejected`.
- `reason`: required and non-empty for rejection; optional for acceptance.
- `actor`: reviewer identity supplied by the calling workflow, when available.
- `recordedAt`: decision timestamp supplied by the review boundary.
- `revision`: scenario revision on which the decision was made.

The active decision is replaced by a later explicit decision. Previous decisions remain in
history and cannot become active again without a new update.

## Review Edit

An edit records:

- the prior scenario revision;
- the resulting supported TestScenario intent;
- the editor identity and timestamp when available;
- the original provenance;
- user-modified provenance or an equivalent explicit user-edit marker.

Edits must pass ApiModel and supported test-intent validation before becoming the current
revision. Failed edits do not increment the revision or mutate the last valid scenario.

## Review Policy

A policy identifies approval requirements by origin and category. The initial default policy
requires explicit acceptance for AI-derived and user-defined scenarios. Deterministic,
specification-backed or rule-derived scenarios may be eligible for streamlined review, but the
policy must still make their eligibility explicit and must not silently treat pending scenarios
as approved.

## Review Summary

For one workspace, the summary contains:

- `total`: all scenarios in the workspace;
- `pending`: scenarios awaiting a decision;
- `accepted`: scenarios eligible for the approved set;
- `rejected`: scenarios excluded from the approved set;
- `requiresReview`: scenarios requiring explicit human action under policy.

Counts are recalculated from current states and must sum to `total`.

## Review Workspace

A workspace contains:

- one source `TestModel` and its associated `ApiModel` context;
- review scenarios keyed by immutable scenario ID;
- active Review Policy;
- Review Summary;
- filters/search state at the presentation boundary;
- a workspace revision used to detect stale updates.

The source generated TestModel is not mutated. The workspace produces an approved TestModel
view containing only eligible accepted scenarios when requested.

## Regeneration Request

A regeneration request identifies one AI-derived scenario and the revision being replaced. A
successful response creates a new pending revision while preserving the old scenario and review
history. An unsuccessful response leaves the current scenario, revision, and decision unchanged.

## Validation Rules

- Scenario IDs must exist in the source TestModel and remain stable during a workspace session.
- Updates must include the revision observed by the caller; mismatches produce a stale-update
  result and do not overwrite current state.
- Rejection reasons must be non-empty after trimming.
- An accepted set must contain no equivalent duplicate executable scenarios.
- Pending and rejected scenarios must never appear in the approved TestModel.
- AI provenance must remain distinguishable after edits and regeneration.
- Sensitive request values must be redacted at display and diagnostic boundaries.
