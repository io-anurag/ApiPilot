---

description: "Task list for 021-multi-credential-token-provisioning"
---

# Tasks: Distinct-Credential Token Provisioning for Postman Export

**Input**: Design documents from `/specs/021-multi-credential-token-provisioning/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/distinct-credential-export.md, quickstart.md

**Tests**: Included — this is deterministic domain logic with an explicit backward-compatibility
guarantee (SC-001) and explicit-failure requirements (FR-006, FR-007; constitution XIV, XIX,
XXI); every existing sibling module in `backend/src/postman/` has a corresponding test file, and
this feature follows the same convention.

**Organization**: Tasks are grouped by user story (spec.md). US1 (P1) delivers the core variable-
naming/auth-routing mechanism and is independently shippable on its own (placeholder variables
already beat today's silent collision). US2 (P2) adds producer discovery as an additive data
contract. US3 (P3) adds the explicit limitation for whatever US2 couldn't resolve. Each is
independently testable once the Foundational phase is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps the task to US1, US2, or US3
- File paths are exact and repository-relative

## Path Conventions

Existing monorepo layout — no new project or workspace:
`packages/shared-domain/src/`, `backend/src/postman/`, `backend/tests/unit/postman/`,
`backend/tests/integration/`, `backend/tests/fixtures/postman/`, `frontend/src/components/`.

---

## Phase 1: Setup

**Purpose**: Create fixture data this feature's tests need, without touching any existing fixture
or behavior.

- [X] T001 [P] Create `backend/tests/fixtures/postman/credentialFixtures.ts` with builder
      functions (not modifying the existing `exportFixtures.ts`, so every pre-existing test's
      fixture stays byte-identical — SC-001): (a) a `securitySchemes` record declaring `bearerAuth`
      then `adminAuth` (both `http`/`bearer`, in that declaration order) for primacy testing; (b) a
      `securitySchemes` record declaring two `apiKey` schemes with the same header `name` but
      different keys (Acceptance Scenario 3); (c) a `securitySchemes` record with a key carrying no
      `Auth`/`Scheme` suffix (e.g. `partnerCredential`) for the literal-suffix-appended naming
      case; (d) an operation list containing one unauthenticated `POST /auth/admin-login`
      (`operationId: "adminLogin"`) alongside authenticated operations under `bearerAuth`/
      `adminAuth`, for the producer-found case; (e) a variant with two equally-plausible
      unauthenticated operations matching the same stem, for the ambiguous-no-candidate case; (f) a
      variant with zero unauthenticated operations, for the no-candidate case.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contract and scaffolding changes every user story's tests depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Extend `packages/shared-domain/src/postmanArtifact.ts` per data-model.md: add the
      `CredentialProducerCandidate` interface, add `"unresolved-credential-producer"` to
      `GenerationLimitationKind`, and add `credentialProducers: CredentialProducerCandidate[]` to
      `ExportResult`.
- [X] T003 [P] Add the `"unresolved-credential-producer"` heading to the
      `Record<GenerationLimitationKind, string>` `LIMITATION_HEADINGS` map in
      `backend/src/postman/readme.ts` (e.g. `"Security-scheme credentials this export could not
      identify a producer for"`). (Depends on T002.)
- [X] T004 [P] Add the same `"unresolved-credential-producer"` heading to the
      `Record<GenerationLimitationKind, string>` `LIMITATION_HEADINGS` map in
      `frontend/src/components/PostmanExportLimitations.tsx`. (Depends on T002.)
- [X] T005 [P] In `backend/src/postman/authMapping.ts`, add `SchemeType`,
      `SchemeVariablePlanEntry`, a private `schemeStem(schemeKey)` helper (strips a trailing
      case-insensitive `Auth`/`Scheme` suffix, else returns the key unchanged), and
      `planSchemeVariables(securitySchemes)` per data-model.md: classify each key's type by reusing
      `mapScheme`'s existing `http`/`bearer`, `http`/`basic`, `apiKey` conditions, group by type in
      `Object.entries` declaration order, mark the first key of each group `isPrimary: true`
      resolving to the legacy literal name(s), and derive every other key's name(s) from
      `schemeStem` + the type-specific suffix (`Token`/`ApiKey`/`Username`+`Password`). Pure
      function; not yet wired into `mapOperationAuth`.
