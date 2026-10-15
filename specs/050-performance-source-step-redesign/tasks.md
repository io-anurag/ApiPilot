# Tasks: Performance Source Step Redesign

Presentation only; no backend, contract or shared-domain change (FR-006). Paths are under `frontend/` unless stated.

- [x] T001 Design the Source step as a light and a dark mock and review it (not committed).
- [x] T002 `src/components/performance/path/SourcePicker.tsx`: icon, description and "Needs ..." line per card; a check once a source is current; still buttons with `aria-pressed` (FR-001, FR-002).
- [x] T003 `src/components/performance/path/SourceDetailCard.tsx`: the card with the start screen's anatomy; state as dot plus word (FR-003).
- [x] T004 `src/components/performance/path/SourceStep.tsx`: the upload, the uploaded-specification summary and the note for the other sources inside the card; behaviour, test ids and labels unchanged (FR-003, FR-006).
- [x] T005 `src/components/performance/path/PerformancePath.tsx` (`PathFrame`): plain top row and one footer bar with the reason beside Next (FR-004, FR-005).
- [x] T006 Tests: `tests/unit/SourcePicker.test.tsx`, `SourceStep.test.tsx`, `PerformancePath.test.tsx` (card content, Ready/Required in words, other sources, no card when a plan exists, top row and footer).
- [x] T007 Validate: the affected unit tests, `npm run lint`, `npm run build -w frontend`, `npm test`.
- [x] T008 Docs: `docs/USER_MANUAL.md` section 5 (Source), `docs/architecture.md` (Unified Performance tab), `specs/ROADMAP.md` item 96, version bump.
- [x] T009 The running page was driven in headless Edge to the Source step and captured in both themes at 1280 px and 390 px: it matches the mock, there is no horizontal page overflow at 390 px and the tab bar has no vertical scrollbar. Not checked: 320 px, the upload and replace states in the real page (covered by unit tests), a real keyboard and screen-reader pass.
