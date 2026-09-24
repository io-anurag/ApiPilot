# Research: AI Failure Analysis (AP-031)

**Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Each decision records what was chosen, why, and what was rejected. File references point to the
code as it stood on 2026-09-23.

## D1 — Input: AP-026 uploaded-collection results, addressed by run and position

**Decision**: Analyze `UploadedRequestResult` entries (`packages/shared-domain/src/externalCollections.ts:63`)
inside an `UploadedCollectionExecutionRun`. A result is addressed by `(runId, resultIndex)`.
AP-017 `RequestResult`s are out of scope.

**Rationale**:
- The UI runs every collection, generated or uploaded, through AP-026. Its only results view is
  `frontend/src/components/ExternalCollectionRunPanel.tsx`.
- AP-017's run endpoints are API-only. They also require the session's current workflow to have
  completed Postman generation (`backend/src/api/testGenerationWorkflow.ts:143-151`), which
  conflicts with FR-014 (any run in history).
- Neither result type has a per-result id. `results` is append-only (`uploadedCollectionRunRepository.ts`
  `appendResult`), so an index is stable once a result exists.

**Alternatives considered**:
- Supporting both AP-017 and AP-026 behind a shared core: rejected by the user (Clarifications
  2026-09-23) because it adds an API-only surface with no UI. The core is written so that a later
  AP-017 adapter only needs to build evidence.
- Adding a per-result UUID: rejected. It would need a stored-results migration and gives nothing
  that `(runId, resultIndex)` does not.

## D2 — Record the executed request's identity on each result (FR-017)

**Decision**: Add optional `itemId?: string` to `UploadedRequestResult`. Set it in
`backend/src/externalCollections/runUploadedCollectionExecution.ts` from the executed `item.id`,
which is already in scope there (`:63`, `:112`). Pass it through `mapUploadedResult`. Stored rows
keep their JSON shape, and older rows simply lack the field.

**Rationale**:
- Postman item ids survive upload and editing. `ensureStableIds` persists the SDK-assigned or
  source id (`itemIdentity.ts:17-19`), and the SDK prefers an id already present.
- For generated collections, the id is a content-derived hash
  (`backend/src/postman/identifiers.ts:33-43`), so it is an exact, deterministic key back to the
  generated item.
- The `results` column is a JSON array, so no schema change is needed.

**Alternatives considered**:
- Matching on `requestName`: rejected. Names can be edited in AP-028 and are not unique, and
  constitution I/XIV forbid matching by similarity.
- Keeping the generator's `provenance` block through upload: rejected. The SDK drops unknown
  properties (`editedItems.ts:1-13`), and preserving it would mean a parallel JSON walk like
  `_apipilotEdited` for no gain over the id.

## D3 — Specification context by exact identity match, snapshotted into the analysis (FR-004, FR-018)

**Decision**: At analysis time, read `getCurrentWorkflow()` (`backend/src/testGenerationWorkflow/workflowStore.ts:50`)
and walk `postmanArtifact.collection` items, including folders. Look for the item whose `id`
equals `result.itemId`. On a match:
1. Read the item's `provenance` (`scenarioId`, `workflowId?`, `stepPosition?`, `relationshipIds?`,
   `postmanArtifact.ts:129-134`).
2. Resolve the scenario in `approvedTestModel`, the operation in `apiModel`, and the documented
   response status codes.
3. For a workflow step, resolve upstream steps from the matching `IntegrationWorkflow` in
   `dependencyAnalysis.workflows`: the steps before this one whose produced variables this step
   consumes.
4. For `relationshipIds`, resolve producer operations from `dependencyAnalysis.graph`.
5. For each upstream step or producer, find its outcome in the same run. Match the other results'
   `itemId`s through the same artifact walk. Use the step's own item for workflow steps, and the
   nearest preceding matched result for that producer operation for relationships. If none is
   found, record `not-in-run`.

The resulting `SpecificationContext` is stored inside the analysis, so it stays readable after a
restart or after a new workflow starts.

When there is no match, the context is `unavailable` with one reason:
- `no-request-identity`: the result predates D2.
- `no-generated-collection`: there is no current workflow or no `postmanArtifact`.
- `not-generated-by-current-workflow`: the id is not found.
- `no-originating-scenario`: the item was found but has no scenario provenance, as with the AP-024
  OAuth2 token-fetch item (`identifiers.ts:56`).

**Rationale**:
- The guided workflow is in memory only (`workflowStore.ts:23`), and an exact match against it is
  the only deterministic link available.
- Snapshotting what was actually used satisfies FR-018 without persisting the workflow, which
  AP-025 deliberately keeps out of scope.

**Known limitation**: scenario ids are content-derived, so a collection exported by an earlier
workflow over the same specification can still match the current workflow's identical scenario.
The matched context then describes a scenario with the same identity. The context records the
matched `workflowId` so the user can see which workflow it came from.

**Alternatives considered**:
- Persisting workflows: rejected as out of scope. AP-025 excludes them, and it would be a large
  change for a secondary story.
- Recomputing item ids from the TestModel: unnecessary, because the artifact already holds the ids
  and provenance.

