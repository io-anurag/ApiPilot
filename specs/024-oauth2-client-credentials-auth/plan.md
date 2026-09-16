# Implementation Plan: OAuth2 Client-Credentials Auth Support for Postman Export

**Branch**: `024-oauth2-client-credentials-auth` | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/024-oauth2-client-credentials-auth/spec.md`

## Summary

Today, a security scheme of `type: oauth2` is never classified by `authMapping.ts`'s
`classifySchemeType` (only `http`/`bearer`, `http`/`basic`, and `apiKey` are recognized), so every
operation requiring one falls through to the generic `unsupported-auth-scheme` limitation and no
credential variable is provisioned at all — confirmed on the real PayPal Invoicing v2 fixture,
where all 22 operations hit this gap. This feature classifies an OAuth2 scheme that declares a
`clientCredentials` flow, provisions `clientId`/`clientSecret`/`accessToken` credential variables,
and — per the Clarifications' "fully automate" decision — synthesizes one token-fetch request per
required scheme that POSTs to the scheme's own declared `tokenUrl` using HTTP Basic auth (client
ID/secret), captures the resulting access token into the access-token variable, and is positioned
to run before every other request. Every other request needing the scheme references that
variable through a new, additive `oauth2` `PostmanAuth` variant — `postman-runtime` (Newman's
execution engine, confirmed by reading `node_modules/postman-runtime/lib/authorizer/oauth2.js`)
already applies the `Authorization: Bearer <accessToken>` header automatically once `accessToken`
resolves to a real value, exactly the same mechanism already relied on for `bearer` today; no
custom header-injection script is needed on the consuming request.

The technical approach requires three additive shared-domain changes (`SecuritySchemeDefinition`
gains `flows`, `PostmanAuth` gains an `oauth2` variant, `SchemeVariablePlanEntry` gains an
`oauth2` variant), extends `authMapping.ts`/`buildApiModel.ts`/`generateCollection.ts` to classify
and provision the scheme, adds one new backend-internal module that synthesizes the token-fetch
request and its own dedicated, always-first-run folder, and makes a small, targeted fix to
`runExecution.ts` (discovered during research, not anticipated in the spec) so this app's own
execution engine can run a request that has no backing `TestScenario` without throwing. No new
HTTP contract, no new persistence, no AI involvement, no frontend change (confirmed no frontend
file references `PostmanAuth` or `SchemeVariablePlanEntry`; `GenerationLimitationKind` gains no
new member, so the exhaustive `LIMITATION_HEADINGS` maps in `readme.ts`/
`PostmanExportLimitations.tsx` need no update).

## Technical Context

**Language/Version**: TypeScript 5.5 (`^5.5.4`), Node.js ≥20 (repo `engines.node`)

**Primary Dependencies**: Express 4.19 (`backend/src/api`), Newman `^6.2.2` (already a backend
dependency, used only at run time via `backend/src/execution/newmanRunner.ts` — this feature adds
no new npm dependency). The token-fetch request's actual HTTP execution at run time reuses the
existing `runSingleItem`/`newman.run()` path unchanged; only the *item this feature adds to the
collection* is new, not a new execution mechanism.

**Storage**: N/A — no new persistence. The stateless direct-export HTTP contract
(`PostmanCollectionExportRequest`/`ExportOutcome`) is unchanged in shape.

**Testing**: Vitest 4.1 (`vitest run`), Supertest 7.0 for the HTTP contract
(`backend/src/api/postmanCollections.ts`), following the existing fixture/assertion patterns in
`backend/tests/unit/postman/`, `backend/tests/unit/openapi/`, and `backend/tests/unit/execution/`.

**Target Platform**: Existing backend Node service; no new deployment target.

**Project Type**: Web service + shared library (existing npm-workspaces monorepo: `backend/`,
`packages/shared-domain/`). No `frontend/` change (confirmed above).

**Performance Goals**: No new performance target. Export-time cost is one new pure function per
classified scheme (negligible). Run-time cost is one additional HTTP request per required OAuth2
scheme per run — the same order of cost as any other request in the collection; no new latency
budget is introduced beyond the existing per-request `REQUEST_TIMEOUT_MS` (`newmanRunner.ts`).

**Constraints**: Must remain fully deterministic at export time (constitution II, XVI, XXIV) — the
synthesized item's content, id, and folder position are a pure function of the scheme's own
declaration, never randomness or a timestamp; the actual token-fetch *execution* at run time is
correctly non-deterministic in outcome (network call), exactly like every other request already
generated. Must never fabricate a `tokenUrl`, scope, or credential (spec FR-005, constitution I,
XIV, XIX). Must not send credentials via any mechanism other than the client's own declared
`tokenUrl` (spec FR-004c). Generating the artifact must still issue zero network requests
(constitution/spec: existing `noNetwork.test.ts`, SC-012/FR-023 — verified this feature's design
never calls `fetch`/`http`/`https` during `generateCollection`, only at run time).

**Scale/Scope**: Same representative scale as specs 007/019/021/023 (up to ~200 operations, 1–5
distinct security scheme keys); this feature adds no new scale dimension. At most one
synthesized token-fetch request per distinct OAuth2 `clientCredentials` scheme key, regardless of
how many operations require it.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Specification Is the Source of Truth | `tokenUrl` and scope identifiers are read verbatim from `flows.clientCredentials` (FR-001, FR-005); nothing about the client-authentication method is guessed — HTTP Basic auth is a resolved product decision (Clarifications), not an invented default. No endpoint, field, or status code is fabricated. | PASS |
| II. Deterministic Before AI | Scheme classification, variable provisioning, and token-fetch-request synthesis are pure deterministic functions of the `ApiModel`; no AI call anywhere in this feature. | PASS |
| VIII. Framework-Independent Test Model | The synthesized token-fetch request is built directly as a `PostmanRequestItem` (an artifact-layer concept, `backend/src/postman/`) from the `ApiModel`'s security scheme — it never becomes a `TestScenario`/`TestModel` entry, so the framework-independent domain layer gains no Postman-specific concept (research.md D6 addresses the one place this boundary is felt: `runExecution.ts`). | PASS |
| IX. Separation of Concerns | The new module lives beside `credentialProducers.ts`/`authCredentialRelationships.ts` in `backend/src/postman/` — the artifact-generation layer already owns "how a security scheme becomes a runnable request," and this feature extends that, not `backend/src/testDesign/` or `backend/src/dependencies/`. | PASS |
| XIV. No Silent Assumptions / XIX. Fail Safely | A scheme with no `clientCredentials` flow is never guessed at — it falls through to the existing, unchanged `unsupported-auth-scheme` limitation (FR-001, User Story 3). A token-fetch failure at run time is never retried or masked (FR-004b) — it surfaces as an ordinary failed `RequestResult` on the dependent requests that actually need the (missing) token. | PASS |
| XVI. Executable Artifacts Must Be Deterministic / XXIV. Reproducibility | Same `ApiModel` ⇒ byte-identical synthesized item, id, folder, and position across repeated exports (research.md D5, D7). | PASS |
| XVII. Security and Privacy by Design / XVIII. Secrets Must Never Be Part of Generated Artifacts | `clientId`/`clientSecret`/`accessToken` are declared via the existing `credentialVariable()` helper, which unconditionally marks a variable `secret: true` and starts it at an empty value (research.md D8) — no real secret is ever embedded in `collection.json`; only the *environment* artifact ever carries a value, and only when the engineer supplies one. | PASS |
| XXVI. Specification Traceability | Every design decision below traces to a specific FR/SC or to a Clarifications entry; no decision contradicts spec.md. One implementation-discovered fact not anticipated by the spec (the `runExecution.ts` scenario-correlation requirement) is resolved via research.md D6 rather than silently worked around. | PASS |
| XXVII. Prefer Simple Architecture | No new subsystem, service, or external dependency. The token-fetch request reuses the existing `raw`-mode `PostmanBody` (no new body-mode variant) and the existing `runSingleItem`/Newman execution path unchanged (research.md D4). | PASS |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | Extends `SecuritySchemeDefinition`, `PostmanAuth`, and `SchemeVariablePlanEntry` additively; introduces no parallel domain model for "a security scheme" or "a runnable request." | PASS |

No violations requiring Complexity Tracking.

**Post-design re-check** (after Phase 0/1, research.md + data-model.md + contracts/): unchanged —
still PASS on every row above. The Phase 0 discovery that `runExecution.ts` requires every item to
resolve to a `TestScenario` (D6) is resolved by *excluding* the synthesized item from
scenario-keyed result recording rather than inventing a parallel "synthetic scenario" concept —
keeping constitution VIII intact and adding no new shared-domain type for it.

## Project Structure

### Documentation (this feature)

```text
specs/024-oauth2-client-credentials-auth/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── oauth2-client-credentials.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/shared-domain/
└── src/
    ├── apiModel.ts           # SecuritySchemeDefinition gains `flows` (FR-001); no other apiModel.ts type changes
    └── postmanArtifact.ts    # PostmanAuth gains an additive `oauth2` variant (FR-003); no other field changes

