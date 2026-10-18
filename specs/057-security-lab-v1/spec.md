# Feature Specification: ApiPilot Security Lab — V1

**Feature Branch**: `AP-057` (the spec directory name is independent of the git branch name)

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "ApiPilot Security Lab — V1. Implement Security Lab as an integrated API security testing capability within ApiPilot. QA engineers can (1) analyze an API specification for security-relevant requirements and potential risks, (2) generate security-focused test scenarios across supported categories, (3) review, edit, approve and reject scenarios before execution, (4) execute approved tests on demand against configured local or authorized staging environments, (5) evaluate execution evidence against explicit expected security behavior, (6) create traceable findings with severity, confidence, evidence and remediation guidance, and (7) export executable security test artifacts in the existing supported format. Security Lab extends ApiPilot's existing analysis, scenario generation, execution and artifact export capabilities and is not a separate API testing framework. It adds a navigation entry near Analysis and Execution with four areas (Overview, Scenarios, Execution and Findings, Reports); a deterministic security analysis layer over the normalized API model that interprets OpenAPI security inheritance and overrides correctly and classifies observations as informational, potential risk, requires additional context, or not measurable; schema-validated security scenarios with provenance from operation to evidence; an extensible category registry with documented support levels mapped to a versioned OWASP API Security Top 10 taxonomy (authentication, authorization, broken object level authorization, object-property authorization and mass assignment, input validation, resource consumption and rate limiting, sensitive data exposure, security misconfiguration and error handling, sensitive business flows, SSRF and unsafe API consumption, API inventory); a Draft, In review, Approved, Executed, Evaluated lifecycle with reapproval on material edits and extra confirmation for destructive scenarios; and execution profiles for local and staging targets with host and port allow-lists, TLS policy, named test identities, request budgets, timeouts, concurrency limits, permitted categories, destination validation on every request and redirect, redaction of secrets from logs, evidence and reports, cancellation, and visible cleanup failures. Section 8 of the original brief (Execution) was cut off in transmission; its requirements are derived from the objective, section 2 (Execution and Findings) and section 7, and are recorded in Assumptions."

**Extends**: `specs/002-openapi-specification-engine` (the `ApiModel` contract and security definitions), `specs/003-deterministic-test-designer` (rule-based scenario generation and provenance), `specs/005-ai-test-scenario-designer` (optional, schema-validated AI suggestions), `specs/006-test-scenario-review` (review and approval), `specs/007-postman-collection-generator` (the executable artifact), `specs/018-test-execution-results` (target environments, confirmation, run records), `specs/046-api-test-coverage-intelligence` (specification revision tracking). **Relates to**: `specs/017-session-workflow-isolation` (session scoping), `specs/025-local-persistence-layer` (encrypted local storage of credentials and results), `specs/054-sidebar-shell-redesign` (navigation and shell), `specs/056-har-json-input-support` (observed and inferred facts stay distinguishable; a Security Lab scenario never rests on an inference as if it were documented).

## Clarifications

### Session 2026-10-18

- Q: How long should Security Lab keep approved scenarios, run evidence and findings if the engineer is idle? → A: Scenarios, versions, findings and report-relevant run summaries survive session expiry for the same browser, until the engineer deletes them. Credentials, environments, profiles and raw evidence bodies are still removed with the session.
- Q: When the engineer has already selected a subset of operations in the guided workflow's API review step, should Security Lab generate scenarios and analysis only for that subset? → A: Analysis and the Overview cover every operation. Scenario generation defaults to the earlier selection, and the engineer can widen or narrow it, with the active scope always shown.
- Q: If the same scenario fails again when the engineer re-runs it, should that add to the existing finding or create a new finding? → A: One finding per scenario version. A repeat failure adds an occurrence with its own evidence to the existing finding, and reopens it if it was marked resolved.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what the specification says about security, and what it does not (Priority: P1)

A QA engineer opens Security Lab for the API specification they are working with and sees a security analysis: which authentication schemes are declared, which operations require which scheme, which operations have no effective security requirement, which operations look sensitive (for example deleting a resource, or taking a resource identifier), which schemas carry properties that may be protected, and which inconsistencies exist inside the specification itself. Every observation says where in the specification it comes from, why it was raised, and how certain it is. An operation without its own security requirement is not called vulnerable: the analysis first works out whether it inherits a requirement from the whole specification or has been explicitly marked public.

**Why this priority**: The analysis is the foundation for every other story, and it delivers value on its own with no target system and no execution. It is also where the product is most likely to overclaim, so its honesty rules come first.

**Independent Test**: Analyze a specification that has a root security requirement, an operation that overrides it with its own, an operation that explicitly clears it (public), and an operation in a specification with no security definitions at all. Verify the effective requirement for each, the classification of each observation, and that no observation states or implies a proven runtime vulnerability.

**Acceptance Scenarios**:

1. **Given** a specification with a root-level security requirement and an operation that declares none of its own, **When** it is analyzed, **Then** the operation is reported as inheriting the root requirement, and no "unprotected" observation is raised for it.
2. **Given** an operation that explicitly declares an empty security requirement, **When** it is analyzed, **Then** it is reported as intentionally public according to the specification, classified as an informational observation, and (if it looks sensitive) as requiring additional context rather than as a risk.
3. **Given** a specification that declares no security schemes and no requirements, **When** it is analyzed, **Then** the analysis states that nothing can be concluded about authentication from this specification and classifies the question as not measurable with the available inputs.
4. **Given** an operation that overrides the root requirement with a different scheme, **When** it is analyzed, **Then** the effective requirement shown is the operation's own, and the observation names both the override and the root requirement it replaced.
5. **Given** any observation, **When** the user opens it, **Then** it shows its classification (informational observation, potential risk, requires additional context, or not measurable), the specification element it comes from, and the rationale in plain language.
6. **Given** a property whose name suggests sensitivity (for example `password` or `ssn`) with no other marker, **When** it is analyzed, **Then** the property is reported only with the stated basis for the classification (for example "name match" versus "declared `format: password`" versus "user-configured sensitive field"), and a name match alone is never presented as a confirmed sensitive field.
7. **Given** identical specification input, **When** it is analyzed twice, **Then** the observations, their order and their classifications are identical.

---

### User Story 2 - Generate security scenarios and review them before anything runs (Priority: P1)

From the analysis, the engineer generates security scenarios for the categories Security Lab supports. Each scenario is a complete, self-explanatory test intent: what it tests, why, what it needs (test data, identities, credentials), how the request is modified from a normal request, what secure behavior is expected, how the outcome will be judged, how severe a failure would be, and whether it could change data. The engineer filters and searches the list, opens a scenario to see the request and the expected behavior, edits it if needed, and approves or rejects it. Nothing can be executed until it is approved.

**Why this priority**: Generation plus human review is the product's core promise (deterministic generation, human ownership of quality decisions) and is independently useful, because the approved scenarios can already be exported (Story 7) without any execution.

