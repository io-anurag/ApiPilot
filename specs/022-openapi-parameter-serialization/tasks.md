---

description: "Task list template for feature implementation"
---

# Tasks: Specification-Conformant Parameter Serialization

**Input**: Design documents from `/specs/022-openapi-parameter-serialization/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/parameter-serialization.md, quickstart.md

**Tests**: Included (TDD — write failing tests before implementation), matching this repository's
established pattern in sibling features 007/016/019/021.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3) to enable
independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Existing npm-workspaces monorepo layout: `backend/src/`, `backend/tests/`,
`packages/shared-domain/src/`, `frontend/src/`.

---

## Phase 1: Setup (Shared Contract Extensions)

**Purpose**: Additive shared-domain type changes every later task depends on. No behavior change.

- [ ] T001 [P] Extend `Parameter` in `packages/shared-domain/src/apiModel.ts`: add optional
      `style?: string`, `explode?: boolean`, and `contentEncoded?: boolean` fields, per
      data-model.md's "Extended (shared-domain): `Parameter`" section. All three stay `undefined`
      (never a fabricated default) when the specification omits them — `contentEncoded` is
      deliberately optional too (data-model.md's 2026-09-15 `/speckit-analyze` remediation note,
      finding C1): "absent" and "declared `false`" are the same fact for this field, so making it
      optional avoids an unplanned edit to the ~19 existing test files that construct `Parameter`
      literals directly, none of which need to change for this feature.
- [ ] T002 [P] Extend `GenerationLimitationKind` in `packages/shared-domain/src/postmanArtifact.ts`:
      add `"unresolved-parameter-style"` to the union, per data-model.md.

**Checkpoint**: Shared contracts compile with no fallout in existing `Parameter`-construction
sites — all three new fields are optional, so no existing test fixture needs to change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared `parameterSerialization.ts` module and OpenAPI extraction every user story
wires into. Must be complete and correct before any user-story wiring begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 [P] Write failing unit tests for `extractParameters`'s new `style`/`explode`/
      `contentEncoded` extraction in `backend/tests/unit/openapi/buildApiModel.test.ts` (extend
      existing file): a parameter declaring `style`/`explode` explicitly; a parameter declaring
      neither (both remain `undefined`, no default persisted — research.md D1); a parameter
      declaring `content` instead of `schema` (`contentEncoded: true` — research.md D7); a normal
      `schema`-based parameter (`contentEncoded` left `undefined`).
- [ ] T004 Implement the extraction changes in `extractParameters`
      (`backend/src/openapi/buildApiModel.ts`) to make T003 pass: set `contentEncoded: true` only
      when the raw parameter declares a plain-object `content` field; otherwise leave it
      `undefined` (this is the sole production call site — confirmed during `/speckit-plan`, no
      other file in `backend/src` constructs a `Parameter` literal).
- [ ] T005 [P] Create `backend/tests/fixtures/postman/parameterFixtures.ts`: operations and
      `Parameter` fixtures covering every row of contracts/parameter-serialization.md's
      conformance table (array/object query under `form`/`spaceDelimited`/`pipeDelimited`/
      `deepObject`; array/object path and header under `simple`; a `matrix`-style path parameter;
      a `label`-style parameter; a content-encoded parameter) — kept separate from
      `exportFixtures.ts` so every pre-existing scalar-only fixture stays byte-identical (SC-004,
      per plan.md's Structure Decision).
- [ ] T006 [P] Write failing unit tests for `resolveParameterStyle`, `percentEncode`,
      `serializeQueryParameter`, and `serializeSimpleValue` in new
      `backend/tests/unit/postman/parameterSerialization.test.ts`, covering every row of
      contracts/parameter-serialization.md's conformance table, using T005's fixtures. Include:
      per-location default resolution when `style`/`explode` are absent (Edge Cases); a negative
      scenario's runtime-shape-over-schema-type rule (Edge Cases); `resolved.implemented === false`
      for `matrix`/`label`/`contentEncoded` (FR-007).
- [ ] T007 Implement `backend/src/postman/parameterSerialization.ts`
      (`resolveParameterStyle`, `percentEncode`, `serializeQueryParameter`,
      `serializeSimpleValue`) per data-model.md's function contracts, to make T006 pass. Percent-
      encode every element/property value individually; never encode a style's own structural
      separator (`,`, `|`, `[`/`]`, repeated key) except `spaceDelimited`'s separator itself
      (`%20` — research.md D3). Preserve the generated value's own runtime element/property order
      (research.md D5).

**Checkpoint**: `parameterSerialization.ts` is fully correct and unit-tested in isolation. Not yet
wired into request rendering — `buildUrl` still uses today's `toValueText`/`urlValueText` for
everything.

---

## Phase 3: User Story 1 - Array and Object Query Parameters Produce a Real Request (Priority: P1) 🎯 MVP

**Goal**: An operation's array/object-typed query, path, or header parameter renders per its
declared `style`/`explode` instead of a JSON-stringified literal (FR-001-FR-005).

**Independent Test**: Analyze a specification with a `GET` operation declaring an array query
parameter with `style: form, explode: true` (the default), generate a positive scenario, export
it, and verify the rendered URL contains one repeated `key=value` pair per array element.

### Tests for User Story 1

> Write these tests FIRST; confirm they FAIL before implementation (T010/T011 do not exist yet).

- [ ] T008 [P] [US1] Write failing tests in `backend/tests/unit/postman/requestItem.test.ts`
      (extend) for `buildUrl`/`buildRequestItem` rendering array query parameters
      (`form`/`explode:true` repeated key, `form`/`explode:false` comma-join,
      `spaceDelimited`/`pipeDelimited`) and object query parameters (`deepObject`,
      `form`/`explode:true` default, `form`/`explode:false`) — Acceptance Scenarios 1-5. Also
      cover path/header array/object values under `simple` style (FR-005, research.md D4). Use
      plain alphanumeric element values (no special characters) so these tests isolate
      style-correctness from User Story 2's encoding concern.
- [ ] T009 [P] [US1] Write failing integration test in
      `backend/tests/integration/postmanCollection.test.ts` (extend): export an operation with one
      array and one object query parameter end-to-end via the HTTP contract, asserting the
      response JSON's `collection` contains the correctly-styled query entries. Also assert the
      rendered query string round-trip-parses (via `URLSearchParams` or equivalent) back into the
      same array/object shape the specification's `style`/`explode` declares — SC-001's own
      verification method, not just a structural entry check (`/speckit-analyze` finding U1).

### Implementation for User Story 1

- [ ] T010 [US1] In `buildUrl` (`backend/src/postman/requestItem.ts`), for a query parameter whose
      generated value is an array or an object and `resolveParameterStyle(parameter).implemented`
      is `true`, call `serializeQueryParameter` and append its returned entries to
      `PostmanUrl.query` instead of the current single-entry `urlValueText` call. A scalar value,
      or a parameter with `implemented === false`, keeps today's existing single-entry rendering
      unchanged for now (depends on T007).
- [ ] T011 [US1] In the same file's path-segment and header-building code, call
      `serializeSimpleValue` for an array/object value under an implemented `simple` style, on the
      same `implemented` check as T010 (depends on T007).
- [ ] T012 [US1] Run T008/T009 to green (`npm run test -w backend -- tests/unit/postman/requestItem.test.ts tests/integration/postmanCollection.test.ts`); confirm no existing test in
      `backend/tests/unit/postman/` regresses. Add a new case to
      `backend/tests/unit/postman/reexportStability.test.ts` (or `determinism.test.ts`) asserting
      that re-exporting an approved scenario containing an array/object query parameter twice
      produces byte-identical `collection`/`environment` artifacts (SC-004) — the existing
      determinism suites only cover scalar-parameter rendering today, so US1's new multi-entry
      output needs its own explicit determinism coverage, not just "don't regress"
      (`/speckit-analyze` finding C2).

**Checkpoint**: User Story 1 is independently functional and testable — array/object query, path,
and header parameters serialize per declared style. Percent-encoding of these values is added next
by User Story 2; User Story 1 alone does not yet encode them.

---

## Phase 4: User Story 2 - Special Characters Survive the Trip Into a URL (Priority: P2)

**Goal**: Every emitted URL key/value is percent-encoded, independent of array/object style
handling (FR-006).

**Independent Test**: Generate a scenario whose query or path value contains a character requiring
percent-encoding (e.g. a boundary string containing `&`), export it, and verify the rendered URL
percent-encodes that character.

### Tests for User Story 2

- [ ] T013 [P] [US2] Write failing tests in `backend/tests/unit/postman/requestItem.test.ts`
      (extend): a scalar query/path value containing `&`, `=`, `#`, `?`, or a space renders
      percent-encoded (Acceptance Scenarios 1-2); an array/object value from User Story 1
      containing such a character has each element/property individually percent-encoded while
      the style's own separator (`,`, `|`, `[`/`]`) stays literal; the `{{baseUrl}}` variable
      reference and literal path text remain intact around an encoded path segment.
