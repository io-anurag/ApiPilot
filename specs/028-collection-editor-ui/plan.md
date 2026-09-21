# Implementation Plan: Postman-Style Collection & Variable Editor

**Branch**: `028-collection-editor-ui` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/028-collection-editor-ui/spec.md`

## Summary

Give a user a Postman-style, pre-run view of any loaded collection — browse its folder/request
tree, see each request's method/URL/headers/body with `{{variable}}` placeholders visibly marked,
supply or override every referenced variable (or define a new one ahead of use) with a live
resolved-request preview, directly edit a request's method/URL/headers/body, and restructure the
collection itself (add, delete, rename, reorder requests and folders) — before ever starting a
run, and never while a run of that same collection is in progress. Research confirmed the
existing "hand off a generated collection to execution" flow (specs/016/018) already converts a
generated artifact into the same `UploadedCollectionSet` entity a directly-uploaded collection
uses (research.md D1), so this feature extends that single entity rather than building a second
model — seven new endpoints, a set of new repository methods and pure functions (all reusing the
`postman-collection` SDK), and new frontend components, with no new persistence table. (Revised
after a `/speckit-clarify` pass added FR-013–FR-018:
structural editing, a run-in-progress lock, and unreferenced user-defined variables — see
research.md D9–D12.)

## Technical Context

**Language/Version**: TypeScript on Node.js 22 LTS (repository baseline, unchanged).

**Primary Dependencies**: Express (routes), `postman-collection` (existing direct backend
dependency, specs/026), `better-sqlite3` (existing persistence). React + Vite + Tailwind v4 on the
frontend. No new dependency.

**Storage**: SQLite via the existing `SqliteConnection`/`CredentialCipher`
(specs/025-local-persistence-layer), reusing the existing `uploaded_collections` table's
`collection` and `variable_values_encrypted`/`variable_values_iv` columns as-is — no schema
change (research.md D7).

**Testing**: Vitest + Supertest (backend unit/integration), Vitest + React Testing Library
(frontend) — existing conventions, no new test tooling.

**Target Platform**: Existing local-first Express backend + React frontend; no new deployment
target.

**Project Type**: Web application (existing `backend/` + `frontend/` + `packages/shared-domain/`
workspace structure) — Option 2 below.

**Performance Goals**: None beyond existing per-request execution behavior; this feature is a
pre-run, non-executing view — every new endpoint is a synchronous computation over an
already-in-memory-sized JSON document (bounded by the existing `MAX_UPLOAD_BYTES` upload limit,
specs/026), not a new performance-sensitive path.

**Constraints**: Editing MUST NOT execute any request (FR-010) and MUST NOT mutate the original
generated `TestScenario`/`TestModel` for a handed-off collection (FR-009a, satisfied structurally
per research.md D1/D4, not by new code). Every mutating operation (variable, field, or
structural) MUST be rejected while a run of the same collection is in progress (FR-017,
research.md D11).

**Scale/Scope**: Single-session, single-operator, local-first — consistent with the rest of the
product; same session scoping as every other `UploadedCollectionSet` operation.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Specification Is the Source of Truth | PASS | This feature never fabricates a status code, schema, or field — it displays and edits exactly what the collection/environment already contain. A user-edited request's assertions are whatever test scripts the item already carried (unchanged by the edit); the feature does not regenerate or invent new assertions for an edited request, consistent with how AP-026 already treats an uploaded collection's arbitrary scripts. |
| II. Deterministic Before AI | PASS | No AI involved anywhere in this feature. |
| VIII. Framework-Independent Test Model | PASS (N/A by design) | Deliberately builds on the `PostmanCollection`/`UploadedCollectionSet` shape (already the case for AP-026), not `TestModel` — per research.md D5, does not weaken the guarantee for the generation pipeline itself. |
| IX. Separation of Concerns | PASS | New code lives inside the existing `backend/src/externalCollections/` module and its own new frontend components; the generation pipeline (`testDesign/`, `postman/`) is untouched. |
| XI. Human-in-the-Loop | PASS | Directly extends human control — a user now sees and can adjust exactly what will be sent, before it is sent, which is a stronger review capability than existed before this feature. |
| XIII. Test Provenance and Traceability | PASS | `wasEdited` (data-model.md) makes an edited request's result visibly distinguishable from an unedited one (FR-011). The original generated `TestScenario`'s provenance is untouched because this feature never reads or writes `TestGenerationWorkflow.approvedTestModel` (research.md D1). |
| XIV. No Silent Assumptions | PASS | Unresolved variables are always shown as unresolved (FR-002, FR-003), never silently left blank or guessed; an edited request is always marked `wasEdited`, never presented as if it were the collection's original definition. |
| XVI. Executable Artifacts Must Be Deterministic | PASS (N/A) | This principle governs `TestModel → artifact generation`. This feature acts entirely after that step, on an already-materialized `UploadedCollectionSet` copy — it is a human-driven post-generation edit, not a second artifact generator, and does not touch `generateCollection()` or its determinism guarantee. |
| XVII. Security and Privacy by Design | PASS | No new trust boundary: edits apply only to a collection the current session already owns, gated by the same session scoping every other `UploadedCollectionSet` operation uses. No new network access, no new script execution, no new `$ref`/external fetch. Running an edited request still goes through AP-026's existing FR-007 unverified-content confirmation and full-fidelity script execution, already covered by the 2026-09-20 constitutional amendment. |
| XVIII. Secrets Must Never Be Part of Generated Artifacts | PASS | `variableValues` continues to be stored via the existing `CredentialCipher`-encrypted columns (research.md D7); the new `PUT .../variables` endpoint reuses the exact same repository-level encryption `EnvironmentRepository.update`/`UploadedCollectionRepository` already apply — no new plaintext-at-rest path. |
| XIX. Fail Safely | PASS | Every mutating endpoint against a stale/nonexistent id returns a specific `404` (`request_not_found`/`item_not_found`/`folder_not_found`) rather than silently applying to the wrong item; reorder against a mismatched id set returns `400 invalid_order` rather than silently reconciling a partial list (data-model.md). |
| XX. Observability Without Sensitive Logging | PASS | No new logging surface; resolved request bodies/headers/variable values follow the same non-logging convention `execution/`/`externalCollections/` already apply. |
| XXI. Testability at Every Boundary | PASS | `buildCollectionView`, `resolveCollectionVariables`, `applyRequestOverride`, `ensureStableIds`, `addRequest`, `deleteItem`, `renameItem`, `reorderContainer`, and `assertCollectionNotRunning` (data-model.md) are each pure or narrowly-scoped, independently unit-testable functions with no AI/network dependency. |
| XXVII. Prefer Simple Architecture | PASS | No new table, no new entity, no new dependency (research.md D1, D7) — seven new endpoints and a handful of new repository/pure-function additions on an existing entity. Structural mutations reuse the `postman-collection` SDK's own mutation API rather than a hand-rolled JSON editor (research.md D10). |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | PASS | Continues to use the standard Postman Collection format's own `id` field for both request and folder identity (research.md D2, D9) and its own SDK for structural mutation (research.md D10), rather than inventing parallel schemes. |
| XXXII. Human Review Must Remain Practical at Real Scale | PASS | This is a browse/edit surface, not an accept/reject review gate — XXXII's bulk-decision requirement targets review gates specifically. The collapsible folder tree (FR-001) keeps large collections navigable, and reorder (FR-015) operates per-container, not requiring a full-collection bulk action; no per-item approval step is introduced that could become impractical at scale. |
| XXXIII. Presentation Must Be Consistent, Coherent, and Usable | PASS (verify at implementation) | New components (collection tree, variable panel, request editor) MUST reuse existing Tailwind v4 tokens, `HttpMethodBadge`/`StatusBadge`-style conventions, and the established `EnvironmentForm`/`ExternalCollectionRunPanel` visual language — tracked as an implementation-time check, not a design gap. |

No unresolved violations. No constitutional amendment required.

### Post-Phase-1 re-check

Re-evaluated against research.md and data-model.md, including the FR-013–FR-018 additions from
the `/speckit-clarify` pass: no new violation introduced. The one principle requiring the most
care (XVI, artifact-generation determinism) was resolved by recognizing this feature operates
strictly after generation, on a copy already structurally isolated from the generation pipeline
(research.md D1) — not by an exception or amendment; structural edits (add/delete/rename/reorder)
are governed by the same reasoning, since they mutate the same already-isolated copy, not the
original `TestModel`. The run-in-progress lock (FR-017, research.md D11) was evaluated against
XIX (Fail Safely) and found to strengthen it, not merely satisfy it — a mutation is refused
outright rather than silently queued or applied to stale state. Gate remains PASS.

## Project Structure

### Documentation (this feature)

```text
specs/028-collection-editor-ui/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── collection-editor-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── externalCollections.ts   # + CollectionView, CollectionFolderView (with id), CollectionRequestView,
                              # VariableBinding (with referenced) types; + UploadedRequestResult.wasEdited?: boolean
                              # (additive only — UploadedCollectionSet, ExecutionRun, RequestResult,
                              # TestModel, TestScenario unchanged)

