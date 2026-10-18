# Implementation Plan: ApiPilot Security Lab — V1

**Branch**: `AP-057` (spec directory `specs/057-security-lab-v1`; no branch was created by planning) | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/057-security-lab-v1/spec.md`

## Summary

Add a Security Lab capability that extends, and does not fork, ApiPilot's analysis, scenario, review, execution and export
paths. It is a new backend module (`backend/src/securityLab/`), a new thin router, new shared-domain contracts, a new
frontend destination with four areas, and three small additive extensions to existing code. The plan rests on eleven decisions
(detail and rejected alternatives in [research.md](research.md)). **Revision 2 (2026-10-18)** applies the three clarifications of
that date (data lifetime, generation scope, finding identity) and constitution 3.3.0; decisions 9 to 11 are the result.

1. **Additive model extension for effective security.** The `ApiModel` loses the distinction between "explicitly public", "inherited" and
   "none declared" (`buildApiModel.ts:387`). Optional fields restore it, set only by the OpenAPI builder, with the existing
   specification revision untouched (R2, R3).
2. **A separate `SecurityScenario` type, not an extension of `TestScenario`.** The closed `ScenarioCategory`, the missing auth/repeat
   fields and the shared AI vocabulary make extension expensive. The new type reuses `GeneratedRequest`, the value
   generators and the provenance vocabulary, with content-derived stable ids (R5, F3, F4).
3. **Closed vocabularies for mutations and evaluation conditions**, validated by a draft-07 schema and domain checks, with no
   expression, URL or free-form value accepted from any source (R6, [contract](contracts/security-scenario-contract.md)).
4. **Immutable scenario versions with approval bound to a content hash**, so an edit can never inherit an earlier approval, and a
   batch carries explicit `{id, version}` items only (R7, [rules](contracts/review-and-approval-rules.md)).
5. **A guarded sender instead of Newman.** Newman follows redirects, has no budget, no address validation, and cancels only
   between items. A small `node:http(s)` sender validates the *connected* address in the socket `lookup`, revalidates every
   redirect, enforces budget, timeout and concurrency, and aborts in flight (R9, R10,
   [rules](contracts/execution-safety-rules.md)).
6. **Profiles reference existing environments for their target only.** A profile adds allow-lists, identities, limits and cleanup to an
   environment's name, tier and base URL. Credential values go in a small write-only encrypted store that no route returns, because the existing
   environment routes return variable values in plain text (R8, revised during implementation). The AP-032 environment gate is left unchanged.
7. **Deterministic evaluation, confidence and severity.** No model decides an outcome; only `failed` makes a finding; confidence
   follows a documented table (R15, [rules](contracts/evaluation-and-findings-rules.md)).
8. **Export through an overlay on the existing Postman generator**, listing scenarios it cannot express rather than dropping them (R16,
   [amendment](contracts/postman-security-amendment.md)).
9. **Two data lifetimes with two keys.** Retained work (scenarios, versions, approvals, runs, results, findings) is keyed by a
   new long-lived `apipilotOwner` cookie, read only by Security Lab routes, and survives session expiry, backend restart
   and browser restart until the engineer deletes it. Session data (profiles, identities, test data, redacted evidence) keeps the
   session id and the existing `onExpire` cleanup. The session id cannot be the owner key: its cookie is a browser-session cookie
   (R13, R22, F17). Retained work stays readable with no specification loaded (R3, F18).
10. **One finding per scenario version, with occurrences.** A repeat failure adds an occurrence, reopens a resolved finding, and flags an
    accepted or false-positive one; a material edit starts a new, linked finding (R24).
11. **Scope-aware generation.** Analysis and the Overview cover every operation; generation defaults to the guided workflow's selection and
    can be widened or narrowed, with the scope always returned and shown (R23).

AI is optional and last: a separate prompt and validator through `AIProvider`, producing `draft` scenarios (R17).

## Technical Context

**Language/Version**: TypeScript on Node.js 24 LTS (npm workspaces monorepo).

**Primary Dependencies**: Existing Express, better-sqlite3 (via the existing persistence layer), Ajv ^8.20 (already a backend dependency), Newman and the Postman SDK (exporter only), React, Vite, Tailwind v4, Vitest, Supertest, React Testing Library. **No new package** (R20). Node built-ins `net.BlockList`, `http`, `https`, `dns`, `crypto` supply the sender and policy.

**Storage**: Local SQLite through the existing persistence layer. Nine new tables appended to `initializeSchema()` (R13): six owner-scoped (retained work) and three session-scoped (profiles, evidence, write-only credentials). Credentials stay in the existing encrypted environment store; evidence is redacted, then stored encrypted in the session-scoped table. One new long-lived cookie, `apipilotOwner`, set only by Security Lab routes (R22).

**Testing**: Vitest unit tests per module (pure functions), Supertest integration tests per route group against a loopback sample target, a seeded-secret corpus test, determinism and byte-equality regression tests, React Testing Library for the UI. AI tests use a stub provider ([quickstart](quickstart.md)).

**Target Platform**: Local backend process and browser frontend, as today. Windows is the primary developer platform (loopback name resolution test required, R-assumption 1).

**Project Type**: Web application (Express backend, React frontend, shared-domain package). All three are touched.

**Performance Goals**: Analysis and generation for a 50-operation specification complete in under 2 s (pure, linear). Listing and filtering 2,000 scenarios in under 300 ms (indexed queries, paginated). A run's overhead per request, excluding network time, is under 5 ms.

**Constraints**: Deterministic generation and evaluation; destinations validated on the connected address for every request and redirect; hard ceilings (R11) that no profile can exceed; no secret in any stored or exported artifact; one execution per session; no new dependency; additive model changes only; existing outputs byte-identical (FR-067).

**Scale/Scope**: About 65 new backend source files under `backend/src/securityLab/`, 5 new repositories, 1 router, 1 sender, 1 owner middleware; additive edits to about 10 existing backend files; about 25 new frontend files; one shared-domain file plus 3 additive edits; about 14 test files per layer. Delivered in five ordered slices (below).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design and again after revision 2 (the 2026-10-18 clarifications and constitution 3.3.0): no violation; one new item, the owner cookie, is justified in Complexity Tracking.*

| Principle | Assessment |
|---|---|
| I. Specification Is the Source of Truth | Pass. Expected behavior is documented-or-named-product-rule (FR-022); no status code is invented; for HAR and definition input the analysis is `not-measurable` and keeps origin labels (FR-011). |
| II. Deterministic Before AI | Pass. Analysis, generation, evaluation, confidence, severity, remediation text, reports and export are AI-free. |
| III. AI Is an Assistant | Pass. Suggestions are `origin: ai`, `draft`, with model, confidence and assumptions recorded; AI never decides an outcome. |
| IV. AI Output Validated | Pass. Own response version, parser, structural and domain validation; rejects URLs, hosts, header overrides and unsupported actions (R17). |
| V. Local-First AI / VI. Provider Independence | Pass. Only `getAIProvider()`; no provider code touched; nothing leaves the machine. |
| VIII. Framework-Independent Test Model | Pass. Scenario content is framework-neutral; Postman is the exporter's output only. |
| IX. Separation of Concerns | Pass. Analysis, generation, review, execution, evaluation, findings, reports, export are separate modules; the router is thin. |
| X. Domain Model First | Pass. All new concepts are defined in `packages/shared-domain` ([data-model](data-model.md)). |
| XI. Human-in-the-Loop | Pass. Nothing runs unapproved; approval is version-bound; destructive scenarios need extra confirmation twice; runs need an explicit confirmed trigger. |
| XII. Quality Over Quantity | Pass. Dedupe key includes the mutation; per-operation caps; uninformative scenarios are not generated (FR-024). |
| XIII. Provenance and Traceability | Pass. Scenario → operation → specification element → result → finding links; HAR-derived `evidenceOrigin` carried. The provenance source for security scenarios is `rule`, `ai` or `user`. |
| XIV. No Silent Assumptions | Pass. Missing prerequisites are named and block execution; name-only sensitivity is labelled; observed models are not-measurable. |
| XV. Dependency Inference Conservative | Not applicable; no dependency inference is added. |
| XVI. Executable Artifacts Deterministic | Pass. Export comes only from approved versions through fixed templates; same input gives equivalent output. |
| XVII. Security and Privacy by Design | Pass against constitution 3.3.0 (see Governance below). No script is executed; ApiPilot builds every request, validates every destination, and every 3.3.0 condition has a contract rule and a test. Retained work holds no credential, raw body or profile (FR-051, R13). |
| XVIII. Secrets Never in Artifacts | Pass. Identities hold scheme names only; credential values live in a write-only encrypted store no route returns; exports use empty secret variables; seeded-secret test over every output. |
| XIX. Fail Safely | Pass. Blocked, errored, inconclusive and not-run are distinct from passed; no scenario is fabricated when a prerequisite cannot be named. |
| XX. Observability Without Sensitive Logging | Pass. Logs carry ids, stages, codes, durations; a test captures log output over the seeded corpus. |
| XXI. Testability at Every Boundary | Pass. Sender and resolver are injected; sample target is loopback; no public network in tests. |
| XXII, XXIII. AI Evaluation and Versioned Contracts | Pass with a note. Suggestion prompt and schema are versioned (`SECURITY_SUGGESTION_RESPONSE_VERSION`); an AI evaluation corpus is **not** part of V1 and the roadmap entry states it, as AP-031 did. |
| XXIV. Reproducibility | Pass. Pure generation and evaluation; injected clock. |
| XXV. Incremental Delivery | Pass. Five ordered, independently testable slices. |
| XXVII. Prefer Simple Architecture | Pass with a justified deviation. No queue, worker, service or dependency is added; the only new infrastructure is a bounded in-process worker pool and a small sender (Complexity Tracking). |
| XXVIII. Technology Replaceable | Pass. Ajv sits behind the validator; the sender is an injected interface. |
| XXXII. Review Practical at Scale | Pass. Explicit-item batch with visible list and counts, excluded destructive and incomplete items shown, grouped by filter. |
| XXXIII. Presentation Consistent | Pass. Existing shell, tokens, patterns, themes; text labels for every status. |

### Governance: constitution 3.3.0 applied, pending review (research R1)

Security Lab sends HTTP requests that ApiPilot itself constructs from approved, typed scenario versions, to destinations it
validates. It runs no script, so the exceptions that earlier amendments added are not engaged and must not be cited. Because
Principle XVII said nothing about outbound destination control or adversarial probing, the user ran `/speckit-constitution` on
2026-10-18, which drafted version 3.3.0: the XVII paragraph "Outbound security testing (2026-10-18 amendment, AP-057)". This plan is
written against 3.3.0. The amendment still goes through the review the Governance section requires; if it is rejected, revert it and
the policy stays an engineering contract, with no design change.

Each 3.3.0 condition maps to a contract rule and a test obligation, so the text and the code cannot drift apart unnoticed:

| 3.3.0 condition | Contract rule | Test |
|---|---|---|
| Requests come from approved scenario versions, typed mutations, no content-chosen destination | [security-scenario-contract.md](contracts/security-scenario-contract.md), [review-and-approval-rules.md](contracts/review-and-approval-rules.md) | `scenarioValidation`, `approvalBinding` |
| Per-run explicit confirmation naming target, counts, destructive scenarios; staging-like exact confirmation; never automatic | [security-lab-api.md](contracts/security-lab-api.md) (preview, digest, start) | `runConfirmation`, `planDigest` |
| Server-side destination validation on the connected address and every redirect hop; local-tier-only private ranges; metadata never; no auto-redirect; production refused | [execution-safety-rules.md](contracts/execution-safety-rules.md) §2, §3 | `destinationPolicy`, `rebinding`, `redirects`, `directServiceBypass` |
| Budget, timeout, concurrency under hard ceilings; cancel aborts in flight; no automatic retry | execution-safety-rules §4, §5 | `budgetConcurrency`, `cancel` |
| Credentials only as references; redaction before storage; evidence bounded and encrypted | execution-safety-rules §6, research R14 | `seededSecretCorpus` |
| Destructive scenarios confirmed at approval and at run; cleanup attempted, failure shown | review rules, execution-safety-rules §5 | `destructiveConfirmation`, `cleanupFailure` |
| Deterministic evaluation, unjudgeable outcome never passed | [evaluation-and-findings-rules.md](contracts/evaluation-and-findings-rules.md) | `evaluation` |

Because the same-day amendment and AP-056's 3.2.0 changed the same file, the mirror `specs/constitution.md` (still 3.2.0, last
resynced by AP-056 T001) is resynced as task T001 here.

Project rules (`.claude/CLAUDE.md`): §4 (shared-domain contracts), §6 and §9 (specification-driven, no external `$ref` fetch, OpenAPI
pipeline independent of Express), §10 to §14 (deterministic designer, grounded assertions, dedup provenance), §15 to §20 (AI only
through the provider, local-first, no cloud fallback), §22 to §24 (thin routes, contracts, safe errors), §26 to §43 (Tailwind v4,
tokens, accessibility, states, no inline styles), §44 to §47 (types, immutability, upload safety), §48 (new environment
variables get `.env.example` entries), §54 (validation). Section 63 applies to the one judgement call recorded in R19.

## Project Structure

### Documentation (this feature)

```text
specs/057-security-lab-v1/
├── plan.md                                   # This file
├── research.md                               # Phase 0: findings F1-F16 and decisions R1-R21
├── data-model.md                             # Phase 1: shared-domain additions, entities, invariants
├── quickstart.md                             # Phase 1: automated gate and manual walkthrough
├── contracts/
│   ├── security-lab-api.md                   # public: HTTP routes, errors, confirmation flow
│   ├── security-scenario-contract.md         # behavioural: validation pipeline, ids, hashes
│   ├── security-scenario.v1.schema.json      # machine-readable draft-07 schema for scenario content
│   ├── generation-and-analysis-rules.md      # behavioural: effective security, observation rules, category generation
│   ├── review-and-approval-rules.md          # behavioural: states, transitions, version binding, batch
│   ├── execution-safety-rules.md             # behavioural and binding: destination policy, limits, cancel, cleanup
│   ├── evaluation-and-findings-rules.md      # behavioural: conditions, outcomes, confidence, findings
│   └── postman-security-amendment.md         # public: export overlay and limitations
├── checklists/
│   └── requirements.md                       # spec quality checklist (exists)
└── tasks.md                                  # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
├── securityLab.ts                 # NEW: registry, observation, scenario, version, mutation, condition, profile, run, evidence,
│                                  #      result, finding, overview, report types and their closed unions
├── apiModel.ts                    # MODIFY (additive, optional): rootSecurity, rootSecurityDeclared, securitySource, deprecated,
│                                  #      readOnly/writeOnly, bearerFormat, openIdConnectUrl
├── postmanArtifact.ts             # MODIFY (additive): three GenerationLimitationKind values
└── index.ts                       # MODIFY: export the new module

