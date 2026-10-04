# Feature Specification: Chain Debug Run

**Feature Branch**: `039-chain-debug-run`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "Chain debug run: on a request-chain performance plan, let the engineer explicitly start a Debug run that executes the chain exactly once and shows, in the UI only, the request and response of every step actually sent, each extractor's and check's outcome, and why later steps were not sent. The rule from specs 036/037 that reports and stored results contain no request or response content stays intact."

## Background

A request-chain performance plan (AP-037) runs steps in order and, per iteration, continues only while each step returns an expected status and every extractor succeeds. When something is misconfigured, for example an extractor path that does not match the response, the report can only say that extraction failed and that later steps were not attempted. It deliberately holds no request or response content (AP-036 and AP-037), so the engineer cannot see *why*.

In a real run, `issueToken` returned `200` 60 times, extractor `token` failed 60 times, and the six customer steps were never sent. The report named the symptom; only the response would have shown whether the field name or the content type was wrong.

This feature gives the engineer a separate, explicit, one-shot way to look at the exchanges, without weakening the no-content rule that governs load runs and reports.

## Clarifications

### Session 2026-10-04

- Q: When a plan has several chains, should a Debug run execute only a selected chain, or every chain once in plan order? → A: Every chain once, in plan order, with the output grouped by chain.
- Q: Should a write step need its own confirmation, or one confirmation before the run? → A: One confirmation that lists every chain's write steps, after which all steps are sent. No per-step prompts and no read-only mode.
- Q: Should masked values be revealable on screen? → A: Per-value reveal, one value at a time, hidden again on reload. Limited to values that came from the target (credential-like headers and extracted values); secret environment values and secret data-column values are never sent to the browser and so are never revealable (existing rule: secret values are never shown again or sent to a browser).

### Plan-phase corrections (2026-10-04)

Planning found that the k6 runtime does not behave as the first draft assumed. A Debug run must mirror the load run, so the spec was corrected (research.md R3):

- FR-008 now mirrors the runtime's continue-or-stop rule exactly.
- FR-007 gains a fifth skip cause: a step needing an extracted value that was never produced.
- FR-005 now lists the failure reasons the runtime can actually distinguish; the extractor result itself is unchanged from a load run.
- FR-018 no longer refuses a run for a missing value; the affected step is shown as not sent, as in a load run.

### Analysis fixes (2026-10-04)

- Tier safeguards: the spec no longer promises a tier restriction that does not exist (US4 AS2, FR-017, Assumptions).
- Bodies are shown as sent and received, not reformatted (research R5, FR-003).
- FR-025 added for the time limits; FR-021, US1 AS1 and terminology aligned.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what each step sent and received (Priority: P1)

An engineer opens a chain plan, picks an environment, and starts a **Debug run**. The chain runs once. For every step that was sent, the engineer sees the request that went out and the response that came back, and can read them to find the misconfiguration.

**Why this priority**: This is the whole purpose. Without it the engineer is guessing why a plan fails.

**Independent Test**: With a plan whose first step returns JSON, start a Debug run and confirm each sent step shows its method, resolved URL, headers, body, response status, response headers, response body and duration.

**Acceptance Scenarios**:

1. **Given** a valid plan and an environment, **When** the engineer starts a Debug run, **Then** every chain executes exactly one iteration with one virtual user and no think-time or request-pause waiting, and every step that was sent appears in order with its request and response.
2. **Given** a step whose URL contains `{{baseUrl}}` and other references, **When** the Debug run finishes, **Then** the step shows the resolved URL that was actually requested.
3. **Given** a step that received no response (connection refused, timeout), **When** the Debug run finishes, **Then** the step shows the request that was attempted and the reason no response arrived, and the engineer is not shown an empty response as if it were a real one.

---

### User Story 2 - Understand why an extractor or check failed, and why later steps were skipped (Priority: P1)

For each extractor and check the engineer sees the outcome. A failed extractor states the reason in plain terms, and steps that were not sent state which earlier step stopped the chain and why.

**Why this priority**: Seeing the response is not enough when the cause is a path, body or header mismatch; stating the reason removes the guesswork that motivated this feature.

