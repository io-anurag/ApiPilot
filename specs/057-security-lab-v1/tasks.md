---

description: "Task list for ApiPilot Security Lab — V1 (AP-057)"
---

# Tasks: ApiPilot Security Lab — V1

**Input**: Design documents from `/specs/057-security-lab-v1/`

**Prerequisites**: [plan.md](plan.md) (revision 2), [spec.md](spec.md) (with the 2026-10-18 clarifications), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included. The success criteria (SC-001 to SC-017) are verified by automated tests, the plan names the test files, and project rules (CLAUDE.md §51 to §55) treat tests as part of the feature. Within each story, write the tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story. The spec orders the stories P1, P1, P1, P2, P2, P2, P3, P3 (US1, US2, US3, US4, US5, US6, US7, US8), but US3 (run) needs US6 (profiles and the destination policy), so US6 is built before US3. The pure evaluation modules of US4 are independent of the run service, which takes the evaluator as an injected dependency: US3 is tested with a stub evaluator, and US4 wires in the real one (T120).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story the task serves (US1 to US8)
- All paths are relative to the repository root `D:\api\ApiPilot`
- The user's standing rules apply: finish with documentation and a version bump (Polish phase), and **do not commit**; leave all changes uncommitted for review

## Path Conventions

- Backend module: `backend/src/securityLab/`; router `backend/src/api/securityLab.ts`; tests `backend/tests/unit/securityLab/` and `backend/tests/integration/securityLab/`; fixtures `backend/tests/fixtures/securityLab/`
- Frontend: `frontend/src/pages/SecurityLabPage.tsx`, `frontend/src/components/securityLab/`; tests `frontend/tests/unit/securityLab/`
- Shared contracts: `packages/shared-domain/src/securityLab.ts`
- Contracts to satisfy: [security-lab-api.md](contracts/security-lab-api.md), [security-scenario-contract.md](contracts/security-scenario-contract.md), [generation-and-analysis-rules.md](contracts/generation-and-analysis-rules.md), [review-and-approval-rules.md](contracts/review-and-approval-rules.md), [execution-safety-rules.md](contracts/execution-safety-rules.md), [evaluation-and-findings-rules.md](contracts/evaluation-and-findings-rules.md), [postman-security-amendment.md](contracts/postman-security-amendment.md)

---

## Phase 1: Setup

**Purpose**: Governance, baseline, spikes and fixture scaffolding