backend/src/externalCollections/       # Existing AP-026 module — additions only
├── collectionView.ts                  # NEW: buildCollectionView(), resolveCollectionVariables()
│                                       # (research.md D3, D12)
├── requestOverride.ts                 # NEW: applyRequestOverride()
├── collectionStructure.ts             # NEW: addRequest(), deleteItem(), renameItem(),
│                                       # reorderContainer() (research.md D10)
├── itemIdentity.ts                    # NEW: ensureStableIds() — requests AND folders (research.md D2, D9)
├── runLock.ts                         # NEW: assertCollectionNotRunning() (research.md D11)
├── mapUploadedResult.ts               # + reads `_apipilotEdited` onto UploadedRequestResult.wasEdited
├── uploadedCollectionParsing.ts       # + calls ensureStableIds() once, at upload/handoff time
└── errors.ts                          # + RequestNotFoundError, ItemNotFoundError, FolderNotFoundError,
                                        # InvalidOrderError, CollectionLockedError

backend/src/persistence/
└── uploadedCollectionRepository.ts    # + updateVariableValues(), updateCollectionBody()
                                        # (mirrors EnvironmentRepository.update exactly; both structural
                                        # and field edits persist through updateCollectionBody())

backend/src/api/
└── externalCollections.ts             # + GET .../:id/collection
                                        # + PUT .../:id/variables
                                        # + PUT .../:id/requests/:requestId
                                        # + POST .../:id/items
                                        # + DELETE .../:id/items/:itemId
                                        # + PUT .../:id/items/:itemId/rename
                                        # + PUT .../:id/containers/:containerId/order
                                        # (all six mutating routes call assertCollectionNotRunning first)

