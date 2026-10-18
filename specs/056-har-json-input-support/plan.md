# Implementation Plan: HAR and JSON API Input Support

**Branch**: `AP-056` (spec directory `specs/056-har-json-input-support`) | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/056-har-json-input-support/spec.md`

## Summary

Add a format-independent input layer in front of the existing `ApiModel` so that the guided workflow accepts four
inputs: OpenAPI YAML (unchanged), OpenAPI as JSON, HAR captures, and a new versioned ApiPilot JSON API-definition
format. Format is decided from content, never from the extension. Postman collections are recognized and redirected,
not converted. Every format ends as the same `ApiModel`, extended only by optional, additive fields that carry
provenance (`documented | declared | observed | inferred`), observation counts and a confidence indication. Downstream
stages (operation selection, deterministic generation, AI enhancement, scenario review, dependency review, Postman
generation, execution) are reused as they are, with no parallel pipeline.

The approach rests on five decisions (detail and alternatives in [research.md](research.md)):

1. **No HAR-to-OpenAPI conversion.** Converting a capture into an OpenAPI document and reusing `buildApiModel` would
   present observed facts as documented ones and invent response contracts. The HAR adapter builds the `ApiModel`
   directly and tags every fact with its origin (R2, R30).
2. **OpenAPI models stay byte-identical.** All new model fields are optional and absent for OpenAPI input, and the
   detected format travels on the response envelope, not inside `ApiModel`. An OpenAPI YAML document and its JSON twin
   therefore produce deeply equal models (SC-001, SC-002).
3. **Redaction happens at extraction, from an allow-list.** The HAR adapter copies only named fields into its
   observation structures and replaces credential values before anything is retained, logged or modelled. The
   credential predicates are the existing ones in `sensitiveValueDetection.ts`, extended in the input layer only (R18).
4. **Evidence-gated, status-only generation for observed operations.** Observed operations get example-backed
   positive scenarios that assert only an observed status, and negative scenarios only where at least 3 consistent
   observations support the constraint. OpenAPI generation is not touched (R21).
5. **Strict JSON Schema for the definition format.** The definition format is validated by Ajv against a published
   draft-07 schema, plus code-level cross-checks, and reports every violation with a JSON Pointer location (R22).

6. **The Postman exporter learns two things.** It sends form-encoded and multipart text-field bodies (clarified
   2026-10-18, FR-056), and it recognizes the redaction placeholder as a credential so a captured query, header, JSON
   or form credential becomes a secret variable reference. Both are additive: existing OpenAPI artifacts must stay
   byte-identical (R24, R31, [contracts/postman-artifact-amendment.md](contracts/postman-artifact-amendment.md)).

The clarification session of 2026-10-18 settled four earlier questions, and the spec now states them: the same method and
path on two origins keep one operation (R13), related origins are decided by site name (R12), several varying path ids are
inferred as one parameter each (R14), and redirects and 304s are excluded (R11).

## Technical Context

**Language/Version**: TypeScript on Node.js 24 LTS (npm workspaces monorepo)

**Primary Dependencies**: Existing Express, multer (memory storage), js-yaml, `@apidevtools/swagger-parser`, React, Vite, Tailwind v4, Vitest, Supertest, React Testing Library. One new direct backend dependency: `ajv` ^8.17 (already in the lockfile at 8.20 under swagger-parser, MIT; the hoisted root `ajv` is 6.x for ESLint, so npm nests the 8.x copy under `backend/`). No HAR library (FR-032), no URL, schema-inference or public-suffix library.

**Storage**: None. Raw uploaded bytes are never retained; only the redacted `ApiModel`, the import report and workflow state exist, in the existing in-memory, session-scoped workflow store. The multer buffer is zero-filled in a `finally` after analysis (best effort; R26).

**Testing**: Vitest unit tests per input-layer module; Supertest integration tests for both upload routes; a seeded-secret corpus test over every output surface; determinism tests (analyze twice, compare serialized output); YAML/JSON equivalence tests over the existing OpenAPI fixtures; React Testing Library tests for the new UI. AI-dependent tests use the mock provider. Existing tests stay unmodified (SC-002).

**Target Platform**: Local backend process and browser frontend, as today.

**Project Type**: Web application (Express backend, React frontend, shared-domain package). This feature touches all three.

**Performance Goals**: A capture of up to 500 entries reaches a reviewable operation list in under 30 s (SC-007). The pipeline is linear in entries and extracted values. It yields to the event loop every 100 entries so other sessions keep being served (SC-009).

**Constraints**: Existing 10 MiB upload limit unchanged. New configurable limits: 5,000 HAR entries, 1 MiB per analyzed body, 128 levels of document nesting (R9). Never execute, replay or fetch anything named in a file. No raw HAR persistence. Execution confirmation and environment safety unchanged. AP-032 quick performance test unchanged.

**Scale/Scope**: About 25 new backend source files under `backend/src/apiInput/`, 2 modified routes or stages, 4 modified exporter files (`postman/requestItem.ts`, `postman/validateCollection.ts`, `performance/plan/stepRequest.ts`, `testDesign/sensitiveValueDetection.ts`), 1 new shared-domain file plus additive edits to 5 (including the `PostmanBody` widening), 2 new rule modules in `backend/src/testDesign/`, about 8 new frontend components and 3 modified ones, 3 new environment variables, docs and example files. Seven user stories, shippable in the slices listed under *Delivery slices*.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: unchanged, with the governance prerequisite below still open.*

| Principle | Assessment |
| --- | --- |
| I. Specification Is the Source of Truth | Pass (constitution 3.2.0). For OpenAPI and definition input the document is the source of truth. For HAR, nothing observed is promoted to documented (FR-016); observed facts are labelled and counted, as amended Principle I now requires. |
| II. Deterministic Before AI | Pass. Format detection, HAR analysis, redaction, inference, definition validation and observed-scenario generation are all deterministic and AI-free. AI stays an optional later stage. |
| III. AI Is an Assistant | Pass. AI suggestions on any format are validated against the model and its evidence and stay labelled AI. |
| IV. AI Output Validated | Pass. The existing candidate validator rejects operations, fields and statuses absent from the model; observed statuses are the only statuses the model lists for a HAR operation. |
| V. Local-First AI | Pass. No new network use. Captures contain credentials and PII, so redaction precedes the AI prompt (R23). |
| VI. AI Provider Independence | Pass. No provider code is touched. |
| VIII. Framework-Independent Test Model | Pass. The `TestModel` gains only provenance-style fields; Postman stays an output (FR-031). |
| IX. Separation of Concerns | Pass. Format parsing lives in `backend/src/apiInput/`; `testDesign/` consumes only the normalized model and dispatches on provenance, never on a parser (FR-030). |
| X. Domain Model First | Pass. New concepts (`FactProvenance`, `ObservedOperationDetails`, `ImportAnalysisReport`, `DependencyHint`) are defined in `packages/shared-domain`. |
| XI. Human-in-the-Loop | Pass. Operation review precedes generation; every observed fact is labelled; skipped operations explain why. |
| XII. Quality Over Quantity | Pass. Observed generation emits one scenario per observed success status plus evidence-gated negatives only. |
| XIII. Test Provenance and Traceability | Pass (constitution 3.2.0). Scenarios keep `source: "RULE"` and gain an `evidence` block naming origin and observation count, as the amended principle requires. |
| XIV. No Silent Assumptions | Pass. Unknown stays unknown (`requiredUnknown`, absent security schemes); unobserved statuses, fields and auth schemes are never modelled. |
| XV. Dependency Inference Conservative | Pass. Value-match evidence is capped at LIKELY (POSSIBLE for a single match); only a declared hint verified against declared schemas, or an existing confirming signal, reaches CONFIRMED (R19, R20). |
| XVI. Executable Artifacts Deterministic | Pass. Generation from the approved `TestModel` stays deterministic and AI-free. The exporter gains form-body emission and placeholder substitution as pure functions of the scenario; a byte-equality snapshot proves artifacts for existing inputs do not change. |
| XVII. Security and Privacy by Design | Pass. No execution of file content, no fetch of file-named URLs or `$ref`s, validated and bounded input, no raw retention, per-session scope. The Postman exception clauses are not cited or extended. |
| XVIII. Secrets Never in Artifacts | Pass, with a required exporter change. Credential values never enter the model. Reading the exporter showed it substitutes by name or `Bearer` shape and does not substitute a credential-named query parameter, so a placeholder would have been sent literally. The plan makes the exporter recognize the placeholder in every location and makes `validateCollection` refuse any artifact containing placeholder text (R24). |
| XIX. Fail Safely | Pass. Malformed entries, unsupported bodies and ambiguous paths are reported, never repaired; all-excluded captures create no workflow. |
| XX. Observability Without Sensitive Logging | Pass. Logs carry counts, durations, stage names and error categories only. A test captures log output over the seeded-secret corpus. |
| XXI. Testability at Every Boundary | Pass. Each stage of the input layer is a pure, separately tested function. |
| XXIV. Reproducibility | Pass. HAR analysis is a pure function of the file and the limits (FR-022, SC-003). |
| XXV. Incremental Delivery | Pass, with a note. 55 requirements are large; the plan ships in five ordered slices (below). |
| XXVII. Prefer Simple Architecture | Pass. One dependency (already in the lockfile), no worker threads, no streaming parser, no persistence. See Complexity Tracking. |
| XXVIII. Technology Replaceable, Domain Stable | Pass. Ajv sits behind the definition validator; the domain model is extended, not replaced. |
| XXXII. Review Practical at Scale | Pass. The existing operation selection (Select all, pagination) is reused; HAR exclusions are grouped by reason, not listed per entry. |
| XXXIII. Presentation Consistent | Pass. New UI reuses the pattern set, tokens, light and dark themes, and text-based origin labels. |

### Governance prerequisite (applied, pending review)

Captured traffic is a category the constitution did not name. The amendment to 3.2.0 (MINOR) was applied on 2026-10-18
through `/speckit-constitution`: the preamble now lists observations and inferences from observations as categories 6 and
7, and Principles I, XIII, XIV and XV carry the matching rules (draft rationale: [research.md](research.md) R1). Two
follow-ups remain before implementation starts: the amendment goes through review as the Governance section requires, and
the manual copy `specs/constitution.md`, still at 3.1.0, is resynced. Both are task T001.

Project rules (`.claude/CLAUDE.md`): sections 4 (shared-domain contracts), 6 and 9 (specification-driven, OpenAPI
pipeline independent of Express, no external `$ref` fetch), 10 to 14 (deterministic designer, grounded assertions,
dedup provenance), 15 to 20 (AI only through the provider, local-first), 22 to 24 (thin routes, contracts, safe
errors), 26 to 43 (Tailwind v4, tokens, accessibility, states), 44 to 47 (types, immutability, upload safety), 48
(environment variables get `.env.example` entries) and 54 (validation) are satisfied. Section 6's instruction to
identify spec conflicts was applied to the multi-origin case, which the clarification session of 2026-10-18 resolved.

## Project Structure

### Documentation (this feature)

```text
specs/056-har-json-input-support/
├── plan.md                              # This file
├── research.md                          # Phase 0: 30 decisions with alternatives
├── data-model.md                        # Phase 1: shared-domain additions, entities, invariants
├── quickstart.md                        # Phase 1: validation scenarios per story
├── contracts/
│   ├── upload-api-amendment.md          # public: both upload routes, errors, envelope
│   ├── har-import-rules.md              # behavioural: validation, normalization, exclusion, inference, redaction, limits
│   ├── observed-generation-rules.md     # behavioural: observed scenarios, evidence gating, dependency evidence
│   ├── postman-artifact-amendment.md    # public: form-style bodies, placeholder substitution, validation, consumers
│   ├── api-definition-format-v1.md      # public: the ApiPilot API-definition format, human reference
│   └── api-definition.v1.schema.json    # public: machine-readable draft-07 schema for the same format
├── checklists/
│   └── requirements.md                  # spec quality checklist (exists)
└── tasks.md                             # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
├── apiInput.ts                    # NEW: InputFormat, FactOrigin, FactProvenance, FactConfidence, ObservedOperationDetails,
│                                  #      SchemaEvidence, ImportAnalysisReport, DependencyHint, ApiInputDescriptor,
│                                  #      OBSERVED_EVIDENCE_MIN_OBSERVATIONS
├── apiModel.ts                    # MODIFY (additive, optional): ApiOperation.provenance/observed/description,
│                                  #      Parameter.provenance/requiredUnknown, RequestBody.provenance/examples/requiredUnknown,
│                                  #      Response.provenance/bodyUnavailable, ApiModel.importReport/dependencyHints/declaredBaseUrl,
│                                  #      AnalysisIssue.kind gains five members
├── testModel.ts                   # MODIFY (additive): TestScenario.evidence, Assertion.basis
├── postmanArtifact.ts             # MODIFY (the one type widening): PostmanBody becomes raw | urlencoded | formdata
├── apiDependency.ts               # MODIFY (additive): DependencySource gains "observed" | "declared"; relationship.inputEvidence
├── testGenerationWorkflow.ts      # MODIFY (additive): TestGenerationWorkflow.input, generationNotes
└── index.ts                       # MODIFY: export apiInput

