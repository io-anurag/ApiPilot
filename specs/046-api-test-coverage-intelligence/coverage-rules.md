# Coverage Rules: normative definitions (AP-046 refinement)

**Date**: 2026-10-10 · **Status**: Draft for review · **Relates to**: [spec.md](./spec.md) (what), [data-model.md](./data-model.md) (types), [research.md](./research.md) (repository findings), [decision-log.md](./decision-log.md) (open decisions), [acceptance-checklist.md](./acceptance-checklist.md) (verification).

This document is the single authority for how every number on the Coverage view is counted. Where it is stricter than `spec.md` or `data-model.md`, this document wins and the delta is listed in §15. Nothing here is calculated by an LLM; every rule is a pure function of the specification, the counted scenarios and the execution results (FR-001).

Repository facts this document relies on (verified 2026-10-10 in the working tree; see §15 for where the current code differs):

- Operation identity: `toOperationKey()` = `METHOD /path` with the method upper-cased (`packages/shared-domain/src/testGenerationWorkflow.ts:51`).
- Scenario categories (10): `positive`, `missing-field`, `null-value`, `empty-value`, `invalid-type`, `invalid-format`, `invalid-enum`, `numeric-boundary`, `string-boundary`, `array-boundary`. None expresses authorization intent (`testModel.ts:5`).
- Uploaded-run results carry `itemId`, `outcome`, `failureCategory` (`connectivity-failure | timeout | assertion-failed`), `testOutcomes[]`, `wasEdited` and no scenario id (`externalCollections.ts:42-92`). Guided-run results carry `scenarioId`, `assertionOutcomes[]`, `failureCategory` (adds `unexpected-status`, `could-not-evaluate`), `processingStage` and `NotAttemptedReason` (`execution.ts:48-147`).
- Runs record no specification revision and scenario ids are regenerated on every generation (`research.md` R4).

---

## 1. Terms

| Term | Definition |
|---|---|
| **Specification revision** | SHA-256 of the canonical normalized contract (`info` excluded). Display fields name and version are shown but do not affect identity. |
| **Operation** | One normalized `METHOD /path` within one revision. `GET /orders` and `POST /orders` are two operations; `/orders/{id}` is a third. |
| **Eligible operation** | An operation the user selected for generation (all operations when no subset was chosen). Unselected operations are **out of scope**: listed, never counted, never gaps. |
| **Counted scenario** | A scenario of the current generation whose review state is `accepted` or `pending`. `rejected` scenarios are never counted. |
| **Requirement** | One measurable contract element of an eligible operation (§4), identified by a stable id, with exactly one category group. |
| **Mapped scenario** | A counted scenario whose recorded rule, target and assertions establish that it exercises the requirement (`scenarioMapping.ts`). Unestablishable relationships are not mapped. |
| **Specification coverage** | The requirement has ≥1 mapped scenario. Says nothing about execution. |
| **Evidence** | One execution result attributable to a counted scenario by the deterministic join (uploaded: `itemId`; guided: `scenarioId`). `not-attempted` results are never evidence. |
| **Runtime-verified** | The requirement is in state `verified` (§6). |
| **Unattributed result** | An executed result that joins to no counted scenario. Counted and disclosed; never evidence. |
| **Out-of-date snapshot** | UI condition (§13): the screen shows a previously calculated snapshot because a recalculation failed. Unrelated to the requirement state `stale`; the two terms must not be conflated in labels. |

---

## 2. Principles that every metric obeys

1. Specification coverage and runtime verification are separate figures. A generated scenario never raises a runtime figure.
2. Every figure carries numerator, denominator, percentage and a `basis` sentence. `percentage = round1(n / d × 100)`; `d = 0` gives `percentage = null`, rendered "not available (0 eligible)", never `0%`, `NaN` or `Infinity`.
3. `numerator ≤ denominator` is an invariant; a violation is a defect, not something to clamp.
4. A unit is never mixed. Operations, parameters, request-schema elements, response codes, response schemas, assertions and scenarios each have their own metric. No overall or "quality" score exists (FR-010).
5. Unavailable is not zero (§10, §12). Unmeasurable is not uncovered.
6. One run-selection rule produces one snapshot; the dashboard, filters, operation detail and exports all read that snapshot (§8).