**Independent Test**: Generate scenarios for a specification, filter them by category and severity, open one, edit its request, observe that approval is withdrawn, approve it again, reject another, and verify the rejected one cannot be selected for execution.

**Acceptance Scenarios**:

1. **Given** an analyzed specification, **When** the engineer generates scenarios, **Then** every scenario carries the full set of required content (identifier, specification revision, target operation and method, category and taxonomy identifier, objective, rationale, prerequisites and required test data, required identities, request setup and controlled mutations, expected security behavior, evaluation conditions, potential impact and suggested severity, destructive flag, approval state, known limitations and required manual inputs), and a scenario missing any of it is rejected and never shown as usable.
2. **Given** the same specification and the same settings, **When** scenarios are generated twice, **Then** the same scenarios with the same stable identifiers are produced.
2a. **Given** the engineer selected 10 of 50 operations in the API review step, **When** they open Security Lab, **Then** the analysis and Overview cover all 50, scenario generation is scoped to the 10 by default with the scope and the 40 operations left out stated, and widening the scope to all 50 generates scenarios for the other 40 without changing the existing ones.
3. **Given** a scenario whose prerequisites are unsupported or incomplete (for example it needs two identities and only one is configured), **When** it is listed, **Then** it is clearly marked with exactly what is missing, and it cannot be executed until the prerequisite is met.
4. **Given** the scenario list, **When** the engineer searches or filters by operation, category, severity, approval status or execution status, **Then** only matching scenarios are listed, with the count of matches.
5. **Given** an approved scenario, **When** the engineer makes a material edit (to the request, expected behavior, target operation or security intent), **Then** the scenario returns to review, its earlier approval is recorded as applying to the earlier version only, and it cannot execute until it is approved again.
6. **Given** a scenario, **When** the engineer edits only a non-material field (for example a note), **Then** the approval is kept and the edit is recorded.
7. **Given** a rejected scenario, **When** the engineer tries to include it in a run, **Then** it is not selectable and the reason is shown.
8. **Given** a scenario that was edited, **When** its history is opened, **Then** the original generated content, each edit with its author and time, and which version each approval applies to are all visible.
9. **Given** a scenario flagged destructive, **When** the engineer approves it, **Then** an additional explicit confirmation naming the operation and stating that it may change or delete data is required, and a batch approval never approves it silently.

---

### User Story 3 - Run approved scenarios safely against a target I am allowed to test (Priority: P1)

The engineer chooses a target profile (a local service, or a staging environment they are authorized to test), selects approved scenarios, sets the request budget, timeout and concurrency within the profile's limits, and explicitly confirms the run. ApiPilot sends only the requests those scenarios define, only to destinations the profile permits, within the budget, and shows progress. The engineer can cancel at any time and keeps the results gathered so far. At the end, any cleanup that was needed and failed is visible in the run result.

**Why this priority**: Execution is what turns analysis into evidence, and it is the riskiest capability in the feature. The safety controls are not an add-on; they are what makes a security-probing tool acceptable to run at all.

**Independent Test**: Against a local sample service, run a mixed set of approved scenarios, cancel part-way and verify partial results are kept. Then attempt a run that violates each control in turn (a destination outside the allow-list, a redirect to a disallowed host, a budget smaller than the selection, a scenario in a category the profile does not permit, a destructive scenario against staging) and verify each is refused with a named reason and that no request reached the disallowed destination.

**Acceptance Scenarios**:

1. **Given** a target profile and a selection of approved scenarios, **When** the engineer opens the run confirmation, **Then** it names the profile, environment tier and base URL, lists the number of scenarios and requests that will be sent, lists every scenario that may change data, and states the budget, timeout and concurrency, and nothing is sent until the engineer confirms.
2. **Given** a staging profile, **When** the engineer starts a run, **Then** they must explicitly confirm the target by name and base URL and state that they are authorized to test it, before any request is sent.
3. **Given** a profile whose allowed hosts and ports do not include a request's destination, **When** the run reaches that request, **Then** the request is not sent, the scenario is recorded as blocked with the reason, and the rest of the run continues.
4. **Given** a target that answers with a redirect to a host or port outside the profile's allowance, **When** the redirect is received, **Then** it is not followed, and the scenario records a blocked redirect with the destination (credentials removed).
5. **Given** a host name that resolves to a private, loopback or link-local address, **When** the selected profile is not a local profile that explicitly allows that address range, **Then** the request is blocked before it is sent, even if the host name itself is on the allow-list.
6. **Given** a selection that needs more requests than the run budget allows, **When** the engineer tries to start it, **Then** the engineer is told the required and allowed counts and must reduce the selection or lower the per-scenario repetition; the budget is never exceeded silently, and a hard ceiling that no profile can exceed applies in all cases.
7. **Given** a run in progress, **When** the engineer cancels it, **Then** no further requests are sent after the cancellation takes effect, completed scenarios keep their evidence, unstarted ones are marked not run, and any needed cleanup still runs and is reported.
8. **Given** a run in which a cleanup step failed (for example a created resource could not be removed), **When** the run ends, **Then** the run result shows the failed cleanup, what was left behind, and how to remove it by hand.
9. **Given** a destructive scenario and a staging profile that does not state that destructive tests are safe for that environment, **When** the engineer selects it, **Then** it is not selectable, with the reason; and when the profile does allow it, the scenario needs its own additional confirmation at run time as well as at approval.
10. **Given** a profile whose permitted categories exclude a scenario's category, **When** the engineer selects it, **Then** the scenario is not selectable, with the reason.
11. **Given** any language model involved in generating or suggesting scenarios, **When** a run starts, **Then** the model has had no ability to choose a URL, override the profile or add a destination; the requests sent are exactly those the approved scenario version defines.

---

### User Story 4 - Judge the evidence against explicit expectations and record findings (Priority: P2)

After a run, each executed scenario is evaluated against the expected security behavior and evaluation conditions it was approved with. The result is one of a small set of outcomes, and only a violated expectation becomes a finding. A finding states what was expected, what was observed (with the evidence, secrets removed), a suggested severity, a confidence level with the reason for it, and remediation guidance, and links back to its scenario, its source operation and the specification element that motivated it. The engineer can adjust a finding's status and record their own assessment.

**Why this priority**: Evaluation converts raw responses into the thing a stakeholder reads. It depends on Stories 2 and 3 but is the reason to run anything.

**Independent Test**: Run scenarios against a sample service that deliberately violates some expectations and honors others. Verify that honored expectations are recorded as passed, violated ones become findings with evidence and a link back to scenario and specification element, and that ambiguous responses are inconclusive rather than findings.

**Acceptance Scenarios**:

1. **Given** an executed scenario whose evidence satisfies its expected behavior, **When** it is evaluated, **Then** it is recorded as passed, and no finding is created.
2. **Given** an executed scenario whose evidence violates its expected behavior, **When** it is evaluated, **Then** a finding is created with the expected behavior, the observed behavior, the redacted request and response evidence, the suggested severity, the confidence and its stated basis, and remediation guidance.
3. **Given** a response from which the expected behavior cannot be judged (for example a timeout, a network error, or a body the conditions cannot read), **When** it is evaluated, **Then** the outcome is inconclusive with the reason, and no finding is created.
4. **Given** a scenario that could not run because a prerequisite, destination, budget or cancellation prevented it, **When** the run ends, **Then** it is recorded as blocked or not run, never as passed.
5. **Given** a finding, **When** it is opened, **Then** the engineer can follow links to its source scenario (the approved version that ran), its execution record and the specification element it relates to.
6. **Given** a finding, **When** the engineer changes its status (open, accepted risk, false positive, resolved) or its severity, **Then** the change is recorded with the engineer's note and time, the original suggested severity stays visible, and a status such as "resolved" is the engineer's statement, not a verified result, until the scenario is run again and passes.
7. **Given** identical evidence and an identical approved scenario, **When** it is evaluated twice, **Then** the outcome, severity and confidence are identical; no model decides whether a test passed.
8. **Given** the same scenario version run again later, **When** its new outcome differs from the previous one, **Then** both outcomes are kept, with their times, and the finding history shows the change.
9. **Given** a scenario version that already has a finding, **When** a later run of that same version fails again, **Then** no second finding is created: the existing finding gains an occurrence with its own run, time and evidence, its occurrence count and latest-failure time update, and it reopens if it had been marked resolved or verified by a passing re-run.
10. **Given** a scenario that is edited materially and then fails, **When** the new version's finding is created, **Then** it is a separate finding that links to the earlier version's finding, because the two versions test different things.

---

### User Story 5 - Overview and Reports: communicate the security posture without overclaiming (Priority: P2)

The engineer opens the Overview to see where things stand: analysis observations by classification, scenarios by category and review status, the latest execution summary, findings by severity and status, and which high-priority operations have not been tested yet. Potential risks (from the specification) and findings (backed by execution evidence) are shown separately and labeled so that no one reads a specification observation as a proven vulnerability. The Reports area turns the same information into a security assessment summary that can be exported for sharing.

**Why this priority**: This is how the work is communicated to people who will not use the tool. It depends on the earlier stories but adds no new capability on its own.

**Independent Test**: With a specification analyzed, scenarios generated, a subset executed and a finding recorded, open the Overview and Reports and verify every count against the underlying list, the separation of risks from findings, and the report's content and exclusions.

**Acceptance Scenarios**:

1. **Given** analysis, scenarios and at least one run, **When** the Overview opens, **Then** it shows observation counts by classification, scenario counts by category and by review status, the latest run's summary, finding counts by severity and by status, and a list of high-priority operations with no executed scenario.
2. **Given** potential risks and findings, **When** the Overview or a report shows them, **Then** they appear in separate, labeled groups, each with a one-line statement of its evidence basis (specification analysis versus execution evidence).
3. **Given** no analysis, no scenarios, no runs or no findings, **When** the corresponding Overview or Reports section opens, **Then** an empty state explains what is missing and how to create it, distinct from a loading state and from an error state.
4. **Given** a report is requested, **When** it is produced, **Then** it contains the assessment summary, category coverage and test outcomes, findings with remediation status, the specification revision it covers, the target profile name and tier of each run, the taxonomy version used, the categories and prerequisites not covered, and a statement that specification analysis does not prove runtime vulnerabilities.
5. **Given** a report is produced, **When** it is inspected, **Then** it contains no credential, token, cookie, password or other secret value, and evidence in it is redacted exactly as stored.
6. **Given** a count shown on the Overview, **When** the engineer selects it, **Then** the Scenarios or Findings list opens already filtered to exactly that count.

---

### User Story 6 - Define who the tests act as and where they may go (Priority: P2)

Before running, the engineer defines one or more target profiles: the base URL, the environment tier, the hosts and ports the run may reach, the TLS policy, the named test identities and the roles they hold (each pointing at a stored credential, never containing one), the request timeout and maximum request count and concurrency, the scenario categories the profile permits, whether destructive tests are permitted for it, and how data created by tests is cleaned up. Local profiles may explicitly allow localhost or private-network addresses; staging profiles may not.

**Why this priority**: Profiles are the control surface for Story 3's safety rules, and Story 3 cannot run without at least one. It follows the stories that define what runs, and is independently testable through profile validation alone.

**Independent Test**: Create, edit and delete profiles of both kinds and verify that each rule is enforced at the point of use: invalid or unsafe profiles are refused with a named reason, secrets are never displayed back after saving, and a profile cannot be edited mid-run in a way that changes that run's limits.

**Acceptance Scenarios**:

1. **Given** the profile form, **When** the engineer saves a profile, **Then** the base URL, allowed hosts and ports, tier, timeout, request limit, concurrency and permitted categories are validated, and an invalid or unsafe combination is refused with a specific reason.
2. **Given** a profile of a production tier, **When** the engineer tries to use it for Security Lab, **Then** it is refused: Security Lab V1 runs only against local and non-production staging-like targets, and the reason is shown.
3. **Given** a profile base URL that is not on its own allowed hosts and ports, **When** it is saved, **Then** it is refused, because the base URL must itself be an allowed destination.
4. **Given** a local profile that explicitly allows loopback or private-network addresses, **When** a run uses it, **Then** requests to those addresses are allowed, and requests to any other private or loopback address that the profile does not name are blocked.
5. **Given** a staging profile, **When** it tries to allow loopback or private-network addresses, **Then** it is refused.
6. **Given** a named identity, **When** it is configured, **Then** it holds a role label and a reference to a stored credential; the credential value is stored encrypted, is never shown again, is never included in an export, a report, a log or stored evidence, and can be replaced but not read.
7. **Given** a profile with the TLS policy set to verify certificates (the default), **When** the target presents an invalid certificate, **Then** the request fails and the scenario is recorded with the reason; relaxed verification is available only on a local profile and only when chosen explicitly, and is stated on the run confirmation.
8. **Given** a profile's data-cleanup strategy, **When** a scenario creates data, **Then** the strategy is applied after the scenario or run, and a scenario that creates data but has no usable cleanup strategy is treated as destructive.

---

### User Story 7 - Export approved security scenarios as an executable artifact (Priority: P3)

The engineer exports the approved security scenarios in the product's existing executable format (a Postman collection), to run them outside ApiPilot or keep them with the project's tests. The export contains the requests and their expected checks, uses variables in place of credentials and base URLs, and states which approved scenarios it could not represent.

**Why this priority**: It reuses the existing exporter, so its incremental value is moderate, but it makes the work portable and it is the only part of the feature that needs no target environment.

**Independent Test**: Export a set of approved scenarios that includes one that cannot be expressed as a single request (a bounded repeated-request scenario). Verify the collection uses variables for base URL and credentials, contains no secret, is identical when exported twice, and lists the unrepresentable scenario with the reason.

**Acceptance Scenarios**:

