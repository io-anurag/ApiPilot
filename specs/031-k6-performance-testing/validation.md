# Validation: k6 Performance Testing (AP-029)

**Feature**: [spec.md](./spec.md) | **Tasks**: [tasks.md](./tasks.md) T093, T099

This records the validation that constitution XXXI requires before AP-029 is recorded as
Implemented. Nothing below is estimated: a check that was not run says so.

## Real-k6 check (T093)

**Status: not run (2026-09-27).** No k6 binary was installed on the machine used for the
implementation (`k6 version` and `where k6` found nothing), and ApiPilot never installs k6.

To run it, on a machine with k6 1.0.0 or later on `PATH` (or named in `K6_BINARY_PATH`):

```powershell
$env:K6_TEST_REAL = "1"; npm run test:k6-real -w backend
```

Record here the k6 version, OS, date, and the result of each check in
`backend/tests/integration/performance.k6.real.test.ts`:

- the version gate accepts the installed k6;
- the argument list includes `--no-usage-report`;
- every metrics line parses, with no `url` or `name` tag;
- a 5-second `expires_in` token is refreshed by each of 3 virtual users during a 20-second run,
  with no authentication failures;
- cancelling stops k6 within 10 seconds.

Not yet covered by that test, and still to confirm against a real binary: that k6 tags a request
timeout with `error_code` 1050, which the aggregate maps to `timeout` (research D14).

## What the automated suites cover instead

Without k6, `npm test` covers the same behaviour one layer down:

- The generated script's own runtime runs in a Node `vm` sandbox with k6's modules stubbed
  (`backend/tests/unit/performance/renderScript.test.ts`): journeys in order, OAuth2 and chained
  login in `setup()`, missing data, cut-short journeys, per-virtual-user refresh at 70% to 80%,
  failed and absent lifetimes, unique values, think time, and the match with the Postman request.
- The routes run end to end with a fake runner that replays k6-shaped metrics lines
  (`backend/tests/integration/performance/`): pre-run checks, progress, cancel, restart, the
  shared slot, session keep-alive, reports, and the stage gate.
- The runner's spawn arguments, child environment, file tailing, graceful and forced cancel, and
  spawn errors are tested with an injected `spawn` (`runner.test.ts`).

These do not replace the real-k6 check: they assume k6's output format and signal handling
behave as documented.

## Manual quickstart (T099)

**Status: not performed (2026-09-27).** No browser tool and no k6 were available. Scenarios 1
and 2 (plan, script and readiness with no k6) need only a browser; scenarios 3 to 8 need k6 and
`npm run perf:stub -w backend`.
