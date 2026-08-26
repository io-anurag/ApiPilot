# ApiPilot

ApiPilot is an AI-powered API test engineering platform that transforms OpenAPI/YAML
specifications into intelligent, executable API test suites.

This repository currently implements **AP-001: Application Foundation** — a local
npm-workspaces monorepo with a backend (Express/TypeScript), a frontend (React/Vite), and
a shared domain package, all wired together with a single dev/test workflow.

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
