# Research: ApiPilot Security Lab — V1

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-18

Every decision below records what was chosen, why, and what was rejected. "Evidence" cites the repository file or
external source that the decision rests on. Facts verified in the repository are separated from assumptions, and
assumptions are listed again in the final section. No `NEEDS CLARIFICATION` item remains open in Technical Context.

## Repository findings that shape the design

| # | Finding (verified in the repository on 2026-10-18) | Consequence |
|---|---|---|
| F1 | Effective operation security is resolved at build time as `operation.security ?? document.security` (`backend/src/openapi/buildApiModel.ts:387`). The root `security` is not stored. "Explicit `security: []`", "inherited from root" and "none declared anywhere" all become `security: []`. | FR-006/FR-007 cannot be met from the current `ApiModel`. An additive model extension is required (R2). |
| F2 | `ApiModel` omits `deprecated`, `x-` extensions, response headers, `servers`, scheme details beyond type/scheme/in/name, and per-property `readOnly`, `writeOnly`. | Inventory (deprecation), mass-assignment and sensitive-field analysis need those facts (R2). |
| F3 | Rule scenarios get `randomUUID()` ids (`backend/src/testDesign/scenario.ts:23`). Only AI scenarios have content-derived ids. | FR-018/FR-019 need deterministic ids; `buildScenario` cannot be reused unchanged (R5). |
| F4 | `TestScenario.category` is a closed union that the AI prompt and validator also use. `GeneratedRequest` has no auth field, no repeat count. `Assertion` has only `status-code` and `schema-conformance`. | A security scenario does not fit `TestScenario`. A separate type that reuses `GeneratedRequest` is needed (R5). |
| F5 | The review domain has three states (`pending`, `accepted`, `rejected`), a per-scenario integer `revision`, and a stale-revision check. It keeps no prior content, has no material/non-material distinction, and pins no approved version. | Reuse the idea (revision check, history), not the type (R7). |
| F6 | Execution uses Newman, one item per `newman.run()` (`backend/src/execution/newmanRunner.ts:102`). It follows redirects by default, has a fixed 30 s timeout, no request budget, no response-size cap, no host/port/IP validation, strictly sequential items, and cancellation only between items. No SSRF or private-range code exists anywhere (grep for `ssrf`, `rfc1918`, `isPrivate`, `dns.lookup`, `net.isIP`). | Newman cannot satisfy FR-036 to FR-044. A new guarded sender is required (R9, R10). |
| F7 | `createFetchSender` (`backend/src/performance/chain/debug/sender.ts`) is the only in-process outbound client. It has manual redirects, a read cap and a per-hop origin check, but no IP validation, so a hostname that re-resolves to a private address passes. | Borrow its patterns; do not reuse it for the policy (R10). |
| F8 | `findExecutionInProgress()` (`backend/src/execution/executionSlot.ts:15`) ORs five run kinds and says a new kind must add itself. | A Security Lab run joins the slot (R12). |
| F9 | `Environment` holds `name, tier, baseUrl, variableValues, requestDelayMs`; values are AES-256-GCM encrypted at rest (`persistence/credentialCipher.ts`). Tiers: `local, dev, qa, staging, production`. Environment routes are gated by `requireEnvironmentAccess()` (`api/testGenerationWorkflow.ts:174`). | Profiles reference an environment and its encrypted variables rather than storing secrets again (R8). |
| F10 | Persistence has no migration framework: `initializeSchema()` appends `CREATE TABLE IF NOT EXISTS` blocks and `ensureColumn()`. Repositories are session-scoped singletons with `deleteBySession`, registered with `onExpire`. | New tables follow that convention (R13). |
| F11 | Redaction helpers exist: `failureAnalysis/redaction.ts` (`redactHeaders`, `redactUrl`, `redactBody`, `redactFreeText`, `scanOutput`, `collectRedactedValues`), `apiInput/redaction.ts`, `testDesign/sensitiveValueDetection.ts`, `performance/chain/debug/masker.ts`. `logger.ts` applies no redaction and its convention is ids only. | Compose these into one evidence redactor; add a seeded-secret corpus test (R14). |
| F12 | `specificationRevision(apiModel)` (`apiCoverage/specRevision.ts`) hashes operations (including effective security) and schemes; it ignores tags, descriptions, examples, provenance and `deprecated`. | Reuse it for the spec revision, and add a security basis hash for the extra facts (R3). |
| F13 | The Postman generator derives auth per operation from the first requirement and first scheme. It cannot omit or swap auth per scenario, repeat a request, or assert response headers. Limitations are a closed `GenerationLimitationKind` union (14 kinds). | A security overlay on the exporter is needed (R16). |
| F14 | Workflow state is a per-session in-memory map; a new upload replaces the workflow (`workflowStore.ts`). `apiModel` is always the full specification. | Security Lab keeps its own persisted per-session store and revision-gates it (R13). |
| F15 | Routes are hash-only (`#/coverage`). Only `guided` has a sub-segment. `Tabs` is local state; no page addresses inner tabs. Destination edits touch `routes.ts`, `destinations.ts`, `workflowCatalog.ts`, `Sidebar.tsx`, `App.tsx`, `paletteCommands.ts`. | Plan the exact edit list and a small route-grammar extension (R18). |
| F16 | `ajv` ^8.20 is already a backend dependency. No other new dependency is needed. | No new package (R20). |
| F17 | The session id is a **browser-session cookie** (`httpOnly`, `sameSite=lax`, no `Max-Age`; `sessionMiddleware.ts`). After idle eviction the same id stays in the browser and is only tombstoned; `onExpire` listeners delete per-session data. After a backend restart the same id is tombstoned as `backend-restart`. Closing the browser discards the cookie, so the id is never seen again. | A retained-work owner key cannot be the session id: it would be lost with the browser. A separate long-lived owner cookie is needed (R22). Per-session data keeps using the session id and `onExpire`. |
| F18 | The guided workflow, and with it `ApiModel`, is in memory and cleared on session expiry or restart (`workflowStore.ts`). | After expiry there is no model: retained work must be readable without one, and staleness cannot be derived (R22, R23). |

