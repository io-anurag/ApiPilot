# Implementation Plan: Distinct-Credential Token Provisioning for Postman Export

**Branch**: `021-multi-credential-token-provisioning` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/021-multi-credential-token-provisioning/spec.md`

## Summary

Today, `authMapping.ts` maps every `http`/`bearer` scheme in a specification to the same
`{{token}}` variable regardless of the scheme's own key, so a specification declaring a second,
distinctly-keyed scheme (e.g. `adminAuth` alongside `bearerAuth`) silently collides both schemes
onto one variable — an operation requiring the elevated credential looks authenticated but runs
with the wrong caller's identity instead of failing informatively. This feature makes the security
scheme *key* (not its type, and never a tag/folder/path signal) the sole grouping key for
credential variables: the first-declared scheme of each type keeps today's default name
(`token`/`apiKey`/`username`+`password`); every other same-type key gets a name deterministically
derived from its own key (`adminAuth` → `adminToken`). When the specification also contains an
unauthenticated operation uniquely identifiable by that scheme's key (via a path/`operationId`
substring match), the export records it as the credential's producer candidate for a later
automatic-chaining extension to wire up; otherwise the export still emits the correctly-named empty
placeholder plus an itemized limitation naming the scheme and every dependent operation.

The technical approach adds one small, pure planning function (`planSchemeVariables`) computed once
per export from `ApiModel.securitySchemes` alone, threaded through the existing per-operation
`mapOperationAuth` call; and one new, independently-testable pure module
(`credentialProducers.ts`) implementing the producer-discovery heuristic. Neither touches
`automaticChaining.ts` or the dependency-analysis pipeline — wiring a discovered producer's actual
response value into the variable is explicitly out of scope (spec FR-009), delivered by a later
extension this spec only defines the contract for.

## Technical Context

**Language/Version**: TypeScript 5.5 (`^5.5.4`), Node.js ≥20 (repo `engines.node`)

**Primary Dependencies**: Express 4.19 (`backend/src/api`), no new runtime dependency required —
this feature reuses existing `backend/src/postman/*` and `packages/shared-domain` modules only.

**Storage**: N/A — the existing stateless direct-export HTTP contract and non-persistent
`TestGenerationWorkflow` record are unchanged; no new persistence is introduced.

**Testing**: Vitest 4.1 (`vitest run`), Supertest 7.0 for the HTTP contract
(`backend/src/api/postmanCollections.ts`), following the existing fixture/assertion patterns in
`backend/tests/unit/postman/` and `backend/tests/fixtures/postman/`. React Testing Library for the
one affected frontend component (`PostmanExportLimitations.tsx`).

**Target Platform**: Existing backend Node service; no new deployment target.

**Project Type**: Web service + shared library (existing npm-workspaces monorepo:
`backend/`, `packages/shared-domain/`; `frontend/` touched only for one additive limitation-heading
entry required by TypeScript's exhaustive `Record` check).

**Performance Goals**: No new performance target. `planSchemeVariables` and
`findCredentialProducers` are both bounded, single-pass functions over the specification's own
`securitySchemes` (typically 1–5 entries) and `operations` list — negligible relative to the
existing export pipeline's schema-analysis and scenario-generation costs.

**Constraints**: Must remain fully deterministic (constitution II, XVI, XXIV) with no new AI
invocation (constitution V, VI); must not fabricate a producer relationship, business role, or
credential value beyond what the specification's own declared scheme keys and unauthenticated
operations evidence (spec FR-005, FR-008, constitution I, XIV, XIX); must preserve byte-identical
output for every single-scheme-per-type specification (spec FR-002, SC-001).

**Scale/Scope**: Same representative scale as 007/016/019 (up to ~200 operations); this feature
adds no new scale dimension — the number of distinct security scheme keys in a real specification
is small (typically 1–3).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Specification Is the Source of Truth | Variable names and producer candidates are derived only from declared scheme keys, declared `security` requirements, and declared paths/`operationId`s already in the `ApiModel` — nothing fabricated. | PASS |
| II. Deterministic Before AI | `planSchemeVariables` and `findCredentialProducers` are pure deterministic functions; no AI call anywhere in this feature. | PASS |
| V. Local-First AI / VI. AI Provider Independence | Not applicable — no AI involvement. | PASS |
| VIII. Framework-Independent Test Model | No change to `TestModel`; this feature operates entirely at the artifact-generation boundary (`ApiModel` → Postman artifacts), consistent with the existing `authMapping.ts`/`automaticChaining.ts` layering. | PASS |
| IX. Separation of Concerns | Scheme-naming logic stays in `authMapping.ts` (its existing owner); producer discovery is a new, narrowly-scoped module rather than an extension of the schema-field-matching `automaticChaining.ts`/`dependencies/` pipeline (research.md D5). | PASS |
| XIV. No Silent Assumptions / XIX. Fail Safely | A scheme with zero or ambiguous (2+) producer candidates is never guessed at (FR-006); it always falls back to an explicit, itemized `unresolved-credential-producer` limitation (FR-007) rather than a silently empty or mis-wired variable. | PASS |
| XVI. Executable Artifacts Must Be Deterministic / XXIV. Reproducibility | Same `ApiModel` ⇒ byte-identical scheme-variable plan, producer candidates, and auth blocks across repeated exports; no new non-deterministic input. | PASS |
| XVIII. Secrets Must Never Be Part of Generated Artifacts | Every distinct-scheme variable is emitted with an empty value, exactly as `{{token}}` always has been; `credentialProducers` carries only scheme/operation identifiers, never a credential value. | PASS |
| XXVI. Specification Traceability | This plan traces every design decision to a specific FR/SC and to the 2026-09-14/2026-09-15 Clarifications; no implementation decision contradicts spec.md. | PASS |
| XXVII. Prefer Simple Architecture | No new subsystem, service, or external dependency; two small pure functions plus an additive shared-domain field. | PASS |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | Extends existing domain types (`ArtifactVariable`, `GenerationLimitation`, `ExportResult`) additively; introduces one new narrowly-scoped type (`CredentialProducerCandidate`) rather than a parallel domain model. | PASS |

No violations requiring Complexity Tracking.

**Post-design re-check** (after Phase 0/1, research.md + data-model.md + contracts/): unchanged —
still PASS on every row above. The Phase 0 research decisions (D5: a new module rather than
extending `automaticChaining.ts`; D6: an additive, empty-by-default `ExportResult` field with no
speculative README/UI rendering beyond what TypeScript's exhaustive `Record` check requires) each
keep the feature's blast radius to the artifact-generation boundary it already lives at, and the
Phase 1 contract adds only one additive, non-optional array field to the existing `ExportResult`
shape.

## Project Structure

### Documentation (this feature)

```text
specs/021-multi-credential-token-provisioning/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── distinct-credential-export.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/shared-domain/
└── src/
    └── postmanArtifact.ts        # extend GenerationLimitationKind, ExportResult; add CredentialProducerCandidate

backend/
├── src/
│   ├── postman/
│   │   ├── authMapping.ts             # add planSchemeVariables(); mapOperationAuth() takes the plan; mapScheme() replaced by buildAuthMapping(scheme, entry)
│   │   ├── artifactVariables.ts       # credentialVariable() gains an optional variableName override parameter
│   │   ├── credentialProducers.ts     # NEW — findCredentialProducers(): the FR-006 stem-match heuristic
│   │   ├── generateCollection.ts      # authByOperation(): compute the plan once, call findCredentialProducers(), emit the new limitation kind and ExportResult.credentialProducers
│   │   ├── workflowRendering.ts       # planWorkflow()'s own mapOperationAuth call site also needs the plan (a second production call site beyond generateCollection.ts)
│   │   ├── automaticChaining.ts       # unchanged — FR-009 explicitly scopes wiring to a later extension
│   │   └── readme.ts                  # extend LIMITATION_HEADINGS for the new kind
│   └── api/
│       └── postmanCollections.ts      # no request-shape change; response already passes ExportResult through unchanged
├── tests/
│   ├── unit/postman/
│   │   ├── authMapping.test.ts        # extend: multi-scheme naming/primacy/derivation cases
│   │   ├── credentialProducers.test.ts # NEW
│   │   └── generateCollection.test.ts # extend: end-to-end multi-scheme export, unresolved-producer limitation
│   ├── fixtures/postman/
│   │   └── credentialFixtures.ts      # NEW — multi-scheme fixtures, kept separate from exportFixtures.ts so every pre-existing single-scheme test's fixture stays byte-identical (SC-001)
│   └── integration/
│       └── postmanCollection.test.ts  # extend with an HTTP-level multi-scheme case

frontend/
└── src/components/
    └── PostmanExportLimitations.tsx   # extend LIMITATION_HEADINGS for the new kind (TypeScript-enforced)
```

**Structure Decision**: No new project, workspace, or subsystem. All backend changes live inside
the existing `backend/src/postman/` artifact-generation module (with one new sibling file,
`credentialProducers.ts`, for the independently-testable producer heuristic), plus additive fields
on the existing `packages/shared-domain/src/postmanArtifact.ts` contract. The only `frontend/`
change is the one-line heading TypeScript's exhaustive `Record<GenerationLimitationKind, string>`
requires — no new UI surface is introduced (research.md D6).

*As built* (added post-`/speckit-analyze`, 2026-09-15): widening `mapOperationAuth`'s signature to
take the plan required updating a second production call site the original design missed —
`workflowRendering.ts`'s `planWorkflow` also calls `mapOperationAuth` (to decide whether a workflow
step's auth is representable), and now computes its own `planSchemeVariables(apiModel.securitySchemes)`
for that call. `tsc` caught the missed call site immediately, so no behavior shipped incorrectly;
this note exists purely so a future reader can find both call sites from the plan.

## Complexity Tracking

*No entries — Constitution Check reported no violations.*
