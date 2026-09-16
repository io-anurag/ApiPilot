# Phase 1 Data Model: OAuth2 Client-Credentials Auth Support for Postman Export

All types below are additive to existing `packages/shared-domain` contracts (`apiModel.ts`,
`postmanArtifact.ts`) or are new/extended, backend-internal types (`backend/src/postman/*`) not
exposed across the shared-domain boundary. No existing field is renamed, removed, or given a
breaking type change.

**Mapping from spec.md's Key Entities**: "OAuth2 Client-Credentials Scheme" is the extended
`SecuritySchemeDefinition` below. "Client Credential Variables" are three `ArtifactVariable`s
declared via the extended `credentialVariable()`. "OAuth2 Token-Fetch Request" is the
`PostmanRequestItem` built by the new `oauth2TokenFetch.ts` module. "Non-Automatable OAuth2
Scheme" needs no new type — it is simply a scheme `classifySchemeType` does not classify, falling
through to the existing, unchanged `unsupported-auth-scheme` path.

## Extended (shared-domain): `SecuritySchemeDefinition` (`packages/shared-domain/src/apiModel.ts`)

```ts
// Before
export interface SecuritySchemeDefinition {
  type: string;
  scheme?: string;
  in?: string;
  name?: string;
}

// After (FR-001)
export interface SecuritySchemeDefinition {
  type: string;
  scheme?: string;
  in?: string;
  name?: string;
  /** Present only for `type: "oauth2"` when the specification declares a `clientCredentials`
   *  flow; absent for every other scheme and for an oauth2 scheme with no such flow. Read
   *  verbatim from the specification (FR-001) — never inferred. */
  flows?: {
    clientCredentials?: {
      tokenUrl: string;
      /** Scope identifiers, in declaration order (research.md D1) — never the scopes object's
       *  description text. */
      scopes: string[];
    };
  };
}
```

### Rules encoded by the extended `extractSecuritySchemes` (`backend/src/openapi/buildApiModel.ts`)

| Rule | Spec reference |
|---|---|
| `flows.clientCredentials.tokenUrl` is read only when it is a non-empty string; otherwise `flows` is omitted for that scheme (never a fabricated placeholder URL). | FR-001, constitution I |
| `flows.clientCredentials.scopes` (an object) is converted to its key list, preserving declaration order, defaulting to `[]` when the object is empty or absent. | FR-005 |
| A scheme with `flows.authorizationCode`/`.implicit`/`.password` but no `.clientCredentials` gets no `flows` field at all (this feature only ever reads `clientCredentials`). | FR-001, Edge Cases |

## Extended (shared-domain): `PostmanAuth` (`packages/shared-domain/src/postmanArtifact.ts`)

```ts
// Before
export type PostmanAuth =
  | { type: "bearer"; bearer: PostmanAuthAttribute[] }
  | { type: "basic"; basic: PostmanAuthAttribute[] }
  | { type: "apikey"; apikey: PostmanAuthAttribute[] };

// After (FR-003)
export type PostmanAuth =
  | { type: "bearer"; bearer: PostmanAuthAttribute[] }
  | { type: "basic"; basic: PostmanAuthAttribute[] }
  | { type: "apikey"; apikey: PostmanAuthAttribute[] }
  | { type: "oauth2"; oauth2: PostmanAuthAttribute[] };
```

An `oauth2`-typed block's `oauth2` array always carries exactly these three attributes (mirroring
`postman-runtime`'s `OAUTH2_PARAMETERS`, research.md D2):

| `key` | `value` | Fixed/variable |
|---|---|---|
| `accessToken` | `{{<accessToken variable name>}}` | Variable reference — resolved by Newman/Postman at run time, never a literal token. |
| `addTokenTo` | `"header"` | Fixed. |
| `tokenType` | `"bearer"` | Fixed. |

Used on a *consuming* request (one whose operation requires the scheme) — never on the token-fetch
request itself, which uses the existing `basic` variant instead (see below).

## Extended (backend-internal): `SchemeVariablePlanEntry` (`backend/src/postman/authMapping.ts`)