- [ ] T014 [P] [US2] Write failing test in `backend/tests/integration/postmanCollection.test.ts`
      (extend): export a boundary-string scenario whose value contains `&`, and assert the
      rendered URL parses back (via a standard query-string parser) to the original value
      (SC-001/SC-002).

### Implementation for User Story 2

- [ ] T015 [US2] Update the remaining scalar rendering call sites in `buildUrl`
      (`backend/src/postman/requestItem.ts` — `urlValueText`/`toValueText` uses for path segments
      and the single-entry query case) to percent-encode via
      `parameterSerialization.percentEncode` for both key and value (depends on T007). Header
      values are NOT percent-encoded (FR-006 scopes encoding to "a rendered URL" only).
- [ ] T016 [US2] Run T013/T014 to green. Verify `backend/tests/unit/postman/reexportStability.test.ts`
      and `determinism.test.ts` still pass; extend them only if a new fixture is needed to cover
      the encoding path (quickstart.md Scenario 8, SC-004).

**Checkpoint**: User Stories 1 and 2 both work independently and together — every emitted URL is
style-conformant and percent-encoded.

---

## Phase 5: User Story 3 - An Unsupported Style Is a Visible Limitation, Never a Silent Guess (Priority: P3)

**Goal**: A `matrix`/`label`/content-encoded parameter still produces a runnable request (today's
fallback rendering) and records exactly one `unresolved-parameter-style` limitation (FR-007).

