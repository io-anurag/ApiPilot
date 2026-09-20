# Phase 0 Research: External Postman Collection Import & Execution

No `[NEEDS CLARIFICATION]` markers remain in `spec.md` — every functional-scope, security, and
architecture-shaping ambiguity was resolved across two `/speckit-clarify` passes (2026-09-20).
This document instead records the engineering decisions needed to turn that resolved
specification into a concrete design, given what AP-017/specs/018 and AP-025/specs/025 already
built.

## D1. Uploaded collection/environment parsing and validation

**Decision**: Add `postman-collection` as an explicit direct backend dependency (it is already
present transitively via `newman`, so this adds no new package to `node_modules`, only an
explicit declaration) and use its `Collection` constructor plus its own structural validation to
determine whether an uploaded JSON body is a well-formed Postman Collection v2.1 document
(FR-002). Reuse the same SDK class `backend/src/execution/newmanRunner.ts` already runs requests
through, rather than a second, independent representation of "a Postman request."

**Rationale**: Constitution XXVIII: "MUST be preferred over reinventing standards
implementations (e.g., OpenAPI and Postman collection schemas) with custom code." Postman
Collection Format v2.1 has known edge cases (multiple auth placements, nested folders, nested
variable scopes) that a hand-rolled validator would under-handle.

**Alternatives considered**: A hand-written JSON Schema check against the public Postman
Collection v2.1 schema — rejected: duplicates logic `postman-collection` already implements
correctly, and this codebase's own Newman-based execution engine already trusts that SDK's
parsing for every other collection it touches.

## D2. Environment JSON validation

**Decision**: A lightweight structural check (a `values: Array<{ key: string; value: string }>`
shape, tolerating Postman's optional `enabled`/`type` fields) rather than a dedicated schema
package. Refuse with a specific error naming the missing/malformed field when the shape does not
match (FR-003).

**Rationale**: Postman's environment export format is materially simpler than a full collection
— constitution XXVII ("Prefer Simple Architecture... MUST NOT introduce infrastructure solely
because it may be useful") argues against pulling in a schema-validation library for a four-field
shape.

**Alternatives considered**: Reusing `postman-collection`'s own environment-adjacent classes —
investigated, but that package's environment support is Newman-invocation-oriented (a plain
`{ values: [...] }` object, not a validated class), so it offers no real validation benefit over
a direct structural check.

## D3. Destructive-method detection without `ApiModel`

**Decision**: Generalize `backend/src/execution/destructiveOperations.ts`'s existing
`DESTRUCTIVE_METHODS` set into a shared export, and add
`backend/src/externalCollections/destructiveRequests.ts`, which recursively walks an uploaded
collection's `item`/`item.item` tree (folders nest arbitrarily) and returns every request whose
method is in that same set, labeled by the request's own name (there is no `operationPath` to
report, per spec.md Key Entities). FR-013 requires this to be "the same" vocabulary the existing
`ApiModel`-based path uses — importing the one constant, rather than duplicating it, is what
makes that requirement actually true rather than aspirational.

**Rationale**: A Postman collection request always specifies its own HTTP method directly
(`request.method`), so no OpenAPI schema is needed to classify it — confirmed during
`/speckit-clarify`.

**Alternatives considered**: A second, independently-defined destructive-method set for uploaded
collections — rejected: risks silently drifting from the `ApiModel`-based set over time, which
FR-013 explicitly rules out ("the same... vocabulary").

## D4. Persistence shape for an uploaded collection/environment pair

**Decision**: One new table, `uploaded_collections`, storing the pair as a single row per
`UploadedCollectionSet` (id, session_id, name, tier, collection JSON as plaintext, environment
variable values encrypted via the existing `CredentialCipher`, request_delay_ms, created_at) —
mirroring `environments`' own columns and encryption pattern in
`backend/src/persistence/environmentRepository.ts` exactly, rather than two joined tables.

