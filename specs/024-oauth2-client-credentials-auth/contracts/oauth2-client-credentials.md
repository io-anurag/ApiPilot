# Contract: OAuth2 Client-Credentials Auth Support

This feature changes no HTTP request/response shape. `POST /api/test-models/postman-collection`'s
request (`PostmanCollectionExportRequest`) and response (`ExportOutcome`/`ExportResult`) are
unchanged in field count. This document pins down the observable contracts that *do* change: two
additive shared-domain unions, and the export's resulting behavior for a QA engineer reading
`ExportResult`.

## 1. `SecuritySchemeDefinition` (`packages/shared-domain/src/apiModel.ts`)

**Before**: `{ type: string; scheme?: string; in?: string; name?: string }`

**After**: adds optional `flows?: { clientCredentials?: { tokenUrl: string; scopes: string[] } }`.

Additive only. No existing consumer of `SecuritySchemeDefinition` reads a field that did not exist
before, so nothing that already compiles against this type is affected by the new optional field
being present or absent.

## 2. `PostmanAuth` (`packages/shared-domain/src/postmanArtifact.ts`)

**Before**: `{type:"bearer",...} | {type:"basic",...} | {type:"apikey",...}`

**After**: adds `{ type: "oauth2"; oauth2: PostmanAuthAttribute[] }`.

**Every current consumer of `PostmanAuth` in the codebase was checked for exhaustiveness**:

- `backend/src/postman/requestItem.ts` (`buildRequestItem`) — spreads `auth` into
  `request.auth` verbatim (`...(auth ? { auth } : {})`); never inspects `auth.type`. **Unaffected.**
- `backend/src/postman/generateCollection.ts`'s shared-auth hoisting
  (`authSignatures = new Set(allItems.map(item => item.request.auth ? JSON.stringify(...) : ""))`)
  — compares serialized auth blocks for equality; never inspects `type`. **Unaffected** — an
  `oauth2`-typed block is still hoistable to the collection level exactly like any other, if every
  item happens to share the identical block (uncommon in practice, since the token-fetch request's
  own `basic` auth always differs from a consuming request's `oauth2` auth — meaning collection-level
  hoisting simply won't trigger when both are present, which is correct: they are genuinely
  different auth configurations).
- No frontend file references `PostmanAuth` (confirmed via search — zero matches).

No exhaustive `switch`/discriminated-union check anywhere would fail to compile for the new case;
none needed a code change beyond `authMapping.ts`'s own `buildAuthMapping`, which is what
*produces* the new variant.

## 3. `SchemeVariablePlanEntry` (`backend/src/postman/authMapping.ts`, backend-internal — not
   exposed across the shared-domain boundary)

**Before**: `{type:"bearer",...} | {type:"apiKey",...} | {type:"basic",...}`

**After**: adds `{ type: "oauth2"; isPrimary; stem; variableNames: {clientId, clientSecret,
accessToken} }`.

**Every current consumer was checked**; two required an explicit exclusion to keep compiling
correctly (not merely to compile at all — see research.md D3 for why skipping, not handling, is
the *correct* behavior, not just the type-checker's price of admission):

| Consumer | Change required |
|---|---|
| `backend/src/postman/credentialProducers.ts` (`findCredentialProducers`) | Add `if (entry.type === "oauth2") continue;` |
| `backend/src/postman/generateCollection.ts` (`unresolvedCredentialProducerLimitations`) | Add `if (entry.type === "oauth2") continue;` |
| `backend/src/postman/generateCollection.ts` (`credentialVariableNamesFor`) | **No change** — its `if/else if` chain (no final `else`) already silently does nothing for an unmatched type; verified this is safe because its only consumer (`automaticChaining.ts`'s bearer/apiKey credential-chaining, specs/021/023) never needs an oauth2 entry — that mechanism and this feature's token-fetch synthesis are independent (research.md D3). |
| `backend/src/postman/authMapping.ts` (`buildAuthMapping`) | Add the new `oauth2` case — this is the function whose job is precisely to handle every classified type. |

## 4. `ExportResult` behavioral contract (no shape change)

| Field | Contract before this feature | Contract after this feature |
|---|---|---|
| `collection.item` | One folder per tag/path-segment, plus per-workflow folders, alphabetically sorted. | Also includes, when at least one required scheme is classified, one additional folder (working name `"OAuth2 Token Setup"`) positioned **first**, before the alphabetically-sorted rest (FR-004, research.md D5). |
| `limitations` (`kind: "unsupported-auth-scheme"`) | Emitted for every operation requiring an `oauth2`-typed scheme (100% of them — confirmed on the PayPal fixture: 22/22 operations). | No longer emitted for an operation requiring a scheme with a declared `clientCredentials` flow (FR-001, SC-001). Still emitted, unchanged, for `authorizationCode`/`implicit`/`password`-only oauth2 schemes and every other previously-unmappable case (User Story 3, SC-004). |
| `limitations` (`kind: "unresolved-credential-producer"`) | Never applied to an oauth2 scheme (the scheme was never classified, so it never reached this check). | Still never applied to an oauth2 scheme — now for the opposite reason: it is explicitly excluded (research.md D3), because it can never be "unresolved" under this feature's always-synthesize guarantee (FR-004). |
| `credentialProducers` | Never contains an oauth2 scheme. | Still never contains an oauth2 scheme (research.md D3) — identification-only discovery does not apply to it. |
| `environment.values` | `baseUrl` only, for a specification whose only scheme is oauth2 `clientCredentials`. | Also `clientId`, `clientSecret`, `accessToken` (or their `<stem>`-prefixed names for a non-primary scheme) — all `type: "secret"`, empty value (SC-002). |
| `summary.requestCount` | Counts every approved-scenario-derived request. | Also counts the synthesized token-fetch request(s) — one per classified, required scheme (SC-002). |
| `readme` | Coverage/Variables sections list whatever folders/variables exist. | Automatically lists the new folder and variables through the existing generic rendering — `readme.ts` needs no code change (confirmed: `coverageSection`/`variableSection` iterate `collection.item`/`variables` generically). |

## 5. Execution contract (`backend/src/execution/runExecution.ts`) — internal, not HTTP-exposed

**Before**: every item in the generated collection is assumed to carry a resolvable
`provenance.scenarioId`; an item without one throws and aborts the run.

**After**: an item with `provenance === undefined` (the synthesized token-fetch item, and only
that case today) is executed via the existing `runSingleItem` for its side effect on the shared
environment record, without being recorded as a `RequestResult` and without throwing (research.md
D6). An item that *does* carry a `scenarioId` that fails to resolve still throws, unchanged —
that remains a genuine inconsistency this feature does not relax.

## 6. Non-goals (explicitly unchanged)

- No new `GenerationLimitationKind` value.
- No new `ExportOptions` field. The token-fetch folder is not governed by
  `disableAutomaticChaining` (FR-008) — it was never a "chain" in that flag's sense.
- No change to `/dependencies/analyze`'s request or response shape, and no change to
  `backend/src/dependencies/*` — this feature is entirely inside `backend/src/postman/` (plus the
  one `execution/runExecution.ts` fix) and the two shared-domain additions above.
- No new `PostmanBody` mode (research.md D4) — the token-fetch request's form-encoded body reuses
  the existing `raw` mode with an explicit `Content-Type` header.
- No change to `CredentialProducerCandidate`'s shape.
- No frontend change (confirmed: no frontend file references `PostmanAuth`,
  `SchemeVariablePlanEntry`, or would need a new `GenerationLimitationKind` case).
