# Quickstart: k6 Performance Testing (AP-029)

**Feature**: [spec.md](./spec.md) | **Contract**: [contracts/performance-api.md](./contracts/performance-api.md)

These scenarios check the feature end to end. Scenarios 1 to 8 are manual browser walkthroughs.
Scenario 9 is the opt-in automated real-k6 check. Automated coverage of the same behaviour, with a
fake runner, is part of `npm test`.

## Prerequisites

- `npm install` at the repository root, then `npm run dev`.
- **For scenarios 3 to 9 only:** k6 1.0.0 or later installed by you, and on `PATH` or named in
  `K6_BINARY_PATH` in `.env`. ApiPilot does not install it.
- **A local stub target:** `npm run perf:stub -w backend`, which serves the fixture API on
  `http://localhost:4600` (added by the tasks; built on `backend/tests/fixtures/execution/targetServer.ts`).
  Never point these scenarios at a system you are not authorized to load.
- **A specification:** `backend/tests/fixtures/openapi/` contains one with at least one dependency
  workflow and one write operation (the tasks name the file). Take it through the guided workflow
  up to and including **Workflow Review**, approving at least one workflow.
- **An environment** named `perf-local`, tier `local`, base URL `http://localhost:4600`, created in
  the existing environments panel.

## 1. Plan and script without k6 (User Story 1; SC-001, SC-003)

1. Uninstall k6 or leave it off `PATH`, and open the **Performance Testing** stage.
2. **Expect:**
   - The proposed plan has one multi-step journey per approved workflow and one single-step journey
     for each other operation.
   - Every step shows its method, its scenario, and why that scenario was chosen.
   - Write operations are included.
   - No thresholds are set.
3. Generate the script twice. **Expect** the same `scriptSha256` both times.
4. Download the script and the environment template, and search both for a credential value you
   set in `perf-local`. **Expect** no match: only variable names appear.

## 2. k6 readiness (FR-027; SC-012)

With k6 still missing, **expect** the run trigger to be unavailable, a readiness message saying
k6 was not found, and the download still working. Install k6, choose **Check again**, and
**expect** readiness to show `ready` with the version.

## 3. Run and follow progress (User Story 2; FR-025, FR-028, FR-030; SC-007)

1. Choose `perf-local` and the **smoke** profile.
2. **Expect** the trigger to read "Run on perf-local (local)", with the base URL and the "load is
   generated from the machine running the ApiPilot backend" statement shown next to it.
3. Trigger the run. **Expect** progress within 5 seconds, showing elapsed against planned time,
   virtual users and requests so far, and updating at least every 5 seconds.
4. **Expect** the report to appear within 10 seconds of the run ending.

## 4. Cancel (FR-031; SC-008)

Start a **load** run, and cancel it after about 30 seconds. **Expect** load to stop within 10
seconds (the stub's request log stops growing), the run to be listed as cancelled, and the report
to show the partial results.

## 5. The report (User Story 3; FR-035 to FR-040; SC-004, SC-010, SC-011)

1. Open the report of scenario 3's run. **Expect:**
   - per-step p50, p90, p95 and p99 latency, throughput, errors by status and category, and check
     pass rate;
   - a timeline;
   - write-request counts per operation and method;
   - provenance on every step;
   - the profile, the environment's name, tier and base URL, and the k6 version.
2. **Expect** it to say that no thresholds were set.
3. Download it, disconnect from the network, and open the file. **Expect** it to render completely.
4. Search it for a credential value. **Expect** no match.

## 6. Missing data (FR-014; SC-005)

1. Remove one required value from `perf-local`, for example a path parameter the specification
   cannot produce.
2. **Expect** the plan's values list to show it as missing for `perf-local`.
3. Run anyway. **Expect** the run to complete. The step that needs the value is reported as "missing
   data" with the variable's name, and its dependants as not attempted. The stub received no
   request for that step.

## 7. Restart and the execution slot (FR-029, FR-032; SC-006)

1. Start a **load** run, then stop and restart the backend.
2. **Expect** the run to be listed as cancelled with a backend-restart reason, and no run to start
   by itself.
3. Start a performance run, and try to start a functional run in the same session. **Expect** it to
   be refused with "another run is in progress".

## 8. A long run with no browser open (FR-034a; SC-014)

1. Edit a **soak** profile to 70 minutes, trigger it, and close the browser.
2. Return about 75 minutes later. **Expect** the run to be completed and its report available.

## 9. Opt-in real-k6 check (research D24)

```powershell
$env:K6_TEST_REAL = "1"; npm run test:k6-real -w backend
```

This runs the real binary against the in-process stub. It passes when all of these hold:
- the version gate accepts the installed version;
- the argument list includes `--no-usage-report`;
- the metrics stream parses, with no `url` tag present;
- cancelling stops k6 within 10 seconds;
- a token with a 5-second `expires_in` is refreshed per virtual user during a 20-second run.

It is never part of `npm test`.
