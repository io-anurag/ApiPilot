# Contract: Reselect operations on a plan (additive)

Base: `/api/chain-plans` (see `specs/037-request-chain-performance/contracts/chain-plan-api.md`). Everything else in
that contract is unchanged. Conventions (JSON bodies, error shape `{ error, message }`, no stack traces or paths) are
those of the existing chain-plan routes.

## `POST /api/chain-plans/:planId/reselect`

Applies a new operation selection to a plan seeded from a specification, keeping the engineer's work (merge) or
rebuilding the chains from the selection (reset). Specification plans only in this delivery.

**Request**

```json
{
  "revision": 7,
  "mode": "merge",
  "selectedOperationKeys": ["GET /pets", "POST /pets"],
  "confirmRemoveEdited": false
}
```

- `revision` (required): the plan revision the engineer was looking at.
- `mode` (required): `"merge"` or `"reset"`.
- `selectedOperationKeys` (required, non-empty, each a known operation key of the session's uploaded specification;
  duplicates ignored; applied in specification order).
- `confirmRemoveEdited` (optional, default `false`, `merge` only): the engineer confirmed removing edited chains.

**Responses**

| Status | Body | When |
|---|---|---|
| `200` | `{ plan, analysis, script, added: string[], removed: string[], keptEdited: string[] }` | Applied. The saved plan is returned like `PUT /:planId`; `script` is its status, marked `outOfDate` because the chains changed, or `null` when none was generated |
| `422 invalid_plan` | `{ error, message, field }` | A missing or malformed `revision`, `mode`, `selectedOperationKeys` (empty, not text, or an unknown operation key) or `confirmRemoveEdited`, as the other plan routes refuse a field. Nothing is changed |
| `404 chain_plan_not_found` | | No such plan |
| `404 quick_test_not_found` | | No specification is uploaded in this session |
| `409 plan_revision_conflict` | as for `PUT /:planId`, with `current` | Stale `revision` |
| `409 edited_steps_would_be_removed` | `{ error, message, edited: ReselectEditedRemoval[] }` | `merge` would remove steps the engineer edited (`changed`) and `confirmRemoveEdited` is not `true`. Each entry names the chain, step, step name and operation key. Nothing is changed |
| `409 plan_source_not_supported` | | The plan was not seeded from a specification (workflow, collection, empty plan) |
| `409 plan_source_changed` | `{ error, message, planSource, currentSource }` | The plan's recorded source file (`seedingReport.source.filename`) differs from the session's uploaded specification. Nothing is changed |

**Behaviour** (semantics table in `data-model.md`):

- Determinism: the same plan and selection always produce the same result; no clock or random value other than the
  plan's own id counters (new chains take the next `c<n>` and `s<n>`, ids are never reused).
- Seeded chains the engineer did not edit and that stay selected are not rewritten.
- A step is removed with its chain when seeding made the chain and nothing else is in it; a chain the engineer made, or one that still holds a step, stays.
- Data sets, load profile, run-wide thresholds, environment, name and runs are never changed. A threshold scoped to a step that is removed goes with the step; `reset` also removes the engineer's own chains.
- Credentials are not moved into environments by this call: a literal credential found while seeding a newly
  selected operation is dropped and listed in the plan's seeding report, as when no environment was chosen.
- The saved plan's seeding report gains the report items of the newly seeded operations and keeps the earlier ones.
- Event logged (no content): `chain_plan_reselected` with `planId`, `mode`, counts of added, removed, kept-edited.

**Tests required** (contract tests with Supertest, mock-free of AI): merge keeps an edited kept chain byte-for-byte;
merge appends new chains in specification order; merge refuses removal of an edited chain without confirmation and
changes nothing; same call with `confirmRemoveEdited: true` removes it; reset rebuilds and keeps data sets, load
profile and thresholds; stale revision returns `plan_revision_conflict`; non-specification plan returns
`plan_source_not_supported`; a plan whose recorded source file differs from the uploaded specification returns
`plan_source_changed` and is unchanged; credentials chain added, kept and removed per the table.