backend/src/
├── securityLab/
│   ├── registry/                  # categories.ts, taxonomy.ts (owasp-api-top10-2023)
│   ├── analysis/                  # analyzeSecurity.ts, effectiveSecurity.ts, sensitivity.ts, rules/*.ts
│   ├── scenarios/                 # generateSecurityScenarios.ts, rules/*.ts, scenarioId.ts, contentHash.ts, dedupe.ts,
│   │                              #   prerequisites.ts, validateScenario.ts (Ajv + domain + safety + grounding), caps.ts
│   ├── review/                    # stateMachine.ts, reviewService.ts, batch.ts
│   ├── profiles/                  # profileValidation.ts, profileService.ts, tierPolicy.ts
│   ├── execution/                 # destinationPolicy.ts, guardedSender.ts, buildSecurityRequest.ts, runPlanner.ts,
│   │                              #   runSecurityRun.ts, cleanup.ts, limits.ts, planDigest.ts
│   ├── evidence/                  # redactEvidence.ts, excerpt.ts
│   ├── evaluation/                # evaluateConditions.ts, scenarioOutcome.ts, confidence.ts, severityTable.ts, remediationText.ts
│   ├── findings/                  # findingService.ts
│   ├── reports/                   # overview.ts, summarizeReport.ts, renderSecurityReportHtml.ts
│   ├── ai/                        # suggestionPrompt.ts, parseSuggestionResponse.ts, validateSuggestion.ts, suggestScenarios.ts
│   ├── owner/                     # ownerMiddleware.ts (apipilotOwner cookie, Security Lab router only), ownerContext.ts (getOwnerId)
│   ├── retention/                 # retainedDataService.ts (counts, per-assessment and full hard delete, caps), assessmentKey.ts
│   ├── errors.ts                  # typed errors mapped by the router
│   ├── config.ts                  # loadSecurityLabLimits(env), validateSecurityLabConfiguration()
│   └── securityLabService.ts      # façade used by the router (also the direct-bypass test entry point)
├── api/securityLab.ts             # NEW: thin router createSecurityLabRouter(deps)
├── persistence/
│   ├── securityScenarioRepository.ts   # NEW, owner-scoped (scenarios + versions)
│   ├── securityRunRepository.ts        # NEW, owner-scoped (runs + results + settings; in-progress lookup by session id)
│   ├── securityFindingRepository.ts    # NEW, owner-scoped (findings + occurrences)
│   ├── securityProfileRepository.ts    # NEW, session-scoped (deleteBySession via onExpire)
│   ├── securityCredentialRepository.ts # NEW, session-scoped, write-only encrypted credential values (deleteBySession via onExpire)
│   ├── securityEvidenceRepository.ts   # NEW, session-scoped (encrypted redacted evidence; deleteBySession via onExpire)
│   └── connection.ts                   # MODIFY: append schema blocks
├── openapi/buildApiModel.ts       # MODIFY (additive): set the new optional model fields
├── execution/executionSlot.ts     # MODIFY: add the Security Lab in-progress branch
│                                  # (api/testGenerationWorkflow.ts and requireEnvironmentAccess() are deliberately NOT changed: research R8, revised)
├── postman/
│   ├── generateSecurityCollection.ts   # NEW
│   └── securityOverlay.ts              # NEW (pure mutation application and assertion templates)
├── app.ts, server.ts              # MODIFY: register router; validateSecurityLabConfiguration() at startup
└── ...                            # no change to testDesign, ai, apiCoverage, performance

