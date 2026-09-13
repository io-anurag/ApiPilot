# Phase 0 Research: Frontend Application Logging

No `NEEDS CLARIFICATION` markers remain in the Technical Context — both `/speckit-clarify`
sessions (2026-09-13, 2026-09-14) resolved every consequential ambiguity before planning. This
document instead records the concrete technical decisions needed to satisfy the spec's FRs using
patterns already established in this codebase, so Phase 1 design has no open questions to carry
forward.

## Decision 1: Injectable time source for the frontend logger

**Decision**: `createLogger` (or the module-level logger) accepts an optional clock function
(`() => Date`, defaulting to `() => new Date()`), used solely to produce each entry's `timestamp`
field.

**Rationale**: FR-011 explicitly requires the logger to be unit-testable without depending on real
timers. The existing backend logger (`backend/src/logger.ts`) does not inject a clock — its tests
(`backend/tests/unit/logger.test.ts`) instead assert only that the emitted `timestamp` round-trips
as a valid ISO string, without asserting an exact value, because backend log tests never need
comparison against a fixed instant. FR-011's wording is stronger than that (an explicit
"injectable/mockable time source"), and asserting an exact timestamp is useful here specifically
because the frontend logger's other tests (e.g., "both entries have the same shape") benefit from
deterministic, comparable output. A single optional constructor parameter is the smallest change
that satisfies FR-011 as written without disturbing the backend logger's existing, working
convention.

**Alternatives considered**: Mirror the backend logger's shape-only assertion approach exactly —
rejected because FR-011 was already settled during specification and asks for more than shape
verification; reopening it at planning time would contradict Specification Traceability
(constitution XXVI).

## Decision 2: Mockable transport for backend forwarding

**Decision**: The forwarding call uses the global `fetch` API directly (no custom `Transport`
abstraction); tests stub it with `vi.stubGlobal("fetch", …)`.

**Rationale**: This is the exact pattern already used and proven across this codebase's frontend
service-client tests (`frontend/tests/unit/reviewsClient.test.ts`,
`frontend/tests/unit/postmanCollectionsClient.test.ts`,
`frontend/tests/unit/PostmanExportPanel.test.tsx`). It satisfies FR-011's "mockable transport"
requirement with zero new abstraction, consistent with constitution XXVII (Prefer Simple
Architecture).

**Alternatives considered**: A dedicated pluggable `Transport` interface (e.g., dependency-injected
into `createLogger`) — rejected as unneeded ceremony for a single best-effort `fetch` call with no
other planned transport implementation.

## Decision 3: Backend per-route request-size limit without a new error path

**Decision**: The new client-log-ingestion route gets its own `express.json({ limit: "8kb" })`
middleware, mounted in `app.ts` for that route's specific path *before* the existing global
`app.use(express.json({ limit: MAX_UPLOAD_BYTES }))`. No new error-handling code is added.

**Rationale**: Express (via `body-parser`) marks a request's body as already parsed once a
matching JSON middleware runs, and every subsequent `express.json()` in the middleware chain
skips re-parsing it — so mounting a smaller-limit, path-scoped parser earlier in the chain safely
overrides the global 10 MB limit for just that one route, without double-parsing or needing to
inspect `Content-Length` manually. When the smaller limit is exceeded, `body-parser` throws the
same `entity.too.large`-typed error the global limit already throws for oversized spec uploads —
and `backend/src/app.ts`'s centralized error handler (`errorHandler`) already maps that exact
error type to a `413 payload_too_large` response (lines handling `(err as {
type?: string }).type === "entity.too.large"`). FR-013/SC-006 are therefore satisfied by
configuration and route-mount order alone, with zero new error-handling logic — directly serving
constitution XXVII.

**Alternatives considered**: A hand-rolled `Content-Length` check inside the new route handler —
rejected as redundant, error-prone (must be kept in sync with the framework's own limit
enforcement), and inconsistent with how the existing global limit is already enforced.

## Decision 4: Global uncaught-exception/rejection capture mechanism

**Decision**: A dedicated module (`frontend/src/globalErrorHandlers.ts`) installs one
`window.addEventListener("error", …)` and one `window.addEventListener("unhandledrejection", …)`
listener, each extracting a primitive-safe summary of the error and calling the shared logger's
`error(...)` method. Installed once at bootstrap, from `main.tsx`.

**Rationale**: FR-010a requires capturing both uncaught exceptions and unhandled promise
rejections. A React `<ErrorBoundary>` only catches errors thrown during rendering within the
component tree beneath it — it does not observe promise rejections, event-handler exceptions
outside React's render cycle, or errors from code entirely outside React (e.g., a `<script>` or a
timer callback), so it cannot satisfy FR-010a on its own. `window`-level listeners are the
standard mechanism for the general case FR-010a actually describes.

**Alternatives considered**: A React `<ErrorBoundary>` alone — rejected as insufficient coverage
(does not observe rejections or non-render exceptions); deferred as a candidate for the
already-out-of-scope component-level instrumentation follow-up. `window.onerror =`/`window
.onunhandledrejection =` property assignment instead of `addEventListener` — rejected only because
property assignment silently overwrites any other handler already assigned the same way, whereas
`addEventListener` composes with other listeners; there are none in this codebase today, but
`addEventListener` costs nothing extra and avoids a foot-gun for future code.

**Testability**: jsdom supports dispatching synthetic `ErrorEvent` and (via a small polyfill-free
custom event carrying `reason`) rejection-like events on `window`, so SC-007's tests can trigger
both listeners deterministically without an actual unhandled crash reaching the test runner.

## Decision 5: Runtime primitive-field enforcement (not type-only)

**Decision**: The logger's field-acceptance path filters at runtime — any field whose value is
not a `string`, `number`, `boolean`, or `undefined` is dropped before the entry is emitted or
forwarded, in addition to the TypeScript type restricting well-typed callers.

**Rationale**: FR-003 requires the logger to actually reject/not-serialize non-primitive values,
not merely to discourage them at the type level. The most common real violation is a caught
`unknown`/`Error` value passed directly as a field (e.g. `logger.error("x", { err })`), which
TypeScript's structural typing cannot prevent once a caller is inside a loosely-typed `catch`
clause. Runtime filtering is required to make FR-003/User Story 3 actually hold.

**Alternatives considered**: Type-level restriction only — rejected as insufficient per the above;
throwing on an invalid field — rejected because a logging call must never itself become a new
source of failure (consistent with FR-008's fail-safe intent applied consistently).

## Decision 6: Backend component naming and route conventions

**Decision**: The new route lives at `backend/src/api/clientLogs.ts`, following the exact shape of
every existing route module (e.g. `backend/src/api/health.ts`): a thin Express router doing
validation/adaptation only, registered in `app.ts` via `app.use("/api", clientLogsRouter)`. It
calls `createLogger("frontend-client")` (from the existing `backend/src/logger.ts`) to persist
entries, so they appear in the same `logs/backend.log` sink, visually distinguished from
backend-originated entries by that component name (satisfying FR-006).

**Rationale**: Matches constitution IX (Separation of Concerns) and this repository's established
router/logger conventions exactly — no new pattern is introduced.

**Alternatives considered**: A separate log file/sink for frontend-originated entries — rejected;
the spec's Assumptions section already settles this ("rather than introducing a separate log
store, file, or format").