---

## 3. Operation-level coverage

Denominator for all five metrics is **E = eligible operations**. The unit is operations, never scenarios or requirements.

| Id | Metric | Counted when |
|---|---|---|
| OC1 | Total eligible operations | Operation is in scope. |
| OC2 | With generated scenarios | ≥1 counted scenario of any category group belongs to the operation. |
| OC3 | With passing verification | ≥1 counted scenario of the operation has scenario verdict `passed` (§5) in the selected evidence. |
| OC4 | With execution failures | ≥1 counted scenario of the operation has scenario verdict `failed` (§5) in the selected evidence. |
| OC5 | With no generated scenarios | Zero counted scenarios. |

OC3 is named "with passing verification", not "verified" or "works": it says a passed scenario exists, not that the operation is complete or that its happy path ran. Completeness is read only from requirement-level coverage (§4, §7). OC4 stays a separate metric.

Invariants: `OC2 + OC5 = OC1`; `OC3 ≤ OC2`; `OC4 ≤ OC2`. **OC3 and OC4 are not mutually exclusive**: an operation with one passing and one failing scenario is in both, which is the intended way to avoid a passing scenario hiding a failing one. Both are always shown side by side. Transport failures (no response), edited requests and not-evaluated checks make a scenario `inconclusive`, which is in neither OC3 nor OC4.

**Operation coverage is not requirement completeness.** An operation with one generated scenario counts in OC2 yet usually has most of its requirements uncovered. Every operation row therefore also shows its requirement coverage (§4.5) next to OC membership, and the operation detail lists each requirement. No flag called "fully covered" exists; an operation is complete only when every eligible requirement is covered (specification) or verified (runtime), and the row states how many are not.

---

## 4. Requirement-level coverage

### 4.1 Kinds and owners

| Kind | What it is | Owner |
|---|---|---|
| `operation` | The operation's happy path was exercised with a valid request (one per operation). | operation |
| `parameter` | A documented path/query/header/cookie parameter was exercised with a valid value. | parameter |
| `parameter-case` | A negative or boundary case for a parameter: required-missing, wrong type, invalid format, invalid enum, below/above a limit. | parameter |
| `request-schema` | A body property exercised, its required flag, type, format, enum values (valid and invalid), numeric/string/array limits. | body property |
| `response-code` | A documented response key (`200`, `404`, `2XX`, `default`) was provoked and observed. | response |
| `response-schema` | A documented response schema for a documented code conforms. | response |

`scenario-category` is **no longer a requirement kind**; category coverage is derived from requirement groups (§10). Cookie parameters have no generating rule today: they are listed as documented and uncovered, which is a true finding.

### 4.2 Stable identifier and record

Id formats follow `data-model.md` (`op:POST /orders`, `param:GET /users/{id}:path:id`, `reqprop:POST /orders:application/json:items[].qty`, `resp:GET /users/{id}:404`) with case suffixes `#required`, `#type`, `#format`, `#enum`, `#enum-invalid`, `#boundary…` appended to the owning element id. Ids never include list position, display label or the revision; the revision is carried by the snapshot and each requirement carries its own `contractHash`.

Each requirement record exposes:

| Field | Meaning |
|---|---|
| `id`, `kind`, `operationKey`, `label` | Identity and applicable operation. |
| `source` | Specification location (JSON-pointer style, e.g. `#/paths/~1orders/post/requestBody/...`). |
| `group` | `positive`, `negative`, `boundary` or `unclassified` (§4.3). |
| `specState` | `covered` (≥1 mapped counted scenario) or `not-covered`, with accepted/pending counts of mapped scenarios. |
| `state` | One runtime state (§6), with `cause` and `reason`. |
| `scenarioIds[]`, `evidence[]` | Mapped scenarios; bounded evidence references (run id, scenario id, item id, verdict). |
| `measurability` | `measurable`, or `{ reason, issueRef? }` (§12). |

