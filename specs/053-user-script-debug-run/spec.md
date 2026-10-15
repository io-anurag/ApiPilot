# Feature Specification: Debug Run for Run k6 Script

**Feature Branch**: `053-user-script-debug-run`

**Created**: 2026-10-15

**Status**: Implemented

**Input**: User description: "Add the functionality of debug run" to Run k6 Script, as on Performance (specs/039-chain-debug-run).

## Background

On a request-chain performance plan, **Start debug run** sends every chain once and shows the request and response of every step in the UI only (specs/039). It works because ApiPilot sends those requests itself. A Run k6 Script run is different: the script is run by k6 exactly as supplied (034 FR-016, constitution XVII, 2026-09-30 exception), and until now ApiPilot read only k6's metrics and dropped everything the process printed (034 FR-029, FR-040).

k6 can log every request it sends and every response it gets (`--http-debug=full`), and with `--log-format json` each of those is a separate record labelled `source: "http-debug"`, apart from the script's own `console` records. Checked against k6 2.3.0 on 2026-10-15:

- `--vus 1 --iterations 1` replaces the script's own scenarios entirely (k6 logs that it did), so the script runs once.
- A request and its response are two records with the same `request_id`; a redirect is a separate pair; a request that got no response has only the request record.
- The record carries the method, the request target (path and query), the headers and the body. The scheme is not logged. A gzip response is logged as its compressed bytes.
- The script's own `console.log` is a record with `source: "console"`.

The constitution lets a supplied script's run report only k6's own metrics. Showing exchanges is new, so it needed a MINOR amendment of XVII's 2026-09-30 exception (constitution v3.1.0, 2026-10-15) with its own conditions. This feature is built under those conditions.

## Clarifications

### Session 2026-10-15

- Q: How should a debug run of a supplied script work, given that ApiPilot cannot send its requests itself? → A: Run the confirmed script once with k6's own options (one virtual user, one iteration, HTTP debug log) and show the exchanges from the `http-debug` records only, masked, in the UI only, never stored. The engineer chose this over listing requests from k6's metrics (which needs no amendment but shows nothing a normal run does not).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what the script sent and received (Priority: P1)

An engineer with a confirmed script starts **Start debug run on NAME** from the launch card. The script runs once. Every request it sent appears, in order, with its request and response.

**Independent Test**: Run a confirmed script that makes a failing request and a successful one, and read the output.

**Acceptance Scenarios**:

1. **Given** a script that is ready to run, **When** the engineer starts a debug run, **Then** the script runs one iteration with one virtual user, whatever load it or the setup defines, and each request it sent is listed with method, address, request headers and body, response status, headers and body.
2. **Given** a request that got no response (connection refused, timeout), **Then** it is listed with the request and says no response arrived.
3. **Given** a redirect, **Then** each hop is its own entry.
4. **Given** a request the script named (`tags: { name }`), **Then** the entry shows that name.
5. **Given** the script's own `console.log` output, **Then** it is never shown (034 FR-040).
6. **Given** a response sent compressed (gzip, deflate, br), **Then** its body says it is compressed and is not shown.
7. **Given** k6 could not run the script, **Then** the result says it failed and shows k6's own error message (at most 2,000 characters), as a normal run does.

---

### User Story 2 - Nothing sensitive, nothing kept (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a request or response with an Authorization, cookie or API key header, a credential-looking query, form or JSON field, or any value mapped from the environment, **Then** it is masked in the output; mapped values can never be revealed.
2. **Given** a credential that came from the target or sits at a credential-looking place, **Then** it is masked and can be revealed one at a time, as on Performance, and is hidden again on reload.
3. **Given** the output is closed, the page reloaded or the backend restarted, **Then** it is gone: it is never written to the database, a report, a stored result or a log, and no run record is created.
4. **Given** a normal run, **Then** nothing about it changes.

---