backend/src/apiInput/
├── index.ts                       # NEW: loadApiInput(buffer, filename) -> ApiInputResult (the one entry point)
├── detectFormat.ts                # NEW: pure content-based detection and routing decision
├── errors.ts                      # NEW: typed errors (invalid_json, unrecognized/ambiguous format, postman detected, invalid_har,
│                                  #      invalid_definition, no_operations_derived, input_limit_exceeded)
├── limits.ts                      # NEW: InputLimits, defaults, environment loading and validation
├── jsonSafe.ts                    # NEW: depth pre-scan, prototype-safe maps, event-loop yield
├── redaction.ts                   # NEW: credential redaction built on testDesign/sensitiveValueDetection predicates
├── openapi/loadOpenApi.ts         # NEW: wraps the unchanged parseYaml / validateSpec / buildApiModel; JSON parsed document path
├── har/
│   ├── validateHar.ts             # NEW: structural validation (FR-009)
│   ├── extractEntry.ts            # NEW: allow-list extraction, redaction at source, malformed detection
│   ├── normalizeUrl.ts            # NEW: origin and path normalization
│   ├── classifyEntry.ts           # NEW: ordered exclusion rules; analyticsHosts.ts holds the frozen host list
│   ├── originScope.ts             # NEW: first-party origin determination
│   ├── inferPathParameters.ts     # NEW: skeleton-based path parameter inference
│   ├── decodeBody.ts              # NEW: body availability, encodings, unavailability reasons
│   ├── inferSchema.ts             # NEW: structural schema and SchemaEvidence from observed JSON
│   ├── mergeObservations.ts       # NEW: grouping, example retention, counts, confidence
│   ├── detectDependencies.ts      # NEW: value-reuse evidence with distinctiveness rules
│   └── buildHarModel.ts           # NEW: ApiModel + ImportAnalysisReport, issue caps, collision handling
└── definition/
    ├── validateDefinition.ts      # NEW: Ajv validation + cross-field checks, location-bearing problems
    ├── definitionSchema.ts        # NEW: loads contracts/api-definition.v1.schema.json content (embedded constant, see R22)
    └── buildDefinitionModel.ts    # NEW: definition -> ApiModel with declared provenance