### 4.3 Category group assignment (one group per requirement)

| Requirement | Group |
|---|---|
| `operation`, `parameter`, body-property "exercised", valid `#enum` value | positive |
| `#required`, `#type`, `#format`, `#enum-invalid` | negative |
| `#boundary…` (below/at/above limit) | boundary |
| `response-code` and its `response-schema`, exact `2xx` key | positive |
| `response-code` and its `response-schema`, exact `4xx` key | negative |
| any other response key: `1xx`, `3xx`, `5xx`, `default`, ranges such as `2XX`/`4XX` | `unclassified` |

`unclassified` requirements stay in their own metric (for example response-code coverage counts `default` as its own key) but belong to **no** category denominator and are shown as an explicit "Unclassified: n" line, not hidden and not counted as covered.

### 4.4 Crediting rules and de-duplication

1. Coverage is a set. A requirement is covered if any mapped counted scenario exists; ten scenarios for one query parameter cover it once (FR-009). Repeated runs of a scenario do not multiply anything.
2. `operation` and "exercised" requirements are credited only by `positive`-group scenarios. A negative or boundary scenario still counts for OC2 but does not prove the happy path.
3. Case requirements are credited only by a scenario whose rule and target establish that case (`required-field-missing` credits `#required` of its target).
4. `response-code` and `response-schema` are credited by any scenario, of any group, whose assertion expects exactly that key (a `200` assertion never covers a documented `2XX`). A beyond-boundary scenario asserting `400` therefore credits the documented `400` while crediting the boundary requirement as its own.
5. A scenario whose target cannot be determined credits only OC2 and, where known, nothing else.

### 4.5 Denominator rules

A requirement is **eligible** when its operation is in scope, it is measurable, and it is applicable (for example boundary cases exist only where a constraint is declared).

- Each metric has its own denominator (§11). Not-measurable and out-of-scope items are excluded from every denominator and listed with their reason.
- The **operation row fraction** is a count of eligible requirements across kinds 4.1 except `operation`, labelled "requirements (all kinds)" and always expandable to a per-kind breakdown. It is a navigation aid for one operation, never aggregated into a dashboard percentage.
- Category denominators are the eligible requirements whose `group` equals the category (§10).

---

## 5. Scenario verdict and check scopes

### 5.1 Scenario verdict (per counted scenario, from the selected evidence)

Exactly one, in this order:

| Verdict | Condition |
|---|---|
| `not-executed` | No attributable executed result in the selected evidence. |
| `inconclusive` | A result exists but: no response (transport), the request was edited before the run, no check was evaluated, or a check could not be evaluated. Carries a cause (§6.2). |
| `failed` | ≥1 evaluated check failed. |
| `passed` | ≥1 response received, ≥1 check evaluated, every evaluated check passed, none could-not-evaluate, request not edited. |

Scenario counts per operation (`passed + failed + inconclusive + not-executed = counted scenarios`) are shown for context. They are **never** a numerator or denominator of a coverage metric.

### 5.2 Check scope per requirement

A requirement is judged only by the checks relevant to it:

| Requirement | Relevant check of each mapped scenario |
|---|---|
| `operation`, `parameter`, `request-schema` "exercised" | the scenario's `status-code` check (the request was accepted as expected). |
| `parameter-case`, `request-schema` case | the scenario's `status-code` check (the invalid/boundary input produced the documented outcome). |
| `response-code` K | the `status-code` check whose expected code equals K. |
| `response-schema` K | the `schema-conformance` check of a scenario that also asserts K. |

Consequence: a happy-path scenario whose status check passed and whose schema check failed **verifies** the parameters, request properties and the documented `201` code and **fails only** the `201` response-schema requirement. A failing scenario never invalidates a requirement it did not exercise, and a passing scenario never hides a failure of a different requirement.

A successful status code alone never verifies a `response-schema` or any business rule (FR-005); schema and business-rule requirements need their own evaluated check.

---

## 6. Requirement state model

### 6.1 States and precedence

