# Quickstart: Presentation System & Review Scalability

**Input**: [spec.md](./spec.md) · [data-model.md](./data-model.md) ·
[contracts/bulk-review-actions.md](./contracts/bulk-review-actions.md)

This validates the feature end to end against the guided workflow. It assumes AP-001–AP-009 are
already implemented and working (this feature adds no new capability to the pipeline itself, only
presentation and review-scale interactions on top of it).

## Prerequisites

```bash
npm install
npm run dev
```

Have on hand an OpenAPI/YAML specification large enough to realistically exercise scale — ideally
one producing on the order of the observed real-world case (dozens of operations, hundreds of
generated scenarios, several discovered integration workflows). A small fixture spec is enough to
validate correctness of the bulk mechanics; a large one is needed to validate SC-002/SC-008
(practical scale, visible progress).

## Scenario 1 — Bulk accept/reject by filter (User Story 1, FR-004, FR-011, FR-007)

1. Upload a specification and advance through the guided workflow to **Scenario Review**.
2. Apply an operation filter (or a category filter) that matches multiple scenarios.
3. Trigger "Accept all filtered".
4. **Expect**: a confirmation step shows the exact number of scenarios the action will affect
   (FR-011); confirming applies the decision to every scenario currently matching the filter and
   leaves non-matching scenarios untouched (FR-004).
5. Repeat with "Reject all filtered" and **expect** the confirmation step to also require a
   justification before it can be confirmed (FR-007).

## Scenario 2 — Bulk accept/reject by manual selection (FR-005, FR-019)

1. From Scenario Review, manually select several scenarios spanning different operations and
   categories (no filter applied, or a broad one).
2. Trigger "Accept selected" (or "Reject selected").
3. **Expect**: only the manually selected scenarios receive the decision.
4. Manually select a few scenarios again, then change the active operation or category filter.
5. **Expect**: the manual selection is cleared (FR-019) — the bulk-selected controls confirm no
   items remain selected.

## Scenario 3 — Individual decision still works (FR-006)

1. From Scenario Review, use the existing single-scenario Accept/Reject control on one scenario.
2. **Expect**: unchanged behavior from the current implementation — no confirmation step is
   required beyond what already exists today for a single item.

## Scenario 4 — Partial failure is reported, not hidden (FR-012)

1. Manually select a scenario, then (in another means, e.g. a second decision path or a stale
   client state) cause its stored revision to advance so it goes stale.
2. Include it in a bulk action alongside otherwise-valid scenarios.
3. **Expect**: the QA engineer is told how many scenarios succeeded and how many failed, with the
   stale scenario identified, rather than the bulk action reporting a false, uniform success.

## Scenario 5 — Bulk approve/reject on Workflow Review (User Story 2, FR-008, FR-011)

1. Advance to **Workflow Review** with a specification that produces multiple discovered
   integration workflows.
2. Select several workflows and trigger "Approve selected" (or "Reject selected").
3. **Expect**: a confirmation step shows the affected count before applying; confirming approves
   (or rejects) every selected workflow; the existing single-workflow Approve/Reject control still
   works unchanged (FR-009).

## Scenario 6 — Visible progress at real-world scale (FR-020, SC-008)

1. Using a large specification (on the order of hundreds of scenarios), apply "Accept all filtered"
   against a filter matching most or all of them.
2. **Expect**: after confirming, a visible progress indicator advances (e.g. "120 of 371 applied")
   rather than the screen appearing frozen or only flashing a single loading state, per
   contracts/bulk-review-actions.md's batching contract.

## Scenario 7 — No duplicate AI-skip banner (FR-013, SC-005)

1. Run the workflow through a path where AI enhancement is skipped (e.g. AI provider unavailable),
   then reach Scenario Review.
2. **Expect**: the "AI enhancement was skipped" notice appears exactly once on the screen, with its
   retry action, not twice.

## Scenario 8 — Consistent presentation across every stage (User Story 3, FR-001–FR-003)

1. Walk the entire guided workflow from upload through Postman export.
2. **Expect** at every stage: no unstyled default-browser-markup appearance; HTTP methods,
   statuses/severities, and provenance are each shown with the same visual treatment everywhere they
   appear (FR-002); loading, populated, empty, and error states are each visually distinguishable
   (FR-003).

## Scenario 9 — Keyboard and accessible names (FR-014–FR-016, SC-006)

1. Using only the keyboard (Tab/Shift+Tab/Enter/Space, no mouse), reach Scenario Review, select
   multiple scenarios via keyboard, trigger a bulk action, and confirm it.
2. **Expect**: every control involved is reachable and operable, shows a visible focus indicator,
   and has a distinguishing accessible name (e.g. not several controls all announced as "Select").
3. **Expect**: status/severity/decision information is never conveyed by color alone (FR-016) — a
   screen reader user or someone without color perception can determine the same information from
   text or an icon with a text alternative.

## Automated coverage

Each numbered scenario above corresponds to unit/component tests added or updated under
`frontend/tests/unit/` (see plan.md Project Structure) using Vitest + React Testing Library,
following the existing accessibility-test pattern already established by
`TestGenerationWorkflowAccessibility.test.tsx` and `TestScenarioReviewAccessibility.test.tsx`. No
backend test changes are required (research.md D2/D4 — no backend behavior changes).
