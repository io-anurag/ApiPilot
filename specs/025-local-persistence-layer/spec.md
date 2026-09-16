# Feature Specification: Local Persistence Layer

**Feature Branch**: `025-local-persistence-layer`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "Add a lightweight local persistence layer (SQLite via better-sqlite3) to the backend so that data currently held only in in-memory Maps survives a server restart. The DB file is stored locally on disk and is loaded/read automatically on server start (no manual migration step required by the operator). Scope: environments/credentials, execution run history, AI readiness/benchmark metadata, and extensibility for future operational diagnostics (e.g. last failure). Constitution constraints: avoid unnecessary persistence, never log secrets, isolate storage behind a replaceable abstraction, keep automated tests independent of any shared on-disk file."

## Clarifications

### Session 2026-09-16

- Q: Should an execution run interrupted by a backend restart be distinguishable in run history from a run the user deliberately cancelled? → A: Reuse the existing "cancelled" status, but add a distinguishing reason/detail (interrupted-by-restart vs. cancelled-by-user).
- Q: Does FR-009's "Operational Diagnostic Record" need its own general-purpose, extensible table built now, or is it enough that the architecture doesn't block adding new diagnostic tables later? → A: Architectural extensibility only — no generic table now; a future feature adds its own table when it has a concrete diagnostic to store.
- Q: What's the maximum acceptable added startup delay for loading persisted data at typical local data volumes? → A: Under 500ms, measured with a few hundred environments/runs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Environments and credentials survive a restart (Priority: P1)

An API test engineer configures one or more named environments (base URL plus authentication/credential details) so they can run tests against different targets (dev, staging, a partner sandbox). Today, restarting the backend (a deploy, a crash, a routine restart) silently erases every configured environment, forcing the engineer to re-enter base URLs and credentials from scratch before they can run anything again.

**Why this priority**: Losing credentials on every restart is the most disruptive and highest-frequency pain point — it blocks all downstream execution work until manually repaired, and re-entering secrets repeatedly increases the chance they get pasted somewhere unsafe (chat, notes, shell history).

**Independent Test**: Configure an environment, restart the backend process, and confirm the environment (including its credential configuration) is still present and usable for execution without any manual re-entry.

**Acceptance Scenarios**:

1. **Given** a saved environment with a base URL and API key, **When** the backend process is restarted (and the engineer's browser session is still active, i.e. has not been idle for longer than the platform's existing 60-minute session timeout), **Then** the environment is still listed and can be selected for execution without re-entering the API key.
2. **Given** no environments have ever been created, **When** the backend starts for the first time, **Then** it starts successfully with an empty environment list and no error.
3. **Given** a saved environment whose session has been idle-evicted per the platform's existing 60-minute session timeout, **When** the backend restarts, **Then** that environment is not restored — it is gone exactly as the existing session-timeout behavior already intends, independent of this feature.

---

### User Story 2 - Execution run history survives a restart (Priority: P2)

An API test engineer runs a batch of generated test scenarios against an environment and reviews the pass/fail results and captured request/response details. If the backend restarts before the engineer finishes reviewing, today that entire run history disappears, and the engineer has no way to go back and check what happened.

**Why this priority**: This is the second-most valuable recovery, since it protects the outcome of work already done (test execution), but unlike environments it does not block new work — only historical visibility.

**Independent Test**: Execute a set of scenarios against an environment, restart the backend, and confirm the run's history, status, and per-request results are still retrievable.

**Acceptance Scenarios**:

1. **Given** a completed execution run with mixed pass/fail results, **When** the backend process is restarted, **Then** the run still appears in run history with the same status and results.
2. **Given** an execution run that was in progress when the backend stopped, **When** the backend restarts, **Then** the run is visible with a status that clearly reflects it did not complete (not silently reported as successful), and that status is recorded with a reason distinguishing "the backend restarted mid-run" from "the user cancelled it."

---

### User Story 3 - AI readiness and benchmark history survive a restart (Priority: P3)

An operator who has benchmarked local AI models, or waited for a model to finish loading, wants that information to still be available after a restart instead of needing to re-run a benchmark or re-observe the loading process from scratch.

**Why this priority**: This is useful operational context but does not block core test-engineering workflows, so it is lower priority than environments and execution history.

**Independent Test**: Run a benchmark (or reach a known readiness state), restart the backend, and confirm the last known readiness state and most recent benchmark results are still visible without re-running anything.

**Acceptance Scenarios**:

1. **Given** the AI subsystem previously reached a known readiness state (e.g., ready, or unavailable with a reason), **When** the backend restarts, **Then** the last known readiness state and reason (if any) are available before any new readiness check completes.
2. **Given** a previously recorded benchmark result for a model, **When** the backend restarts, **Then** that benchmark result remains available for review.

---

### Edge Cases

