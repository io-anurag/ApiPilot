# Feature Specification: Live run dashboard

**Feature Branch**: `AP-045`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Implement a live dashboard that shows live requests, how many requests are done and plot in graph"

## Clarifications

### Session 2026-10-10

- Q: For a long run, does the graph show the whole run or only the latest few minutes? → A: The whole run, always; older seconds are merged into wider steps once the run is long (about 30 minutes), with a "thinned" note.
- Q: After how many seconds without a fresh reply does the dashboard mark its figures stale? → A: 10 seconds.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See how a run is going, as it happens (Priority: P1)

An engineer starts a performance run and is taken to Runs & reports. There, a live dashboard shows how many requests
have been sent so far, how many failed, the current number of virtual users, and how long the run has been going, with
the figures updating while the run is in progress. Today the same page shows a single line of text.

**Why this priority**: The run can last minutes. Without live figures the engineer cannot tell whether the target is
coping, whether failures have started, or whether to cancel.

**Independent Test**: Start a run against a mock target; the counters on the dashboard increase while the run is in
progress and stop at the final totals when it ends.

**Acceptance Scenarios**:

1. **Given** a run is in progress, **When** the engineer opens Runs & reports, **Then** the dashboard shows requests
   done, failures, current virtual users and elapsed time, and these refresh without a page reload.
2. **Given** a run is in progress, **When** it completes, **Then** the dashboard stops updating, shows the final totals
   and marks the run as completed rather than live.
3. **Given** the engineer cancels the run, **When** the cancellation takes effect, **Then** the dashboard shows the
   totals reached and marks the run as cancelled.

---

### User Story 2 - Watch the run on a graph (Priority: P1)

The dashboard plots the run over time: requests per second and failures against elapsed time, with virtual users
shown alongside, so a ramp, a plateau, an error spike or a stall is visible at a glance.

**Why this priority**: A number alone hides the shape of the load; the graph is what the engineer asked for.

**Independent Test**: During a run with a ramping profile, the graph gains points over time and the virtual-user line
follows the profile's ramp.

**Acceptance Scenarios**:

1. **Given** a run is in progress, **When** new figures arrive, **Then** the graph extends to the right with the new
   point and keeps earlier points.
2. **Given** failures occur, **When** they are plotted, **Then** they are distinguishable from successful requests by
   more than colour (a label or a different mark).
3. **Given** the graph has no points yet, **When** the run has only just started, **Then** the dashboard says it is
   waiting for the first figures instead of showing an empty axis as if nothing happened.

---

### User Story 3 - See the latest individual requests (Priority: P2)

The dashboard lists the most recent requests as they complete: the step, method and path, the HTTP status and the
duration, newest first, so the engineer can see which request is failing, not only that something is.

**Why this priority**: Aggregates say that something failed; the list says what. It depends on the data from the
first two stories being in place, and it is the heaviest to produce at high request rates.

**Independent Test**: With a run sending requests, the list shows the latest requests with status and duration, and
keeps to its stated size.

**Acceptance Scenarios**:

1. **Given** a run is in progress, **When** requests complete, **Then** the list shows the most recent ones, newest
   first, each with step, method, path, status and duration.
2. **Given** requests complete faster than they can be shown, **When** the list is full, **Then** older entries drop
   off and the dashboard states that it shows a sample of the latest requests, not all of them.
3. **Given** a request carries credentials, **When** it appears in the list, **Then** no header, cookie, token or
   body value is shown.

---

### User Story 4 - Dashboard after the run (Priority: P3)

After a run has finished, the engineer can still see its final graph and totals in the report for that run.

**Why this priority**: Useful but the existing report already holds the final result; this only avoids losing the
shape of the run once it ends.

**Independent Test**: Open a finished run's report; the graph of the run is shown with the final totals.

**Acceptance Scenarios**:

1. **Given** a run has finished, **When** the engineer opens its report, **Then** the graph and totals match what the
   dashboard showed at the end of the run.

### Edge Cases

- The connection to the backend drops while a run is in progress: once 10 seconds pass without a fresh reply, the
  dashboard says its figures are stale and since when, and resumes when the connection returns; it never shows stale figures as current.
- The page is opened or reloaded mid-run: the dashboard shows the run so far (figures and graph), not an empty state.
- The run fails to start or ends in an error: the dashboard shows the error and the figures reached, not a blank panel.
- A very long run (about 30 minutes or more): the graph still shows the whole run from the start; older seconds are merged
  into wider steps so the number of points stays bounded, totals are unchanged, and the graph says it has been thinned.
- A run with zero requests so far: zero is shown as zero, distinct from "figures unavailable".
- Two runs of different plans in progress: each dashboard shows only its own run.
- Reduced-motion preference: the graph updates without animation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: While a run is in progress, the system MUST show on Runs & reports, and refresh without a reload:
  requests done, failures, current virtual users and elapsed time.
- **FR-002**: The system MUST plot, against elapsed time, requests per second, failures and virtual users for the run
  so far, and MUST keep earlier points as new ones arrive. The graph always covers the whole run; for long runs older
  seconds are merged into wider steps (never dropped), and the graph states that it is thinned.
- **FR-003**: The graph MUST have a text alternative (a table of the plotted values or an equivalent summary) and MUST
  not rely on colour alone to tell series apart.