backend/src/
├── api/specifications.ts          # MODIFY: call loadApiInput; additive `input` in the response
├── api/testGenerationWorkflow.ts  # MODIFY: pass the filename through; zero-fill buffer in finally; map new errors
├── testGenerationWorkflow/startWorkflow.ts        # MODIFY: use loadApiInput; record workflow.input
├── testGenerationWorkflow/workflowStore.ts        # MODIFY: startWorkflow accepts input descriptor
├── testGenerationWorkflow/deterministicGenerationStage.ts  # MODIFY: store generationNotes
├── testDesign/generateTestModel.ts                # MODIFY: dispatch rule set by operation provenance; OpenAPI path untouched
├── testDesign/rules/observedExampleScenarios.ts   # NEW: example-backed positive + evidence-gated negatives for observed operations
├── testDesign/rules/declaredExampleScenarios.ts   # NEW: example-backed positive for definition operations with examples but no schema
├── apiInput/logging.ts                            # NEW (T037): typed log helper, no free-text fields
├── apiInput/har/loadHar.ts                        # NEW (T059): validate, build, throw when no operation results
├── apiInput/har/confidence.ts                     # NEW (T057): pure confidence function
├── apiInput/definition/loadDefinition.ts          # NEW (T104): validate, build, log
├── postman/requestItem.ts                         # MODIFY: urlencoded and formdata body branches; placeholder-aware substitution (URL, header, body)
├── postman/validateCollection.ts                  # MODIFY: accept the new body modes; refuse any remaining placeholder text
├── performance/plan/stepRequest.ts                # MODIFY: read the widened PostmanBody (urlencoded to form kind; formdata reported not converted)
├── testDesign/sensitiveValueDetection.ts          # MODIFY: add redactionPlaceholderKind (additive; existing predicates unchanged)
├── dependencies/analyzeDependencies.ts            # MODIFY: merge ApiModel.dependencyHints (capped confidence)
├── dependencies/mergeRelationships.ts             # MODIFY: observed/declared sources
├── testDesign/aiScenarioPrompt.ts                 # MODIFY: one provenance note for non-OpenAPI models (OpenAPI prompt unchanged)
├── app.ts                                         # MODIFY: map the new typed errors
├── config.ts                                      # MODIFY: validateInputConfiguration
└── uploadMiddleware.ts                            # UNCHANGED (limit not raised)

