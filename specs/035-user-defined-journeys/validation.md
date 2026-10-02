# Validation: User-Defined Journeys and Captured Values (AP-035)

Recorded 2026-10-02 (tasks T062, T063), at version 19.16.0, exactly as run.

## Automated checks

| Command | Result |
|---|---|
| `npm test` (first run) | 2,440 passed, 1 failed, 12 skipped. The failure was `tests/integration/execution/executionRuns.test.ts` › "directs requests to whichever environment's baseUrl was actually selected", a 3-second poll under parallel load. It passed alone (16 of 16), and AP-035 does not touch that route. Its fixture `TargetServer` gained a handler hook that is inert when unset. |
| `npm test` (second run) | 2,441 passed, 0 failed, 12 skipped (294 files passed, 3 skipped). |
| `npm test -w frontend` | 514 passed (70 files). |
| `npm run lint` | Clean. |
| `npm run build` | Succeeds. |
| `npm run test:k6-real -w backend` | 9 passed with k6 v2.3.0 (darwin/arm64), run on 2026-10-02 once k6 was installed. These include the two AP-035 cases:<br>• create, replace and delete per virtual user with 0 responses of 404, capture counts matching creates, and no issued id in the script or the metrics (SC-002, SC-005);<br>• every third id dropped, with no bound step sent for those iterations and `cutShortByCapture` of `customer_id` equal to the drops (SC-003).<br>The seven existing cases (AP-029, AP-032 to AP-034) also pass under the FR-033 runtime. |

## Golden fixtures

- `backend/tests/fixtures/performance/golden/script.js` was regenerated once, for FR-033 (research R7). The diff was reviewed:
  - the rendered step data's `produces` became `captures: {key, name, source: {body: [...]}}`;
  - the runtime gained `bodyValue`, `headerValue`, `captured` and the `apipilot_capture` counter;
  - captures are attempted only on an expected status, and a `capture` tag was added to `apipilot_cut_short`.

  Every request template and the environment template are byte-identical.
- `golden/user-journeys-script.js` was added for a plan with a create, replace and delete journey.

## Walkthrough (quickstart scenarios 1 to 7), 2026-10-02

Run against the live dev app (backend `127.0.0.1:4000`, frontend `localhost:5173`), k6 v2.3.0 and
`npm run perf:stub -w backend` in customers mode.

**Scenario 1 in the browser (by the engineer):** every step was confirmed as the quickstart
describes:
- single-step journeys, the FR-031 note and `customer_id` in the values;
- New journey, Add step, "Defined by you";
- the documented fields `id` (marked as matching a later step's parameter) and `name`;
- the binding offering only the earlier capture;
- the refused move and the refused removal, each naming the capture;
- the refused name `1st` and the refused path `items[*].id`.

One unrelated observation: AP-034's refusal of a non-JavaScript upload shows "Unexpected character
' '", which is hard to read as a space. This is a possible follow-up for AP-034.

**Scenarios 1 to 5 and 7 through the HTTP API.** One session drove the same routes the UI calls,
using a scratch script that printed ids, counts and verdicts only. 39 of 39 checks passed:

| Scenario | Checked | Result |
|---|---|---|
| 1 | Journey creation, single-step suppression, bound values leaving the checklist, the capture preview, refusals (order, `capture_in_use`, name, path), Also run on its own | Pass |
| 2 | Two downloads byte-identical (sha256 `914a22d5a4f6…`); capture keys only, no issued id; a rename marks the script out of date | Pass |
| 3 | 2 VUs for 15 s: 18,990 creates, each captured (0 failed); 18,990 PUT and 18,990 DELETE with 0 responses of 404; the report states "path id ← captured customer_id, from POST /api/v1/customers (response field id)" and "In a journey defined by you"; no issued id in the run record or report | Pass |
| 4 | Every 5th id dropped: 15,572 creates, 3,114 failed captures; PUT and DELETE 12,458 each (= successful captures); 0 responses of 404; `cutShortByCapture.customer_id` = 3,114 = runs cut short; the finding names `customer_id` | Pass |
| 5 | Body (`customerId`) and query (`customer`) bindings, a `Location` header capture, a repeated GET as two steps (12,424 requests each, 0 responses of 404), the body editor listing `customerId` under "Replaced at run time", an undocumented path accepted as not documented without blocking the script | Pass |
| 7 | An excluded PUT makes the journey incomplete, naming it; it is left out of a still-generated script; the run's definitions come back unchanged on restore; the run record holds definitions and no captured value | Pass |

The stub's own counters agreed: no 404 in either run.

**Not yet walked through:**
- **Scenario 6** (guided Edit journey and Revert). It is covered by
  `convertWorkflowJourney.test.ts` and `UserJourneys.test.tsx`.
- **Scenario 4's 500-on-create case.** The stub cannot answer 500 on create; the case is covered
  by `renderScript.test.ts` (FR-033).
- **The browser views of scenarios 2 to 7:** pending bar, run trigger note, report frame and
  reset confirmation.

## Found during implementation

- **Path-item parameters (pre-existing limitation).** The OpenAPI analysis reads operation-level
  parameters only, so a path parameter declared on the path item is not in
  `ApiOperation.parameters`. A path binding target is accepted when the operation's path template
  has `{name}` (contracts/plan-journeys-api.md "Documented path parameters").
- **Write summary counts on the guided path.** Two approved workflow journeys could already share an
  operation, so FR-023's per-step count also changes such a guided plan's number. Research R15 was
  corrected.
- **Repeated headers.** The R8 decision (the whole value as k6 reports it) does not depend on how k6
  joins repeated headers, so the real-k6 test does not record that form.
