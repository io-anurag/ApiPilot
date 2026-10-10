# AP-042: Import & Run Collection in four steps

**Version**: 19.31.0 | **Date**: 2026-10-10 | **Scope**: frontend only (no contract, route or dependency change)

## Problem

Import & Run Collection put everything on one screen: a full-height hero around the import card, then the
collection tree and editor, then the run order, results and history. After an upload the run controls were far
below the fold, and a large collection made the page longer still. The Collection / Review Requests / Run / Results
strip was decoration only.

## Requirements

- **FR-001** The screen has four steps, Collection, Review requests, Run and Results, in a clickable stepper. One
  step is on screen at a time. The open step has `aria-current="step"`.
- **FR-002** Collection is the existing hero around the import card, unchanged in content. The import form still
  takes a name, a tier, the collection file and the environment file (both required), with the uploaded-collections
  list below. A selected collection enables "Review requests →".
- **FR-003** On the other steps the hero shrinks to its eyebrow and headline, above a collection bar with the
  collection's name, tier, an Unverified badge when it has not been confirmed, request, folder and variable counts,
  and "Change collection" (back to step 1).
- **FR-004** Review requests is the collection editor as before (tree, variables, request editor). Its footer offers
  "← Collection" and "Set up run →".
- **FR-005** Run shows the run order checklist and, on the right, a setup card laid out like a performance plan's Run
  setup (AP-040): a headline that says whether a run can start ("Ready to run on NAME (tier)", "Run in progress" or
  "Not ready to run yet", with the reason), Start run, the last run in one line with a link to Results, a facts grid
  (requests selected, order, tier, delay between requests), the hosts the selected requests reach, the variables with no
  value, and a writes warning counting the selected POST, PUT, PATCH and DELETE requests by method (or a read-only
  line); then "Load test instead" (Create request-chain plan and the plans made from collections), and the
  unverified-content and risk-tier confirmations and any start error. The gates and their wording are unchanged
  (specs/026). Nothing is sent before the engineer starts the run.
- **FR-006** Results shows the open run (status, overview, per-request results, Cancel run while in progress, failure
  analysis), the run history and "Run again" (back to Run). Starting a run moves to Results.
- **FR-007** Steps are locked, with the reason as visible text, until they can be used: Review requests and Run need
  a selected collection ("Select a collection first"); Results needs a run for it ("Start a run first"). A requested
  step that is locked resolves to the furthest earlier open step.
- **FR-008** The run panel stays mounted on every step, hidden outside Run and Results, so a run in progress keeps
  polling, and the run order, history and selection survive moving between steps. The import form also stays mounted
  (hidden), so a half-filled upload survives.
- **FR-009** Colours resolve through theme-aware tokens with no `dark:` overrides, as in the guided-workflow tracker
  (AP-041/AP-042 stage tracker), so a step keeps its hue in light and dark. State is always also text.

## Out of scope

Run, execution, confirmation, editing and chain-plan behaviour; the backend; the other workflows' path strips.

## Validation

Unit tests: step rules, the panel's `run`, `results` and `hidden` views, the page's steps (locking, compact hero and
collection bar, Results unlock, Run again) and the existing page behaviours moved to their steps. Manual browser
walkthrough of light and dark mode: outstanding.