## D4 — Evidence is extracted deterministically, and the AI only cites it (constitution II, IV, XIX)

*Revised 2026-09-24: evidence extraction is unchanged, and the same list now also feeds the
classification rules, which cite it as `decidingEvidenceIds` (D15, D17).*

**Decision**: Build an ordered, redacted list of `FailureEvidence` items with ids `E1..En`
deterministically from the result and the matched context. The AI must answer with the ids it
relies on. Unknown ids are discarded, and if no valid id remains the answer becomes
"insufficient evidence" (D7).

Evidence kinds, in fixed order:
1. `failure-category`
2. `response-status`
3. `response-time`
4. `test-outcome` (one per test)
5. `request-line` (method and redacted URL)
6. `request-headers`
7. `request-body-excerpt`
8. `response-headers`
9. `response-body-excerpt`
10. `request-edited`
11. `documented-responses`
12. `scenario-expectation`
13. `upstream-step-outcome` (one per upstream step)

Items 5 to 9 are present only with a raw capture, and items 11 to 13 only with matched context.

**Rationale**:
- "Evidence extraction" is fully derivable, so constitution II requires it to be deterministic.
- Citations turn the evidence requirement (FR-003, FR-008) into something validatable: the model
  cannot invent evidence, and the evidence text shown to the user is never model-written.
- It also keeps the prompt compact for a 0.5B-parameter model.

**Alternatives considered**: letting the model quote evidence verbatim. Rejected because quotes
cannot be validated cheaply, can drift from the source, and can reintroduce redacted values.

## D5 — Redaction on the way in, scan on the way out (FR-011, SC-003)

**Decision**: A new pure module `backend/src/failureAnalysis/redaction.ts` redacts evidence before
it reaches the prompt or storage, reusing existing detection:
- **Headers**: values of `isSensitiveHeaderName` headers, and any bearer-shaped value
  (`isBearerTokenValue`), are replaced with `[redacted]` (`backend/src/testDesign/sensitiveValueDetection.ts:31`, `:36`).
- **URL**: query parameters whose names satisfy `isSensitiveFieldName` (`:41`) have their values
  redacted.
- **JSON bodies**: parsed, with values under sensitive field names replaced recursively. Non-JSON
  bodies have bearer tokens and `key=value` pairs with sensitive keys redacted.
- **Truncation**: bodies are capped (request 600 characters, response 1,000 characters) after
  redaction, and the evidence text notes the truncation.
- **Test details**: already redacted with `redactIfSensitive` at mapping time
  (`mapUploadedResult.ts:52`). They pass through unchanged.

After inference, the model's `summary` and `steps` are scanned against the set of values redacted
from the input, and against the uploaded collection's variable values whose names are sensitive
when the collection still exists. Any occurrence is replaced with `[redacted]`. Nothing sensitive
is logged (D12).

**Rationale**:
- Raw captures are stored unredacted today (`mapNewmanResult.ts:63-72`), so this feature must not
  forward them as they are.
- The output scan guards against a secret that sat in a non-sensitive position, for example a
  token in a path segment.

**Alternatives considered**:
- Excluding the raw capture entirely: rejected. It is the richest evidence on the local tier
  (User Story 1, scenario 2).
- Reusing `redactSensitiveRequestValues`: it works on `GeneratedRequest` objects, not on captured
  strings, so it is used as the pattern rather than called.

## D6 — Prompt and response contract, and the system instruction (constitution XXIII)

*Superseded 2026-09-24 for the prompt and response shape by D16 (v4: explanation only). The
`systemPrompt` field and the reasoning for it below still stand.*

**Decision**: A versioned prompt in `backend/src/failureAnalysis/failureAnalysisPrompt.ts`, with
`FAILURE_ANALYSIS_RESPONSE_VERSION = 1`. As in AP-005/AP-008, the input is one
`JSON.stringify({responseVersion, task, request, evidence, specificationContextNote, allowedCauses, example})`
with a worked example of the output.

**Revised 2026-09-23 after evaluation (T057)**: the real-model evaluation showed the default model
copying v1's single example into every answer. Version 2 replaces it with `examples`, three
contrasting evidence-and-answer pairs (specification mismatch, downstream, insufficient evidence).
It also turns each allowed-cause description into a short decision guide, and bumps the version
to 2. Neither version reaches D11's bar with the default model; see
[evaluation.md](./evaluation.md). The response shape is unchanged:

```json
{"responseVersion":1,"cause":"environment-issue","confidence":0.7,
 "summary":"…","evidenceIds":["E1","E2"],"steps":["…"]}
```

`cause` is one of `specification-mismatch`, `environment-issue`, `downstream-service-issue` or
`insufficient-evidence`.

The provider's JSON system prompt is specific to test design and tells the model to output
`{"candidates":[]}` when unsure (`backend/src/ai/localProvider.ts:156-163`), which would steer this
task wrongly. Add an optional, additive `systemPrompt?: string` field to `InferenceRequest`
(`packages/shared-domain/src/aiProvider.ts:14`):
- `LocalProvider` uses it in `apply_chat_template` when present and falls back to
  `SYSTEM_PROMPTS[expectedOutputFormat]` otherwise, so existing callers are byte-identical.
