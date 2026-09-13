---

description: "Task list for 019-auto-workflow-chaining"
---

# Tasks: Automatic Workflow Chaining for Postman Export

**Input**: Design documents from `/specs/019-auto-workflow-chaining/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/automatic-chaining-export.md, quickstart.md

**Tests**: Included — this is deterministic domain logic with explicit, spec-mandated safety
guarantees (constitution XVI, XIX, XXI); every existing sibling module in `backend/src/postman/`
has a corresponding test file, and this feature follows the same convention.

**Organization**: Tasks are grouped by user story (spec.md). All three user stories are P1; US1
delivers the core mechanism, US2 delivers its required audit/opt-out surface, and US3 delivers the
safety guardrails without which US1's chaining would not be trustworthy — each is still
independently testable once the Foundational phase is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps the task to US1, US2, or US3
- File paths are exact and repository-relative

## Path Conventions

Existing monorepo layout — no new project or workspace:
`packages/shared-domain/src/`, `backend/src/postman/`, `backend/src/testGenerationWorkflow/`,
`backend/src/api/`, `backend/tests/unit/postman/`, `backend/tests/integration/`,
`backend/tests/fixtures/postman/`.

---

## Phase 1: Setup

**Purpose**: Create the new files this feature needs, with no behavior yet.

- [X] T001 [P] Create `backend/src/postman/automaticChaining.ts` with the type-only skeleton from
      data-model.md (`AutomaticChain`, `AutomaticChainingInput`, `AutomaticChainingResult`, and a
      `planAutomaticChains` stub that returns its input unchanged) — no eligibility logic yet.
- [X] T002 [P] Create `backend/tests/fixtures/postman/dependencyFixtures.ts` with builder functions
      for `ApiDependencyRelationship`, `ApiDependencyGraph`, `DependencyCycleFinding`, and
      `WorkflowReviewDecision` fixtures: a simple one-hop producer/consumer pair, a fan-out
      producer (feeds 2+ consumers), a POSSIBLE-only pair, a pair inside a reported cycle, a pair
      whose containing workflow is rejected, and a pair with two competing CONFIRMED producers.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contract and wiring changes every user story's tests depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Extend `packages/shared-domain/src/postmanArtifact.ts` per data-model.md: add
      `ExportOptions.disableAutomaticChaining?: boolean`,
      `WorkflowExportContext.automaticChaining?: { graph: ApiDependencyGraph; cycles:
      DependencyCycleFinding[]; workflowDecisions: Record<string, WorkflowReviewDecision> }`, the
      `ChainOrigin` type, `ArtifactVariable.provenance.origin?: ChainOrigin`, and
      `ExportSummary.automaticChainCount: number`.
- [X] T004 Set `provenance.origin: "approved-workflow"` explicitly at the three existing
      `ArtifactVariable` construction sites for workflow-derived variables in
      `backend/src/postman/generateCollection.ts` (~lines 276, 297, 303), so every pre-existing
      workflow variable is explicitly tagged ahead of the new `"automatic-chain"` origin.
- [X] T005 Update `backend/src/testGenerationWorkflow/postmanGenerationStage.ts` to build
      `workflowContext.automaticChaining` from `workflow.dependencyAnalysis.graph`,
      `workflow.dependencyAnalysis.cycles`, and `workflow.workflowDecisions ?? {}` whenever
      `workflow.dependencyAnalysis` is present, alongside the existing `workflows`/
      `approvedWorkflowIds` fields.
- [X] T006 Extend the request validators in `backend/src/api/postmanCollections.ts` (e.g.
      `isWorkflowContext`, `isExportOptions`) to accept and type-check
      `workflowContext.automaticChaining` and `options.disableAutomaticChaining`, rejecting a
      malformed `automaticChaining` object as `400 invalid_request` per
      contracts/automatic-chaining-export.md.
- [X] T007 Wire the insertion point in `backend/src/postman/generateCollection.ts`: immediately
      after `planApprovedWorkflows()` computes `renderedScenarioIds`/`standaloneResolved` (research.md
      D1), call the `planAutomaticChains` stub from T001 with `standaloneResolved` and the
      `automaticChaining` context (or a disabled/empty input when absent or
      `options.disableAutomaticChaining` is `true`), and use its returned scenarios/extractions in
      place of the untouched standalone list. With the T001 stub this is behaviorally a no-op.

**Checkpoint**: Shared-domain contracts, stage wiring, and the insertion point exist; `npm run
build`, `npm run lint`, and the existing test suite still pass unchanged (no behavior change yet).

---

## Phase 3: User Story 1 - Get a Runnable Collection Without Manually Filling IDs (Priority: P1) 🎯 MVP

**Goal**: A standalone producer/consumer pair connected by a CONFIRMED or LIKELY relationship is
rendered as a chained pair (extraction + substitution) without requiring an approved
`IntegrationWorkflow`.

**Independent Test**: Export scenarios for `GET /orders` (producer) and `DELETE /orders/{id}`
(consumer) joined by a CONFIRMED relationship, with no approved workflow for the pair; verify the
producer request extracts `id` into a variable, the consumer substitutes it, and no
`unresolved-path-parameter` limitation remains for that parameter.

### Tests for User Story 1

> Write these first; confirm they fail against the T001 stub before implementing.

- [X] T008 [P] [US1] Unit test in `backend/tests/unit/postman/automaticChaining.test.ts`: a single
      CONFIRMED relationship between a producer and one consumer scenario is rendered as a chain
      (variable substituted into the consumer, extraction attached to the producer) — using
      `dependencyFixtures.ts` from T002.
- [X] T009 [P] [US1] Unit test in `backend/tests/unit/postman/automaticChaining.test.ts`: a single
      producer feeding 2+ consumers reuses one variable and one extraction script rather than
      emitting a redundant capture per consumer (FR-009).
- [X] T010 [P] [US1] Integration test in `backend/tests/integration/postmanWorkflowCollection.test.ts`:
      a full `generateCollection` export with `automaticChaining` context produces a chained
      collection with the extraction/substitution present and no `unresolved-path-parameter`
      limitation for the chained parameter.

### Implementation for User Story 1

- [X] T011 [US1] In `backend/src/postman/automaticChaining.ts`, implement relationship lookup for
      each standalone scenario's unresolved path parameters: filter `graph.relationships` to
      CONFIRMED/LIKELY, match producer/consumer `operationPath`/`operationMethod`/`field`, and
      restrict producer eligibility to that operation's approved **positive**-outcome scenario
      (FR-001, FR-003, FR-004, FR-017). Reads only from the supplied `ApiDependencyGraph` and never
      invents a relationship, evidence, or extraction path of its own (FR-013). (Depends on T001, T002.)
- [X] T012 [US1] In `backend/src/postman/automaticChaining.ts`, group eligible relationships by
      producer `(operationPath, operationMethod, field)` and build one `AutomaticChain` (one
      `chainId` = `auto_<relationshipId>`, one variable name via the reused `workflowVariableName`)
      shared by every consumer in the group (FR-009). (Depends on T011.)
- [X] T013 [US1] In `backend/src/postman/generateCollection.ts`, apply `planAutomaticChains`'s
      returned scenarios (via the reused `applyWorkflowSubstitutions`) to `standaloneResolved`,
      attach each chain's extraction to its producer item's test event via the reused
      `appendWorkflowExtractions`, and add the chain count to `ExportSummary.automaticChainCount`
      (FR-002). Because `standaloneResolved` already excludes every scenario claimed by an approved
      workflow (`renderedScenarioIds`, pre-existing 016 behavior), an automatic chain never
      duplicates or conflicts with an approved workflow's own rendering (FR-008; coexistence
      covered by generateCollection.test.ts's "coexists with an approved workflow" case).
      (Depends on T007, T012.)
- [X] T014 [US1] In `backend/src/postman/generateCollection.ts`, set
      `provenance: { workflowId: chainId, relationshipId, origin: "automatic-chain" }` on every
      `ArtifactVariable` produced by an automatic chain. Every parameter that does not qualify for a
      chain keeps its existing `unresolved-path-parameter` limitation, message, and reporting
      exactly as before this feature (FR-014). (Depends on T013.)

**Checkpoint**: User Story 1 is fully functional and testable independently — T008–T010 pass.

---

## Phase 4: User Story 2 - Trust and Audit Which Chains Were Applied Automatically (Priority: P1)

**Goal**: Every automatic chain is visibly explained in the export summary/README, distinguishable
from approved-workflow chains, and an engineer can opt out for a whole export.

**Independent Test**: Export a collection containing at least one automatic chain; verify the
summary/README lists its producer, consumer, variable, and evidence, distinctly from any
approved-workflow chain output; verify `options.disableAutomaticChaining: true` removes all
automatic chains and restores today's `unresolved-path-parameter` behavior.

### Tests for User Story 2

- [X] T015 [P] [US2] Unit test in `backend/tests/unit/postman/readme.test.ts`: an export containing
      one automatic chain and one approved-workflow chain lists both in the README, each showing
      producer, consumer, variable, and confidence/evidence, with the two origins visibly
      distinguished (FR-010).
- [X] T016 [P] [US2] Unit test in `backend/tests/unit/postman/generateCollection.test.ts`: the same
      export inputs with `options.disableAutomaticChaining: true` produce byte-identical output
      (via `serializeArtifact`) to the same inputs generated before this feature's changes — no
      chains, standard `unresolved-path-parameter` limitations (FR-012).

### Implementation for User Story 2

- [X] T017 [US2] Implement the `options.disableAutomaticChaining` short-circuit at the T007 call
      site in `backend/src/postman/generateCollection.ts`: when `true`, skip `planAutomaticChains`
      entirely (empty/disabled input) so standalone rendering is byte-identical to pre-feature
      behavior (FR-011). (Depends on T013.)
- [X] T018 [US2] Extend `backend/src/postman/readme.ts` to render each automatic chain (producer,
      consumer, variable name, confidence, evidence) in a section distinguishable from approved
      workflow chains, and extend `variableSection`/its summary counterpart to surface
      `ExportSummary.automaticChainCount`. (Depends on T014.)

**Checkpoint**: User Stories 1 and 2 both work independently — T008–T010 and T015–T016 pass.

---

## Phase 5: User Story 3 - Never Guess When Evidence Is Weak or Ambiguous (Priority: P1)

**Goal**: Automatic chaining applies only where evidence is strong and unambiguous; every
disqualifying condition falls back to today's explicit `unresolved-path-parameter` limitation.

**Independent Test**: Exercise each disqualifying condition (POSSIBLE-only confidence, competing
producers, a cycle, a missing producer scenario, an explicitly rejected workflow, an
ordering conflict, a multi-hop-only relationship) and verify none of them produces a chain, while a
genuine multi-candidate case still resolves deterministically to exactly one producer.

### Tests for User Story 3

> Sequential — all target the same test file.

- [X] T019 [US3] Unit test in `backend/tests/unit/postman/automaticChaining.test.ts`: a path
      parameter whose only candidate relationship is POSSIBLE confidence is never chained (FR-004).
- [X] T020 [US3] Unit test in `backend/tests/unit/postman/automaticChaining.test.ts`: two or more
      CONFIRMED/LIKELY candidate producers for the same consumer field resolve to exactly one,
      via the reused `resolveProducerDisambiguation`, identically across repeated runs (FR-006).
- [X] T021 [US3] Unit test in `backend/tests/unit/postman/automaticChaining.test.ts`: a relationship
      appearing in `cycles[].relationshipIds` is excluded from chaining (FR-007).
- [X] T022 [US3] Unit test in `backend/tests/unit/postman/automaticChaining.test.ts`: a producer
      operation with no approved scenario in the export leaves its would-be consumer on the
      standard `unresolved-path-parameter` fallback (FR-005).
- [X] T023 [US3] Unit test in `backend/tests/unit/postman/automaticChaining.test.ts`: a relationship
      whose producer or consumer belongs to a workflow with `workflowDecisions[id].state ===
      "rejected"` is excluded even though it independently meets CONFIRMED/LIKELY (FR-016).
- [X] T024 [US3] Unit test in `backend/tests/unit/postman/automaticChaining.test.ts`: a relationship
      whose consumer would sort before its producer under the existing `compareRequestSortKeys` is
      excluded, and the parameter falls back to `unresolved-path-parameter` (FR-015).
- [X] T025 [US3] Unit test in `backend/tests/unit/postman/automaticChaining.test.ts`: a two-hop
      candidate (producer → intermediate → consumer, no single relationship spanning both ends) is
      never assembled into a chain; each direct relationship is still evaluated independently on
      its own merits (FR-018).

### Implementation for User Story 3

- [X] T026 [US3] In `backend/src/postman/automaticChaining.ts`, exclude any relationship whose id
      appears in `input.cycles[].relationshipIds`. (Depends on T012.)
- [X] T027 [US3] In `backend/src/postman/automaticChaining.ts`, derive `rejectedRelationshipIds`
      from `context.workflows` + `workflowDecisions` (union of `relationshipIds` for every workflow
      with `state === "rejected"`) and exclude them from eligibility. (Depends on T012.)
- [X] T028 [US3] In `backend/src/postman/automaticChaining.ts`, call the existing
      `resolveProducerDisambiguation` (from `backend/src/dependencies/mergeRelationships.ts`)
      whenever a consumer field has more than one eligible candidate producer, and use its
      `resolved` result unchanged. (Depends on T012.)
- [X] T029 [US3] Apply the ordering guard: only keep a chain when the producer's item is ranked
      before the consumer's item in `standaloneOrderRank`. As built, `generateCollection.ts`
      computes that rank once via the existing, unmodified `groupAndName`/`compareRequestSortKeys`
      (`backend/src/postman/ordering.ts`) over the unchanged standalone list and passes it into
      `planAutomaticChains`; the comparison itself runs inside
      `backend/src/postman/automaticChaining.ts`'s `applyChainGroup`, not at the `generateCollection.ts`
      call site. Otherwise the parameter is left unresolved. (Depends on T013.)
- [X] T030 [US3] In `backend/src/postman/automaticChaining.ts`, ensure the relationship lookup never
      traverses through an intermediate relationship — each candidate is evaluated strictly as one
      producer field to one consumer field — and document this single-hop boundary with a short
      comment referencing FR-018. (Depends on T012.)

**Checkpoint**: All three user stories are independently functional — T008–T010, T015–T016, and
T019–T025 all pass.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide guarantees and validation that span all three stories.

- [X] T031 [P] Extend `backend/tests/unit/postman/determinism.test.ts` and
      `backend/tests/unit/postman/reexportStability.test.ts` with an automatic-chaining case: the
      same approved scenario set, dependency graph, and export options produce byte-identical
      serialized output across repeated exports (SC-004, FR-012).
- [X] T035 [P] Added post-`/speckit-analyze` (2026-09-13): unit test in
      `backend/tests/unit/postman/generateCollection.test.ts` ("coexists with an approved workflow
      without duplicating or conflicting with it") exercising an approved `IntegrationWorkflow` and
      an unrelated automatic-chaining-eligible relationship in the same export, asserting no
      scenario is rendered twice and both mechanisms' summary counts are correct (FR-008).
- [X] T036 [P] Added post-`/speckit-analyze` (2026-09-13): unit test in
      `backend/tests/unit/postman/generateCollection.test.ts` ("resolves the representative
      create/read/update/delete relationship shape at ≥90%") measuring the automatic-chain
      resolution rate against the feature's own representative CRUD fan-out case (SC-001).
- [X] T037 [P] Added post-`/speckit-analyze` (2026-09-13): unit test in
      `backend/tests/unit/postman/readme.test.ts` ("keeps the automatic-chains section scannable")
      asserting the README's chain section stays one bullet per producer with one "used by"
      sub-bullet per consumer, substantiating the structural half of SC-006's scannability claim.
- [X] T032 Run `npm run test -w backend` (full backend suite) and fix any regression in existing
      007/016 standalone or approved-workflow export tests.
- [X] T033 [P] Run `npm run lint` and `npm run build` from the repository root and resolve any
      TypeScript/ESLint issue introduced by the new fields or module.
- [X] T034 Execute quickstart.md's "HTTP Contract Check" and "Guided Workflow Check" manually
      against a running dev server (`npm run dev`), including the `disableAutomaticChaining: true`
      re-run.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T001 and T002 can start immediately, in parallel.
- **Foundational (Phase 2)**: Depends on Phase 1 (T003–T006 need the types T001 introduces to
  reference; T007 needs T001's stub to call). Blocks all user stories.
- **User Stories (Phase 3–5)**: All depend on Foundational (Phase 2) completion. US1 delivers the
  base module US2 and US3 extend, so in practice US2/US3 implementation tasks land after US1's
  T011–T014, though their test tasks can be drafted in parallel.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational. No dependency on US2/US3.
- **User Story 2 (P1)**: Its tests (T015–T016) can be written any time after Foundational; its
  implementation (T017–T018) depends on US1's T013/T014 existing to have something to report on
  and short-circuit.
- **User Story 3 (P1)**: Its tests (T019–T025) can be written any time after Foundational (using
  fixtures from T002); its implementation (T026–T030) depends on US1's T012/T013 (the module and
  call site it hardens).

### Within Each User Story

- Tests are written first and must fail against the current stub/implementation before the
  corresponding implementation task lands.
- Within `automaticChaining.ts`, later tasks build on the eligibility/grouping logic earlier tasks
  establish (T011 → T012 → T026/T027/T028/T030; T013 → T029).

### Parallel Opportunities

- T001 and T002 (Setup) in parallel.
- T008, T009, T010 (US1 tests) in parallel — different files or independent cases.
- T015 and T016 (US2 tests) in parallel — different files.
- T031 and T033 (Polish) in parallel — different concerns.
- T019–T025 (US3 tests) target one shared file and are sequential, not parallel.
- T003–T007 (Foundational) are mostly sequential (shared files / dependency chain); none marked [P].

---

## Parallel Example: User Story 1

```bash
# Launch all three US1 tests together:
Task: "Unit test: single CONFIRMED relationship chains producer→consumer in backend/tests/unit/postman/automaticChaining.test.ts"
Task: "Unit test: producer fan-out reuses one variable/extraction in backend/tests/unit/postman/automaticChaining.test.ts"
Task: "Integration test: end-to-end chained export in backend/tests/integration/postmanWorkflowCollection.test.ts"
```

(T008 and T009 share a file — in practice, write them as two test cases added to the same PR/commit
rather than truly concurrent edits; T010 is a genuinely separate file and can proceed in parallel.)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything).
3. Complete Phase 3: User Story 1 — this alone already resolves the dominant real-world case
   (nested resource collection → item endpoints) and is safe on its own because T011's eligibility
   filter (CONFIRMED/LIKELY only, positive-scenario-only) is conservative by construction even
   before US3's additional guardrails land.
4. **STOP and VALIDATE**: run the US1 independent test (quickstart.md's focused checks).

### Incremental Delivery

1. Setup + Foundational → contracts and wiring exist, no behavior change.
2. Add User Story 1 → the core chaining mechanism works for the common, non-ambiguous case.
3. Add User Story 3 → close the remaining safety gaps (cycles, ambiguity, rejections, ordering,
   multi-hop) before relying on the feature against a real, larger API surface.
4. Add User Story 2 → full auditability and the opt-out lever.
5. Polish → determinism/reexport-stability coverage, full suite, manual quickstart validation.

Note: although listed in spec priority order (US1, US2, US3), US3's guardrails are recommended
before broad rollout of US1 in a real environment, since they are what keeps "automatic by default"
conservative (constitution XV, XIX) rather than merely fast. Each phase remains independently
testable regardless of delivery order.

### Parallel Team Strategy

1. One person completes Setup + Foundational.
2. Once Foundational is done, US1's implementation (T011–T014) should land first since US2 and US3
   both build on it; US2's and US3's *tests* can be drafted in parallel with US1's implementation
   using the fixtures from T002.
3. US2 and US3 implementation proceed in parallel once US1's T012/T013 land (different files:
   `readme.ts` vs. guard logic inside `automaticChaining.ts`/`generateCollection.ts`) — coordinate
   on `automaticChaining.ts` and `generateCollection.ts` to avoid overlapping edits.

---

## Notes

- [P] tasks touch different files with no unfinished dependency.
- [Story] labels map every user-story-phase task to US1, US2, or US3 for traceability back to
  spec.md.
- No test task should be marked done until it fails first against the pre-implementation state.
- Commit after each task or logical group.
- Avoid: reordering the generated collection to force a chain to work (FR-015), reusing
  `planWorkflow`'s all-or-nothing rendering for automatic chains (research.md D3), and chaining
  through more than one relationship hop (FR-018).
