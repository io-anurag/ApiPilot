# Tasks: Recent Failures for Run k6 Script Runs

- [x] T001 `packages/shared-domain/src/liveRun.ts`: `FailureResponse` gains `{ kind: "not-captured"; reason: "user-script" }`; the `recentFailures` comment names both kinds (FR-001, FR-005).
- [x] T002 `backend/src/performance/report/userScriptAggregate.ts`: sample failed requests into a ring from the duration points, one per second per display name and status, and return them from `liveParts` (FR-001 to FR-004, FR-006).
- [x] T003 `frontend/src/components/liveRun/RecentFailuresList.tsx`, `LiveRunDashboard.tsx`: the `not-captured` row and the section text for a script run; Performance unchanged (FR-005, User Story 2).
- [x] T004 Backend tests: `tests/unit/performance/live/userScriptFailures.test.ts` (list from a capture, sampling, no-response, bound, newest first, privacy, not in the stored result) and the snapshot pass-through.
- [x] T005 Frontend tests: `tests/unit/RecentFailuresList.test.tsx`, `LiveRunDashboard.test.tsx` (not-captured row, text, no button; Performance unchanged; section shown for a script run).
- [x] T006 Validate: affected tests, `npm run lint`, `npm run build`, `npm test`.
- [x] T007 Docs: specs/045 (data model, contract, FR-005a note), `docs/USER_MANUAL.md`, `docs/architecture.md`, `specs/ROADMAP.md` item 98, version bump.
- [x] T008 Drive the live page against a real script with failing requests, if k6 is installed.
