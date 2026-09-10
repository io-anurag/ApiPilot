# Phase 0 Research: Session-Scoped Concurrent Workflow Isolation

All Technical Context fields in plan.md were resolvable from the existing codebase and the
spec's Clarifications — no `NEEDS CLARIFICATION` markers remain. This document records the
engineering decisions behind that resolution.

## D1. Carry session identity via `AsyncLocalStorage`, not an explicit parameter

**Decision**: A `node:async_hooks` `AsyncLocalStorage<{ sessionId: string }>` is populated once,
by a new Express middleware, for the lifetime of each request. `workflowStore.ts` reads the
current session id from that context internally; no other module receives or passes a
`sessionId` parameter.

**Rationale**: `workflowStore.ts`'s eleven exported functions (`getCurrentWorkflow`,
`startWorkflow`, `updateStage`, `setAiEnhancementProgress`, `setAiEnhancementBatchOutcome`,
`markAiEnhancementGenerating`, `requestAiEnhancementCancel`, `isAiEnhancementCancelRequested`,
`advanceActiveStage`, `patchWorkflow`, `resetStore`) are called from eight different stage
modules (`apiReviewStage.ts`, `aiEnhancementStage.ts`, `deterministicGenerationStage.ts`,
`scenarioReviewStage.ts`, `workflowReviewStage.ts`, `postmanGenerationStage.ts`,
`startWorkflow.ts`, `dependencyAnalysisStage.ts` via `assembleWorkflows.ts`) and directly from
`api/testGenerationWorkflow.ts`'s route handlers. Threading an explicit `sessionId` parameter
through every one of those call sites (Alternative A, below) would touch on the order of a
dozen files purely to plumb a value none of them otherwise care about, for a feature whose
actual concern is transport-level session identity, not workflow domain logic — directly
contrary to constitution IX (Separation of Concerns) and XXVII (Prefer Simple Architecture:
"minimal dependencies, clear module boundaries" over invasive signature churn). Node's
`AsyncLocalStorage` is the standard idiom for exactly this problem — request-scoped context
available anywhere in an async call chain without prop-drilling — and is a zero-dependency
built-in already available in Node 20.

**Implementation finding (confirmed during `/speckit-implement`)**: `multer`'s multipart-upload
middleware (`upload.single("file")`, used by the workflow-start route) does not preserve
`AsyncLocalStorage` context across its own internal stream-completion callback — its `next()`
call was verified (via a stack trace during implementation) to run outside the context
established by `sessionMiddleware`. `backend/src/session/sessionMiddleware.ts` therefore also
exports `reaffirmSession`, a small middleware that re-enters the session context immediately
after `upload.single(...)`, using a session id `sessionMiddleware` stashes directly on `req` for
this purpose. `backend/src/api/testGenerationWorkflow.ts`'s upload route is the only call site
that needed this one-line addition (`upload.single("file"), reaffirmSession, async (req, res,
next) => ...`); every other route, and every one of the eight stage modules, needed no change,
so D1's core claim still holds.

**Second implementation finding**: ten existing unit test files under `backend/tests/unit/testGenerationWorkflow/`
call `workflowStore.ts` or a stage module directly, with no HTTP request/`sessionMiddleware`
pass involved at all. Rather than rewrite all ten to manually wrap every test body in a session
context, a new global Vitest `setupFiles` entry
(`backend/tests/setup/sessionTestContext.ts`) calls a new `sessionContext.enterTestSession(id)`
helper — a thin wrapper around `AsyncLocalStorage.enterWith` — in a `beforeEach` that runs for
every test in the backend suite, giving each test its own fresh session id automatically.
Confirmed empirically that this propagates correctly from Vitest's `beforeEach` into the `it`
body (both run within the same continuous async call chain). Integration tests that make real
`supertest` requests are unaffected: `sessionMiddleware` establishes its own per-request session
for each actual HTTP call, which simply supersedes this ambient one for that call. This required
no changes to any of the ten existing unit test files.

**Alternatives considered**:
- **A. Explicit `sessionId` parameter on every `workflowStore` function and every caller.**
  Rejected: touches ~10 files that have nothing to do with session identity, for no behavioral
  benefit over the context-based approach, and increases the risk of a caller accidentally
  passing the wrong session id.