Exactly one state per requirement, evaluated top-down over its mapped scenarios' check results (scope §5.2):

| # | State | Condition |
|---|---|---|
| 1 | `not-covered` | No mapped counted scenario. Not measurable by execution. |
| 2 | `generated-not-executed` | Mapped, but no attributable result exists in the selected evidence. |
| 3 | `executed-failed` | ≥1 relevant evaluated check failed in a non-stale, attributable result. A failure outranks a pass. |
| 4 | `verified` | ≥1 attributable result has all relevant checks evaluated and passed, response received, request not edited; none of the relevant checks of that result could-not-evaluate. |
| 5 | `inconclusive` | Evidence exists but none verifies and none fails (causes in §6.2). |
| 6 | `stale` | Reserved (§9): attributable evidence exists but is flagged for revalidation because the requirement's contract changed after the run. Not produced in this release. |

**Stale is not generated-not-executed.** `generated-not-executed` means no execution evidence exists for the requirement; `stale` means evidence exists, was valid, and no longer describes the current contract. A stale requirement is never counted as verified, never relabelled "not executed", keeps its old evidence reference, and always carries `staleReason`, `staleSince` (the revision or time the contract changed) and `reExecutionRequired: true`. Stale is a requirement-level state only; scenario verdicts (§5.1) are unchanged. Its display reads "Stale: re-run required" with the reason (for example "maxLength changed from 80 to 100 after run #3").

When several mapped scenarios disagree, the state follows the precedence, and the requirement shows an **evidence tally** ("1 passed, 1 failed, 1 not executed of 3 mapped") so a failed state never hides passes and a verified state never hides unexecuted siblings. `verified` means the contract fact was demonstrated by at least one qualifying execution; the tally shows how much of the mapped set has run.

### 6.2 Cause (separate from state)

`executed-failed`, `inconclusive` and `generated-not-executed` carry a `cause`, always shown next to the state, so that an assertion failure is never confused with a transport or infrastructure problem:

| Cause | State | Source |
|---|---|---|
| `assertion-failed` | executed-failed | A relevant check failed (`assertion-failed`, `unexpected-status`). |
| `transport-error` | inconclusive | `connectivity-failure`, `timeout`, `processingStage: no-response`. Nothing was established. |
| `check-not-evaluated` | inconclusive | `could-not-evaluate`, or an expected test name absent from the result. |
| `no-relevant-check` | inconclusive | A response was received but no check relevant to the requirement exists (for example no schema assertion). |
| `request-edited` | inconclusive | `wasEdited`: the request that ran may differ from the scenario. |
| `blocked-by-dependency` | generated-not-executed | Not attempted: `dependency-not-met` (for example an infrastructure token request failed). Shown with the infrastructure failure, not as a verdict on the requirement. |
| `run-cancelled` / `not-reached` | generated-not-executed | `cancelled`, `run-ended-before-reached`. |
| `never-run` | generated-not-executed | No run has a result for it. |
| `not-in-selected-run` | generated-not-executed | A single run is selected and contains no result for it, although other runs may. |
| `infrastructure-error` | informational | An infrastructure request (for example OAuth2 token fetch) failed; reported as a run notice, never a requirement failure, and never counted as unattributed. |

### 6.3 The cases

| Case | Situation | Required result |
|---|---|---|
| A | No scenario | `not-covered`; spec: no; runtime: no. Listed as a gap (missing). |
| B | Scenario never executed | `generated-not-executed` / `never-run`. Counts toward specification coverage; not toward runtime. |
| C | Executed and passed | `verified` only if the requirement's relevant check (§5.2) was evaluated and passed. Status 2xx without an evaluated schema check leaves `response-schema` `inconclusive` / `no-relevant-check`. |
| D | Executed and failed | `executed-failed` / `assertion-failed` with the failing run and scenario linked. Transport error, could-not-evaluate and infrastructure failure never become `executed-failed`; they use §6.2 causes. Failures are never labelled untested and never counted as verified. |
| E | Mixed outcomes | Each requirement takes its own state (§5.2, §6.1). The operation has no single status (§7). Example: POST /orders with a passing happy path, a failing negative scenario and an unexecuted boundary scenario shows `verified` for the exercised parameters and the documented `201`, `executed-failed` for the requirement the failing scenario targets, `generated-not-executed` for the boundary requirement, and is in both OC3 and OC4. |
| F | Historical executions | §8. |
| G | Specification revision changes | §9. |