**Rationale**: The collection and its environment are always uploaded, named, selected, and
removed together (FR-001/FR-016/FR-017) — spec.md's two "Key Entities" describe a 1:1-paired
domain concept, not two independently-manageable ones; constitution XXVII favors the simpler
single-table shape when nothing in the spec requires swapping one half independently of the
other. The collection JSON itself is stored as plaintext (not encrypted) — unlike the
environment's variable values, a Postman collection is not expected to carry credentials of its
own (it references them via `{{variables}}`, exactly like ApiPilot's own generated collections
already do per constitution XVIII), so encrypting it would add cost without the risk FR-009
targets.

**Alternatives considered**: A separate `uploaded_environments` table joined 1:1 to
`uploaded_collections` — rejected as unnecessary indirection given the pair's lifecycle is
always identical (research.md D4 above).

## D5. Session-scoped store and repository pattern

**Decision**: `uploadedCollectionStore.ts` (session-scoped CRUD: create/list/get/remove) backed
by `uploadedCollectionRepository.ts` (SQLite), mirroring `execution/environmentStore.ts` /
`persistence/environmentRepository.ts` line-for-line in structure: keyed by `getSessionId()`,
registered against the same `onExpire()` session-eviction hook (specs/017), reusing the shared
`SqliteConnection`.

**Rationale**: This is an established, already-tested pattern in this codebase for exactly this
shape of session-scoped, named, CRUD-able artifact. Reinventing a different pattern here would
create an unjustified second convention for the same kind of problem.

## D6. Execution orchestration and result mapping

**Decision**: `runUploadedCollectionExecution.ts`, structurally mirroring
`execution/runExecution.ts`, walks the uploaded collection using `postman-collection`'s own
`Collection.forEachItem(callback)` (confirmed present in the installed SDK —
`postman-collection/lib/collection/item-group.js:195`), which recursively visits every request
item, at any folder nesting depth, in the collection's own document order — this satisfies
FR-005's ordering requirement and the Edge Cases' "nested folders" case directly, without needing
a `PostmanFolder`-shaped intermediate type.

Each visited item is converted via the SDK's own `item.toJSON()` into a new shared-domain type,
`PostmanRawItem` (`packages/shared-domain/src/externalCollections.ts`) — **not** the generator-only
`PostmanRequestItem`/`PostmanEvent`/`PostmanBody`/`PostmanAuth` (`postmanArtifact.ts`) originally
proposed here. Those types are documented in `postmanArtifact.ts` as "the subset of the
collection format ApiPilot emits; nothing outside it is generated," and are structurally incapable
of representing arbitrary third-party content: `PostmanEvent.listen` only allows `"test"` (no
`"prerequest"`, even though `postman-collection` itself supports both —
`lib/collection/event.js`), and `PostmanBody.mode` only allows `"raw"` (Postman itself also
supports `urlencoded`, `formdata`, `file`, `graphql` — confirmed in
`lib/collection/request-body.js`'s `RequestBody.MODES`). `PostmanRawItem.event` allows
`listen: "prerequest" | "test"`, and its `request.body`/`request.auth` carry the SDK's own
already-validated JSON (validated at upload time via `postman-collection`'s `Collection`
constructor, D1/FR-002 — not re-validated by a second, ApiPilot-authored type).

`backend/src/execution/newmanRunner.ts`'s `runSingleItem()` is **widened**, not behaviorally
modified, to accept `item: PostmanRequestItem | PostmanRawItem` — `newman.run()` already accepts
either shape as plain JSON; only the TypeScript contract needs to widen, and the function's
internal dispatch logic does not change.

`mapNewmanResult()` (`execution/mapNewmanResult.ts`) is still **not** reused as-is for the result
(unchanged from the original finding below): it takes a full `TestScenario` and interprets
Newman's assertion results against that scenario's own typed `assertions` (`"status-code" |
"schema-conformance"`), via `assertionTestPlan()`/`assertionScripts.ts` — machinery that only
makes sense for ApiPilot's own generated, structured assertions. An uploaded collection's Postman
"tests" script is arbitrary, author-named, and untyped from ApiPilot's point of view; there is no
`TestScenario.assertions` to interpret it against. A new, smaller `mapUploadedResult()` is added
instead, producing a `testOutcomes: Array<{ name: string; outcome: "passed" | "failed"; detail?:
string }>` list read directly off Newman's own `execution.assertions[]` (each entry's `assertion`
string is the test's own name; `.error?.message` becomes `detail`, redacted the same way
`mapNewmanResult.ts`'s `redactIfSensitive()` already redacts a credential-like field name — this
redaction helper is reused, not duplicated).