- `MockProvider` ignores it.
- `contractVersion` stays `1`, because the change is optional and backward compatible. It is
  recorded in the specs/004 contract as an additive amendment.

The start hook in D10 is added to the provider in the same additive way.

**Rationale**: The feature owns its instruction text and versions it with its prompt, while the
provider stays free of feature rules (AP-004 constraint).

**Alternatives considered**:
- A `task` discriminator that selects a system prompt inside the provider: rejected because it puts
  feature knowledge in the provider.
- Living with the test-design system prompt: rejected, because it biases the model toward an empty
  `candidates` object.

## D7 — Parsing, validation, and the insufficient-evidence rules (FR-008)

*Superseded 2026-09-24: the conclusion now comes from rules (D15). The parsing approach and the
shape limits below still apply to the v4 explanation answer (D16), and the confidence threshold
and model-derived insufficient-evidence reasons are retired.*

**Decision**: Parsing and validation are hand-written, like the rest of the codebase (no schema
library exists in any workspace):
1. **Parse**: strip code fences and fall back to extracting a balanced JSON object, mirroring
   `parseAIScenarioResponse.ts:19-65`. Treat a missing `responseVersion` as current, as AP-005
   does. Anything unparseable is `INVALID_RESPONSE`.
2. **Shape validation**:
   - `cause` must be in the enum;
   - `confidence` must be a number in [0, 1];
   - `summary` must be a non-empty string of at most 400 characters, truncated at a word boundary
     if longer;
   - `steps` must be an array of at most 3 non-empty strings of at most 200 characters each;
     extras are dropped. A `cause` other than `insufficient-evidence` needs at least one step,
     because FR-003 requires suggested investigation steps, so zero steps is `INVALID_RESPONSE`.
     An `insufficient-evidence` answer may have zero steps;
   - `evidenceIds` must be an array of strings.

   A shape failure is `INVALID_RESPONSE`.
3. **Semantic validation**: cited ids not present in the evidence list are dropped.
4. **Conclusion**:
   - `cause === "insufficient-evidence"` gives `insufficient-evidence` with reason
     `model-reported`.
   - Otherwise, `confidence < FAILURE_ANALYSIS_MIN_CONFIDENCE` gives reason
     `below-confidence-threshold`.
   - Otherwise, no valid cited id gives reason `no-valid-evidence-cited`.
   - Otherwise the conclusion is `likely-cause`.

   In the insufficient cases the model's cause is not kept. Summary and steps are kept, and the
   UI labels them as the model's notes.

**Prompt traceability (constitution XXIII)**: a unit test pins a SHA-256 fingerprint of
`FAILURE_ANALYSIS_SYSTEM_PROMPT`, the worked example and the prompt template, stored next to
`FAILURE_ANALYSIS_RESPONSE_VERSION`. Changing any of them fails the test until the fingerprint is
updated, and the test tells whoever updates it to also bump the version. This way the
`responseVersion` recorded in provenance always identifies the prompt that produced an analysis.

**Threshold**: `FAILURE_ANALYSIS_MIN_CONFIDENCE = 0.5`, a versioned constant recorded in every
analysis's provenance.
- Below 0.5 the model itself rates its cause as less likely than not, so presenting it as the
  likely cause would contradict the model's own output (constitution XIV).
- AP-008's 0.85 (`mergeRelationships.ts:80-88`) guards promotion to an executable workflow, which
  is a stronger consequence than a labelled, advisory explanation.
- Small-model confidence calibration is unknown, so the evaluation in D11 measures it, and the
  constant changes only with evidence (constitution XXII, XXX).

**Alternatives considered**:
- No threshold, trusting the model's own "insufficient-evidence" answer: rejected by FR-008.
- A higher bar such as 0.7: no evidence for it yet, and it would hide useful moderate answers. It
  can be revisited after D11.

## D8 — Budget, viability, and no automatic retry (FR-006, FR-012, SC-005)

*Revised 2026-09-24 (D15; `/speckit-analyze` C1): evidence is built once, in full, and that full
list is classified and stored. Trimming for the input budget (body excerpts first, then header
lists) now filters only the prompt's copy:*
- *it keeps the original `E#` ids, which are no longer renumbered, so the AI's citations and the
  rule's deciding evidence refer to the same stored list;*
- *the capacity notice becomes a plain `note` field in the prompt rather than an
  `omitted-for-capacity` evidence item;*
- *if the prompt still does not fit, the explanation is unavailable (`INVALID_REQUEST`), and the
  rule result is unaffected.*

**Decision**:
- `FAILURE_ANALYSIS_MAX_OUTPUT_TOKENS = 256`.
- The timeout is the configured default (`AI_INFERENCE_TIMEOUT_MS`, 120 s, `modelConfig.ts:27`),
  with no feature override.