## R1. Governance: no amendment is proposed, and the reasoning is open to review

**Decision (updated 2026-10-18).** No *exception* is needed, because Security Lab runs no script. The first version of
this plan left open whether to record the destination policy in the constitution; the user then ran
`/speckit-constitution`, which drafted version 3.3.0 (MINOR). It adds guidance to Principle XVII, "Outbound security
testing (2026-10-18 amendment, AP-057)", whose conditions match
[execution-safety-rules.md](contracts/execution-safety-rules.md). The amendment is applied to
`.specify/memory/constitution.md` and still goes through the review that the Governance section requires. The plan is
written against 3.3.0. Its mirror copy `specs/constitution.md` is still at 3.2.0 and is resynced as task T001, as AP-056 did.

**Rationale.** The amendments in versions 2.2.0 to 3.1.0 exist because ApiPilot ran content it did not author: a
collection's scripts, a generated k6 script, a user's k6 script. Security Lab runs none. ApiPilot constructs every request
itself from a typed, approved scenario version, and sends it in-process to a destination it validated. That is the same
class of act as AP-017's execution of a generated collection against a user-selected environment, which already exists
without an exception, and it is strictly more constrained (R9, R10). The seven information categories in the preamble
already cover the feature's data: observations from specification analysis are derived from the specification (1 and 2),
AI suggestions are AI inference (3), profiles and test data are user configuration (4), outcomes and evidence are
runtime observations (5), and observations or inferences from HAR input keep their labels (6 and 7, FR-011). Principle
XVII's "avoid executing … generated scripts on the server" is not engaged because no script exists.

**Residual risk.** Probing a target with adversarial input is a more sensitive act than replaying a documented happy path,
and Principle XVII previously said nothing about outbound destination control. Version 3.3.0 now binds the rules the plan
already relied on (approved-version requests only, per-run confirmation, server-side destination validation on the connected
address and every redirect hop, ceilings, redacted and encrypted evidence, individually confirmed destructive scenarios,
deterministic evaluation). If review rejects the amendment, revert it and the destination policy remains an engineering
contract only; no design change follows. Every condition in 3.3.0 is covered by a named test obligation in the contracts, so
the amendment cannot drift from the implementation unnoticed.

**Alternatives rejected.** Amending proactively (adds governance text with no conflict to resolve; against "do not bypass
the amendment procedure" only when a conflict exists). Reusing the 2026-09-24 k6 exception by analogy (its text forbids
citing it for other content).

## R2. Additive `ApiModel` extension for security facts

**Decision.** Add optional fields, set by the OpenAPI builder, and absent or conservative for other inputs:

- `ApiModel.rootSecurity?: SecurityRequirement[]` and `ApiModel.rootSecurityDeclared?: boolean` (whether the document declared a root `security` at all).
- `ApiOperation.securitySource?: "operation" | "root" | "explicit-public" | "none-declared"`.
- `ApiOperation.deprecated?: boolean`.
- `SchemaConstraint.readOnly?: boolean` and `writeOnly?: boolean` (the existing `format` already carries `password`).
- `SecuritySchemeDefinition.bearerFormat?: string` and `openIdConnectUrl?: string`.

`securitySource` rule: operation declares `security` → `operation` (an empty array → `explicit-public`); else root declared and non-empty → `root`; else `none-declared`. A root `security: []` with no operation override is `none-declared` for analysis purposes with the note that the root explicitly declared none.

**Rationale.** The raw document is not kept after the model is built (F14), so the facts cannot be recovered later. All fields are
optional and additive, following AP-056's pattern (R2 there). HAR and definition input leave `securitySource` unset, and
the analysis treats unset as "not measurable" for observed models.

**Regression control.** Because the field set changes the OpenAPI `ApiModel`, the plan lists the affected golden and snapshot
tests, updates them deliberately, and adds a test asserting that deterministic generation, review, Postman export and the
coverage specification revision are byte-identical for the existing corpus (FR-067, SC-014). `specificationRevision` is not
changed.

**Alternatives rejected.** Re-parsing the stored upload (raw upload is not retained). A side model computed only in Security Lab
from a second parse (duplicates the parser, violates FR-002). Overloading `security: []` with a sentinel (breaks every
existing consumer).

## R3. Revision identity and staleness

**Decision.** Each scenario version stores `specificationRevision = specificationRevision(apiModel)` (reused) and
`securityBasisHash = fragmentHash` over the security-only facts of R2 for the operations it uses. A scenario is stale when
either differs from the current model's value for its operation. Staleness and orphaning are derived at read time and never
stored.

