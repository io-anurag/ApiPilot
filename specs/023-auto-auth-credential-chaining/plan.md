# Implementation Plan: Automatic Auth-Credential Chaining

**Branch**: `023-auto-auth-credential-chaining` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/023-auto-auth-credential-chaining/spec.md`

## Summary

Today, a token or API key obtained from one operation's response (e.g. `POST /auth/token`) never
reaches the Authorization header of another operation that declares the matching security scheme
(e.g. `GET /auth/token-info`), because `extractConsumerFields` (`backend/src/dependencies/
fieldExtraction.ts`) only turns declared request parameters/body fields into consumer candidates —
a security-scheme requirement lives in `operation.security`, which the dependency model has no
concept of as a consumer at all. This feature adds a new, additive `DependencyFieldLocation` value,
`"auth"`, representing that requirement; a new deterministic pass that identifies each scheme's
credential-producer candidate (reusing and, per Clarifications, extending
specs/021-multi-credential-token-provisioning's producer-discovery rule to the *primary* scheme of
each type, not only non-first-declared ones) and, when its documented response contains exactly one
plausible credential field, builds one `ApiDependencyRelationship` per consuming operation; and an
extension to `automaticChaining.ts` so those relationships are eligible for automatic chaining
alongside today's path-parameter relationships, populating exactly the credential variable
`authMapping.ts` already emits (`token`, `adminToken`, …) rather than a separate chain-scoped name.
`http`/`basic` schemes are excluded from credential capture throughout, consistent with
specs/021's existing exclusion (a response cannot issue a single value representing a
username+password pair).

The technical approach adds one new backend-internal module, `authCredentialRelationships.ts`,
computed at export time (inside `backend/src/postman/`, alongside `credentialProducers.ts`, not
inside the separate `/dependencies/analyze` pipeline — see research.md D1 for why); extends
`credentialProducers.ts`'s `findCredentialProducers` to also search primary schemes; extends
`automaticChaining.ts`'s eligibility filter, consumer-target discovery, and chain-application logic
to accept `"auth"`-location consumers and resolve to the credential variable name instead of an
auto-generated one; and widens `unresolvedCredentialProducerLimitations` in `generateCollection.ts`
to also cover an unresolved primary scheme. No new HTTP contract, no new persistence, no AI
involvement.

## Technical Context

**Language/Version**: TypeScript 5.5 (`^5.5.4`), Node.js ≥20 (repo `engines.node`)

**Primary Dependencies**: Express 4.19 (`backend/src/api`), no new runtime dependency — this
feature reuses existing `backend/src/postman/*`, `backend/src/dependencies/*`, and
`packages/shared-domain` modules only.

**Storage**: N/A — no new persistence; the existing stateless direct-export HTTP contract and
non-persistent `TestGenerationWorkflow`/`WorkflowExportContext` records are unchanged in shape
(only `ApiDependencyRelationship.consumer.location` gains a new possible value).

**Testing**: Vitest 4.1 (`vitest run`), Supertest 7.0 for the HTTP contract
(`backend/src/api/postmanCollections.ts`), following the existing fixture/assertion patterns in
`backend/tests/unit/postman/`, `backend/tests/unit/dependencies/`, and `backend/tests/fixtures/
postman/`.

**Target Platform**: Existing backend Node service; no new deployment target.

**Project Type**: Web service + shared library (existing npm-workspaces monorepo: `backend/`,
`packages/shared-domain/`). No `frontend/` change: `ExportResult`'s shape (`limitations`,
`credentialProducers`, `summary.automaticChainCount`, the rendered README) is unchanged in field
count — only which/how many entries those already-rendered fields contain changes, and every kind
value involved (`unresolved-credential-producer`) already has a frontend heading from specs/021.

**Performance Goals**: No new performance target. The new relationship-building pass is a bounded,
single-pass function over the specification's own `securitySchemes` (typically 1–5 entries) and
`operations` list, run once per export — negligible relative to the existing export pipeline's
scenario-generation and collection-assembly costs.

**Constraints**: Must remain fully deterministic (constitution II, XVI, XXIV) with no new AI
invocation (constitution V, VI); must never fabricate a producer/consumer relationship, credential
field, or scheme association beyond what the specification's own declared schemes, security
requirements, and response schemas evidence (spec FR-004, constitution I, XIV, XIX); must not alter
which operations are treated as requiring which security scheme, nor any operation's auth block
structure (spec FR-007); must not introduce a second opt-out flag (spec FR-008).

**Scale/Scope**: Same representative scale as 008/019/021 (up to ~200 operations, 1–5 distinct
security scheme keys); this feature adds no new scale dimension.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Specification Is the Source of Truth | A credential relationship is built only from a scheme key, an operation's declared `security` requirement, and a documented response schema already in the `ApiModel` — nothing about role/privilege is invented (spec FR-002–FR-004). | PASS |
| II. Deterministic Before AI | `findCredentialProducers` (extended) and the new `authCredentialRelationships.ts` are pure deterministic functions; no AI call anywhere in this feature. | PASS |
| IX. Separation of Concerns | The new module lives beside `credentialProducers.ts` in `backend/src/postman/`, not inside `automaticChaining.ts` (a distinct matching strategy, research.md D1) and not inside `backend/src/dependencies/` (would invert the existing one-directional `postman/` → `dependencies/` module dependency, research.md D1). | PASS |
| XIV. No Silent Assumptions / XIX. Fail Safely | Zero or ambiguous (2+) producer candidates, or zero/ambiguous (2+) plausible credential fields, is never guessed at (FR-004); it always falls back to the existing, now-widened `unresolved-credential-producer` limitation (research.md D3) rather than a silently empty or mis-wired variable. | PASS |
| XV. API Dependency Inference Must Be Conservative | Every auth-credential relationship is CONFIRMED only when the producer, its field, and the consumer set are each uniquely and deterministically identified (research.md D2); an ambiguous case produces no relationship, never a lower-confidence guess. | PASS |
| XVI. Executable Artifacts Must Be Deterministic / XXIV. Reproducibility | Same `ApiModel` ⇒ byte-identical relationships, chains, and limitations across repeated exports; no new non-deterministic input. | PASS |
| XVIII. Secrets Must Never Be Part of Generated Artifacts | The captured value is written into the same empty-by-default, `secret: true` `{{token}}`/`{{adminToken}}` variable `authMapping.ts` already declares; no credential value is embedded in the generated artifact. | PASS |
| XXVI. Specification Traceability | This plan traces every design decision to a specific FR/SC and to the 2026-09-15 Clarifications; no implementation decision contradicts spec.md. | PASS |
| XXVII. Prefer Simple Architecture | No new subsystem, service, or external dependency; one new ~40-line pure module, plus targeted extensions to three existing functions. | PASS |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | Extends the existing `DependencyFieldLocation`/`ApiDependencyRelationship` domain types additively; introduces no parallel domain model. | PASS |

No violations requiring Complexity Tracking.

**Post-design re-check** (after Phase 0/1, research.md + data-model.md + contracts/): unchanged —
still PASS on every row above. The Phase 0 decision to compute auth-credential relationships at
export time (D1) keeps `backend/src/dependencies/analyzeDependencies.ts` and the `/dependencies/
analyze` HTTP contract completely untouched; the Phase 1 data model adds one additive union member
to `DependencyFieldLocation` and no new shared-domain type (`CredentialProducerCandidate` is reused
unchanged from specs/021).

## Project Structure

### Documentation (this feature)

```text
specs/023-auto-auth-credential-chaining/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── auth-credential-chaining.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/shared-domain/
└── src/
    └── apiDependency.ts               # DependencyFieldLocation gains "auth" (FR-001); no other type changes

backend/
├── src/
│   ├── postman/
│   │   ├── credentialProducers.ts     # findCredentialProducers(): also search the primary scheme of each type (Clarifications Q1/Q3)
│   │   ├── authCredentialRelationships.ts  # NEW — builds one ApiDependencyRelationship per (resolved scheme, consuming operation)
│   │   ├── automaticChaining.ts       # isEligibleRelationship() accepts "auth" alongside "path"; new findAuthConsumerTargets(); applyChainGroup() branches on consumer.location for substitution + variable naming
│   │   ├── assertionScripts.ts        # WorkflowExtraction gains an optional pre-resolved variable-name override so an auth chain's capture writes to "token", not "chainId_token"
│   │   ├── generateCollection.ts      # authByOperation()/findCredentialProducers() computed before planAutomaticChains(); auth relationships merged into the graph passed in; unresolvedCredentialProducerLimitations() no longer skips the primary scheme
│   │   └── readme.ts                  # no new limitation kind (existing "unresolved-credential-producer" heading already covers the widened case); the Coverage section's "Automatically chained path parameters" line (readme.ts:54) is reworded — found during /speckit-analyze — since automaticChainCount now also counts auth-credential consumers
│   └── dependencies/
│       └── fieldExtraction.ts         # unchanged — producerFieldSchemas() reused, not modified
├── tests/
│   ├── unit/postman/
│   │   ├── credentialProducers.test.ts       # extend: primary-scheme discovery cases
│   │   ├── authCredentialRelationships.test.ts # NEW
│   │   ├── automaticChaining.test.ts          # extend: auth-consumer eligibility, variable naming, mixed producer-group split
│   │   └── generateCollection.test.ts         # extend: end-to-end auth-credential chain, unresolved-primary-scheme limitation
│   └── fixtures/postman/
│       └── credentialFixtures.ts               # extend with a producer-response-schema fixture (single vs. ambiguous credential field)
└── (no api/ change — PostmanCollectionExportRequest/ExportResult shapes are unchanged)
```

**Structure Decision**: No new project, workspace, or subsystem. All changes live inside the
existing `backend/src/postman/` artifact-generation module (one new sibling file,
`authCredentialRelationships.ts`) plus one additive union member on the existing
`packages/shared-domain/src/apiDependency.ts` contract. `backend/src/dependencies/` is read from
(via the already-imported `fieldExtraction.ts` helpers) but not modified, preserving the existing
one-directional `postman/` → `dependencies/` module dependency (research.md D1). No `frontend/`
change.

## Complexity Tracking

*No entries — Constitution Check reported no violations.*