1. **Given** approved scenarios, **When** the engineer exports them, **Then** the artifact contains only approved scenarios at their approved versions, with their expected security checks, and the same input yields an equivalent artifact each time.
2. **Given** scenarios that need identities or credentials, **When** they are exported, **Then** credentials appear only as named variables with no value, and the engineer is told which variables to supply.
3. **Given** an approved scenario that cannot be represented in the artifact (for example a scenario that needs a bounded burst of requests, or a persisted-state verification), **When** the export is produced, **Then** it is listed with the reason in the export's limitations and is not silently dropped or approximated.
4. **Given** no approved scenarios, **When** the engineer asks to export, **Then** export is unavailable with the reason.
5. **Given** an export, **When** it is inspected, **Then** each exported request is traceable to its scenario identifier, category and taxonomy identifier, and the export states that it was produced by the Security Lab and which specification revision it covers.

---

### User Story 8 - Optionally add AI-suggested scenarios without letting AI act (Priority: P3)

The engineer can ask the local AI to suggest additional security scenarios, such as injection probes or business-rule abuse ideas. Suggestions arrive as Draft scenarios, marked as AI-generated, checked against the same strict scenario structure as every other scenario, and rejected if malformed or if they request anything outside the supported actions. They never run until reviewed and approved like any other scenario, and the AI never decides whether a test passed.

**Why this priority**: It extends reach beyond what rules can derive, but it is optional: the feature is complete and useful without it, and a missing local model must not degrade anything else.

**Independent Test**: With a mock AI provider, return one valid suggestion, one malformed suggestion, one that names a destination, and one that requests an unsupported action. Verify only the valid one is accepted, as Draft and marked AI, and the others are rejected with named reasons.

**Acceptance Scenarios**:

1. **Given** the AI is available, **When** the engineer requests suggestions, **Then** each accepted suggestion appears as a Draft scenario, marked as AI-generated, with the same required content as any scenario.
2. **Given** an AI response that is malformed, that references an operation or field not in the specification, that contains a URL, host or header override, or that requests an action outside the supported set, **When** it is processed, **Then** that suggestion is rejected with a named reason, the rest of the response is still considered individually, and nothing is executed.
3. **Given** the AI is unavailable, **When** the engineer opens Security Lab, **Then** analysis, deterministic generation, review, execution, findings, reports and export all work, and the AI suggestion control states why it is unavailable.
4. **Given** an AI-suggested scenario, **When** it runs, **Then** its pass or fail evaluation is made by the same deterministic conditions as any other scenario.

---

### Edge Cases

- A specification has no operations, or no operation that any supported category applies to: Security Lab shows the analysis (with the "nothing to test" explanation) and generates no scenarios, without error.
- The specification changes after scenarios were generated or approved: scenarios generated against the earlier revision are marked stale, are not executable, and are never silently re-pointed at the new specification; the engineer regenerates and reviews.
- A scenario's target operation no longer exists in the current revision: the scenario is marked orphaned, keeps its history and findings, and cannot run.
- Two identities are required (for object-level authorization) but both resolve to the same credential: the scenario is marked as having an unsupported prerequisite, because the test would not distinguish owners.
- Known resource ownership is not provided for an object-level authorization scenario: the scenario is generated as incomplete, naming the missing test data, and is not executable.
- The target is unreachable, slow or returns malformed responses: the scenario is inconclusive or errored with a reason, never passed, and the run continues unless the engineer cancels.
- The target rate-limits the run itself (for example returns "too many requests" to unrelated scenarios): affected scenarios are marked inconclusive with that reason, and the run's own concurrency and pacing are not silently raised.
- A rate-limit scenario's documented threshold exceeds the profile's request budget: the scenario is generated as limited to what the budget allows, states that the threshold cannot be reached, and its outcome can at most be inconclusive about the threshold; it never exceeds the budget.
- A response body contains a secret (for example a returned token): the stored evidence masks it, and the finding says a secret-like value was present without storing the value.
- A response is very large or binary: evidence stores a bounded excerpt with a statement that it was truncated, and conditions that need the omitted part are inconclusive.
- A cleanup step is needed but the run was cancelled or the target went down: cleanup is still attempted once, its outcome is reported, and a failure names what remains.
- A scenario is approved in one browser and the same specification is opened from another: retained work, profiles, credentials and evidence are scoped to the browser that created them and are never visible to another.
- The session expires (or the backend restarts) between a run and its review: scenarios, approvals, findings and run summaries remain; raw evidence, profiles, identities and credentials are gone, and each affected finding says its raw evidence is no longer available. A new run needs a profile created again, and scenarios whose prerequisites depended on it show those prerequisites as missing.
- A retained scenario or finding refers to an operation in a specification that is no longer loaded: it is shown as orphaned, keeps its history, and cannot run until a matching specification is loaded and the scenario is regenerated and reviewed.
- The engineer edits a target profile while a run that uses it is in progress: the in-progress run keeps the limits it started with; the edit applies to later runs.
- Findings exist for a scenario that is then edited materially: the findings stay attached to the version that produced them, marked as for an earlier version.
- A taxonomy version changes in a later release: existing scenarios and reports keep the taxonomy version they were created with.
- The specification declares an OAuth2 or other scheme that needs a token exchange the profile cannot perform: the authentication scenarios that need a valid credential are marked as having an unsupported prerequisite rather than guessing a token.
- Rejected, stale and orphaned scenarios still appear in counts and reports with their own labels, so totals reconcile.

## Requirements *(mandatory)*

### Functional Requirements

**Placement and integration**

- **FR-001**: Security Lab MUST be a destination in the application's existing navigation, placed alongside the existing analysis and execution destinations according to the navigation's established order, and MUST use the existing application shell, visual language, themes (light and dark), responsive behavior and shared loading, empty and error presentation. No unrelated page may change.
- **FR-002**: Security Lab MUST work from the specification and `ApiModel` already loaded in the session, reuse the existing normalized API model, scenario model, review concepts, target environments, execution infrastructure, run records and Postman artifact generation, and MUST NOT introduce a parallel specification parser, scenario pipeline, HTTP execution engine or exporter. Where a needed capability is absent, Security Lab MUST add the smallest extension to the existing one and document the remaining limitation.
- **FR-003**: Security Lab MUST be organized into four areas: Overview, Scenarios, Execution and Findings, and Reports, each independently reachable and each showing distinct loading, empty and error states.
- **FR-004**: Analysis, scenario generation, review edits that need the specification, and execution MUST be unavailable, with the reason and the way to proceed, when no specification is loaded. Retained work (FR-051) MUST stay readable without a loaded specification: scenarios with their history, findings, run summaries and reports, each marked "specification not loaded" instead of stale or orphaned, with the engineer able to delete retained data.

**Security analysis**