**Independent Test**: Run a plan whose extractor path does not exist in the response and confirm the failure reason says the path was not found, the later steps show "not sent", and the cause points at the extractor on the first step.

**Acceptance Scenarios**:

1. **Given** an extractor whose path is absent from a JSON response, **When** the Debug run finishes, **Then** the extractor shows as failed with the reason "path not found" and the path that was looked up.
2. **Given** a body extractor on a response whose body cannot be read as JSON, **When** the Debug run finishes, **Then** the extractor shows as failed with the reason that the body is not JSON, and the content type that was received is shown as context.
3. **Given** a header extractor and a response without that header, **When** the Debug run finishes, **Then** the extractor shows as failed with the reason "header missing" and the header name.
4. **Given** a step returns a status outside its expected statuses, **When** the Debug run finishes, **Then** the step is marked failed, the expected and received statuses are shown, and later steps are shown as not sent with the stopping step named.
5. **Given** a check on a sent step, **When** the Debug run finishes, **Then** the check shows passed or failed with what was compared.
6. **Given** the first step succeeds and all extractors pass, **When** the Debug run finishes, **Then** every later step is sent and shown, and no step is reported as skipped.

---

### User Story 3 - Debug output never becomes a stored artifact (Priority: P1)

The engineer can trust that looking at request and response content does not leak it anywhere. The output exists for the current view only.

**Why this priority**: AP-036 and AP-037 forbid request or response content in reports, stored results, snapshots and logs. This feature must not become the loophole.

**Independent Test**: Run a Debug run, then inspect the report list, stored run records, the run store directory and server logs; confirm none contain any request or response content, extracted value or environment value from the Debug run.

**Acceptance Scenarios**:

1. **Given** a completed Debug run, **When** the engineer reopens the plan or reloads the page, **Then** the Debug output is gone and must be re-run to be seen again.
2. **Given** a completed Debug run, **When** the engineer lists runs and reports, **Then** the Debug run does not appear as a load run and produces no report.
3. **Given** a Debug run, **When** the server logs are inspected, **Then** they contain no request or response content, no header values and no body text.
4. **Given** Authorization, Cookie, Set-Cookie and API-key style headers, **When** shown in the Debug output, **Then** their values are masked.
5. **Given** an environment value marked secret, **When** it appears inside a request or response, **Then** its value is masked wherever it occurs in the output.
6. **Given** a value captured by an extractor, **When** the Debug output shows it, **Then** it is masked when it looks like a credential (for example a token) and the engineer can still see that the extraction succeeded and what was extracted *from* (path or header name).
7. **Given** a masked header or extracted value that came from the target, **When** the engineer reveals it, **Then** only that one value is shown, and it is masked again after a reload or when the view is closed.
8. **Given** a secret environment value or a secret data-column value, **When** it appears in the output, **Then** it is masked with no reveal control, and its real value was never sent to the browser.

---

### User Story 4 - A Debug run is a real run against a real target (Priority: P2)

The engineer is shown, before the Debug run starts, what it will do to the target, in the same terms as a load run, and confirms it.

**Why this priority**: A Debug run sends real requests, including writes. It must follow the existing environment safeguards rather than bypass them.

**Independent Test**: With a plan containing a write step, start a Debug run and confirm the trigger names the environment, tier, base URL, hosts and write steps, and that nothing is sent until the engineer confirms.

**Acceptance Scenarios**:

1. **Given** a plan with write steps, **When** the engineer opens the Debug run trigger, **Then** it names the environment by name, tier and base URL, lists the hosts and lists each write step, as the load-run trigger does (AP-037 FR-029, FR-031).
2. **Given** any environment tier, **When** the engineer opens the Debug run trigger, **Then** it shows the tier next to the base URL and requires the same explicit confirmation as a load run. No tier-based restriction is added: ApiPilot has none for load runs today, and introducing one would be a separate specification.
3. **Given** a required environment or data value is missing, **When** the engineer starts a Debug run, **Then** the trigger lists the missing names as a warning, the run proceeds, and each affected step is shown as not sent with the missing names, as a load run skips it.
4. **Given** the plan changed after the last script generation, **When** the engineer starts a Debug run, **Then** the Debug run uses the current plan and the engineer is not misled into thinking an out-of-date script was exercised.