```ts
// Before
export type SchemeVariablePlanEntry =
  | { type: "bearer"; isPrimary: boolean; stem: string; variableNames: { token: string } }
  | { type: "apiKey"; isPrimary: boolean; stem: string; variableNames: { apiKey: string } }
  | { type: "basic"; isPrimary: boolean; stem: string; variableNames: { username: string; password: string } };

// After (FR-002, FR-003)
export type SchemeVariablePlanEntry =
  | { type: "bearer"; isPrimary: boolean; stem: string; variableNames: { token: string } }
  | { type: "apiKey"; isPrimary: boolean; stem: string; variableNames: { apiKey: string } }
  | { type: "basic"; isPrimary: boolean; stem: string; variableNames: { username: string; password: string } }
  | {
      type: "oauth2";
      isPrimary: boolean;
      stem: string;
      variableNames: { clientId: string; clientSecret: string; accessToken: string };
    };
```

`buildPlanEntry`'s naming rule extends uniformly (specs/021 FR-001-004's own convention): the
primary (first-declared) oauth2 scheme gets `clientId`/`clientSecret`/`accessToken`; any
additional, distinctly-keyed oauth2 scheme gets `<stem>ClientId`/`<stem>ClientSecret`/
`<stem>AccessToken`.

### Rules encoded by the extended `classifySchemeType` (`backend/src/postman/authMapping.ts`)

| Rule | Spec reference |
|---|---|
| `scheme.type === "oauth2" && scheme.flows?.clientCredentials !== undefined` → `"oauth2"`. | FR-001 |
| An oauth2 scheme with no `clientCredentials` flow → `undefined` (falls through to the existing `unsupported-auth-scheme` path, unchanged). | FR-001, User Story 3 |

### Rules encoded by the extended `buildAuthMapping` (`backend/src/postman/authMapping.ts`)

| Rule | Spec reference |
|---|---|
| Emits `{ type: "oauth2", oauth2: [accessToken, addTokenTo, tokenType] }` per the table above. | FR-003 |
| Declares three `ArtifactVariable`s via `credentialVariable("clientId", ...)`, `credentialVariable("clientSecret", ...)`, `credentialVariable("accessToken", ...)` — all `secret: true`, empty value (research.md D8). | FR-002 |

## Extended (backend-internal): `findCredentialProducers` / `unresolvedCredentialProducerLimitations`

Both gain `if (entry.type === "oauth2") continue;` (research.md D3) — an oauth2 scheme never
appears in `ExportResult.credentialProducers` and never produces an
`unresolved-credential-producer` limitation. No other behavior for `bearer`/`apiKey`/`basic`
changes.

## New (backend-internal): `backend/src/postman/oauth2TokenFetch.ts`

```ts
import type {
  ApiOperation,
  PostmanFolder,
  PostmanRequestItem,
  SchemeVariablePlanEntry,
  SecuritySchemeDefinition,
} from "@apipilot/shared-domain";

/**
 * Builds one PostmanRequestItem per classified OAuth2 clientCredentials scheme that at least one
 * of the given operations requires (FR-004), wrapped in one dedicated folder positioned to run
 * before every other folder (research.md D5). Returns an empty array when no required operation
 * needs a classified oauth2 scheme (spec Acceptance Scenario: "no unused artifact").
 */
export function buildOAuth2SetupFolders(
  requiredOperations: ApiOperation[],
  securitySchemes: Record<string, SecuritySchemeDefinition>,
  plan: Map<string, SchemeVariablePlanEntry>,
): PostmanFolder[];
```

### Rules encoded by `buildOAuth2SetupFolders` (traces to spec FRs)

| Rule | Spec reference |
|---|---|
| A scheme key qualifies only when `plan.get(key)?.type === "oauth2"` **and** at least one operation in `requiredOperations` declares it as its first security requirement's first scheme (mirrors `mapOperationAuth`'s own precedence rule, matching spec 023 research.md D4's precedent). | FR-004 |
| Zero qualifying operations for a scheme ⇒ no item, no folder entry for it (Acceptance Scenario: no unused artifact). | FR-004, Acceptance Scenario 3 |
| One `PostmanRequestItem` per qualifying scheme key; `id` = `itemIdForOAuth2TokenFetch(schemeKey)` (research.md D7); `name` = `` `Obtain access token — ${schemeKey}` ``. | FR-004, FR-007 |
| `request.method = "POST"`; `request.url` = the scheme's `tokenUrl`, resolved against `{{baseUrl}}` when relative (Edge Cases), else used verbatim when already absolute. | FR-004, Edge Cases |
| `request.auth = { type: "basic", basic: [{key:"username", value:"{{<clientId var>}}"}, {key:"password", value:"{{<clientSecret var>}}"}] }` (research.md D2 — the token-fetch request itself uses `basic`, never the new `oauth2` variant). | FR-004c |
| `request.body` = the `grant_type=client_credentials[&scope=...]` raw/text body (research.md D4); `request.header` includes `Content-Type: application/x-www-form-urlencoded`. | FR-004c, FR-005 |
| `request.event` (test script) sets the scheme's `accessToken` variable from the JSON response's `access_token` field via `pm.environment.set(...)` — unconditionally attempted; a non-2xx or malformed response simply yields no usable value, never a thrown script error that would abort the run (FR-004b, mirrors the "explicit failure surfaces on the dependent request" design in research.md D6). | FR-004a, FR-004b |
| `provenance` is **omitted** entirely (no `scenarioId`) — this is the signal `runExecution.ts` (research.md D6) uses to recognize a synthesized, non-scenario item. | Constitution VIII; research.md D6 |
| Every qualifying scheme's item is wrapped in one shared folder, name TBD at implementation (`"OAuth2 Token Setup"` is the working name used throughout this plan), items sorted by scheme key (`compareCodeUnits`). | FR-004, FR-007 |