**Rationale.** The coverage revision ignores `deprecated`, descriptions, and the new property flags, so a change that
makes a mass-assignment scenario wrong would not stale it. Hashing per operation, not globally, keeps unrelated edits from
invalidating every approval. (Practical at scale, XXXII.)

When no model is loaded (session expired, backend restarted, nothing uploaded; F18) staleness cannot be derived. The derived
flag is then `specification_not_loaded` instead of `stale` or `orphaned`, such scenarios are not executable, and their
history, findings and reports stay readable (FR-004 as amended). Loading a specification re-derives the flags.

**Alternatives rejected.** Extending `specificationRevision` (would change the coverage revision and break stored coverage
snapshots). One global hash (needless invalidation).

## R4. Security analysis as a pure, rule-module layer

**Decision.** `analyzeSecurity(apiModel, options) → SecurityAnalysis`, a pure function over a registry of observation
rules, each `(context) → SecurityObservation[]`, mirroring the testDesign rule style. Observation ids are
`so-` + `fragmentHash(ruleId, operationKey, elementPointer)`. Output order is sorted by operation key, rule id, pointer.

Rules in V1 (each cites a specification element pointer and a plain-language rationale):

1. `auth-scheme-declared` and `auth-scheme-unused` / `operation-uses-undeclared-scheme`.
2. `effective-security-public` (explicit public, informational; requires-context when the operation looks sensitive).
3. `effective-security-none-declared` (requires-context; not-measurable when no schemes exist anywhere).
4. `security-override` (informational; names root and override).
5. `sensitive-operation` (basis: method, path tokens, identifier parameter; potential-risk only when combined with a missing effective requirement, never alone).
6. `sensitive-property` (basis recorded: `format-password`, `write-only`, `user-configured`, `name-match`; name-match alone yields requires-context at most).
7. `documented-error-responses` (protected operation with no documented 401/403: informational).
8. `inventory-duplicate-operation`, `inventory-deprecated`, `inventory-version-marker` (analysis-only, spec-internal).
9. `observed-model-limits` (not-measurable, for HAR/definition models).

**Rationale.** FR-005 to FR-011. Reuses `AnalysisIssue` for nothing: its `kind` union is closed and it is an issue list, not an
observation type (F4). A separate `SecurityObservation` type keeps both honest.

**Alternatives rejected.** Reusing `AnalysisIssue` (closed union; wrong semantics). An AI classifier for sensitivity
(violates FR-005 and Principle II).

## R5. A separate `SecurityScenario`, built from existing request builders

**Decision.** Define `SecurityScenario` in `packages/shared-domain/src/securityLab.ts`. It embeds the existing
`GeneratedRequest` as its base request and a list of typed `SecurityMutation`s. It does not extend `TestScenario` or
`ScenarioCategory`. Base requests come from `buildMinimalConformantRequest` and `buildConformantRequest`; field
violations reuse the testDesign value generators. Security generation lives in its own rule array and entry point
`generateSecurityScenarios(apiModel, analysis, profileContext)`, because it needs schemes and effective security, which a
`Rule = (operation) → TestScenario[]` cannot see.

Scenario id: `ss-` + `fragmentHash(operationKey, categoryId, mutationKind, target, canonical mutation parameters)`,
stable across specification revisions; the revision is a version attribute (R7). The dedupe key includes the mutation
list and expected-behavior kind, unlike `dedupeKey`, which ignores category and rule and would collapse distinct probes.

**Rationale.** F3 and F4. A "compatible extension" of `TestScenario` would widen `SCENARIO_CATEGORIES`, which changes the
AI vocabulary, the validator and coverage mapping (all closed-union consumers), a large blast radius for no benefit.
The spec permits either (FR-017). Reuse of builders and of the approval/provenance vocabulary satisfies "extend, do not
fork".

**Alternatives rejected.** Extending `TestScenario` (blast radius). A raw HTTP request template per scenario (loses the
spec grounding and lets content choose a destination).

## R6. Typed mutations and a fixed evaluation language

**Decision.** Two closed vocabularies, both validated by a JSON Schema (Ajv) plus code cross-checks
([contracts/security-scenario-contract.md](contracts/security-scenario-contract.md)):

