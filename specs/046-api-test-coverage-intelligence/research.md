# Research: API Test Coverage Intelligence (AP-046)

Findings come from reading the repository on 2026-10-10 (commit 6dc667e, version 19.39.0). Paths are repository-relative. Nothing here was executed; behaviour claims are from source reading.

## R1. Where Coverage lives

**Decision**: Add a `coverage` view to `WORKFLOWS` in `frontend/src/components/workflowCatalog.ts`, in the existing `results` section (`sectionCatalog.ts`, colour `--solid-results`). Touch the `EntryChoice` union, `WORKFLOWS`, `WORKFLOW_SECTIONS`, the `mount` map and rendering in `App.tsx`, `EntryChooser`, `HelpDialog`, and the affected tests (`workflowCatalog.test`, `sectionCatalog.test`, `App.test`, `EntryChooser.test`, `paletteCommands.test`). The command palette picks it up from `WORKFLOWS`.

**Rationale**: There is no router, sidebar or Results group. Navigation is `useState` in `App.tsx`; the `results` section id exists but nothing maps to it. A catalog entry is the repository's only navigation mechanism for a new view.

**Alternatives**: A fifth step in the Import & Run stepper (rejected: hides coverage before any run, ties it to one collection). URL routing (rejected: no router exists; adding one is unrelated refactoring).

**Consequence for spec**: FR-018 "under Results" is satisfied as "in the results section". Browser back/refresh (FR-024, US6) can only be as consistent as the rest of the app, which keeps no URL state. Filter state will be kept in component state and survive tab switches because views stay mounted; it will not survive a full page refresh. This is a documented limitation.

## R2. Calculator placement

**Decision**: Pure functions under `backend/src/coverage/`, types in `packages/shared-domain/src/coverage.ts`, exposed by a thin router. The frontend fetches a computed snapshot.

**Rationale**: The inputs (`ApiModel`, review workspace, run results with `itemId`) and helpers (`itemIdForScenario` in `backend/src/postman/identifiers.ts`) are backend-side. Computing there avoids shipping raw run results and sensitive `rawCapture` to the browser and keeps one implementation for screen and export.

**Alternatives**: Calculate in the browser (rejected: would need run results and model client-side, duplicates logic, risks exposing capture data).

## R3. Execution evidence

**Findings**: The UI never calls guided-workflow `/execution/*` routes. After Postman generation, `handleHandoffToExecution` pre-fills Import & Run, producing `UploadedCollectionExecutionRun` records (`externalCollections.ts:98-115`) with `UploadedRequestResult` (`:63-92`): `itemId`, `outcome`, `failureCategory`, `responseStatusCode`, `testOutcomes[{name,outcome,detail}]`, `wasEdited`, `rawCapture`. There is no `scenarioId`, no operation and no assertion type. `itemId = itemIdForScenario(scenarioId)`, a deterministic sha256-derived UUID. Assertion kind is only encoded in test names (`statusTestName(code)`, `SCHEMA_CONFORMANCE_TEST_NAME` in `assertionScripts.ts`). The guided `ExecutionRun`/`RequestResult` (`execution.ts`) is richer (`scenarioId`, `assertionOutcomes[{assertionIndex,type,outcome}]`) and still backed by repositories.

**Decision**: Support both sources behind one `EvidenceSource` interface in `evidence.ts`:
- Guided runs: join by `scenarioId`, evidence per assertion index and type.
- Uploaded runs: for each current scenario compute `itemIdForScenario(id)`, join by `itemId`, derive assertion kind by matching test names using the exported name helpers (not string literals copied into coverage code).

A result is **attributable** only through one of these joins. Edited items (`wasEdited`) are treated as **Inconclusive** for the scenario they carry, because the request that ran may differ from the scenario's request. Unjoinable results are counted as `unattributedResults` and surfaced in the notice, never counted as evidence.

**Rationale**: Honest evidence requires an actual link; inventing one by path/method would violate FR-005 and the spec's "do not infer".

**Alternatives**: Match by method+path (rejected: cannot tell which scenario, so cannot count verification correctly). Persist a mapping at generation time (rejected: new persistence for a derivable join).

## R4. Specification revision, staleness, and run selection

**Findings**: No spec fingerprint or revision exists. `ApiModel.info.version` is the document's own string. The workflow is a per-session in-memory object (`workflowStore.ts`), one per session, lost on restart or 60 minutes idle; runs persist in SQLite. Scenario IDs are `randomUUID()` per generation. `ReviewScenario` has `revision` and `history[]` (decision/edit/regeneration entries).