- What happens when the backend starts for the very first time and no local storage file exists yet? The system must create it automatically with no manual setup step.
- What happens when the local storage file exists but is corrupted or unreadable? The system must fail startup with an explicit, diagnosable error rather than silently discarding existing data or starting with a partially-loaded state.
- What happens when an execution run is interrupted mid-flight by a restart? Its persisted status must reflect that it did not finish, not a false success or silent disappearance, and must be recorded with a reason that distinguishes it from a run the user explicitly cancelled.
- What happens when a credential value would otherwise appear in a log line or error message? It must never appear in plaintext in logs, error responses, or diagnostics.
- What happens when automated tests exercise persistence-backed behavior? They must not read from or write to the same storage file a real running instance uses, and must not leave test data behind in a shared location.
- What happens when a browser session is idle-evicted (per the platform's existing 60-minute session timeout, independent of this feature)? That session's persisted environments and execution run history are removed at eviction time, exactly as the pre-existing session-timeout behavior already intends — this feature makes that data survive a restart *within* an active session's lifetime, not indefinitely or across sessions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist environment definitions, including their associated credential configuration, to local disk storage that survives an application restart, for as long as the owning browser session remains active (i.e., has not been idle-evicted by the platform's existing 60-minute session timeout, which this feature does not change).
- **FR-002**: System MUST persist execution run history — run metadata, per-request results, and final status — to local disk storage that survives an application restart, for as long as the owning browser session remains active (same session-timeout boundary as FR-001).
- **FR-003**: System MUST persist the AI subsystem's readiness state (and unavailability reason, when applicable) and benchmark results to local disk storage that survives an application restart.
- **FR-004**: System MUST automatically load all previously persisted data when the backend starts, with no manual import or migration step required from the operator.
- **FR-005**: System MUST automatically initialize the local storage file (including its structure) on first startup when none exists yet.
- **FR-006**: System MUST NOT expose credential values in plaintext in logs, error messages, or diagnostic output at any point, including when reading from or writing to persisted storage.
- **FR-007**: System MUST fail startup explicitly, with a clear diagnosable error, if the local storage file exists but cannot be read or is corrupted — it MUST NOT silently discard the file or start with partial data.
- **FR-008**: System MUST mark an execution run that was interrupted by a restart (i.e., left in a non-terminal state) as incomplete/interrupted rather than reporting it as successful or omitting it from history, and MUST record this outcome with a reason distinguishing "interrupted by a backend restart" from "cancelled by the user," so the two causes remain individually diagnosable in run history.
- **FR-009**: The storage architecture MUST be such that a future feature can add a new kind of operational diagnostic record (e.g., a "last failure" record for a subsystem) without requiring a redesign of the storage mechanism. This feature MUST NOT build a generic, currently-unpopulated diagnostic table speculatively — only the concrete diagnostics named in FR-003 (AI readiness/benchmark history) are built now.
- **FR-010**: The location of the local storage file MUST be configurable by the operator, with a safe, working default that requires no configuration for a standard local setup.
- **FR-011**: Automated test suites MUST NOT read from or write to the local storage file location used by a real running instance; persistence-dependent tests MUST use an isolated storage location that is not left behind after the test run.
- **FR-012**: System MUST retain persisted execution run history indefinitely; no automatic pruning or capping is performed by this feature.

### Key Entities

- **Environment**: A named, operator-defined target configuration consisting of a base URL and its associated authentication/credential configuration, used when executing tests. Scoped to the browser session that created it (consistent with the platform's existing session-isolation model) and persists across restarts for as long as that session remains active.
- **Execution Run**: A single instance of executing one or more test scenarios against an environment, including its overall status (e.g., completed, cancelled — with a reason distinguishing user-initiated cancellation from a backend-restart interruption), start/end timing, and the individual request/response results it produced. Scoped to its owning browser session and persists across restarts for as long as that session remains active.
- **AI Readiness Record**: The AI subsystem's last known readiness state (e.g., not-loaded, loading, ready, unavailable) and, when unavailable, the reason. Persists across restarts.
- **AI Benchmark Result**: The recorded outcome of evaluating a candidate AI model, including the metrics captured and the model identifier evaluated. Persists across restarts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a backend restart, 100% of previously configured environments belonging to a still-active session (including credential configuration) are available for use without any manual re-entry.
- **SC-002**: After a backend restart, previously completed execution runs belonging to a still-active session remain fully viewable with their original status and results.
- **SC-003**: After a backend restart, the AI subsystem's last known readiness state and most recently recorded benchmark results are available immediately, without needing to re-run a benchmark or re-trigger model loading to see them.
- **SC-004**: A first-time installation with no prior data starts successfully with zero manual setup steps for local storage.
- **SC-005**: Restart-time recovery of persisted data adds under 500ms to normal backend startup time, measured with a few hundred environments and execution runs present (a generous local single-operator data volume).
- **SC-006**: No credential value ever appears in plaintext in application logs, error responses, or diagnostic output, verified by review of all logging/error paths that touch persisted environment data.

## Assumptions

- This feature targets a single-operator, local-first developer/test-engineering deployment (consistent with ApiPilot's local-first principles), not a multi-tenant or networked shared database.
- Persisted data lives in a single local file on the same machine running the backend; no remote or distributed storage is in scope.
- "Survives a restart" means an ordinary process stop/start on the same machine with the same storage file location; it does not cover migrating data between machines.
- Execution run history is retained indefinitely with no automatic pruning; if unbounded local disk growth becomes a real operational problem, retention policy can be revisited in a future specification.
- Corrupted or unreadable storage fails startup explicitly (per the project's existing principle of explicit failure over silent recovery) rather than being auto-repaired or silently reset.
- The credential-at-rest protection question (whether stored credential values must be encrypted or may be stored as configured) is deferred to the planning phase, where the project's existing secret-handling conventions and threat model can be reviewed in more depth; this spec's requirement (FR-006) is limited to never exposing credentials in logs/errors, which is unambiguous today.
- New persisted entities correspond to data that already exists in the system today only in-memory (per the feature description); this feature does not introduce new categories of data collection.
