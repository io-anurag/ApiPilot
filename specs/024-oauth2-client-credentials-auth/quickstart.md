# Quickstart: OAuth2 Client-Credentials Auth Support for Postman Export

This guide validates AP-024 at the deterministic generator, execution, and HTTP contract
boundaries. It assumes Node.js 20 LTS and npm dependencies are installed from the repository
root.

## Prerequisites

- A valid ApiPilot checkout with dependencies installed.
- No AI provider involvement — this feature is entirely deterministic (constitution II); the
  mock AI provider configuration is irrelevant here.
- The real fixture this feature was validated against is already in the repo:
  `backend/tests/fixtures/openapi/paypal-invoicing-v2.yaml`, which declares an `Oauth2` scheme
  with a `clientCredentials` flow (`tokenUrl: /v1/oauth2/token`, real scopes) required by all 22
  of its operations — the exact spec that originally surfaced this gap (see the earlier
  diagnostic pass referenced in this feature's spec.md).
- For a minimal, fast unit fixture, extend `backend/tests/fixtures/postman/*` with a small
  `ApiModel` declaring one `oauth2` scheme (`flows.clientCredentials.tokenUrl` +
  `scopes: { read: "..." }`) and one operation requiring it, mirroring the shape
  `credentialFixtures.ts`/`exportFixtures.ts` already use for `bearer`/`apiKey`.

## Focused Automated Checks

Run the affected unit tests from the repository root:

```powershell
npm run test -w backend -- tests/unit/openapi/buildApiModel.test.ts tests/unit/postman/authMapping.test.ts tests/unit/postman/credentialProducers.test.ts tests/unit/postman/oauth2TokenFetch.test.ts tests/unit/postman/generateCollection.test.ts tests/unit/postman/noNetwork.test.ts tests/unit/postman/readme.test.ts tests/integration/execution/executionRuns.test.ts
```

Expected outcomes:

- **User Story 1 (P1)**: given the PayPal fixture (or the minimal one), exporting the approved
  scenario set records **no** `unsupported-auth-scheme` limitation for the `Oauth2` scheme (down
  from all 22 operations before this feature), and the environment artifact contains `clientId`,
  `clientSecret`, and `accessToken` (all `type: "secret"`, empty value) in addition to `baseUrl`.
  The scheme's declared `tokenUrl` and scope identifiers appear verbatim in the synthesized
  token-fetch request (never fabricated).
- **User Story 2 (P1)**: the exported collection's `item` array's first folder is the OAuth2
  setup folder, containing exactly one request per required scheme. With real `clientId`/
  `clientSecret` values supplied and a reachable `tokenUrl` (mock it in the unit/integration test
  with a local HTTP server, following the pattern in `backend/tests/fixtures/execution/
  targetServer.ts`), running the collection via `runExecution.ts` executes the token-fetch request
  first, without throwing and without producing its own `RequestResult`, and every dependent
  request's Authorization header carries a real value. Deselecting/omitting the one scenario that
  requires the scheme (so no approved scenario needs it) produces **no** token-fetch item at all —
  verify this "no unused artifact" case explicitly.
- **User Story 2, failure path**: point the fixture's `tokenUrl` at an unreachable/rejecting
  target. The run still completes (`runExecution.ts`'s existing catch-and-continue semantics), the
  token-fetch item is not retried, and the dependent request's own `RequestResult` fails
  authentication (`unexpected-status` or a connectivity failure, depending on how the mock target
  fails) — confirm no fallback credential is substituted.
- **User Story 3 (P2)**: a fixture whose OAuth2 scheme declares only `authorizationCode` (no
  `clientCredentials`) still records `unsupported-auth-scheme` for every operation requiring it,
  identically to today's behavior — this is the regression guard.
- **Client-authentication method (FR-004c)**: the token-fetch request's own `auth` block is
  `type: "basic"` (client ID/secret), never `type: "oauth2"`; its body is
  `grant_type=client_credentials` (+ `scope=...` when scopes are declared) with a
  `Content-Type: application/x-www-form-urlencoded` header.
- **Determinism (FR-007, SC-005)**: re-exporting the same approved input twice produces
  byte-identical `collection`, `environment`, and `readme` output, including the synthesized
  item's `id` and folder position.
- **Export network isolation (constitution/SC-012, `noNetwork.test.ts`)**: re-run this existing
  test unmodified and confirm it still passes — `generateCollection()` must issue zero `fetch`/
  `http`/`https` calls even though this feature adds a request that *will* make a real call, but
  only later, at execution time.

Run the complete backend suite after the focused checks:

```powershell
npm run test -w backend
```

No frontend change is expected (confirmed: no frontend file references `PostmanAuth` or
`SchemeVariablePlanEntry`), but run it anyway to confirm:

```powershell
npm run test -w frontend
```

## HTTP Contract Check

Start the backend using its normal development command, then submit an export request whose
`apiModel` declares the `Oauth2`/`clientCredentials` scheme and at least one operation requiring
it, with `testModel` carrying an approved positive scenario for it. See
[contracts/oauth2-client-credentials.md](./contracts/oauth2-client-credentials.md) for the exact
`ExportResult` fields to check.

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/test-models/postman-collection `
  -ContentType 'application/json' `
  -Body (Get-Content .\oauth2-client-credentials-request.json -Raw)
```

Verify that the `200` response contains:

- `collection.item[0].name` is the OAuth2 setup folder, containing exactly one request whose
  `auth.type` is `"basic"` and whose `url` resolves the scheme's `tokenUrl`.
- Every other request requiring the scheme has `auth.type === "oauth2"` referencing
  `{{accessToken}}` (or the stem-prefixed name for a non-primary scheme).
- `environment.values` includes `clientId`/`clientSecret`/`accessToken`, each `type: "secret"`,
  `value: ""`.
- No `unsupported-auth-scheme` or `unresolved-credential-producer` limitation for the scheme.
- `summary.requestCount` includes the synthesized token-fetch request.
- No credential value anywhere in `collection`, `readme`, or `environment` — only the *names* of
  the empty-by-default variables appear; a real value would only ever be supplied by the engineer
  filling in the environment file.

## Real-Spec Validation (recommended before closing this feature)

Re-run the same diagnostic pipeline used to discover this gap against
`backend/tests/fixtures/openapi/paypal-invoicing-v2.yaml` end to end (build ApiModel → generate
TestModel → generate collection) and confirm: 0 of 22 operations report `unsupported-auth-scheme`
for the `Oauth2` scheme (down from 22/22 before this feature), and the collection's first folder
is the OAuth2 setup folder with exactly one token-fetch request.

## Validation Commands Before Handoff

```powershell
npm run build
npm run lint
npm test
```

The implementation is complete only when the focused OAuth2 checks and the repository-wide
validation commands pass without weakening existing tests or contracts — in particular, every
existing `bearer`/`basic`/`apiKey` auth-mapping test (specs/007/021/023) and every existing
execution test (specs/018) must continue to pass unchanged.
