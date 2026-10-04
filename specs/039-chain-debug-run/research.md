# Research: Chain Debug Run

Sources: spec.md (with its 2026-10-04 clarifications), a read-only survey of `backend/src/performance/**`, `packages/shared-domain/src/requestChain.ts` and the chain editor UI, and constitution v3.0.0. File references below were true when surveyed.

## R1. How a Debug run sends its requests

**Decision**: an in-process TypeScript executor (the "debug executor") that interprets the saved `ChainPlan` directly and sends requests with Node's global `fetch`. It is a deliberate twin of the k6 runtime's per-step logic, held to it by parity tests (R2).

**Rationale**:
- The k6 runtime is a fixed JavaScript string (`CHAIN_RUNTIME`, `backend/src/performance/k6/renderChainScript.ts`), not a module. Nothing in it can be imported.
- Capturing exchanges from a real k6 process would need k6 to write bodies somewhere (an output file or stream). That puts request and response content on disk, which breaks FR-009 and FR-011 and the AP-036/037 rule.
- Evaluating the generated script in a `vm` on the server would execute a generated script in the backend process (constitution XVII), and `k6/http` is synchronous where `fetch` is not.
- Changing `CHAIN_RUNTIME` to share code would change the generated script bytes and break AP-037 FR-030 (byte-identical scripts) and the golden fixtures.

**Alternatives rejected**: k6 with a capture file; `vm` with a stubbed `k6/http`; refactoring the runtime into a shared TS module compiled into the script.

## R2. Keeping the twin honest (parity)

**Decision**: the debug executor reproduces the runtime's behaviour, and parity is enforced by tests that run the same plan with the same stub responder through the existing sandbox (`backend/tests/fixtures/chain/chainSandbox.ts`, `loadChainPlan`) and through the debug executor, comparing: the requests built (method, resolved URL, headers, body), per-extractor outcome, per-check outcome, and which steps were sent or skipped. Dynamic variables are table-tested against the sandbox for fixed VU, iteration, run tag and a frozen clock. A hash guard on `CHAIN_RUNTIME` fails when the runtime changes, prompting a parity review.

**Pieces to twin**: reference filling and request building (URL, query, headers, raw and form bodies), dynamic variable generation (including its word lists), extractors, checks, expected-status matching, and the setup and chain flow.

## R3. Where the spec and the runtime differ (spec corrected)

The survey found that the runtime does not behave exactly as spec 039 first assumed. A debug run that differs from the load run would mislead the engineer, so the spec is corrected to mirror the runtime (see spec Clarifications, "Plan-phase corrections"):

| Topic | Runtime today | Spec 039 first draft | Resolution |
|---|---|---|---|
| What stops a chain | A failed extractor stops the chain. An unexpected status alone does not stop an every-iteration step; it stops only a once-per-VU step and a setup step. | "A step runs only if earlier steps returned an expected status and all extractors succeeded." | FR-008 mirrors the runtime. |
| A missing environment or data value | That one step is skipped as "missing data"; later steps still run. | FR-018 refused the whole run. | A Debug run does not refuse. It shows the step as not sent with the missing name. The trigger lists missing values as a warning. |
| A step needing an extracted name that is absent | That one step is skipped ("dependency"). | Not a listed cause. | Added to FR-007 as a skip cause. |
| Extractor on a non-JSON body | There is no content-type rule. The runtime tries to parse JSON regardless of content type, and any failure is one "not found". | FR-005 named "not JSON (content type)" as a reason. | The Debug run keeps the same pass/fail result but explains the failure: body not parseable as JSON (the content type received is shown as context), path not found, header missing, or value not a single text/number/boolean (object, array, null or empty). |

This also corrects an earlier statement in this session that extraction applies to JSON content types only; it does not.

## R4. Sending requests: transport details

**Decision**: global `fetch` behind an injected `Sender` interface (so tests use a fake, as the runner and probe are already injected).
- Per-request timeout 30 s (matches the Newman runner), whole-run cap 120 s; `AbortController` for both and for cancellation.
- Redirects followed manually up to 10 hops (k6 follows redirects), and every hop's resolved origin is checked against the plan's allowed hosts. A hop outside the allowed hosts is not followed and is reported as the response.
- Response bodies are read up to 2 MiB; extractors and checks run on what was read. Display is truncated to 64 KiB, after masking, with the full size shown. Binary bodies (by content type or non-text bytes) are described, not rendered.
- No cookie jar, no proxy configuration beyond the platform default, no automatic retries.
- `Host` and `Content-Length` are not settable (existing `HEADERS_NOT_SETTABLE` rule).

**Host check**: the existing check is static (URLs must start with `{{baseUrl}}` or a literal origin). The runtime does not check after substitution, so the debug executor adds a check of every resolved URL, and every redirect hop, against the plan's `hosts` plus the environment base URL origin. A violation is a "not sent" step with cause `host-not-allowed`, never a request.

## R5. Masking and reveal

**Decision**: a server-side masker produces **segments**, not strings: text pieces and masked pieces. A masked piece carries a `valueId` and `revealable`. Masking is applied to the resolved URL, request and response header values, and request and response bodies, and to extracted values, before the result leaves the server.