---

## 7. Operation-level verification reporting

An operation has no single status pill. Its row shows, together:

1. **Requirement state profile**: count of its eligible requirements in each of the six states, as a stacked bar plus text counts.
2. **Scenario verdict counts**: passed / failed / inconclusive / not executed.
3. **Membership chips**: OC2/OC3/OC4/OC5, each present chip shown (for example "Verified", "Has failures").
4. **Remaining unexecuted requirements**: the count of requirements in `generated-not-executed` and `not-covered`, separately.

Filters act on this profile (§13): the State filter keeps an operation when **any** of its requirements is in the chosen state and then lists the matching requirements; it does not assign the operation one state.

---

## 8. Run selection (Case F)

| Mode | Rule |
|---|---|
| **Latest qualifying result per scenario** (default) | For each counted scenario, the most recent attributable, non-`not-attempted` result across the available runs, by `startedAt`, ties broken by run id. Results may therefore come from different runs. |
| **Single run** | Only the chosen run's results. A scenario without a result in it is `generated-not-executed` / `not-in-selected-run`. |

Rules common to both:

1. The mode, the run ids that supplied evidence, and the evidence count per run are shown in the header ("evidence from runs #3, #2") and written into every export. Combining is therefore never silent.
2. Older runs are never merged into a requirement's state except through "latest per scenario"; there is no pass-in-any-run rule and no averaging.
3. Latest-per-scenario combines only runs whose environment (name and tier) equals that of the newest qualifying run (D-2, resolved). Runs from other environments are excluded, listed in the header and exports with the reason "different environment", and never contribute to any figure. A single selected run is evaluated as is.
4. Dashboard cards, breakdowns, gaps, recommendations, operation detail, filters and exports are all derived from one snapshot for the (mode, run) pair; changing it recalculates all of them together.
5. History across time (trends) is out of scope; no coverage history is stored.

---

## 9. Specification revision handling (Case G)

### 9.1 What is enforced in this release

Consistent with the 2026-10-10 clarification: evidence is attributable only through the join to a counted scenario of the **current** generation.

| Situation | Treatment |
|---|---|
| Same generation, scenario unchanged | Evidence valid. |
| Scenario edited in review after the run | Evidence remains valid and attributable; the note "scenario edited after run" is shown. |
| Request edited in Import & Run (`wasEdited`) | Result shown as evidence, `inconclusive` / `request-edited`. |
| Specification changed and scenarios regenerated, or collection re-imported | Results that no longer join are `unattributed` ("possibly from an earlier specification"), counted and disclosed, never verified. The treatment is whole-specification, not per operation. |
| Rejected scenario | Never counted; its evidence is ignored. |
| Imported external collection with no scenario link | Not evidence. |

Every snapshot states the revision it was calculated for, and every evidence reference states the run and scenario it came from.

### 9.2 Target rule, specified now and not enabled

Because runs record neither revision nor per-requirement contract hash, per-requirement carry-over is **not** possible today. The rule below is what an implementation must follow if decision D-1 option (b) or (c) is taken, so the Stale state and `contractHash` are already coherent:

1. Evidence records `{ specRevision, scenarioStableKey, requirementContractHashes }` at execution time.
2. For requirement R and evidence E: if `E.contractHash(R) == current contractHash(R)` and the scenario still maps to R, E **remains valid** even though other parts of the specification changed.
3. If the scenario still joins but `contractHash(R)` changed, R becomes `stale` (evidence kept, not counted as verified) with `staleReason` naming the changed fragment (from the contract hash comparison), `reExecutionRequired: true` and the evidence reference of the superseded run.
4. If R no longer exists, its evidence is unattributed.
5. If R is new, it is `not-covered` or `generated-not-executed`.

