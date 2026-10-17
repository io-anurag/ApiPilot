# Quickstart: validating the sidebar shell and shared visual language

How to prove each user story end to end. Contracts: [routes](contracts/routes.md), [tokens](contracts/tokens.md), [home-data](contracts/home-data.md), [shell-accessibility](contracts/shell-accessibility.md). Model: [data-model.md](data-model.md).

## Prerequisites

- Node 24 and `npm install` at the repository root.
- A Chromium-based browser (Edge or Chrome) for the visual and keyboard checks. No browser tooling is added to the project.
- To avoid disturbing a dev server you already run, start isolated instances on other ports with the mock AI provider:
  - `BACKEND_PORT=4100 AI_PROVIDER_MODE=mock npm run dev -w backend`
  - `BACKEND_PORT=4100 FRONTEND_DEV_PORT=5183 npm run dev -w frontend`
  - then open `http://127.0.0.1:5183/`. (`npm run dev` at the root also works but its pre-step stops other ApiPilot dev servers.)

## Automated checks

| Command | Expected |
|---|---|
| `npm test` | All suites pass. Replaced tests are those listed in research D12; every other behaviour test passes unchanged (SC-005). |
| `npm test -w frontend -- contrast` | `contrast.test.ts` reports zero pairings below 4.5:1 (text) or 3:1 (control outlines, focus, graphics) in both themes (SC-003). |
| `npm test -w frontend -- colourTokens` | Zero hex colours, palette utilities, white-on-accent pairings, `data-section`/`wf-*` references or justified-text rules (SC-010). |
| `npm run lint` and `npm run build` | No errors; no unused exports left by the removed chooser and section catalog. |

## Seeding state for the screens

To see the Guided Workflow stages, Coverage and Home with data, start a workflow over the API with the same session cookie the browser uses, or simply use the UI: upload `backend/tests/fixtures/openapi/user-journeys.yaml` in Guided Workflow, continue through API Review and Deterministic Generation (AI enhancement is skipped under the mock provider). For a run in Import & Run, upload `backend/tests/fixtures/collections/*` and run it against a local stub target.

## Scenarios by user story

1. **Navigation (US1)**
   - From Home open each destination from the sidebar: the header names it, the sidebar marks it, the address changes (`#/import`, `#/performance`, `#/k6`, `#/coverage`, `#/guided/...`).
   - Start a Guided Workflow, open Import & Run, come back: the workflow is where it was, and no second `/api/external-collections` request is made on returning (watch the network panel).
   - Use Back and Forward across four destinations; refresh on each: the same destination opens.
   - Open `#/guided/scenarioReview` with no workflow, then with a workflow still on API Review, then `#/nonsense`: each opens the nearest valid screen with a notice and never a blank page (SC-011).
   - Locked stages in the sidebar do not open and state why; done stages open.
2. **Colour (US2)**
   - Switch theme with the header control, reload, confirm it is remembered; clear the stored choice and confirm the operating system preference applies.
   - Compare the two themes on every in-scope screen: primary actions are lime with dark text; no blue or section accents remain except method badges and the three logos.
   - Windows forced-colours mode: the current item and each state remain distinguishable.
3. **Patterns (US3)**
   - Open `/?mock=pattern-library` for the documented set (FR-014), then walk Home, Guided (API Review, Scenario Review), Import & Run, Performance, Run k6 Script and Coverage and confirm each group of content is one of those patterns.
   - Spot-check that every pre-existing control still works: bulk accept/reject and filters in Scenario Review, paging, the upload checks, the k6 confirmation dialog.
4. **Narrow (US4)**
   - At 390 and 320 px: the menu button opens the drawer; Tab stays inside; Escape, a destination choice and the dimming layer close it and focus returns to the button.
   - `document.documentElement.scrollWidth <= window.innerWidth` on every in-scope screen at 320, 390, 768, 1280 and 1920 px (SC-004).
5. **Home (US5)**
   - With no workflow: launch tiles work; no coverage number is shown; the coverage tile says a specification is needed.
   - After scenarios exist: coverage figures equal the Coverage screen's; next steps link to the right screens.
   - After a run in each of Import & Run, Performance and Run k6 Script: all three appear in Recent runs, newest first, each opening its results; a Debug run does not appear.
   - Stop the backend: Home still renders and the connection status says Disconnected.
6. **Dialogs (US6)**
   - Ctrl+K opens the palette; "Go to Home" navigates; help opens and closes with the keyboard and focus returns to its button; Ctrl+K is ignored inside a text field.
   - Paragraphs are left-aligned at 390 px.
7. **Reports (FR-026)**
   - Open the performance report and the run report (HTML and PDF) once with each theme chosen: they render unchanged.

## Visual matrix capture

A throwaway script (kept outside the product, as used while designing this feature) drives headless Edge or Chrome over the DevTools protocol: for each in-scope screen and for light and dark at 1440 and 390 px it sets the theme in local storage, opens the address, takes a full-page screenshot and records `scrollWidth`. Review the sheets against `design-reference/apipilot-design.html` (SC-001) and record the result in the feature's tasks.

## Done when

All automated checks pass; each scenario above is recorded as performed; the version is bumped with `npm run version:bump` and `README.md` and `specs/ROADMAP.md` are updated; no change is committed without the owner's review.
