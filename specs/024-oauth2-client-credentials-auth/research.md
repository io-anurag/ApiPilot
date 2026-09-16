# Phase 0 Research: OAuth2 Client-Credentials Auth Support for Postman Export

All Technical Context fields were resolved directly from the existing codebase; no
NEEDS CLARIFICATION markers remained after `/speckit.clarify` (three rounds on 2026-09-16 resolved
every open product decision). This document records the architecture decisions made while reading
`backend/src/postman/authMapping.ts`, `credentialProducers.ts`, `generateCollection.ts`,
`requestItem.ts`, `identifiers.ts`, `folders.ts`, `artifactVariables.ts`, `readme.ts`,
`backend/src/openapi/buildApiModel.ts`, `backend/src/execution/runExecution.ts`,
`mapNewmanResult.ts`, `packages/shared-domain/src/apiModel.ts` and `postmanArtifact.ts`, and
`node_modules/postman-runtime/lib/authorizer/oauth2.js` — each of which had a real, non-obvious
alternative or a fact the spec itself could not have anticipated without reading them.

## D1 — `SecuritySchemeDefinition` must gain `flows`; it currently carries none

**Decision**: `packages/shared-domain/src/apiModel.ts`'s `SecuritySchemeDefinition` gains an
optional field: `flows?: { clientCredentials?: { tokenUrl: string; scopes: string[] } }`.
`buildApiModel.ts`'s `extractSecuritySchemes` reads `value.flows.clientCredentials.tokenUrl`
(string) and derives `scopes` from `Object.keys(value.flows.clientCredentials.scopes)` — an
OpenAPI `scopes` object maps scope-identifier → human-readable description; only the identifiers
are needed for the grant request (FR-005), and identifiers are kept in declaration order (the
order `js-yaml`/`Object.entries` already preserves for the same input document), not re-sorted —
this is the most literal reading of spec FR-005's "verbatim," and declaration order is already
deterministic for a given document (constitution XXIV) without needing an arbitrary alphabetical
re-sort the specification's author didn't choose.