- Before inferring, run `estimateViability` (`backend/src/ai/viability.ts:58`) with the prompt's
  estimated tokens (`CHARS_PER_TOKEN_ESTIMATE`) and `loadAIConfig().planning` rates. If it is not
  viable, return `not-viable` with `projectedMs` and `budgetMs` without calling `infer()`,
  mirroring `enhanceTestModel.ts:453-486`.
- If the prompt exceeds `getInputBudget(256)`, drop the body excerpts first, then header lists,
  and record this in the evidence as "omitted to fit the model's input capacity". If it still does
  not fit, return `ai-failed` with `INVALID_REQUEST`, as the contract specifies. `not-viable`
  carries projected versus budgeted *time*, which does not describe a size problem. This was
  corrected during implementation (2026-09-23); earlier wording here said `not-viable`.
- Passed tests beyond the first five are summarized by count, so a request with many `pm.test`s
  cannot force a capacity refusal on its own (analysis finding L3).
- A parse or validation failure is returned as `ai-failed` with `INVALID_RESPONSE`. There is
  **no automatic corrective retry**. The user can request again explicitly.

**Rationale**:
- At the default planning rates (42 ms prefill and 180 ms decode per token), roughly 800 prompt
  tokens plus 256 output tokens project to about 80 s, inside the 120 s budget.
- An automatic retry would double the wait past the budget and is a hidden retry, which
  CLAUDE.md §17 forbids.

**Alternatives considered**: AP-005's one corrective retry. Rejected for the reasons above.

## D9 — Persistence: one encrypted row per analyzed result (FR-013, FR-015)

**Decision**: Add a new table in `backend/src/persistence/connection.ts` `initializeSchema()`:

```sql
CREATE TABLE IF NOT EXISTS failure_analyses (
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  result_index INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  analysis_encrypted BLOB NOT NULL,
  analysis_iv BLOB NOT NULL,
  PRIMARY KEY (session_id, run_id, result_index)
);
```

- Writes are a single `INSERT … ON CONFLICT(session_id, run_id, result_index) DO UPDATE`
  statement, so a replacement is atomic (FR-015).
- A failed attempt never writes.
- The payload is the full `FailureAnalysis` JSON, encrypted with the existing `credentialCipher`.
- A new `failureAnalysisRepository.ts` follows the repository pattern and registers an `onExpire`
  listener that calls `deleteBySession`. There are no foreign keys, matching the existing tables.
- `PRAGMA user_version` stays `1`. `CREATE TABLE IF NOT EXISTS` is idempotent on existing
  databases, the same approach used for the raw-capture columns.

**Rationale**:
- Encrypting the whole payload matches how raw captures are protected. The analysis is derived
  from them and contains redacted excerpts, and encryption keeps an excerpt that redaction missed
  from sitting in plaintext at rest.
- A composite key needs no generated id, which helps determinism.

**Alternatives considered**:
- Adding a column to `uploaded_collection_runs`: rejected. It makes every run row read and write
  larger, and makes replacing one result's analysis a read-modify-write of the whole run.
- Plaintext JSON: rejected, see the rationale above.

## D10 — Concurrency and phases: one analysis per session, with visible waiting (FR-016, SC-005)

**Decision** (revised after the 2026-09-23 clarification):
- The analysis service holds an in-memory `Map<sessionId, InProgressEntry>`, where each entry is
  `{runId, resultIndex, requestName, phase, phaseStartedAt}`.
- The check and the insert happen synchronously before the first `await`, and the entry is
  removed in `finally`.
- Any second POST in the same session, for any result, gets 409 `failure_analysis_in_progress`,
  with the in-progress `runId` and `resultIndex` in the body.
- There are two phases:
  - `waiting-for-ai`: from acceptance until the provider starts this request. This covers model
    load and any wait in `LocalProvider`'s FIFO queue behind other AI work.
  - `generating`: from provider start until the request settles.
- A new session-level route, `GET /api/failure-analysis/in-progress`, returns the entry or 204. The
  UI polls it (every 1 s, as the enhancement progress view does) while its POST is pending, and on
  mount, so every "Analyze" action stays disabled across run views and after a page reload.

**Knowing when the provider starts**:
- `LocalProvider` starts the timeout clock only after dequeuing and `ensureEngine()`
  (`localProvider.ts:433-470`), and the `AIProvider` interface has no start signal.
- Add an optional second parameter, `infer(request, hooks?: { onStarted?: () => void })`, to
  `AIProvider` (`packages/shared-domain/src/aiProvider.ts:72`). `LocalProvider.runInference` calls
  `onStarted` right after `ensureEngine()` succeeds, which is the same point its timeout starts, so
  SC-005's "from when the model starts" is exact.
- `MockProvider` calls it immediately. Existing callers and test provider literals pass nothing and
  are unaffected.
- If a provider never calls it, the phase stays `waiting-for-ai` until the request settles, which
  never overstates progress.

**Rationale**:
- One analysis per session keeps each wait bounded by at most one analysis of this session's own,
  and it matches the one-AI-operation guard in `aiEnhancementStage.ts:219-234`.
- A restart clears the map, which matches the spec's edge case that an interrupted analysis is not
  stored.