**Rationale**: The request-dispatch mechanics (`newmanRunner.ts`) are genuinely
execution-source-agnostic and safe to reuse outright, once its item type is widened. The
*result-interpretation* half is not shareable — forcing an uploaded collection's opaque, arbitrary
tests through `TestScenario`-shaped assertion types would either fabricate a
`"status-code"`/`"schema-conformance"` classification the collection never declared (violating
constitution I: "MUST NOT fabricate... that are not supported by the specification") or require
every test to be artificially forced into that closed vocabulary. Separately, the
*item-representation* half also needed correction during Phase 1 design review:
`postmanArtifact.ts`'s types are deliberately scoped to what ApiPilot's own generator emits, and
stretching them to also hold arbitrary uploaded content would have either silently dropped
pre-request scripts (blocking FR-008) and non-raw bodies, or required widening those types in
place — which would let a future *generator* change silently start emitting content
(`"prerequest"` events, non-raw bodies) the exporter never actually produces, undermining the
very guarantee `postmanArtifact.ts`'s own doc comment states. A parallel, narrower-purpose
`PostmanRawItem` for the uploaded-only path reuses the real standard (`postman-collection`,
constitution XXVIII) rather than reinventing collection-item parsing, without that risk.

**Alternatives considered**: Coercing every uploaded test into `"status-code"` or
`"schema-conformance"` by guessing from the test's name — rejected: guessing at classification is
exactly the kind of fabrication constitution I and XIV ("No Silent Assumptions") forbid. Widening
`PostmanRequestItem`/`PostmanEvent`/`PostmanBody`/`PostmanFolder` in place instead of introducing
`PostmanRawItem` — rejected: those types are also consumed by the generator/export path (the
`postmanCollectionExport` pipeline and AP-017's execution of *generated* collections); broadening
what they permit would weaken the guarantee that only what `generateCollection()` actually emits
is representable there.

## D7. Shared "one execution in progress" slot (FR-015) without breaking AP-017's contract

**Decision**: Keep `execution/executionRunStore.ts` (generated runs) and the new
`uploadedCollectionExecutionStore.ts` (uploaded runs) as two separate stores/tables, each with
its own `getInProgressRun()`. Add one cross-check in each start route: before creating a new run,
each route checks *both* stores' in-progress state, refusing with the existing
`execution_in_progress` error shape if either has one. `RunUploadedCollectionExecution`'s own
route additionally reuses `execution/executionRunStore.ts`'s `getInProgressRun()` (already
exported), and the existing `execution/start` route (`backend/src/api/testGenerationWorkflow.ts`)
gains one additional check against the new store.

**Rationale**: A single merged table for both run kinds was considered but rejected: AP-017's
`ExecutionRun` type and its `contracts/execution-api.md` are already shipped and consumed by
existing frontend code and tests; reshaping that table to also hold uploaded runs would be a
breaking change to an already-stable contract for no benefit FR-015 actually requires (FR-015
only requires the *slot* to be shared, not the storage). Two stores with one small, additive
cross-check satisfies FR-015 exactly, changes zero existing response shapes, and keeps
`git diff` minimal against a shipped feature (CLAUDE.md §56, §58).

## D8. A sibling result/run type for uploaded collections

