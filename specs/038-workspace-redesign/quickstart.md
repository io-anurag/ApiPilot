# Quickstart: Validating the Workspace Redesign

## Prerequisites

- Node.js 24 and the workspace installed (`npm install` at the repository root).
- Backend and frontend running: `npm run dev` (or each workspace's `dev` script). No AI model,
  k6 install or specification is needed for scenarios 1 to 5. Scenario 6 visits every view.
- A desktop browser. A second check at a phone width (390 × 844) uses the browser's device
  toolbar.

## Automated checks

```bash
npm test -w frontend      # all frontend unit tests, including the new ones
npm test                  # whole workspace
npm run lint
npm run build
```

Expected: everything passes. The only test changed for copy or structure is listed in plan.md
(SC-006).

## Scenario 1: Start screen (US1, FR-008 to FR-011)

1. Open the app with no workflow chosen.
2. Check the hero:
   - the eyebrow "API test engineering workspace";
   - the headline "Start with the **artifact** you have." with "artifact" in the accent colour;
   - the existing lead sentence;
   - on desktop, the illustration.
3. Check the three artifact choices and the workflows each one names:
   - OpenAPI specification: Guided Workflow, Quick performance test;
   - Postman collection: Import & Run Collection;
   - k6 script: Run k6 Script.
4. Check the five cards in order: Guided Workflow (with "Recommended"), Import & Run Collection,
   Quick performance test, Performance plans, Run k6 Script. Each has its colour, icon,
   description and arrow.
5. Activate "Quick performance test" from the OpenAPI choice, and note the view and that the tab
   menu shows. Go back to start and activate the Quick performance test card. The outcome must be
   the same (SC-002).

## Scenario 2: Above the fold (SC-001)

Set the viewport to 1366 × 657 (a 1366 × 768 window), at 100% zoom, in light then dark theme. The
"Launch a test session" heading must be visible without scrolling, with the cards directly below
it; the page must not look compressed (FR-012 as amended). A headless check:

```bash
chrome --headless=new --window-size=1366,657 --screenshot=fold.png http://localhost:5173/
```

## Scenario 3: Tabs keep behaviour (FR-013, FR-014)

1. Pick Import & Run Collection. Each tab shows a colour square before its unchanged label.
2. Pick Guided Workflow from a tab. The guided workflow hides the tab menu once it is in
   progress, exactly as before.
3. Use "Back to start". The chooser returns, and reselecting a workflow resumes it.

## Scenario 4: Command palette (US3, FR-015 to FR-020)

1. On the start screen, press Ctrl+K (⌘K on macOS):
   - the palette opens with the filter focused and the first entry active;
   - it lists five workflows and "Switch to dark theme" (or light), but no "Back to start".
2. Type `k6`. Only "Run k6 Script" remains. Press Enter. The view and tab menu match picking the
   card.
3. Press Ctrl+K again. "Back to start" is now offered. Press Down past the last entry; the
   highlight wraps to the first.
4. Press Escape. The palette closes and focus returns where it was.
5. Click into a request URL or any text field and press Ctrl+K. The palette must not open
   (FR-018).
6. Open any confirmation dialog and press Ctrl+K. The palette must not open.
7. Run "Switch to dark theme". The theme changes and survives a reload, as with the header
   control.
8. Start the guided workflow (tab menu hidden), open the palette, and pick Import & Run
   Collection. The result matches "Back to start" then its card; reselecting Guided Workflow
   resumes the run.
9. With the browser's network panel open, open and use the palette. No request is sent
   (SC-007).

## Scenario 5: Help dialog (US4, FR-021)

Click the ? button. The dialog "Keyboard shortcuts and workflows" lists the three shortcuts and
the five workflows with descriptions. Escape closes it and focus returns to the ? button.

## Scenario 6: One visual system (US2, SC-004, SC-005)

In dark theme, then light theme, visit the start screen and every view's main screens:
- Guided Workflow: Upload, API Review, Scenario Review, Postman Generation;
- Import & Run: import, editor, results;
- Quick performance test: upload, ready;
- Performance plans: list, editor tabs;
- Run k6 Script: add, workspace, runs.

Check:
- no green-black surface remains in dark theme;
- every heading is sans-serif;
- each workflow colour sits beside its name;
- method, status and provenance badges stay readable.

## Scenario 7: Narrow widths and reduced motion (FR-012, FR-023, FR-024)

1. At 390 px wide, the start screen stacks into one column with no horizontal page scroll. The
   illustration is hidden, and the header keeps the help, theme and connection controls
   reachable.
2. With the operating system's reduce-motion setting on, the cards, palette and dialog change
   without animation.
3. Tab through the header, artifact controls, cards and tabs. Each shows a visible focus ring.
