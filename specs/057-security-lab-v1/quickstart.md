# Quickstart: Validating Security Lab — V1

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

A validation guide, not an implementation guide. Contracts and data model are linked rather than repeated. Scenarios 1 to 8
map to the user stories. Automated checks are listed first because they are the gate; the manual walkthrough proves the
feature in the real application against a local sample target.

## Prerequisites

- Node.js 24 LTS, dependencies installed (`npm install` at the repository root).
- No real model is needed. AI-dependent checks use a stub provider; the optional manual AI step uses the mock or an
  already-cached local model and is skippable (Story 8 degrades alone).
- No network access is needed or used. The sample target is a loopback server that ships with the tests.

## Automated validation (the gate)

```bash
npm test                                       # all workspaces
npm test -w backend -- tests/unit/securityLab  # backend unit tests for this feature
npm test -w backend -- tests/integration/securityLab
npm test -w frontend -- tests/unit/securityLab tests/unit/navigation tests/unit/shell
npm run lint
npm run build
```

Expected: all pass, with these named checks present and green.

| Check | Proves |
|---|---|
| `effectiveSecurity.test` | root, override, explicit public, none declared, unset (SC-002) |
| `observationWording.test` | no output claims a proven vulnerability (SC-003) |
| `generation.determinism.test` | identical input gives identical scenarios and ids (SC-004) |
| `scenarioValidation.test` | malformed, unknown-operation, URL-bearing and unsupported-action scenarios are rejected (SC-005) |
| `reviewStateMachine.test`, `approvalBinding.test` | version-bound approval; material edit withdraws (SC-010) |
| `destinationPolicy.test`, `rebinding.test`, `redirects.test` | the matrix in [execution-safety-rules.md](contracts/execution-safety-rules.md) (SC-006) |
| `directServiceBypass.test` | rules hold when the router and UI are bypassed |
| `budgetConcurrency.test`, `cancel.test`, `cleanupFailure.test` | SC-007, SC-008 |
| `seededSecretCorpus.test` | no secret in evidence, logs, findings, report, export (SC-009) |
| `evaluation.test`, `findings.test` | outcome table, links |
| `findingOccurrences.test` | one finding per scenario version, occurrence count equals failed results over many reruns, reopen and unreviewed rules, `supersedes` after a material edit (SC-011) |
| `generationScope.test` | selection default, widen and narrow, scope and excluded counts returned, existing scenarios kept; analysis and Overview ignore the selection |
| `retention.test`, `ownerIsolation.test` | retained work survives forced session expiry and restart, session data and evidence do not, another owner sees nothing, delete removes everything, caps refuse with `retention_limit_reached` (SC-017) |
| `noSpecificationRead.test` | with no workflow loaded, retained scenarios, findings, runs and reports are readable and generation, approval and run are refused |
| `overviewCounts.test` | counts reconcile and open matching lists (SC-012) |
| `existingOutputsUnchanged.test` | deterministic generation, review, Postman export and coverage revision are byte-identical for the existing corpus (SC-014) |
| `aiSuggestions.test` | stub provider: only the valid suggestion accepted, as `draft` and marked AI (Story 8) |
| `aiUnavailable.test` | every non-AI capability works with no provider (SC-015) |
| Frontend `*Accessibility.test` | names, keyboard paths, non-colour cues (SC-016) |

## Manual walkthrough (real application, local sample target)

Start the sample target and the application:

```bash
npm run security:stub -w backend   # loopback sample target on 127.0.0.1:4700 with deliberate flaws
npm run dev
```

Open the app, upload `backend/tests/fixtures/securityLab/sample-api.yaml` through the guided workflow (or Security Lab's
prompt to do so), then open **Security Lab** in the sidebar (`#/security`).

### 1. Analysis (Story 1, US1)

1. Overview shows observation counts by classification and the note that specification analysis does not prove runtime
   vulnerabilities.
2. Open the observation for `GET /public/status`: classified informational, "explicitly public by declaration", with its
   specification element and rationale.
3. Open the observation for an operation with no `security` and a root requirement: "inherits root requirement", **no** unprotected claim.
4. Open a `password` property observation: the basis reads `format-password`; a property matched only by name reads
   "name match", and is at most "requires additional context".

### 2. Generate and review (Story 2)

0. In the guided workflow's API review step select 3 operations, then open Security Lab. The Overview counts cover every operation;
   the Scenarios area states "scope: 3 selected operations, N left out". Generate, then widen to all operations and generate
   again: scenarios for the other operations are added and the first batch is unchanged.
1. Scenarios → **Generate**. Filter by category `authentication`, severity `high`; the count matches the list (FR-064).
2. Open a scenario: request preview, expected behavior with its basis (documented or named product rule), prerequisites,
   evaluation conditions, destructive flag. A BOLA scenario shows "missing: second identity" until the profile has one.
3. Edit the request (material): approval is withdrawn and the history shows version 1, version 2 and the approval's version.
   Edit the title (non-material): approval is kept.
