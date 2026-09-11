# Phase 0 Research: Test Execution & Results

All Technical Context fields in plan.md were resolvable from the existing codebase and the
spec's Clarifications — no `NEEDS CLARIFICATION` markers remain. This document records the
engineering decisions behind that resolution.

## D1. Execute the existing generated Postman artifact via Newman, not a hand-rolled HTTP+assertion engine

**Decision**: At execution time, call the same `generateCollection()` (`backend/src/postman/
generateCollection.ts`) already used for AP-007/AP-016 export, passing the selected Environment's
`baseUrl`/`variableValues` as `options`, to obtain a "live" `collection.json` with real values
substituted for `{{baseUrl}}`/`{{token}}`/etc. Run that collection through `newman` (the
standard Postman collection runner, added as a new backend dependency) rather than
independently parsing `TestScenario`/`Assertion` and re-implementing HTTP request construction,
assertion evaluation, and workflow-variable extraction.

**Rationale**: `backend/src/postman/assertionScripts.ts` (existing, AP-007) already translates
every `Assertion` into a real, executable Postman `pm.test(...)` script (`statusCodeLines`,
`schemaLines`) and every AP-016 workflow data handoff into a real `pm.collectionVariables.set(
...)` extraction script (`appendWorkflowExtractions`) — these are embedded directly in the
generated collection today, purely inert until something runs them. Newman is exactly "something
that runs them": it is the standard Postman collection runner, already produces structured
per-item results (status, timing, per-assertion pass/fail with error detail), and already
implements request building, environment/variable resolution, redirect handling, and inter-request
delay (`delayRequest`) correctly. Building a parallel engine would duplicate all of this while
also risking behavioral drift between "what the exported collection.json does when a QA engineer
runs it in real Postman" and "what ApiPilot's own execution does" — the two must agree, since
`specs/ROADMAP.md`'s AP-017 objective itself names "Postman Collection → Newman → Execution →
Results" as the initial execution path. This is a direct application of constitution XXVIII
("Technology Is Replaceable, Domain Concepts Are Not" — "must be preferred over reinventing
standards implementations (e.g., OpenAPI and Postman collection schemas) with custom code").

**Alternatives considered**:
- *Execute `TestScenario`/`GeneratedRequest`/`Assertion` directly via `fetch`, with a new,
  hand-written assertion evaluator.* Rejected: duplicates `assertionScripts.ts`'s already-shipped,
  already-tested translation logic and `workflowRendering.ts`'s ordering/extraction logic; two
  independent implementations of "what does this assertion mean" is exactly the drift constitution
  XXVIII warns against, and doubles the surface area this feature must test.
- *A different Postman-collection runner or a bespoke Node VM sandbox for `pm.test` scripts.*
  Rejected: Newman is the canonical, actively maintained implementation of exactly this, with a
  stable Node API; reimplementing a `pm.*` sandbox is a large, security-sensitive undertaking with
  no corresponding product value.

**New dependency**: `newman` (backend only). This is the one new dependency this feature
introduces; every other requirement is met by existing code plus Node's built-ins.

## D2. Drive Newman one request at a time from ApiPilot's own orchestration loop, not one `newman.run()` over the whole collection

**Decision**: AP-017's own orchestrator iterates the same ordered list of items
`backend/src/postman/workflowRendering.ts`'s `planApprovedWorkflows()` already computes for
export (approved-workflow steps in order, then standalone scenarios) and, for each item in turn,
invokes Newman against a single-item sub-collection carrying just that one Postman request item
(with its existing embedded scripts), passing forward the accumulated collection-variable state
from every prior item's Newman run so a later item can see an earlier item's extracted workflow
variable. The orchestrator awaits each Newman invocation fully before starting the next.

**Rationale**: This is what makes FR-010 (strictly sequential, no concurrent requests within a
run), FR-011 (a configurable pause between requests), and FR-015 (cancel a run, letting an
in-flight request finish but not starting the next one) straightforward and independently
testable: sequencing, pacing, and the cancellation check are one small loop in our own code, not
a behavior we would otherwise have to configure or infer from Newman's own iteration-data/
delay-request machinery. Newman itself becomes a "run one Postman item and tell me what
happened" primitive, not the run's controller.

**Alternatives considered**:
- *Hand the whole generated collection to one `newman.run(...)` call with `delayRequest` set for
  pacing.* Rejected for cancellation: Newman's public Node API documents starting a run and
  listening for its `done`/`request`/`assertion` events, but does not document a supported way to
  abort a started run early. Confirming or building around an undocumented internal abort path
  would be a fragile foundation for a safety-relevant feature (FR-015). Per-item invocation makes
  "stop starting new items" trivially reliable regardless of Newman's own abort support.
- *Run the whole collection but poll/kill the underlying process.* Rejected: Newman runs in-process
  (a Node library, not a subprocess) in this design, so there is no OS process to signal; and
  killing arbitrary in-flight work would violate the edge case that an in-flight request must be
  allowed to reach its own recorded outcome.

## D3. Execution is a session-scoped capability alongside the guided workflow, not a tenth `WorkflowStageId`

**Decision**: `WORKFLOW_STAGE_ORDER` (`packages/shared-domain/src/testGenerationWorkflow.ts`)
stays exactly as it is today, ending at `postmanGeneration`. Environments and execution runs are
tracked in a new sibling, session-scoped store (`backend/src/execution/executionStore.ts`),
keyed by session id via the same `AsyncLocalStorage` pattern `workflowStore.ts` already
established (`specs/017-session-workflow-isolation` research.md D1), gated only by a simple
precondition check ("the current workflow's `postmanGeneration` stage is `complete`") rather than
a stage transition of its own.

**Rationale**: Every existing stage is entered once and completes once (aiEnhancement's retry
notwithstanding, which still settles to one terminal outcome). Execution is structurally
different by design (spec.md User Story 5, FR-019/FR-020): the same approved collection may be
run many times, against many environments, indefinitely, well after "the workflow" in the
upload→...→postmanGeneration sense has finished. Forcing that into a single-shot
`not-yet-reached → active → complete` stage would misrepresent its actual lifecycle and complicate
every other stage's `isStageEnterable`/staleness logic for no benefit. Keeping it a separate,
precondition-gated store is a direct application of constitution IX (Separation of Concerns) and
X (Domain Model First — don't distort an existing aggregate's shape to fit a new, differently-shaped
concern).

## D4. `POST .../execution/start` returns immediately; the client polls for progress — informed by a real incident from this feature's own validation work

**Decision**: Starting an execution run registers it and returns as soon as the first request has
been dispatched (or immediately, before any request, mirroring `ai-enhancement`'s existing
"started" response shape), then continues running server-side. The client polls (or reuses the
existing workflow poll it already has open) to observe progress and the eventual terminal state,
exactly as AP-012 already established for AI enhancement.

**Rationale**: This is not a hypothetical concern. During this feature's own MVP-validation work
earlier in this project (`specs/ROADMAP.md` Next Actions #11-12), a validation script that
`await`-ed a single long-running POST (AI enhancement, itself following the same "block until
done" shape this decision now avoids) hit Node's default ~300-second undici headers-timeout and
failed client-side even though the server-side work continued correctly — the fix was to poll
instead of blocking on one long request. A test-execution run over a real collection with
per-request pacing (FR-011) can easily run past that same threshold, so this feature is designed
to avoid the failure mode from the start rather than discover it in production the same way.

**Alternatives considered**: *Block the HTTP response until the whole run completes* (matching
`ai-enhancement`'s original, pre-progress-visibility shape). Rejected for the concrete reason
above, and because AP-012 already established the poll-based pattern this feature can reuse
directly rather than reinvent.

## D5. Failure categorization is derived from Newman's per-item result shape, not re-inferred from raw responses

**Decision**: `backend/src/execution/mapNewmanResult.ts` (new) maps one Newman single-item run
result to this feature's `RequestResult`/`FailureCategory` vocabulary (spec.md FR-012):
- A top-level request error on the item (Newman surfaces connection-level failures — refused,
  DNS failure, TLS failure — as an `error` on the executed request, distinct from a completed
  HTTP response) → `connectivity-failure`.
- A request error whose underlying code indicates a timeout (Newman's configured `timeout`/
  `timeoutRequest` elapsed) → `timeout`.
- A completed response whose embedded `pm.test` assertions include at least one failure → decode
  which assertion failed (status-code vs. schema-conformance, per the `pm.test` name
  `assertionScripts.ts` already gives each one) → `assertion-failed`, or, if the failure's own
  error indicates the check itself could not run (e.g. the response body was not valid JSON when
  a schema check tried to parse it) → `could-not-evaluate`.
- A completed response where every assertion passed → `passed`.

**Rationale**: `assertionScripts.ts`'s two test names ("Status code is ...", "Response body
conforms to the documented schema") are stable, distinguishable strings this mapper matches
against Newman's per-assertion result name — no new assertion-identification scheme is needed,
and the mapping stays entirely on the "translate an already-known shape" side rather than
re-deriving meaning from a raw HTTP response the way a from-scratch evaluator (rejected in D1)
would have to.

## D2 addendum (implementation-time correction). Workflow handoffs travel through Newman's `environment` scope, not `collectionVariables`

**Discovery**: Empirically verified (three throwaway Newman probes against a local server) that
Newman's Node API does not expose a run's `pm.collectionVariables.set(...)` mutations back to the
caller under any invocation shape tried — not via `summary.collection.variables`, and not even
when the exact same live `postman-collection` `Collection` instance is reused by reference across
two sequential `newman.run()` calls. This is consistent with Newman only ever supporting
`--export-environment`/`--export-globals`, never an equivalent for collection variables: collection
variables are scoped to a single run and are not designed to be read back out afterward. By
contrast, `pm.environment.set(...)` mutations are correctly reflected in `summary.environment`, and
handing that same `VariableScope` forward as the next `newman.run()` call's `environment` option
correctly resolves a later item's `{{variable}}` reference to the earlier item's extracted value.

**Correction**: `backend/src/postman/assertionScripts.ts`'s `extractionLines()` (AP-016) now emits
`pm.environment.set(...)` instead of `pm.collectionVariables.set(...)`. No documented contract
changes: `WorkflowExtraction`, `appendWorkflowExtractions()`, and every existing test were
unaffected (none asserted the literal script text), and a human running the unmodified downloaded
collection+environment pair one request at a time in Postman's own UI sees identical behavior,
since Postman persists environment values across a session the same way. AP-017's orchestrator
(`runExecution.ts`) carries each item's `summary.environment` forward as the next item's
`environment` input; the static values every item needs (`baseUrl`, credential-like
`variableValues`) are instead baked directly into the per-item sub-collection's own `variable`
array by calling `generateCollection()` with the selected `Environment`'s real values (D1) — only
the *dynamic*, workflow-extracted values need to travel between one item's Newman invocation and
the next.

## D6. Per-request pacing and cancellation are enforced between iterations, not inside Newman

**Decision**: The orchestration loop (D2) checks a session-scoped cancellation flag and waits the
configured `Environment.requestDelayMs` (FR-011, default `0`) immediately before starting each
item's Newman invocation (never before the first item, so pacing never delays a run's very first
request). Cancellation is a plain in-memory flag on the `ExecutionRun` record, set by
`POST .../execution/cancel` and read by the loop between iterations (constitution XXVII: no new
infrastructure, a Node built-in boolean check is sufficient).

**Rationale**: Directly delivers the edge case from spec.md ("let an in-flight request reach its
own outcome; only requests not yet started are recorded as not-attempted/cancelled") for free,
since the flag is only ever consulted at an iteration boundary, never mid-request.