- **B. A `WeakMap` keyed by the Express `Request` object, read directly in
  `api/testGenerationWorkflow.ts` and passed down.** Rejected: still requires threading the
  value through every stage module for the same reason as Alternative A, and ties workflow
  logic to Express's `Request` type where it currently has no HTTP-layer dependency at all
  (violates IX further).

## D2. Session identifier: `crypto.randomUUID()` in an `httpOnly`, `sameSite=lax` cookie

**Decision**: The session middleware reads a `sessionId` cookie from the incoming request. If
absent or unrecognized, it generates a new id with Node's built-in `crypto.randomUUID()`
(RFC 4122 v4, 122 bits of randomness) and sets it via `res.cookie("sessionId", id, { httpOnly:
true, sameSite: "lax" })`. No `maxAge` is set (session cookie — cleared when the browser closes,
consistent with "no login, no persistent identity" in the spec's Assumptions).

**Rationale**: Directly implements FR-004a (cryptographically random, unguessable — 122 bits
makes brute-force/enumeration infeasible at this application's scale) and FR-004 (no login).
`httpOnly` prevents the id from being read or exfiltrated by page JavaScript (defense in depth
per constitution XVII); `sameSite=lax` is Express's/browsers' standard mitigation against the
cookie being sent on cross-site requests, appropriate since this feature adds no legitimate
cross-site use case. A cookie (rather than a response header the client must manually echo back)
means zero changes are needed to any existing `fetch(...)` call in
`frontend/src/services/*Client.ts` — same-origin requests already include cookies automatically
(verified: the frontend only ever calls relative `/api/...` paths, which are same-origin to
whichever origin served the page, and `frontend/vite.config.ts`'s dev-server proxy forwards the
`Set-Cookie`/`Cookie` headers transparently since the browser never talks to the backend's own
origin directly).

**Alternatives considered**:
- **A client-generated token sent as a request header** (e.g. `X-Session-Id`, generated and
  stored by the frontend in `localStorage`). Rejected: requires changing every existing fetch
  call site to attach the header, achieves nothing a cookie doesn't already provide for this
  app's same-origin topology, and a self-chosen client id is a weaker guarantee of
  unguessability than a server-generated one (FR-004a is a server-side MUST).
- **`crypto.randomBytes(32).toString("hex")`** instead of `randomUUID()`. Rejected as
  unnecessary: `randomUUID()` already provides adequate entropy for this application's ~20-
  concurrent-session scale (Clarifications) via a Node built-in with no extra code.

## D3. Session storage: an in-memory `Map`, index of `workflowStore`'s existing state

**Decision**: A new `backend/src/session/sessionRegistry.ts` owns a single
`Map<string, { lastActivityAt: number; expired: boolean }>` for session bookkeeping.
`workflowStore.ts` is refactored to hold `Map<string, { currentWorkflow, nextWorkflowSequence
}>` internally (replacing today's two bare module-level variables) and look up the current
session's entry via D1's context before doing anything a given function already does today —
every exported function's body is otherwise unchanged.

**Rationale**: This is the smallest change that satisfies FR-001–FR-003: one workflow instance
per session instead of one per process, using the exact same state shape and transition logic
already implemented and tested. FR-008 (no new persistence) rules out anything beyond
in-memory storage, and constitution XXVII rules out introducing a cache/database for ~20
concurrent sessions' worth of state.

**Alternatives considered**:
- **A generic "multi-tenant store" abstraction wrapping arbitrary state.** Rejected as premature
  abstraction (constitution XXVII, this repo's own anti-over-engineering conventions) —
  `workflowStore.ts` is the only thing being partitioned by session in this feature; a general
  abstraction has no second caller to justify it.

## D4. Idle-session eviction: a periodic sweep, not lazy-only expiry

**Decision**: `sessionRegistry.ts` runs a `setInterval` sweep (period: a fraction of the
60-minute window, e.g. every 5 minutes) that finds sessions whose `lastActivityAt` is more than
60 minutes old, discards their `workflowStore` entry, and marks the registry entry `expired:
true` (a small tombstone — two fields — rather than deleting the entry outright, so a later
request from that same session id can be told "expired" per FR-007a instead of looking
identical to a session that never existed). `lastActivityAt` is refreshed by the session
middleware on every request from that session (FR-007's "resets this window on every request").

**Rationale**: A purely lazy approach (only checking/evicting when that session's own next
request arrives) would never reclaim memory for sessions that simply vanish and never
return — exactly the "abandoned session" case FR-007/SC-003 target — because nothing would ever
trigger the check for a session that never sends another request. A periodic sweep is required
to actually bound memory growth. At ~20 concurrent sessions (Clarifications), a 5-minute sweep
over a small `Map` is negligible cost, consistent with "Performance Goals" in plan.md.

**Alternatives considered**:
- **Lazy-only eviction (check on next access).** Rejected per the rationale above — it does not
  satisfy SC-003's "abandoned sessions stop consuming workflow memory within one hour."
- **Delete the entry outright on eviction, with no tombstone.** Rejected: this cannot satisfy
  FR-007a, which requires distinguishing "your session expired" from "you're new" — without a
  tombstone the two cases are indistinguishable by construction.
- **Tombstones retained forever.** Accepted as the simplest option: a tombstone is two small
  fields, not the full workflow payload, so even in a long-running process this is negligible
  memory relative to what a live session already costs. Revisit only if evidence later shows
  otherwise (constitution XXX, Explicit Trade-offs).

## D5. GET workflow endpoint: one additive response case for "expired," not a new endpoint

**Decision**: `GET /api/test-generation-workflow` keeps its existing two cases — `200 { workflow
}` and `204 No Content` (never had a workflow) — and gains a third: `200 { workflow: null,
sessionExpired: true }` when the caller's session registry entry is a D4 tombstone. The
frontend's `WorkflowOrNoneResult` type (`frontend/src/services/testGenerationWorkflowClient.ts`)
gains one optional field, `sessionExpired?: boolean`, read the same way `workflow` already is.

**Rationale**: Minimal, backward-compatible extension of an existing, already-well-tested
contract (`specs/009-e2e-test-generation-workflow/contracts/test-generation-workflow-api.md`)
rather than a new endpoint — the existing 204 case is unchanged in every scenario that produces
it today (a session that has genuinely never started a workflow still gets 204), so no existing
test or caller regresses.

**Alternatives considered**:
- **A dedicated `GET .../session/status` endpoint.** Rejected: duplicates a check the frontend
  already performs once, on load, via the existing workflow-fetch call — the same reasoning
  `specs/012-ai-enhancement-progress/research.md` Decision 1 used to reject a second polling
  endpoint applies here.

## D6. Logging: never log the full session identifier

**Decision**: Wherever a session id would be useful in a structured log line (e.g. correlating
requests to the same session for debugging), only a short, non-reversible prefix (first 8 hex
characters of the id) is logged — never the full identifier.

**Rationale**: Once issued, a session id is functionally a bearer credential for that session's
in-progress workflow — anyone who has it can present it as their own `sessionId` cookie and see
that session's data (this is the same property FR-004a relies on to keep sessions apart).
Logging it in full would create exactly the kind of "second, less-guarded channel for sensitive
data" constitution XX warns against: an operator or anyone with log access could read a live
session's id from `logs/backend.log` and use it to access that session's in-progress
workflow — an active credential-leak vector, not merely a diagnostics concern. An 8-character
prefix is enough to correlate log lines from the same session during debugging without being
usable to reconstruct or guess the full 122-bit identifier.

**Alternatives considered**:
- **Log the full session id, matching how `workflowId` is already logged today** (e.g.
  `workflowStore.ts`'s `stage_transition` event). Rejected: `workflowId` is not a credential —
  knowing it grants no access on its own (every request is already implicitly scoped to the
  caller's own session after this feature). A session id is different in kind: it is exactly
  the value presented to prove "this is my session."

## D7. Compatibility with `specs/012-ai-enhancement-progress`

**Decision**: No change to `specs/012-ai-enhancement-progress`'s design is required. That
feature's Decision 2 (progress lives on the same `workflowStore` singleton, "any reconnect...
sees the same live progress") continues to hold true — it now holds true per-session instead of
per-process, which is exactly what spec 017's User Story 1 (Acceptance Scenario 3) requires:
each session watching its own AI-enhancement run's progress. Nothing in AP-012's
polling/reveal-as-you-go mechanism assumed process-wide state beyond what D1–D3 already
preserve (the same object shape, the same polling endpoint, the same update functions).

**Rationale**: This confirms the spec's own "Relationship to Existing Specifications" section —
AP-012's design was built on "no per-session identity" as an *absence* it happened not to need,
not a hard requirement that this feature must work around. Re-verified directly against
`specs/012-ai-enhancement-progress/research.md` Decision 2's actual text before concluding this.
