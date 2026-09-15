---

description: "Task list for 023-auto-auth-credential-chaining"
---

# Tasks: Automatic Auth-Credential Chaining

**Input**: Design documents from `/specs/023-auto-auth-credential-chaining/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auth-credential-chaining.md, quickstart.md

**Tests**: Included — this is deterministic domain logic with explicit-failure and no-fabrication
requirements (FR-004, constitution XIV, XIX, XXI); every existing sibling module in
`backend/src/postman/` has a corresponding test file, and this feature follows the same
convention.

**Organization**: Tasks are grouped by user story (spec.md). US1 (P1) delivers the core mechanism —
a token from a login endpoint reaching every operation that declares the matching scheme — and is
independently shippable. US2 (P2) proves the mechanism isolates two distinct schemes from each
other. US3 (P3) proves every ambiguous case falls back to the existing limitation instead of
guessing. Each is independently testable once the Foundational phase is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps the task to US1, US2, or US3
- File paths are exact and repository-relative

## Path Conventions

Existing monorepo layout — no new project or workspace:
`packages/shared-domain/src/`, `backend/src/postman/`, `backend/src/dependencies/`,
`backend/tests/unit/postman/`, `backend/tests/integration/`, `backend/tests/fixtures/postman/`.
No `frontend/` change (contracts/auth-credential-chaining.md §3).

---

## Phase 1: Setup

**Purpose**: Create fixture data this feature's tests need, without touching any existing fixture
or behavior.

- [X] T001 [P] Extend `backend/tests/fixtures/postman/credentialFixtures.ts` with builder
      functions: (a) an unauthenticated `POST /auth/token` (`operationId: "issueToken"`) under the
      primary `bearerAuth` scheme, whose 2xx response documents exactly one string field (e.g.
      `token`) — the flagship producer; (b) a consumer operation `GET /auth/token-info` declaring
      `security: [{ bearerAuth: [] }]`; (c) a producer-response variant with two string fields
      (`token`, `refreshToken`) for the ambiguous-field case; (d) a producer-response variant with
      zero string fields (e.g. only a boolean `success` field); (e) a second, distinctly-keyed
      scheme `adminAuth` with its own unauthenticated producer `POST /auth/admin-login`
      (`operationId: "adminLogin"`, stem-matching) and its own consumer operation; (f) a
      primary-scheme variant whose login endpoint's path/`operationId` does **not** contain the
      scheme key's stem (e.g. scheme key `bearerAuth`, endpoint `POST /session`, `operationId:
      "createSession"`); (g) a `http`/`basic` scheme with its own consumer operation, for the
      never-chains case; (h) a mixed-producer-group variant (research.md D7): the T001a producer's
      response field (`token`) is *also* supplied directly as a `CONFIRMED` `"path"`-location
      `ApiDependencyRelationship` in the fixture graph (e.g. matching some other operation's `token`
      path parameter by ordinary name-based matching), so the same producer field simultaneously
      qualifies as an auth-credential producer and a path-parameter producer.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contract and scaffolding changes every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Extend `DependencyFieldLocation` in `packages/shared-domain/src/apiDependency.ts` to
      `"path" | "query" | "header" | "body" | "auth"` (FR-001, data-model.md §1). Additive only; no
      other type in the file changes.
- [X] T003 [P] In `backend/src/postman/assertionScripts.ts`, add an optional
      `finalVariableName?: string` field to `WorkflowExtraction`, and update `extractionLines` to
      use `extraction.finalVariableName ?? workflowVariableName(extraction.workflowId,
      extraction.variableName)` as the variable passed to `pm.environment.set(...)` (research.md
      D6, data-model.md). Every existing call site omits the field and is byte-for-byte unaffected.
- [X] T004 [P] In `backend/src/postman/credentialProducers.ts`, remove the `if (entry.isPrimary)
      continue;` line from `findCredentialProducers` so every plan entry (primary and non-primary
      alike) is searched with the identical, unchanged stem-match heuristic; the
      `entry.type === "basic"` skip is unchanged (Clarifications 2026-09-15 Q1/Q3, FR-002,
      FR-002a, data-model.md). (Depends on T002 only insofar as the file imports
      `SchemeVariablePlanEntry`, unaffected by T002 — no functional dependency.)
- [X] T005 [P] Create `backend/src/postman/authCredentialRelationships.ts` with the
      `buildAuthCredentialRelationships(operations, credentialProducers)` stub from data-model.md
      (imports `ApiDependencyRelationship`, `ApiOperation`, `CredentialProducerCandidate` from
      `@apipilot/shared-domain` and `producerFieldSchemas` from `../dependencies/fieldExtraction`;
      returns `[]` unconditionally for now — no matching logic yet). (Depends on T002.)
- [X] T006 In `backend/src/postman/automaticChaining.ts`: add `credentialVariableNames:
      ReadonlyMap<string, string>` to `AutomaticChainingInput`; widen `isEligibleRelationship`'s
      location check to `if (relationship.consumer.location !== "path" &&
      relationship.consumer.location !== "auth") return false;`; add a new function
      `findAuthConsumerTargets(standaloneResolved)` returning one `ConsumerTarget` per
      `{scenario, operation}` pair whose `operation.security.length > 0`, keyed by
      `operation.security[0]?.schemes[0]?.name` (research.md D4, data-model.md) — implemented in
      full now since it is small and pure, but not yet wired into `planAutomaticChains`. (Depends
      on T002.)
- [X] T007 In `backend/src/postman/generateCollection.ts`, reorder computation so
      `planSchemeVariables(apiModel.securitySchemes)` and `findCredentialProducers(apiModel.
      operations, plan)` run *before* `planAutomaticChains` is called (today they run after, at
      lines ~324-325); thread the resulting `plan`/`credentialProducers` into a new (currently
      empty-returning) `buildAuthCredentialRelationships` call and pass `credentialVariableNames:
      new Map()` as a placeholder into `planAutomaticChains`'s input; keep the existing later
      `authByOperation` call working unchanged by having it accept the precomputed `plan` instead
      of recomputing it. No observable behavior change yet (relationships list stays empty).
      (Depends on T004, T005, T006.)

**Checkpoint**: `npm run build`, `npm run lint`, and the existing test suite all pass unchanged —
no observable behavior change yet.

---

## Phase 3: User Story 1 - A Token Obtained From Login Reaches Every Request That Needs It (Priority: P1) 🎯 MVP

**Goal**: A bearer token (or API key) obtained from an unauthenticated operation's response is
captured and substituted into every operation's Authorization configuration that declares the
matching scheme — including the *primary/default* scheme, not only a secondary one.

**Independent Test**: Export the T001a/b fixture (an unauthenticated `POST /auth/token` whose
response documents exactly one string field, plus `GET /auth/token-info` declaring `bearerAuth`)
with an approved positive scenario for both operations; verify the producing request's test script
captures the field into `{{token}}`, the consuming request's `auth.bearer` value resolves to
`{{token}}` unchanged, and no `unresolved-credential-producer` limitation is recorded for
`bearerAuth`.

### Tests for User Story 1

> Write these first; confirm they fail against the Foundational-phase stubs before implementing.

- [X] T008 [P] [US1] Unit tests in `backend/tests/unit/postman/authCredentialRelationships.test.ts`:
      `buildAuthCredentialRelationships` — (a) a producer candidate with exactly one string-typed
      response field and one consumer operation yields one `CONFIRMED`, `deterministic`
      relationship with `consumer: {location: "auth", field: schemeKey}`; (b) multiple consumer
      operations declaring the same scheme yield one relationship per consumer (fan-out); (c) works
      identically for a *primary* scheme candidate (T004's newly-included case), not only a
      secondary one; (d) a non-string response field (e.g. a boolean or number) is never selected as
      the producer field.
- [X] T009 [P] [US1] Unit tests in `backend/tests/unit/postman/credentialProducers.test.ts`: extend
      for primary-scheme discovery — (a) T001a's primary-scheme login endpoint (path/`operationId`
      contains the scheme's stem) yields one candidate; (b) T001f's primary-scheme login endpoint
      (stem absent from path/`operationId`) yields no candidate; (c) a `http`/`basic` scheme (T001g)
      never yields a candidate even though it is primary.
- [X] T010 [P] [US1] Unit tests in `backend/tests/unit/postman/automaticChaining.test.ts`: (a) an
      `"auth"`-location `CONFIRMED` relationship with an approved positive producer scenario and an
      approved consumer scenario is applied — the resulting `AutomaticChain.variableName` equals the
      scheme's plan-resolved credential variable name (e.g. `"token"`), never a
      `workflowVariableName`-derived name; the corresponding `WorkflowExtraction.finalVariableName`
      matches it; and the consumer scenario's `request` object is unchanged (`applyWorkflowSubstitutions`
      is never invoked) (research.md D5/D6); (b) the FR-015 ordering guard declines an auth chain
      when the consumer's rank precedes the producer's, exactly as for a path-parameter chain; (c)
      `AutomaticChainingInput.disabled: true` (mirroring `ExportOptions.disableAutomaticChaining`)
      disables auth chaining too — no second flag exists (FR-008); (d) T001h's mixed-producer-group
      fixture yields **two** independent chains sharing the same producer field — one `"path"` chain
      with its usual `workflowVariableName`-derived variable, one `"auth"` chain with the scheme's
      credential variable name — never one merged chain with a single, ambiguous variable name
      (research.md D7).
- [X] T011 [P] [US1] Integration test in `backend/tests/integration/postmanCollection.test.ts`:
      exporting the T001a/b fixture over HTTP (with `workflowContext.automaticChaining` present)
      produces `POST /auth/token`'s request `event` with a test script that sets `token` directly
      (not a chain-derived name), `GET /auth/token-info`'s `auth.bearer` value unchanged at
      `{{token}}`, no `unresolved-credential-producer` limitation for `bearerAuth`, and
      `summary.automaticChainCount` incremented by one.

### Implementation for User Story 1

- [X] T012 [US1] Implement `buildAuthCredentialRelationships` fully in
      `backend/src/postman/authCredentialRelationships.ts` per data-model.md: for each
      `CredentialProducerCandidate`, look up its operation, call `producerFieldSchemas` (reused
      unmodified from `../dependencies/fieldExtraction`) on it, filter to fields with
      `schema.type === "string"`; when exactly one qualifies, build one `ApiDependencyRelationship`
      (`confidence: "CONFIRMED"`, `source: "deterministic"`, research.md D2) per operation in
      `operations` whose `operation.security[0]?.schemes[0]?.name === candidate.schemeKey`, with
      `consumer: {operationPath, operationMethod, field: candidate.schemeKey, location: "auth"}`,
      `id: relationshipId(producer, consumer)` (reused unmodified from
      `../dependencies/identifiers`, same as `deterministicMatching.ts`), and `explanation` set to a
      human-readable sentence naming the scheme, producer operation/field, and consuming operation
      (data-model.md — `evidence`/`aiCorroboration` stay `undefined`, this relationship kind carries
      neither). Zero or 2+ qualifying fields yields no relationships for that scheme. (Depends on
      T005, T004.)
- [X] T013 [US1] In `backend/src/postman/automaticChaining.ts`: merge `findAuthConsumerTargets`
      (T006) output into `targetsByKey` inside `planAutomaticChains`; extend `producerGroups`
      grouping so relationships sharing a producer field but differing in `consumer.location`
      (`"path"` vs `"auth"`) form separate groups, never merged (research.md D7); in
      `applyChainGroup`, branch on `relationships[0].consumer.location`: for `"path"`, keep today's
      `applyWorkflowSubstitutions` behavior unchanged; for `"auth"`, skip
      `applyWorkflowSubstitutions` entirely (no scenario mutation, research.md D5), set
      `AutomaticChain.variableName` and the extraction's `finalVariableName` to
      `input.credentialVariableNames.get(first.producer.field)` instead of
      `workflowVariableName(chainId, first.producer.field)` (research.md D6). (Depends on T006,
      T003.)
- [X] T014 [US1] In `backend/src/postman/generateCollection.ts`: replace the Foundational-phase
      placeholder (T007) — call `buildAuthCredentialRelationships(auth.operations,
      credentialProducers)` and merge its output into the relationships array passed to
      `planAutomaticChains`'s `graph`; build `credentialVariableNames` as a `Map<string, string>`
      from `plan`'s `bearer`/`apiKey` entries (`entry.variableNames.token`/`.apiKey`; `basic`
      entries excluded) and pass it as `AutomaticChainingInput.credentialVariableNames`. (Depends on
      T007, T012, T013.)

**Checkpoint**: User Story 1 is fully functional and testable independently — T008–T011 pass.

---

## Phase 4: User Story 2 - A Distinct (e.g. Second) Credential Chains Independently (Priority: P2)

**Goal**: When a specification declares more than one distinctly-keyed security scheme, each
scheme's credential is captured and chained independently, with zero cross-scheme leakage.

**Independent Test**: Export a spec declaring `bearerAuth` and `adminAuth` (T001a/b + T001e), each
with its own producer and consumers; verify two independent chains are recorded, each populating
only its own scheme's variable (`token` vs. `adminToken`).

### Tests for User Story 2

- [X] T015 [P] [US2] Unit test in `backend/tests/unit/postman/authCredentialRelationships.test.ts`:
      given two distinctly-keyed schemes each with their own unique producer and consumers,
      `buildAuthCredentialRelationships` returns relationships whose `producer`/`consumer.field`
      never mix across the two schemes (SC-002).
- [X] T016 [P] [US2] Integration test in `backend/tests/integration/postmanCollection.test.ts`:
      exporting the combined `bearerAuth` + `adminAuth` fixture (T001a/b/e) over HTTP results in two
      independent chains — `bearerAuth`'s consumers reference and receive only `{{token}}}`,
      `adminAuth`'s only `{{adminToken}}` — with zero cross-scheme leakage.

### Implementation for User Story 2

- [X] T017 [US2] Verify T012/T013's per-producer-field grouping isolates the two schemes correctly
      against T015/T016 (expected: no code change, since each scheme's producer operation/field is
      already distinct, and `resolveProducerDisambiguation` keys by consumer, not scheme); fix
      anything the tests reveal. (Depends on T012, T013, T015, T016.)

**Checkpoint**: User Stories 1 and 2 both work independently — T008–T011 and T015–T016 pass.

---

## Phase 5: User Story 3 - Ambiguity Is Reported, Never Guessed (Priority: P3)

**Goal**: When the producer operation or its credential field cannot be uniquely identified — for
any scheme, including the primary one — the existing `unresolved-credential-producer` limitation is
recorded exactly as today, and no chain is fabricated.

**Independent Test**: Export a spec where a scheme's producer candidate documents two equally
plausible string fields (T001c), or zero plausible fields (T001d), or has no stem-matching
candidate at all (T001f); verify no chain is created and the limitation is recorded for each case.

### Tests for User Story 3

- [X] T018 [P] [US3] Unit tests in `backend/tests/unit/postman/generateCollection.test.ts`: extend
      `unresolvedCredentialProducerLimitations` coverage — (a) T001f's primary scheme with no
      stem-matching producer records the limitation (previously exempt as primary); (b) T001c's
      two-plausible-field producer records the limitation and no relationship/chain exists for that
      scheme; (c) T001d's zero-plausible-field producer records the limitation; (d) the existing
      two-equally-plausible-unauthenticated-operations case (specs/021) still records the
      limitation unchanged.
- [X] T019 [P] [US3] Integration test in `backend/tests/integration/postmanCollection.test.ts`: each
      of T001c/d/f, exported over HTTP, produces exactly one `unresolved-credential-producer`
      limitation for the affected scheme and no automatic chain.

### Implementation for User Story 3

- [X] T020 [US3] In `backend/src/postman/generateCollection.ts`'s
      `unresolvedCredentialProducerLimitations`: remove the `entry.isPrimary` skip; redefine the
      "resolved" scheme-key set from the schemes actually present among
      `buildAuthCredentialRelationships`'s output (field-level resolution, research.md D3) instead
      of from `credentialProducers` alone (operation-level) — so a discovered-but-field-ambiguous
      producer still falls through to the limitation. Message wording and per-scheme reporting
      cadence are unchanged. (Depends on T014.)

**Checkpoint**: All three user stories are independently functional — T008–T011, T015–T016, and
T018–T019 all pass.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide guarantees and validation that span all three stories.

- [X] T021 [P] Extend `backend/tests/unit/postman/determinism.test.ts` and
      `backend/tests/unit/postman/reexportStability.test.ts` with an auth-credential-chaining case
      (T001a/b): repeated exports of the same inputs produce byte-identical relationships, chains,
      and limitations (SC-004, constitution XVI/XXIV).
- [X] T022 [P] Update `ExportSummary.automaticChainCount`'s doc comment in
      `packages/shared-domain/src/postmanArtifact.ts` to note it also counts auth-credential
      consumers resolved via an automatic chain, not only path parameters (contracts/
      auth-credential-chaining.md §2). Also fix the misleading rendered line this doc comment
      describes: `backend/src/postman/readme.ts:54`'s `` `- Automatically chained path parameters:
      ${summary.automaticChainCount}` `` becomes inaccurate once the same counter includes
      auth-credential consumers — reword to `` `- Automatically chained requests:
      ${summary.automaticChainCount}` `` (or similarly generic wording), and add a case to
      `backend/tests/unit/postman/readme.test.ts` asserting the rendered Coverage section never
      claims "path parameters" when the export's chains include an auth-credential consumer
      (found during `/speckit-analyze`: the summary line was otherwise the only place in the
      pipeline still hard-coding a path-parameter-only description of this counter).
- [X] T023 Run quickstart.md's focused checks, then the full repository validation commands (`npm
      run build`, `npm run lint`, `npm test`) from the repository root; fix any fallout before
      considering the feature complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
  - US1 has no dependency on US2/US3.
  - US2 depends on US1's relationship-building (T012) and chaining (T013) logic existing to
    exercise against a two-scheme fixture — it adds no new production code of its own beyond
    verification (T017).
  - US3 depends on US1's `buildAuthCredentialRelationships` (T012) and the reordered
    `generateCollection.ts` wiring (T014) to know which schemes actually resolved.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Tests are written first and must fail against the Foundational-phase stubs before implementation.
- `authCredentialRelationships.ts` logic (US1) before `automaticChaining.ts` wiring (US1), before
  `generateCollection.ts` integration (US1, then US3 building on the same call site).

### Parallel Opportunities

- T003, T004, T005 (Phase 2) can all run in parallel once T002 lands; T006 can run in parallel with
  T003/T004/T005 (all touch different files).
- T008, T009, T010, T011 (US1 tests) can run in parallel.
- T015, T016 (US2 tests) can run in parallel.
- T018, T019 (US3 tests) can run in parallel.
- T021 and T022 can run in parallel; both should land before T023's full validation run.

---

## Parallel Example: User Story 1

```bash
# Launch all four User Story 1 test tasks together:
Task: "Unit tests for buildAuthCredentialRelationships in backend/tests/unit/postman/authCredentialRelationships.test.ts"
Task: "Unit tests for primary-scheme discovery in backend/tests/unit/postman/credentialProducers.test.ts"
Task: "Unit tests for auth-consumer chaining in backend/tests/unit/postman/automaticChaining.test.ts"
Task: "Integration test for the flagship export in backend/tests/integration/postmanCollection.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run T008–T011 independently; confirm the flagship scenario (login token
   reaching every consumer, including the primary/default scheme) actually resolves.
5. User Story 1 alone already fixes the finding this spec responds to — every other authenticated
   operation in a freshly exported collection no longer fails on first run.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready.
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!).
3. Add User Story 2 → Test independently → Deploy/Demo (proves multi-scheme isolation holds).
4. Add User Story 3 → Test independently → Deploy/Demo (closes the loop — every ambiguous case is
   explicitly reported, never guessed).
5. Each story adds value without breaking the previous stories' guarantees.

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to specific user story for traceability.
- No story in this feature ever writes a real credential value, alters an operation's auth block
  structure, or executes a request against the described API (constitution XVIII, XIX; spec FR-007).
- Verify tests fail against the Foundational-phase stubs before implementing.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently.
