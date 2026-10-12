# Quickstart: Validating Guided Workflow Run Stage Status

Run from the repository root. These steps prove the feature end to end; the automated checks are listed in `tasks.md`.

## Automated

```bash
npx vitest run backend/tests/unit/testGenerationWorkflow/runCompletion.test.ts
npx vitest run backend/tests/integration/workflowRunStageStatus.test.ts
npx vitest run frontend/tests/unit/TestGenerationWorkflowPage.test.tsx frontend/tests/unit/ExternalCollectionUpload.test.tsx
npm test && npm run lint && npm run build
```

Expected: the completion-rule tests cover every row of the tables in [data-model.md](data-model.md); the integration test drives a workflow to Postman Generation, uploads with and without `workflowId`, settles runs, and reads the stage statuses; the page test shows the tracker change after a visibility switch and after a poll, and stops polling once both stages are complete.

## Manual (browser)

1. Start the app (`npm run dev`), upload a specification, and take the guided workflow to Postman Generation. Generate the collection.
2. Click **Continue to Import & Run Collection**. The stage tracker shows Execution **Active — return**, Performance Testing **Not yet reached — open**.
3. In Import & Run, submit the pre-filled upload, run it, and let it finish. Go back to the guided workflow tab, with no reload: Execution is **Complete**.
4. Repeat from step 2, but cancel the run: Execution stays Active.
5. Upload the same collection file by choosing it with the file picker instead, and run it: Execution is unchanged.
6. Open the Performance tab, create a plan from the Guided workflow source (or from the same specification), run it and let it finish or cancel it. In the guided workflow, Performance Testing is **Complete**.
7. Create a plan from a different specification or a collection and run it: no stage changes.
8. With the guided workflow on screen in one browser tab, finish a run from a second tab: within 5 seconds the first tab shows the change.

## Contract checks

See [contracts/changes-to-existing-apis.md](contracts/changes-to-existing-apis.md): `POST /api/external-collections` with a malformed `workflowId` returns `400 invalid_request` and creates nothing; the `201` body has no `sourceWorkflowId`.
