# Validation: Edit a Performance Step's Request Body (AP-033)

**Feature**: [spec.md](./spec.md) | **Tasks**: [tasks.md](./tasks.md) T057 to T059 | **Quickstart**: [quickstart.md](./quickstart.md)

This records the validation that constitution XXXI requires before AP-033 is recorded as
Implemented. Nothing below is estimated. A check that was not run says so.

Date: 2026-09-29. Machine: Windows 11 Pro 10.0.26200, Node.js 24, working tree on branch `AP-033`
at version 19.10.0, uncommitted.

## Automated suites (T057)

| Command | Result |
|---|---|
| `npm test` | 2,043 passed, 0 failed, 7 skipped (2,050 tests across 266 test files: 263 passed, 3 skipped). Before this feature: 1,960 passed, 1 failed, 6 skipped. The earlier failure, the CRLF golden-template comparison (ROADMAP entry 35), no longer occurs: the root `.gitattributes` pins the golden fixtures to LF. |
| `npm run lint` | Clean (0 errors, 0 warnings). |
| `npm run build` | Clean (shared-domain `tsc`, backend `tsc`, frontend `tsc` and `vite build`). |
| `npm run test:k6-real -w backend` | 4 of 4 passed (below). |

The test files this feature added or changed also type-check under a temporary configuration that
includes them, because neither workspace's own `tsc` covers its tests. Doing this found the
existing `puts` helper in `frontend/tests/unit/PerformancePlanScreen.test.tsx`, typed so that its
calls had no `body`, which made six existing and two new lines fail to type-check. The helper is
now generic.

The reviewed golden files (`backend/tests/fixtures/performance/golden/`) are byte-identical, and a
plan with no body edits keeps the fingerprint it had before AP-033. A unit test asserts both the
guided and quick fingerprints against values captured before the change (research R10).

## Real-k6 check (quickstart scenario 9)

**Status: passed.** k6 `v2.3.0` (commit e088784614, go1.26.8, windows/amd64). The three existing
cases passed unchanged. The new case drives a quick test through `/api/quick-performance`:
- it edits the `POST /orders` body to `{"customerEmail": "edited@example.com", "quantity": 9, "note": "AP-033 edited"}`;
- it generates the script and runs a 3-second smoke profile against a local `TargetServer`.

Every `POST /orders` the target received carried `quantity: 9` and the note. Its `customerEmail`
was still varied per virtual user and iteration (`edited+vu<n>-it<n>@example.com`), so a unique
field keeps working in an edited body.

## Security review of the diff (T058)

- **Logging (R14):** no new log call. The only change to logging is `bodyEditCount` on the existing
  `performance_plan_built` event. No body text, parser message or value is logged.
  `InvalidBodyEditError` messages never quote the engineer's text: the JSON error is ApiPilot's
  own "Not valid JSON at line L, column C.", with the offset from the iterative `jsonErrorOffset`.
- **No body in stored runs (R11, FR-014):** `planSnapshotForRun` empties `bodyEdits`. Tests seed a
  marker string in an edited body and assert that the stored `performance_runs` row, the run
  response and the report never contain it.
- **No secret anywhere (SC-003):** an end-to-end test references a secret environment value from
  an edited body (`{{accountPin}}` in a `format: password` field). The seeded secret appears in
  none of these: the plan, the preview, the values checklist, the script, the template, the run
  response, the stored row or the report.
- **Data-only embedding (R5, FR-013, XVII v2.5.0):** a body with `"`, `\`, a backtick, `${1}`,
  `</script>`, `*/`, U+2028, U+2029 and `); throw new Error("ran"); (` renders a script that loads
  in the k6 sandbox and sends the body byte for byte.
- **Denial of service:**
  - bodies are limited to 64 KiB and 50 levels of nesting;
  - the nesting depth and the JSON error offset are computed without recursion (a 30,000-deep
    bracket body is refused without exhausting the stack);
  - a specification's `pattern` is never compiled or evaluated (a test uses an invalid pattern
    that would throw);
  - the format checks are fixed and linear, with `email` and `hostname` checked without regular
    expressions.
- **Code hygiene:** no `any`, no `eslint-disable`, no inline styles and no new dependency in the
  diff.

**Sonar warnings:** the IDE's SonarLint flagged cognitive complexity in `applyPlanUpdate`,
`buildStepRequestPreview`, `JourneyList`, `PerformancePlanScreen` and `OtherOperationsTable`. All
of these were already over the limit before this feature. New helpers that went over the limit were
split up (`bodySchemaMismatches`, `userSuppliedValues`, `errorExtras` in the client, and `makeStep`'s
parameters). The warnings on the existing functions remain.

## Manual walkthrough (T059)

**Status: outstanding.** Quickstart scenarios 1 to 8 need a browser walkthrough by the user,
including the SC-001 timing in scenario 2. Until then AP-033 is "Implementation complete, manual
walkthrough pending".

## Deviations from tasks.md, recorded

- T015, T018 and T035: the route tests and the seeded-secret scan are in a new
  `backend/tests/integration/performance/bodyEditRoutes.test.ts`, instead of cases spread across
  `quickRoutes.test.ts`, `planRoutes.test.ts` and four AP-032 files.
- T039a was added at the start of `/speckit-implement` for the user's decision to classify
  engineer-written references as `body-reference` (research R4).
- The editor model gained `replacements`, the fields ApiPilot fills at run time, so the editor can
  name the fields FR-009 requires (data-model.md).
- Research R6 gained a 50-level nesting limit, found while implementing (stack safety).
