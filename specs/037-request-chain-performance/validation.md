# Validation: Request-Chain Performance Plans (AP-037)

## Governance

- Constitution v2.8.0 (commit `d0873c3`, contained in `main`) extends XVII's 2026-09-24 exception
  to request-chain plans, with its own meaning of "approved" and its own conditions. Phase one is
  covered.
- Phase two (US5, FR-036 to FR-038) needs the further amendment TODO(XVII_LEGACY_PLAN_TEXT) to remove
  the AP-029, AP-032, AP-033 and AP-036 plan paragraphs. That amendment is expected to be a MAJOR
  bump and must be approved and merged before phase two starts. *(Done: constitution v3.0.0,
  commit `a5e020a`, merged to `main` in PR #59. Its transition paragraph keeps the legacy run
  paths covered by v2.8.0's conditions until phase two is merged.)*

## SC-006

Measured with `node scripts/count-performance-lines.mjs`: non-test `.ts`/`.tsx` lines, counted as
`wc -l` counts them, over plan.md's "SC-006 measured set". Paths that do not exist yet count 0.

| When | Backend | Frontend | Shared | Total | Notes |
|---|---|---|---|---|---|
| 2026-10-03, before AP-037 | 7,396 | 7,608 | 1,106 | 16,110 | Baseline; matches plan.md. Original target after phase two: 8,055. |
| 2026-10-03, after phase one | 10,337 | 10,260 | 1,760 | 22,357 | +6,247: the chain plan code sits beside the legacy plans until phase two removes them. |

**Revised target (agreed 2026-10-03): at most 13,000 lines after phase two.** The original target
of 8,055 is out of reach without removing required behaviour, which SC-006 forbids. Projection:
the files research R24 lists for removal total 8,737 lines today. Removing the old `/plan*` and
`/script*` routes, the collection page and its client, and trimming the shared types is estimated
at about 1,000 more. That gives about 12,500 to 13,500 after phase two. This is an estimate; T099
measures the result.

## Security self-review (T091, 2026-10-03)

Reviewed against the uncommitted diff. Security-relevant changes are flagged for the reviewer.

| Check | Result |
|---|---|
| Every new route is session-scoped | Pass. Plans, data sets and runs are read through `getSessionId()` (`chainPlanStore`, `chainPlanDataSetRepository`, `performanceRunRepository.getChainRun/listChainRuns/getChainInProgress/requestChainCancel`). Another session's id is `404`. `tests/integration/performance/chainPlanRoutes.test.ts` covers reading and saving another session's plan; the data set and run routes use the same session-scoped lookups but have no cross-session test of their own. Plans and data sets are deleted with the session (`onExpire`). |
| Upload limits | Pass. `multer.memoryStorage()` with `fileSize` = 5 MiB and `files: 1`; `LIMIT_FILE_SIZE` answers `413 data_set_too_large` instead of reaching the central handler. The CSV parser then enforces 100,000 rows and 50 columns, and a plan holds at most 5 data sets. The route-specific JSON limit is 8 MiB, larger than the global one, for whole-plan saves only. |
| Run copy of data sets | Pass, with a platform note. Each `apipilot-data-<i>.json` is written with `mode: 0o600` into the run directory after the script integrity check, and `removeRunDirectory` in `startPerformanceRun`'s `finally` removes it however the run settles. On Windows, Node maps the mode to the read-only attribute only, so the file is protected by the user profile's directory ACL rather than by the mode. |
| No value in logs | Pass. The new logger calls (`chain_plan_created/saved/seeded/duplicated/deleted`, `chain_data_set_stored/refused`, `chain_script_generated`, `chain_run_restored`, `performance_run_unhandled_error`) carry ids, counts, durations, a refusal reason and line number, and an error class name only: no names, URLs, headers, step content, column names, file names or values. `chainLeakScan.test.ts` feeds sentinels through every route and the logs and finds none. |
| Report frame | Pass. `PerformanceReportFrame` (`sandbox=""`) is unchanged and is reused by `ChainRunPanel`; the chain report is rendered by `renderChainReport` with the legacy escaping helpers. |
| `CHAIN_RUNTIME` has no plan-dependent text | Pass. It is a `String.raw` constant with no `${…}` substitution; plan content reaches the script only as `JSON.stringify` data tables. `renderChainScript.test.ts` checks every script ends with the same runtime and never contains the plan name or seeding report text. |
| Credentials at rest | Flagged for review. Literal `Authorization`, `Proxy-Authorization`, `Cookie` and seeded password values are moved into secret environment values on save or seed (encrypted by the existing environment store). Plans, data sets and run plan copies are encrypted with the existing credential cipher (AES-256-GCM); only names, counts, revisions, fingerprints and SHA-256s are stored plain. |
| Outbound hosts | Unchanged boundary. A run sends only to the target environment's base URL and to hosts written literally in step URLs; the run trigger lists every host (FR-029). A host taken from a variable other than `{{baseUrl}}` is a blocker. |

## Validation runs

Each command and its outcome, exactly as run.

All on Windows 11, Node 24, at version 19.18.0, after the version bump, on 2026-10-03.

| Command | Outcome |
|---|---|
| `npm test` (root) | Exit 0. 345 test files passed, 3 skipped; 2,893 tests passed, 20 skipped. |
| `npm run lint` (root) | Exit 0, no findings. |
| `npm run build` (root) | Exit 0; the frontend bundle built. |
| `K6_TEST_REAL=1 npm run test:k6-real -w backend` | Exit 0 with k6 v2.3.0 (windows/amd64). 1 file, 17 tests passed, none skipped: the 13 earlier cases and the 4 request-chain cases (10-virtual-user journey with no 401 or 404; setup step failure, k6 exit 108, `setup-step-failed`; check counts with the stub's wrong-id and slow switches; data set rows and wrap). |
| `git diff --stat backend/tests/fixtures/performance/golden/` | Empty: the legacy goldens are byte-identical. The three new files (`chain-script.js`, `chain-script-data.js`, `chain-environment-template.json`) are untracked additions. |
| `node scripts/count-performance-lines.mjs` | 22,357 (see SC-006). |

## Browser walkthrough (T093)

**Scripted walkthrough, 2026-10-03.** At the user's request, quickstart scenarios 1 to 9 were driven
through the real UI with Playwright 1.63 (Chromium, headless, 1400×1000), as a one-off from a
scratch folder. Nothing was added to the repository. It ran against a separate local stack:
- backend on port 4100, with its own SQLite file and `AI_PROVIDER_MODE=mock`;
- frontend on port 5180;
- three `customers-auth` stubs on ports 4601 (normal), 4602 (`WRONG_ID_EVERY=10`, `SLOW_EVERY=5`)
  and 4603 (`TOKEN_STATUS=401`);
- k6 v2.3.0.

Each check read the screen, the API, the stub's counts or the backend log, and screenshots were
reviewed.

| Scenario | Checks | Notes |
|---|---|---|
| 1 Build the US1 chain by hand | 13/13 | `{{` suggestions (token, environment names, dynamic variables) usable with the keyboard alone, list 240 px tall; same SHA-256 twice; 2 VUs: tokens issued 1, 401 0, 404 0, created = replaced = deleted. |
| 2 Fix a weak specification | 11/11 | 7 single-step chains named by operation; edits marked Changed, added step Added by you; `tenant_id` required; a second seed left the first plan byte-identical. |
| 3 Literal credentials | 9/9 | Save refused without an environment; moved to `authorization_s1` of Local stub 1; `abc123` absent from the plan, script, template and backend and frontend logs. |
| 4 Checks | 9/9 | `id` check failed 2 times, equal to the stub's 2 wrong ids; time check failed 5 times; body-contains 0; statuses all expected; every chain completed. |
| 5 Setup failure | 5/5 | Failed, "a Once before load step failed", report names Auth Token and "unexpected status"; one request in total, no customer request, no retry. |
| 6 Seed from a collection and the guided workflow | 10/10 | Chains Auth, Customers, then the root requests; extractors, statuses and folder auth carried over; removing the collection left the plan unchanged. The ApiFoundry fixture has no pre-request script, so that check used a copy with one added: it was listed. Guided: one workflow chain whose `orderId` extractor is referenced, plus single-step chains. |
| 7 CSV data sets | 9/9 | 50 rows, 6 columns; password hidden in the preview; short row refused with "Line 7: expected 6 fields, found 5."; 5 VUs: takes 19,524 = iterations, 50 rows used, wrapped; no password value anywhere checked; a replaced file left the script SHA-256 unchanged. |
| 8 Saved plans survive a restart | 4/4 | Backend restarted; plan, data set and seeding report unchanged; script not generated; regenerated SHA-256 identical. |
| 9 Run again and restore | 7/7 | Run again offered with the write list; refused after an edit; restore brought the step back, regenerated the script and started no run. |

**Defects found and fixed during the walkthrough** (each with a regression test):
- **Saved shown while saves were refused.** The editor said Saved while every save was being refused
  (`422`), so a reload lost the work. It now says **Not saved** and blocks generation until the
  error is fixed (`ChainPlanEditor.tsx`).
- **A blank row blocked every save.** A row added with **+ Add header** and left empty made the
  server refuse every later save. Rows with neither name nor value are no longer sent
  (`chainEditing.ts`).
- **Run again offered on an out-of-date script.** After an edit marked the script out of date, Run
  again was still offered, because its SHA-256 matched the run's. It is now refused with "The script
  changed since this run." (`ChainRunPanel.tsx`).
- **Raw step ids on the run trigger.** The trigger's write list named steps by id (`s1`, `s2`). It now
  shows each step's method and URL (`WriteOperationSummary.tsx`, `CountedOperationList.tsx`).
- **Raw step ids in the report's findings.** The slowest-step and missing-data findings named chain
  steps by id. They now use the step's label, and legacy reports are unchanged (`findings.ts`).
- **Reported by the user and fixed before the scripted run:**
  - the `{{` suggestion list was clipped inside the headers table;
  - the environment picker displayed the first environment when none was chosen;
  - the plans list and editor were restyled to match the other performance screens.

**After the fixes:** `npm test` passed 346 files and 2,901 tests, with 20 skipped. `npm run lint` is
clean and `npm run build` succeeds. The legacy goldens are unchanged. Real k6 was exercised by
scenarios 1, 4, 5 and 7. `npm run test:k6-real` was not re-run, since no runtime code changed.

**Accepted (2026-10-03).** Constitution XXXI asks for a manual browser walkthrough. The user accepted
this scripted walkthrough, with screenshot review, as T093. Phase one is complete. The fixes above
shipped as version 19.18.1.
