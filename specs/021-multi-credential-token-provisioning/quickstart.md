# Quickstart: Distinct-Credential Token Provisioning for Postman Export

This guide validates AP-021 at the deterministic generator and HTTP contract boundaries. It assumes
Node.js 20 LTS and npm dependencies are installed from the repository root.

## Prerequisites

- A valid ApiPilot checkout with dependencies installed.
- No AI provider involvement — this feature is entirely deterministic (constitution II); the mock
  AI provider configuration is irrelevant here.
- The existing Postman export fixtures (`backend/tests/fixtures/postman/exportFixtures.ts`), plus a
  new multi-scheme fixture (e.g. a second `http`/`bearer` scheme `adminAuth` alongside the existing
  `bearerAuth`) added by the implementation tasks.

## Focused Automated Checks

Run the Postman-related unit and integration tests from the repository root:

```powershell
npm run test -w backend -- tests/unit/postman/authMapping.test.ts tests/unit/postman/credentialProducers.test.ts tests/unit/postman/generateCollection.test.ts tests/integration/postmanCollection.test.ts
```

Expected outcomes:

- A specification declaring a single `bearerAuth` scheme (today's common case) produces the exact
  same `{{token}}` variable name and auth block as before this feature existed (SC-001).
- A specification declaring `bearerAuth` and `adminAuth` (both `http`/`bearer`) produces two
  environment variables, `{{token}}` and `{{adminToken}}`; operations referencing `bearerAuth`'s
  auth block reference `{{token}}`, operations referencing `adminAuth`'s reference `{{adminToken}}`
  (SC-002).
- Two distinctly-keyed `apiKey` schemes sharing the same header name still receive two distinct
  variables (Acceptance Scenario 3).
- With an unauthenticated `POST /auth/admin-login` as the specification's sole operation whose path
  contains `adminAuth`'s stem, `credentialProducers` in the export result contains one entry naming
  `adminAuth` → `adminToken` → `POST /auth/admin-login`, and no `unresolved-credential-producer`
  limitation is recorded for `adminAuth`.
- With no such operation (or two equally-plausible unauthenticated candidates), `credentialProducers`
  contains no entry for `adminAuth`, and the limitations list contains exactly one
  `unresolved-credential-producer` entry naming `adminAuth` and every operation that depends on it
  (SC-003).
- The `{{adminToken}}` (or equivalent) environment variable is always declared with an empty value —
  no request is fabricated to obtain it, and no literal credential value ever appears in `collection`,
  `readme`, or `environment`.
- Re-exporting the same specification twice produces byte-identical output (determinism, constitution
  XVI/XXIV).

Run the complete backend suite after the focused checks:

```powershell
npm run test -w backend
```

Run the frontend suite too, since `LIMITATION_HEADINGS` in `PostmanExportLimitations.tsx` must cover
the new `unresolved-credential-producer` kind for the app to type-check:

```powershell
npm run test -w frontend
```

## HTTP Contract Check

Start the backend using its normal development command, then submit an export request whose
`apiModel.securitySchemes` declares two `http`/`bearer` schemes (`bearerAuth`, `adminAuth`), with one
operation under each, plus an approved scenario for both operations in `testModel`. Use the JSON
example in
[contracts/distinct-credential-export.md](./contracts/distinct-credential-export.md) as a starting
point, saving it as `distinct-credential-request.json` and running:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/test-models/postman-collection `
  -ContentType 'application/json' `
  -Body (Get-Content .\distinct-credential-request.json -Raw)
```

Verify that the `200` response contains:

- Two entries in `environment.values`: `token` and `adminToken`, both `type: "secret"` with an empty
  `value`.
- The `adminAuth`-secured request's `auth.bearer` value is `{{adminToken}}`, not `{{token}}`.
- The `bearerAuth`-secured request's `auth.bearer` value is unchanged: `{{token}}`.
- `credentialProducers` is present (possibly empty) in the response body.
- No credential value anywhere in `collection`, `readme`, or `environment`.

Repeat the request with `apiModel.securitySchemes` reduced to a single scheme (delete `adminAuth`)
and verify the response is identical, field-for-field, to an export from before this feature existed
— proving SC-001's backward-compatibility guarantee holds over HTTP, not only inside unit tests.

## Validation Commands Before Handoff

```powershell
npm run build
npm run lint
npm test
```

The implementation is complete only when the focused distinct-credential checks and the
repository-wide validation commands pass without weakening existing tests or contracts (in
particular, existing single-scheme 007/016/019 export tests must continue to pass unchanged, per
SC-001).
