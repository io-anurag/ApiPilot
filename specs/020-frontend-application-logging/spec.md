# Feature Specification: Frontend Application Logging

**Feature Branch**: `020-frontend-application-logging`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "Frontend application logging: introduce a structured logging
utility for the frontend (frontend/src/logger.ts or similar) so that runtime events, errors, and
significant user/API actions in the React app are actually recorded somewhere, instead of only
being caught and shown transiently in the UI (or silently dropped). Context: today frontend/src/
has zero console.* calls and no logging module at all — service clients like
frontend/src/services/executionClient.ts and healthClient.ts catch fetch/JSON errors and convert
them to thrown Errors or typed results for the UI, but never log them anywhere. The only thing
named 'frontend logs' today is frontend/logs/frontend.log, written by frontend/viteLogger.ts /
frontend/vite.config.ts — that only captures Vite's own dev-server/build CLI output (HMR, startup,
build warnings), not anything the running React app does. There is also no backend endpoint to
receive client-side logs, even though the backend already has a real structured logger
(backend/src/logger.ts, JSON lines to console + logs/backend.log) per the constitution's
observability principle. Goal: give the frontend an equivalent, in-browser structured logger
(levels, timestamps, contextual fields) that at minimum writes to the browser console in a
consistent structured way, and decide whether/how significant frontend errors should also be
forwarded to the backend for persistence versus staying client-only. Must respect existing
constitution/security constraints: never log secrets, API keys, full API specifications, or
sensitive AI prompts/responses; keep it framework-appropriate (no new dependency needed); must not
send anything to an external/cloud service; must remain deterministic/testable."

## Clarifications

### Session 2026-09-13

- Q: Should the client-log ingestion endpoint enforce its own small request-size limit, separate
  from the 10MB limit `backend/src/app.ts` already applies globally for OpenAPI spec uploads? → A:
  Yes — add a small, dedicated request-size limit (roughly 4–8 KB) scoped to just this route,
  independent of the 10MB spec-upload limit.
- Q: Does "significant errors" in FR-010 mean every caught error in the covered service-client
  modules, or only some excluded subset (e.g. expected/handled outcomes)? → A: Every caught error
  in these modules is logged, with no exclusions; severity is expressed through the log level and
  fields rather than by omitting some errors from logging.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See What Went Wrong Without Reproducing It Live (Priority: P1)

As a developer working on ApiPilot, when the frontend encounters an error (a failed API call, an
unexpected response shape, a rejected upload), I want that event recorded as a structured entry
with enough context to diagnose it, instead of the error only flashing through the UI and
disappearing, so I don't have to reproduce the failure live with the browser console open to
understand what happened.

**Why this priority**: This is the core complaint driving the request — today nothing in the
frontend is logged anywhere, so every failure investigation starts from zero.

**Independent Test**: Trigger a service-client failure (e.g., stop the backend and make the
frontend call an API), then verify a structured log entry (level, component, event, timestamp,
relevant fields such as operation and error category) appears in the browser console — this alone
is a viable, demonstrable improvement over today's silence.

**Acceptance Scenarios**:

1. **Given** a frontend service-client call fails (network error or non-2xx response), **When**
   the failure is caught, **Then** a structured log entry is emitted describing the operation and
   error category, in addition to whatever the UI already shows the user.
2. **Given** the same failure condition occurs twice with the same inputs, **When** each is logged,
   **Then** both entries have the same shape (fields, level, component/event naming) so entries are
   comparable and parseable, not free-form strings.

---

### User Story 2 - Find a Frontend Error After the Browser Tab Is Gone (Priority: P2)

As a developer, I want at least warning- and error-level frontend events to persist somewhere on
the backend/server side, so I can investigate a user's reported problem after their browser tab or
session has already closed, the same way I already can for backend errors in `logs/backend.log`.

**Why this priority**: Console-only logging solves live debugging but not after-the-fact
investigation, which is the scenario most likely to matter for a real reported issue; this depends
on User Story 1 existing first.

