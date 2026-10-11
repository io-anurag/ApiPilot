# Quickstart: validating the unified Performance tab (AP-047)

References: spec `spec.md`, contract `contracts/reselect-api.md`, state rules `data-model.md`, design
`mock-unified-performance.html` (illustrative: see `research.md` R1, R5, R6 for where the real product differs).

## Prerequisites

```bash
npm install
npm run dev            # backend and frontend; mock AI provider by default
```

No model download or network access is needed. Use a small OpenAPI 3.x YAML with at least one POST, one PUT or DELETE,
and a token operation (a login), and a Postman collection and environment for the collection checks.

## Automated checks

```bash
npm test                      # unit, contract (Supertest) and component tests
npm run lint
npm run build
```

Expected: all pass; the reshaped tests listed in `research.md` R13 assert the unified tab; the reselect contract
tests in `contracts/reselect-api.md` pass.

## Manual scenarios (run in light and dark, and at phone width)

1. **First plan from a specification (US1)**: open Performance with no plans and no upload. Pick OpenAPI
   specification; the path opens on Source, Next is locked. Upload; Operations opens with all operations selected.
   Filter, clear all, tick two; Next creates a saved plan and opens Plan. Move to Load, then Run; Start shows the
   named environment and the write steps beside it. Start a run against the stand-in API; a result with a text
   verdict appears. Expected: zero tab changes.
2. **Reuse the upload (US1.2)**: Back to the entry screen, pick OpenAPI specification again: the path opens on
   Operations, Source is clickable and shows the file name and operation count.
3. **Open a saved plan (US2)**: Open it from the list; it lands on Plan with a "seeded from" label; Source is
   read-only. Select Run directly. Expected: two interactions to reach Run.
4. **Merge keeps edits (US3)**: edit a step's header, reorder chains, then Change operations: add one operation,
   remove an unedited one, apply. Expected: the edited step is unchanged, the new chain is last, "edited by you" shows.
5. **Edited removal warning (US3.5)**: untick the operation whose step you edited, apply. Expected: a dialog names
   the edited chain; Cancel changes nothing; Confirm removes it.
6. **Reset to seed (US3.2)**: choose Reset to seed; the dialog states what is kept (data sets, load profile,
   thresholds, runs) and lost; confirm; the badge clears. Cancel changes nothing.
7. **Draft parking (US5)**: start a test, stop on Operations, go "← Plans": the Resume banner appears and the Start
   card shows a draft badge. Pick another source: a confirmation appears; Cancel keeps the draft. Switch tabs and
   return: unchanged.
8. **Replace the specification (US6)**: with plans and runs present, upload a different specification; confirm.
   Expected: selection resets, plans, runs and reports remain.
9. **Other sources (US4)**: start from an empty plan (opens Plan, Next locked until a step exists); start from a
   collection and from the guided workflow per `research.md` R8; from Import & Run, "Create request-chain plan"
   opens Performance on the Plan step.
10. **Keyboard and screen reader**: operate every step, both dialogs and the side panel with the keyboard alone;
    current step announced; Escape closes dialogs and the panel; no state conveyed by colour only.
11. **Regression**: duplicate and delete a plan (runs and reports kept), legacy runs view still lists old runs,
    seeding report, debug run, script generation and download unchanged.

## Not covered by automation

The usability target in SC-009 and screen-reader behaviour need a manual session. State clearly in the validation
notes which of these were run.