**Independent Test**: Analyze a specification with a path parameter declaring `style: matrix`,
export a scenario for it, and verify the generation result records a limitation naming the
operation, parameter, and style, while the request is still produced.

### Tests for User Story 3

- [ ] T017 [P] [US3] Write failing tests in `backend/tests/unit/postman/requestItem.test.ts`
      (extend): a `matrix`-style path parameter, a `label`-style parameter, and a content-encoded
      parameter each still produce a request using today's exact unencoded fallback rendering
      (research.md D6), and exactly one `GenerationLimitation` with
      `kind: "unresolved-parameter-style"` is recorded naming the operation, parameter, and style.
- [ ] T018 [P] [US3] Write failing test in `backend/tests/integration/postmanCollection.test.ts`
      (extend): export an operation with an unimplemented-style parameter end-to-end; assert the
      collection still contains a runnable request and `ExportResult.limitations` contains the new
      kind.

### Implementation for User Story 3

- [ ] T019 [US3] Add the `unresolved-parameter-style` limitation-recording branch alongside the
      existing `implemented === false` fallback in `buildUrl`/header-building
      (`backend/src/postman/requestItem.ts`), naming the operation (`location`), the parameter,
      and the declared/content-based style, per data-model.md's message convention.
- [ ] T020 [P] [US3] Add a `"unresolved-parameter-style"` entry to `LIMITATION_HEADINGS` in
      `backend/src/postman/readme.ts`.
- [ ] T021 [P] [US3] Add a `"unresolved-parameter-style"` entry to `LIMITATION_HEADINGS` in
      `frontend/src/components/PostmanExportLimitations.tsx`.
- [ ] T022 [US3] Run T017/T018 to green.

**Checkpoint**: All three user stories are independently functional and composable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T023 [P] Walk through quickstart.md's 8 validation scenarios and confirm each is covered by
      a passing automated test (cross-reference against T008/T009/T013/T014/T017/T018).
- [ ] T024 Run full repository validation from the repo root: `npm run build`, `npm run lint`,
      `npm test`; fix any fallout across workspaces.
- [ ] T025 If implementation diverged from plan.md/data-model.md's design during T001-T022 (e.g. a
      second production call site was discovered, matching spec 021's post-analyze precedent),
      add an "As built" note to the affected design document(s) describing the divergence and why.
      Skip this task if no divergence occurred.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001/T002) — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational (T007). No dependency on US2/US3.
- **User Story 2 (Phase 4)**: Depends on Foundational (T007). Does not require US1's task
  completion to implement (T015 touches a disjoint code path from T010/T011), but T013's
  array/object-element-encoding test cases assume US1's entries already exist, so run Phase 3
  before Phase 4 in practice.
- **User Story 3 (Phase 5)**: Depends on Foundational (T007) and on the `implemented === false`
  fallback branch existing (introduced alongside T010/T011 in Phase 3) — run after Phase 3.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Tests (T008/T009, T013/T014, T017/T018) MUST be written and FAIL before their corresponding
  implementation tasks.
- Run-to-green tasks (T012, T016, T022) come last in each phase.

### Parallel Opportunities

- T001/T002 (Setup) in parallel.
- T003/T005/T006 in parallel with each other (different files), but T004 (implementation) depends
  on T003, and T007 (implementation) depends on T005 and T006.
- T008/T009 in parallel; T013/T014 in parallel; T017/T018 in parallel — each pair touches
  different test files.
- T020/T021 (Polish-adjacent heading updates) in parallel — different files (`backend`/`frontend`).
- User Story 2 and User Story 3 implementation could proceed in parallel by different developers
  once Phase 3 lands, since T015 (US2) and T019 (US3) touch related but distinguishable branches
  of the same functions — coordinate to avoid a merge conflict in `requestItem.ts`.

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Launch independent Foundational test/fixture tasks together:
Task: "Write failing tests for extractParameters style/explode/contentEncoded extraction in backend/tests/unit/openapi/buildApiModel.test.ts"
Task: "Create backend/tests/fixtures/postman/parameterFixtures.ts"
Task: "Write failing tests for parameterSerialization.ts in backend/tests/unit/postman/parameterSerialization.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: array/object query parameters render correctly per style (not yet
   encoded). This alone fixes "the direct cause of all tests under the catalog folder failing"
   per spec.md's User Story 1 rationale.

### Incremental Delivery

1. Setup + Foundational → shared contracts and serialization primitives ready.
2. Add User Story 1 → style-conformant array/object rendering (MVP).
3. Add User Story 2 → every emitted URL byte is safely encoded.
4. Add User Story 3 → unsupported styles are visible limitations, never silent guesses.
5. Polish → quickstart validation, full-repo build/lint/test, as-built documentation notes.