backend/tests/
├── unit/securityLab/              # per module, see quickstart
├── integration/securityLab/       # per route group; directServiceBypass; seededSecretCorpus
└── fixtures/securityLab/          # sample-api.yaml, vulnerableTarget.ts (extends TargetServer), secureTarget.ts, secret corpus
backend/scripts/securityStubTarget.ts   # NEW: `npm run security:stub -w backend`, loopback sample target on 127.0.0.1:4700

frontend/src/
├── pages/SecurityLabPage.tsx
├── components/securityLab/        # OverviewArea, ScenariosArea, ScenarioList, ScenarioFilters, ScenarioDetail, ScenarioEditor,
│                                  #   PrerequisitePanel, BatchReviewBar, ProfileEditor, IdentityEditor, RunPlanDialog, RunProgress,
│                                  #   FindingsList, FindingDetail (occurrences, evidence-unavailable state), EvidenceView, ReportsArea,
│                                  #   ObservationList, CategoryTable, ScopeBanner (active generation scope), RetainedDataPanel
│                                  #   (what is kept, what goes with the session, per-assessment and full delete with typed
│                                  #   confirmation; lives inside Reports so the four areas stay four), SpecNotLoadedNotice
├── components/securityLab/securityViewModel.ts   # typed visual variants (severity, outcome, state) per CLAUDE.md §43
├── hooks/useSecurityRun.ts        # polling hook (no LiveRunKind change)
├── services/securityLabClient.ts  # discriminated-result client, typed fields only in logs
├── navigation/{routes,destinations}.ts            # MODIFY: security destination, optional area segment
├── components/{workflowCatalog,paletteCommands}.ts, shell/Sidebar.tsx, App.tsx   # MODIFY (R18)
└── tests/unit/securityLab/, navigation, shell, palette, help (updated)