**Decision**:
- **Revision** = SHA-256 of a canonical (sorted-key) serialization of the normalized `ApiModel` operations, parameters, request bodies, responses and security schemes. `info.title` and `info.version` are returned as display fields but excluded from the hash, so a version-string bump alone does not invalidate evidence while a contract change does. Computed per request, not stored.
- **Requirement element IDs** are derived from stable content: `op:<METHOD> <path>`, `param:<METHOD> <path>:<in>:<name>`, `reqprop:<METHOD> <path>:<media>:<dotted.path>`, `resp:<METHOD> <path>:<statusKey>`, and so on. IDs do not include the revision; each requirement carries a separate `contractHash` of its own fragment, so unchanged elements keep their identity across revisions.
- **Stale evidence** rules, evaluated per scenario: (a) the result's `itemId` joins to no scenario in the current workflow (regeneration or re-upload replaced it) → unattributed/stale at run level; (b) the joined scenario was edited or regenerated after `result.startedAt` (from `ReviewScenario.history` timestamps) → Stale for that scenario's requirements; (c) comparing a requirement's `contractHash` with the hash in force when the run executed would need that hash stored on the run record, so (c) is **not** implemented; this is a documented limit.
- **Run selection**: default is the latest run per scenario by `startedAt` that contains an attributable, non-`not-attempted` result; the caller may pass `runId` to evaluate one run. The chosen run(s) are returned in the snapshot. Earlier runs remain in the existing run history; coverage does not duplicate history.
- **No workflow present**: return a typed "no active specification" result (HTTP 409 `no_active_workflow`, matching existing `stage_not_active`-style codes), which the UI renders as an empty state with a recovery action. Runs without a live workflow cannot be evaluated, because there is no model to evaluate them against.

**To verify first in implementation**: that `ReviewScenario.history` entries carry timestamps. If not, rule (b) falls back to `wasEdited` plus `workspaceRevision` comparison, and the plan's staleness story for user edits narrows to "edited items are Inconclusive".

**Alternatives**: Hash the raw spec text (rejected: not retained; hashing the normalized model is what was analysed). Persist the revision on run records (rejected: schema change to AP-017/AP-026 tables for a derivable value; revisit if rule (c) becomes required).

## R5. Path-level parameters

**Finding**: `buildApiModel.ts:~330` reads only `operation.parameters`; `pathItem.parameters` is never read, so path-level parameters are absent from `ApiModel`.

**Decision**: Fix at the source: merge path-level into operation-level, with operation-level overriding on `(name, in)`. Add unit tests (spec test 8) and a regression test that specifications without path-level parameters produce identical models.

**Consequence**: Specifications that use path-level parameters will now get scenarios for them. This changes AP-003 output for such specs; record in the AP-002 roadmap entry and in the user manual's Limitations section if it listed this gap.

## R6. Schema elements and branches

**Finding**: `SchemaConstraint` keeps type, required, properties, items, enum, format, min/max, pattern, lengths, item counts. It drops `nullable`, `oneOf`, `anyOf`, `discriminator`, `additionalProperties`, `readOnly`/`writeOnly`. `allOf` is merged (first-wins). Depth is capped at 50 and cycles collapse to an empty constraint. `AnalysisIssue` records unsupported constructs with a `#/paths/...` location.

**Decision**: Request/response schema elements measured: property presence, required flag, numeric min/max, string min/max length, pattern/format, enum values, array item schema, array min/max items. **Not measurable, reported with reason**: `oneOf`/`anyOf` branches and discriminators (dropped by the model; listed from `AnalysisIssue`), `nullable` (not retained), conditional constraints, circular/unresolved refs, `additionalProperties`. `allOf` is treated as merged and flagged `composed-schema` informational. These become `NotMeasurable` entries with an `AnalysisIssue` reference and are excluded from denominators.

**Alternatives**: Extend the model to keep `oneOf`/`anyOf` (rejected for this feature: large cross-layer change to AP-002/AP-003, and generators would not exercise branches, so coverage would be permanently zero).

## R7. Mapping scenarios to requirements

**Findings**: Scenario provenance carries `rule` ids and `targetLocation`/`targetField` (dotted paths for body). Mapping table:

