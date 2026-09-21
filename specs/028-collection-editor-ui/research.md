# Phase 0 Research: Postman-Style Collection & Variable Editor

## D1: One backing entity for both collection sources (FR-008)

**Decision**: Build entirely on the existing `UploadedCollectionSet`
(`packages/shared-domain/src/externalCollections.ts:25-39`, specs/026). No new entity or storage
path is introduced for "ApiPilot-generated collections."

**Rationale**: `App.tsx`'s existing `handleHandoffToExecution` already serializes a generated
`ExportResult` into `File` objects and pushes them through `POST /api/external-collections` — the
exact same endpoint a hand-authored upload uses (`frontend/src/services/importPreload.ts`,
`ExternalCollectionUpload.tsx`). By the time a user could reach this feature's view, a
generated-and-handed-off collection is already, structurally, an `UploadedCollectionSet` — the
"uploaded vs. generated" distinction FR-008 asks about is resolved upstream of this feature,
today, by AP-026. Building a second, parallel read/edit model for "generated" collections would
duplicate the collection tree, variable resolution, and edit-persistence logic this feature needs
to write once (constitution IX, XXVII), for a distinction that no longer exists once a collection
reaches this view.

**Alternatives considered**: A `GeneratedCollectionView` reading live from
`TestGenerationWorkflow.approvedTestModel` — rejected. It would require a second variable-
resolution and request-preview model (built on `TestScenario`/`GeneratedRequest` shapes, which
have no single resolved URL — see D5) running alongside the `PostmanCollection`-shaped model
AP-026 already has, doubling this feature's surface for a case the existing handoff flow already
normalizes away.

## D2: Stable per-request identity for overrides (FR-009a, FR-012)

**Decision**: Backfill a stable `id` on every Postman collection item that lacks one, at
upload/handoff time, using the Postman v2.1 schema's own native `item.id` field
(`PostmanRawItem.id?: string`, `externalCollections.ts:139-144` — already optional and present in
the type). Once backfilled, that id is the request's stable identity for the life of this
`UploadedCollectionSet` and is what `PUT .../requests/:requestId` (D4) and the variable/request
preview (D5) key off.

**Rationale**: `postman-collection`'s own parsing does not guarantee every item carries a
persistent `id` across re-serialization, and there is no existing identity scheme for "this
specific request within this stored collection" to build FR-012's discard-on-regeneration
behavior on. Using the format's own `id` field (rather than inventing a parallel `_apipilotId`
sidecar map) keeps the whole collection self-describing in one JSON document — consistent with
constitution XXVIII's preference for the standard format over custom bookkeeping.

**Alternatives considered**: Position-based addressing (folder index + item index) — rejected;
fragile the moment a request is edited or the collection is regenerated, which is exactly the
case FR-012 needs to handle safely.

## D3: Variable resolution and precedence (FR-002, FR-003, FR-005)

**Decision**: Add one new pure function, `resolveCollectionVariables(collection, variableValues)`,
in `backend/src/externalCollections/`, that walks every item's URL/headers/body (reusing the same
`{{token}}` extraction `extractReferencedVariables` already performs in
`uploadedCollectionParsing.ts`) and substitutes each token from `variableValues`
(`UploadedCollectionSet.variableValues`) only. A token with no entry in `variableValues` is left
unresolved and reported as missing — reusing `missingUploadedVariableValues` unchanged (FR-006).

**Rationale**: No live substitution function exists today — variable resolution currently only
happens implicitly, inside Newman, mid-run (`runUploadedCollectionExecution.ts`). This feature
needs to show the resolved form *before* a run starts, which requires extracting that
substitution logic into its own pure, independently testable function (constitution XXI) rather
than only ever running it inside the execution engine.

## D4: Persisting variable and request edits (FR-007, FR-009, FR-009a)

**Decision**: Both kinds of edit mutate the `UploadedCollectionSet` record already backing the
selected collection, in place — there is no separate "override" entity:

- A variable edit (FR-009) replaces `variableValues` wholesale via a new repository method,
  mirroring `EnvironmentRepository.update` exactly (`environmentRepository.ts`).
