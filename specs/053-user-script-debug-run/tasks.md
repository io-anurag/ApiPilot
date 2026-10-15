# Tasks: Debug Run for Run k6 Script

- [x] T001 Governance: constitution v3.1.0 (`.specify/memory/constitution.md`, mirror `specs/constitution.md`): the 2026-09-30 exception gains the Debug run and its conditions; spec 034 notes the amendment.
- [x] T002 `packages/shared-domain/src/userScriptDebug.ts`: `UserScriptDebugResult`, `UserScriptDebugExchange`, outcome and limits; exported (FR-001, FR-004, FR-007).
- [x] T003 `backend/src/performance/userScript/debug/parseDebugLog.ts`: `http-debug` records to raw exchanges (request, response, chunked, compressed, no response); console and other records dropped (FR-003, FR-004).
- [x] T004 `backend/src/performance/k6/runner.ts`: `buildUserScriptDebugK6Args` (pinned) (FR-002).
- [x] T005 `backend/src/performance/userScript/debug/debugRunService.ts`: preconditions, run directory and integrity check, the run, bounds, masking, reveal store, outcome, logging; `errors.ts` (FR-001, FR-005 to FR-007).
- [x] T006 `backend/src/api/userScripts.ts`: the three debug routes (FR-001, FR-005, FR-006).
- [x] T007 `frontend/src/services/userScriptClient.ts`, `components/userScript/useUserScriptDebugRun.ts`, `UserScriptDebugOutput.tsx` (shared parts exported from `requestChain/DebugRunOutput.tsx`), `UserScriptRunTrigger.tsx`, `ScriptWorkspace.tsx` (FR-008).
- [x] T008 Backend tests: parser, args, service (bounds, masking, privacy, not stored, determinism), routes.
- [x] T009 Frontend tests: output, trigger button and statements, workspace flow.
- [x] T010 Validate: affected tests, `npm run lint`, `npm run build`, `npm test`.
- [x] T011 Docs: specs/034 and 045 notes, `docs/USER_MANUAL.md`, `docs/architecture.md`, `docs/http-api.md`, `specs/ROADMAP.md` item 99, version bump.
- [x] T012 Drive it against real k6 (SC-004).
