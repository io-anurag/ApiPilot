# Validation: Run a User-Supplied k6 Script (AP-034)

Recorded 2026-10-01 on Windows 11 with Node.js 24.21.0 and k6 v2.3.0 (`D:\Program Files\k6\k6`).
Version 19.15.0.

## Automated checks (tasks T071)

| Check | Result |
|---|---|
| `npm test` (root, both workspaces in parallel) | 2,295 passed, 2 failed, 10 skipped. The two failures are timeouts, and each passes when run on its own (below). |
| Backend suite alone (`npx vitest run` in `backend/`) | 1,758 passed, 1 failed, 10 skipped: the same Newman timeout as below. |
| Frontend suite alone (`npx vitest run` in `frontend/`) | 493 passed, 0 failed. |
| `npm run lint` | Clean. |
| `npm run build` | Succeeds. Vite warns that the main chunk is 528.42 kB (gzip 137.32 kB), over its 500 kB advisory limit; see "Follow-ups". |
| `npm run test:k6-real -w backend` (opt-in, k6 v2.3.0) | 7 passed, including the two AP-034 cases (T064). |

**The two timeouts.**
- `tests/integration/execution/executionRuns.test.ts`, "runs an approved collection against a
  reachable target…": AP-018, a real Newman run that polls for up to 30 s. It reached about
  32–33 s whenever the full backend suite ran in parallel, and passed alone (24 of 24 in its
  file).
- `tests/integration/execution/executionStage.test.ts`, "reopens a finished/skipped execution
  stage…": 5 s default timeout, also passing alone.

In the first full `npm test`, five frontend tests timed out the same way, and passed when the
frontend suite ran alone (493 of 493).

Neither failing test touches AP-034 code, apart from the one-line `findExecutionInProgress()`
call that replaced the inline slot check. The added test files increase parallel load. The
behaviour on the baseline commit was not measured, so whether these tests were already near
their limits before AP-034 is not confirmed.

## Real-k6 findings during implementation (T064)

- **Named requests and `url`.** k6 sets a named request's `url` tag to its name. The display-name
  rule and host counting were changed accordingly (research R14), and `ip` was added to the
  pinned system tags (R10).
- **`--stage` override.** Command-line `--stage` replaced the script's `vus`/`duration`: 2 virtual
  users held for 3 s against a script asking for 1 VU for 1 s.
- **Exit codes.** A crossed script threshold gave exit code 99 and `scriptThresholdsOutcome:
  "crossed"`. The run is recorded as completed.
- **Modules.** Every allowlisted module imported and ran.
- **Values.** The mapped `API_KEY` reached the target. `console.log(__ENV.API_KEY)` output
  appears in no stored field or report.
- **Generated scripts.** A quick plan's generated script, downloaded and uploaded as a user
  script, was accepted, mapped automatically (`APIPILOT_V_0` → base URL) and completed
  (AP-029 FR-022a).
- **Template change.** AP-029's existing real-k6 cases still pass against the new generated
  template (research R23).

## Security review (tasks T072)

| Item | Result |
|---|---|
| No path logs script content, names, hosts, mapped names, values, k6 messages or console output | Pass. The new events carry ids, counts, rule ids, tiers, statuses and 12-character SHA-256 prefixes only. Request logs use `req.path`, so `?name=` is not logged. stderr is filtered in memory (`stderrFilter.ts`); console lines are dropped unread. |
| Every sensitive column is encrypted | Pass. Content and confirmed hosts in `user_scripts`; snapshot, result and k6 message in `user_script_runs`. Raw-row scans in `userScriptRepositories.test.ts` and `userScriptSettings.test.ts` find no seeded marker or secret. |
| Generated-run argument list and environment unchanged | Pass. `buildK6Args` and `buildChildEnv` pinned tests unchanged and passing. The user-script builders are pinned separately (`userScriptArgs.test.ts`). |
| No `eval` or `Function` constructor in backend or frontend code | Pass (source scan). The editor test spies on `eval`. |
| Upload limit enforced before parsing | Pass. `express.raw` with a 1 MiB limit on both raw routes; editor JSON over 1 MiB gives 413 before the check. `checkUserScript` also rejects over 1 MiB first. |
| `Content-Disposition` file names sanitised | Pass. Reduced to `[A-Za-z0-9._-]`, at most 80 characters, then `.js`. |
| Script content in the browser | Rendered as text (`CodeBlock`, textarea). The report is server-escaped HTML in a `sandbox=""` iframe with a strict CSP. The content routes send `text/plain` or `application/javascript` with `nosniff` and `no-store`. |
| Child environment | Start-up allow-list plus validated mapped names. `K6_*` and start-up names are refused in the mapping and filtered again in `buildUserScriptChildEnv`. Values never reach argv. |
| The static check's soundness | By design and by test, not by proof. Research R3 records the rules and why they close each known path to `open()`, `require()`, the global object and the function constructor. 42 refused fixtures, 25 numeric-guarantee cases and the accepted corpus pin the boundary. A script can still contact any host; the confirmation and the trigger say so. |

## Quickstart walkthrough (tasks T073)

**Not performed.** Quickstart scenarios 1 to 8 need a browser walkthrough, and no browser session
was available to this implementation. Scenario 9 (real k6) was run as T064 above. Until scenarios
1 to 8 are walked through and recorded here, AP-034 is "Implementation complete — manual browser
walkthrough pending" and not "Implemented" (constitution XXXI).

## Follow-ups

- **Bundle size.** Lazy-load `UserScriptPage` (or the other standalone pages) to bring the main
  chunk back under 500 kB, if the warning matters.
- **`multer` upgrade.** Upgrade `multer` 1.x to 2.x for the existing upload routes (research
  R22). AP-034 does not use `multer`.
- **Generated request names.** Name the generated script's requests (`tags.name`) so a
  downloaded copy groups by operation rather than by path (research R22). That needs an AP-029
  amendment, because it changes generated runs' metric tags.
