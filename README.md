# ApiPilot

ApiPilot is an AI-powered API test engineering platform that transforms OpenAPI/YAML
specifications into intelligent, executable API test suites.

This repository currently implements:

- **AP-001: Application Foundation** — a local npm-workspaces monorepo with a backend
  (Express/TypeScript), a frontend (React/Vite), and a shared domain package, all wired
  together with a single dev/test workflow.
- **AP-002: OpenAPI Specification Engine** — upload an OpenAPI 3.x YAML specification and
  receive a normalized analysis of its operations, schemas, and security requirements (see
  [OpenAPI Specification Engine](#openapi-specification-engine) below).

## Setup

Prerequisites:

- Node.js 20 LTS (see [.nvmrc](./.nvmrc); `node --version`)
- npm (bundled with Node.js)

```powershell
npm install
```

Installs dependencies for every workspace (`backend/`, `frontend/`,
`packages/shared-domain`) in a single step.

Optionally copy [.env.example](./.env.example) to `.env` to override the default ports
(`BACKEND_PORT`, `FRONTEND_DEV_PORT`).

## Running the application

```powershell
npm run dev
```

This starts the backend and frontend dev servers in parallel:

- Backend: `http://localhost:4000` (health check at `GET /api/health`)
- Frontend: `http://localhost:5173` (opens the ApiPilot UI, proxies `/api/*` to the
  backend, so no CORS configuration is needed in development)

Stopping (`Ctrl+C`) and re-running `npm run dev` returns the application to the same
working state.

## Architecture

The repository is an npm-workspaces monorepo with three packages:

- `backend/` — Express + TypeScript HTTP API.
  - `src/app.ts` — Express app assembly: middleware, route registration, centralized
    error-handling middleware (never leaks stack traces; always returns a safe JSON
    `5xx` body).
  - `src/server.ts` — process entry point; reads configuration and starts the HTTP
    listener; handles startup failures (port in use, unsupported Node.js version)
    with actionable error messages.
  - `src/api/` — one file per route module (e.g., `health.ts`, `version.ts`).
- `frontend/` — React 18 + Vite 5 + TypeScript UI shell.
  - `src/App.tsx` — root component; shows backend connection status and a
    connection-error state if the backend is unreachable.
  - `src/services/` — API clients (e.g., `healthClient.ts`) that call the backend.
  - `src/components/` — reusable UI components (e.g., `VersionBadge.tsx`).
- `packages/shared-domain/` — framework-agnostic TypeScript types and small pure
  functions shared by both `backend/` and `frontend/` (e.g., `HealthStatus`,
  `VersionInfo`), imported as the `@apipilot/shared-domain` workspace package.

New backend routes and new shared types can be added without modifying unrelated
frontend/backend/shared files — see `backend/src/api/version.ts` and the `VersionInfo`
type in `packages/shared-domain/src/index.ts` for a worked example.

### OpenAPI Specification Engine module boundaries

The specification-analysis pipeline lives entirely in `backend/src/openapi/` and is kept
independent of Express so each stage is unit-testable in isolation:

- `parseYaml.ts` — YAML text → plain object; throws a typed `InvalidYamlError` on
  malformed input.
- `validateSpec.ts` — rejects non-OpenAPI-3.x documents via a typed
  `UnsupportedVersionError`; strips and flags external `$ref`s (never fetched over the
  network or filesystem); dereferences internal `$ref`s; flags any that remain
  unresolved or circular.
- `buildApiModel.ts` — walks the validated document to discover every operation and
  produce the `ApiModel` (operations, security schemes, and an `AnalysisSummary`),
  flagging duplicate operations and unsupported constructs (`callbacks`, `links`,
  `discriminator`, `oneOf`/`anyOf`/`allOf`, `webhooks`) instead of rejecting the upload.
- `errors.ts` — the typed error classes above, mapped to HTTP status codes by
  `app.ts`'s centralized error-handling middleware.

`backend/src/api/specifications.ts` wires these three stages together behind
`POST /api/specifications` (see [contracts/specifications-api.md](./specs/002-openapi-specification-engine/contracts/specifications-api.md)).
The `ApiModel` shape itself (`ApiModel`, `ApiOperation`, `Parameter`, `RequestBody`,
`Response`, `SchemaConstraint`, `SecurityRequirement`, `SecuritySchemeDefinition`,
`AnalysisSummary`, `AnalysisIssue`) is defined once in
`packages/shared-domain/src/apiModel.ts` and consumed unchanged by both the backend
pipeline and the frontend upload page.

## Testing

```powershell
npm test
```

Runs [Vitest](https://vitest.dev) once across all three workspaces (via
[vitest.workspace.ts](./vitest.workspace.ts)):

- `backend` — integration tests (Supertest against the Express app)
- `frontend` — component tests (React Testing Library, jsdom environment)
- `shared-domain` — unit tests

Output is grouped and labeled per workspace (e.g., `|backend|`, `|frontend|`,
`|shared-domain|`), so pass/fail results are easy to attribute. Re-running `npm test`
with no code changes produces identical results.

## Other scripts

- `npm run build` — builds all workspaces (TypeScript compilation; Vite production
  build for the frontend)
- `npm run lint` — runs ESLint across the repository

## OpenAPI Specification Engine

Upload an OpenAPI 3.x YAML specification (up to 10 MB) and receive a normalized,
read-only analysis — no data is persisted beyond the request.

1. Start the app with `npm run dev` and open the frontend at
   `http://localhost:5173`.
2. Under "Upload OpenAPI Specification", choose a `.yaml`/`.yml` file.
3. On success, the page shows an analysis summary (operation count, schema count,
   security scheme count, and any flagged issues), a list of discovered operations, and
   — once an operation is selected — its parameters, request body, responses, and
   security requirements.

Uploads are rejected (with a specific error) only for:

- Malformed YAML (`400 invalid_yaml`)
- A document that is not OpenAPI 3.x, e.g. Swagger 2.0 (`400 unsupported_version`)
- A file over the 10 MB limit (`413 file_too_large`)

Everything else — unresolved `$ref`s, circular references, external references, and
duplicate `operationId`/path+method combinations — is accepted and flagged as an
`AnalysisIssue` in the summary rather than rejecting the upload, since these are
ambiguities in the source specification, not reasons to fail. See
[specs/002-openapi-specification-engine/](./specs/002-openapi-specification-engine/)
for the full spec, plan, and API contract.