- **FR-005**: The security analysis MUST be deterministic, MUST NOT use AI, and MUST be derived only from the normalized API model: identical input MUST give identical observations in identical order. It MUST cover every operation in the loaded specification, regardless of any operation selection made in the guided workflow, and the Overview's counts and its list of untested high-priority operations MUST likewise cover every operation.
- **FR-006**: The analysis MUST determine, for every operation, its effective security requirement by applying the specification's inheritance and override rules: the root requirement applies unless the operation declares its own, an operation's own requirement replaces the root one, and an explicitly empty requirement means public by declaration.
- **FR-007**: The analysis MUST cover: declared authentication schemes and which operations use them; operations whose effective requirement is none (distinguishing "explicitly public", "no requirement and none declared at the root", and "inherits"); operations that look sensitive (state-changing methods, deletion, administrative or account-related paths, resource-identifier parameters) with the basis for that judgment; input and output schema properties that may be sensitive or protected, with the basis for that judgment; HTTP methods and documented response behavior (for example documented error responses, missing documented error responses for protected operations); and specification-internal inconsistencies (for example duplicate or conflicting operation definitions, deprecation and versioning metadata, a declared scheme that no operation uses, an operation referencing an undeclared scheme).
- **FR-008**: Every observation MUST carry exactly one classification: informational observation, potential risk, requires additional context, or not measurable with the available inputs; the specification element it comes from; and a rationale. Observations MUST NOT state or imply that a runtime vulnerability exists.
- **FR-009**: A property MUST NOT be classified as sensitive solely from its name without recording the basis of the classification. A property classified only by name MUST be labeled as such and at most raise requires additional context; user-configured sensitive-field names MUST be recorded as user-provided, not as specification fact.
- **FR-010**: The analysis MUST NOT claim to discover undocumented deployed endpoints, and the inventory observations MUST be limited to the available specifications.
- **FR-011**: An observation raised from an inference or from an observed fact (for example an operation whose model came from a HAR capture under AP-056) MUST keep the origin label it already has, and MUST NOT be presented as documented.

**Categories and taxonomy**

- **FR-012**: Security Lab MUST provide a category registry in which each category has a stable identifier, a name, a documented support level, the prerequisites it needs, whether it can execute or is analysis-only, and its taxonomy mapping. The registry MUST be extensible without changing the scenario, review, execution or reporting behavior for existing categories.
- **FR-013**: Support levels MUST be at least: supported (can generate and execute when its prerequisites are met), limited (generates scenarios or observations with stated restrictions; reliable detection is not claimed), and analysis-only (observations, no execution). The level of each category MUST be visible in the product and in reports.
- **FR-014**: The registry MUST include the categories: authentication; authorization; broken object level authorization; object-property authorization and mass assignment; input validation; resource consumption and rate limiting; sensitive data exposure; security misconfiguration and error handling; sensitive business flows; SSRF and unsafe API consumption; and API inventory. The initial support levels MUST be documented, with SSRF and unsafe API consumption limited (no reliable detection is claimed without controlled callback verification or a downstream-integration harness), sensitive business flows limited to workflows with a defined expected policy, bounded actions and suitable test data, and API inventory analysis-only.
- **FR-015**: Category support status and taxonomy membership MUST be separate attributes. Every category MUST map to one or more identifiers of a named, versioned OWASP API Security Top 10 edition, the edition identifier MUST be shown wherever a taxonomy identifier is shown, and a scenario MUST keep the taxonomy version it was created under.
- **FR-016**: Where a category's prerequisites are not met (for example no second identity), the scenarios for it MUST still be generated when the prerequisite can be named, MUST be marked incomplete with exactly what is missing, and MUST NOT be executable until it is provided.

**Scenario generation**