**Independent Test**: Trigger a frontend service-client failure, then close the browser tab, and
verify the corresponding entry is discoverable in the backend's log output/file — independent of
the browser session that produced it.

**Acceptance Scenarios**:

1. **Given** a frontend error occurs, **When** it is logged, **Then** the entry is also sent to the
   backend and becomes discoverable in the backend's existing log output, tagged distinctly from
   backend-originated log entries.
2. **Given** the backend is unreachable when a frontend error occurs, **When** the log entry cannot
   be forwarded, **Then** the user-visible behavior of the application is unaffected (no thrown
   error, no broken UI) and the failure to forward is itself only a local, best-effort console
   notice.

---

### User Story 3 - Never Leak Sensitive Data Through Frontend Logs (Priority: P1)

As someone responsible for ApiPilot's security posture, I want the frontend logger — and anything
it forwards to the backend — to be structurally incapable of carrying secrets, API keys, full
uploaded specifications, or sensitive AI prompts/responses, so introducing frontend logging cannot
become a new way for confidential data to leak into logs.

**Why this priority**: The constitution's observability principle (XX — Observability Without
Sensitive Logging) already governs the backend logger; extending logging to the frontend must not
create a weaker-guarded second channel for the same sensitive data.

**Independent Test**: Attempt to log an entry whose fields include a large/nested value (e.g., a
full specification object or a prompt string) and verify the logger/ingestion path only accepts
simple identifier-shaped fields (strings, numbers, booleans), rejecting or stripping anything else,
so sensitive payloads cannot pass through even by caller mistake.

**Acceptance Scenarios**:

1. **Given** a caller attempts to log a field containing an object, array, or large payload,
   **When** the entry is emitted, **Then** the logger only accepts primitive (string/number/boolean)
   field values, consistent with the backend logger's existing field constraints.
2. **Given** a log entry is forwarded to the backend, **When** the backend receives it, **Then** it
   is written through the existing backend logger without executing, parsing, or otherwise treating
   any field as anything other than a plain log value.

---

### Edge Cases

- The backend is unreachable or returns an error when a frontend log entry is forwarded: the
  application continues working normally; the forwarding failure produces at most one local
  console notice and is not retried indefinitely.
- A caller passes a non-primitive value (object, array, function) as a log field: the value is
  rejected/omitted rather than being serialized and logged as-is.
- The same failure repeats rapidly (e.g., a polling call failing every few seconds): each
  occurrence is logged individually in this feature; no de-duplication or rate-limiting is
  introduced (see Assumptions/Out of Scope).
- A log entry is produced during an automated test run: no real network call or real timer is
  required to observe or assert on the logged entry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The frontend MUST provide one structured logging utility (levels `info`/`warn`/
  `error`, timestamp, a fixed component name, an event name, and optional contextual fields) that
  all frontend code logs through, rather than ad hoc `console.*` calls scattered across the
  codebase.
- **FR-002**: Every log entry MUST be written to the browser console in a consistent structured
  form (not a free-form string) for all three levels.
- **FR-003**: Log entry fields MUST be restricted to primitive values (string, number, boolean);
  the logger MUST NOT accept or silently serialize objects, arrays, or functions as field values.
- **FR-004**: The frontend MUST NOT log secrets, API keys, full uploaded specification content, or
  sensitive AI prompt/response content in any log entry, consistent with constitution principle XX.
- **FR-005**: `warn`- and `error`-level entries MUST additionally be forwarded to a new, lightweight
  backend endpoint so they persist independently of the originating browser session; `info`-level
  entries remain console-only by default.
- **FR-006**: The backend MUST expose an endpoint that accepts one structured client log entry and
  writes it through the existing backend logger (`backend/src/logger.ts`) under a distinct
  component name, so frontend-originated entries are visually distinguishable from backend-
  originated ones in the same log output.
- **FR-007**: The backend endpoint MUST validate incoming entries (level, component, event, and
  field values) and reject or drop any field that is not a primitive value, rather than persisting
  arbitrary payload shapes.
