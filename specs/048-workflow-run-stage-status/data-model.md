# Data Model: Guided Workflow Run Stage Status

One new stored field, one new allowed transition, and no new entity.

## UploadedCollectionSet (specs/026), amended

| Field | Type | Notes |
|-------|------|-------|
| `sourceWorkflowId` | `string`, optional | The id of the guided workflow whose hand-off this upload was made from. Absent for any other upload. Never returned in `UploadedCollectionSummary`. |

- Stored in a new nullable `source_workflow_id` column on `uploaded_collections`, added with the existing idempotent `addColumn` helper. Rows from before this feature read as absent.
- Validation: when present, matches `^wf-\d+-\d+$` (the workflow id shape). A malformed value is rejected with `400 invalid_request`.
- Lifetime: removed with the upload and with the session, as today.

## Stage transition (specs/009 data-model.md), amended

| Stage | Added transition | Trigger |
|-------|------------------|---------|
| `performanceTesting` | `not-yet-reached -> complete` | A request-chain run seeded from this workflow's specification reaches any final state, and `postmanGeneration` is `complete`. |

Existing transitions are unchanged. `execution` uses its existing `active -> complete`.

## Completion rules (pure, in `testGenerationWorkflow/runCompletion.ts`)

Both rules take the current workflow and the facts of one settled run, and return whether to change a stage. Applying the result is a separate step, so the rules are testable without a store.

**Execution** — inputs: the upload's `sourceWorkflowId`, the run's status.

| Condition | Result |
|-----------|--------|
| status is not `completed` (a cancelled run, or one still in progress) | no change |
| `sourceWorkflowId` absent, or not equal to the current workflow's id | no change |
| `execution` status is `active` | set `complete` |
| `execution` status is anything else (`skipped`, `complete`, `stale`, `not-yet-reached`) | no change |

**Performance Testing** — inputs: the run's status and seed source.

| Condition | Result |
|-----------|--------|
| status is `in-progress` | no change |
| seed is `null` or `collection` | no change |
| seed is `workflow` and its title differs from `apiModel.info.title` | no change |
| seed is `specification` and its filename differs from `specificationFilename` | no change |
| `postmanGeneration` is not `complete` | no change |
| `performanceTesting` is `complete` | no change |
| otherwise (`not-yet-reached`, or `active`) | set `complete` |

## Not stored

No run id, result, request, response, credential or collection content is written to the workflow (FR-015). The stage's own `completedAt` is the only trace.