- **FR-017**: Security scenarios MUST be produced by extending the existing scenario-generation pipeline with a security-specific scenario type or a compatible extension of the existing test model, so that approval, review, provenance, deduplication and export reuse the existing concepts.
- **FR-018**: Scenario generation scope MUST default to the operations selected in the guided workflow's API review step (every operation when no selection was made), and the engineer MUST be able to widen it to all operations or narrow it to chosen operations or categories before generating. The active scope, and how many operations it leaves out, MUST be shown wherever scenarios are generated or listed. Scenarios already generated for an operation outside a later, narrower scope MUST be kept and shown, not deleted. Deterministic generation MUST NOT depend on AI. Every deterministic scenario MUST be reproducible from the specification, the generation settings and the configured test data: identical inputs MUST give identical scenarios with identical stable identifiers.
- **FR-019**: Every scenario MUST carry: a stable identifier; the specification revision; the target operation and HTTP method; the security category and taxonomy identifier; an objective and rationale; prerequisites and required test data; required identities, roles or credentials; request setup and controlled mutations; expected security behavior; evaluation conditions; potential impact and suggested severity; a destructive-operation flag; an approval state; known limitations and required manual inputs; and its origin (rule-derived, AI-suggested, or user-edited).
- **FR-020**: Every scenario MUST be validated against a typed structure before it is accepted. A malformed scenario, a scenario referencing an operation, parameter or field not present in the specification, and a scenario that requests an action outside the supported set MUST be rejected with a named reason and MUST NOT appear as usable. Free-form model output MUST NOT directly cause an HTTP request.
- **FR-021**: Scenario request construction MUST be limited to a fixed, documented set of controlled mutations of a request built from the specification (for example omit, replace or malform a credential; change a path or body identifier to another identity's resource; add a protected property to a body; send a value that violates a declared constraint; repeat a request a bounded number of times). A scenario MUST NOT choose its own destination, add its own hosts, or override a profile restriction.
- **FR-022**: The expected security behavior of a scenario MUST be stated explicitly, and MUST be grounded in the specification or in a named product rule recorded on the scenario. Where the specification documents a response for the situation, that documentation MUST be used and cited; where it does not, the scenario MUST state the rule applied (for example "a request without a required credential must not be processed as successful") and MUST NOT present an invented status code as documented.
- **FR-023**: Each scenario MUST keep provenance from the generated scenario to its source operation, to the specification requirement or observation that motivated it, and to every execution record and finding that results from it.
- **FR-024**: Equivalent scenarios MUST be deduplicated deterministically, keeping one representative and the provenance of the others; the product MUST avoid generating scenarios whose outcome would be uninformative for the specification at hand (for example an unauthenticated-access scenario for an operation declared public).
- **FR-025**: Generation MUST NOT assume every operation requires authentication, MUST NOT generate authentication-removal scenarios for operations whose effective requirement is none, and MUST NOT generate object-level authorization scenarios unless the operation takes a resource identifier and two identities and their resource ownership are configured or marked as required input.
- **FR-026**: Generation for resource consumption MUST use only bounded repetition, bounded by the lesser of the documented or configured threshold plus a small stated margin, and the profile's request budget; no scenario MUST be generated whose request count is unbounded.
- **FR-027**: Injection-style input probes MUST be generated only for categories and targets for which the profile permits them and only from a fixed, documented, benign probe set that does not damage data or the target; they MUST be marked with the category and the limits of what a pass or fail proves.

**Review and approval**

- **FR-028**: Scenarios MUST follow the lifecycle Draft, In review, Approved, Executed, Evaluated. Rejected is a separate terminal-until-reopened state from which a scenario cannot execute. Allowed transitions MUST be defined and enforced by the product, not by the interface alone.
- **FR-029**: A scenario MUST be executable only when its approved version is the version being executed, its prerequisites are met, its specification revision is current, and it is not rejected, stale or orphaned.
- **FR-030**: Scenario edits MUST keep the original generated content and the origin of every change. A material edit (a change to the request, expected behavior, evaluation conditions, target operation or security intent) MUST withdraw approval and return the scenario to review; approval MUST be recorded against a specific version and MUST NOT carry over to a later one.
- **FR-031**: Batch review MUST act only on an explicit set the engineer can see and identify: the filtered or selected scenarios, with their count shown and listable before confirming. A batch MUST NOT include scenarios that are hidden by a filter, incomplete, or destructive; destructive scenarios MUST be confirmed individually or through a separate confirmation that names each one.
- **FR-032**: Review MUST remain practical at realistic specification sizes: grouped and bulk decisions by filter, category, operation or selection MUST be provided in addition to per-scenario decisions.
- **FR-033**: Destructive scenarios MUST require an additional explicit confirmation at approval, naming the operation and stating that data may change, and again at run time (see FR-045).

**Target profiles and execution safety**

- **FR-034**: Security Lab MUST provide execution profiles for local and staging targets, reusing the existing target environment concept where possible. A profile MUST support: an explicit base URL; a target environment identifier and tier; allowed hosts and ports; a TLS policy; credential references; named test identities and their roles; a request timeout; a maximum request count; a maximum concurrency; the permitted scenario categories; whether destructive scenarios are permitted; and a data-cleanup strategy.
- **FR-035**: Profiles MUST be validated when saved and again when used. The base URL MUST itself be an allowed destination. Production-tier targets MUST be refused. Hard ceilings for request count, concurrency and timeout MUST exist that no profile can exceed, and conservative defaults MUST apply when a profile does not set a value.
- **FR-036**: Target restrictions MUST be enforced by the server's execution service on every request. The interface MUST NOT be the only enforcement point, and a request made directly to the execution service MUST be subject to the same checks.
- **FR-037**: Before every request, the destination MUST be validated after name resolution against the profile's allowed hosts and ports and against the private, loopback and link-local range rules. The validation MUST apply to the address actually connected to, so that a changed name resolution cannot bypass it.
- **FR-038**: Redirects MUST NOT be followed automatically. A redirect response MUST be revalidated as a new destination under FR-037, and followed only if allowed, within a small stated hop limit; otherwise it MUST be recorded as a blocked redirect.
- **FR-039**: Private, loopback and link-local destinations MUST be blocked unless the selected profile is a local profile that explicitly allows them by naming the address or range. A user-entered URL MUST NOT be treated as trusted, and a local profile MUST receive the same request validation and execution controls as a staging profile.
- **FR-040**: No model, scenario or imported content MAY select a URL, add a host, change a profile or override a restriction.
- **FR-041**: Staging runs MUST require explicit confirmation of the target by name and base URL together with a statement that the engineer is authorized to test it; MUST use only the profile's approved identities and credentials; MUST apply the profile's budget and timeout; and MUST NOT run destructive scenarios unless the profile states that destructive tests are safe for that environment and the scenario was individually confirmed.
- **FR-042**: A run MUST NOT begin until the engineer confirms a summary naming the profile, tier, base URL, number of scenarios and requests, every destructive scenario, budget, timeout, concurrency, TLS policy, and the statement that real requests are sent to the target. A run is always started by an explicit engineer action; the product MUST NOT start, repeat or schedule a run automatically.
- **FR-043**: A run MUST enforce the request budget as a hard limit: no request beyond the budget is sent, and scenarios the budget could not cover are recorded as not run. The same request MUST NOT be silently retried.
- **FR-044**: A run MUST enforce per-request timeouts and the concurrency limit, MUST show progress, MUST support cancellation at any time with no further requests sent after the cancellation takes effect, and MUST keep and show partial results.
- **FR-045**: Destructive scenarios MUST be marked in the run confirmation and require their own confirmation per run. A scenario that creates data and has no usable cleanup strategy MUST be treated as destructive.
- **FR-046**: Cleanup MUST be attempted after a scenario or run according to the profile's strategy, including after cancellation and after failure. A cleanup that fails MUST be recorded and shown in the run result with what remains and how to remove it manually.
- **FR-047**: Only one Security Lab run MUST execute for a session at a time, consistent with the existing execution slot; starting another MUST be refused with the reason.

**Secrets, redaction and storage**

- **FR-048**: Credentials, tokens, cookies, passwords and other secret values MUST be stored only encrypted at rest, MUST NOT be returned to the interface after saving, and MUST NOT appear in any log, stored evidence, finding, report, export or error message.
- **FR-049**: Authorization headers, cookies, password fields, token fields and configured sensitive fields MUST be redacted before evidence is stored, before anything is written to a log, and before anything is shown in a finding or report. Redaction MUST be applied before the data enters stored records so that later stages never hold the secret.
- **FR-050**: Stored evidence MUST be bounded in size, MUST state when it was truncated, and MUST record only what is needed to justify the outcome: the request as sent (redacted), the response status, selected headers, a bounded redacted excerpt of the body, timing, and the destination validation result.
- **FR-051**: Security Lab data MUST be stored locally and scoped to the browser that created it; it MUST NOT be visible to any other browser. Two lifetimes apply. **Retained work** (scenarios with all versions, review history and approvals; findings with their status, severity and history; and the summary of each run: its time, the profile name, tier and base URL it ran against, the limits used, each scenario's outcome and reason, and cleanup results) MUST survive session expiry and backend restart, and MUST remain available to the same browser until the engineer deletes it. **Session data** (environments and their credentials, profiles, identities, test data values and raw evidence bodies) MUST be removed with the session, as existing environments and run records are. A finding MUST keep its observed-behavior summary (status code, selected headers and a statement of what was found) after its raw evidence is removed, and MUST show that the raw evidence is no longer available. The engineer MUST be able to delete retained Security Lab data (all of it, or one assessment's) from the product, and the interface MUST say which data is retained and which is removed with the session. Specification content MUST NOT be sent to any external service, and any AI use MUST go only through the existing provider abstraction in local-first mode.
- **FR-052**: Logs MUST contain identifiers, stages, outcomes, durations and error categories, and MUST NOT contain raw request or response bodies, credentials, or specification content.

**Evaluation and findings**

- **FR-053**: Each executed scenario MUST be evaluated deterministically against its own approved expected behavior and evaluation conditions, giving exactly one outcome: passed, failed, inconclusive, blocked, errored, or not run. AI MUST NOT decide an outcome.
- **FR-054**: Only a failed outcome MUST create or update a finding. A scenario version MUST have at most one finding: the first failed outcome creates it, and each later failed outcome of the same version adds an occurrence to it (FR-058). Inconclusive, blocked, errored and not-run outcomes MUST NOT create or update findings and MUST NOT be reported as passed.
- **FR-055**: A finding MUST contain: a stable identifier; the expected behavior; the observed behavior; redacted request and response evidence; a suggested severity with its basis; a confidence level with its stated basis; remediation guidance; and links to its source scenario version, source operation, the motivating specification element, and its execution records. It MUST keep every occurrence (run, time, redacted evidence) with an occurrence count, the first and latest failure times, and the occurrence it is currently judged by (the latest).
- **FR-056**: Confidence MUST reflect the strength of the evidence (for example a documented expectation violated by a single clear response versus a rule-based expectation with ambiguous evidence) and MUST NOT be assigned by a model. Severity MUST start from the scenario's suggested severity and MUST NOT be raised by the product from evidence it cannot show.
- **FR-057**: Engineers MUST be able to set a finding's status (open, accepted risk, false positive, resolved), change its severity and add a note. Each change MUST be recorded with time and the original suggested values MUST remain visible. "Resolved" MUST be shown as the engineer's assertion unless a later run of the same scenario version passed. A later failed outcome of the same scenario version MUST reopen a finding that is resolved or verified by a passing re-run, recording the reopening in its history; a finding marked accepted risk or false positive MUST keep that status, and the new occurrence MUST be flagged so the engineer can review it.
- **FR-058**: Every execution of a scenario MUST be kept as its own record, so that repeated runs show how an outcome changed, and findings MUST stay attached to the scenario version that produced them. A material edit creates a new version, whose first failure creates a separate finding linked to the earlier version's finding.
- **FR-059**: Where the profile provides a safe and reliable way to read persisted state, an object-property authorization or mass-assignment scenario MAY verify the persisted result; where it does not, the scenario MUST state that persisted state is not verifiable and its outcome MUST be limited accordingly (inconclusive for a rejection that cannot be confirmed).

**Overview, reports and export**

- **FR-060**: The Overview MUST show: observations by classification; scenarios by category and by review status; the latest execution summary; findings by severity and by status; and high-priority operations with no executed scenario, with the basis for "high priority". Potential risks and findings MUST be shown separately and labeled by evidence basis, and each count MUST open the corresponding list filtered to exactly that set.
- **FR-061**: The Reports area MUST produce a security assessment containing: the summary; category coverage and outcomes; findings and remediation status; the specification revision; the profile name and tier of each included run; the taxonomy version; the categories, scenarios and prerequisites not covered, with reasons; the limits of what was tested; and a statement that specification analysis does not prove runtime vulnerabilities. Report content MUST be deterministic for identical records.
- **FR-062**: Reports MUST use the existing report and artifact infrastructure and presentation conventions, and MUST contain no secret and no unredacted evidence.
- **FR-063**: Export MUST produce the product's existing executable format from approved scenarios only, at their approved versions. It MUST use variables in place of credentials and base URLs, MUST be deterministic for identical approved scenarios, MUST NOT contain any secret, MUST keep each exported request traceable to its scenario, category and taxonomy identifier, and MUST list every approved scenario it could not represent with the reason. Generating it MUST NOT use AI.
- **FR-064**: The Scenarios area MUST provide a searchable and filterable list (by operation, category, severity, approval status and execution status), a detail view with the request and expected-behavior preview, the prerequisite and identity configuration, edit, approve and reject actions, and a clear indication of unsupported or incomplete prerequisites.
- **FR-065**: The Execution and Findings area MUST provide target profile selection, approved scenario selection, budget, timeout and concurrency settings within the profile's limits, the explicit confirmation, run progress with cancellation, and findings with evidence, remediation and links to their scenario and execution record.

**Quality and accessibility**

- **FR-066**: All new interface MUST be keyboard operable, have accessible names and visible focus, never communicate severity, status or outcome by color alone, support light and dark themes and narrow viewports without hiding important information, and show large request and response content in a way that scrolls without breaking the page layout.
- **FR-067**: Security Lab MUST NOT change the observable behavior of existing analysis, scenario generation, review, execution, reporting and export for existing inputs. Where it extends a shared component, existing outputs MUST remain byte-for-byte equivalent for existing inputs.
- **FR-068**: Documentation MUST describe Security Lab's purpose, the category registry with support levels and taxonomy mapping, the lifecycle, the profile fields and safety controls, what the analysis can and cannot conclude, evidence and redaction handling, export behavior, and the known limitations, including the limited categories and what was left out of V1.

### Key Entities *(include if feature involves data)*

- **Security Observation**: A result of specification analysis about one specification element. Attributes: classification (informational observation, potential risk, requires additional context, not measurable), the specification element it comes from, the rationale, the origin label, and the operation it concerns. Never evidence of a runtime vulnerability.
- **Effective Security Requirement**: For one operation, the requirement that applies after inheritance and overrides, with how it was determined (inherited, overridden, explicitly public, none declared anywhere).
- **Security Category**: A registry entry. Attributes: stable identifier, name, support level, prerequisites, execution capability, taxonomy mapping.
- **Taxonomy Mapping**: Association of a category to identifiers in a named, versioned OWASP API Security Top 10 edition. Separate from support level.
- **Security Scenario**: One test intent, with the attributes listed in FR-019, an origin, a version, and an approval record per version. Relates to one operation, one category, zero or more required identities, and any number of execution records.
- **Scenario Version and Review Record**: The content of a scenario at one point in time, who changed it and why, which approval (if any) applies to it, and whether the change was material.
- **Required Prerequisite**: A named need (identity, role, test data, resource ownership, documented threshold) with its met or missing state, shown on the scenario.
- **Execution Profile**: A target definition with the attributes in FR-034. Extends the existing target environment concept. Owns identities and the cleanup strategy.
- **Test Identity**: A named identity with a role label and a reference to a stored credential. The credential value is never readable.
- **Security Run**: One user-confirmed execution of selected approved scenario versions against one profile, with the budget, timeout, concurrency, per-scenario outcomes, cleanup results, status (including cancelled and partial) and times.
- **Execution Record (Evidence)**: The redacted request, response excerpt, timing and destination validation for one scenario execution, linked to the scenario version and the run.
- **Scenario Outcome**: One of passed, failed, inconclusive, blocked, errored, not run, with the reason.
- **Finding**: A traceable record for one scenario version, created by its first failed outcome (FR-054, FR-055), holding every later failed occurrence with its own evidence, a status and severity history, and links to scenario version, operation, specification element and execution records.
- **Security Report**: A deterministic summary of the above for one specification revision, and the export of approved scenarios in the existing executable format.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a specification of 50 operations, an engineer can go from opening Security Lab to a reviewed set of approved scenarios for the supported categories in under 20 minutes, using filters and grouped decisions.
- **SC-002**: In a test set of specifications that exercise inheritance, override, explicit-public and no-declaration cases, 100% of operations have the correct effective security requirement, and 0 observations describe an inheriting or intentionally public operation as unprotected.
- **SC-003**: 0 observations or reports across the test set state or imply a proven runtime vulnerability from specification analysis alone.
- **SC-004**: Generating scenarios twice from identical inputs gives identical scenario content and identifiers in 100% of test cases, and exporting twice gives equivalent artifacts.
- **SC-005**: 100% of scenarios missing required content, referencing a non-existent operation or field, or requesting an unsupported action are rejected, and 0 reach an executable state, including when supplied by a simulated model.
- **SC-006**: 0 requests reach a destination outside the selected profile's allowances across a test suite that includes disallowed hosts, disallowed ports, name resolution to private or loopback addresses, changed resolution between checks, and redirects to disallowed destinations, including requests made directly to the execution service rather than through the interface.
- **SC-007**: 0 runs exceed their request budget, timeout or concurrency limit, and after a cancellation no further request is sent beyond those already in flight; completed scenarios keep their evidence in 100% of cancelled runs.
- **SC-008**: 100% of failed cleanups are visible in the run result with what remains; 0 are silent.
- **SC-009**: 0 secret values (seeded test credentials, tokens, cookies, passwords) appear in any stored evidence, log, finding, report or export across a test suite that seeds secrets into requests, responses, headers and bodies.
- **SC-010**: 0 scenarios execute with an approval that belongs to a different version, and 0 rejected, stale, orphaned or incomplete scenarios execute.
- **SC-011**: 100% of findings link back to a scenario version, an operation, a specification element and an execution record, and, across any number of re-runs, 100% of scenario versions with at least one failed outcome have exactly one finding whose occurrence count equals the number of failed outcomes, while 0 findings exist for a scenario version that never failed.
- **SC-012**: Every Overview count opens a list with exactly that many entries, and counts reconcile with the underlying lists, including rejected, stale and orphaned scenarios.
- **SC-013**: In a usability review with QA engineers unfamiliar with Security Lab, at least 90% can correctly state, for a given item, whether it is a specification-based potential risk or an execution-backed finding.
- **SC-014**: Existing analysis, scenario generation, review, execution and export outputs are unchanged for the existing test corpus (0 differences).
- **SC-015**: With the AI unavailable, every non-AI capability of Security Lab works in 100% of test cases.
- **SC-016**: All new screens pass automated and manual accessibility checks for keyboard operation, names, focus visibility and non-color-only status, in both themes and at narrow widths.
- **SC-017**: After a session expires or the backend restarts, 100% of scenarios, versions, approvals, findings and run summaries remain available to the same browser, and 0 credentials, profiles, identities or raw evidence bodies remain; another browser sees none of it; and deleting retained data removes all of it.

## Assumptions

- **Scope of this specification**: The original brief also asked for a repository inspection, an implementation plan and an immediate implementation. Under the Spec Kit workflow those belong to the plan, tasks and implement phases that follow this specification; this document defines what must be true, not how. Repository findings that inform it are summarised under Dependencies.
- **Truncated brief**: The brief ended at the heading "8. Execution" with no body. Execution requirements here are derived from the objective (items 4 to 6), section 2 (Execution and Findings), section 7 (Target profiles and execution safety) and section 6. If section 8 was meant to say more (for example specific evaluation rules, retry rules or findings fields), those details should be supplied through `/speckit-clarify`.
- **Governance review**: The constitution currently allows ApiPilot to send HTTP requests to a user-selected environment through the existing execution path (specs/018, specs/026) and to run generated artifacts only under narrow exceptions. Security Lab reuses that path, sends only requests ApiPilot constructs from approved scenario versions, and runs no scripts of its own. The planning phase MUST check this against Principles IV, XI, XIII, XVI, XVII, XVIII and XXXII, and if execution of security scenarios turns out to need a capability the constitution does not yet permit, the constitution MUST be amended first (as was done for AP-056) before implementation. This specification already keeps specification analysis, rule-derived scenarios, AI suggestions, user configuration and runtime evidence as separate, labeled categories so that review is a documentation step.
- **Explicit product rule for expectations**: A "must not be processed as successful" expectation is an explicit product rule, not a fabricated status code. Where the specification documents a rejection response, evaluation uses it. Where it does not, the rule is named on the scenario and the outcome is judged against the rule, never against an invented code. Mismatch with a documented code is reported at lower severity than acceptance of the request.
- **Production**: Production-tier targets are out of scope and refused. The existing environment concept already has a production tier; it is excluded from Security Lab V1.
- **V1 breadth**: The registry includes all eleven categories from the brief, but support is incremental. Categories whose reliable execution needs facilities the repository does not have (controlled callback verification, downstream integration harnesses, rich business-policy definitions) are limited or analysis-only and are documented as such. Object-level authorization and mass-assignment verification are supported only when their prerequisites (two identities with known ownership; a reliable read of persisted state) are present; otherwise their scenarios are generated as incomplete rather than omitted or guessed.
- **Identities and tokens**: Test identities hold references to stored credentials supplied by the engineer. Obtaining tokens through interactive or multi-step authorization flows is out of scope for V1; scenarios needing them are marked as having an unsupported prerequisite. Expired-credential scenarios require the engineer to supply a known-expired credential.
- **Defaults and ceilings**: Initial request, timeout and concurrency ceilings and defaults are conservative values fixed at planning, documented, and treated as configuration rather than product contract. The default concurrency is low, and the request budget is always explicit.
- **Persistence and ownership**: Per the 2026-10-18 clarification, Security Lab splits its data into retained work and session data (FR-051). Both are stored locally, and anything that holds a credential or raw evidence is encrypted. Retained work is owned by the browser that created it, not by the idle-limited session, so ownership cannot rely on the session identifier alone; how a browser is recognised after its session expires is a planning decision that must not weaken isolation between browsers. No external storage is introduced.
- **Evidence limits**: Evidence excerpt size, header selection and redaction rules are fixed at planning and documented. Redaction always errs toward masking.
- **AI**: AI use is optional, local-first, goes only through the existing provider abstraction, and defaults to the mock provider in automated tests. A missing model degrades only the suggestion control.
- **Export format**: The existing supported executable format is the Postman collection. Scenarios needing bounded bursts, persisted-state checks or identity switching beyond what the format can express are listed as export limitations rather than approximated.
- **Specification revision**: Revision identity reuses the existing specification revision tracking used by coverage intelligence; a changed revision makes earlier scenarios stale rather than silently updating them.
- **Dependencies**: Reuses the existing specification engine and normalized model, deterministic designer and provenance, AI provider abstraction and validation, scenario review, target environments and confirmation, execution slot and run records, Postman generator, report conventions, encrypted local persistence, session isolation, and the sidebar shell and design system. The repository already contains a local-host guard for the backend's own interface; it is unrelated to outbound destination validation and is not reused for it.
- **Fixtures**: Test fixtures and a sample service with deliberately violated and honored expectations are created for tests and documentation, contain no real credentials, and need no external network access.
