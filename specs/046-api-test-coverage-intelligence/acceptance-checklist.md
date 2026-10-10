# Acceptance Checklist: API Test Coverage Intelligence (AP-046 refinement)

**Date**: 2026-10-10. Use against an implementation. References are to [coverage-rules.md](./coverage-rules.md) sections (§) and [spec.md](./spec.md) requirements. "Fixture" means a deterministic test fixture, never live data. Items marked (D-n) depend on an unresolved decision in [decision-log.md](./decision-log.md) and must not be tested until it is closed.

## 1. Generation without execution

- [ ] Specification with 7 eligible operations, scenarios for 6: OC2 = 6, OC5 = 1, OC1 = 7, OC3 (with passing verification) = 0, OC4 = 0 (§3).
- [ ] Every requirement with a mapped scenario is `generated-not-executed` / `never-run`; none `verified` (§6).
- [ ] Runtime cards read 0 of denominator with "generated, not executed"; assertion card reads "no assertions evaluated", not 0% (§11).
- [ ] Ten scenarios targeting one query parameter count it once (FR-009).
- [ ] An operation with exactly one scenario is in OC2 and still lists uncovered requirements; no "fully covered" label anywhere (§3).
- [ ] No scenarios at all: every spec figure is 0 of N, notice and link to generation shown, no sample data.

## 2. Partial execution

- [ ] Only some scenarios run: runtime figures count only those; the rest stay `generated-not-executed`.
- [ ] A run containing only `not-attempted` results contributes no evidence; causes `blocked-by-dependency` / `run-cancelled` are shown where recorded (§6.2).
- [ ] Status 2xx with no evaluated schema check leaves the response-schema requirement `inconclusive` / `no-relevant-check` (Case C).
- [ ] An edited request (`wasEdited`): result displayed, requirement `inconclusive` / `request-edited`, excluded from assertion totals.
- [ ] Timeout or connectivity failure: `inconclusive` / `transport-error`; never `executed-failed`.
- [ ] Unevaluated check: `inconclusive` / `check-not-evaluated`; excluded from the assertion denominator and shown as "not evaluated".

## 3. Mixed outcomes (Cases D and E)

Fixture: one operation with a passing happy path, a failing invalid-input scenario, an unexecuted boundary scenario.

- [ ] The operation is counted in OC3 ("with passing verification", never labelled "verified") and in OC4, and shows no single status (§7).
- [ ] Completeness is read from requirement-level counts only; no operation-level label implies the operation works or is fully covered.
- [ ] Scenario verdict counts read 1 passed, 1 failed, 0 inconclusive, 1 not executed and sum to the operation's counted scenarios.
- [ ] Exercised parameters and the documented success code are `verified`; the requirement targeted by the failing scenario is `executed-failed` / `assertion-failed`; the boundary requirement is `generated-not-executed` (§5.2).
- [ ] Happy path with passing status and failing schema check: only the response-schema requirement fails (FR-044).
- [ ] Two scenarios map to one requirement, one passes and one fails: state `executed-failed`, tally "1 passed, 1 failed" (D-7).
- [ ] State profile counts per operation sum to its eligible requirements.
- [ ] Recommendations list the failing requirement with a link to the failing result and do not recommend the verified ones.

## 4. Run selection and history (Case F)

- [ ] Default mode: each scenario takes its latest attributable result; header names every contributing run; export repeats it.
- [ ] A scenario that failed in run 1 and passed in run 3: reports `passed` in default mode, `failed` when run 1 is selected.
- [ ] Single run mode: a scenario absent from that run is `generated-not-executed` / `not-in-selected-run`.
- [ ] Switching mode recalculates cards, breakdowns, category section, gaps, recommendations and the operation detail together; no figure is stale relative to another.
- [ ] Runs from two environments: only the newest qualifying run's environment contributes; the other runs are listed as excluded with the reason in the header and exports; a single selected run from the other environment is evaluated as is.
- [ ] A later selection is never overwritten by an earlier, slower response (FR-035).

## 5. Specification changes (Case G)

- [ ] After regeneration with changed content, results that join nothing are counted as unattributed with the notice "possibly from an earlier specification" and are never verified (SC-007).
- [ ] Unattributed count equals the number of executed results with no join; infrastructure requests are not counted.
- [ ] A version-string-only change does not change the revision; a contract change does.
- [ ] Scenario edited in review after the run: evidence stays valid, note "scenario edited after run" shown (§9.1).
- [ ] `stale` is never produced in this release; the state appears in the legend only (§9.2).
- [ ] When produced (D-1): a stale requirement shows its reason, the time or revision it became stale and "re-run required"; it is never counted as verified and never shown or filtered as generated-not-executed; it has its own gap type "Needs re-execution" and its own bar segment; the superseded evidence reference is retained.
- [ ] When D-1 option (b) or (c) is adopted: requirement with unchanged `contractHash` keeps evidence; changed hash becomes `stale`; removed requirement is unattributed (§9.2).

