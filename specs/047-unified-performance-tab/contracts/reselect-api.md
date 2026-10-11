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
| `200` | `{ plan, analysis, script: null, added: string[], removed: string[], keptEdited: string[] }` | Applied. The saved plan is returned like `PUT /:planId`; `script` is `null` because the chains changed |
| `400 invalid_request` | `{ error, message }` | Missing or malformed fields, empty selection, unknown operation key |
| `404 plan_not_found` | | No such plan |
| `404 quick_test_not_found` | | No specification is uploaded in this session |
| `409 plan_revision_conflict` | as for `PUT /:planId`, with `current` | Stale `revision` |
| `409 edited_steps_would_be_removed` | `{ error, message, edited: ReselectEditedRemoval[] }` | `merge` would remove edited chains and `confirmRemoveEdited` is not `true`. Nothing is changed |
| `409 plan_source_not_supported` | | The plan was not seeded from a specification (workflow, collection, empty plan) |

**Behaviour** (semantics table in `data-model.md`):

- Determinism: the same plan and selection always produce the same result; no clock or random value other than the
  plan's own id counters (new chains take the next `c<n>` and `s<n>`, ids are never reused).
- Seeded chains the engineer did not edit and that stay selected are not rewritten.
- Data sets, load profile, thresholds, environment, name and runs are never changed.
- Credentials are not moved into environments by this call: a literal credential found while seeding a newly
  selected operation is dropped and listed in the plan's seeding report, as when no environment was chosen.
- The saved plan's seeding report gains the report items of the newly seeded operations and keeps the earlier ones.
- Event logged (no content): `chain_plan_reselected` with `planId`, `mode`, counts of added, removed, kept-edited.

**Tests required** (contract tests with Supertest, mock-free of AI): merge keeps an edited kept chain byte-for-byte;
merge appends new chains in specification order; merge refuses removal of an edited chain without confirmation and
changes nothing; same call with `confirmRemoveEdited: true` removes it; reset rebuilds and keeps data sets, load
profile and thresholds; stale revision returns `plan_revision_conflict`; non-specification plan returns
`plan_source_not_supported`; credentials chain added, kept and removed per the table.
