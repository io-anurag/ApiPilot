# Quickstart: Validating Session-Scoped Concurrent Workflow Isolation

Validates the feature end-to-end once implemented. Assumes the standard local dev setup
already documented in the repo root `README.md` (`npm install`, `npm run dev`).

## Prerequisites

- Backend and frontend dev servers running (`npm run dev` from the repo root, or the backend
  and frontend workspaces separately).
- Two small OpenAPI fixture files (any two of the existing fixtures under
  `backend/tests/fixtures/testGenerationWorkflow/` work, or any two valid, distinct
  specifications).
- A way to hold two independent cookie jars: two different browsers, one regular + one
  private/incognito window, or two `curl --cookie-jar` sessions against the backend port
  directly.

## Scenario 1 — Two sessions stay isolated (User Story 1 / FR-001, FR-010)

1. Open the app in Browser A. Upload specification X. Advance through analysis and
   deterministic generation.
2. Open the app in Browser B (a different browser or private window). Upload a different
   specification Y. Advance through analysis and deterministic generation.
3. **Expected**: Browser A's screen still shows only specification X's operations/scenarios at
   every point; Browser B's screen shows only specification Y's. Reloading either browser does
   not show the other's data.
4. In Browser A, make a scenario-review decision (accept/reject one scenario). **Expected**:
   Browser B's review state is completely unaffected.

## Scenario 2 — A single browser's continuity is unchanged (User Story 2 / FR-002)

1. In Browser A (from Scenario 1), reload the page. **Expected**: the same in-progress
   workflow resumes at the same stage — identical to today's pre-feature behavior.
2. Open a second tab to the same app in Browser A. **Expected**: the second tab shows the same
   in-progress workflow, not an empty state.

## Scenario 3 — A new session never sees another session's data (User Story 3 / FR-006)

1. While Browser A (Scenario 1) still has an in-progress workflow, open a third, previously
   unused browser profile or private window (Browser C).
2. **Expected**: Browser C's `GET /api/test-generation-workflow` (visible in devtools' Network
   tab, or via `curl -i http://localhost:<BACKEND_PORT>/api/test-generation-workflow` with no
   cookie) returns `204 No Content` — never Browser A's or B's workflow.

## Scenario 4 — Session-identifier unguessability (FR-004a)

1. Inspect the `Set-Cookie: sessionId=...` header returned on Browser A's first request
   (devtools Network tab, or `curl -i`).
2. **Expected**: the value is a UUID-shaped, high-entropy string (not sequential, not a small
   integer, not derivable from request timing or order).
3. Attempt a request with a guessed/incremented variant of that id (e.g. flip a few hex
   characters) as the `sessionId` cookie. **Expected**: `204 No Content` (a session that does
   not exist), never Browser A's workflow.

## Scenario 5 — Idle-session expiry notice (FR-007, FR-007a)

Requires either waiting 60+ minutes or a build with the idle window temporarily lowered for
manual testing (the automated tests in `backend/tests/unit/session/` cover this with
`vi.useFakeTimers()` — this manual scenario is a real-clock sanity check, not the primary
verification).

1. Start a workflow in a session, then stop sending requests from it for longer than the idle
   window.
2. Make a new request from that same session (e.g. reload the page).
3. **Expected**: the response is `200 { "workflow": null, "sessionExpired": true }`, and the UI
   shows an explicit "your previous session expired due to inactivity" notice — not an
   indistinguishable blank "no workflow started yet" state.
4. Starting a fresh workflow from this notice screen works normally and behaves exactly like a
   brand-new session from this point on.

## Scenario 6 — The shared AI provider is unaffected (FR-005)

1. With two sessions each having reached the AI-enhancement stage, trigger AI enhancement from
   both around the same time.
2. **Expected**: both complete (or degrade) using the one shared local AI provider/inference
   queue — this feature does not attempt to run two model instances, and each session's
   AI-enhancement progress (`specs/012-ai-enhancement-progress`) reflects only its own run.

## Automated coverage (primary verification)

- `backend/tests/integration/sessionIsolation.test.ts`: two `supertest` agents
  (`request.agent(app)`, each maintaining its own cookie jar) run concurrent, interleaved
  workflow requests against one `app` instance and assert neither ever observes the other's
  data — the executable form of Scenarios 1–3.
- `backend/tests/unit/session/sessionRegistry.test.ts`: idle-eviction timing and tombstone
  behavior, using `vi.useFakeTimers()` — the executable form of Scenario 5's timing.
- `backend/tests/unit/session/sessionId.test.ts` (or inline in the middleware test):
  `crypto.randomUUID()` is used for identifier generation — the executable form of Scenario 4.
- Frontend test for `TestGenerationWorkflowPage`: renders the session-expired notice when
  `fetchCurrentWorkflow()` resolves `{ ok: true, workflow: null, sessionExpired: true }`.

Run with the existing repo-wide validation commands (`npm test`, `npm run lint`, `npm run
build`) before considering the feature done, per `.claude/CLAUDE.md` §54 and the constitution's
Definition of Done (XXXI).
