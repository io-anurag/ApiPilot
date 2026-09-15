# Quickstart: Automatic Auth-Credential Chaining

This guide validates AP-023 at the deterministic generator and HTTP contract boundaries. It assumes
Node.js 20 LTS and npm dependencies are installed from the repository root.

## Prerequisites

- A valid ApiPilot checkout with dependencies installed.
- No AI provider involvement — this feature is entirely deterministic (constitution II); the mock
  AI provider configuration is irrelevant here.
- A fixture specification declaring `bearerAuth` (`http`/`bearer`) with:
  - an unauthenticated `POST /auth/token` whose 2xx response documents exactly one string field
    (e.g. `token`), and
  - `GET /auth/token-info` (or similar) declaring `security: [{ bearerAuth: [] }]`.
  Extend `backend/tests/fixtures/postman/credentialFixtures.ts` with this shape if it is not already
  present.

## Focused Automated Checks

Run the affected unit and integration tests from the repository root:

```powershell
npm run test -w backend -- tests/unit/postman/credentialProducers.test.ts tests/unit/postman/authCredentialRelationships.test.ts tests/unit/postman/automaticChaining.test.ts tests/unit/postman/generateCollection.test.ts tests/integration/postmanCollection.test.ts
```

Expected outcomes:

- **User Story 1 (P1)**: given the fixture above, with an approved positive scenario for
  `POST /auth/token` and an approved scenario for `GET /auth/token-info` in the same export's
  standalone set (and a `WorkflowExportContext.automaticChaining` context, since automatic chaining
  is opt-in exactly as specs/019 established), the export's `readme` records an applied chain from
  `POST /auth/token` to `GET /auth/token-info`, the producing request's test script contains
  `pm.environment.set("token", ...)` (not a chain-derived name), and no `unresolved-credential-
  producer` limitation is recorded for `bearerAuth`.
- **User Story 2 (P2)**: with a second, distinctly-keyed scheme (`adminAuth`) and its own
  unauthenticated producer and consumers, the export records two independent chains, each
  populating only its own scheme's variable (`token` vs. `adminToken`) — never the other's.
- **User Story 3 (P3)**:
  - If the producer candidate's response documents two equally plausible string fields (e.g. `token`
    and `refreshToken`), no chain is created for that scheme, and `unresolved-credential-producer` is
    recorded for it.
  - If two unauthenticated operations both match the scheme's stem, no chain is created, and the
    same limitation is recorded.
- **Primary-scheme limitation widening** (Clarifications): a specification whose sole bearer
  scheme's login endpoint does *not* contain the scheme key's stem in its path/`operationId` now
  records `unresolved-credential-producer` for that scheme — this is new, correct behavior for this
  feature (research.md D3), not a regression.
- **`http`/`basic` stays unresolved**: a specification with a `basic` scheme and its own consumers
  never receives an automatic chain for it, and always falls through to the existing limitation
  (FR-002a) — `credentialProducers` never contains a `basic`-scheme entry.
- **Ordering guard (FR-015) unchanged**: if the collection's existing emission order would place a
  consumer before its producer, no chain is applied for that consumer (same guard as path-parameter
  chaining).
- **`ExportOptions.disableAutomaticChaining`**: with the flag set, no auth-credential chain is
  applied, and every dependent operation reports its ordinary limitation instead — no second opt-out
  flag exists (FR-008).
- Re-exporting the same approved input twice produces byte-identical output (SC-004).

Run the complete backend suite after the focused checks:

```powershell
npm run test -w backend
```

No frontend change is expected (`unresolved-credential-producer` already has a heading from specs/021),
but run it anyway to confirm:

```powershell
npm run test -w frontend
```

## HTTP Contract Check

Start the backend using its normal development command, then submit an export request whose
`apiModel` declares the `bearerAuth` scheme and the `POST /auth/token` / `GET /auth/token-info`
operations above, with `testModel` carrying an approved positive scenario for each, and
`workflowContext.automaticChaining` present (an empty `graph`/`cycles` is sufficient — this
feature's relationships are built internally from `apiModel`, not supplied by the caller). See
[contracts/auth-credential-chaining.md](./contracts/auth-credential-chaining.md) for the exact
`ExportResult` fields to check.

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/test-models/postman-collection `
  -ContentType 'application/json' `
  -Body (Get-Content .\auth-credential-request.json -Raw)
```

Verify that the `200` response contains:

- `POST /auth/token`'s request `event` includes a test script that sets `token` (not a
  `auto_..._token`-style derived name) from the response.
- `GET /auth/token-info`'s `auth.bearer` value is `{{token}}`, unchanged from before this feature —
  the auth block itself is not rewritten (FR-007).
- No `unresolved-credential-producer` limitation for `bearerAuth`.
- `summary.automaticChainCount` includes the auth-credential consumer.
- No credential value anywhere in `collection`, `readme`, or `environment` — `token`'s declared value
  stays empty in the environment artifact; only the *test script* captures it at run time.

## Validation Commands Before Handoff

```powershell
npm run build
npm run lint
npm test
```

The implementation is complete only when the focused auth-credential checks and the repository-wide
validation commands pass without weakening existing tests or contracts — in particular, every
existing path-parameter automatic-chaining test (specs/019) and every existing single/multi-scheme
auth-mapping test (specs/021) must continue to pass unchanged.