Until D-1 is decided, step 2 to 5 are documentation, `stale` is never produced, and no test may assume otherwise.

---

## 10. Scenario-category coverage

**Decision (settled 2026-10-10): category coverage measures classified testable requirements, not scenarios.** The denominator of every category figure is a count of eligible requirements whose group is that category; scenario counts are never a numerator or denominator. Scenarios appear only as the mapping that credits a requirement, and in an informational "unclassified scenarios" line. Reason: many scenarios can credit one requirement and one scenario can credit several, so scenario counts would inflate or deflate coverage (FR-009).

Four categories are always shown. For each, both figures are computed over **eligible requirements whose group equals the category** (§4.3):

- **Specification coverage** = requirements with a mapped counted scenario / eligible requirements in the group.
- **Runtime-verified** = requirements in state `verified` / the same denominator.
- Also shown per category: `executed-failed`, `inconclusive`, `generated-not-executed`, `not-covered` counts, so the bar reads as a partition of the denominator.

| Category | Eligible requirements | Qualifying scenarios (spec) | Runtime verification |
|---|---|---|---|
| Positive / happy path | `operation`, exercised parameters and properties, valid enum values, documented exact-`2xx` codes and schemas | Group-`positive` scenarios (rules `positive-scenario`, `minimal-positive-scenario`, `enum-positive-variant`) | §6 with §5.2 scopes |
| Negative / invalid input | `#required`, `#type`, `#format`, `#enum-invalid`, documented exact-`4xx` codes and schemas | Rules `required-field-*`, `invalid-*`; AI scenarios by their `category` field | §6 |
| Boundary / edge | `#boundary…` elements, present only where a constraint is declared | Every `*-boundary-*` rule, below/at/above variants (grouped by rule id, not by the `category` field, because at-boundary variants carry `positive`) | §6 |
| Security / authorization | **Unavailable** | None: no scenario category identifies authorization intent | None |

How scenarios are classified: `scenarioGroup()` derives the group from the rule id; AI scenarios use their `category` field; each scenario has exactly one group. A scenario that cannot be placed contributes to OC2 only and is counted in the "unclassified scenarios" line, not in any category.

**Unavailable is not zero.** A category with zero eligible requirements renders "not available (0 eligible)". Security renders "Unavailable: no scenario category identifies authorization intent", with no percentage and no bar. Operations that declare a `security` requirement are counted separately as "declare security: n of E (declared in the specification; not tested)" for context and prioritization only.

**Security qualification contract (for when classification exists; not enabled).** A scenario may be classed security/authorization only if it carries explicit authorization intent (a recorded classification naming the security scheme and the expected `401`/`403` documented in the specification). A security requirement is runtime-verified only if that scenario executed and its evaluated `status-code` check for the documented `401`/`403` passed. An authenticated request succeeding, or an operation declaring a scheme, is never evidence. See D-4.

---

## 11. Metrics and denominators (summary cards)

Each card shows `numerator / denominator (percentage)`, its basis, and its scope label (§13.1). Eight headline figures:

| Card | Dimension | Numerator | Denominator |
|---|---|---|---|
| Operation coverage | spec | OC2 | OC1 |
| Parameter coverage | spec | `parameter` requirements covered | eligible `parameter` requirements (path+operation merged, override counted once) |
| Request-schema coverage | spec | `request-schema` requirements covered | eligible `request-schema` requirements |
| Response-schema coverage | spec | `response-schema` requirements covered | eligible `response-schema` requirements |
| Operations with passing verification | runtime | OC3 | OC1 |
| Verified response codes | runtime | `response-code` requirements `verified` | eligible `response-code` requirements (ranges and `default` are their own keys) |
| Assertion outcomes | runtime | evaluated assertions that passed | evaluated assertions; shown as "passed / failed / not evaluated" with not-evaluated outside the denominator, from the selected evidence excluding edited and no-response results |
| Last qualifying execution | runtime | timestamp, run id, environment | none |