backend/
├── src/
│   ├── openapi/
│   │   └── buildApiModel.ts        # extractSecuritySchemes() also extracts flows.clientCredentials.tokenUrl/scopes (FR-001)
│   ├── postman/
│   │   ├── authMapping.ts          # classifySchemeType() recognizes oauth2/clientCredentials; SchemeVariablePlanEntry gains an "oauth2" variant; buildAuthMapping() emits the oauth2 PostmanAuth block (FR-002, FR-003)
│   │   ├── artifactVariables.ts    # ArtifactCredentialName/CREDENTIAL_PURPOSE gain clientId/clientSecret/accessToken (FR-002)
│   │   ├── credentialProducers.ts  # findCredentialProducers(): skip "oauth2" entries — never producer-discovered (FR-004's rationale)
│   │   ├── oauth2TokenFetch.ts     # NEW — synthesizes the token-fetch PostmanRequestItem + its dedicated folder (FR-004, FR-004a, FR-004c)
│   │   ├── identifiers.ts          # itemIdForOAuth2TokenFetch(schemeKey) — deterministic id, same digest pattern as itemIdForScenario
│   │   └── generateCollection.ts   # unresolvedCredentialProducerLimitations(): skip "oauth2" entries; folders composition: oauth2 setup folder(s) always prepended before the existing alphabetical sort (FR-008)
│   ├── execution/
│   │   └── runExecution.ts         # accepts an item whose provenance carries no scenarioId (the synthesized item): executes it via runSingleItem for its side effect, does not call mapNewmanResult/appendResult for it, does not throw (D6 — discovered during research, not anticipated by spec.md)
│   └── (no api/ change — PostmanCollectionExportRequest/ExportOutcome shapes are unchanged)
├── tests/
│   ├── unit/openapi/
│   │   └── buildApiModel.test.ts          # extend: flows.clientCredentials extraction
│   ├── unit/postman/
│   │   ├── authMapping.test.ts            # extend: oauth2 classification, PostmanAuth shape, variable naming
│   │   ├── credentialProducers.test.ts    # extend: oauth2 entries never produce a candidate
│   │   ├── oauth2TokenFetch.test.ts       # NEW
│   │   ├── generateCollection.test.ts     # extend: end-to-end oauth2 export, folder position, no unresolved-credential-producer for oauth2
│   │   ├── noNetwork.test.ts              # unchanged — re-run to confirm still green (generation issues no request)
│   │   └── readme.test.ts                 # extend: coverage/variables sections include the new folder/variables generically (no new heading)
│   └── integration/execution/
│       └── executionRuns.test.ts          # extend: an approved scenario set requiring a classified oauth2 scheme runs the token-fetch item first without throwing and without its own RequestResult (runExecution.ts has no dedicated unit test today — confirmed no test file imports it directly; it is exercised only through this HTTP-level integration test, so the new coverage is added here, consistent with how it is already tested)
└── (no frontend/ change)
```

**Structure Decision**: No new project, workspace, or subsystem. All backend changes live inside
the existing `backend/src/postman/` artifact-generation module (one new sibling file,
`oauth2TokenFetch.ts`) plus targeted extensions to `authMapping.ts`, `credentialProducers.ts`,
`generateCollection.ts`, and `openapi/buildApiModel.ts`; one small, targeted fix in
`backend/src/execution/runExecution.ts` (research.md D6); two additive shared-domain contract
changes. No `frontend/` change.

## Complexity Tracking

*No entries — Constitution Check reported no violations.*
