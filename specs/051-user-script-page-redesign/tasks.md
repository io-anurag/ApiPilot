# Tasks: Run k6 Script Page Redesign

Presentation only; no backend, contract or shared-domain change (FR-008). Paths are under `frontend/` unless stated.

- [x] T001 `src/components/userScript/ScriptPanel.tsx`: the card anatomy (accent bar, header with title, meta and state, body, optional footer), the state dot, the fact cell and the input class shared by the page (FR-001).
- [x] T002 `src/components/userScript/ScriptTabs.tsx`: the boxed view navigation with hints (FR-002).
- [x] T003 `src/components/userScript/ScriptEditor.tsx`: one document component with a read-only and an editable state, a top bar and a footer slot (FR-003).
- [x] T004 `src/components/userScript/ScriptList.tsx`, `ScriptProblems.tsx`: card, marked open row, structured refusal list (FR-001, FR-007).
- [x] T005 `src/components/userScript/ScriptWorkspace.tsx`: header card with facts, notices, views, Script view (document and check card) and Run setup view (cards, option cards, launch column) (FR-001 to FR-005).
- [x] T006 `src/components/userScript/UserScriptRunTrigger.tsx`, `ValueMappingEditor.tsx`, `UserScriptRunActivity.tsx`, `ScriptConfirmDialog.tsx`: launch card, mapping table and add row, run cards and history, confirmation dialog (FR-004 to FR-007).
- [x] T007 `src/pages/UserScriptPage.tsx`: plain top row with the actions, the list card and the new-script card (FR-001).
- [x] T008 Tests: `tests/unit/ScriptEditor.test.tsx`, `UserScriptPage.test.tsx`, `UserScriptRunSetup.test.tsx` (read-only and editing states, views and hints, launch card states, option cards, existing behaviour unchanged).
- [x] T009 Validate: the affected unit tests, `npm run lint`, `npm run build`, `npm test`.
- [x] T010 Docs: `docs/USER_MANUAL.md` (Run k6 Script), `docs/architecture.md`, `specs/ROADMAP.md` item 97, version bump.
- [x] T011 The running page was driven in headless Edge in both themes at 1280 px and 390 px: no horizontal overflow, no scrollbar on the views navigation. Not checked: a live, failed or reported run (needs k6), 320 px, a keyboard and screen-reader pass.
