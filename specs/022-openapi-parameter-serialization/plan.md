# Implementation Plan: Specification-Conformant Parameter Serialization

**Branch**: `022-openapi-parameter-serialization` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/022-openapi-parameter-serialization/spec.md`

## Summary

Today, `backend/src/postman/requestItem.ts`'s `buildUrl` turns every path/query parameter value
into URL text with an unconditional `JSON.stringify`/`String()` conversion (`toValueText`) and no
percent-encoding, regardless of what `style`/`explode` the specification declares for that
parameter. This makes every array/object-typed query parameter render as a literal JSON string
(`?sort=["name","-price"]`) instead of the specification's actual wire format, and lets any
generated value containing `&`, `=`, `#`, or a space corrupt the query string. This feature makes
`buildUrl` (the request-rendering layer, the sole production call site that turns a
`GeneratedRequest`'s path/query values into URL text) consult the originating `ApiOperation`'s own
`Parameter.style`/`Parameter.explode` — newly carried on the shared `Parameter` contract — to
serialize each already-generated value the way OpenAPI 3.x defines for that style, and
percent-encodes every emitted key/value. `GeneratedRequest` itself, every rule module that
produces a value, and which parameters are included in a request are all explicitly unchanged
(spec FR-008) — this is a rendering-correctness fix, not a value-generation or scenario-coverage
change.

The technical approach adds one small, pure serialization module
(`backend/src/postman/parameterSerialization.ts`) that `buildUrl` calls once per path/query
parameter, plus additive `style`/`explode` extraction in `backend/src/openapi/buildApiModel.ts`'s
existing `extractParameters`. A style this feature does not implement (`matrix`, `label`, or a
`content`-based parameter) falls back to today's exact unencoded rendering and records a new
`unresolved-parameter-style` limitation, never a guess — the same fail-safely pattern
`authMapping.ts` already uses for an unmappable auth scheme (constitution XIV, XIX).

## Technical Context

**Language/Version**: TypeScript 5.5 (`^5.5.4`), Node.js ≥20 (repo `engines.node`)

**Primary Dependencies**: No new runtime dependency — percent-encoding uses the platform's own
`encodeURIComponent` (Node/browser built-in); this feature reuses existing
`backend/src/postman/*`, `backend/src/openapi/*`, and `packages/shared-domain` modules only.

**Storage**: N/A — no new persistence; the existing stateless direct-export HTTP contract is
unchanged.

**Testing**: Vitest 4.1 (`vitest run`), following the existing fixture/assertion patterns in
`backend/tests/unit/postman/` and `backend/tests/unit/openapi/`. No frontend change (this feature
is entirely backend request-rendering; `PostmanExportLimitations.tsx` needs one additive heading
entry for the new limitation kind, the same minimal touch spec 021 required).

**Target Platform**: Existing backend Node service; no new deployment target.

**Project Type**: Web service + shared library (existing npm-workspaces monorepo: `backend/`,
`packages/shared-domain/`; `frontend/` touched only for the one TypeScript-enforced limitation
heading, exactly as spec 021's Structure Decision already established as the project's convention
for a new `GenerationLimitationKind`).

**Performance Goals**: No new performance target. Serialization is a bounded, single-pass
transform over one operation's own `parameters` list (typically 1-10) and one scenario's own
query/path value set — negligible relative to the existing export pipeline.

**Constraints**: Must remain fully deterministic (constitution II, XVI, XXIV) — no new randomness,
and array/object element order in the rendered URL MUST follow the generated value's own
(deterministic) order, never a re-sort; must not fabricate support for an unimplemented style
(constitution I, XIV, XIX — FR-007's fallback + limitation, never a guess); must not change
`GeneratedRequest`'s shape, any rule module's generated value, or which parameters a request
includes (spec FR-008); must preserve today's exact rendering for every case this feature does not
touch, and specifically for `matrix`/`label`/`content` styles (spec FR-007, "additive to today's
behavior").

**Scale/Scope**: Same representative scale as 007/016/019/021 (up to ~200 operations); the number
of parameters per operation and the number of elements in one array/object value are both small
(typically single digits) — no new scale dimension.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Specification Is the Source of Truth | `style`/`explode` are read directly from the specification's own declared parameter object (`buildApiModel.ts`); when absent, only the OpenAPI 3.x-defined per-location default is used, never a fabricated one — and that default is resolved at serialization time, never persisted onto the parsed `Parameter` (mirrors spec 021's `SchemeVariablePlanEntry` decision to keep resolution and storage separate). | PASS |
| II. Deterministic Before AI | `parameterSerialization.ts` is a pure, deterministic module; no AI call anywhere in this feature. | PASS |
| VIII. Framework-Independent Test Model | No change to `TestModel`/`GeneratedRequest` (spec FR-008); this feature operates entirely at the artifact-generation boundary (`ApiModel` + approved `TestScenario` → Postman request), the same boundary `authMapping.ts`/`requestItem.ts` already own. | PASS |
| IX. Separation of Concerns | Serialization logic lives in one new, narrowly-scoped module rather than being inlined into `buildUrl`'s existing responsibilities or spread into `testDesign/` rule modules, which must stay untouched per FR-008. | PASS |
| XIV. No Silent Assumptions / XIX. Fail Safely | A style this feature does not implement is never guessed at (FR-007); it always falls back to today's existing scalar/JSON rendering and records an explicit, itemized `unresolved-parameter-style` limitation naming the operation, parameter, and style — the same pattern `authMapping.ts` already uses for `unsupported-auth-scheme`. | PASS |
| XVI. Executable Artifacts Must Be Deterministic / XXIV. Reproducibility | Same `ApiModel` + approved `TestModel` ⇒ byte-identical rendered URLs across repeated exports; array/object element order is taken verbatim from the generated value, never re-sorted or randomized. | PASS |
| XXVI. Specification Traceability | This plan traces every design decision to a specific FR/SC and to the 2026-09-14 Clarifications; no implementation decision contradicts spec.md. | PASS |
| XXVII. Prefer Simple Architecture | No new subsystem, service, or external dependency; one small pure module plus additive fields on two existing shared-domain types (`Parameter`, `GenerationLimitationKind`). | PASS |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | Extends the existing `Parameter` domain type additively; reuses `PostmanQueryParameter`'s existing `{key, value}[]` shape (already capable of repeated keys) rather than introducing a parallel URL-representation type. | PASS |

No violations requiring Complexity Tracking.

**Post-design re-check** (after Phase 0/1, research.md + data-model.md + contracts/): unchanged —
still PASS on every row above. The Phase 0 research decisions (percent-encode each element/property
individually while keeping a style's own separator character literal; extend the header `simple`-style
serializer to path parameters too, since OpenAPI 3.x defines `simple` identically for both
locations) each stay within the artifact-generation boundary this feature already scopes itself
to, and the Phase 1 contract adds only additive fields to `Parameter` and
`GenerationLimitationKind` — no existing field changes shape.

## Project Structure

### Documentation (this feature)

```text
specs/022-openapi-parameter-serialization/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── parameter-serialization.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/shared-domain/
└── src/
    ├── apiModel.ts             # Parameter gains optional style/explode fields
    └── postmanArtifact.ts      # extend GenerationLimitationKind with "unresolved-parameter-style"

backend/
├── src/
│   ├── openapi/
│   │   └── buildApiModel.ts        # extractParameters() reads p.style/p.explode when declared (no fabricated default persisted)
│   └── postman/
│       ├── parameterSerialization.ts   # NEW — resolveStyle(), serializeQueryParameter(), serializePathOrHeaderValue(), percent-encoding
│       ├── requestItem.ts              # buildUrl() calls parameterSerialization instead of toValueText/String() for path+query; header building calls it for the simple-style comma-join case
│       └── readme.ts                   # extend LIMITATION_HEADINGS for the new kind
├── tests/
│   ├── unit/openapi/
│   │   └── buildApiModel.test.ts       # extend: style/explode extraction, per-location default omission
│   ├── unit/postman/
│   │   ├── parameterSerialization.test.ts  # NEW
│   │   └── requestItem.test.ts             # extend: array/object query rendering, percent-encoding, unsupported-style fallback+limitation
│   └── fixtures/postman/
│       └── parameterFixtures.ts        # NEW — operations/parameters covering every implemented + unimplemented style, kept separate from exportFixtures.ts so every pre-existing scalar-parameter fixture stays byte-identical (SC-004)

frontend/
└── src/components/
    └── PostmanExportLimitations.tsx   # extend LIMITATION_HEADINGS for the new kind (TypeScript-enforced)
```

**Structure Decision**: No new project, workspace, or subsystem. All backend changes live inside
the existing `backend/src/postman/` artifact-generation module (one new sibling file,
`parameterSerialization.ts`, mirroring spec 021's `credentialProducers.ts` precedent for a small,
independently-testable pure module) and `backend/src/openapi/buildApiModel.ts` (additive
extraction only), plus additive fields on the existing `packages/shared-domain/src/apiModel.ts`
and `postmanArtifact.ts` contracts. The only `frontend/` change is the one-line heading
TypeScript's exhaustive `Record<GenerationLimitationKind, string>` requires — no new UI surface.

## Complexity Tracking

*No entries — Constitution Check reported no violations.*
