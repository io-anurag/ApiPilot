# Validation: Unified Performance Tab (AP-047)

Results are recorded as work proceeds. Nothing here is claimed unless the command was run.

## Baseline (T001, 2026-10-11, before any change)

- `npx vitest run` (whole repository): 380 files, 3,169 tests: 376 files passed, 3 skipped, 1 failed; 3,158 tests passed, 10 skipped, 1 failed.
  The one failure was `frontend/tests/unit/sectionCatalog.test.ts` "keeps Tailwind palette and raw neutral utilities out of components":
  a 5,000 ms timeout while scanning component sources during a full-suite run that overlapped with edits. It is a timing test, not a defect.
- `npm run lint` and `npm run build`: not run at baseline (the background run was cut short); they are run at the end (T059).

## Final run (2026-10-11, after all tasks)

- `npm run lint`: passes. `npm run build`: passes (all three workspaces).
- `npx vitest run` (whole repository), first full run: 391 files, 388 passed, 3 skipped; 3,297 tests, 3,287 passed, 10 skipped, none failed.
- Second full run, after the phone-layout fixes: 3,286 passed and one failed: `frontend/tests/unit/apiCoverage/GapsTable.performance.test.tsx`
  (AP-046) measured 1,085 ms against a 1,000 ms budget under full-suite load. It passes alone (run twice). It is a timing test in a feature this
  change does not touch, so it is reported, not changed.
- New or reshaped automated tests: `performancePathState`, `PerformanceStepper`, `usePerformancePath`, `OperationSelection`, `SourcePicker`,
  `SourceStep` (including the replace flow), `PerformancePath`, `PerformanceHome`, `PerformancePlanEditing` (the plan editor's 19 tests, moved onto
  the path), `PerformancePlanOperations`, `PerformanceSources`, `PerformanceDraft`, `requestChainClient` (reselect), `EntryChooser`, `App`,
  `workflowCatalog`, `paletteCommands`; shared-domain `requestChain` (edit-state helpers); backend `chainPlanReselect` (24 integration tests) and
  `reselectService` (11 unit tests).

## Live browser session (headless Chrome over the DevTools protocol, real backend with the mock AI provider)

Driven in this order: start screen, Performance entry screen, OpenAPI specification source, upload (`quick-performance.yaml`, 13 operations),
Operations with a filter, Next (plan created and saved), Plan step, Change operations (opens, takes focus, cancels), Load, Run (launch card), back
to the plans (plan listed), then the same in dark and at 390 px.

- Start screen: four cards, exactly one Performance card. Entry screen: sources, introduction, no empty table. Operations: 13 of 13 selected, the
  filter showed 6 for "orders". The Plan step showed Saved and "Seeded from quick-performance.yaml". Run: "Not ready to run yet" with its reason.
- Light, dark and phone width read correctly in the screenshots. At 390 px no page scrolled sideways after two fixes: the plans table's `sr-only`
  Actions header was positioned outside its scroll container (containers are now `relative`), and the chain workbench grid had no single-column
  template below `lg` (`grid-cols-1`).

## Not exercised

- A real run: no k6 was started, so progress, result and report states on the Run step are covered only by the existing run-panel tests.
- The guided-workflow and collection sources against the real backend (component tests with stubbed clients only), and the App-level hand-over
  from Import & Run or the guided workflow into Performance.
- Screen readers, and the usability target SC-009 (8 of 10 new users succeed unaided).
- Pre-existing and not changed: at phone width the top tab menu scrolls and the command palette is clipped on the right.