| Rule | Requirement contributed |
|---|---|
| `positive-scenario`, `minimal-positive-scenario` | operation; properties present in the body (property exercised); status-code and schema-conformance assertion targets |
| `enum-positive-variant` | the specific enum value used (read from the request at target) |
| `required-field-missing` / `-null` / `-empty` | required flag of the target (parameter or body property) |
| `invalid-type`, `invalid-format`, `invalid-enum` | type/format/enum negative case of the target |
| `numeric-boundary-*`, `string-boundary-*`, `array-boundary-*` | the matching min/max element; at-boundary variants count as boundary coverage |

Response-code coverage: documented key `K` is covered when a scenario of that operation has a `status-code` assertion whose `expectedStatusCode` equals `K` exactly (ranges `2XX` and `default` match only themselves; a `200` assertion does not cover a documented `2XX`). Response-schema element is covered when the same scenario also has a `schema-conformance` assertion alongside a `status-code` assertion for `K`.

Only one status is asserted per scenario (lowest 2xx for positive, lowest 4xx for negative), so documented 404/401/403/5xx/`default` and non-lowest 2xx will be uncovered by design; this is a true finding and is explained in the UI rather than fabricated away (constitution I, spec FR-015).

Cookie parameters are never targeted by any rule; they are counted as documented, uncovered.

AI scenarios are mapped by the same fields; their `provenance.source` is carried through.

**Deduplication**: coverage is a set; a requirement is covered if any qualifying scenario maps to it, and mappings record all contributing scenario IDs.

**Only reviewed, selected scenarios count**: eligible operations are those in `selectedOperationKeys` (absent = all). Rejected review scenarios do not contribute; pending ones count as generated. The accepted/pending/rejected split is shown. (Resolved in `/speckit-clarify` 2026-10-10: pending and accepted scenarios count, rejected never; the accepted/pending split is shown beside each specification-coverage figure.)

## R8. Scenario categories and security

**Findings**: 10 existing categories; none for authorization. `ApiOperation.security` and `securitySchemes` exist.

**Decision**: Group existing categories as Positive (`positive`), Negative (missing-field, null-value, empty-value, invalid-type, invalid-format, invalid-enum), Boundary (numeric/string/array-boundary invalid variants). Denominator per category = operations for which the category is **applicable** (e.g. Boundary applicable only if the operation has a constrained parameter or property). Security/authorization is reported `unavailable` with the reason "no scenario category identifies authorization intent"; operations that declare security requirements are still flagged as security-sensitive for prioritization (declared, not verified). No new category is added in this feature.

## R9. Prioritization

**Decision** (heuristic, documented in code and `data-model.md`, labelled "heuristic" in UI): score is a sum of weighted factors per operation gap group: missing runtime verification, missing specification coverage, executed failure, destructive method (`DELETE`; `PUT`/`PATCH`/`POST` lower), declared security requirement, contract complexity (count of constrained properties, bounded). Failure history is unavailable (runs retain no cross-run history keyed to a contract) and is omitted rather than guessed. Priority bands High/Medium/Low from fixed thresholds. Gaps are grouped by `(operation, requirement kind)` before scoring so one underlying gap appears once (FR-030). Ties break by operation key, so ordering is stable.

## R10. Export

**Findings**: Existing export is run-specific (HTML/PDF under `externalCollections/runReport*`), Postman JSON, and performance HTML reports. No coverage-compatible exporter exists. `escapeHtml` and report styling are reusable.

**Decision**: Export the current view as a self-contained HTML document via a new renderer that reuses `escapeHtml` and report styling conventions from `runReportHtml.ts`, plus the raw snapshot as JSON from the same route (`format=json`). No new dependency, no PDF. Export takes the same filter parameters as the snapshot route; both call `filterSnapshot` (one implementation, so screen and export cannot diverge). Records contain identifiers, counts, outcomes, run IDs and `itemId`s only.

## R11. Frontend data flow and stale responses

**Decision**: `coverageClient.ts` follows the `{ok}` result-union convention with `createLogger`. `useCoverage` keeps a request counter and ignores responses whose sequence is not the latest (FR-035), and exposes `loading | success | empty | error | no-workflow` explicitly (FR-039). Charts are SVG with a visible textual counts table, following `LiveRunChart.tsx`. Colours come from semantic tokens and `chart-N`; no hex, no arbitrary Tailwind values.

## R12. Out of scope, recorded

- AI-generated explanations or proposed scenarios (optional in the request; deferred; would route through `AIProvider` under a separate spec).
- Persisting coverage history, URL-addressable state, a security/authorization scenario category, extending `ApiModel` for `oneOf`/`anyOf`/`nullable`, an aggregate "overall" score.