- The hook is generic lifecycle information with no feature rules in the provider (constitution
  VI; AP-004's constraint).

**Alternatives considered**:
- A per-request guard, allowing parallel analyses in one session: rejected by the clarification,
  because queued analyses could wait with no limit.
- Also refusing while the session's AI enhancement runs (clarification option C): rejected by the
  user. The `waiting-for-ai` phase makes that wait visible instead.
- Exposing queue depth on `AIProvider`: this still would not say when *this* request starts.
- Persisting an in-progress row: it would need restart cleanup, like interrupted runs, for no user
  benefit.

## D11 — Evaluation before trusting the model (constitution VII, XXII)

**Decision**:
- Add a labelled fixture corpus in `backend/tests/fixtures/failureAnalysis/`. It holds about 12
  cases across the three causes and deliberate low-evidence cases, each with the expected cause or
  `insufficient-evidence`. At least 4 cases are taken from real recorded failures, redacted, rather
  than synthesized: for example the PayPal Invoicing API walkthrough (`specs/ROADMAP.md` Next
  Actions #13) and the real-specification runs behind AP-019 to AP-024. This meets XXII's
  "representative API specifications" requirement. Each real case records where it came from.
- AP-031 is not reported as "Implemented" until the real-model evaluation has been run and
  recorded (constitution XXII, XXXI). Until then its status is "Implementation complete — AI
  evaluation pending (constitution XXII)".
- Ordinary tests use scripted `AIProvider` literals, which is the existing practice
  (`tests/unit/testDesign/enhanceTestModel.test.ts:19`). `MockProvider` returns only a hash and
  cannot produce realistic content (`mockProvider.ts:70-80`).
- Add an opt-in real-model evaluation, `tests/integration/failureAnalysis.real.test.ts`, under the
  existing `AI_TEST_REAL_MODEL` gate, with a `test:ai-real:failure-analysis` script. It reports
  structured-output success rate, cause agreement, valid-citation rate, confidence distribution and
  latency. Results are recorded in `specs/030-ai-failure-analysis/evaluation.md` during
  implementation.
- The default model is not changed. If the success rate is below 80%, a model decision goes back
  through AP-004's benchmark process as a separate decision.
- **Adoption bar, tightened 2026-09-24** (product decision after `evaluation.md` run 2 showed a
  model passing the 80% structured-output bar while being confidently wrong on 8 of 12 cases). A
  model and prompt pair is adequate only when, on the corpus, all three of these hold:
  - structured-output success is at least 80%;
  - cause agreement with the label is at least 75% (9 of 12);
  - confidently wrong answers are at most 10% (at most 1 of 12). A confidently wrong answer is a
    likely cause, so at or above the confidence threshold, that disagrees with the label.

  The opt-in evaluation test reports `confidentlyWrongRate` and soft-asserts all three.
- **Superseded for the rule-decided design** (spec Clarifications 2026-09-24): the cause is now
  decided by deterministic rules, so readiness is judged by spec SC-006 instead of the bar above.
  This decision and D4 and D7 are to be revised at the next `/speckit-plan`.
- The shared benchmark harness (`backend/src/ai/benchmark/`) is unchanged, because its scoring is
  plain `JSON.parse` success and cannot measure this task.

**Rationale**: Valid JSON is not correctness (constitution XXII). This task needs agreement and
citation measures that the generic harness lacks.

**Alternatives considered**: adding workloads to `workloads.ts`. That would change the meaning of
`ap004-representative-v1` and still would not score cause agreement.

## D12 — HTTP shape, determinism, logging (FR-006, FR-010; constitution XX, XXIV)

*Revised 2026-09-24: the POST statuses become `analyzed | kept-previous` (D18). Logs also record
`ruleId` and the explanation status.*

**Decision**:

A new router, `backend/src/api/failureAnalysis.ts`, is created as `createFailureAnalysisRouter(provider)`
(the injected-provider pattern of `app.ts:97-106`) and mounted under `/api`:
- `POST /external-collections/:id/execution/runs/:runId/results/:resultIndex/failure-analysis`
  awaits the single inference and returns the attempt outcome.
- `GET /external-collections/:id/execution/runs/:runId/failure-analyses` lists the stored
  analyses for a run.

Neither endpoint requires the collection to still exist, matching the run-detail GET
(`api/externalCollections.ts:563-568`). The `:id` segment is kept for consistency.

AI outcomes follow the existing convention: HTTP 200 with a discriminated `status`
(`analyzed | ai-failed | not-viable`), as `aiProviderOutcome` does (`aiScenarioDesign.ts:73-81`).
Eligibility and state problems use `{error, message}` with 404 or 409 (`contracts/failure-analysis-api.md`).

A synchronous POST is kept because there is one inference, bounded once it starts. Phase and
elapsed time come from the separate in-progress route (D10), so the POST does not need to become a
job. Node's `requestTimeout` limits only how long the server waits to receive a request, not how
long it takes to respond, so a long wait for the local AI does not cut the POST off.

For determinism:
- `requestId = "failure-" + sha256(prompt).slice(0, 24)`, as in `enhanceTestModel.ts:408`.
- The clock is injected for `generatedAt`.
- Greedy decoding is already on in `localProvider.ts:276`.

Logs record run id, result index, duration, outcome, error category and evidence count only.
They never record prompt, response, evidence text or summary.

**Alternatives considered**:
- Asynchronous job plus polling: more moving parts (job state, restart cleanup) for a single
  bounded call (constitution XXVII).
- Mapping AI errors to 5xx: inconsistent with every existing AI endpoint.

## D13 — Frontend placement

*Revised 2026-09-24:*
- *The cause is shown with a `RULE` `ProvenanceBadge`, its strength label ("High" or "Moderate",
  with no number) and the rule's description.*
- *Only the summary and steps carry the `AI` badge and the "AI inference" label.*
- *The evidence for the cause is the rule's deciding evidence (D17).*
- *An "AI explanation unavailable" state replaces the AI-failed and not-viable states, and the
  kept-previous outcome shows the stored analysis with the new failure reason (D18).*
- *`frontend/src/utils/confidenceLabel.ts` is replaced by a strength-label mapping.*

**Decision**:
- Extend `ExternalCollectionRunPanel.tsx`'s `ResultDetail` (`:131`). For a failed result it shows
  an "Analyze failure" action and a new `FailureAnalysisPanel` component.
- Client functions `requestFailureAnalysis` and `listFailureAnalyses` go in
  `frontend/src/services/externalCollectionsClient.ts`.
- The panel has these states:
  - idle;
  - waiting for the local AI, and generating, each with an elapsed timer (D10);
  - analyzed;
  - insufficient evidence;
  - AI failed, with a retry action and any previous analysis still shown;
  - not viable, with a plain-language duration.
- While any analysis in the session is in progress, every "Analyze failure" action is disabled.
  The panel names the request being analyzed (FR-016).
- Confidence is shown as "Moderate" (0.5 to below 0.75) or "High" (0.75 and above) with the exact
  value, for example "Moderate (0.62)". The mapping is a small pure function in `frontend/src/utils/`
  (clarification 2026-09-23).
- Cited evidence is listed by default. The rest is in a collapsed "Other evidence considered"
  section, a native `<details>` element for keyboard and screen-reader support (clarification
  2026-09-23).
- Every analysis carries an "AI inference, not a confirmed root cause" label, using the existing
  `ProvenanceBadge`. Evidence ids resolve to deterministic evidence text, which is visually
  distinct from model text.
- Styling uses Tailwind v4 tokens only, with dark mode and accessible names, and without relying
  on colour alone (constitution XXXIII; CLAUDE.md §26-43).
- Stored analyses for a run are fetched once when the run detail loads (FR-013, FR-014).

**Alternatives considered**: a separate page. Rejected because the analysis belongs next to the
result it explains.

## D14 — Governance check

No constitution amendment is needed:
- XVII: nothing is executed. Only recorded results are read.
- V/XXIX: local or mock only, with no fallback.
- IX: failure analysis is a new, separate module.
- II: evidence is deterministic, and only judgement is AI.

**Drift noted for the user**: `specs/constitution.md` differs from the authoritative
`.specify/memory/constitution.md` (v2.2.0). The authoritative file's own Sync Impact Report already
flags that copy. It is not modified here.

---

# Amendment 2026-09-24: the cause is decided by rules

Source: spec Clarifications 2026-09-24 (five answers). The reason is [evaluation.md](./evaluation.md)
runs 1 to 4: no local model up to 1.7B could judge the cause reliably. The best, Qwen3-1.7B, gave
100% structured output but was confidently wrong on 5 of 12 cases. Every run did produce usable
prose, so the AI keeps the part it does well. D15 to D20 below replace or narrow D4, D6, D7, D11,
D12 and D13 where each says so. D1 to D3, D5, D8 to D10 and D14 are unchanged.

## D15 — Classification rules (FR-003, FR-008; constitution II, XV)

**Decision**: A new pure module, `backend/src/failureAnalysis/classifyFailure.ts`. It takes the
`UploadedRequestResult` and the `SpecificationContext` and returns a `FailureClassification`. The
rules are checked in the fixed order below, and the first one that matches decides. Each rule
records the evidence ids that triggered it, taken from the D4 evidence list, so the display cites
deterministic evidence. The rule set is versioned as `FAILURE_CLASSIFICATION_RULESET_VERSION = 1`.

**Classification never sees trimmed evidence** (constitution XXIV; `/speckit-analyze` finding C1):
- Rules run on the **full, untrimmed** evidence list, which is also the list that is stored and
  displayed.
- Trimming to fit the model's input budget (D8) applies only to the copy of the evidence sent in
  the prompt, and that copy keeps the original ids.
- So the same failure gets the same cause, strength and deciding evidence whatever model or budget
  is configured.

| # | Rule id | Matches when | Cause | Strength |
|---|---|---|---|---|
| 1 | `no-response` | `failureCategory` is `connectivity-failure` or `timeout` | environment issue | High |
| 2 | `gateway-error` | status is 502 or 504 | environment issue | Moderate |
| 3 | `environment-rejected-request` | status is 401, 403, 407, 408 or 429 | environment issue | Moderate |
| 4 | `dependency-named-in-server-error` | status is 500 or 503, and the redacted response body names another service (see below) | downstream-service issue | Moderate |
| 5 | `undocumented-status` | specification context is matched, the operation documents at least one status and no `default`, the status is below 500 and not 404, and it is not among the documented codes (`2XX`-style ranges count as documented) | specification mismatch | High |
| 6 | `status-assertion-mismatch` | the status is 2xx or 4xx, but not 404 and not one of rule 3's codes, and a failed test reports an expected status that differs from the received one (`expected response to have status code N but got M`, the standard Postman `pm.response.to.have.status` message) | specification mismatch | Moderate |
| 7 | `response-content-assertion` | the status is 2xx, at least one test failed, every failed test carries a detail message, and none is a status assertion | specification mismatch | Moderate |
| — | none | none of the above | insufficient evidence, reason `no-rule-matched` | — |

**Deliberately unclassified** (they fall through to insufficient evidence):
- A 404 with no other signal. It can mean a wrong base URL or path (environment) or a route that
  differs from the specification (specification mismatch), and the recorded data cannot tell
  these apart.
- A 500 or 503 with no response body naming a dependency. This includes every non-local run,
  which records no body.
- A 2xx response whose failed tests carry no detail.

**"Names another service"** (rule 4): the redacted response body excerpt is split into tokens on
characters other than letters, digits, `-` and `_`. The rule matches when a token ends in
`-service`, `_service`, `-svc` or `_svc` and has at least one character before that suffix. The
scan is linear, with no backtracking regular expression, because the body is controlled by the
target (see the T060 redaction fix). Tokens like `upstream` are deliberately not signals: Envoy's
`503 upstream connect error` means the gateway could not reach the API itself, which is an
environment issue, not a downstream one.

**Strength**: High only where the signal has one reading: no response at all (rule 1), or a status
the operation does not document (rule 5). Every rule whose signal is plausibly read another way is
Moderate (clarification 2026-09-24, question 2).

**Corpus check**, which SC-006 requires to reach 100% in a unit test:
- rule 1: `env-connection-refused`, `env-timeout`
- rule 2: `env-gateway-502`
- rule 3: `env-bad-credentials-401`
- rule 5: `spec-200-instead-of-documented-201` (200 is not among the documented 201 and 400)
- rule 6: `spec-400-on-documented-request` (400 is documented, but the scenario's test expected 201)
- rule 7: `spec-missing-required-field`, `spec-wrong-content-type`
- rule 4: `downstream-503` (`payment-service`), `downstream-500-dependency` (`inventory-service`)
- no rule: `insufficient-bare-500`, `insufficient-bare-assertion`

The corpus was labelled on 2026-09-23, before these rules existed, against the allowed-cause
decision guide in the v2 prompt, and these rules encode that guide. Real cases (T055) must still
be added. If a real case disagrees with the rules, the rules are revised as a new rule-set
version, and the case is never relabelled to fit.

**Rationale**: Constitution II says deterministic evidence must always be preferred over
probabilistic inference. Constitution XV applies the same conservatism to inference. Every rule
reads fields ApiPilot already records, and the ambiguous cases say so instead of guessing.

**Alternatives considered**:
- A scoring model or weighted rules: harder to explain and test, and it would reintroduce a
  numeric confidence that measures nothing (clarification question 2).
- Letting the AI classify when no rule matches: rejected in clarification question 3.
- Using the scenario's expected status as a separate rule: rule 6 already reaches the same answer
  from the recorded test message, with no new context field (constitution XXVII).

## D16 — The AI explanation contract, prompt v4 (FR-003, FR-008; constitution IV, XXIII)

**Decision**: `FAILURE_ANALYSIS_RESPONSE_VERSION = 4`. Version 3 was evaluated but never shipped,
so the number is not reused (evaluation.md run 2). The prompt input is:

`{responseVersion, task, request, classification, evidence, specificationContextNote, answerFormat}`

- `classification` is the rule-decided outcome as text: the cause label and the rule's plain
  description, or "no rule matched".
- `answerFormat` holds placeholders only, as in v3, because concrete examples were copied by every
  evaluated model.
- The task says to explain the given cause, not choose one. For insufficient evidence, it says to
  suggest what evidence to gather.

The answer is `{"responseVersion":4,"summary":"…","evidenceIds":["E1"],"steps":["…"]}`, with no
`cause` or `confidence`. Validation:
- The shape rules follow D7: summary 1 to 400 characters, 1 to 3 steps of up to 200 characters,
  and ids must exist. One step is required for every outcome.
- **At least one valid cited id** is required (FR-008), or the answer is `INVALID_RESPONSE`.
- **Contradiction check** (FR-008): the answer is rejected as `INVALID_RESPONSE` when the summary
  or a step contains the label or enum key of a cause other than the rule-decided one. For
  insufficient evidence, any cause label counts.
  - The phrases are fixed: `specification mismatch`, `environment issue`, `downstream service`,
    `downstream-service`, and the three enum keys.
  - It is a conservative, deliberately literal check. A negated mention ("not an environment
    issue") is also rejected. That costs an explanation, never correctness.
- The output scan (D5) still applies.

The system prompt keeps the JSON-only instruction and drops the cause-selection sentence. The
fingerprint test pins v4 (constitution XXIII).

## D17 — Result shape: rule conclusion plus AI explanation (FR-003, FR-006, FR-007, FR-010)

**Decision**: `FailureAnalysis` becomes:
- `conclusion`:
  - `{kind: "likely-cause", cause, strength: "high" | "moderate", ruleId, decidingEvidenceIds}`, or
  - `{kind: "insufficient-evidence", reason: "no-rule-matched"}`.
- `explanation`:
  - `{status: "available", summary, investigationSteps, citedEvidenceIds, provenance: {source: "AI", aiModel, aiProvider, responseVersion, generatedAt}}`, or
  - `{status: "unavailable", reason: {kind: "ai-error", aiErrorCategory} | {kind: "not-viable", projectedMs, budgetMs}, message}`.
- `classificationProvenance`: `{source: "RULE", ruleSetVersion}`.
- `analysisVersion: 2`, the marker for D19.
- Unchanged fields: `evidence`, `specificationContext`, `requestName`, `requestMethod`, `runId`,
  `resultIndex`, and `analyzedAt`, taken from the injected clock and replacing
  `provenance.generatedAt`.

The UI shows the rule's `decidingEvidenceIds` as the evidence for the cause. For insufficient
evidence, it shows the AI's cited evidence, when there is an explanation. Everything else goes in
"Other evidence considered". This supersedes FR-003's "evidence the AI cited is shown by default"
for the likely-cause case, and spec FR-003 is reworded to match.

The in-progress record and the phases (D10) are unchanged. The AI call is still the only slow step.

## D18 — Attempts, replacement, and the POST response (FR-006, FR-015, SC-002)

**Decision**: Classification never fails for an eligible result, so every accepted POST produces a
new analysis:
- `{status: "analyzed", analysis}`: it was stored, replacing any earlier one atomically. Its
  `explanation` may be `unavailable` when no stored analysis with an explanation existed, or when
  none existed at all.
- `{status: "kept-previous", analysis: <new, unstored>, previousAnalysis, message}`: the new
  explanation is unavailable, and the stored analysis has an available one, so the stored analysis
  is kept (FR-015). The UI shows the previous analysis, and the reason the new explanation failed.

The `ai-failed` and `not-viable` statuses are removed, because those outcomes now live inside
`explanation.reason`. Eligibility errors (400, 404, 409) are unchanged. This is a breaking change to
this feature's own contract, whose only consumer is the frontend in the same repository, and both
sides change together.

## D19 — Analyses stored by the AI-decided version (FR-003, FR-013)

**Decision**: On startup, `connection.ts` adds a nullable `analysis_version INTEGER` column to
`failure_analyses` (the existing `ensureColumn` helper). It then deletes rows where the column is
`NULL`: these are analyses written by the AI-decided design (response version 2), and it logs the
count (`failure_analyses_legacy_removed`). New rows are written with `analysis_version = 2`.

**Rationale**: A legacy row's cause was decided by the AI, which the clarified FR-003 forbids
showing as the cause. Converting it would fabricate a rule provenance it never had. Deleting it is
explicit, logged and documented, and the user can analyze again. These rows exist only where
AP-031 has been run since 2026-09-23, and the feature is not yet recorded as Implemented.

**Alternatives considered**: keeping legacy rows behind an "earlier version" notice. That keeps a
second rendering path and type for analyses the spec no longer allows (constitution XXVII).

## D20 — Evaluation and the model decision (SC-006; replaces D11's bar)

**Decision**:
- **Rules**: a unit test runs `classifyFailure` over `EVALUATION_CORPUS` and requires every case to
  match its label. It is part of `npm test`, with no model.
- **AI explanation**: `failureAnalysis.real.test.ts` reports:
  - the **usable rate**: the share of answers that pass D16's validation, meaning structured, at
    least one valid citation, and no contradiction;
  - the **contradiction rate**: the share of all answers rejected because they name a cause other
    than the rule-decided one. A contradicting answer therefore counts against both measures,
    which is deliberate;
  - latency.

  It soft-asserts usable at 80% or more and contradiction at 10% or less (SC-006).
- **Real cases**: at least 4 real, redacted cases are still required (T055).
- **Model**: the evaluation is run with the current default (Qwen2.5-0.5B) and with Qwen3-1.7B,
  with thinking disabled (specs/013 addendum). If only Qwen3 passes, switching the default goes
  through AP-004's benchmark process with the user's approval, as D11 required. Its CPU latency is
  a 35 to 52 s median (evaluation.md run 4), and the viability planning rates, calibrated for
  0.5B, would need recalibrating in the same change.

D11's structured, agreement and confidently-wrong bar applied to an AI-decided cause, and it is
retired for this design. The `confidentlyWrongRate` metric is replaced by the contradiction rate.