- **FR-008**: A failure to forward a log entry to the backend (network error, non-2xx response)
  MUST NOT throw, block, or otherwise affect application behavior; it is best-effort only.
- **FR-009**: The feature MUST NOT introduce a new npm dependency in either workspace; it is
  implemented with the existing `fetch` API on the frontend and the existing Express/logger
  infrastructure on the backend.
- **FR-010**: Existing frontend service-client error handling (e.g., `executionClient.ts`,
  `healthClient.ts`, and similar modules under `frontend/src/services/`) MUST route every caught
  error through the new logger — with no excluded subset — instead of discarding it after
  converting it to a thrown `Error` or typed result; severity distinctions (e.g. an expected
  not-found outcome versus an unexpected failure) are expressed via log level and fields, not by
  omitting some errors from logging.
- **FR-011**: The logger and the backend ingestion path MUST be unit-testable without depending on
  real timers or real network calls (an injectable/mockable time source and transport).
- **FR-012**: The feature MUST NOT transmit any frontend log data to an external or cloud logging
  service; the only destination beyond the local browser console is the local backend process.
- **FR-013**: The client log ingestion endpoint MUST enforce its own request-size limit (roughly
  4–8 KB), independent of and smaller than the 10 MB limit `backend/src/app.ts` applies globally
  for OpenAPI spec uploads, and MUST reject any request exceeding it before persisting anything.

### Key Entities

- **Frontend Log Entry**: A structured record produced by the frontend logger — level, component,
  event, timestamp, and a bounded set of primitive contextual fields (e.g., operation name, error
  category, HTTP status).
- **Client Log Ingestion Endpoint**: The backend route that receives a Frontend Log Entry over HTTP
  and persists it through the existing backend logger, distinctly tagged from backend-originated
  entries.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every caught error in a frontend service-client module produces one structured
  console log entry, verified for 100% of the existing service-client modules under
  `frontend/src/services/`.
- **SC-002**: A `warn`- or `error`-level frontend event remains discoverable in the backend's log
  output after the originating browser tab is closed, for 100% of such events when the backend is
  reachable at the time of the event.
- **SC-003**: No log entry produced by the frontend logger or accepted by the backend ingestion
  endpoint contains a non-primitive field value, verified by dedicated tests covering the
  rejection behavior.
- **SC-004**: The feature adds zero new npm dependencies to `frontend/package.json` or
  `backend/package.json`.
- **SC-005**: All new/changed unit tests for the logger and the ingestion endpoint pass without
  making a real network call or depending on real wall-clock timing.
- **SC-006**: A request to the client log ingestion endpoint exceeding its dedicated ~4–8 KB limit
  is rejected before any part of it is persisted, verified by a dedicated test.

## Assumptions

- The backend ingestion endpoint reuses the existing `backend/src/logger.ts` component-scoped
  logger pattern (a new component, e.g. `"frontend-client"`) and existing `logs/backend.log` file
  sink, rather than introducing a separate log store, file, or format.
- Only `warn`- and `error`-level frontend events are forwarded to the backend by default; `info`-
  level events are considered normal/expected activity and stay console-only, to bound both log
  volume and the amount of frontend activity that reaches the server.
- No rate-limiting or de-duplication of repeated identical events is introduced in this feature;
  if a real flooding scenario is observed in practice, it is addressed as a follow-up rather than
  speculatively built now.
- The ingestion endpoint's own request-size limit (FR-013) is enforced independently of the
  existing global 10 MB Express JSON limit in `backend/src/app.ts`, which remains sized for spec
  uploads and is not relied upon to bound log entry size.

## Out of Scope

- Sending frontend logs to any external/cloud observability or logging service.
- A log viewer UI within the ApiPilot application itself.
- Persisting frontend logs to a database or any store other than the existing file-based backend
  log sink.
- Correlating frontend and backend log entries via a shared request/correlation ID scheme; entries
  are tagged by component but not yet joined across a single request's frontend and backend legs.
- Rate-limiting, de-duplication, or batching of repeated frontend log events.
