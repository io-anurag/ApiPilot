# Quickstart: validating API Test Coverage Intelligence (AP-046)

Contracts: [coverage-routes.md](contracts/coverage-routes.md). Entities and denominators: [data-model.md](data-model.md).

## Automated

```bash
npm test -w packages/shared-domain
npm test -w backend
npm test -w frontend
npm test            # full multi-project run
npm run lint
npm run build
```

Expected: all green. Coverage-specific suites:

- `backend/tests/unit/apiCoverage/` — element extraction, scenario mapping, evidence join, state precedence, metrics (zero denominators), prioritization, recommendations, filter/sort parity, export rendering, determinism (same input twice → identical output).
- `backend/tests/unit/openapi/` — path-level parameter merge and the no-path-level regression.
- `backend/tests/integration/coverage.test.ts` — `GET /api/coverage` and `/export`: 200, 400, 404, 409, redaction (a fixture run containing `rawCapture` must not leak into the body).
- `frontend/tests/unit/apiCoverage/` — states (loading, empty, no-workflow, error), filters and sorting, metric cards with counts, stale-response guard, navigation links, both themes.
- `frontend/tests/unit/` catalog tests — `workflowCatalog`, `sectionCatalog`, `App`, `EntryChooser`, `paletteCommands` updated for the new view.

No test uses a real model, network or the clock directly; the clock is injected.

## Manual

Prerequisites: `npm install`, `npm run dev`, a sample OpenAPI 3.x file with at least one path-level parameter, a `DELETE` operation, a documented 404, and an operation with numeric bounds.

1. **No active specification.** Open Coverage in a fresh session. Expect the empty state with a link to the specification step; no zeros presented as results.
2. **Specification only (US1/Use case A).** Upload the spec, open Coverage. Expect specification coverage 0/N per dimension with eligible items, gaps listed, a link to scenario generation, runtime figures shown as unavailable, not achieved.
3. **Generated, not executed (Use case B).** Generate scenarios, open Coverage. Expect operation coverage to rise, parameter coverage to count only deliberately targeted parameters, the path-level parameter present, documented 404 uncovered, every covered requirement labelled "Generated, not executed", runtime at zero.
4. **Partial execution and failures (C, D).** Generate and approve, produce the Postman collection, hand off to Import & Run, run some requests, make one fail (point one request at a wrong path or alter an expected status). Expect verified only for requirements with passing, evaluated checks; the failed one shown as "Executed, failed" with a link to the result and not counted as verified or untested; unexecuted ones separate.
5. **Edited request (inconclusive).** Edit a request in Import & Run and run it. Expect that scenario's requirements to be "Inconclusive".
6. **Repeated runs (F).** Run the same collection twice. Expect unchanged counts; the page shows which run determined state; selecting an older run via the run selector re-evaluates against it.
7. **Specification change (E).** Re-upload an edited spec. Expect scenarios regenerated for the new revision, old run results shown as unattributed (possibly from an earlier specification) in a notice with their count, none counted as verified.
8. **Filters, sorting, navigation (H).** Filter by method, text, state, category, priority and missing-versus-failed; summary counts and "X of Y" update. Follow row and recommendation links to the scenario/result and back; switch tabs and return (filter state is retained; a full browser refresh resets it — a documented limit).
9. **Export.** Export filtered and unfiltered HTML and JSON. Figures match the screen for the chosen scope; definitions and denominators are present; no tokens, cookies or bodies appear.
10. **Themes (I).** Toggle light/dark. Check cards, bars, table, filters, notices and status labels are legible, focus rings are visible, and every status has a text label as well as colour.
11. **Not measurable.** Use a spec with `oneOf` and a circular `$ref`. Expect them listed as "not measurable" with reasons, absent from denominators. Security/authorization shows "unavailable".
12. **Mixed outcomes and categories (refinement).** Make one happy-path scenario pass, one invalid-input scenario fail, leave a boundary scenario unexecuted. Expect the operation in both "with passing verification" and "with execution failures", no single status, per-requirement states, and positive/negative/boundary figures whose state counts sum to their denominators; security "Unavailable".
13. **Failure causes.** Force a timeout and an unevaluated check. Expect "Inconclusive" with the cause shown, never "Executed, failed".
14. **Run selection.** Run twice with different results; compare latest-per-scenario with a single run. The header names contributing runs and every figure changes together.
15. **Regression.** Run the existing guided workflow, Import & Run, performance and failure-analysis flows; behaviour is unchanged (apart from additional scenarios for path-level parameters in specs that declare them).

## Pass criteria

All automated suites, lint and build pass; manual steps 1–12 behave as stated. Report any step not run.