---

### Edge Cases

- A response body is large or binary: it is shown truncated to a stated limit with the full size and a note that it was truncated; binary content is described (type and size), not rendered.
- A response is not valid JSON though it claims to be: the extractor failure says the body could not be read as JSON.
- A step uses a data set: the Debug run uses the first row, and the output says which row was used; secret data columns are masked.
- A step is "once before load" (setup): it is shown as setup, and a failed setup step stops the Debug run with the reason (AP-037 FR-018).
- The engineer starts a second Debug run while one is running: the second is refused or queued with a clear message; two Debug runs never run at once for the same plan.
- The engineer navigates away or cancels mid-run: the run is cancelled, in-flight requests are aborted, and nothing is stored.
- A plan has several chains: every chain runs once, in plan order, and the output groups steps by chain. A chain stopped early does not prevent later chains from running, and each chain's skipped steps name their own stopping step.
- A think time is configured: it is not waited out in a Debug run, so the engineer is not kept waiting between steps.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let the engineer explicitly start a Debug run of a chain plan from the plan, against a chosen environment. A Debug run MUST NOT start automatically, and starting a load run MUST NOT start one.
- **FR-002**: A Debug run MUST execute every chain of the plan exactly once, in plan order: one virtual user, one iteration, no load profile, and no think-time or request-pause waiting. The output MUST be grouped by chain.
- **FR-003**: For every step that was sent, the system MUST show the method, resolved URL, request headers, request body, response status, response headers, response body and duration.
- **FR-004**: For a step that got no response, the system MUST show the attempted request and the reason there was no response.
- **FR-005**: For every extractor on a sent step the system MUST show whether it extracted or failed, and for a failure the reason, distinguishing at least: the step's status was not expected so extraction was not attempted, the body is not parseable as JSON (with the content type received as context), path not found (with the path), the value found is not a single text, number or boolean (an object, array, null or empty text), and header missing (with the header name).
- **FR-006**: For every check on a sent step the system MUST show whether it passed or failed and what was compared.
- **FR-007**: For every step not sent, the system MUST show that it was not sent and why: which earlier step stopped the chain and for which cause (failed extractor, unexpected status where the load run stops on it, missing environment or data value, a value from an earlier step that was never produced, a host outside the allowed hosts, failed setup).
- **FR-008**: The Debug run MUST apply exactly the continue-or-stop rule of a load run (AP-037 runtime): a failed extractor stops its chain; an unexpected status stops the chain only for once-per-virtual-user and setup steps; a step with a missing environment or data value, or a missing extracted value, is skipped on its own and later steps still run. The Debug run MUST NOT be stricter or looser than the load run.
- **FR-009**: Debug run output MUST exist only for the current view. It MUST NOT be written to a report, a stored run record, a snapshot, a generated script, an environment template, a log or any file, and MUST be gone after the view is closed or reloaded.
- **FR-010**: A Debug run MUST NOT create a performance run record, a report, or a new entry in the runs list.
- **FR-011**: The system MUST NOT change what load-run reports or stored results contain. The AP-036 and AP-037 rule that they hold no request or response content, extracted value or environment value MUST remain true.
- **FR-012**: Server-side logs MUST NOT contain request or response content, header values, body text, extracted values or environment values from a Debug run; they MAY contain the plan, step and outcome category.
- **FR-013**: Values of Authorization, Proxy-Authorization, Cookie, Set-Cookie and API-key style headers MUST be masked in the output, request and response alike.
- **FR-014**: Every occurrence of an environment value marked secret, and of a data-set value in a secret column, MUST be masked in the output, wherever it appears (URL, header, body).
- **FR-015**: Extracted values that look like credentials MUST be masked in the output. The output MUST still show that the extraction succeeded and its source (path or header name).
- **FR-015a**: The engineer MUST be able to reveal one masked value at a time when it came from the target (credential-like headers and extracted values). A revealed value MUST be masked again on reload or when the view is closed, and revealing MUST NOT store, log or copy the value anywhere.
- **FR-015b**: Secret environment values and secret data-column values MUST NOT be sent to the browser and MUST NOT be revealable; they are masked on the server before the output leaves it.
- **FR-016**: Masking MUST preserve the structure of the content, so a masked JSON body still shows its field names and shape, which is what lets the engineer see that a field exists under a different name.
- **FR-017**: Before starting, the Debug run trigger MUST name the target environment by name, tier and base URL, list the hosts, and list the write steps of every chain, and MUST require the engineer to confirm once. After that confirmation every step is sent without further prompts; there is no per-step confirmation and no read-only mode. The trigger MUST present the same information and require the same explicit confirmation as the load-run trigger; no additional tier-based restriction is introduced.
- **FR-018**: A Debug run MUST NOT be refused because an environment or data value is missing. The trigger MUST list the missing names as a warning, and each affected step MUST be shown as not sent with the names, as a load run skips it.
- **FR-019**: A Debug run MUST send requests only to the hosts the plan allows (AP-037 FR-029).
- **FR-020**: Large bodies MUST be truncated to a stated limit with the full size shown; binary content MUST be described, not rendered.
- **FR-021**: The same plan, environment and target responses MUST produce the same Debug output, apart from durations and time-based dynamic values (such as timestamps).
- **FR-022**: The Debug output MUST be usable by keyboard and screen reader, MUST not rely on color alone to show passed or failed, and MUST scroll large content within its own area rather than the page.
- **FR-023**: Only one Debug run MAY be active per plan at a time, and a Debug run MUST be cancellable by the engineer.
- **FR-024**: The feature MUST NOT use AI.
- **FR-025**: A Debug run MUST end within a stated overall time limit, and a request that gets no response within a stated per-request limit MUST be shown as having no response, with the reason "timed out". When the overall limit is reached, every step not yet sent MUST be shown as not sent with that cause, and the result MUST say the run was cut off. The limits are fixed by the plan.

