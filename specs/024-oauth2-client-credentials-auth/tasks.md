---

description: "Task list template for feature implementation"
---

# Tasks: OAuth2 Client-Credentials Auth Support for Postman Export

**Input**: Design documents from `/specs/024-oauth2-client-credentials-auth/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (D1-D9), [data-model.md](./data-model.md), [contracts/oauth2-client-credentials.md](./contracts/oauth2-client-credentials.md), [quickstart.md](./quickstart.md)

**Tests**: Included — this repository's testing philosophy (`.claude/CLAUDE.md` §51-53) treats tests as part of the feature, and quickstart.md names the exact test files each story must extend. Tests are added alongside their implementation task, not as a separate upfront TDD gate (not explicitly requested).

**Organization**: Tasks are grouped by user story (US1/US2/US3, per spec.md) so each can be implemented and verified independently, in priority order.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on an incomplete task)
- **[Story]**: Maps the task to US1, US2, or US3
- Every task names its exact file path

## Path Conventions

Existing npm-workspaces monorepo — no new project/workspace. Paths are `packages/shared-domain/src/`, `backend/src/`, `backend/tests/`, per plan.md's Project Structure.

---

## Phase 1: Setup

No new project, dependency, or tooling is introduced (plan.md Technical Context: Newman is already a backend dependency; no new npm package). Setup is limited to confirming the shared test fixtures every later phase reuses exist and are extended once, up front.

- [ ] T001 Extend `backend/tests/fixtures/postman/credentialFixtures.ts` and `backend/tests/fixtures/postman/exportFixtures.ts` with a minimal `SecuritySchemeDefinition`/`ApiModel` fixture declaring one `oauth2` scheme with `flows.clientCredentials.tokenUrl` and a `scopes` object, and one operation requiring it — mirroring the existing `bearer`/`apiKey` fixture shape (quickstart.md Prerequisites)
- [ ] T002 [P] Extend `backend/tests/fixtures/execution/targetServer.ts` with a mock token-endpoint route (reachable-success and unreachable/rejecting variants) for the token-fetch execution tests added in Phase 5 (quickstart.md, User Story 2 failure path)

**Checkpoint**: Fixtures exist for every later phase's tests to import.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared-domain type additions and OpenAPI-extraction change every user story reads from. No story-specific classification or provisioning logic can compile or be tested correctly until this phase is done.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 [P] Add optional `flows?: { clientCredentials?: { tokenUrl: string; scopes: string[] } }` to `SecuritySchemeDefinition` in `packages/shared-domain/src/apiModel.ts` (data-model.md, FR-001)
- [ ] T004 [P] Add the additive `{ type: "oauth2"; oauth2: PostmanAuthAttribute[] }` member to the `PostmanAuth` union in `packages/shared-domain/src/postmanArtifact.ts` (data-model.md, FR-003)
- [ ] T005 Extend `extractSecuritySchemes` in `backend/src/openapi/buildApiModel.ts` to read `flows.clientCredentials.tokenUrl` (only when a non-empty string) and derive `scopes` as `Object.keys(...)` in declaration order, omitting `flows` entirely when no `clientCredentials` flow is declared (depends on T003; research.md D1)
- [ ] T006 Extend `backend/tests/unit/openapi/buildApiModel.test.ts`: a scheme with `flows.clientCredentials.tokenUrl`/`scopes` extracts verbatim; a scheme with only `authorizationCode`/`implicit`/`password` gets no `flows` field at all; an empty `scopes: {}` yields `scopes: []` (depends on T005)

**Checkpoint**: `ApiModel.securitySchemes` now carries `flows` wherever declared. Every user story phase below can proceed.

---

## Phase 3: User Story 1 - OAuth2 Client-Credentials Scheme Is Recognized, Not Flagged Unsupported (Priority: P1) 🎯 MVP

**Goal**: A specification declaring an OAuth2 `clientCredentials` scheme stops being reported as `unsupported-auth-scheme` and gets real credential variables and a distinct `oauth2` `PostmanAuth` block instead.

**Independent Test**: Export an approved scenario set for a spec whose only scheme is OAuth2 `clientCredentials`. Confirm no `unsupported-auth-scheme` limitation, and the environment provisions `clientId`/`clientSecret`/`accessToken` (empty placeholders) instead of only `baseUrl`.

### Implementation for User Story 1

- [ ] T007 [US1] Extend `classifySchemeType` in `backend/src/postman/authMapping.ts`: `type === "oauth2" && flows?.clientCredentials !== undefined` → `"oauth2"`; an oauth2 scheme with no `clientCredentials` flow still returns `undefined` (data-model.md, FR-001)
- [ ] T008 [US1] Add the `{ type: "oauth2"; isPrimary; stem; variableNames: { clientId, clientSecret, accessToken } }` member to `SchemeVariablePlanEntry` in `backend/src/postman/authMapping.ts`, and extend `buildPlanEntry`'s naming rule so the primary oauth2 scheme gets `clientId`/`clientSecret`/`accessToken` and any additional, distinctly-keyed one gets `<stem>ClientId`/`<stem>ClientSecret`/`<stem>AccessToken` (depends on T007; data-model.md, FR-002; reuses specs/021's naming convention)
- [ ] T009 [US1] Extend `buildAuthMapping` in `backend/src/postman/authMapping.ts` to emit `{ type: "oauth2", oauth2: [{key:"accessToken", value:"{{<accessToken var>}}"}, {key:"addTokenTo", value:"header"}, {key:"tokenType", value:"bearer"}] }` for a consuming operation, and to declare the `clientId`/`clientSecret`/`accessToken` variables via `credentialVariable(...)` (depends on T008; data-model.md, FR-002/FR-003)
- [ ] T010 [P] [US1] Add `"clientId" | "clientSecret" | "accessToken"` to `ArtifactCredentialName` and their `CREDENTIAL_PURPOSE` entries in `backend/src/postman/artifactVariables.ts` (depends on T004; research.md D8)
- [ ] T011 [US1] Add `if (entry.type === "oauth2") continue;` to `findCredentialProducers` in `backend/src/postman/credentialProducers.ts` (depends on T008; research.md D3)
- [ ] T012 [US1] Add `if (entry.type === "oauth2") continue;` to `unresolvedCredentialProducerLimitations` in `backend/src/postman/generateCollection.ts` (depends on T008; research.md D3)
- [ ] T013 [P] [US1] Extend `backend/tests/unit/postman/authMapping.test.ts`: oauth2 classification, the emitted `PostmanAuth` oauth2 shape, and primary vs. stem-prefixed variable naming (depends on T009)
- [ ] T014 [P] [US1] Extend `backend/tests/unit/postman/credentialProducers.test.ts`: an oauth2 plan entry never appears in `findCredentialProducers`' output (depends on T011)
- [ ] T015 [US1] Extend `backend/tests/unit/postman/generateCollection.test.ts`: exporting the T001 fixture records no `unsupported-auth-scheme` and no `unresolved-credential-producer` limitation for the oauth2 scheme, and `environment.values` includes `clientId`/`clientSecret`/`accessToken` (all `type: "secret"`, empty value) alongside `baseUrl` (depends on T009, T012; SC-001, SC-002)

**Checkpoint**: User Story 1 is independently functional — exporting the fixture now correctly labels and provisions the scheme, even before any token-fetch automation exists.

---

## Phase 4: User Story 2 - The Exported Collection Authenticates Without a Manual Token-Paste Step (Priority: P1)

**Goal**: The export synthesizes one token-fetch request per required OAuth2 scheme, positioned to run first, and this app's own execution engine can run it without throwing.

**Independent Test**: Supply real `clientId`/`clientSecret` for the scheme and point `tokenUrl` at a reachable mock server. Run the exported collection; confirm the token-fetch request runs first and every dependent request's Authorization header carries a real value with no manual step.

### Implementation for User Story 2

- [ ] T016 [P] [US2] Add `itemIdForOAuth2TokenFetch(schemeKey: string): string` to `backend/src/postman/identifiers.ts`, reusing the existing `digest`/`toUuid`/`ITEM_NAMESPACE` pattern with a literal `oauth2-token-fetch:` prefix (research.md D7)
- [ ] T017 [US2] Create `backend/src/postman/oauth2TokenFetch.ts` exporting `buildOAuth2SetupFolders(requiredOperations, securitySchemes, plan)`: for each scheme key where `plan.get(key)?.type === "oauth2"` and at least one required operation's first security requirement is that scheme, build one `PostmanRequestItem` (`POST` to `tokenUrl` resolved against `{{baseUrl}}` when relative; `auth: {type:"basic", basic:[username=clientId var, password=clientSecret var]}`; `raw` body `grant_type=client_credentials[&scope=...]` with `Content-Type: application/x-www-form-urlencoded`; a test-script event that sets the access-token variable from the response's `access_token` field without throwing on failure; `id` from T016; no `provenance`) wrapped in one `"OAuth2 Token Setup"` folder, items sorted by scheme key; returns `[]` when no scheme qualifies (depends on T009, T016; data-model.md, FR-004/FR-004a/FR-004c/FR-005)
- [ ] T018 [US2] In `generateCollection.ts`, compute `oauth2SetupFolders` via T017 and prepend them (unconditionally — never gated by `ExportOptions.disableAutomaticChaining`) before `[...workflowFolders, ...standaloneFolders].sort(...)` (depends on T017; research.md D5; FR-008)
- [ ] T019 [US2] In `backend/src/execution/runExecution.ts`, change the per-item loop so that when `item.provenance?.scenarioId === undefined`, the item is run via `runSingleItem` for its side effect on the environment record and the loop continues without calling `mapNewmanResult`/`appendResult` or throwing; the existing throw is preserved unchanged when a `scenarioId` is present but does not resolve (research.md D6)
- [ ] T020 [P] [US2] Create `backend/tests/unit/postman/oauth2TokenFetch.test.ts`: folder/item shape, basic-auth credentials reference the correct variables, body content (with and without scopes), relative-`tokenUrl` resolution against `{{baseUrl}}`, deterministic `id`/ordering across repeated calls, and the "no qualifying operation → empty array" case (depends on T017)
- [ ] T021 [US2] Extend `backend/tests/unit/postman/generateCollection.test.ts`: the exported `collection.item[0]` is the OAuth2 setup folder containing exactly one request per required scheme; deselecting the only scenario requiring the scheme produces no token-fetch item at all; re-exporting the same input twice is byte-identical; exporting with `ExportOptions.disableAutomaticChaining: true` still includes the OAuth2 setup folder unchanged (depends on T018; SC-002, FR-007, FR-008, SC-005)
- [ ] T022 [P] [US2] Extend `backend/tests/unit/postman/readme.test.ts`: the generic coverage/variables rendering lists the new folder and `clientId`/`clientSecret`/`accessToken` variables with no code change to `readme.ts` (depends on T018)
- [ ] T023 [P] [US2] Re-run `backend/tests/unit/postman/noNetwork.test.ts` unmodified and confirm it still passes — `generateCollection()` issues zero `fetch`/`http`/`https` calls even though this feature's output will make a real call, but only later, at execution time (depends on T018; research.md D9)
- [ ] T024 [US2] Extend `backend/tests/integration/execution/executionRuns.test.ts`: using T002's mock token endpoint, an approved scenario set requiring the oauth2 scheme runs the token-fetch item first without throwing and without its own `RequestResult`, and the dependent request's Authorization header carries the fetched token; a second test points `tokenUrl` at the unreachable/rejecting mock and confirms the run completes with the dependent request's own `RequestResult` failing authentication, with no retry and no fallback credential (depends on T019, T021; User Story 2 Acceptance Scenarios 1-4, FR-004b)

**Checkpoint**: User Stories 1 and 2 both work independently — the export is fully labeled and now authenticates automatically end-to-end.

---

## Phase 5: User Story 3 - Non-Automatable OAuth2 Flows Keep Today's Honest Limitation (Priority: P2)

**Goal**: Confirm zero regression — a scheme whose only flow(s) are `authorizationCode`, `implicit`, or `password` still produces today's `unsupported-auth-scheme` limitation, unchanged.

**Independent Test**: Export a spec declaring an OAuth2 scheme with only `authorizationCode` (or `implicit`, or `password`). Confirm `unsupported-auth-scheme` is still recorded for every operation requiring it.

### Implementation for User Story 3

- [ ] T025 [P] [US3] Extend `backend/tests/unit/postman/authMapping.test.ts`: `classifySchemeType` returns `undefined` for an oauth2 scheme whose `flows` has no `clientCredentials` member (`authorizationCode`/`implicit`/`password`-only) (depends on T007; SC-004)
- [ ] T026 [US3] Extend `backend/tests/unit/postman/generateCollection.test.ts`: exporting a fixture with an `authorizationCode`-only (and separately, a `password`-only) OAuth2 scheme still records `unsupported-auth-scheme` for every operation requiring it, identically to pre-feature behavior (depends on T012, T018; User Story 3 Acceptance Scenarios 1-2, SC-004)

**Checkpoint**: All three user stories are independently verified — the non-regression guarantee holds alongside the new capability.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Repository-wide validation and the real-spec check the feature was originally motivated by.

- [ ] T027 Re-run the real-spec diagnostic pipeline (build ApiModel → generate TestModel → generate collection) against `backend/tests/fixtures/openapi/paypal-invoicing-v2.yaml` and confirm 0 of 22 operations report `unsupported-auth-scheme` for the `Oauth2` scheme (down from 22/22), with `collection.item[0]` the OAuth2 setup folder (quickstart.md, Real-Spec Validation)
- [ ] T028 Run `npm run test -w backend -- tests/unit/openapi/buildApiModel.test.ts tests/unit/postman/authMapping.test.ts tests/unit/postman/credentialProducers.test.ts tests/unit/postman/oauth2TokenFetch.test.ts tests/unit/postman/generateCollection.test.ts tests/unit/postman/noNetwork.test.ts tests/unit/postman/readme.test.ts tests/integration/execution/executionRuns.test.ts` and confirm all pass (quickstart.md Focused Automated Checks)
- [ ] T029 [P] Run `npm run test -w backend`, `npm run test -w frontend`, `npm run lint`, and `npm run build` from the repository root and confirm all pass, with every pre-existing `bearer`/`basic`/`apiKey` auth-mapping test (specs 007/021/023) and every pre-existing execution test (spec 018) unchanged (quickstart.md Validation Commands Before Handoff)
- [ ] T030 Submit the HTTP contract check from quickstart.md against a running backend (`POST /api/test-models/postman-collection` with an oauth2-declaring request) and manually verify the response fields listed in [contracts/oauth2-client-credentials.md](./contracts/oauth2-client-credentials.md) §4

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001 fixture is used by later tests, but T003-T006 have no code dependency on it) — BLOCKS every user story.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational **and** User Story 1 (T009's oauth2 `PostmanAuth`/variable plan is a prerequisite for the token-fetch item's credential references and for the consuming request's auth block).
- **User Story 3 (Phase 5)**: Depends on Foundational only — can run in parallel with Phase 3/4, since it only verifies the classification "else" branch T007 already leaves unchanged.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Shared-domain/backend logic before its own unit tests.
- `authMapping.ts` changes (T007-T009) before anything that reads its output (`credentialProducers.ts`, `generateCollection.ts`, `oauth2TokenFetch.ts`).
- `oauth2TokenFetch.ts` (T017) before the `generateCollection.ts` folder-composition change (T018) and before `runExecution.ts`'s integration test (T024).

### Parallel Opportunities

- T003 and T004 (different shared-domain files) run in parallel.
- T010, T013, T014 (different files, once their single dependency lands) run in parallel with each other.
- T016 has no dependency on T007-T015 and can start as soon as Foundational is done.
- T020, T022, T023 (different test files) run in parallel once T017/T018 land.
- T025 can start as soon as T007 lands, independent of Phase 4's progress.

---

## Parallel Example: User Story 1

```bash
# Once T007-T009 land:
Task: "Add clientId/clientSecret/accessToken to ArtifactCredentialName in backend/src/postman/artifactVariables.ts"
Task: "Extend backend/tests/unit/postman/authMapping.test.ts for oauth2 classification and naming"
Task: "Extend backend/tests/unit/postman/credentialProducers.test.ts for oauth2 exclusion"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (User Story 1).
3. **STOP and VALIDATE**: export the fixture, confirm no `unsupported-auth-scheme` limitation and the three new environment variables — this alone already closes the gap the PayPal validation pass surfaced (a labeled, provisionable scheme), even before automation.

### Incremental Delivery

1. Setup + Foundational → shared types and extraction ready.
2. User Story 1 → scheme correctly classified and provisioned (MVP).
3. User Story 2 → the export authenticates automatically end-to-end (the clarification session's actual target).
4. User Story 3 → regression guard confirmed (can be verified any time after Foundational).
5. Polish → real-spec validation and full repository checks before handoff.