- [X] T001 Governance (human review step): have constitution 3.3.0 in `.specify/memory/constitution.md` reviewed (it is drafted and uncommitted), then resync the manually maintained mirror `specs/constitution.md`, currently at 3.2.0, to the same text and version. If review rejects 3.3.0, revert it; no task below changes, because every 3.3.0 condition already has a contract rule and a test (plan, "Governance") **Done:** mirror resynced to 3.3.0 on 2026-10-18; the user committed 3.3.0 (cce4e89); the merge review stays with the user
- [X] T002 Record the baseline before any code change: run `npm test`, `npm run lint` and `npm run build` from the repository root and note the pass/fail counts in working notes, so "existing tests unmodified and passing" (FR-067, SC-014) is checkable at the end **Done:** baseline: 4,965 tests passed, 11 skipped, 1 failed before any change (packages/shared-domain tests/unit/requestChain.test.ts, parseReferences accepts every supported dynamic variable: expected 48, got 50, from the user's uncommitted AP-056 follow-up work, unrelated); lint and build pass
- [X] T003 Capture the existing-output baseline now, before any code change: create `backend/tests/unit/securityLab/existingOutputsUnchanged.test.ts` that, for every loadable OpenAPI fixture in `backend/tests/fixtures/openapi/`, serializes and snapshots (a) `generateTestModel` output with random scenario ids normalised, (b) the approved model from `createReviewWorkspace` plus `projectApprovedTestModel`, (c) `generateCollection` output, and (d) `specificationRevision(apiModel)`. It must pass on the untouched repository. It is re-run at T013 and in the Polish phase to prove the additive model fields change none of them **Done:** 13 fixtures captured from the unmodified repository; paypal-invoicing-v2 excluded (minutes to run, 23 MB golden) and is covered by the existing exporter golden test
- [ ] T004 [P] Spike, owner cookie (plan assumptions 5 and 7): with a throwaway Express snippet in the scratchpad directory (not in the repository), confirm on Windows with the supported browsers that an `httpOnly`, `sameSite=lax`, `Max-Age` 400-day cookie survives a server restart and a full browser restart, and is not sent from a private window. Record the result under "Assumptions carried" in `specs/057-security-lab-v1/research.md`. **Open, needs a human:** this requires real browsers, which the implementing agent cannot run. The cookie code (T017) is built to the standard attributes and unit tested, but the browser-restart behavior is unverified until someone runs this check
- [X] T005 [P] Spike, sender (plan assumption 1): with a throwaway script in the scratchpad directory, confirm on Windows with Node 24 that `net.BlockList` classifies `127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `10.0.0.1`, `169.254.169.254`, `fd00:ec2::254` and a public address as intended, and that `http.request({ lookup })` can reject a resolved address and that `localhost` returns both `::1` and `127.0.0.1`. Record the result in `specs/057-security-lab-v1/research.md`; if any behavior differs, adjust R9/R10 before T083 and T097 **Done:** verified on Node v24.21.0, win32; result recorded in research.md assumption 1
- [X] T006 [P] Create the sample specification fixtures in `backend/tests/fixtures/securityLab/`: `sample-api.yaml` (root security requirement; an operation overriding it; an operation with explicit `security: []`; `GET /public/status` public; a path with a resource id parameter and read, update and delete operations; a request schema with a `readOnly` property and a `format: password` property; a response schema with a `writeOnly` property; a deprecated operation; a duplicate-style operation pair; a documented `X-RateLimit-Limit` header; `POST` creating a resource with an `id` in the response and a documented `DELETE`), `no-security.yaml` (no schemes, no requirements), `root-empty.yaml` (root `security: []`), and a JSON twin `sample-api.json` **Done:** sample-api.yaml and .json, no-security.yaml, root-empty.yaml load and build models
- [X] T007 [P] Create `backend/tests/fixtures/securityLab/secretCorpus.ts` exporting the seeded secret values (bearer token, API key, basic credentials, cookie, password, token in a JSON field, a secret in an error message, a secret-shaped response field) and helper `assertNoSecrets(text)` used by every seeded-secret assertion (SC-009) **Done:** secretCorpus.ts with assertNoSecrets and assertNoSecretsIn

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Shared contracts, additive model fields, typed errors, configuration, the owner identity, persistence, the registry, the router skeleton and the frontend shell that every story uses

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T008 Create `packages/shared-domain/src/securityLab.ts` (part 1) with the types from [data-model.md](data-model.md) §2 to §4: `SecuritySource`, `SecurityCategory`, `TaxonomyMapping`, `SupportLevel`, `SecurityObservation`, `ObservationClass`, `EffectiveSecurity`, `SecurityAnalysis`, `Prerequisite`, `SecurityMutation` (the closed union), `ExpectedBehavior`, `EvaluationCondition` (the closed union), `SecurityScenarioContent`, `SecurityScenario`, `SecurityScenarioVersion`, `ApprovalRecord`, `ReviewState`, `ExecutionStatus`, `Severity`. Framework-agnostic, no Express or Node imports
- [X] T009 Extend `packages/shared-domain/src/securityLab.ts` (part 2, same file, after T008) with [data-model.md](data-model.md) §5 to §8 and §11: `SecurityProfile`, `TestIdentity`, `TestDataEntry`, `CleanupStrategy`, `ProfileSummary`, `SecurityRun`, `PlannedItem`, `EvidenceRecord`, `ObservedSummary`, `ScenarioOutcomeKind`, `ScenarioResult`, `CleanupResult`, `SecurityFinding`, `FindingOccurrence`, `FindingStatus`, `SecurityOverview`, `SecurityReport`, `RetainedDataSummary`, `GenerationScope`
- [X] T010 [P] Edit `packages/shared-domain/src/apiModel.ts` (additive, optional only): `ApiModel.rootSecurity`, `ApiModel.rootSecurityDeclared`, `ApiOperation.securitySource`, `ApiOperation.deprecated`, `SchemaConstraint.readOnly`, `SchemaConstraint.writeOnly`, `SecuritySchemeDefinition.bearerFormat`, `SecuritySchemeDefinition.openIdConnectUrl`
- [X] T011 [P] Edit `packages/shared-domain/src/postmanArtifact.ts` (additive): add `security-repeat-not-expressible`, `security-persisted-state-not-expressible`, `security-condition-not-expressible` to `GenerationLimitationKind`
- [X] T012 Export `./securityLab` from `packages/shared-domain/src/index.ts` and build the shared-domain workspace so backend and frontend resolve the new types (after T008 to T011)
- [X] T013 Edit `backend/src/openapi/buildApiModel.ts` (additive): set `rootSecurity`, `rootSecurityDeclared`, `securitySource` (rule in [research.md](research.md) R2), `deprecated`, `readOnly`/`writeOnly` on schema constraints, `bearerFormat` and `openIdConnectUrl`. Add `backend/tests/unit/openapi/securityFacts.test.ts` (inherit, override, explicit empty, none declared, root empty, deprecated, property flags, scheme details). Update any existing golden or snapshot that serialises the whole `ApiModel`, deliberately and listed in the working notes. Re-run T003's test: it must still pass unchanged (after T010, T012)
- [X] T014 [P] Create `backend/src/securityLab/errors.ts` with the typed errors and codes from [security-lab-api.md](contracts/security-lab-api.md) "Typed error codes" (each carries a safe message and optional `details`; no stack or path)
- [X] T015 [P] Create `backend/src/securityLab/config.ts` with `loadSecurityLabLimits(env)` and `validateSecurityLabConfiguration(env)` for the ceilings and caps in [research.md](research.md) R11 and R13 (`SECURITY_LAB_MAX_REQUESTS_CEILING`, `SECURITY_LAB_MAX_CONCURRENCY_CEILING`, `SECURITY_LAB_TIMEOUT_MS_CEILING`, `SECURITY_LAB_MAX_REPEAT_CEILING`, `SECURITY_LAB_MAX_RETAINED_SCENARIOS`, `SECURITY_LAB_MAX_RETAINED_RUNS`); positive integers, typed error naming the variable. Call it in `backend/src/server.ts` beside the other startup validators; document each variable in `.env.example` (commented, defaults in code). Add `backend/tests/unit/securityLab/config.test.ts`
- [X] T016 [P] Create `backend/src/securityLab/canonical.ts` (canonical JSON with sorted keys, `hash16`, reusing `stableStringify` and `fragmentHash` from `backend/src/apiCoverage/specRevision.ts`) and `backend/tests/unit/securityLab/canonical.test.ts` (key order independence, stability)
- [X] T017 Create the owner identity: `backend/src/securityLab/owner/ownerContext.ts` (`AsyncLocalStorage`, `getOwnerId()`, test-only `enterTestOwner`) and `backend/src/securityLab/owner/ownerMiddleware.ts` (reads or issues the `apipilotOwner` cookie, `httpOnly`, `sameSite=lax`, `Max-Age` 400 days, `secure` over HTTPS; validates UUID shape; replaces a malformed value; creates no rows). Add `backend/tests/unit/securityLab/ownerMiddleware.test.ts`
- [X] T018 Append the Security Lab table blocks and indexes to `initializeSchema()` in `backend/src/persistence/connection.ts` per [research.md](research.md) R13: owner-scoped `security_scenarios`, `security_scenario_versions`, `security_runs`, `security_run_results`, `security_findings`, `security_settings`; session-scoped `security_profiles`, `security_evidence` (paired `*_encrypted`/`*_iv` columns). Add `backend/tests/unit/persistence/securityLabSchema.test.ts`. **Done:** the ninth table, `security_credentials`, was added by T022a (design revision, research R8).
- [X] T019 [P] Create `backend/src/persistence/securityScenarioRepository.ts` (owner-scoped scenarios and immutable versions; versions are insert-only; counts per owner and assessment; hard delete by owner and by assessment) and `backend/tests/unit/persistence/securityScenarioRepository.test.ts`
- [X] T020 [P] Create `backend/src/persistence/securityRunRepository.ts` (owner-scoped runs, results and settings; `getInProgress(sessionId)`; `appendResult`; `settle`; `requestCancel`; `markInterruptedRunsCancelled`; hard delete) and `backend/tests/unit/persistence/securityRunRepository.test.ts`
- [X] T021 [P] Create `backend/src/persistence/securityFindingRepository.ts` (owner-scoped findings with occurrences JSON, `findByScenarioVersion`, history append, hard delete) and `backend/tests/unit/persistence/securityFindingRepository.test.ts`
- [X] T022 [P] Create `backend/src/persistence/securityProfileRepository.ts` (session-scoped profiles, `deleteBySession`), registered with `onExpire` from `backend/src/session/sessionRegistry.ts`, and `backend/tests/unit/persistence/securityProfileRepository.test.ts`
- [X] T022a [P] Create `backend/src/persistence/securityCredentialRepository.ts` (session-scoped, **write-only** encrypted credential values keyed by profile, identity, scheme and kind `active | expired`; `set`, `clear`, `isSet`, `listStatus`, `read` for the sender only, `deleteByProfile`, `deleteBySession`), registered with `onExpire`, append the ninth table `security_credentials` to `initializeSchema()` (update `securityLabSchema.test.ts` and the pinned table list in `backend/tests/unit/persistence/connection.test.ts`), and add `backend/tests/unit/persistence/securityCredentialRepository.test.ts` (ciphertext at rest, no read path except the sender's, gone after forced expiry). Added by the design revision in research R8; also change `TestIdentity` in `packages/shared-domain/src/securityLab.ts` to `credentialSchemes` and `expiredCredentialSchemes`
- [X] T023 [P] Create `backend/src/persistence/securityEvidenceRepository.ts` (session-scoped encrypted evidence through `connection.cipher`, keyed by owner, run and result, `deleteBySession`), registered with `onExpire`, and `backend/tests/unit/persistence/securityEvidenceRepository.test.ts` (ciphertext at rest, gone after forced expiry)
- [X] T024 Create the registry: `backend/src/securityLab/registry/taxonomy.ts` (edition `owasp-api-top10-2023`, ids API1 to API10 with names, [research.md](research.md) R19) and `backend/src/securityLab/registry/categories.ts` (the eleven categories with support level, executability, prerequisites, taxonomy mapping with `relation`, limitation notes, per [data-model.md](data-model.md) §2). Add `backend/tests/unit/securityLab/registry.test.ts` (every category maps to at least one id, input validation is `related` to API8, SSRF and inventory are not generatable, support level independent of taxonomy)
- [X] T025 Create the router skeleton: `backend/src/api/securityLab.ts` (`createSecurityLabRouter(deps)` with the owner middleware, safe typed-error mapping, `GET /api/security-lab/categories`) and `backend/src/securityLab/securityLabService.ts` (façade, dependencies injected: workflow getter, repositories, clock, provider). Register it in `backend/src/app.ts` after the session middleware. Add `backend/tests/integration/securityLab/categories.test.ts` (route returns the registry, sets the owner cookie once, no `Set-Cookie` on other routers)
- [X] T026 Add the thin Security Lab environment routes (`GET`, `POST`, `PUT /api/security-lab/environments`, carrying only `name`, `tier` and `baseUrl`, never `variableValues`) in `backend/src/api/securityLab.ts` and `backend/src/securityLab/environments/environmentService.ts`, writing the existing session-scoped environment store; add `backend/tests/integration/securityLab/environments.test.ts`. **Revised during implementation (research R8):** `requireEnvironmentAccess()` and every existing environment route stay exactly as they are, because AP-032 requires that an uploaded-only workflow does not open them and its test pins that; the first design (opening the gate) is withdrawn
- [X] T027 [P] Edit `frontend/src/navigation/routes.ts`: add the `security` destination to `DESTINATION_IDS` and `SEGMENT_TO_VIEW`, extend `Route` with an optional `area` (`overview | scenarios | execution | reports`), and let `parseRoute` accept `#/security/<area>` only for that closed list (unknown area redirects to `#/security` with a notice); update `frontend/tests/unit/navigation/routes.test.ts`
- [X] T028 [P] Edit `frontend/src/navigation/destinations.ts`: add `security` to `TOP_DESTINATIONS` directly after `coverage`, a title, `headerTitleFor` case (parent "Results"), and the view mappings; update `frontend/tests/unit/navigation/destinations.test.ts`
- [X] T029 [P] Edit `frontend/src/components/workflowCatalog.ts` (extend `ResultsViewId` and `RESULTS_VIEWS` with Security Lab: title, tab label, description) and `frontend/src/components/paletteCommands.ts`; update `frontend/tests/unit/workflowCatalog.test.ts`, `paletteCommands.test.ts`, `HelpDialog.test.tsx`, `CommandPalette.test.tsx`
- [X] T030 Edit `frontend/src/components/shell/Sidebar.tsx` (inline SVG icon and `Icon` branch, `data-testid="sidebar-destination-security"`) and `frontend/src/App.tsx` (lazy import, hidden-when-inactive mount block, `runCommand` generalised from "open coverage" to "open that results view"); update `frontend/tests/unit/shell/Sidebar.test.tsx` and `frontend/tests/unit/App.test.tsx` (fetch stub router must accept the new endpoints) (after T027 to T029)
- [X] T031 [P] Create `frontend/src/services/securityLabClient.ts` with the discriminated-result pattern of `coverageClient.ts` (typed fields only in logs, `invalid_response` validation) and the first functions `fetchCategories`; add `frontend/tests/unit/securityLab/securityLabClient.test.ts`. Later tasks extend this file
- [X] T032 [P] Create `frontend/src/components/securityLab/securityViewModel.ts` (typed visual variants for severity, scenario review state, execution status, outcome, observation classification, support level, each with a text label so nothing relies on color alone, CLAUDE.md §43) and `frontend/tests/unit/securityLab/securityViewModel.test.ts`
- [X] T033 Create `frontend/src/pages/SecurityLabPage.tsx` with the four areas as `Tabs` addressed through the route `area`, a `SpecNotLoadedNotice` component (`frontend/src/components/securityLab/SpecNotLoadedNotice.tsx`), and loading, empty and error states using the existing `Skeleton`, `EmptyState`, `ErrorState`; add `frontend/tests/unit/securityLab/SecurityLabPage.test.tsx` (areas reachable by keyboard, area in the URL, no-specification notice) (after T027 to T032)

**Checkpoint**: Foundation ready. `npm test`, `npm run lint` and `npm run build` pass, T003's test is unchanged and green, and an empty Security Lab destination opens.

---

## Phase 3: User Story 1 - See what the specification says about security, and what it does not (Priority: P1) 🎯 MVP

**Goal**: A deterministic security analysis with correct effective-security resolution, classified observations, rationale and source, and no overclaiming.

**Independent Test**: Analyze `sample-api.yaml`, `no-security.yaml`, `root-empty.yaml` and a HAR-derived model; verify effective security per operation (inherit, override, explicit public, none declared, unset), each observation's classification, element and rationale, determinism, and that no output claims a proven vulnerability (SC-002, SC-003).

### Tests for User Story 1

- [X] T034 [P] [US1] `backend/tests/unit/securityLab/effectiveSecurity.test.ts`: every row of [generation-and-analysis-rules.md](contracts/generation-and-analysis-rules.md) §1 over the fixtures, including `{}` anonymous alternative and root-empty
- [X] T035 [P] [US1] `backend/tests/unit/securityLab/analysisRules.test.ts`: each observation rule in §2 (classification, element pointer, rationale, basis; name-match never above requires-context; HAR and definition models give not-measurable with their origin label)
- [X] T036 [P] [US1] `backend/tests/unit/securityLab/analysis.determinism.test.ts` and `observationWording.test.ts`: analyze twice, deep-equal and identically ordered; no observation text contains "vulnerable", "exploitable" or "proves" (SC-003)
- [X] T037 [P] [US1] `backend/tests/integration/securityLab/analysis.test.ts`: `GET /analysis` over all operations regardless of workflow selection (FR-005), `409 no_specification` without a workflow, `PUT/GET /settings` validation and retention

### Implementation for User Story 1

- [X] T038 [US1] Create `backend/src/securityLab/analysis/effectiveSecurity.ts` (`resolveEffectiveSecurity(apiModel) → EffectiveSecurity[]` using `securitySource`, `rootSecurity`, `rootSecurityDeclared`, `securitySchemes`)
- [X] T039 [P] [US1] Create `backend/src/securityLab/analysis/sensitivity.ts` (fixed documented lists of sensitive path tokens, parameter names and property-name patterns; `classifyProperty` returning a recorded basis `format-password | write-only | user-configured | name-match`)
- [X] T040 [P] [US1] Create `backend/src/securityLab/analysis/rules/authSchemes.ts` (`auth-scheme-declared`, `auth-scheme-unused`, `operation-uses-undeclared-scheme`)
- [X] T041 [P] [US1] Create `backend/src/securityLab/analysis/rules/effectiveSecurityRules.ts` (`effective-security-public`, `effective-security-none-declared`, `security-override`)
- [X] T042 [P] [US1] Create `backend/src/securityLab/analysis/rules/sensitiveOperation.ts`, `sensitiveProperty.ts`, `readOnlyInRequest.ts`
- [X] T043 [P] [US1] Create `backend/src/securityLab/analysis/rules/errorResponses.ts`, `inventory.ts` (`inventory-duplicate-operation`, `inventory-deprecated`, `inventory-version-marker`), `observedModelLimits.ts`
- [X] T044 [P] [US1] Create `backend/src/securityLab/analysis/securityBasisHash.ts` (per-operation hash of the security-only facts, [research.md](research.md) R3, using `canonical.ts`)
- [X] T045 [US1] Create `backend/src/securityLab/analysis/analyzeSecurity.ts` (rule registry, stable ordering, counts, `specificationRevision` from `apiCoverage/specRevision.ts`, `unmeasurable` list); pure and AI-free (after T038 to T044)
- [X] T046 [US1] Add `backend/src/securityLab/settings/settingsService.ts` (user-configured sensitive field names through the run repository's settings methods) and the routes `GET /api/security-lab/analysis`, `GET` and `PUT /api/security-lab/settings` in `backend/src/api/securityLab.ts` and the façade
- [X] T047 [P] [US1] Create `frontend/src/components/securityLab/ObservationList.tsx` (grouped by classification, each row with element, rationale, basis, origin badge via `FactOriginBadge`) and `CategoryTable.tsx` (support level, executability, taxonomy ids and relation, shown as ApiPilot's judgement where `related`) with tests under `frontend/tests/unit/securityLab/`
- [X] T048 [US1] Create `frontend/src/components/securityLab/OverviewArea.tsx` (analysis summary: counts by classification via `StatTile`, the standing note that specification analysis does not prove runtime vulnerabilities, risks labelled "Potential risks (specification analysis)", empty, loading and error states) and extend `securityLabClient.ts` with `fetchAnalysis`; test `OverviewArea.test.tsx`
- [X] T049 [US1] Create `frontend/src/components/securityLab/SensitiveFieldsEditor.tsx` (configured sensitive field names, recorded as user-provided) wired into the Overview with `fetchSettings`/`saveSettings` in the client; test

**Checkpoint**: US1 is independently usable: upload a specification, open Security Lab, read a faithful analysis. This is the MVP slice.

---

## Phase 4: User Story 2 - Generate security scenarios and review them before anything runs (Priority: P1)

**Goal**: Schema-validated, deterministic security scenarios across the supported categories, with scope control, versioned edits, version-bound approval and practical batch review.

**Independent Test**: Generate scenarios for a specification, filter them, open one, edit its request (approval withdrawn), approve again, reject another and confirm it cannot be selected; confirm identical input gives identical ids, that scope defaults to the guided selection and can be widened, and that a malformed scenario is rejected (SC-004, SC-005, SC-010).

### Tests for User Story 2

- [X] T050 [P] [US2] `backend/tests/unit/securityLab/scenarioValidation.test.ts`: every rejection code in [security-scenario-contract.md](contracts/security-scenario-contract.md) (schema, unknown operation or field, URL in content, header override, repeat over ceiling, probe not in set, ungrounded expectation, undocumented status cited, destructive flag lowered, credential in content)
- [X] T051 [P] [US2] `backend/tests/unit/securityLab/scenarioIdentity.test.ts`: id stability across revisions, `contentHash` over material fields only, non-material edit leaves the hash, dedupe key includes mutations and expected kind
- [X] T052 [P] [US2] `backend/tests/unit/securityLab/generationRules.test.ts`: per category in [generation-and-analysis-rules.md](contracts/generation-and-analysis-rules.md) §3, including no auth scenarios for explicit-public or none-declared, no authorization scenario without a stated policy and two roles, BOLA incomplete without two identities and owned data, bounded repeat, name-match fields produce no scenario, SSRF and inventory generate none
- [X] T053 [P] [US2] `backend/tests/unit/securityLab/generation.determinism.test.ts` and `generationScope.test.ts`: identical input gives identical scenarios, ids and order (SC-004); selection default, widen and narrow, scope and excluded counts, existing scenarios kept after narrowing
- [X] T054 [P] [US2] `backend/tests/unit/securityLab/reviewStateMachine.test.ts` and `approvalBinding.test.ts`: every allowed and refused transition pair, approval bound to version and hash, material edit withdraws and non-material keeps approval, version 1 immutable, rejected never executable (SC-010)
- [X] T055 [P] [US2] `backend/tests/unit/securityLab/reviewBatch.test.ts`: explicit `{id, version}` items only, per-item refusal reasons, stale version, destructive confirmation required, incomplete and stale items refused, partial application reported
- [X] T056 [P] [US2] `backend/tests/integration/securityLab/scenarios.test.ts`: generate, list with every filter, `GET /scenarios/ids`, detail with version history, `PATCH` conflicts (`409 stale_version`, `422 scenario_invalid`), review batch, `GET /scope`, `409 retention_limit_reached`, retained scenarios readable with no workflow (`noSpecificationRead`)
- [X] T057 [P] [US2] `backend/tests/unit/securityLab/scenarioScale.test.ts`: generate and list 2,000 scenarios, list under 300 ms, a batch of 500 `{id, version}` items completes with per-item results (XXXII)

### Implementation for User Story 2

- [X] T058 [US2] Copy the contract schema to `backend/src/securityLab/scenarios/security-scenario.v1.schema.json` and add a test in `scenarioValidation.test.ts` asserting it is byte-equal to `specs/057-security-lab-v1/contracts/security-scenario.v1.schema.json` **Done:** the schema is a TypeScript constant in scenarios/scenarioSchema.ts (like the API-definition schema), and a test asserts it equals the contract file
- [X] T059 [P] [US2] Create `backend/src/securityLab/scenarios/scenarioId.ts`, `contentHash.ts` (material field set) and `dedupe.ts` per the contract **Done:** scenarioIdentity.ts holds the id, content hash and dedupe key; dedupe itself is applied in generateSecurityScenarios.ts
- [X] T060 [P] [US2] Create `backend/src/securityLab/scenarios/prerequisites.ts` (derive met, missing or unsupported from the optional profile; with no profile every identity or data prerequisite is missing; OAuth2 token exchange is unsupported) **Done:** also judges identities by role label, ownership data, thresholds and expired credentials
- [X] T061 [P] [US2] Create `backend/src/securityLab/scenarios/caps.ts` (documented per-operation and per-category caps, reports what a cap omitted)
- [X] T062 [US2] Create `backend/src/securityLab/scenarios/validateScenario.ts` (Ajv structure, domain, safety including `classifyValue` credential rejection, grounding; all violations as JSON Pointers) (after T058)
- [X] T063 [P] [US2] Create `backend/src/securityLab/scenarios/rules/authentication.ts`
- [X] T064 [P] [US2] Create `backend/src/securityLab/scenarios/rules/authorization.ts` and `bola.ts`
- [X] T065 [P] [US2] Create `backend/src/securityLab/scenarios/rules/objectProperty.ts` and `inputValidation.ts` (reuse `backend/src/testDesign/valueGenerators.ts` and `requestHelpers.ts`)
- [X] T066 [P] [US2] Create `backend/src/securityLab/scenarios/rules/resourceConsumption.ts` and `sensitiveDataExposure.ts`
- [X] T067 [P] [US2] Create `backend/src/securityLab/scenarios/rules/misconfiguration.ts` (safe `method.probe`, documented header policy, error-leak check) and `limitedCategories.ts` (observations only for business flows and SSRF, no executable scenario) **Done:** misconfiguration.ts checks TRACE and error leaks; the business-flow and SSRF limits are a generation note and the analysis rule analysis/rules/ssrfCandidates.ts, not scenario rules
- [X] T068 [P] [US2] Create `backend/src/securityLab/scenarios/destructive.ts` (reuse `DESTRUCTIVE_METHODS` from `backend/src/execution/destructiveOperations.ts`; reasons list; raise-only)
- [X] T069 [P] [US2] Create `backend/src/securityLab/scenarios/productRules.ts` (the named rule table SL-REJECT-NOT-SUCCESS and the rest of [generation-and-analysis-rules.md](contracts/generation-and-analysis-rules.md) §5) and `suggestedSeverity.ts` (fixed table by category and mutation)
- [X] T070 [US2] Create `backend/src/securityLab/scenarios/generateSecurityScenarios.ts` (pure `(apiModel, analysis, profileContext, scope) → scenarios`, rule array, dedupe, caps, ids, every scenario validated before it is returned) (after T059 to T069)
- [X] T071 [US2] Create `backend/src/securityLab/scenarios/scenarioService.ts` and `backend/src/securityLab/retention/assessmentKey.ts`: persist generation (new versions for changed bases, never overwrite), scope resolution from `workflow.selectedOperationKeys` ([research.md](research.md) R23), assessment key and label ([research.md](research.md) R22), per-owner retention caps, derived flags (`specificationNotLoaded`, `stale`, `orphaned`, `blocked`, `executable`)
- [X] T072 [US2] Create `backend/src/securityLab/review/stateMachine.ts` (pure transition table from [review-and-approval-rules.md](contracts/review-and-approval-rules.md))
- [X] T073 [US2] Create `backend/src/securityLab/review/reviewService.ts` and `batch.ts` (versioned edits, material-field detection, approval binding with `contentHash`, destructive confirmation, per-item results, `executionStatus` setters used later by the run service) (after T059, T072)
- [X] T074 [US2] Add routes `POST /scenarios/generate`, `GET /scenarios`, `GET /scenarios/ids`, `GET /scenarios/:id`, `PATCH /scenarios/:id`, `POST /scenarios/review`, `GET /scope` to `backend/src/api/securityLab.ts` and the façade
- [X] T075 [P] [US2] Create `frontend/src/components/securityLab/ScopeBanner.tsx`, `ScenarioFilters.tsx` and `ScenarioList.tsx` (search, filters by operation, category, severity, review state, execution status, derived flags; `Pagination`; counts) with tests
- [X] T076 [P] [US2] Create `frontend/src/components/securityLab/ScenarioDetail.tsx` and `PrerequisitePanel.tsx` (request and expected-behavior preview in `CodeBlock`, basis badge documented or named product rule, evaluation conditions, destructive flag, exactly what is missing, history by version with the approval each applies to) with tests
- [X] T077 [US2] Create `frontend/src/components/securityLab/ScenarioEditor.tsx` (edits request, expected behavior and conditions, shows before saving whether the edit is material and that approval will be withdrawn, surfaces `scenario_invalid` violations) with tests
- [X] T078 [US2] Create `frontend/src/components/securityLab/BatchReviewBar.tsx` (resolves the current filter through `GET /scenarios/ids`, shows count and listable set, excludes destructive and incomplete items by default with counts, separate named confirmation for destructive ones via `ConfirmDialog`, reports per-item outcomes) with tests
- [X] T079 [US2] Create `frontend/src/components/securityLab/ScenariosArea.tsx` composing T075 to T078, extend `securityLabClient.ts` with scenario functions, add an accessibility test (`ScenariosArea.accessibility.test.tsx`: names, keyboard paths, outcomes never by color alone)

**Checkpoint**: US1 and US2 work: analysis plus reviewed, approved scenarios, nothing executable yet. Scenario export (US7) can already be built from here.

---

## Phase 5: User Story 6 - Define who the tests act as and where they may go (Priority: P2, built before US3)

**Goal**: Target profiles with allowed hosts and ports, tier rules, identities as references, limits and cleanup, and the destination policy, all enforced where requests are made.

**Independent Test**: Create, edit and delete profiles of each kind; verify each validation rule with a named reason, that production is refused, that secrets are never returned, and that the destination policy matrix holds when called directly (SC-006 groundwork).

### Tests for User Story 6

- [X] T080 [P] [US6] `backend/tests/unit/securityLab/destinationPolicy.test.ts`: every block reason in [execution-safety-rules.md](contracts/execution-safety-rules.md) §2, each tier, literal IPs, IPv4-mapped IPv6, metadata addresses, trailing-dot and case variants, userinfo, ports
- [X] T081 [P] [US6] `backend/tests/unit/securityLab/profileValidation.test.ts`: production refused, base URL must be allowed, address ranges only on local, relaxed TLS only on local, limits above ceilings refused, unknown categories refused, identity variables must exist in the environment, test data credential-shaped refused **Done:** the identity-variables rule was superseded by the write-only credential store (R8): identity scheme names are checked against the loaded specification instead.
- [X] T082 [P] [US6] `backend/tests/integration/securityLab/profiles.test.ts`: create, update, delete (`409 profile_in_use`), `POST /profiles/:id/check` resolves without connecting (injected resolver), responses never contain a secret, profiles removed after forced session expiry while retained scenarios remain

### Implementation for User Story 6

- [X] T083 [US6] Create `backend/src/securityLab/execution/destinationPolicy.ts` (pure `evaluateDestination` using `node:net` `BlockList`, address classes, always-blocked metadata and unspecified addresses, reason codes) (after T005)
- [X] T084 [P] [US6] Create `backend/src/securityLab/profiles/tierPolicy.ts` and `profileValidation.ts` (rules in [data-model.md](data-model.md) §5; production refusal; each violation a coded entry)
- [X] T085 [US6] Create `backend/src/securityLab/profiles/profileService.ts` (profile CRUD on the session-scoped repository, environment reference from `backend/src/execution/environmentStore.ts` (target name, tier and base URL only), identity scheme names against the loaded specification, write-only credential set and clear through the credential repository, credential status per identity and scheme, `profile_in_use` check against in-progress runs)
- [X] T086 [US6] Add profile routes (`GET`, `POST`, `PUT`, `DELETE /profiles`, `POST /profiles/:id/check` with an injectable resolver, `PUT` and `GET /profiles/:id/credentials` where `GET` returns status and never a value) to `backend/src/api/securityLab.ts` and the façade **Done:** Responses: POST 201, DELETE 204, PUT credentials 204. Violation codes are the ones in profileValidation.ts and profileService.ts; the contract table is updated in the Polish phase.
- [X] T087 [P] [US6] Create `frontend/src/components/securityLab/ProfileEditor.tsx` and `IdentityEditor.tsx` (target environment chosen or created through the Security Lab environment routes (name, tier and base URL only; no existing `EnvironmentForm`, which shows variable values), allowed hosts and ports, address ranges shown only for local tier, TLS policy, identities with write-only credential fields that show only "set" or "not set" and are cleared from the form after saving, test data, limits within ceilings, permitted categories, destructive flag, cleanup strategy, violations shown by code and text) and profile client functions, with tests
- [X] T088 [US6] Create `frontend/src/components/securityLab/ProfileList.tsx` (validity and problems per profile, check action) as the first part of `ExecutionArea.tsx`, with tests

**Checkpoint**: Profiles can be defined and validated; the destination policy exists and is tested in isolation.

---

## Phase 6: User Story 3 - Run approved scenarios safely against a target I am allowed to test (Priority: P1)

**Goal**: A confirmed, bounded, cancellable run that sends only approved scenario versions to validated destinations, records every outcome honestly and reports cleanup failures.

**Independent Test**: Against the local sample target, run a mixed approved selection, cancel part-way and verify partial results; then violate each control in turn (disallowed host, redirect to a disallowed host, budget too small, category not permitted, destructive scenario on staging) and verify a named refusal with no request reaching the disallowed destination (SC-006 to SC-008).

### Tests for User Story 3

- [X] T089 [P] [US3] `backend/tests/unit/securityLab/guardedSender.test.ts` (also covers `rebinding` and `redirects`): injected resolver changing its answer between check and connect is blocked; cross-origin redirect drops credentials; hop limit; redirect to a disallowed host or metadata address; read cap marks truncated; timeout; abort in flight; proxy variables ignored
- [X] T090 [P] [US3] `backend/tests/unit/securityLab/runPlanner.test.ts`: budget arithmetic including cleanup, categories not permitted, destructive gating by tier and profile flag, unmet prerequisites, stale or unapproved versions refused, plan digest changes with any plan change
- [X] T091 [P] [US3] `backend/tests/unit/securityLab/runSecurityRun.test.ts` (budgetConcurrency, cancel, cleanupFailure): concurrency 4 against budget 10 never sends 11; cancel stops dequeuing and aborts in flight; unstarted are `not_run`; cleanup attempted after cancel; failed cleanup is in the result with what remains. Uses a stub evaluator
- [X] T092 [P] [US3] `backend/tests/integration/securityLab/directServiceBypass.test.ts` and `executionSlot.test.ts`: the service refuses each violation when called directly with no router or UI; a Security Lab run makes `execution/start` return `409 execution_in_progress` and vice versa
- [X] T093 [P] [US3] `backend/tests/integration/securityLab/runs.test.ts`: preview sends nothing, start requires digest, target name and base URL for staging-like tiers and attestation, `409 plan_changed`, `409 confirmation_required`, destructive confirmation, listing, cancel, retained summary survives forced expiry with no profile data

### Implementation for User Story 3

- [X] T094 [US3] Create `backend/src/securityLab/execution/limits.ts` (effective limits from profile, request overrides and the ceilings in `config.ts`; defaults per [research.md](research.md) R11) **Done:** Run limits can only be lowered; ceilings come from config.ts.
- [X] T095 [P] [US3] Create `backend/src/securityLab/execution/buildSecurityRequest.ts` (scenario version plus profile snapshot plus environment values to a concrete request; one pure builder per mutation kind; credentials resolved by variable name; no destination from content) and `probes.ts` (fixed benign injection probe set)
- [X] T096 [US3] Create `backend/src/securityLab/execution/guardedSender.ts` (`node:http`/`https` with a validating `lookup`, manual redirect revalidation, read cap, deadline, `AbortSignal`, `Sender` interface injected) (after T083)
- [X] T097 [P] [US3] Create `backend/src/securityLab/execution/planDigest.ts` and `runPlanner.ts` (preview summary, planned request count, problems list, hosts and ports, destructive list) (after T083, T094)
- [X] T098 [P] [US3] Create `backend/src/securityLab/evidence/redactEvidence.ts` and `excerpt.ts` (compose the helpers named in [research.md](research.md) R14; mask every resolved credential value by literal match; bounded excerpts flagged truncated) with `backend/tests/unit/securityLab/redactEvidence.test.ts` using `secretCorpus.ts`
- [X] T099 [US3] Create `backend/src/securityLab/execution/cleanup.ts` (`delete-created-via-spec`: read `idField`, build the documented `DELETE`, send through the same sender and policy; failed cleanup with what remains and manual removal text)
- [X] T100 [US3] Create `backend/src/securityLab/execution/runSecurityRun.ts` (worker pool sized by concurrency, shared budget counter decremented before send, cancel, cleanup, results persisted, evidence stored session-scoped, run summary retained; evaluator and sender injected; stores `executed` status through `reviewService` setters) (after T095 to T099)
- [X] T101 [US3] Edit `backend/src/execution/executionSlot.ts` to OR in `getSecurityRunRepository().getInProgress(getSessionId())`, call `markInterruptedRunsCancelled()` for Security Lab runs from `backend/src/server.ts` at startup, and extend `backend/tests/unit/execution/` slot tests **Done:** Slot joined via findExecutionInProgress; startup settle in server.ts; slot tests in tests/integration/securityLab/executionSlot.test.ts.
- [X] T102 [US3] Add routes `POST /runs/preview`, `POST /runs`, `GET /runs`, `GET /runs/:id` (with `?evidence=true&scenarioId=`), `POST /runs/:id/cancel` to `backend/src/api/securityLab.ts` and the façade, including confirmation validation per [security-lab-api.md](contracts/security-lab-api.md)
- [X] T103 [P] [US3] Create the loopback sample targets `backend/tests/fixtures/securityLab/vulnerableTarget.ts` (accepts requests without credentials on one operation, leaks a stack trace on error, redirects on demand, fails cleanup `DELETE` on demand) and `secureTarget.ts`, extending `backend/tests/fixtures/execution/targetServer.ts`
- [X] T104 [P] [US3] Create `backend/scripts/securityStubTarget.ts` (manual loopback sample target on `127.0.0.1:4700`, same behaviors) and add `"security:stub": "tsx scripts/securityStubTarget.ts"` to `backend/package.json`
- [X] T105 [P] [US3] Create `frontend/src/hooks/useSecurityRun.ts` (polls `GET /runs/:id` every second, never overlaps polls, stops on a final state, retryable errors, no `LiveRunKind` change) and run client functions, with tests
- [X] T106 [US3] Create `frontend/src/components/securityLab/RunPlanDialog.tsx` (preview summary, staging typed target name and base URL, authorization attestation, destructive list with per-scenario confirmation, budget and limits, TLS policy, "real requests will be sent") and tests
- [X] T107 [US3] Create `frontend/src/components/securityLab/RunProgress.tsx` and complete `ExecutionArea.tsx` (approved scenario selection with reasons for unselectable ones, run settings within limits, progress, cancel, partial results, cleanup failures) with tests and an accessibility test

**Checkpoint**: A run can be previewed, confirmed, executed, cancelled and reviewed against the sample targets with every control enforced. Outcomes are recorded as `executed` until evaluation is wired in.

---

## Phase 7: User Story 4 - Judge the evidence against explicit expectations and record findings (Priority: P2)

**Goal**: Deterministic evaluation, confidence and severity, and one finding per failed scenario version with occurrences, evidence while available, and links.

**Independent Test**: Run against the vulnerable and secure targets; verify passed, failed, inconclusive, errored, blocked and not-run outcomes, exactly one finding per failed version with an occurrence count equal to the number of failures over repeated runs, reopening and unreviewed rules, links, and that findings survive a forced session expiry with evidence unavailable (SC-011, SC-017).

### Tests for User Story 4

- [X] T108 [P] [US4] `backend/tests/unit/securityLab/evaluation.test.ts`: the condition truth table in [evaluation-and-findings-rules.md](contracts/evaluation-and-findings-rules.md) including every indeterminate cause, and outcome precedence
- [X] T109 [P] [US4] `backend/tests/unit/securityLab/confidenceSeverity.test.ts`: confidence table, severity never raised, determinism (evaluate twice equal)
- [X] T110 [P] [US4] `backend/tests/unit/securityLab/findingOccurrences.test.ts`: create, append, reopen from `resolved`, `accepted-risk` kept with `unreviewedOccurrence` and acknowledgement, `verified-by-rerun`, separate finding with `supersedes` after a material edit, occurrence count equals failed results over many reruns (SC-011), history immutability
- [X] T111 [P] [US4] `backend/tests/integration/securityLab/findings.test.ts`: findings routes and filters, evidence route `available` flag before and after forced session expiry, observed summary never contains a body excerpt, `PATCH` validation, links to scenario version, run and specification element
- [X] T112 [P] [US4] `backend/tests/integration/securityLab/seededSecretCorpus.test.ts`: seed every value from `secretCorpus.ts` into requests, responses, headers, bodies and error text, run end to end, and assert absence in stored evidence, observed summaries, retained run rows, findings, logs (captured output), and later in the report and export (extended by T127 and T139)

### Implementation for User Story 4

- [X] T113 [P] [US4] Create `backend/src/securityLab/evaluation/leakPatterns.ts` (fixed enumeration of `stack-trace`, `server-banner`, `internal-path`, `secret-shaped-value`, `sql-error`)
- [X] T114 [US4] Create `backend/src/securityLab/evaluation/evaluateConditions.ts` (one pure evaluator per condition kind returning `satisfied | violated | indeterminate`) (after T113)
- [X] T115 [US4] Create `backend/src/securityLab/evaluation/scenarioOutcome.ts` (precedence: blocked, not_run, errored, failed, inconclusive, passed) and `observedSummary.ts` (deterministic bounded summary, never a body excerpt, secret-like values described by path)
- [X] T116 [P] [US4] Create `backend/src/securityLab/evaluation/confidence.ts` (high, medium, low with recorded basis) and extend `suggestedSeverity.ts` usage for the finding
- [X] T117 [P] [US4] Create `backend/src/securityLab/evaluation/remediationText.ts` (static text per category and mutation, versioned with the code, no model)
- [X] T118 [US4] Create `backend/src/securityLab/findings/findingService.ts` (the table in [evaluation-and-findings-rules.md](contracts/evaluation-and-findings-rules.md): create, append occurrence, reopen, flag unreviewed, acknowledge, `supersedes`, `verified-by-rerun`, manual status and severity changes with history and notes)
- [X] T119 [US4] Create `backend/src/securityLab/evaluation/evaluateScenario.ts` combining T114 to T117 into the evaluator injected into the run service
- [X] T120 [US4] Wire the real evaluator and `findingService` into `runSecurityRun.ts` and the façade: after the last request of a scenario set `executionStatus` `executed` then `evaluated`, persist the outcome, reason, condition results and observed summary, and create or extend the finding for `failed`; keep a run valid when evaluation throws (scenario stays `executed`, error category logged)
- [X] T121 [US4] Add routes `GET /findings`, `GET /findings/:id`, `GET /findings/:id/occurrences/:resultId/evidence`, `PATCH /findings/:id` to `backend/src/api/securityLab.ts` and the façade
- [X] T122 [P] [US4] Create `frontend/src/components/securityLab/FindingsList.tsx` (filters incl. unreviewed occurrences, occurrence count beside each finding, severity and status as text and badge) with tests
- [X] T123 [P] [US4] Create `frontend/src/components/securityLab/FindingDetail.tsx` and `EvidenceView.tsx` (expected versus observed, occurrences with time, confidence and its basis, remediation, links to scenario, run and specification element, status and severity controls with required note, "raw evidence no longer available" state, scrolling code blocks) with tests
- [X] T124 [US4] Extend `ExecutionArea.tsx` and `securityLabClient.ts` with findings, outcomes per scenario and links between findings, scenarios and runs; add `FindingDetail.accessibility.test.tsx`

**Checkpoint**: Full run, evaluate, find loop works; US1 to US4 and US6 are complete.

---

## Phase 8: User Story 5 - Overview and Reports: communicate the security posture without overclaiming (Priority: P2)

**Goal**: An Overview whose counts reconcile and open matching lists, separated risks and findings, a deterministic report that works without a loaded specification, and retained-data management.

**Independent Test**: With analysis, scenarios, a run and a finding in place, verify every Overview count against its list, the risks versus findings separation, the report content and exclusions, the report after a forced session expiry with no specification, and the delete flows (SC-012, SC-017).

### Tests for User Story 5

- [X] T125 [P] [US5] `backend/tests/unit/securityLab/overviewCounts.test.ts`: counts reconcile with lists including rejected, stale, orphaned and specification-not-loaded scenarios, findings counted not occurrences, untested high-priority basis, scope shown **Done:** Implemented as backend/tests/integration/securityLab/overviewReport.test.ts (counts reconcile through the real routes). High priority = potential-risk or sensitive-operation observations.
- [X] T126 [P] [US5] `backend/tests/unit/securityLab/securityReport.test.ts`: all FR-061 content, deterministic for identical records (injected clock), no secret, works with no specification loaded, HTML escapes every interpolated value **Done:** Pure summary and HTML in tests/unit/securityLab/securityReport.test.ts; the report routes are in overviewReport.test.ts.
- [X] T127 [P] [US5] `backend/tests/integration/securityLab/retention.test.ts` (with `ownerIsolation`, `noSpecificationRead`): retained work survives forced session expiry and simulated restart, session data and evidence do not, another owner sees nothing, per-assessment and full delete remove everything, typed confirmation enforced, caps refuse with `retention_limit_reached` (SC-017); extend the seeded-secret test (T112) to the report
- [X] T128 [P] [US5] `frontend/tests/unit/securityLab/OverviewArea.counts.test.tsx` and `ReportsArea.test.tsx`: each count navigates to the matching filtered list with the same total, risks and findings groups labelled with evidence basis, empty, loading and error states distinct

### Implementation for User Story 5

- [X] T129 [US5] Create `backend/src/securityLab/reports/overview.ts` (all FR-060 content, `untestedHighPriority` with basis) and `GET /overview` in the router
- [X] T130 [US5] Create `backend/src/securityLab/reports/summarizeReport.ts` (FR-061 content: coverage, outcomes, findings with status, revision, profile summary per run, taxonomy edition, not-covered categories and prerequisites with reasons, limits statement)
- [X] T131 [US5] Create `backend/src/securityLab/reports/renderSecurityReportHtml.ts` (pure, self-contained, dark-mode aware, `escapeHtml` from `backend/src/externalCollections/runReportHtml.ts`, file name helper) and `GET /report?format=html|json&runIds=` with the coverage report's headers, `409 nothing_to_report`
- [X] T132 [US5] Create `backend/src/securityLab/retention/retainedDataService.ts` (counts per assessment and caps, hard delete of one assessment or everything in one transaction, refuse while a run is in progress) and routes `GET /data`, `DELETE /assessments/:assessmentKey`, `DELETE /data` with typed confirmation
- [X] T133 [US5] Complete `frontend/src/components/securityLab/OverviewArea.tsx` (all counts, scope, run summary, untested high-priority list, risks and findings in separate labelled groups, counts as links that open the filtered list) and extend the client with overview functions
- [X] T134 [US5] Create `frontend/src/components/securityLab/ReportsArea.tsx` (assessment summary, category coverage and outcomes, findings and remediation status, HTML and JSON download)
- [X] T135 [US5] Create `frontend/src/components/securityLab/RetainedDataPanel.tsx` inside Reports (what is kept and what goes with the session, per-assessment label and counts, delete with typed confirmation via `PromptDialog`, the cookie limitation text) with tests
- [X] T136 [US5] Make every area work when no specification is loaded: show `SpecNotLoadedNotice`, disable generation, approval and run with the reason, keep findings, runs, reports and retained data readable; add `frontend/tests/unit/securityLab/NoSpecification.test.tsx`

**Checkpoint**: Reports and retained-data management work; US1 to US6 complete.

---

## Phase 9: User Story 7 - Export approved security scenarios as an executable artifact (Priority: P3)

**Goal**: A deterministic Postman collection of approved scenario versions, credentials as empty variables, unexpressible scenarios listed.

**Independent Test**: Export an approved set including a bounded-repeat scenario; verify variables for base URL and credentials, no secret, identical output on a second export, the limitation entry, and that existing OpenAPI exports are unchanged (SC-004, SC-009, SC-014).

### Tests for User Story 7

- [X] T137 [P] [US7] `backend/tests/unit/postman/securityOverlay.test.ts`: each mutation's effect on an item per [postman-security-amendment.md](contracts/postman-security-amendment.md), assertion templates insert only validated numbers, names and paths
- [X] T138 [P] [US7] `backend/tests/unit/postman/generateSecurityCollection.test.ts`: only approved versions with matching hash (`unapproved_version`), `empty_approved_set`, deterministic repeat export, empty secret variables listed in the README, each unexpressible scenario in `limitations`, traceable ids and descriptions, collection passes the existing validator
- [X] T139 [P] [US7] Extend `existingOutputsUnchanged.test.ts` (T003) and `seededSecretCorpus.test.ts` (T112) to cover the export, and add `backend/tests/integration/securityLab/export.test.ts` for `GET /export/postman` (`409 no_approved_scenarios`, `422 export_failed`)

### Implementation for User Story 7

- [X] T140 [P] [US7] Create `backend/src/postman/securityOverlay.ts` (pure application of each mutation to a built item)
- [X] T141 [P] [US7] Create `backend/src/postman/securityAssertionScripts.ts` (fixed templates for `status.not-success`, `status.in-set`, `status.equals`, `status.not-equals`, `header.present`, `header.absent`, `body.field-absent`, `body.field-present`; text is ApiPilot's own)
- [X] T142 [US7] Create `backend/src/postman/generateSecurityCollection.ts` reusing `buildRequestItem`, `authMapping`, `artifactVariables`, `identifiers` and the validator; folder per category; the new limitation kinds from T011 (after T140, T141)
- [X] T143 [US7] Update the export-limitations display in `frontend/src/components/PostmanExportLimitations.tsx` and `aggregateLimitations` handling for the three new kinds, with test updates **Done:** the headings were added with the kinds (the exhaustive `Record` type forces them); `aggregateLimitations` is kind-agnostic and needed no change. Tests added in `frontend/tests/unit/PostmanExportLimitations.test.tsx` (heading per kind, repeated gap collapses)
- [X] T144 [US7] Add `GET /export/postman` to `backend/src/api/securityLab.ts` delivered the way the existing Postman export is, and the façade method
- [X] T145 [US7] Add the export action and limitations list to `ReportsArea.tsx` and the client, with a test **Done:** `SecurityExportPanel.tsx` (base address, three downloads, excluded scenarios, limitations, empty and failure states, disabled with the reason when no specification is loaded) and `exportSecurityPostman` in the client. `SecurityExportReply`, `SuggestReply` and its parts moved to shared-domain (CLAUDE.md section 4); the backend now imports them

**Checkpoint**: Approved scenarios export as a deterministic, secret-free collection.

---

## Phase 10: User Story 8 - Optionally add AI-suggested scenarios without letting AI act (Priority: P3)

**Goal**: Optional, locally run suggestions validated by the same strict contract, stored as drafts, never deciding outcomes.

**Independent Test**: With a stub provider returning one valid, one malformed, one URL-bearing and one unsupported-action suggestion, only the valid one is accepted, as `draft` and marked AI; with no provider every other capability works (SC-015).

### Tests for User Story 8

- [X] T146 [P] [US8] `backend/tests/unit/securityLab/aiSuggestions.test.ts`: the four-suggestion stub case, rejection reasons named, invalid ones do not affect valid ones, accepted suggestions are `origin: ai`, `draft`, with model, confidence and assumptions recorded, `analysis-only` categories refused **Done:** Validator and parser units in tests/unit/securityLab/aiSuggestions.test.ts; the four-suggestion stub case runs through the route in tests/integration/securityLab/aiSuggest.test.ts.
- [X] T147 [P] [US8] `backend/tests/integration/securityLab/aiUnavailable.test.ts`: with no provider every non-AI route works and `POST /scenarios/suggest` returns `503 ai_unavailable` with the readiness reason (SC-015) **Done:** Implemented in tests/integration/securityLab/aiSuggest.test.ts (describe: with no usable AI). The injection-probe vocabulary in the prompt was narrowed to query parameters to match the validator.

### Implementation for User Story 8

- [X] T148 [P] [US8] Create `backend/src/securityLab/ai/suggestionPrompt.ts` (versioned prompt, `SECURITY_SUGGESTION_RESPONSE_VERSION = 1`, a snapshot test pinning the text per constitution XXIII)
- [X] T149 [P] [US8] Create `backend/src/securityLab/ai/parseSuggestionResponse.ts` (reuse `backend/src/ai/jsonResponseParsing.ts`; per-suggestion handling)
- [X] T150 [US8] Create `backend/src/securityLab/ai/validateSuggestion.ts` (reuse `validateScenario.ts`; reject URLs, hosts, header overrides, repeat over ceiling, unsupported actions, unknown operations or fields) (after T062)
- [X] T151 [US8] Create `backend/src/securityLab/ai/suggestScenarios.ts` through `getAIProvider()` only, storing accepted suggestions as `draft` via `scenarioService.ts`
- [X] T152 [US8] Add `POST /scenarios/suggest` to `backend/src/api/securityLab.ts` and the façade
- [X] T153 [US8] Add the Suggest control to `ScenariosArea.tsx` (disabled with the readiness reason when unavailable; results list of accepted and rejected with reasons) and the client, with a test **Done:** `SuggestPanel.tsx` and `suggestScenarios` in the client. Readiness comes from the existing `GET /api/ai/status` through `useAiStatus`; if that cannot be read the control stays usable and the server's 503 `ai_unavailable` is authoritative

**Checkpoint**: All eight stories complete.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, version, final validation

- [X] T154 [P] Update `README.md` (routes line adds `#/security`, `#/security/<area>`; a short Security Lab paragraph) and `docs/USER_MANUAL.md` (sidebar paragraph; a Security Lab section covering the four areas, categories and support levels, lifecycle, profiles and safety controls, what analysis can and cannot conclude, evidence and redaction, retention and the owner-cookie limitation, export, known limitations)
- [X] T155 [P] Update `docs/architecture.md` (Security Lab section: module layout, the two lifetimes and keys, destination policy, sender, versioned approval, finding model) and `docs/http-api.md` (all routes from [security-lab-api.md](contracts/security-lab-api.md))
- [X] T156 [P] Update `docs/configuration.md` and verify `.env.example` lists every `SECURITY_LAB_*` variable with its default; update `docs/status.md` (capabilities and limitations: limited and analysis-only categories, no token flows, no production targets, no AI evaluation corpus)
- [X] T157 [P] Add `frontend/tests/unit/securityLab/*Accessibility.test.tsx` coverage for any area not yet covered (keyboard paths, accessible names, visible focus, non-color status), and confirm light and dark themes and a 375 px width in the manual walkthrough **Done (automated part):** `OverviewArea.accessibility.test.tsx` and `ReportsArea.accessibility.test.tsx` added (Scenarios, Execution and Findings already had theirs; the Suggest and export panels are covered by the Scenarios and Reports tests). **Not run:** the light and dark theme and 375 px visual pass needs a person at a real browser; it is listed under T160 and "Not covered" in the roadmap entry
- [X] T158 Re-run `existingOutputsUnchanged.test.ts` and the full seeded-secret corpus; confirm 0 differences against the T003 baseline and 0 secrets (SC-009, SC-014) **Done:** both files pass (23 tests), with the snapshots from T003 unchanged
- [X] T159 Run `npm test`, `npm run lint` and `npm run build` from the repository root; fix every failure without weakening configuration or disabling tests; compare counts with the T002 baseline **Done:** lint and build exit 0. `npm test`: 567 files, 6,709 tests (6,697 passed, 11 skipped, 1 failed) against 4,965 passed, 11 skipped, 1 failed at baseline; the one failure is the same before and after (`packages/shared-domain/tests/unit/requestChain.test.ts`, expected 48 dynamic variables, got 50, from the user's uncommitted AP-056 follow-up, unrelated and left alone)
- [ ] T160 Run the manual walkthrough in [quickstart.md](quickstart.md) against `npm run security:stub -w backend`; state plainly in the roadmap entry anything not run (for example the visual pass) **Open, needs a human:** the walkthrough needs a real browser, which the implementing agent cannot drive. The same flows are covered by the automated tests against loopback sample targets (the quickstart's "Automated validation" table), and the roadmap entry 103 says plainly that the browser walkthrough and the visual pass were not run
- [X] T161 Add the `specs/ROADMAP.md` entry 103 in the established format (spec directory, the three clarifications, per-area behaviour, `Tests:` line with file and test counts, `Not covered:` including the missing AI evaluation corpus and any unrun manual step, and the version line)
- [X] T162 Bump the version to 19.60.0 in the root, backend, frontend and shared-domain `package.json` and the lockfile using the repository's `npm run version:bump` script (check `scripts/bump-version.mjs` for its arguments), and confirm `/api/version` reports it
- [X] T163 Final diff review against [plan.md](plan.md) "Definition of Done": no unrelated files, no secrets, constitution 3.3.0 and the mirror consistent, every contract's test obligations present. Leave every change uncommitted for the user to review **Done:** every changed path is within the feature's areas; a scan for key and token patterns found only a PEM header used as a leak-pattern example in `evaluation.test.ts`; constitution and its mirror are identical at 3.3.0; every named test obligation exists (`observationWording` and `generationScope` live inside `analysis.determinism.test.ts` and `generation.determinism.test.ts`/`scenarios.test.ts`). Nothing is committed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T003's test must exist and pass in the working tree (uncommitted, like everything else) before any code change so the baseline is meaningful; T004 and T005 may run alongside.
- **Foundational (Phase 2)**: depends on Setup; blocks every story. Order inside it: T008 → T009 → T012; T010 and T011 in parallel with T008; T013 after T010 and T012; T018 before T019 to T023; T027 to T029 before T030; T033 last.
- **US1 (Phase 3)** and **US2 (Phase 4)**: depend on Phase 2. US2 uses the analysis (T045) for generation.
- **US6 (Phase 5)**: depends on Phase 2 and T005; independent of US1 and US2 except that profile editing in the UI sits in the Execution area shell.
- **US3 (Phase 6)**: depends on US2 (approved versions to run) and US6 (profiles, destination policy).
- **US4 (Phase 7)**: its pure modules (T113 to T117) depend only on Phase 2 types and can start with US3; T118 to T121 need US3's run service.
- **US5 (Phase 8)**: depends on US1 to US4 for real data; T129 to T132 can start once the repositories (T019 to T021) exist.
- **US7 (Phase 9)**: depends on US2 (approved versions) and T011; independent of execution.
- **US8 (Phase 10)**: depends on US2 (validator, service).
- **Polish (Phase 11)**: after all desired stories.

### User Story Dependencies

- US1: none beyond Foundational. US2: reads the analysis from US1. US6: none beyond Foundational. US3: US2 and US6. US4: US3 for wiring (pure parts independent). US5: reads everything. US7: US2. US8: US2.

### Within Each Story

- Tests first and failing; then pure modules; then services and persistence; then routes; then frontend components; then area composition.

### Parallel Opportunities

- Phase 1: T004 to T007. Phase 2: T010, T011, T014, T015, T016, T019 to T023, T027 to T029, T031, T032.
- US1: all tests T034 to T037; rules T039 to T044. US2: tests T050 to T057; rules T063 to T069; components T075 and T076.
- US6: T080 to T082; T084 beside T083. US3: T089 to T093; T095, T097, T098; T103 to T105.
- US4: T108 to T112; T113, T116, T117; T122 and T123. US5: T125 to T128. US7: T137 to T139; T140 and T141. US8: T146 to T149.
- Different stories can proceed in parallel after Phase 2 where the dependencies above allow (for example US1, US2 and US6 together).

---

## Parallel Example: User Story 2

```bash
# Tests together:
Task: "scenarioValidation.test in backend/tests/unit/securityLab/scenarioValidation.test.ts"
Task: "scenarioIdentity.test in backend/tests/unit/securityLab/scenarioIdentity.test.ts"
Task: "generationRules.test in backend/tests/unit/securityLab/generationRules.test.ts"
Task: "reviewStateMachine and approvalBinding tests in backend/tests/unit/securityLab/"

# Generation rules together (after T062):
Task: "rules/authentication.ts"
Task: "rules/authorization.ts and bola.ts"
Task: "rules/objectProperty.ts and inputValidation.ts"
Task: "rules/resourceConsumption.ts and sensitiveDataExposure.ts"
```

---

## Implementation Strategy

### MVP First (US1, then US2)

1. Phase 1 and Phase 2, including the baseline (T003) and the spikes (T004, T005).
2. Phase 3 (US1): a faithful, deterministic security analysis. **Stop and validate** against the fixtures.
3. Phase 4 (US2): reviewed, approved scenarios. The MVP delivers analysis and a reviewed scenario set, with nothing sent to any target, which is the lowest-risk useful increment.

### Incremental Delivery

1. Add US6 then US3 (profiles, then the guarded run): the first slice that sends requests. Review constitution 3.3.0 (T001) before merging it.
2. Add US4 (evaluation and findings), then US5 (Overview, reports, retained data).
3. Add US7 (export) and US8 (AI suggestions) last; each is independent and the feature is complete without US8.
4. Polish: documentation, version, validation.

### Parallel Team Strategy

After Phase 2: one developer on US1 then US5 reads, one on US2 then US7 and US8, one on US6 then US3 then US4.

---

## Notes

- [P] tasks touch different files and depend on no incomplete task
- Every story is independently testable at its checkpoint; US3 uses a stub evaluator until T120
- Verify tests fail before implementing; run the smallest relevant tests after each task
- Do not weaken lint, type or test configuration; do not disable tests (CLAUDE.md §55)
- Do not commit; the user reviews first
- Avoid: vague tasks, same-file conflicts between parallel tasks, cross-story dependencies not listed above