- A request edit (FR-007, FR-009a) replaces the matching item (found by the `id` from D2) inside
  the stored `collection` JSON, re-stringifies it, and persists it via a new repository method.
  The edited item is additionally marked with one boolean property Postman's schema already
  tolerates as an unknown/extension field (`_apipilotEdited: true`), so a subsequent run can carry
  that flag onto its own `UploadedRequestResult` (FR-011, see D6).

**Rationale**: FR-009a's actual constitutional concern — that editing must never mutate the
*original* generated `TestScenario`/`GeneratedRequest` or its provenance — is already satisfied
by D1: the `UploadedCollectionSet.collection` this feature edits is already a full copy, created
at handoff time, structurally disconnected from `TestGenerationWorkflow.approvedTestModel`, which
remains stored and inspectable, completely untouched, regardless of what happens to the copy.
Editing the copy in place (rather than layering a separate, reversible "override" record on top
of an immutable original) is therefore sufficient to satisfy FR-009a and is the smaller, simpler
design (constitution XXVII) — the "original vs. edited" distinction FR-009a and FR-011 care about
already exists one level up, between the workflow's `TestModel` and this feature's
`UploadedCollectionSet`, not within this feature's own storage.

**Alternatives considered**: A separate, versioned `RequestOverride` table layered on top of an
immutably-stored original collection — rejected as unnecessary complexity once D1 establishes
that the thing being edited is already a downstream copy, not the source of truth.

## D5: Why `GeneratedRequest` isn't a second data source

`GeneratedRequest` (`testModel.ts:40-45`) has no single resolved URL of its own — it is
`operationPath` (on the parent `TestScenario`) plus separately-shaped `pathParameters`/
`queryParameters`/`headers`/`body`, meant to be combined with an `Environment.baseUrl` only at
generation time. Building a preview directly on this shape would require re-deriving a URL/header/
body view distinct from the `PostmanCollection` shape AP-026 (and this feature, via D1) already
standardizes on. Per D1, this feature never reads `GeneratedRequest` directly — by the time a
collection reaches this view, it has already been generated into the `PostmanCollection`/
`UploadedCollectionSet` shape, which *does* carry a single resolved-per-item `PostmanRequest`
(`postmanArtifact.ts:103-109`) this feature's preview logic (D3) can substitute directly.

## D6: Surfacing edited requests in run results (FR-011)

**Decision**: `mapUploadedResult.ts` (AP-026) reads the `_apipilotEdited` marker (D4) off the item
it just executed and copies it onto a new optional field, `UploadedRequestResult.wasEdited?:
boolean`, present only when `true` (additive, non-breaking — mirrors how `ExecutionRun` gained
`cancelReason` additively in specs/025).

**Rationale**: This is the smallest change that satisfies FR-011 without introducing a second
results shape or a run-level diffing pass — the existing per-item result mapping already has the
item in hand at the moment it needs to check for the marker.

## D7: No new persistence table