Beside these: "operations with execution failures" (OC4), "operations with no scenarios" (OC5) and "accepted / pending scenarios contributing". All of them follow the same scope.

---

## 12. Exclusions and measurement limits

| Item | Treatment | Shown as |
|---|---|---|
| Operation not selected for generation | Out of scope: excluded from every denominator, not a gap | "Out of scope" list with the reason "not selected for generation" |
| `oneOf`, `anyOf`, discriminator branches | Not measurable (dropped by the model); element excluded from denominators | "Not measurable" list, reason, `AnalysisIssue` ref |
| `nullable`, `additionalProperties`, conditional constraints | Not measurable | same |
| Unresolved or circular `$ref` | Not measurable; the affected element is excluded | same |
| `allOf` | Treated as merged; flagged informational | same, severity info |
| Callbacks, links, webhooks | Not measurable (out of the contract elements measured) | same |
| Individual response-body properties | Measured only as whole-schema conformance per documented code | Standing notice |
| Cookie parameters | Documented, no generating rule: counted as eligible and uncovered | normal gap |
| Unclassified response keys / scenarios | Excluded from category denominators; included in their own metric | "Unclassified: n" |
| Security category | Unavailable | §10 |

Every excluded or unmeasurable item has a reason. A construct is never silently marked covered, and none inflates a denominator. The same lists, reasons and counts appear on the dashboard, in operation detail and in exports.

---

## 13. Controls and states

Every control is bound to snapshot data. None is decorative; the mock labels simulated behavior explicitly.

### 13.1 Scope label

Cards, breakdowns, category section, gaps, recommendations and exports show their scope: "All 7 eligible operations" or "Filtered: 3 of 7 operations (state: executed-failed)". The label names the evidence mode and run (§8).

### 13.2 Matrix

| Control | Data it uses | Behavior |
|---|---|---|
| Evaluate run (select) | `execution.availableRuns` | Switches mode/run (§8); recalculates every figure together; options are the real runs. Empty list disables it with "no runs". |
| Recalculate | Re-request the snapshot from current scenarios and runs | Replaces the snapshot and `calculatedAt`; on failure keeps the last good snapshot labelled **out-of-date** with the error, never a blank. |
| Endpoint (text) | operation path | Case-insensitive substring; selects operations. |
| Method | operation method | Selects operations. |
| State | requirement `state` | Keeps operations with ≥1 requirement in the state; row shows matching requirements; metrics cover all requirements of kept operations. |
| Category | requirement `group` | Restricts the requirement set to the group; operation fractions, cards and breakdowns recompute over it. "Security" is disabled with its reason. |
| Priority | gap/operation priority | Selects operations. |
| Gap type | state families | Missing = `not-covered` or `generated-not-executed`; Failed = `executed-failed`; Insufficient evidence = `inconclusive`; Needs re-execution = `stale`. |
| Reset filters | none | Clears all filters; keeps sort and run. |
| Sort (Method, Endpoint, Specification, Runtime, Priority) | underlying numbers: method then path text; requirement fractions as `covered/total` computed on the visible requirement set; priority score | Deterministic; ties break by operation key; `aria-sort` reflects it. |
| Details (row) | operation requirements, scenarios, evidence | Expands the operation: per-requirement state, cause, tally, scenarios, evidence, priority rationale. |
| Operation link | operation key | Opens the operation in the guided workflow's API review with the same specification and run context. |
| Scenarios link | requirement `scenarioIds` | Opens scenario review filtered to those scenarios; absent when there are none. |
| Failing result link | evidence `runId`, `itemId`/`scenarioId` | Opens the run result in Import & Run (uploaded) or execution results (guided). Absent without evidence. |
| Generate / Review scenario | gap's `action` | Opens generation for the operation, or review of the mapped scenarios. |
| Export filtered / all | same snapshot function as the screen | `scope=filtered` equals what the table and cards show; `scope=all` is unfiltered. Both carry mode, run ids, revision, definitions, not-measurable and out-of-scope lists. HTML for reading, JSON for data. |
| Go to Import & Run | none | Opens the existing workflow. |
| Theme | existing theme system | Light and dark both supported; no component owns a theme. |

