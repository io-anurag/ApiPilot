# Feature Specification: Recent Failures for Run k6 Script Runs

**Feature Branch**: `052-user-script-recent-failures`

**Created**: 2026-10-15

**Status**: Implemented

**Input**: User description: "I want a Recent failures list for Run k6 Script runs, with functionality as similar as possible to the Performance feature."

## Background

The live run dashboard (specs/045-live-run-dashboard) shows a Recent failures section for request-chain (Performance) runs: the latest failed requests with time, step, method, path, status and the response the server sent (FR-005a, added as AP-049). A Run k6 Script run (specs/034-run-user-k6-script) shows only the failure count and its share, so an engineer can see that requests failed but not which ones.

The Performance list gets its responses because ApiPilot generates that script, and the generated script writes one console line per sampled failure. ApiPilot does not generate a supplied script and never rewrites it (034 FR-016, research R10), and it drops the script's console output unread, so that route does not exist here. The same k6 metric points that already feed the dashboard's Latest requests do carry what is needed to say which request failed, with what status and when.

This feature adds the list to Run k6 Script runs with the same section, columns, sampling idea, bounds and memory-only handling, and states plainly that the response is not available.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See which requests failed (Priority: P1)

An engineer watching a Run k6 Script run sees a Recent failures section under the graph listing the latest failed requests, so they can tell which request, method and path failed and with which status.

**Independent Test**: Run a script that has requests answered with 4xx or 5xx, or that cannot connect, and open Runs & reports.

**Acceptance Scenarios**:

1. **Given** a run in progress or just finished, **When** requests have failed, **Then** a Recent failures section lists up to 15, newest first, each with UTC time, request, method, path and a status badge, and says it is a sample.
2. **Given** a request has no response (connection failed or timed out), **Then** its status reads "No response" and its response says so, as for a Performance run.
3. **Given** no request has failed, **Then** the section says so, as it does for a Performance run.
4. **Given** a named request (a `tags: { name }` in the script), **Then** it is listed by that name with no path, as in Latest requests; an unnamed one by host and path.

---

### User Story 2 - Be told what is not there (Priority: P1)

The list says it cannot show the response a failed request got, instead of leaving an empty cell.

**Acceptance Scenarios**:

1. **Given** a failed request with a response, **Then** its row says "Not captured" and the section explains that ApiPilot runs the script as supplied and does not see responses; there is no Show response button for it.
2. **Given** a Performance run, **Then** its list, text and behaviour are unchanged.

### Edge Cases

- A burst of identical failures in one second is one row; counts elsewhere stay exact.
- After a backend restart, or once the run is no longer held in memory, the list is absent, as for Performance.
- A script with more than 100 request names still lists failures (named by their own name, host or path).

## Requirements *(mandatory)*

- **FR-001**: For a Run k6 Script run the live snapshot MUST carry `recentFailures` (at most 15, newest first, `{ second, chain, method, path, status | null, response }`), and the dashboard MUST show them in the Recent failures section.
- **FR-002**: A request is a failure by k6's own verdict (`expected_response` is false) or when no response arrived (status 0), the same test that marks a Latest requests entry failed.
- **FR-003**: The list is a sample: at most one entry per second for each request display name and status. The counts and the graph stay exact.
- **FR-004**: An entry MUST hold only the second, the request's name or host, method, path, status and a response marker. It MUST NOT hold headers, cookies, tokens, query strings, user info, fragments, bodies or environment values.
- **FR-005**: The response of a failed request with a status MUST be a new `not-captured` kind (`reason: "user-script"`); with no response it is `none-received`, as before.
- **FR-006**: Like AP-045 FR-005a, the list is held in memory for the live view only: never written to the database, a report, a stored result or a log, and absent once the run is no longer held.
- **FR-007**: No route, request, report, stored value or Performance behaviour changes. The scripts are still run as supplied; console output is still never read (034 FR-016, FR-029); `--http-debug` is not used.

## Success Criteria

- **SC-001**: Every AP-045 and AP-034 test passes unchanged except where a visible label was reworded.
- **SC-002**: A fixed set of k6 points always yields the same list.
- **SC-003**: A privacy test shows no secret placed in a header tag, query, user info, fragment or body tag reaches the list.

## Assumptions

- `--http-debug` would give bodies but dumps every request and response of the run, including headers, at load; that is not acceptable for a load test, and no other k6 output carries bodies. The response is therefore reported as not captured, not approximated.
- `error` and `error_code` tags are not shown: the `error` text can contain a URL with its query, and a code-to-text table would be an invention of this feature. A failure with no response says only that no response arrived.
- Method, host and path are already shown by Latest requests for the same run, so listing them for failures exposes nothing new.