**Rationale**: Confirmed by reading `buildApiModel.ts:212-226` (`extractSecuritySchemes`) — it
extracts only `type`/`scheme`/`in`/`name` today; `flows` is not read at all. Every downstream piece
of this feature (`classifySchemeType`, the token-fetch request's `tokenUrl` and scope) depends on
this data existing on the domain type; without it, FR-001 and FR-005 have nothing to read from.

**Alternatives considered**:
- *Read `flows` from the raw OpenAPI document again inside `authMapping.ts`, bypassing
  `SecuritySchemeDefinition`.* Rejected: every other scheme detail already flows through
  `ApiModel.securitySchemes`; introducing a second raw-document read path for one field violates
  constitution X (Domain Model First) and IX (Separation of Concerns) for no benefit.

## D2 — `oauth2` `PostmanAuth`/`SchemeVariablePlanEntry` variants, and why Newman needs no custom script

**Decision**: `PostmanAuth` gains `{ type: "oauth2"; oauth2: PostmanAuthAttribute[] }`, with
attributes `accessToken` (`{{<accessToken var>}}`), `addTokenTo` (`"header"`), and `tokenType`
(`"bearer"`) — mirroring exactly the `bearer`/`basic`/`apikey` variants' shape
(`{key, value, type: "string"}[]`). `SchemeVariablePlanEntry` gains a matching
`{ type: "oauth2"; isPrimary; stem; variableNames: { clientId, clientSecret, accessToken } }`
variant.

**Rationale**: Read `node_modules/postman-runtime/lib/authorizer/oauth2.js` directly (the actual
code Newman — this app's own execution engine, `newmanRunner.ts` — runs to sign a request).
Its `sign()` step reads `accessToken`/`addTokenTo`/`tokenType` from the auth block and, when
`accessToken` is a non-empty resolved value, adds `Authorization: <headerPrefix><accessToken>` to
the request — automatically, with no pre-request script. This is exactly the same mechanism
`bearer` already relies on for `{{token}}` today; the only thing Postman's "Get New Access Token"
GUI button adds on top is a *convenience for obtaining* that value interactively — once something
else (here, this feature's synthesized token-fetch request, FR-004a) has already put a real value
into the referenced variable, Newman applies it exactly like a bearer token. This means the
consuming request's own auth block needs no custom script at all, and `requestItem.ts`'s
`buildRequestItem` (which already does `...(auth ? { auth } : {})` verbatim) needs **no change** —
it already forwards whatever `PostmanAuth` it is given.

**Alternatives considered**:
- *Represent the classified scheme as a `bearer`-typed auth block instead of adding a new
  `oauth2` variant* (Clarifications Option B, rejected by the user). Would have avoided a
  contract change but permanently mislabeled every OAuth2-derived request as if it used a plain
  bearer token, losing the ability for any future frontend/tooling consumer to distinguish the two.
- *Write a pre-request script on every consuming request that manually sets the Authorization
  header.* Rejected once D2's `postman-runtime` reading confirmed it is unnecessary — it would
  duplicate logic Newman already performs, and would need to be kept in sync with
  `postman-runtime`'s own header-prefix/token-type handling.

## D3 — `oauth2` is excluded from `credentialProducers.ts` and from `unresolvedCredentialProducerLimitations`, not merely unhandled

**Decision**: `credentialProducers.ts`'s `findCredentialProducers` gets a new
`if (entry.type === "oauth2") continue;` (alongside the existing `"basic"` exclusion).
`generateCollection.ts`'s `unresolvedCredentialProducerLimitations` gets the same exclusion, added
before its `variableNames` computation.

**Rationale**: Both functions loop over `plan: Map<string, SchemeVariablePlanEntry>` and, once
`SchemeVariablePlanEntry` becomes a 4-member discriminated union, `tsc` will not compile
`credentialProducers.ts:46`'s or `generateCollection.ts`'s existing ternary chains
(`entry.type === "bearer" ? ... : entry.type === "apiKey" ? ...`, `entry.type === "basic" ? ... :
entry.type === "bearer" ? ... : entry.type === "apiKey" ...`) without an explicit `oauth2` case —
the compiler itself forces this decision to be made, not merely surfaces it as a lint warning.
Skipping (rather than handling) is correct: `findCredentialProducers` exists to *discover* an
existing, unauthenticated operation in the specification as a scheme's credential source
(specs/021 FR-006) — an OAuth2 `clientCredentials` scheme never needs this, because its credential
source (the `tokenUrl`) is always explicitly declared on the scheme itself (Clarifications
2026-09-16, session note on D-parallel-to-021/023). Likewise, `unresolvedCredentialProducerLimitations`
exists to report a scheme that *could* end up with no way to obtain its credential — per FR-004,
an OAuth2 `clientCredentials` scheme's token-fetch request is always synthesized whenever at least
one approved scenario requires it, so it can never be "unresolved" in the sense that limitation
models; reporting it there would misrepresent a scheme this feature always resolves as one that
sometimes doesn't.

## D4 — The token-fetch request's body: `raw` mode with a manual Content-Type header, not a new `PostmanBody` variant

**Decision**: The token-fetch request's body is `{ mode: "raw", raw:
"grant_type=client_credentials" + (scopes.length ? "&scope=" + encoded-space-joined-scopes : ""),
options: { raw: { language: "text" } } }`, with an explicit `Content-Type:
application/x-www-form-urlencoded` header — reusing the existing `PostmanBody` shape verbatim,
the same way `requestItem.ts`'s existing text-body path already does for non-JSON content types.

**Rationale**: `PostmanBody` (`packages/shared-domain/src/postmanArtifact.ts`) models only
`mode: "raw"` today — there is no `urlencoded` mode. Postman/Newman's request dispatch sends
whatever bytes `raw` contains with whatever `Content-Type` header is present on the request; the
`body.mode` value is primarily a hint for Postman's own UI editor, not a requirement for correct
wire behavior. Reusing `raw` avoids a third shared-domain contract change for this feature and
keeps `buildBody`/`PostmanBody` untouched — this feature's new module builds its own
`PostmanRequestItem` directly (D5), so it does not need to route through `requestItem.ts`'s
`buildBody` at all.

**Alternatives considered**:
- *Add a `urlencoded` `PostmanBody` variant.* Rejected: a real, more "native" representation, but
  an unnecessary third contract change for a body Newman renders identically either way; revisit
  only if a future feature needs Postman's own form-editor UI to display these fields specially.

## D5 — The synthesized item lives in its own, always-first folder — never mixed into the alphabetical tag-folder sort

**Decision**: A new module, `backend/src/postman/oauth2TokenFetch.ts`, builds one
`PostmanRequestItem` per classified OAuth2 `clientCredentials` scheme that at least one approved
scenario (standalone or workflow) requires, and wraps them in one folder, `"OAuth2 Token Setup"`
(or a similarly literal name — finalized in data-model.md), sorted among themselves by scheme key
(`compareCodeUnits`) for determinism. `generateCollection.ts` prepends this folder (when non-empty)
*before* `[...workflowFolders, ...standaloneFolders].sort(...)`, never inside that sorted list.

**Rationale**: `generateCollection.ts:462-464` sorts every folder — workflow and standalone alike —
alphabetically by name (`compareCodeUnits(left.name, right.name)`). Postman/Newman execute
`collection.item` strictly in array order, folder by folder, item by item — there is no other
lever for "runs before everything else" than array position. Relying on the folder's *name*
sorting first alphabetically would be fragile (a future tag folder literally named `"AAA"` would
sort before it) and does not actually express the real requirement ("before every request
requiring *this scheme*" — trivially satisfied, and far simpler to reason about, by "before every
request, period"). Prepending unconditionally, outside the sort, is the only construct that keeps
this guarantee independent of any other folder's name.

**Alternatives considered**:
- *Give the folder a name engineered to always sort first (e.g. a leading punctuation
  character).* Rejected: fragile, and a purely cosmetic workaround for a positioning requirement
  the code should express directly.
- *Insert the token-fetch item as the first item of every existing folder that needs the scheme.*
  Rejected: duplicates the item once per folder (violates FR-004's "exactly one token-fetch
  request" per scheme) and complicates `groupAndName`'s existing per-folder disambiguation for no
  benefit — a single dedicated folder is simpler and still satisfies the ordering requirement.

## D6 — `runExecution.ts` must accept an item with no `scenarioId`, without inventing a synthetic scenario

**Decision**: `runExecution.ts`'s per-item loop is changed from
`if (!scenario) { throw new Error(...) }` to: when `item.provenance?.scenarioId` is `undefined`
(a synthesized item — the only case this can legitimately happen), execute it via `runSingleItem`
for its side effect (populating the environment) and continue the loop *without* calling
`mapNewmanResult`/`appendResult` for it. When `scenarioId` *is present* but does not resolve, the
existing `throw` is preserved unchanged — that remains a genuine bug signal, not a case this
feature introduces.

**Rationale**: This was not anticipated anywhere in spec.md — the spec discusses "the exported
collection" and "this app's own execution engine" without knowing this internal constraint.
Reading `runExecution.ts:138-143` and `mapNewmanResult.ts:96-106` directly shows both hard-require
a real `TestScenario` (`mapNewmanResult` reads `scenario.id`/`.operationPath`/`.operationMethod`
and calls `assertionTestPlan(scenario)`) — the synthesized token-fetch item has none of these and
was never meant to (constitution VIII: it is an artifact-layer construct, not a `TestScenario`).
Introducing a synthetic `TestScenario`-shaped object purely to satisfy this correlation would
create a fake domain entity with no real scenario behind it, misrepresenting provenance
(constitution XIII) for no benefit: the token-fetch item's own outcome does not need independent
visibility in the results UI, because whenever it fails, the *dependent* requests that actually
need the token visibly fail their own, real, scenario-backed `RequestResult` — satisfying spec
FR-004b ("every dependent request's authentication MUST visibly fail") without adding a second
reporting concept. This is only possible because FR-004 guarantees the token-fetch item is
synthesized exactly when at least one approved scenario in the *same* export requires it, so a
failure is never silently unobservable.

**Alternatives considered**:
- *Give `RequestResult`/`PostmanRequestItem.provenance` an optional "this is a setup step, not a
  scenario" flag and render it as its own row in the execution-results UI.* Rejected as
  disproportionate to what the spec actually requires (SC-006 only requires the *dependent*
  requests to authenticate; it does not ask for the setup step's own outcome to be independently
  visible) and would touch the frontend execution-results components this feature otherwise never
  needs to (constitution XXVII — Prefer Simple Architecture). Revisit if a future spec explicitly
  asks for setup-step visibility.

## D7 — Deterministic item id: same digest pattern as `itemIdForScenario`, keyed by scheme

**Decision**: `identifiers.ts` gains `itemIdForOAuth2TokenFetch(schemeKey: string): string`,
computed as `toUuid(digest(ITEM_NAMESPACE, `oauth2-token-fetch:${schemeKey}`))` — the same
`ITEM_NAMESPACE`/SHA-256 digest pattern `itemIdForScenario` already uses, distinguished only by a
literal prefix no real scenario id can collide with.

**Rationale**: `identifiers.ts` documents that every id is a pure function of content specifically
so identical input produces an identical id (FR-018/SC-002 precedent, now this feature's FR-007).
Reusing the existing `digest`/`toUuid` helpers rather than inventing a second id scheme keeps every
id in the collection generated the same way.

## D8 — Credential variables reuse `credentialVariable()`; `sensitiveValueDetection.ts`'s `CredentialKind` is deliberately not touched

**Decision**: `artifactVariables.ts`'s `ArtifactCredentialName` gains `"clientId" | "clientSecret"
| "accessToken"`, each with its own `CREDENTIAL_PURPOSE` entry, declared via the existing
`credentialVariable(kind, variableName)` helper — which already unconditionally sets
`secret: true` and an empty starting value. `backend/src/testDesign/sensitiveValueDetection.ts`'s
`CredentialKind` (`"token" | "apiKey" | "password"`) is **not** extended.

**Rationale**: `credentialVariable()`'s existing behavior (secret-marking, empty-by-default) is
exactly what constitution XVIII requires and needs no new logic — only new name/purpose entries.
`CredentialKind` is a different, unrelated mechanism (`credentialKindForField`/
`credentialKindForHeader`, used to detect and redact an accidentally-hardcoded credential inside
an *approved scenario's own* request body/headers) — extending it would change redaction behavior
for any request body field literally named `client_secret`, a scope change this feature's spec
never asked for and that deserves its own consideration if ever needed.

## D9 — `noNetwork.test.ts` and export-time network isolation are unaffected by construction

**Decision**: No change needed to `backend/tests/unit/postman/noNetwork.test.ts`; it is expected
to continue passing unmodified.

**Rationale**: `oauth2TokenFetch.ts` only *constructs* a `PostmanRequestItem` (a plain JSON-shaped
object) during `generateCollection()` — the actual HTTP call happens only later, inside
`runSingleItem`/`newman.run()`, which `generateCollection()` never calls. This mirrors exactly how
every other approved-scenario request is already generated without being executed (FR-023,
SC-012, this feature's own constraint), so the existing test's guarantee (`generateCollection`
never calls `fetch`/`http`/`https`) needs no new assertion — it already covers this feature's
output by construction.