**Decision**: No schema change to `uploaded_collections` (specs/025/026's existing table). The
`collection` and `variable_values_encrypted`/`variable_values_iv` columns already hold everything
this feature edits; only two new repository methods are added (`updateCollectionBody`,
`updateVariableValues`), mirroring `EnvironmentRepository.update`'s existing shape.

**Rationale**: Constitution XXVII — no infrastructure is introduced merely because it might be
convenient; the existing columns are already suffient for what this feature needs to persist.

## D8: "Variable source" is two persisted tiers, not three (Story 3, FR-003)

**Decision**: A variable's persisted source is one of exactly two values: `"collection-default"`
(declared in the uploaded collection's own top-level `variable` array, per the real Postman
Collection format, but never present in `variableValues`) or `"environment"` (present in
`UploadedCollectionSet.variableValues`, regardless of whether that value arrived via the original
upload or a later edit in this view). "User override," as the variable panel labels it (Story 3),
is a client-side-only distinction — whichever `"environment"`-sourced values differ from the
value the view loaded with in the current browsing session — not a third persisted storage tier.

**Rationale**: Only one variable-values map is persisted today (`variableValues`); a value edited
in this view and a value that arrived with the original upload both live in the exact same field
the instant either is saved. Introducing a third persisted tier purely to distinguish "always was
this value" from "I just changed it" would add a new column/flag for a distinction that
`EnvironmentForm`'s existing edit flow doesn't track either (constitution XXVII). The client-side
session-only "changed since I opened this view" indicator satisfies Story 3's acceptance
scenarios without new backend state.

## D9: Identity extends to folders, not just requests (FR-014, FR-015, FR-016)

**Decision**: `ensureStableItemIds` (D2) is generalized to `ensureStableIds`, walking both request
items *and* folders (Postman `ItemGroup`s), backfilling an `id` on any of either kind that lacks
one. Folders and requests share one `id` namespace — a single lookup by `id` unambiguously
resolves to either kind.

**Rationale**: FR-014/FR-015/FR-016 (delete/reorder/rename) apply to folders as well as requests
— the same stable-identity problem D2 solved for field-level request edits applies equally to
folder-level structural edits, and the Postman v2.1 schema's `id` field is available on both item
kinds already (no format extension needed).

## D10: Structural mutations go through the Postman SDK, not hand-rolled JSON surgery

**Decision**: Add/delete/rename/reorder are implemented as pure functions in a new
`backend/src/externalCollections/collectionStructure.ts`, each operating on a parsed
`postman-collection` `Collection` instance via its own mutation methods (`items.add`,
`items.remove`, direct property assignment for rename, array reindexing scoped to one container
for reorder) — never by string-manipulating the stored JSON directly.

**Rationale**: `uploadedCollectionParsing.ts` already parses every stored collection through the
real `postman-collection` SDK (specs/026 research.md D1) specifically so ApiPilot never
reimplements the format's own structural rules. Hand-rolling JSON tree edits would risk producing
a document `postman-collection` itself would reject or reserialize differently — a second,
competing implementation of the same format the SDK already owns (constitution XXVIII).

## D11: One shared "collection locked while running" guard (FR-017)

**Decision**: Every mutating endpoint on a given `UploadedCollectionSet` — the two from D4
(`PUT .../variables`, `PUT .../requests/:id`) and the four new structural ones (D10) — call one
new shared helper, `assertCollectionNotRunning(uploadedCollectionSetId)`, before applying any
change. It checks the same in-progress-run state `execution/start`'s existing FR-015 cross-check
(specs/026) already reads, read-only here (no state transition of its own), and responds
`409 collection_locked` if a run of this collection is currently in progress.

**Rationale**: Six different mutation endpoints each need the identical guard; centralizing it in
one helper (rather than duplicating the in-progress check six times) is both the smaller change
and the only way to guarantee FR-017 actually holds for every mutation kind, not just the ones a
developer remembers to add it to.

## D12: Unreferenced user-defined variables need no new storage tier (FR-018)

**Decision**: A variable the user defines with no request referencing it yet is simply a new key
written into the existing `variableValues` map (same storage D8 already uses for every
environment-sourced value). `buildCollectionView`'s variable list (D3) is extended to union three
sources — variables referenced by any request, variables the collection's own `variable` array
declares, and every key already present in `variableValues` — so a value with no current
reference still appears in the panel (spec.md Edge Cases) without inventing a third persisted
variable tier beyond D8's two.

**Rationale**: Reuses the exact same field this feature already writes to for every other
variable value; the only change is that `buildCollectionView` must no longer assume "every key in
`variableValues` corresponds to some `{{token}}` in the collection" — an assumption D3's original
design implicitly made and this decision removes.

## Technology confirmation

No new dependency is required. This feature reuses, unchanged: `postman-collection` (already a
direct backend dependency per specs/026 research.md D1), `better-sqlite3` (existing persistence),
Express, React, Vite, Tailwind v4, Vitest, Supertest, React Testing Library — all already in the
workspace per the repository's technology baseline.