- **FR-004**: The system MUST list the most recent completed requests, newest first, each with step, method, path,
  HTTP status and duration, bounded to 15 entries, and MUST state that it is a sample of the latest requests.
- **FR-005**: The recent-requests list MUST NOT contain request or response headers, cookies, tokens, API keys or bodies,
  and MUST NOT contain the values of secret variables or credentials.
- **FR-006**: The dashboard MUST distinguish loading, live, stale (connection lost), completed, cancelled and failed states,
  and MUST NOT present an unavailable-data state as zero requests. Figures become stale after 10 seconds without a
  fresh reply; until then the last figures stay shown as live.
- **FR-007**: Opening or reloading the page mid-run MUST show the run so far.
- **FR-008**: On completion or cancellation the dashboard MUST stop updating and show the final totals, consistent with
  the totals in the run's report.
- **FR-009**: The figures shown MUST come from what the run actually did; the dashboard MUST NOT estimate, smooth in a way
  that changes totals, or invent points.
- **FR-010**: Showing the dashboard MUST NOT start, stop or alter a run, and MUST NOT send any request to the target.
- **FR-011**: Live data MUST stay on the machine running ApiPilot and the engineer's browser; nothing is sent to a third party.
- **FR-012**: The dashboard MUST be responsive, keyboard and screen-reader usable, readable in light and dark themes, and
  honour the reduced-motion preference.
- **FR-013**: The dashboard MUST be offered for each of the three kinds of run that can be started today and shows progress: performance
  plan runs (including plans seeded from Quick Performance Test, which no longer starts runs of its own), Run k6 Script
  runs and Import & Run Collection runs (decided 2026-10-10, corrected the same day after the code was read: the
  older 031, 032 and 036 runs can no longer be started and stay read-only history). Every kind shows the
  same states, counters and graph. Figures that a kind cannot supply (for example virtual users or percentiles for a
  collection run, which has no load profile) MUST be left out for that kind, never shown as zero.
- **FR-015**: Where a run has chains, the dashboard MUST show requests and failures so far per chain, and MUST show
  average duration and the 95th percentile so far for the whole run.
- **FR-016**: The dashboard MUST be consistent with the rest of the app (constitution XXXIII). It is one shared
  dashboard used by all three run kinds, not three variants. It reuses the existing design tokens, section colours
  (AP-041), HTTP method badges (AP-042), status pills, tiles, tables, loading/empty/error panels, the existing
  chart styling of the run reports, and the existing wording for run states. Where the mock differs from an existing
  component, the existing component wins. The same figure has the same name, unit and format on the dashboard, in the
  run report and in the run list.
- **FR-014**: The run's graph MUST remain available after the run (User Story 4): in the dashboard of a finished run and
  in its reports. Where a run has an HTML report and a PDF report (Import & Run Collection), both MUST contain the graph,
  and the two MUST show the same figures (decided 2026-10-10). The k6 run reports (HTML) MUST contain it too.

### Key Entities *(include if feature involves data)*

- **Live sample**: one point in time for a run: elapsed time, requests done in the interval, failures in the interval,
  current virtual users.
- **Recent request**: a completed request shown in the list: step, method, path, HTTP status, duration. Carries no
  credentials or bodies.
- **Run state**: loading, live, stale, completed, cancelled or failed, as shown to the engineer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: During a run, the displayed request and failure counts are never more than 3 seconds behind the run.
- **SC-002**: When a run ends, the dashboard's final totals equal the totals in that run's report in 100% of runs.
- **SC-003**: An engineer can tell within 10 seconds of opening the page whether a run is live, how many requests have
  been sent and whether failures have started.
- **SC-004**: Reloading the page mid-run restores the graph and counters for the run so far.
- **SC-005**: The page stays responsive (interactions respond without visible delay) during a run of at least 30 minutes.
- **SC-006**: No credential or body value appears in the dashboard in any test run that sends credentials.

## Assumptions

- All three startable run kinds are in scope (FR-013). Performance plan runs show it on Runs & reports; the other kinds show it
  where their own run progress is shown today. A collection run is sequential and has no virtual users, so its graph
  plots requests and failures over time only.
- Out of scope: the Debug run (it has its own request-by-request view), read-only history of the older 031, 032 and 036
  runs, comparing runs, alerts or notifications, and exporting the live data.
- Delivery may be phased in the plan (shared dashboard and one run kind first), but the feature is complete only when
  all three kinds have it.
- The existing run progress (elapsed time, requests, failures, virtual users, per step) is the base; the graph and the
  recent-requests list need more detail from the run than it records today. How that is obtained is for the plan.
- The recent-requests list is a bounded rolling sample, not a full log, so it stays usable at high request rates.
- Live figures are not kept after the server restarts, matching the local, non-persistent processing model; the
  finished run's graph (User Story 4) is kept only as far as run reports are kept today.
- No new run is started and no extra load is put on the target by the dashboard.
- Cancel run stays where it is; the dashboard sits with the run's other progress information.
- `mock.html` is a layout sketch with its own inline styles; the build uses the app's components and tokens (FR-016),
  so colours, spacing and badge shapes in the mock are not binding.
- Version bump and documentation (user manual, architecture, roadmap) follow with the implementation.
