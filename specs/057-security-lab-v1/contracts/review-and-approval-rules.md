# Contract: Review and Approval Rules

**Status**: behavioural. **Spec**: FR-028 to FR-033, SC-010. Implemented in `backend/src/securityLab/review/` as a pure state
machine plus a persistence-backed service. Research: R7.

## States

`reviewState`: `draft`, `in_review`, `approved`, `rejected`. `executionStatus`: `not_run`, `executed`, `evaluated`. The visible
lifecycle is Draft → In review → Approved → Executed → Evaluated, with Rejected as a side state.

## Transitions (reviewState)

| From | To | Action | Conditions |
|---|---|---|---|
| `draft` | `in_review` | `submit` | version valid |
| `draft` | `rejected` | `reject` | non-empty reason |
| `in_review` | `approved` | `approve` | current version equals the `{id, version}` given; not stale or orphaned; destructive scenarios only with their id in `destructiveConfirmations` |
| `in_review` | `rejected` | `reject` | non-empty reason |
| `in_review` | `draft` | `withdraw` | |
| `approved` | `in_review` | `withdraw` or a material edit | automatic on a material edit |
| `approved` | `rejected` | `reject` | non-empty reason |
| `rejected` | `in_review` | `reopen` | |

Any other transition is refused with `invalid_transition`. A scenario that is `rejected`, stale, orphaned or has an unmet
prerequisite is not executable. AI and user-created scenarios start `draft` (FR-019). Rule-generated scenarios start `draft`;
`submit` is available as a batch action.

## executionStatus

Set by the run service only: `not_run` → `executed` when its last request finishes → `evaluated` when evaluation stores an
outcome. A rerun appends a new result and cycles `executed` → `evaluated`; earlier results are never overwritten. A material
edit resets `executionStatus` to `not_run` for the new version; results stay attached to the version that produced them.

## Versions and approval binding

1. Version 1 is the generated content and is immutable. Every edit creates version n+1.
2. An approval record stores `{version, contentHash, approvedAt, actor, destructiveConfirmed}`.
3. A run plan item is `{id, version}`; the run service refuses an item whose version is not the scenario's current version, whose
   current version has no approval with a matching `contentHash`, or whose `reviewState` is not `approved`.
4. **Material fields** (change ⇒ new version in `in_review`): `operationKey`, `categoryId`, `baseRequest`, `mutations`, `expected`,
   `conditions`, `plannedRequestCount`, `destructive.flag`, `requiredIdentities`. A change in `specificationRevision` or
   `securityBasisHash` (a regenerated version) is also material.
5. **Non-material fields** (change keeps `approved`): `title`, `objective`, `rationale`, `impact`, `suggestedSeverity`,
   `limitations`, `manualInputs`, provenance text. A new version records the edit with author and time.
6. An edit that makes content invalid is rejected with `scenario_invalid` and changes nothing.
7. History shows, per version: author, time, note, whether material, the approval attached (if any) and which version each
   approval applies to (FR-030, acceptance US2-8).

## Batch rules

- The request carries explicit `{id, version}` items. The server never expands a filter.
- A batch `approve` is refused item by item (others proceed) for: a stale version (`stale_version`), a destructive scenario not named in
  `destructiveConfirmations` (`destructive_confirmation_required`), an incomplete or stale or orphaned scenario
  (`not_executable_content`), a wrong source state (`invalid_transition`).
- The UI resolves the current filter through `GET /scenarios/ids`, shows the count and the list, excludes destructive and
  incomplete scenarios from the batch by default with a visible count of each, and requires a second, named confirmation
  to include destructive ones (FR-031, FR-033, XXXII).
- Per-item outcomes are returned and shown; a partial application is never reported as complete.

## Stale and orphaned handling

When no specification is loaded (session expired, backend restarted, nothing uploaded) the comparison is impossible: scenarios are
flagged `specificationNotLoaded`, not stale or orphaned, stay readable, and cannot be approved, edited materially or run
until a specification is loaded (FR-004). Withdraw, reject and deletion remain available. When a model is loaded: operation absent →
orphaned; revision or basis hash differs → stale. Regeneration for a changed model creates version n+1 (state `in_review` for rule origin) for scenarios that still
apply, leaves the prior version and its approval and results intact, and marks scenarios whose operation vanished orphaned.
Nothing is silently re-pointed (spec Edge Cases).

## Test obligations

Transition table (every allowed and every refused pair); approval bound to version hash; material edit withdraws approval and
a non-material one keeps it; stale-version refusal under concurrent edit; batch partial failure reporting; destructive
confirmation at approval and again at run planning; rejected never executable; version 1 immutability.