- **Mutations** (FR-021): `auth.omit`, `auth.invalid-token`, `auth.malformed`, `auth.expired` (uses an identity's user-supplied expired credential), `identity.swap`, `path-id.substitute` (from profile test data), `body.add-property`, `field.violate-constraint`, `method.probe` (only `HEAD`, `OPTIONS`, `TRACE`), `request.repeat` (count ≤ cap), `input.injection-probe` (fixed benign probe set).
- **Conditions** (FR-022, FR-053): `status.not-success`, `status.in-set`, `status.equals`, `status.not-equals`, `header.present`, `header.absent`, `header.value-not-contains`, `body.field-absent`, `body.field-present`, `body.not-match-leak-pattern` (fixed patterns: stack trace, server banner, internal path, secret-shaped value), `repeat.limit-engaged`, `persisted.field-unchanged`.

No expression, regex, filter or function is accepted from any source. `method.probe` excludes state-changing methods so a
probe can never itself be destructive.

**Rationale.** Principle IV and FR-020: free-form content must not become an executable action. A closed vocabulary is
validated structurally and cannot name a URL.

**Alternatives rejected.** A scripted assertion language (arbitrary code; against XVII and FR-020). Reusing only
`status-code` assertions (cannot express "not success", headers or leakage).

## R7. Review, versions and approval binding

**Decision.** A new Security Lab review service with two orthogonal states:

- `reviewState`: `draft | in_review | approved | rejected`.
- `executionStatus`: `not_run | executed | evaluated`.

Lifecycle "Draft → In review → Approved → Executed → Evaluated" is the shown composition. Scenario content is stored as
immutable numbered **versions** (the generated original is version 1 and is never overwritten). An approval record names a
version number and its `contentHash`. A **material edit** is any change to a field in the fixed material set (request base,
mutations, expected behavior, evaluation conditions, operation key, category and intent, repeat count, destructive flag);
it creates a new version in `in_review` and the prior approval stays attached to the prior version only (FR-030). A
non-material edit (title, notes, suggested severity, manual-input text) creates a new version that keeps `approved` and
records the edit. Execution requires `reviewState == approved` for the exact version in the run plan.

Transitions: `draft→in_review`, `draft→rejected`, `in_review→approved`, `in_review→rejected`, `in_review→draft`,
`approved→in_review`, `approved→rejected`, `rejected→in_review` (reopen). Anything else is refused by the service.

Batch review accepts explicit `{id, version}` items, never a filter; the UI resolves a filter to the visible list and
shows its count (FR-031/FR-032). Destructive scenarios are refused in a batch approval unless each is named in a separate
confirmation list.

**Rationale.** F5: the existing review model has the revision check and history but not version retention or approval
binding. Per-scenario integer `revision` is the model; this adds immutability and a hash.

**Alternatives rejected.** Extending `ReviewWorkspace` (three states, no version retention, tied to `TestScenario`). Allowing a
filter-based batch (the user cannot identify the set).

## R8. Execution profile layered on the existing environment

**Decision.** A `SecurityProfile` is a separate session-scoped record that references one existing `Environment` by id. The
environment supplies `name`, `tier`, `baseUrl` and the encrypted variable store; the profile adds `allowedHosts`,
`allowedPorts`, `allowedAddressRanges` (local only), `tlsPolicy`, `identities`, `testData`, `timeoutMs`, `maxRequests`,
`maxConcurrency`, `permittedCategories`, `destructivePermitted`, `cleanup`. An identity holds a name, a role label and a
map from security-scheme name to an **environment variable name**; the secret value lives only in the environment's
encrypted `variableValues`, entered through the existing environment form. The profile therefore never stores a secret
(FR-048), and no second credential store exists.

Tier policy: `local` → local profile (may name loopback or private ranges); `dev`, `qa`, `staging` → staging-like (no private
ranges, confirmation, destructive gating); `production` → refused.

A run copies the profile and the environment's `baseUrl` and tier into an immutable run snapshot, so later edits do not
change a run in progress (spec edge case).

**Rationale.** F9: "reuse the existing target environment concept where possible". Storing identities as references to
environment variables reuses encryption and the "never shown again" behavior.

**Alternatives rejected.** Extending `Environment` itself (bloats an AP-017 type and its UI for one feature). A second secret
store (duplicates encryption and the redaction surface).

**Required change.** `requireEnvironmentAccess()` must also open environment routes when a workflow with an `apiModel`
exists, because Security Lab needs environments before the guided workflow reaches Postman generation.

## R9. Destination policy (binding rules)

**Decision.** A pure `evaluateDestination({ url, address, profile, tier }) → { allowed } | { allowed: false, reason }`, used by the
sender at three points: base-URL validation when a profile is saved, the connect step of every request, and every
redirect hop. Rules, in order:

1. Scheme must be `http` or `https`; userinfo in the URL is refused.
2. Host (lowercased, trailing dot removed, IDNA-normalised) must be in `allowedHosts`; port must be in `allowedPorts`
   (default: the scheme's port).
3. The address actually connected to is classified with `node:net` `BlockList`: loopback, private (RFC 1918), CGNAT,
   link-local, unique-local, multicast, unspecified, and IPv4-mapped IPv6 are "restricted". The cloud metadata address
   `169.254.169.254` and `fd00:ec2::254` are **always blocked**, even on a local profile.
4. A restricted address is allowed only when the profile is `local` tier **and** `allowedAddressRanges` names it.
5. Literal IP hosts are checked by rules 3 and 4 and must also appear in `allowedHosts`.

Validation runs on the resolved address inside the socket's `lookup` callback, so the checked address is the connected
address. That closes the check-then-connect window that rebinding exploits.

**Rationale.** F6, F7, FR-036 to FR-040, SC-006. The `BlockList` class is built into Node 24, so no dependency is added.

**Alternatives rejected.** Validating the hostname string only (defeated by DNS). Resolving separately, then fetching by
name (TOCTOU). An allow-list of origins only, as the debug sender does (no address check).

## R10. A guarded sender on `node:http` / `node:https`

**Decision.** `securityLab/execution/guardedSender.ts` sends with `node:http`/`node:https`, passing a custom `lookup` that
resolves all addresses, applies R9 to each, and connects to the first allowed one (preserving SNI and the `Host` header).
Redirects are never followed by the library; a 3xx is revalidated as a new destination and followed manually up to 3 hops
only if allowed (cross-origin hops drop `Authorization`, `Cookie` and `Proxy-Authorization`). The response is read up to
a byte cap (default 256 KiB) and marked truncated. Each request has a deadline and an `AbortSignal`, so cancellation
aborts in flight. Proxy environment variables are ignored. TLS verification defaults to on; `tlsPolicy: "relaxed-local"`
is accepted only for a local profile and appears in the run confirmation (FR-007/US6.7).

The sender is injected (`Sender` interface, as `createFetchSender` is) so tests use a fake sender and a real loopback
target server, never the public network (Principle XXI).

**Rationale.** F6, F7: Newman cannot enforce R9, and global `fetch` (undici) does not expose a per-connection `lookup`
without a dispatcher dependency or custom agent. `node:http(s)` exposes `lookup` directly.

**Alternatives rejected.** Newman with an environment allow-list (follows redirects, no address control, sequential, fixed timeout).
`undici` as a direct dependency (new dependency for what `lookup` already does). Reusing `createFetchSender` (no address check).

## R11. Budgets, ceilings and defaults (initial values, configuration not contract)

| Setting | Default | Ceiling (no profile may exceed) | Environment variable |
|---|---|---|---|
| Max requests per run (incl. cleanup) | 100 | 500 | `SECURITY_LAB_MAX_REQUESTS_CEILING` |
| Max concurrency | 1 | 4 | `SECURITY_LAB_MAX_CONCURRENCY_CEILING` |
| Request timeout | 10 s | 30 s | `SECURITY_LAB_TIMEOUT_MS_CEILING` |
| Repeat count per scenario | threshold + 20% margin, min 5 | 50 | `SECURITY_LAB_MAX_REPEAT_CEILING` |
| Redirect hops | 3 | 3 | none (fixed) |
| Response read cap | 256 KiB | 256 KiB | none (fixed) |
| Evidence body excerpt | 4 KiB | 4 KiB | none (fixed) |

Ceilings are read and validated at startup (`validateSecurityLabConfiguration`, fail fast like `validateAIConfiguration`)
and documented in `.env.example`. The run planner computes `plannedRequests` before start and refuses a plan above
`min(profile.maxRequests, ceiling)`.

**Rationale.** FR-026, FR-035, FR-043. Conservative values; a rate-limit probe of 50 requests is enough to engage a typical
documented threshold, and a larger documented threshold is reported as unreachable (spec edge case).

## R12. Run orchestration, slot and cancellation

**Decision.** `runSecurityRun` is a bounded worker pool (size = effective concurrency) over a pre-computed request plan,
with a shared budget counter that is decremented before each send, so concurrency cannot overshoot. The run joins
`findExecutionInProgress()` through a `SecurityRunRepository.getInProgress(sessionId)` branch (F8), so one execution per
session. Start is two steps: `POST /runs/preview` returns the confirmation summary and a `planDigest` (hash of profile
snapshot, ordered `{scenarioId, version}` list, limits); `POST /runs` must echo the digest, the target confirmation and the
destructive confirmations, so the confirmed plan is the executed plan (FR-042). Cancellation sets a flag and aborts
in-flight requests; no new request is dequeued; cleanup then runs once and is reported (FR-044, FR-046). The existing
`markInterruptedRunsCancelled()` pattern settles a run left `in-progress` at startup.

**Rationale.** F6 (Newman runs items sequentially and cancels only between items) and the spec's explicit
progress/cancel/partial-result requirements.

## R13. Persistence: new tables, two lifetimes (revised after the 2026-10-18 clarification)

**Decision.** Append blocks to `initializeSchema()` (F10), one repository per aggregate. FR-051 gives the data two
lifetimes, so every table is either **owner-scoped** (retained work: keyed by `owner_id`, never deleted by session expiry)
or **session-scoped** (keyed by `session_id`, deleted by the existing `onExpire` listener and `deleteBySession`):

| Table | Scope | Holds |
|---|---|---|
| `security_scenarios` | owner | one row per scenario id: current version, review state, execution status, origin, assessment key |
| `security_scenario_versions` | owner | immutable version content (JSON), content hash, spec revision, security basis hash, approval record |
| `security_runs` | owner | run header, `session_id` of the starting session (for the execution slot), profile summary (name, tier, base URL, limits, TLS policy; no identities or test data), plan, status, budget counters, cleanup summary |
| `security_run_results` | owner | per scenario outcome, reason, condition results, deterministic observed summary; **no evidence bodies** |
| `security_findings` | owner | one row per scenario version: status, severity history, confidence, remediation id, `occurrences` JSON (each with run, result id, time, observed summary) |
| `security_settings` | owner | user-configured sensitive field names (names only) |
| `security_profiles` | session | profile JSON (no secrets) and environment id |
| `security_evidence` | session | redacted evidence records per result, encrypted (paired `*_encrypted`/`*_iv` columns), with `owner_id`, `run_id`, `result_id` |

Rules that follow from this split:

1. On session expiry only the session-scoped tables are cleared. A finding's occurrence whose `security_evidence` row is absent
   is reported as "raw evidence no longer available" (derived, never stored), and keeps its observed summary.
2. The **observed summary** stored with a result and an occurrence is deterministic and bounded: status code, a fixed set of
   response header names with redacted values, and a sentence built from the decisive condition. It never holds a body excerpt;
   a secret-shaped value is described as "secret-like value present at <path>" (R14).
3. Retained scenario content must contain no credential-shaped value. The validator's safety step rejects a header or
   body value that classifies as a credential (`classifyValue`), so retained rows cannot become a second secret store.
4. An in-progress run is found by `session_id` for the execution slot; `markInterruptedRunsCancelled()` settles any run left
   `in-progress` at startup, as for the other run kinds.
5. A new upload replaces the guided workflow but deletes no Security Lab row.
6. Growth is bounded because "until the engineer deletes" has no expiry: per-owner caps (default 20,000 scenario rows, 500
   runs) are read at startup (R11 mechanism, `SECURITY_LAB_MAX_RETAINED_SCENARIOS`, `SECURITY_LAB_MAX_RETAINED_RUNS`).
   Generation and run start refuse with `retention_limit_reached` and tell the engineer to delete retained data.
7. Deletion: `DELETE /data` removes all of an owner's retained work and the owner's session data; `DELETE /assessments/:key`
   removes one assessment (R22). Deletion is a hard delete in one transaction.

**Alternatives rejected.** Everything session-scoped, as first planned (contradicts the clarification: approvals and findings
would vanish after 60 idle minutes). Everything retained (contradicts it the other way: credentials and raw bodies must go with the
session). In-memory only (loses data on restart). A single JSON document per owner (no per-version queries, awkward
concurrent updates).

## R14. Evidence redaction

**Decision.** `securityLab/evidence/redactEvidence.ts` composes the existing helpers: `redactHeaders`, `redactUrl`,
`redactBody` and `redactFreeText` from `failureAnalysis/redaction.ts`, `classifyFieldName`/`classifyValue` from
`apiInput/redaction.ts`, and **literal-value masking**: every credential value the run resolved for its identities plus
every configured sensitive-field value is masked wherever it appears, in any header, URL, body or error message. Redaction
runs when an `EvidenceRecord` is constructed, so no later stage holds an unredacted value. Logs carry only ids, stages,
outcome codes, durations and error categories; a test captures log output over a seeded-secret corpus (the AP-056
approach). Stored excerpts are bounded and flagged truncated; a body with a secret-shaped value is recorded as
"secret-like value present at <json path>" without the value.

**Rationale.** F11, FR-048 to FR-052, SC-009.

## R15. Deterministic evaluation, confidence and severity

**Decision.** `evaluateScenario(scenarioVersion, evidence[]) → ScenarioOutcome` is pure. Each condition evaluates to
`satisfied | violated | indeterminate`; the scenario outcome is `failed` if any required condition is violated,
`inconclusive` if none is violated and any is indeterminate, `passed` if all are satisfied. Transport states map:
no response → `errored`, blocked destination or unmet prerequisite → `blocked`, not sent → `not_run`. Confidence:

- **high**: a documented expectation violated by a single unambiguous response, or acceptance of a request that must have been rejected where the spec documents rejection.
- **medium**: a product-rule expectation violated by a clear response.
- **low**: violation only visible across repeated requests, or evidence that is truncated near the decisive part.

The basis string is recorded. Severity starts at the scenario's suggested severity; the engine never raises it. No model is
consulted (FR-053, FR-056).

## R16. Postman export through a security overlay

**Decision.** `generateSecurityCollection` in `backend/src/postman/` reuses `buildRequestItem`, `authMapping`,
`artifactVariables`, `identifiers` and the collection validator. A new pure `securityOverlay.ts` applies a scenario's
mutations to the item (auth omission, invalid or malformed auth value placeholder, identity swap by variable name, body
property addition), and a fixed set of assertion-script templates covers `status.not-success`, `status.in-set`,
`header.present|absent` and `body.field-absent`. Scenarios needing repetition, persisted-state checks or `method.probe`
on a path the generator cannot express are listed as new `GenerationLimitationKind` values (`security-repeat-not-expressible`,
`security-persisted-state-not-expressible`, `security-condition-not-expressible`). Identity credentials are the existing
secret variables with empty values. Item ids stay deterministic from the scenario id and version. Existing OpenAPI exports
are unchanged (a byte-equality test over the existing corpus).

**Rationale.** F13, FR-063. Generating from the approved version keeps Principle XVI.

**Alternatives rejected.** A separate collection builder (forks the exporter). Dropping unexpressible scenarios silently (against
FR-063). Emitting a pre-request script that mutates auth at run time (script content outside the fixed-template rule).

## R17. AI suggestions as a separate validated contract

**Decision.** `securityLab/ai/` has its own prompt, response version (`SECURITY_SUGGESTION_RESPONSE_VERSION = 1`), parser and
validator, through `getAIProvider()` only. A suggestion is a scenario *proposal* in the closed vocabulary of R6; the
validator rejects: a mutation or condition outside the vocabulary, any operation or field not in the `ApiModel`, any
string field that parses as a URL or host, any header override, a repeat count over the ceiling, and a category with
support level `analysis-only`. Accepted suggestions are stored `origin: "ai"`, `reviewState: "draft"` with the model,
confidence and assumptions recorded (Principle III). Evaluation is the same deterministic code. Tests use a stub provider
(F: the mock provider's JSON is not a valid candidate).

**Rationale.** Principles IV, VI, XXIII; FR-020, FR-040. `AIScenarioCandidate.category` must lie in `SCENARIO_CATEGORIES`
and cannot express auth or repeat, so the AP-005 pipeline cannot be reused.

## R18. Frontend integration

**Decision.** Add destination `security` after `coverage` in `TOP_DESTINATIONS`. Coverage is the analysis destination and
Import & Run Collection is the execution destination; placing Security Lab directly after Coverage keeps it adjacent to both
(FR-001). Extend `Route` with an optional `area` and let `parseRoute` accept `#/security/<area>` for
`overview | scenarios | execution | reports` only (the AP-054 rule that only `guided` has a second segment is relaxed
for a closed list; unknown areas redirect to `#/security` with a notice). Model Security Lab in `workflowCatalog` as a
results-style view (extend `RESULTS_VIEWS` / `ResultsViewId`), so Help and the command palette pick it up, and generalise
`isResultsView` handling in `App.tsx` from "open coverage" to "open that results view". The page is lazy and stays
mounted when hidden (existing pattern), so a run's progress and unsaved edits survive tab switches. Services use a
`securityLabClient.ts` with the discriminated-result pattern; run polling uses a dedicated `useSecurityRun` hook that
polls every second, never overlaps polls and stops on a final state, without extending `LiveRunKind`.

Reused components: `Tabs`, `StatTile`, `StatusBadge`, `EmptyState`, `ErrorState`, `Skeleton`, `ConfirmDialog`, `Dialog`,
`Pagination`, `CodeBlock`, `HttpMethodBadge`, `ProvenanceBadge`, `FactOriginBadge`, `SummaryPanel`, patterns (`Banner`,
`Card`, `KeyValueGrid`, `Pill`, `tableStyles`), the `useBulkDecision` chunking idea, `EnvironmentForm` for the
environment half of a profile. No shared pattern component is added, so `PatternLibraryPage` is unchanged unless
implementation introduces one.

## R19. Taxonomy mapping

OWASP API Security Top 10, **2023 edition** (identifier `owasp-api-top10-2023`), verified against the official edition page
([owasp.org/API-Security/editions/2023/en/0x11-t10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)):
API1 Broken Object Level Authorization; API2 Broken Authentication; API3 Broken Object Property Level Authorization;
API4 Unrestricted Resource Consumption; API5 Broken Function Level Authorization; API6 Unrestricted Access to Sensitive
Business Flows; API7 Server Side Request Forgery; API8 Security Misconfiguration; API9 Improper Inventory Management;
API10 Unsafe Consumption of APIs.

| Category | Taxonomy ids | Relation |
|---|---|---|
| authentication | API2 | primary |
| authorization | API5 | primary |
| broken-object-level-authorization | API1 | primary |
| object-property-authorization | API3 | primary |
| input-validation | API8 | **related** (see note) |
| resource-consumption | API4 | primary |
| sensitive-data-exposure | API3 | primary (2023 merges excessive data exposure into API3) |
| security-misconfiguration | API8 | primary |
| sensitive-business-flows | API6 | primary |
| ssrf-unsafe-consumption | API7, API10 | primary |
| api-inventory | API9 | primary |

**Note, an assumption rather than an OWASP statement.** The 2023 edition has no dedicated injection or input-validation
entry (the 2019 edition's API8 Injection was removed). Input validation is therefore recorded as `related` to API8 with
`relation: "related"`, and the mapping is labelled as ApiPilot's judgement in the registry and in reports. The edition is
data, so a later edition is a registry addition and existing scenarios keep the edition they were created under (FR-015).

## R20. Dependencies and limits

No new package. Ajv (present) validates the scenario schema; `node:net`, `node:http`, `node:https`, `node:dns`,
`node:crypto` cover the rest. Rejected: `ssrf-req-filter` and similar libraries (cover only part of R9 and add supply-chain
surface), `undici` as a direct dependency.

## R21. Test strategy

- Pure units: effective-security resolution (inherit, override, explicit public, none declared), every observation rule, determinism (twice-equal), registry/taxonomy, scenario id stability and dedupe, material-edit hashing, state machine, destination policy matrix (literal IPs, IPv4-mapped IPv6, metadata, rebinding via an injected resolver that changes answer), redirect revalidation, budget accounting under concurrency, evaluation table, redaction.
- Seeded-secret corpus: seeds credentials into requests, responses, headers, bodies, error text; asserts absence in stored evidence, logs, findings, reports, export (SC-009).
- Integration (Supertest) for each route group, with a loopback `TargetServer` extended to a deliberately vulnerable/secure pair (`tests/fixtures/securityLab/`), with the profile explicitly allowing `127.0.0.1`. A direct-to-service test proves the policy is not UI-only (SC-006).
- AI: stub provider returning one valid, one malformed, one URL-bearing, one unsupported-action suggestion.
- Frontend (RTL): states, filters, confirmation flows, non-colour cues, route grammar, sidebar/palette/help updates.
- Regression: byte-equality of deterministic generation, review and Postman export over the existing corpus (SC-014).

## R22. Retained-work ownership: a separate, long-lived owner identifier

**Decision.** Retained work (R13) is keyed by an `owner_id`, a random UUID held in a dedicated cookie `apipilotOwner`
(`httpOnly`, `sameSite=lax`, `Max-Age` 400 days, `secure` when the backend is reached over HTTPS). A small middleware
(`securityLab/owner/ownerMiddleware.ts`) is mounted **only** on the `/api/security-lab` router. It validates the UUID shape,
issues a fresh id when the cookie is missing or malformed, and exposes `getOwnerId()` through an `AsyncLocalStorage`
context, the same pattern as `sessionContext.ts`. Rows are created only when something is written, so a probing client
that sends random cookies creates no rows. No existing middleware, cookie or route changes.

**What this guarantees.** The same browser profile sees its retained work after idle expiry, backend restart and browser
restart (F17), until the engineer deletes it or clears the cookie. A different browser, profile or device sees none of it
(SC-017). The owner id is an unguessable capability like the session id, so the isolation model is unchanged in kind.

**Stated limitations (documented in the user manual and the Security Lab banner).**
- Clearing cookies or switching browser profile makes the old rows unreachable. They are not recoverable through the product.
  The manual says where the local database lives for manual removal (`APIPILOT_DB_PATH`).
- The AP-049 LAN development access path is a different origin and therefore a different cookie jar; retained work does not
  follow the user across origins.
- It is single-user per browser, so there is no multi-user approval model; the recorded actor is a label the engineer may set.

**Assessment key.** The spec lets the engineer delete "one assessment's" data without defining one. The plan defines an
**assessment** as the retained work generated for one specification identity, grouped by the key `hash(info.title ?? "", specificationFilename)`
stored on each scenario at generation, and shown in the UI as "<title> · <filename>". A specification re-uploaded under the same
title and filename continues the same assessment; a HAR input with neither groups under its filename. This is a planning
judgement (CLAUDE.md §63) and is flagged for reviewer confirmation.

**Alternatives rejected.** Keying by session id (lost when the browser closes; F17). Switching the existing session cookie to
persistent (changes behaviour for every feature and the idle-eviction model). `localStorage` in the frontend (cannot hold server
history, not shared with the backend). A user account system (out of scope, XXVII).

## R23. Generation scope

**Decision.** `workflow.selectedOperationKeys` (when set) is the default generation scope; `undefined` means all operations.
`GET /scope` returns `{ mode, selectedCount, totalCount, available }`. `POST /scenarios/generate` accepts
`scope: { mode: "selection" | "all" | "custom"; operationKeys?: string[] }`, defaults to `selection`, and returns the scope
applied with `{ included, excluded }` counts, which the UI shows wherever scenarios are generated or listed (FR-018).
Narrowing never deletes existing scenarios. `GET /analysis` and `GET /overview` ignore the selection (FR-005). Without a loaded
workflow, scope is unavailable and generation is refused (FR-004).

**Alternatives rejected.** Always all operations (review work for deliberately excluded operations). Always the selection (hides
risks on operations outside it). A separate Security Lab-only selection store (a second source of truth for the same concept).

## R24. One finding per scenario version, with occurrences

**Decision.** Finding id is `sf-` + `fragmentHash(scenarioId, version)`, so it is stable and unique per scenario version. The
first `failed` result creates it. Each later `failed` result of the same version appends an occurrence (`resultId`, `runId`, `at`,
observed summary) and updates `occurrenceCount`, `latestFailedAt`. If the finding is `resolved` (asserted or verified) it is
reopened with a history entry; if `accepted-risk` or `false-positive` it keeps that status and sets `unreviewedOccurrence = true`
until the engineer acknowledges it. A `passed` result for the same version sets `resolvedAssertion = "verified-by-rerun"`
on a `resolved` finding. A material edit creates a new version and so, on its first failure, a new finding with `supersedes`
pointing at the earlier version's finding. Counts and reports count findings, not occurrences, with the occurrence count shown beside
each finding.

**Rationale.** The 2026-10-18 clarification: one problem is one finding. It also makes SC-011 a precise invariant (findings per
failed version equals one; occurrence count equals failed results).

**Alternatives rejected.** One finding per execution (inflates counts on every rerun). One per operation and category (merges
versions that test different things, hides which approved version failed).

## Assumptions carried (not verified in the repository)

1. Node 24's `net.BlockList` and `http.request({ lookup })` behave as documented on Windows, including `localhost` resolving to `::1` and `127.0.0.1`. The first implementation task includes a Windows test of both.
2. The OWASP mapping of input validation to API8 as "related" is a judgement (R19), flagged for reviewer confirmation.
3. Defaults in R11 are reasonable starting points and are expected to be tuned after the first real-target run.
4. Constitution 3.3.0 (R1) is a draft awaiting the Governance review; if it is rejected the destination policy stays an engineering contract.
5. A 400-day `Max-Age` for the owner cookie is a reasonable default and is browser-capped in practice; it is a constant in code, not product contract.
6. The assessment key (R22) is a planning judgement for reviewer confirmation.
7. Whether browsers keep the owner cookie across the target environments the team uses (HTTPS, a LAN address) is not verified here; the first slice-1 task checks it on Windows with the supported browsers.