docs/ and root                      # README routes line, USER_MANUAL (Security Lab section + sidebar paragraph), architecture.md
                                    # (Security Lab section), http-api.md, configuration.md, status.md, .env.example,
                                    # specs/ROADMAP.md entry 103, version bump 19.60.0 (root, backend, frontend, shared-domain, lockfile)
```

**Structure Decision**: Option 2 (web application), the existing layout. Security Lab is a self-contained backend module with one router,
mirroring `apiCoverage/` (pure core plus injected sources) and `userScripts.ts` (standalone feature sharing the execution
slot). The directory is `securityLab/`, deliberately not `security/`, which already holds the backend's inbound
`localHostGuard.ts` and is unrelated to outbound policy.

## Implementation Phases (ordered slices; each ends testable)

Slices follow the spec's priorities and Principle XXV. Each slice adds its tests and keeps `npm test`, `npm run lint` and
`npm run build` green.

**Slice 0 (task T001 and spikes, before slice 1).** Resync `specs/constitution.md` to 3.3.0. Spike on Windows with the supported
browsers: the `apipilotOwner` cookie survives backend restart and browser restart, and `localhost` resolves as expected for the
sender (assumptions 1 and 7).

**Slice 1: Foundations and analysis (Story 1; part of FR-001 to FR-016).**
Owner middleware and context; the owner-scoped and session-scoped table blocks; shared-domain types and additive model fields; `buildApiModel` sets them; update affected golden tests deliberately and add the
`existingOutputsUnchanged` test; registry and taxonomy; effective-security resolution; observation rules; settings;
`GET /categories`, `/analysis`, `/settings`, `/scope`; destination, navigation and an Overview showing analysis over every
operation; the empty, loading, error and specification-not-loaded states. *Gate*: SC-002, SC-003, determinism, YAML/JSON twin equal,
`ownerIsolation`.

**Slice 2: Scenarios and review (Story 2).**
Scenario schema, validator (including the no-credential-in-content rule), ids, hashes, dedupe; generation rules per category with
the scope default and widen/narrow; retained persistence for scenarios and versions, assessment keys, caps; state machine,
versioned edits, batch review; routes; Scenarios area with scope banner, filters, detail, editor, bulk bar, prerequisite panel.
*Gate*: SC-004, SC-005, SC-010, `generationScope`, XXXII scale test with 2,000 generated scenarios.

**Slice 3: Profiles, guarded execution, evaluation, findings (Stories 3, 4, 6).**
Profile model and validation; destination policy; guarded sender; run planner, preview and digest; worker pool, budget, cancel,
cleanup; slot integration; evidence redaction and session-scoped evidence storage; evaluation; findings with occurrences, reopening
and `supersedes`; observed summaries retained after the session; routes; Execution and Findings area; the loopback sample
targets and `security:stub`. *Gate*: SC-006 to SC-009, SC-011 (`findingOccurrences`), the Windows loopback test,
direct-service-bypass test, forced-session-expiry test (`retention`). Constitution 3.3.0 should be reviewed before this slice merges;
if it is rejected the destination policy remains the contract and nothing else changes.

**Slice 4: Overview completion, reports and export (Stories 5, 7).**
Overview counts and filters (findings counted, occurrences shown beside); report builder and HTML renderer working without a
loaded specification; Postman overlay and limitations; retained-data management (`GET /data`, per-assessment and full delete with
typed confirmation); routes; Reports area with the Retained data panel. *Gate*: SC-012, SC-017, SC-004 for export, byte-equality of
existing exports, `noSpecificationRead`.

**Slice 5: AI suggestions, documentation, version (Story 8, FR-068).**
Suggestion contract, parser, validator, route and control; documentation set; roadmap entry 103; version bump to 19.60.0;
final full validation. *Gate*: SC-015, SC-016, definition of done below.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Additive model fields alter existing golden or snapshot tests | Update deliberately in slice 1; `existingOutputsUnchanged` proves generation, review, export and coverage revision are byte-identical (R2). |
| `lookup`-based address validation differs on Windows (`localhost` → `::1` and `127.0.0.1`) | First slice-3 task is a Windows test of both; the policy checks every resolved address and the profile names ranges explicitly. |
| Operators read "potential risk" as a vulnerability | Separate, labelled groups; fixed wording lint; report limits statement (FR-008, FR-060, FR-061). |
| A run exceeds the budget under concurrency | Counter decremented before send; concurrency test (budget 10, concurrency 4). |
| Redaction misses a secret in an unusual shape | Literal-value masking of every resolved credential plus shape-based rules; seeded-secret corpus across every output (R14). |
| Scenario volume overwhelms review | Per-operation caps, dedupe, explicit-item batch, 2,000-scenario scale test (XXXII). |
| Constitution 3.3.0 is rejected in review | Revert it; the destination policy stays the contract; every 3.3.0 condition already has a contract rule and test, so no design change. |
| The owner cookie is lost (cookies cleared, other browser or profile) and retained data becomes unreachable | Stated in the banner and manual; where the database lives and how to remove it is documented; per-owner caps bound the unreachable remainder (R22, R13). |
| Retained rows become a second secret store | Validator rejects credential-shaped content; evidence bodies are session-scoped; retained summaries hold status, redacted header names and a sentence only; seeded-secret test covers retained rows. |
| Unbounded growth from "keep until deleted" | Per-owner caps with `retention_limit_reached` and a visible delete path (R13). |
| The assessment key (title plus filename) groups unrelated work or splits related work | Shown in the UI as a label the engineer can read before deleting; a typed confirmation of the label is required; flagged for reviewer confirmation (R22). |
| A repeat failure is missed because the finding is `accepted-risk` | `unreviewedOccurrence` flag, a filter for it, and a count on the Overview (R24). |
| OWASP mapping of input validation is a judgement | Labelled `related`, shown as ApiPilot's judgement, edition is data (R19). |
| Postman cannot express a scenario | Listed as a limitation with the scenario id; never silently dropped (FR-063). |

## Definition of Done (feature)

All of CLAUDE.md §66 plus: every contract's test obligations pass; the quickstart's automated gate is green and its manual
walkthrough is run (or the unrun parts are stated plainly in the roadmap entry); no secret appears in stored evidence, logs,
findings, reports or exports; documentation and `.env.example` updated; version bumped in all five locations; roadmap entry
added; the diff contains no unrelated change. Per the user's standing preference, the work is left uncommitted for review.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| A new in-process HTTP sender instead of reusing Newman or `createFetchSender` | FR-036 to FR-044 require connect-time address validation, redirect revalidation, a hard budget, concurrency, and in-flight abort. | Newman follows redirects, has no address control or budget and cancels only between items. `createFetchSender` checks origin strings only, so a rebinding hostname passes. |
| A bounded in-process worker pool | The profile exposes a concurrency setting (FR-034, FR-044) and the budget must hold under it. | Sequential-only execution would make the setting meaningless; a queue library would add a dependency (XXVII). |
| A separate `SecurityScenario` type | `TestScenario` cannot express auth mutation, repetition or response conditions, and widening its closed unions touches AI, coverage and export consumers. | Extending `TestScenario` has a wide blast radius for no reuse gain; builders and provenance vocabulary are reused instead. |
| Nine new tables (six owner-scoped, three session-scoped) | Scenarios, immutable versions, runs, results, findings and settings must outlive the session; profiles and evidence must not (FR-051). Each has different lifecycles and per-version queries. | One JSON document per session cannot support per-version approval, history, two lifetimes or concurrent updates. |
| A second cookie, `apipilotOwner`, set only by Security Lab routes | The clarified retention needs an owner key that survives idle expiry, backend restart and browser restart, and the session cookie is a browser-session cookie (F17). | Keying retained work by session id loses it when the browser closes. Making the session cookie persistent changes every feature and the eviction model. An account system is out of scope (XXVII). |
| Optional additive fields on `ApiModel` | Effective-security distinctions cannot be recovered after the model is built (the raw document is not retained). | Re-parsing or a sentinel in `security` would break existing consumers or duplicate the parser. |