frontend/src/services/
└── externalCollectionsClient.ts       # + fetchUploadedCollectionView(), updateUploadedCollectionVariables(),
                                        # updateUploadedCollectionRequest(), addUploadedCollectionRequest(),
                                        # deleteUploadedCollectionItem(), renameUploadedCollectionItem(),
                                        # reorderUploadedCollectionContainer()

frontend/src/components/
├── CollectionTreeView.tsx             # NEW: recursive folder/request tree with add/delete/rename/
│                                       # reorder affordances (no existing recursive component to
│                                       # reuse per research — new, but follows the existing row-toggle
│                                       # idiom from ExternalCollectionResultRow); disabled/read-only
│                                       # while `collectionLocked` (FR-017)
├── VariablePanel.tsx                  # NEW: key/value rows + resolved/missing/source/referenced
│                                       # status + "add variable" action (FR-018), follows
│                                       # EnvironmentForm's row-editing pattern and styling
├── RequestEditorPanel.tsx             # NEW: editable method/URL/headers/body form + read-only
│                                       # resolved preview (reuses CodeBlock for the read-only side)
├── VariableHighlightedText.tsx        # NEW: small shared helper — renders text with {{var}} tokens
│                                       # visibly distinct (FR-002), used by both raw and resolved views
└── EnvironmentForm.tsx                # Unchanged — remains scoped to AP-017's `Environment`, not
                                        # reused directly (different entity), but its row-editing
                                        # pattern and Tailwind conventions are followed by VariablePanel

frontend/src/pages/
└── ExternalCollectionsPage.tsx        # + renders the new collection/variable/request editor view
                                        # (above ExternalCollectionRunPanel) once a collection is selected;
                                        # passes down whether a run of the selected collection is in
                                        # progress so the tree/panels can go read-only (FR-017)

backend/tests/unit/externalCollections/       # + collectionView, requestOverride, collectionStructure,
                                               # itemIdentity, runLock tests
backend/tests/integration/externalCollections/ # + GET/PUT/POST/DELETE endpoint integration tests,
                                                # including a collection_locked-while-running test
frontend/tests/unit/CollectionTreeView.test.tsx
frontend/tests/unit/VariablePanel.test.tsx
frontend/tests/unit/RequestEditorPanel.test.tsx
```

**Structure Decision**: Existing web-application layout (Option 2:
`backend/` + `frontend/` + `packages/shared-domain/`). Purely additive to the existing
specs/026 `externalCollections` module and `ExternalCollectionsPage` — no existing AP-026/AP-018
file is rewritten, only extended (new exports, new optional fields, new endpoints).

## Complexity Tracking

*No unresolved Constitution Check violations — this table is intentionally empty.*
