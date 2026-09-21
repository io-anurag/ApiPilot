# Quickstart: Validating the Frontend Design System & Application Shell

## Prerequisites

- Node.js 20 LTS, repo dependencies installed (`npm install` at the repo root — npm workspaces).
- No backend changes are involved, but the guided workflow needs the backend running to reach
  every stage: `npm run dev -w backend` (or the repo's existing combined dev script).

## Run the frontend

```bash
npm run dev -w frontend
```

Open the printed local URL. Confirm both existing top-level tabs still load: "Guided Workflow"
and "Import & Run Collection".

## Manual validation scenarios (map to spec Acceptance Scenarios)

1. **Stage status and locking (User Story 1)** — Upload a spec and advance through Analysis.
   Confirm the shell/header area and `WorkflowStageTracker` agree on which stages are
   completed/active, and that any stage not yet reachable shows a reason (e.g. "Complete API
   Review first") rather than an unexplained disabled control.
2. **Shared component consistency (User Story 2)** — Compare a `StatusBadge` rendering in
   `WorkflowStageTracker` against one in `TestScenarioReviewList`/`ScenarioReviewStage`: same
   shape, tone mapping, and text-label-first rendering. Trigger a loading state, an empty result
   (e.g. a specification with zero flagged issues), and an error (e.g. stop the backend and
   reload) and confirm each uses the new shared `Skeleton`/`EmptyState`/`ErrorState` presentation
   instead of an ad hoc or blank result.
3. **Light/dark and responsive (User Story 3)** — Toggle the OS/browser color-scheme preference
   and reload; confirm every shared component (badges, buttons, the new dialog, empty/error/
   loading states) remains legible with no unstyled element. Resize the browser to a narrow
   width and confirm the header/navigation area adapts without introducing horizontal page
   scroll or hiding the current-stage indicator. Tab through the shell and the stage tracker with
   the keyboard only and confirm every control reachable this way shows a visible focus ring.
4. **No regression to in-progress work** — Exercise the "Import & Run Collection" tab
   (External Collections upload, list, and run panel) end-to-end and confirm its behavior is
   unchanged from before this feature.

## Automated validation

```bash
npm test -w frontend
npm run lint -w frontend
npm run build -w frontend
```

All existing tests (`frontend/tests/unit/*.test.tsx`, including
`WorkflowStageTracker.test.tsx`, `App.test.tsx`, and the two dedicated accessibility test files)
must continue to pass unmodified in assertions about existing behavior; new components get their
own new test files following the same one-file-per-component convention.