## 6. Scenario categories

- [ ] Positive, negative and boundary each show spec and runtime numerator/denominator/percentage over their own eligible requirements (§10).
- [ ] For each category, covered + failed + inconclusive + generated-not-executed + not-covered = denominator (SC-012).
- [ ] Boundary applies only where a constraint exists; an operation without constraints contributes nothing to the boundary denominator.
- [ ] An at-boundary scenario (category `positive`) counts as boundary, not positive.
- [ ] A negative scenario does not credit the `operation` happy-path requirement (D-3).
- [ ] A boundary-invalid scenario asserting `400` credits the documented `400` response code and its own boundary requirement.
- [ ] Documented `default`, `5xx`, `2XX` appear under "Unclassified: n", are excluded from category denominators, and are counted as their own keys in response-code coverage (D-6).
- [ ] Security renders "Unavailable" with its reason, no percentage, no bar, never 0%. Operations that declare security are counted separately and labelled "declared, not tested".
- [ ] Declaring a security scheme, or a request succeeding with credentials, never changes any category figure.
- [ ] Category figures count requirements only: adding duplicate scenarios for one requirement changes no category numerator or denominator; an unclassifiable scenario appears only in the "unclassified scenarios" line.
- [ ] Zero eligible requirements in a category read "not available (0 eligible)".

## 7. Unsupported and unmeasurable constructs

- [ ] `oneOf`/`anyOf`, discriminators, nullable, circular `$ref`, callbacks, links, webhooks appear in "Not measurable" with a reason and are excluded from denominators; none is marked covered.
- [ ] Denominators with and without an unmeasurable element differ by exactly that element; the exclusion is visible in the card basis.
- [ ] Unselected operations appear only under "Out of scope", never as gaps, never in a denominator.
- [ ] Dashboard, operation detail and export list the same excluded items with the same reasons and counts.
- [ ] Path-level and operation-level parameters sharing name and location: counted once, operation-level wins.

## 8. Filtering and sorting

- [ ] Endpoint, Method and Priority select operations; the caption "showing x of y" updates.
- [ ] State filter keeps operations with at least one requirement in that state and shows the matching requirement count; cards use all requirements of the kept operations.
- [ ] Category filter restricts requirements to that group; row fractions, cards and breakdowns recompute; Security is disabled with its reason.
- [ ] Gap type: Missing, Failed and Insufficient evidence match their state families (§13.2).
- [ ] Scope label on cards names the filter and reads "All n eligible operations" when none is active.
- [ ] Reset clears filters and keeps sort and run; no filter combination yields NaN or a blank.
- [ ] Sorting orders by the underlying number (fraction, score, text), ties by operation key, `aria-sort` set, order stable across recalculation.
- [ ] Filters, sort and run survive switching views and reset on full refresh (FR-024).

## 9. Controls and navigation

- [ ] Recalculate re-requests the snapshot; on failure the previous snapshot remains, labelled out-of-date with its time (FR-050, D-8).
- [ ] Operation, Scenarios and Failing result links open the real screens with specification and run context; each link is absent when its target is absent.
- [ ] Generate/Review scenario actions open generation or review for exactly the requirement's scenarios.
- [ ] Loading, no workflow, empty, error and out-of-date are visually and textually distinct; an API failure is never an empty result.
- [ ] Every control in the product is bound to snapshot data; none is decorative.

## 10. Export

- [ ] Export filtered figures equal the on-screen figures for the same filter scope; export all equals the unfiltered snapshot (SC-009, SC-015).
- [ ] Both formats include revision, run mode and ids, definitions and denominators, both dimensions, category figures, gaps with priority and rationale, not-measurable, out-of-scope, unattributed count, evidence references.
- [ ] No headers, bodies, URLs with query strings, tokens, cookies, `rawCapture`, or environment values appear; HTML output escapes all text.
- [ ] Repeated export of the same snapshot is byte-identical apart from the calculation time.

## 11. Light and dark themes, accessibility

- [ ] Cards, bars, category section, table, expanded detail, notices, filters and all state pills are legible in both themes (SC-010).
- [ ] Every state, priority and category figure carries text or an icon in addition to color.
- [ ] Charts have a textual counts equivalent; keyboard focus is visible on every control, including row expansion and sort headers.
- [ ] Layout holds at phone width; wide tables scroll horizontally without scrolling the page.
- [ ] Reduced-motion preference disables skeleton animation.

## 12. Determinism and safety

- [ ] Identical inputs and clock produce byte-identical metrics and recommendation order (SC-005).
- [ ] No count, state or percentage involves an AI call; no network access occurs.
- [ ] Zero NaN, Infinity or blank values across all fixtures (SC-004).
- [ ] Existing workflows and tests are unchanged (FR-040, SC-011).
