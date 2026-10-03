# Validation: Request-Chain Performance Plans (AP-037)

## Governance

- Constitution v2.8.0 (commit `d0873c3`, contained in `main`) extends XVII's 2026-09-24 exception
  to request-chain plans, with its own meaning of "approved" and its own conditions. Phase one is
  covered.
- Phase two (US5, FR-036 to FR-038) needs the further amendment TODO(XVII_LEGACY_PLAN_TEXT) to remove
  the AP-029, AP-032, AP-033 and AP-036 plan paragraphs. That amendment is expected to be a MAJOR
  bump and must be approved and merged before phase two starts.

## SC-006

Measured with `node scripts/count-performance-lines.mjs`: non-test `.ts`/`.tsx` lines, counted as
`wc -l` counts them, over plan.md's "SC-006 measured set". Paths that do not exist yet count 0.

| When | Backend | Frontend | Shared | Total | Notes |
|---|---|---|---|---|---|
| 2026-10-03, before AP-037 | 7,396 | 7,608 | 1,106 | 16,110 | Baseline; matches plan.md. Target after phase two: 8,055 (or as agreed after phase one). |
| 2026-10-03, after phase one | 10,337 | 10,260 | 1,760 | 22,357 | +6,247: the chain plan code sits beside the legacy plans until phase two removes them. |

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

Not performed. No browser was available to the implementing agent, so quickstart scenarios 1 to 9
have not been walked through in a browser. The automated suites above cover the same behaviour at
the component and route level, but that does not substitute for the walkthrough (constitution
XXXI). The feature is therefore not recorded as Implemented in the ROADMAP.