- [X] T006 [P] In `backend/src/postman/artifactVariables.ts`, extend `credentialVariable` to
      `credentialVariable(kind: ArtifactCredentialName, variableName: string = kind):
      ArtifactVariable`, using `variableName` for the emitted `ArtifactVariable.name` and `kind`
      unchanged for the `CREDENTIAL_PURPOSE` lookup. Every existing one-argument call site
      (`requestItem.ts`, `authMapping.ts`) is unaffected.
- [X] T007 Create `backend/src/postman/credentialProducers.ts` with the `findCredentialProducers`
      stub from data-model.md (imports `CredentialProducerCandidate` from `@apipilot/shared-domain`
      and `SchemeVariablePlanEntry` from `./authMapping`; returns `[]` unconditionally for now — no
      matching logic yet). (Depends on T002, T005.)
- [X] T008 In `backend/src/postman/generateCollection.ts`, add `credentialProducers: []` as a new
      field on the `withoutReadme` object literal (~line 453) so `ExportResult` always carries the
      field, even before it is populated. (Depends on T002.)

**Checkpoint**: `npm run build`, `npm run lint`, and the existing test suite all pass unchanged —
no observable behavior change yet.

---

## Phase 3: User Story 1 - Run Elevated-Privilege Requests Without Manual Variable Surgery (Priority: P1) 🎯 MVP

**Goal**: Every distinctly-keyed security scheme of the same type gets its own credential
variable, named deterministically from its scheme key; every operation's auth block references the
variable matching its own declared scheme; a specification with one scheme per type is completely
unaffected.

**Independent Test**: Export a spec whose `components.securitySchemes` declares two `http`/`bearer`
schemes (`bearerAuth`, `adminAuth`); verify the environment contains `{{token}}` and
`{{adminToken}}`, and that each scheme's operations reference their own variable, not the other's.

### Tests for User Story 1

> Write these first; confirm they fail against the T005/T007 stubs before implementing.

- [X] T009 [P] [US1] Unit tests in `backend/tests/unit/postman/authMapping.test.ts`:
      `planSchemeVariables` — (a) with `bearerAuth` then `adminAuth`, `bearerAuth` is
      `isPrimary: true`/`{token: "token"}` and `adminAuth` is `isPrimary: false`/
      `{token: "adminToken"}`; (b) with the `partnerCredential`-keyed fixture (T001c), the
      non-primary key resolves to `partnerCredentialToken` (no `Auth`/`Scheme` suffix to strip); (c)
      two same-header-name `apiKey` schemes (T001b) resolve to two distinct `apiKey`-shaped
      entries; (d) a single scheme of a type is always `isPrimary: true` with the legacy name.
- [X] T010 [P] [US1] Unit tests in `backend/tests/unit/postman/authMapping.test.ts`: extend every
      existing `mapOperationAuth` call site to pass `planSchemeVariables(schemes)` as the third
      argument, asserting today's single-scheme fixtures (`bearerAuth`/`basicAuth`/`apiKeyAuth`
      from the existing `exportApiModel`) still produce byte-identical `PostmanAuth`/
      `ArtifactVariable` output (SC-001); add a new case asserting a distinct-scheme operation's
      auth block references the derived variable name (FR-004), using T001a's fixture.
- [X] T011 [P] [US1] Integration test in `backend/tests/integration/postmanCollection.test.ts`:
      exporting a spec built from T001a's two-`bearerAuth`-scheme fixture over HTTP produces two
      environment variables (`token`, `adminToken`) and correctly-routed auth blocks; exporting the
      existing single-scheme fixture is byte-identical to pre-feature output.

### Implementation for User Story 1

- [X] T012 [US1] In `backend/src/postman/authMapping.ts`, extend `mapOperationAuth`'s signature to
      `mapOperationAuth(operation, securitySchemes, plan: Map<string, SchemeVariablePlanEntry>)`,
      and extend the private `mapScheme` to accept the resolved `variableNames` for the key being
      mapped, building the same `PostmanAuth`/`ArtifactVariable` shape as today but referencing the
      plan's name(s) via `credentialVariable(kind, variableName)` (T006) instead of the hard-coded
      literals `"token"`/`"apiKey"`/`"username"`/`"password"`. The existing
      `"unsupported-auth-scheme"` fallback path for unrecognized scheme types is unchanged. (Depends
      on T005, T006.)
