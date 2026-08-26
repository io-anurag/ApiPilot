# Quickstart: Application Foundation

This guide validates that the local ApiPilot application foundation works end-to-end,
covering User Stories 1–3 in [spec.md](./spec.md).

## Prerequisites

- Node.js 20 LTS installed (`node --version`)
- npm (bundled with Node.js)
- A freshly cloned copy of this repository

## Setup

```powershell
npm install
```

Installs dependencies for all workspaces (`backend/`, `frontend/`, `packages/shared-domain`)
in a single step.

## Start the application (User Story 1)

```powershell
npm run dev
```

Expected outcome:

- The backend starts and listens locally (see [contracts/health-api.md](./contracts/health-api.md)).
- The frontend dev server starts and prints a local URL.
- Opening the printed URL in a browser shows the ApiPilot frontend shell.
- Requesting `GET /api/health` on the backend's local URL returns
  `{"status":"ok","timestamp":"..."}`.

Stopping (`Ctrl+C`) and re-running `npm run dev` MUST return the application to the same
working state (Acceptance Scenario 1.2).

## Extend the codebase (User Story 2)

1. Add a new route file under `backend/src/api/` and register it in `backend/src/app.ts`
   — no changes to `frontend/` or `packages/shared-domain` should be required.
2. Add a new type to `packages/shared-domain/src/index.ts` and import it from both
   `backend/` and `frontend/` to confirm it is reusable without duplication.

Expected outcome: both additions compile and run without touching unrelated modules,
validating FR-004, FR-005, FR-011.

## Run the automated tests (User Story 3)

```powershell
npm test
```

Expected outcome:

- Unit tests run for `backend/`, `frontend/`, and `packages/shared-domain`.
- Results clearly report pass/fail counts per workspace.
- Re-running with no code changes produces the same results (no flakiness).

## Validation Checklist

- [x] `npm install` completes without errors on a clean clone
- [x] `npm run dev` starts both frontend and backend; frontend loads in a browser
- [x] `GET /api/health` returns a 200 with the documented shape
- [x] No AI/cloud credentials are required at any step (FR-009, FR-010)
- [x] `npm test` passes 100% on a clean checkout (SC-002)
- [x] The whole flow above completes in under 10 minutes (SC-001)