Sensitive literals come from:
1. secret environment values and secret data-column values (known by name from `ChainPlan.secretNames` and `DataSetColumn.secret`): masked, **not revealable**, and never placed in the result in clear text;
2. values of sensitive header names (Authorization, Proxy-Authorization, Cookie, Set-Cookie, API-key style): masked, revealable;
3. values at JSON fields with sensitive names (password, secret, token, api key, credential, bearer), found by walking the parsed body: masked, revealable;
4. extracted values that look like credentials (bearer-shaped, or extracted by an extractor named like a credential): masked, revealable.

The text is split on every occurrence of each sensitive literal (longest first), so a token also masked inside a later request's header or URL is masked there too. Existing detectors are reused (`backend/src/testDesign/sensitiveValueDetection.ts`: `isSensitiveHeaderName`, `isBearerTokenValue`, `isSensitiveFieldName`; `backend/src/failureAnalysis/redaction.ts`: `scanOutput` pattern and its no-super-linear-regex approach). The sensitive header set must include Authorization, Proxy-Authorization, Cookie, Set-Cookie and API-key style names; extend it if it lacks any. The existing `redactBody` returns plain `[redacted]` strings without value ids, so it cannot support reveal and is not used for output.

**Bodies are shown exactly as sent and received.** A body is parsed only to *find* the values at sensitive field names; it is never re-serialised or pretty-printed. The original text is split around the sensitive literals, so whitespace, key order and number formatting are the wire's own, and field names stay visible because only values are replaced (FR-003, FR-016). An unmasked body must be reproducible byte for byte from its segments plus the held values.

**Reveal**: revealable real values are held **server-side in memory** for the life of the Debug run view (`heldValues`), keyed by debug run id and value id, session-scoped, with a 30-minute expiry, and released when the view is closed (explicit discard call), when a new Debug run replaces it, or when the session ends. A reveal call returns one value. The value is never written to disk or logs. This is stricter than sending clear values to the browser and masking in the page, and it keeps FR-015b true by construction: non-revealable secrets never leave the server.

**Known limit**: a secret shorter than 3 characters is not replaced inside free text (a one- or two-character scan would shred the output). It is still masked in headers and URL query values, which are structured. Documented in the user manual.

## R6. Run model: synchronous, cancel by disconnect

**Decision**: one `POST` that runs to completion and returns the whole masked result (10 steps typically finish within the SC-005 budget). Cancellation is the browser aborting the request; the server listens for the connection closing and aborts in-flight sends. No run row, no registry other than a per-plan in-memory lock for FR-023 and the reveal store.

**Why not streaming**: progress streaming adds a protocol, partial-result masking and a replay problem for no scenario in the spec. It can be added later without changing the result shape.

**Execution slot**: the existing session-wide slot (`findExecutionInProgress`) guards load runs. A Debug run refuses to start while a run is in progress (409 `execution_in_progress`) so it never competes with a load run for the same target; whether a Debug run should itself occupy the slot is settled in implementation after reading `execution/executionSlot.ts` (task T-slot).

## R7. Environment tier safeguards

The survey found no server-side tier enforcement for chain runs; the "safeguards" are the trigger display (environment name, tier, base URL, hosts, write steps, data sets) and an explicit start action (`ChainRunPanel`). FR-017 therefore means: the Debug trigger shows the same information and requires the same explicit confirmation, and the host allow-list is enforced server-side (R4). No new tier policy is invented; adding one is a separate specification. The spec was reworded to say this (analysis fix F1).

## R10. Time limits (FR-025)

Per-request timeout 30 s; whole-run cap 120 s. When the cap is reached, requests in flight are aborted, every step not yet sent is `not-sent` with cause `not-reached: run-time-cap`, and `DebugRunResult.notes` states that the run was cut off. A request that times out is a sent step with no response and reason `timeout`.

## R8. Logging and persistence

No `getPerformanceRunRepository()` use and no run directory use. Log events are `chain_debug_run_started`, `chain_debug_run_finished`, `chain_debug_run_cancelled`, with plan id, counts, duration and an error category only (logger fields are scalars only; error messages are not logged). A leak-scan integration test, modelled on `backend/tests/integration/performance/chainLeakScan.test.ts`, proves SC-002.

## R9. Frontend

A "Debug run" action beside the run trigger in the chain plan editor opens a trigger panel that reuses the run panel's environment/tier/base-URL/hosts/data-set/write-summary blocks (extract a shared summary component rather than duplicate it), then shows the output: one section per chain, one card per step with request and response in code blocks that scroll within their area, outcome badges that use text as well as colour, a not-sent reason, and reveal buttons on revealable masked pieces. Calls go through `frontend/src/services/requestChainClient.ts`, extending its error detail keys. Styling is Tailwind with existing tokens and components (`StatusBadge`, `ErrorState`, `controlStyles`), including dark mode and keyboard access.

## Resolved unknowns

All Technical Context items are resolved above. No `NEEDS CLARIFICATION` remains. Two implementation-time checks are recorded as tasks: the execution slot integration (R6) and whether `valueAtPath` (shared-domain) walks own keys and arrays exactly as the runtime's `field()` does (R2).