## Extended: `generateCollection.ts` folder composition

```ts
// Before
const folders = [...workflowFolders, ...standaloneFolders].sort((left, right) =>
  compareCodeUnits(left.name, right.name),
);

// After (FR-004, FR-008, research.md D5)
const oauth2SetupFolders = buildOAuth2SetupFolders(
  [...standaloneResolved, ...workflowResolved].map((pair) => pair.operation),
  apiModel.securitySchemes,
  plan,
);
const folders = [
  ...oauth2SetupFolders,
  ...[...workflowFolders, ...standaloneFolders].sort((left, right) =>
    compareCodeUnits(left.name, right.name),
  ),
];
```

`oauth2SetupFolders` is computed unconditionally — not gated behind
`ExportOptions.disableAutomaticChaining` (FR-008; research.md notes this is not a "chain" in the
specs/019/021/023 sense at all, so that flag's scope never applied to it in the first place).

## Extended: `backend/src/execution/runExecution.ts`

```ts
// Before
const scenarioId = item.provenance?.scenarioId;
const scenario = scenarioId ? scenarioById.get(scenarioId) : undefined;
if (!scenario) {
  throw new Error(`Execution item at position ${index} carries no resolvable scenarioId.`);
}
// ... always calls runSingleItem + mapNewmanResult + appendResult

// After (research.md D6)
const scenarioId = item.provenance?.scenarioId;
if (scenarioId === undefined) {
  // A synthesized, non-scenario item (e.g. an OAuth2 token-fetch request). Execute it for its
  // side effect on `environmentRecord`; its own outcome is not independently reported — a
  // failure surfaces via whichever dependent, scenario-backed request actually needs the token.
  const itemOutcome = await runSingleItem({ item, collectionAuth: ..., declaredVariables: ..., environment: environmentRecord });
  environmentRecord = itemOutcome.environment;
  continue;
}
const scenario = scenarioById.get(scenarioId);
if (!scenario) {
  throw new Error(`Execution item at position ${index} carries no resolvable scenarioId.`);
}
// ... unchanged for a real scenario
```

`executionOrder()` is unaffected: a synthesized item has `provenance === undefined`, so it is
already classified as "standalone" by the existing `item.provenance?.workflowId !== undefined`
filter — no new branch needed there. Its position within `standaloneItems` is inherited from its
position in `outcome.result.collection.item` (already first, per D5), preserved by
`executionOrder`'s stable filter/concat.

## Reused types (no data-model change — listed for traceability)

- `PostmanBody`, `PostmanRequest`, `PostmanRequestItem`, `PostmanFolder` —
  `packages/shared-domain/src/postmanArtifact.ts`. Unmodified; the token-fetch item is built as an
  ordinary value of these existing types (research.md D4).
- `credentialVariable()` — `backend/src/postman/artifactVariables.ts`. Unmodified function;
  `ArtifactCredentialName`'s value set and `CREDENTIAL_PURPOSE`'s key set both grow (research.md
  D8).
- `itemIdForScenario`'s underlying `digest`/`toUuid` helpers — `backend/src/postman/identifiers.ts`.
  Unmodified; reused by the new `itemIdForOAuth2TokenFetch` (research.md D7).
- `GenerationLimitationKind`, `LIMITATION_HEADINGS` (`readme.ts`,
  `PostmanExportLimitations.tsx`) — unmodified; this feature introduces no new limitation kind.