4. Batch: filter by an operation, choose **Submit for review**, then **Approve** on the visible list; the confirmation names the
   count, excludes destructive and incomplete ones, and lists them with counts. Approve a destructive scenario individually and
   see the additional confirmation.
5. Reject a scenario with a reason; it cannot be selected for a run and shows why.

### 3. Profile and safe run (Stories 3 and 6)

1. Execution and Findings → **New profile**: choose an environment of tier `local` pointing at `http://127.0.0.1:4700`, allowed
   host `127.0.0.1`, port `4700`, allowed address range `127.0.0.1/32`, two identities mapped to the environment's secret
   variables, owned-resource test data, budget 40, concurrency 1, timeout 10 s, cleanup `delete-created-via-spec`.
2. Create a second profile with tier `production`: refused with `production_tier_refused`. A `staging` profile that lists a
   loopback range: refused.
3. Select approved scenarios. **Preview** shows profile, tier, base URL, scenario and request counts, destructive scenarios, hosts,
   limits and the "real requests will be sent" statement. Start requires the confirmation; for a staging-like profile it also
   requires typing the target name and base URL.
4. Watch progress. Cancel part-way: unstarted scenarios become `not_run`, completed ones keep evidence, cleanup runs and is reported.
5. Make the sample target answer a `302` to `http://10.0.0.5/` for one operation: the scenario shows `redirect_blocked`; no request
   left the machine (the target's request log proves it). Point the profile's allowed host at a name that resolves to a
   non-listed address: `restricted_address_blocked`.
6. Make the sample target's cleanup `DELETE` fail: the run result shows the failed cleanup, what remains and how to remove it.

### 4. Evaluation and findings (Story 4)

1. The sample target accepts a request with no token on one operation: that scenario is `failed`, one finding is created with
   expected and observed behavior, redacted evidence, suggested severity, confidence with its basis, remediation and links
   to scenario, run and specification element.
2. A scenario against a target that times out is `errored`, never `passed`, with no finding. An ambiguous body gives `inconclusive`.
3. Rerun the same failing scenario twice more: the Findings count does not change; the finding shows 3 occurrences with the
   first and latest failure times. Change its status to `resolved` with a note: it reads "engineer asserted". Rerun against the
   unchanged vulnerable target: the finding reopens and the history says so. Mark it `accepted-risk`, rerun again: the status stays and
   an "unreviewed occurrence" flag appears until acknowledged.
4. Fix the sample target, rerun: the result passes and a `resolved` finding becomes "verified by rerun". Edit the scenario's request
   (material) and make it fail again: a separate finding appears that links to the earlier version's finding.

### 5. Overview and Reports (Story 5)

1. Overview groups **Potential risks (specification analysis)** and **Findings (execution evidence)** separately, each with its
   evidence-basis line. Click a count: the matching list opens already filtered to exactly that count.
2. Reports → **Download HTML**. Open it: summary, category coverage, outcomes, findings, specification revision, profile name and
   tier per run, taxonomy edition `owasp-api-top10-2023`, not-covered categories with reasons, the limits statement. Search
   the file for the seeded test token from the walkthrough: it must be absent.

### 6. Export (Story 7)

1. Reports → **Export Postman**. The collection holds approved scenarios at their approved versions; the environment template
   has empty secret variables for each identity; a bounded-repeat scenario is listed under limitations.
2. Export twice: the files are equivalent.

### 7. Taxonomy and registry (FR-012 to FR-016)

Categories shows each category's support level and taxonomy ids with their relation; input validation is shown as "related"
to API8. SSRF and unsafe consumption and API inventory show no executable scenarios and say why.

### 8. AI suggestions (Story 8, optional)

With a provider available, **Suggest** returns draft scenarios marked AI; with none, the control states the readiness reason
and every other step above still works.

### 9. Retention across session expiry and deletion (FR-051, SC-017)

1. With approved scenarios, a finished run and a finding in place, restart the backend (or wait out the idle time). Reload and
   open Security Lab: scenarios, approvals, the finding and the run summary are present, marked "specification not loaded";
   profiles, identities and the environment's credentials are gone; the finding's evidence panel says "raw evidence no longer
   available" while its observed summary remains. Generation, approval and run are unavailable until a specification is loaded.
2. Upload the specification again: the flags become current, stale or orphaned as appropriate; nothing was lost.
3. Open the same URL in a private window or another browser: none of the retained work is visible.
4. **Retained data** shows what is kept and what goes with the session. Delete one assessment (type its label to confirm), then
   delete everything (type the confirmation): both complete and nothing remains, including in the database file.

### 10. Theme, layout, accessibility (FR-066)

Repeat steps 1 to 3 in dark theme and at a 375 px wide viewport: no horizontal page scroll, large request and response
content scrolls within its block, every status and outcome has a text label, every control is reachable by keyboard with a
visible focus ring.

## Done criteria

All automated checks pass; the walkthrough completes with the stated outcomes; no secret appears in any stored artifact; the
roadmap entry, documentation and version bump listed in [plan.md](plan.md) are done. Anything not run is stated plainly in the
roadmap entry's "Not covered" line (for example a manual visual pass).