**Decision**: Given D6's finding that assertion interpretation cannot honestly be shared,
introduce `UploadedRequestResult` as a distinct shared-domain type — deliberately kept
structurally parallel to `RequestResult` (same `outcome`/`durationMs`/`responseStatusCode`/
`rawCapture?` fields, same meaning) but with `requestName: string` in place of `scenarioId` +
`operationPath`/`operationMethod`, and `testOutcomes` (D6) in place of `assertionOutcomes`. A
sibling `UploadedCollectionExecutionRun` mirrors `ExecutionRun` the same way (see data-model.md).
Both carry `source: "uploaded"` as a literal discriminant field so a caller handed either run
type — in a future unified list — can branch on it safely without a type-unsafe shape check.

**Rationale**: D6 established that the two kinds of result are not actually structurally
identical once assertions are involved — pretending otherwise with an optional `scenarioId` and
a shared `assertionOutcomes` shape would either need to force uploaded tests into
`"status-code"`/`"schema-conformance"`, or make every consumer of `RequestResult.assertionOutcomes`
newly handle a `type` value that never applied to it before. A parallel, explicitly-named type
keeps AP-017's existing `RequestResult` contract completely untouched (no consumer of it needs to
change) while still letting the frontend reuse presentational sub-components
(`RunOverview`/list/row layout) across both, since only the assertion-detail rendering differs.

**Alternatives considered**: The single-type, optional-field approach originally proposed before
D6's finding — superseded once the assertion-vocabulary mismatch was identified.

## D9. Frontend entry point (FR-011: standalone, no workflow required)

**Decision**: Add a small, two-tab view switcher at the top of `App.tsx` ("Guided Workflow" /
"Import & Run Collection"), holding the active tab in local component state — no routing
library.

**Rationale**: `frontend/src/App.tsx` renders exactly one page today
(`TestGenerationWorkflowPage`) with no router; AP-009's own research.md already decided against
adding `react-router` for in-workflow stage navigation, on the grounds that a strip-based
tracker was sufficient. The same reasoning applies here — two top-level, mutually exclusive views
do not warrant a routing dependency (constitution XXVII).

**Alternatives considered**: Introducing `react-router` for a proper `/import` route — rejected
as disproportionate infrastructure for two top-level views, and inconsistent with the existing,
deliberate no-router precedent.

## D10. Combining the two confirmation gates (FR-007 and FR-013)

**Decision**: Two independent, sequentially-checked confirmation gates on
`execution/start`-equivalent, each requiring its own `confirmed: true` resubmission: (1) the
FR-007 "unverified content" gate, evaluated only while `UploadedCollectionSet.confirmedAt` is
unset and permanently satisfied once accepted; then (2) the existing FR-013 risk-tier gate,
evaluated on every run start exactly like AP-017's own `confirmation_required` behavior. A
brand-new upload against a staging/production tier surfaces both, one at a time, across two
confirmed resubmissions.

**Rationale**: The two gates protect against genuinely different things — FR-007 is about *this
content's* trustworthiness (asked once, since re-litigating it on every run of an
already-reviewed upload adds friction without new information), FR-013 is about *this run's*
target risk (asked every time, since the target's risk doesn't change based on whether the
content was reviewed before). Collapsing them into one combined warning would blur two distinct
facts the user needs to separately understand, and would not compose with AP-017's own
already-shipped `confirmation_required` contract shape.

**Alternatives considered**: A single combined confirmation naming both concerns at once —
rejected: harder to test independently, and would require a new response shape rather than
reusing AP-017's existing `confirmation_required` error exactly.

## D11. Script execution sandbox

**Decision**: No new sandboxing layer. Newman's own script engine (already what
`newmanRunner.ts` invokes for every request, including ApiPilot's own generated assertion
scripts) runs the uploaded collection's pre-request/test scripts exactly as authored, unmodified.

**Rationale**: This is precisely the constitutional exception granted by the 2026-09-20 amendment
to Article XVII: execution inside "the same sandboxed script engine Newman/Postman itself already
uses." Building a second, ApiPilot-specific sandbox would be new infrastructure the amendment
does not require and constitution XXVII would not permit without a demonstrated gap in Newman's
existing isolation.

**Alternatives considered**: A custom `vm2`/`isolated-vm`-based sandbox — rejected: Newman
already provides this, and introducing a second one would duplicate, not improve, the isolation
boundary the amendment relies on.