- [X] T013 [US1] In `backend/src/postman/generateCollection.ts`'s `authByOperation`, compute
      `planSchemeVariables(apiModel.securitySchemes)` once at the top of the function and pass it as
      the third argument to every `mapOperationAuth(pair.operation, apiModel.securitySchemes,
      plan)` call in its loop. (Depends on T012.)

**Checkpoint**: User Story 1 is fully functional and testable independently — T009–T011 pass.

---

## Phase 4: User Story 2 - Discover an Existing Request That Can Obtain the Elevated Credential (Priority: P2)

**Goal**: When an unauthenticated operation is uniquely identifiable (by scheme-key stem) as a
distinct scheme's credential source, the export records it as that scheme's producer candidate.

**Independent Test**: Export a spec containing `POST /auth/admin-login` (unauthenticated, path
contains `adminAuth`'s stem) alongside an operation under `adminAuth`; verify
`ExportResult.credentialProducers` contains one entry naming `adminAuth` → `adminToken` →
`POST /auth/admin-login`.

### Tests for User Story 2

- [X] T014 [P] [US2] Unit tests in `backend/tests/unit/postman/credentialProducers.test.ts`:
      `findCredentialProducers` — (a) T001d's sole-unauthenticated-stem-match yields exactly one
      `CredentialProducerCandidate` for `adminAuth`; (b) T001e's two equally-plausible matches yields
      none for that scheme; (c) T001f's zero matches yields none; (d) an *authenticated* operation
      whose path/`operationId` matches the stem is never selected (Edge Cases); (e) the primary
      scheme in a plan is never searched, even when an unauthenticated operation's path happens to
      match its stem.
- [X] T015 [P] [US2] Unit test in `backend/tests/unit/postman/generateCollection.test.ts`: a full
      export built from T001d's fixture populates `ExportResult.credentialProducers` with the
      correct `schemeKey`/`variableName`/`producerOperationPath`/`producerOperationMethod`, and
      records no `unresolved-credential-producer` limitation for `adminAuth`.

### Implementation for User Story 2

- [X] T016 [US2] Implement `findCredentialProducers` in `backend/src/postman/credentialProducers.ts`
      per data-model.md: for every `plan` entry with `isPrimary: false`, filter `operations` to
      `security.length === 0` whose `path` or `operationId` contains that entry's `stem`
      case-insensitively; emit one `CredentialProducerCandidate` when exactly one operation
      matches, none otherwise. (Depends on T007.)
- [X] T017 [US2] In `backend/src/postman/generateCollection.ts`, call
      `findCredentialProducers(apiModel.operations, plan)` (reusing the `plan` computed in T013) and
      assign its result to the `credentialProducers` field added in T008. (Depends on T008, T013,
      T016.)

**Checkpoint**: User Stories 1 and 2 both work independently — T009–T011 and T014–T015 pass.

---

## Phase 5: User Story 3 - Know Exactly What's Missing When Nothing Can Be Automated (Priority: P3)

**Goal**: Every distinct scheme with no discoverable producer still gets its correctly-named empty
placeholder plus exactly one itemized limitation naming the scheme and every dependent operation.

**Independent Test**: Export a spec with a distinct `adminAuth` scheme and no discoverable producer
operation; verify the environment still declares empty `{{adminToken}}`, and the result contains
exactly one `unresolved-credential-producer` limitation naming `adminAuth` and every operation that
references it.

### Tests for User Story 3

- [X] T018 [P] [US3] Unit test in `backend/tests/unit/postman/generateCollection.test.ts`: an
      export built from T001f's fixture (no unauthenticated operations at all) still emits an empty
      `{{adminToken}}` environment variable and exactly one `unresolved-credential-producer`
      limitation whose `location` names the `adminAuth` scheme and whose `message` lists every
      operation among the export's approved scenarios that references it; repeat with T001e's
      ambiguous-match fixture, verifying the same limitation is recorded (not a silently-ignored
      case).
- [X] T019 [P] [US3] Unit test in `backend/tests/unit/postman/readme.test.ts`: an export carrying an
      `unresolved-credential-producer` limitation renders it under its own heading in the README,
      distinguishable from `unsupported-auth-scheme` entries.

### Implementation for User Story 3

- [X] T020 [US3] In `backend/src/postman/generateCollection.ts`, after computing
      `credentialProducers` (T017), determine every non-primary scheme in `plan` with no matching
      entry in `credentialProducers`, and for each, push one `GenerationLimitation` (`kind:
      "unresolved-credential-producer"`, `location: 'security scheme "<schemeKey>"'`, `message`
      naming the scheme key and listing every operation — in `"METHOD /path"` form — among the
      export's approved scenarios whose resolved auth references that scheme) into the export's
      limitations list. (Depends on T017.)

**Checkpoint**: All three user stories are independently functional — T009–T011, T014–T015, and
T018–T019 all pass.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide guarantees and validation that span all three stories.

- [X] T021 [P] Extend `backend/tests/unit/postman/determinism.test.ts` and
      `backend/tests/unit/postman/reexportStability.test.ts` with a multi-scheme case (T001a):
      repeated exports of the same inputs produce byte-identical `credentialProducers`,
      `ArtifactVariable`, and `PostmanAuth` output (SC-001, SC-002, constitution XVI/XXIV).
- [X] T022 Run quickstart.md's focused checks, then the full repository validation commands (`npm
      run build`, `npm run lint`, `npm test`) from the repository root; fix any fallout before
      considering the feature complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
  - US1 has no dependency on US2/US3.
  - US2 depends on US1's `plan` computation existing at the `generateCollection.ts` call site
    (T013) to reuse, but its own `findCredentialProducers` logic (T016) is independently testable
    via T014 against `authMapping.ts`'s `planSchemeVariables` alone.
  - US3 depends on US2's `credentialProducers` result (T017) to know which schemes remain
    unresolved.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Tests are written first and must fail against the Foundational-phase stubs before implementation.
- `authMapping.ts` changes (US1) before `generateCollection.ts` wiring (US1, then US2, then US3 —
  each building on the previous phase's wiring in the same function).

### Parallel Opportunities

- T003, T004, T005, T006 (Phase 2) can all run in parallel once T002 lands (T003/T004 depend on
  T002; T005/T006 do not).
- T009, T010, T011 (US1 tests) can run in parallel.
- T014, T015 (US2 tests) can run in parallel.
- T018, T019 (US3 tests) can run in parallel.
- T021 can run in parallel with T022 only up to the point T022's build/lint/test run needs T021's
  changes committed — run T021 first, then T022.

---

## Parallel Example: User Story 1

```bash
# Launch all three User Story 1 test tasks together:
Task: "Unit tests for planSchemeVariables in backend/tests/unit/postman/authMapping.test.ts"
Task: "Unit tests updating mapOperationAuth call sites in backend/tests/unit/postman/authMapping.test.ts"
Task: "Integration test for multi-scheme export in backend/tests/integration/postmanCollection.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run T009–T011 independently; confirm SC-001 (single-scheme byte-identical
   output) and SC-002 (correct routing) both hold.
5. User Story 1 alone already replaces today's silent `{{token}}` collision with correctly-named,
   correctly-routed placeholder variables — a real improvement even before US2/US3 land.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready.
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!).
3. Add User Story 2 → Test independently → Deploy/Demo (adds producer-discovery metadata; no
   observable collection/README change yet, per FR-009's explicit scoping).
4. Add User Story 3 → Test independently → Deploy/Demo (adds the explicit limitation for whatever
   US2 couldn't resolve — closes the loop so nothing is ever silently unresolved).
5. Each story adds value without breaking the previous stories' guarantees.

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to specific user story for traceability.
- Every distinct-scheme variable is always emitted empty — no story in this feature ever writes a
  real credential value or executes a request (constitution XVIII, XIX).
- Verify tests fail against the Foundational-phase stubs before implementing.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently.