### Key Entities *(include if feature involves data)*

- **Debug run**: One transient execution of a chain plan against an environment, with a start time and an overall outcome. It is never stored.
- **Step outcome**: For one step, either the request sent and the response received (or the reason there was none), masked, with duration, or the reason it was not sent.
- **Extractor outcome**: For one extractor on one step, extracted or failed, with source and failure reason.
- **Check outcome**: For one check on one step, passed or failed, with what was compared.
- **Not-sent step**: A step that was not sent, with the stopping step and cause.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Given a plan whose extractor path is wrong, an engineer can identify the correct field name and the cause of the failure from the Debug output alone, within 2 minutes of starting the Debug run, without leaving ApiPilot.
- **SC-002**: For 100% of Debug runs, no request or response content, header value, extracted value or environment value appears in any report, stored run record, snapshot, script, template or server log.
- **SC-003**: 100% of values of Authorization, Cookie and API-key style headers, secret environment values and secret data-column values are masked in the output in a test corpus covering URL, header and body positions.
- **SC-004**: Every step that is not sent states its cause, in 100% of Debug runs that stop early.
- **SC-005**: A Debug run of a plan with 10 steps against a responsive target completes and shows its output within 15 seconds.
- **SC-006**: The existing load-run reports are byte-identical before and after this feature for the same run data.

## Assumptions

- The Debug run is available for request-chain plans (AP-037). Quick tests (AP-032), collection tests (AP-036) and user k6 scripts (AP-034) are out of scope for this feature.
- A Debug run sends real requests to the chosen environment, including writes; ApiPilot does not clean up anything it creates, as for load runs.
- The first row of a data set is used for a Debug run, and the output states which row.
- Values that came from the target may be revealed one at a time; values the engineer supplied as secrets are never revealable.
- The masking of "credential-like" extracted values is a conservative rule: when in doubt, mask.
- The output size limit for a body is fixed by the plan phase, not chosen by the engineer.
- The trigger information and explicit confirmation of AP-037 FR-031 are reused unchanged. No server-side tier policy exists for chain runs today, and none is added here.
- Capturing content during load runs and changing report content are explicit non-goals.
