# Validation: Quick Performance Test from a Specification (AP-032)

**Feature**: [spec.md](./spec.md) | **Tasks**: [tasks.md](./tasks.md) T076 to T078 | **Quickstart**: [quickstart.md](./quickstart.md)

This records the validation that constitution XXXI requires before AP-032 is recorded as
Implemented. Nothing below is estimated. A check that was not run says so.

Date: 2026-09-28. Machine: Windows 11 Pro 10.0.26200, Node.js 24, working tree on branch `AP-032`
at version 19.6.0, uncommitted.

## Automated suites (T077)

| Command | Result |
|---|---|
| `npm test` | 1,943 passed, 1 failed, 6 skipped (1,950 tests across 262 test files; before this feature: 1,852 passed, 1 failed, 5 skipped across 249 files). The failure is the known CRLF golden-file comparison of `backend/tests/fixtures/performance/golden/environment-template.json` on a Windows checkout with `core.autocrlf=true` (ROADMAP entry 35); it failed identically before this feature. A new test compares both golden files with line endings normalized, and it passes. |
| `npm run lint` | Clean (0 errors, 0 warnings). |
| `npm run build` | Clean (backend `tsc`, frontend `tsc` and `vite build`). |

The test files this feature added or changed also type-check under a configuration that includes
the tests. Neither workspace's own `tsc` covers its tests, and the type errors that remain in other
test files predate this feature.

The golden script's `// Plan fingerprint:` line changed twice, because the fingerprint now covers
the plan's `source` and no longer covers `scope`. The rest of the script is byte-identical to the
reviewed golden file, which also shows that moving the per-step request code into `stepRequestFor`
changed no output.

## Real-k6 check (quickstart scenario 9)

**Status: passed.** k6 `v2.3.0` (commit e088784614, go1.26.8, windows/amd64), at
`D:\Program Files\k6\k6.exe` on `PATH`. `npm run test:k6-real -w backend`: 3 of 3 passed against
a local `TargetServer` on 127.0.0.1:

- AP-029: the version gate accepts the installed k6; the arguments include `--no-usage-report`;
  every metrics line parses with no `url` or `name` tag; a 5-second token is refreshed by each of
  3 virtual users over 20 seconds with no authentication failures.
- AP-029: cancelling stops k6 within 10 seconds.
- AP-032 (new): a quick test driven entirely through `/api/quick-performance`. It uploads
  `quick-performance.yaml`, sets the one missing expected status, generates the script, creates
  an environment, and runs a 5-second smoke profile. The run completes with `planSource: "quick"`
  and more than zero requests.

This is also the first real-k6 run of AP-029's own checks, which its `validation.md` records as not
run (T093).

## SC-001 timing

**Server side only.** Through the routes, the 22-operation `paypal-invoicing-v2.yaml` goes from
upload to a generated script in 189 ms (upload and plan in 182 ms). The time a person needs from
the start screen, including reading the plan, was not measured, because no browser was available.

## Security review (T076)

- No quick-path module imports anything under `backend/src/ai/` (FR-004).
- `POST <base>/runs` in `api/performanceRuns.ts` is the only caller of `startPerformanceRun`, and
  both paths register it through `registerPerformanceRoutes`. No route accepts script content.
- The step preview never reads an environment. A seeded secret is absent from every preview
  (`requestPreview.test.ts`), from both downloads (`quickDeterminism.test.ts`), and from the quick
  run's report (`quickRunRoutes.test.ts`).
- The new log events (`quick_performance_test_created`, `quick_performance_upload_failed`, and
  `planSource` added to existing events) carry counts, categories and the source only. They carry
  no filename, path value, specification content, value or body.
- The environments routes open to a session with a quick test only (`requireEnvironmentAccess`).
  The functional execution routes still require Postman generation (`environments.test.ts`).
- The new `plan_source` column holds no value, so it is not encrypted, like the rest of
  `performance_runs`.

## Manual quickstart (scenarios 1 to 8)

**Status: not performed.** No browser tool was available. The automated suites cover the same
behaviour:

| Scenario | Covered by |
|---|---|
| 1. Start screen to plan, login removed, request preview | `App.test.tsx`, `QuickPerformancePage.test.tsx`, `StepRequestPreview.test.tsx`, `quickRoutes.test.ts`, `buildPlan.test.ts`, `requestPreview.test.ts` |
| 2. Byte-identical output across uploads | `quickDeterminism.test.ts`, `quickScenarioIds.test.ts` |
| 3. Write summary, markers, bulk removal, no-operations state | `WriteOperationSummary.test.tsx`, `PerformancePlanScreen.test.tsx`, `PerformanceRunPanel.test.tsx`, `QuickPerformancePage.test.tsx` |
| 4. Environments without a guided workflow, shared with it | `environments.test.ts`, `QuickPerformancePage.test.tsx` |
| 5. A quick run and its report | `quickRunRoutes.test.ts`, `report.test.ts`, and the real-k6 run above |
| 6. The shared execution slot | `quickRunRoutes.test.ts` |
| 7. Guided stage without the scope choice | `buildPlan.test.ts`, `planRoutes.test.ts`, `PerformanceTestingStage.test.tsx` |
| 8. Lists at scale, upload errors | `CountedOperationList.test.tsx`, `PerformancePlanScreen.test.tsx`, `quickRoutes.test.ts` |

These tests use jsdom and Supertest, so they do not check layout, responsive behaviour or dark
mode in a real browser.