### User Story 3 - An explicit, one-shot action (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the launch card, **Then** it offers the debug run beside Run, says it sends real requests including writes to the target, that the output is shown and not stored, and names the target, its tier and base URL and the hosts written in the script. Nothing is sent until the engineer presses it.
2. **Given** the script is not confirmed or refused by the check, k6 is unavailable, no environment is chosen, or an execution is in progress, **Then** the debug run is unavailable with the same reason as Run.
3. **Given** a debug run is in progress, **Then** another debug run of the script is refused, and the engineer can cancel it.
4. **Given** the script changed after the trigger showed its SHA-256, **Then** the debug run is refused as a run is.

### Edge Cases

- A script that sends more than 200 requests in one iteration, or runs longer than 60 seconds, is stopped and the output says it was cut off and why.
- A body over 64 KiB is shown in part, as on Performance.
- A script with no HTTP requests completes with an empty list and says so.
- The load profile and the thresholds set in ApiPilot do not apply to a debug run, and the output says so.

## Requirements *(mandatory)*

- **FR-001**: `POST /api/user-scripts/:id/debug-runs` MUST run the confirmed script once and answer with a `UserScriptDebugResult` when it ends. It MUST run the same checks as a run start, in the same order (script exists, passes the check, confirmed, the trigger's SHA-256 is current, k6 ready, environment exists, no execution holds the slot), except the load-profile check, and refuse a second debug run of the same script while one is running.
- **FR-002**: k6 MUST be started with the pinned arguments of a run, except that `--stage` and `--out` are not passed and `--http-debug=full --vus 1 --iterations 1` are. The script is never rewritten, wrapped or injected into; the bytes executed are the confirmed bytes, checked after they are copied (034 FR-017). Mapped values reach it only as environment variables, as in a run.
- **FR-003**: The output MUST be built only from `http-debug` records. Every other record is dropped unread, except k6's own error and fatal messages, kept in memory up to 2,000 characters for a failed result (034 FR-029).
- **FR-004**: Each exchange MUST hold the request method, address (host and request target; the scheme is not available), headers and body, and the response status, status text, headers and body, or none; and the request's name tag. Chunked bodies are decoded; compressed bodies are reported as compressed.
- **FR-005**: Every piece of text MUST pass the masker of specs/039 (R5) before it leaves the server: the values mapped from the environment (except the base URL) are masked and never revealable, and credential-looking headers, cookies, query, form and JSON values are masked and revealable one at a time through `GET .../debug-runs/:debugRunId/values/:valueId`, held in memory only (the store of 039).
- **FR-006**: The result MUST NOT be stored, logged, put in a run record, report or live snapshot, or created as a run; the server logs only ids, counts, a duration and an outcome category. `DELETE .../debug-runs/:debugRunId` discards the held values.
- **FR-007**: The run MUST be bounded: at most 200 exchanges and 60 seconds; beyond either, k6 is cancelled and the outcome is `cut-off` with its reason. Aborting the request cancels k6.
- **FR-008**: The launch card MUST offer **Start debug run on NAME** beside Run, with the statements of User Story 3, and the output MUST be shown on Runs & reports, above the live run, with a way to close it.
- **FR-009**: Constitution v3.1.0's conditions for a Debug run of a supplied script MUST hold; specs/034 FR-016, FR-029 and FR-040 are amended to say so.
- **FR-010**: No normal-run behaviour, route, stored value or report changes.

## Success Criteria

- **SC-001**: Every AP-034 and AP-052 test passes unchanged except where the launch card gained a button.
- **SC-002**: A privacy test shows no value mapped from the environment, no credential-looking header or field value, and no console output appears unmasked in a result.
- **SC-003**: A fixed set of `http-debug` records always yields the same result.
- **SC-004**: Run against real k6, a script with a failing request, a redirect, a dropped connection and a gzip response shows each as described, with a secret in a query, a cookie and an environment value masked.

## Assumptions

- The scheme is not in k6's log, so addresses are shown as host and path and the output says so. A response's duration is not available either (the records carry whole-second times), so none is shown.
- Every value mapped from the environment is treated as a secret, since Run k6 Script never shows values (034 FR-025); the base URL is not, so addresses stay readable.
- Like the Performance debug run, it does not take the session's execution slot, because it is not a stored run, and it refuses to start while another execution holds it.