frontend/src/
├── pages/TestGenerationWorkflowPage.tsx           # MODIFY: accept .yaml .yml .json .har; wording; analyzing status; Postman redirect action
├── components/InputFormatBadge.tsx                # NEW
├── components/HarImportSummary.tsx                # NEW: counts, reconciliation, exclusions by reason, malformed, warnings
├── components/FactOriginBadge.tsx                 # NEW: documented | declared | observed | inferred, text plus observation count
├── components/ApiReviewStage.tsx                  # MODIFY: show format and HarImportSummary when present
├── components/OperationDetail.tsx                 # MODIFY: origin labels on parameters, statuses, schemas, path decisions
├── components/AnalysisSummary.tsx                 # MODIFY: none beyond rendering the new issue kinds (generic already)
├── components/ScenarioReviewStage.tsx / TestScenarioDetail.tsx   # MODIFY: show scenario evidence and assertion basis
├── services/testGenerationWorkflowClient.ts       # MODIFY: surface `problems` and Postman-redirect error
└── components/DeterministicGeneration notes view  # MODIFY: show generationNotes (operations with no scenarios)

backend/tests/
├── unit/apiInput/**               # NEW: detectFormat, limits, redaction, normalizeUrl, classifyEntry, originScope, inferPathParameters,
│                                  #      decodeBody, inferSchema, mergeObservations, detectDependencies, buildHarModel, validateDefinition, buildDefinitionModel
├── unit/testDesign/observedExampleScenarios.test.ts
├── unit/postman/formBodies.test.ts                # NEW: urlencoded and formdata items, header handling, substitution per location, placeholder predicate, validator checks
├── unit/postman/existingArtifactsUnchanged.test.ts  # NEW (T002a): byte-equality snapshot over every existing OpenAPI fixture
├── fixtures/postman/golden/                       # NEW (T002a): goldens captured from the unmodified exporter, never regenerated
├── integration/execution/formBodiesNewman.test.ts   # NEW: Newman posts both body modes to a local test server; fields arrive
├── integration/apiInput.upload.test.ts            # NEW: both routes, every format, every error class
├── integration/apiInput.secrets.test.ts           # NEW: seeded-secret corpus over responses, logs, AI prompt, Postman artifact
├── integration/apiInput.limits.test.ts            # NEW: limits and concurrent-session behaviour
└── fixtures/apiInput/{har,definitions,json}/      # NEW: synthetic, credential-free corpora

frontend/tests/ (colocated pattern as existing)    # NEW: upload accept and error states, HarImportSummary, FactOriginBadge, OperationDetail labels

docs and housekeeping
├── README.md                                      # MODIFY: supported inputs, HAR, definition, security
├── docs/architecture.md                           # MODIFY: input layer, provenance, redaction placement
├── docs/USER_MANUAL.md                            # MODIFY: capturing a HAR, uploading, reading origin labels
├── docs/http-api.md                               # MODIFY: upload envelope and error codes
├── docs/configuration.md + .env.example           # MODIFY: three new variables
├── docs/api-definition-format.md                  # NEW: human reference with example
├── docs/examples/sample-capture.har               # NEW: synthetic capture
├── docs/examples/sample-api-definition.json       # NEW: valid definition
├── docs/examples/sample-openapi.json              # NEW: JSON twin of an existing example spec
├── specs/002-openapi-specification-engine/contracts/specifications-api.md   # MODIFY: amendment pointer
├── specs/009-e2e-test-generation-workflow/contracts/test-generation-workflow-api.md  # MODIFY: amendment pointer
├── specs/007-postman-collection-generator/contracts/postman-collection-api.md        # MODIFY: amendment pointer
├── .specify/memory/constitution.md                                          # DONE 2026-10-18 (3.2.0); review pending
├── specs/constitution.md                                                    # MODIFY: resync to 3.2.0 (T001)
├── specs/ROADMAP.md                               # MODIFY: AP-056 entry and version
└── package.json x4 + lockfile                     # MODIFY via `npm run version:bump -- feature` (19.58.0 to 19.59.0) and `npm install ajv -w backend`
```

**Structure Decision**: One new backend module, `backend/src/apiInput/`, owns everything format-specific, so
`openapi/` keeps its single job and the test designer never imports a parser (FR-030). The shared-domain additions
live in one new file plus optional fields on existing interfaces, which keeps OpenAPI models unchanged and the
contract change reviewable. The frontend reuses the existing apiReview stage rather than adding a stage (FR-044), and
the upload control and error surface already in `TestGenerationWorkflowPage.tsx`.

## Delivery slices

The spec marks Story 5 as a release gate for Story 2. Slices are ordered so that no HAR path is reachable before
redaction and limits exist: `loadApiInput` rejects HAR as unsupported until slice B lands, and the seeded-secret corpus
test (SC-004) must pass before that rejection is removed. There is no feature flag.

| Slice | Stories | Delivers | Gate |
| --- | --- | --- | --- |
| P0 | governance | Constitution 3.2.0 amendment (applied 2026-10-18); resync `specs/constitution.md` | Reviewed and merged |
| A | 1 | Shared types, limits, errors, detection, `loadApiInput`, OpenAPI JSON, route wiring, upload UI and format badge, Postman redirect | SC-001, SC-002, SC-008 for these formats |
| B | 5, 2, 3 | Redaction, limits enforcement, HAR pipeline, report, review UI labels | SC-003, SC-004, SC-005, SC-009 |
| C | 4 | Exporter extension first (widened `PostmanBody`, form bodies, placeholder substitution, validator checks) with its byte-equality guard, then observed and declared scenario rules, evidence, dependency hints, AI checks | SC-002 unchanged artifacts, SC-004 and SC-006 over generated artifacts |
| D | 6 | Definition format validation and mapping | SC-008 for definitions |
| E | 7 | Docs, example files, roadmap, version bump | SC-010 walk-through |

## Complexity Tracking

No constitution violation requires justification. Design costs recorded for review:

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| New direct dependency `ajv` | The definition format needs strict validation with every violation reported at a JSON Pointer; Constitution XXVIII prefers standard implementations over custom schema code. | A hand-written validator re-implements `additionalProperties`, `enum`, `pattern` and array limits, and would drift from the published schema. Ajv 8.20 is already installed transitively, so no new package enters the tree. |
| `ObservedOperationDetails` and `SchemaEvidence` on the model | FR-014 and FR-028 require per-fact counts, and the test designer needs per-field presence and type counts to apply the 3-observation threshold. | `SchemaConstraint` cannot carry counts, and putting them in the report would force the designer to depend on the import report. |
| Cooperative yielding (`setImmediate` every 100 entries) | SC-009 requires other sessions to keep being served while a large capture is analyzed on the single Node thread. | A worker thread adds a message boundary, structured-clone cost and a new failure mode for a linear job that finishes in seconds. |
| Widening `PostmanBody` to a union | FR-056 needs the exporter to emit `urlencoded` and `formdata` bodies, and the current type has one `raw` shape. | Emitting form bodies as raw text with a form `Content-Type` needs a hand-written multipart boundary and hides structure from users and Newman. The compile-time widening is intended: it makes the compiler list every reader of `body.raw`. |
| A second example-scenario rule module (`declaredExampleScenarios`) | A definition may declare request examples without a schema; the existing positive rule needs a schema to produce a body. | Folding it into `observedExampleScenarios` would blur which rule set applies to which provenance, which the scenario's `evidence` block must state exactly. |

## Open items for review

Resolved by the clarification session of 2026-10-18 and now stated in the spec: multi-origin collisions (R13), first-party
detection (R12), multi-parameter paths (R14), form-style bodies (R17, R31) and redirects and 304s (R11).

1. **The exporter change is the largest risk to existing behaviour.** FR-056 and FR-048 together require the Postman
   exporter to emit form bodies and to recognize the redaction placeholder in query, header, body and path values. The
   guard is a byte-equality snapshot of every existing OpenAPI fixture's collection, environment and README, plus the
   `PostmanBody` compile-time widening, which makes the compiler list every reader. If the snapshot cannot stay equal for
   a reason the plan did not foresee, stop and review before changing expected output.
2. **Multipart file parts are not reproducible (an addition to the clarified spec).** A part with file content cannot be
   replayed from a HAR, so such a request is recorded as `multipart-file` and an operation whose observed requests all
   have one gets no scenario, with the reason. The spec's edge case states this; say so if you want a different handling.
3. **Observed examples are filtered to the operation's primary content type.** The exporter picks one body content type per
   operation (JSON preferred, else the first declared), so an operation observed with both JSON and form bodies gets
   scenarios only for the primary one, and a note if none matches (R21).
4. **k6 seeding cannot represent multipart.** Seeding a request-chain plan from an approved HAR-derived workflow refuses a
   multipart step with an explicit reason: `templateFromItem` throws `UnsupportedStepBodyError` and `buildStepRequest` converts it
   to the existing `InvalidChainPlanError`; urlencoded steps convert as the existing `form` kind (R31).
5. **Declared dependency hints verified against declared schemas become CONFIRMED.** The spec says hints are "subject
   to the same validation" and that confirmed needs a declared hint; the plan reads that as: both fields exist in the
   declared schemas, then CONFIRMED, otherwise LIKELY with an explanation (R20).
6. **Empty and BOM-only uploads keep the existing `invalid_yaml` outcome (decided 2026-10-18).** This preserves SC-002 and
   the existing message ("document is empty or not an object"). The spec's edge case was reworded to "the existing
   empty-document message" so the two agree (R3).
7. **The AI prompt version stays 5 (decided 2026-10-18).** `AI_SCENARIO_RESPONSE_VERSION` is not bumped, because the OpenAPI
   prompt is byte-identical and a bump would break existing version assertions (SC-002). The provenance sentence for
   non-OpenAPI models is recorded as a dated note in the version-history comment of `aiScenarioPrompt.ts` (R23).
8. **Scenario identifiers remain random.** `buildScenario` uses `randomUUID()` today. FR-022 and SC-003 cover the HAR
   analysis output (model, issues, exclusions, ordering), which is deterministic here; making scenario ids
   deterministic is an existing-behaviour change left out of scope.