Filters, sort and run reset on a full browser refresh and persist while switching views (clarified).

### 13.3 Distinct UI states

| State | Meaning | Recovery |
|---|---|---|
| Loading | Calculation in flight; a later selection is never overwritten by an earlier response. | none |
| No active workflow | No specification in the session. | Go to the specification step. |
| Empty | Specification with no counted scenarios, or filters match nothing. | Generate scenarios / Reset filters. |
| Error | The service failed and no snapshot exists. Never shown as empty coverage. | Retry. |
| Out-of-date snapshot | A prior snapshot is shown because recalculation failed. | Retry; the snapshot time is shown. |
| Unattributed / edited / not-executed notices | Data exists but is not eligible evidence. | Re-run, re-import, review. |

---

## 14. Gaps and recommendations

**Gap** (one per underlying cause, FR-030): operation and method; the requirement(s) with ids and labels; specification state; runtime state with cause; missing or failing scenarios (ids, rule, group, verdict, run); evidence or reason; priority with its factor list; action. **Missing** (not covered, not executed) and **failed** (executed-failed) and **insufficient evidence** are visibly distinct kinds with distinct labels.

**Recommendation**: derived only from a gap, naming the operation, the missing or failing requirement, its current state, the evidence reference, the priority and its rationale, and one action (`generate-scenario`, `review-scenario`, `open-result`). Priority is a deterministic heuristic over declared facts (failed outranks missing outranks insufficient; destructive method; declared security requirement; contract complexity; failure history unavailable and omitted) and is always labelled "heuristic, not a security assessment". The list follows the active filter scope.

---

## 15. Differences from the working tree (implementation deltas)

The feature is already partly implemented in the uncommitted working tree. This refinement changes none of it, but the rules above are stricter in these places, so `tasks.md` needs follow-up tasks:

| # | Current behavior (file) | Required by this document |
|---|---|---|
| 1 | `mapScenario` credits `operation` from every scenario of the operation with scope `any` (`scenarioMapping.ts:87`); one failing negative scenario makes the whole `operation` requirement `executed-failed`. | `operation` credited by positive-group scenarios only; scope `status-code` (§4.4, §5.2). |
| 2 | Positive base scenarios credit every carried field with scope `any` (`scenarioMapping.ts:99-102`); a failed schema check fails every exercised field. `data-model.md` already says "status assertion passed". | Scope `status-code` for exercised and case requirements (§5.2). |
| 3 | Operation shown with one dominant state; `STATE_SEVERITY` picks one (`summarize.ts:47`). | State profile plus scenario verdicts; no single pill (§7). |
| 4 | `CoverageCategoryCoverage` = `{covered, applicable}` per (operation, group) existence (`summarize.ts:213`); no runtime figure. | Requirement-partition categories with spec and runtime counts, unclassified line (§10). Retire `scenario-category` kind. |
| 5 | Failure vs transport vs not-evaluated is a free-text `note` on the evidence ref (`classify.ts:37-48`). | Typed `cause` field (§6.2) on requirements and evidence. |
| 6 | No scenario-level verdict or counts; OC3 and OC4 not exposed. | `scenarioVerdictCounts` per operation and OC1–OC5 in the snapshot (§3, §5). |
| 7 | `not-attempted` results are skipped without a recorded reason (`evidence.ts:123,143`). | Surface `blocked-by-dependency`, `run-cancelled`, `not-reached` where recorded (§6.2). |
| 8 | `gapKind: missing | failed` only (`coverage-routes.md`). | Add `insufficient`; contract change is additive. |
| 9 | Latest-per-scenario evidence can mix runs and environments with only the last environment reported (`evidence.ts:170-173`). | Restrict to the newest qualifying run's environment and list excluded runs (§8). |
| 10 | Assertion totals exclude edited and no-response results but do not report the not-evaluated count (`calculateCoverage.ts:134-141`). | Report passed / failed / not evaluated (§11). |
