# Data Model: ApiPilot Security Lab — V1

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

Contracts live in `packages/shared-domain/src/securityLab.ts` (new, framework-agnostic, exported from the package index),
with additive edits to `apiModel.ts` and `postmanArtifact.ts`. Names below are the intended TypeScript names. Every id is a
string. Times are ISO 8601 strings supplied by an injected clock (determinism, constitution XXIV).

## 1. Additive edits to existing shared-domain types

| Type | New optional field | Meaning |
|---|---|---|
| `ApiModel` | `rootSecurity?: SecurityRequirement[]` | The document's root `security`, as written. |
| `ApiModel` | `rootSecurityDeclared?: boolean` | Whether the root declared `security` at all (distinguishes absent from `[]`). |
| `ApiOperation` | `securitySource?: SecuritySource` | How the effective `security` was determined (R2). Unset for HAR and definition input. |
| `ApiOperation` | `deprecated?: boolean` | From the specification. |
| `SchemaConstraint` | `readOnly?`, `writeOnly?: boolean` | From the specification. |
| `SecuritySchemeDefinition` | `bearerFormat?`, `openIdConnectUrl?: string` | From the specification. |
| `GenerationLimitationKind` | `security-repeat-not-expressible`, `security-persisted-state-not-expressible`, `security-condition-not-expressible` | Export limitations (R16). |

`SecuritySource = "operation" | "root" | "explicit-public" | "none-declared"`.

Invariant: for OpenAPI input, `securitySource` plus `rootSecurity` reproduce `operation.security` exactly, and
`specificationRevision` is unchanged.

## 2. Registry and taxonomy

**`SecurityCategory`** (static, versioned in code): `id`, `name`, `supportLevel: "supported" | "limited" | "analysis-only"`,
`executable: boolean`, `prerequisites: PrerequisiteKind[]`, `taxonomy: TaxonomyMapping[]`, `limitationNote?`.

**`TaxonomyMapping`**: `edition: "owasp-api-top10-2023"`, `id: "API1".."API10"`, `relation: "primary" | "related"`.

Initial registry (support is separate from taxonomy membership, FR-015):

| id | support | executable | Required prerequisites |
|---|---|---|---|
| `authentication` | supported | yes | a documented security requirement; for `auth.expired` an expired credential |
| `authorization` | supported | yes | two identities with different roles; a documented role or policy statement |
| `broken-object-level-authorization` | supported | yes | two identities; owned-resource test data per identity; read/update/delete only where the operation and safe data exist |
| `object-property-authorization` | supported | yes | a protected property known from the model (`readOnly`, or user-configured); persisted-state read is optional |
| `input-validation` | supported | yes | none beyond the specification |
| `resource-consumption` | supported | yes | a documented or configured threshold; budget headroom |
| `sensitive-data-exposure` | supported | yes | a basis for each field (declared flag or user-configured) |
| `security-misconfiguration` | supported | yes | none beyond the specification |
| `sensitive-business-flows` | limited | yes (only with a defined policy) | defined expected policy, bounded actions, test data |
| `ssrf-unsafe-consumption` | limited | no in V1 | controlled callback verification (absent); scenarios are not generated, an observation states the limit |
| `api-inventory` | analysis-only | no | none |

## 3. Analysis

**`SecurityObservation`**: `id`, `ruleId`, `classification: "informational" | "potential-risk" | "requires-context" | "not-measurable"`,
`operationKey?` (`"METHOD /path"`), `elementPointer` (a JSON-Pointer-like path into the model, for example
`/operations/GET /users/{id}/security`), `rationale`, `basis?` (for sensitivity: `format-password | write-only | user-configured | name-match`),
`origin: FactOrigin` (the model fact's provenance, FR-011), `categoryId?`.

**`EffectiveSecurity`**: `operationKey`, `requirement: SecurityRequirement[]`, `source: SecuritySource | "unknown"`,
`rootExplicitlyEmpty: boolean`.

**`SecurityAnalysis`**: `specificationRevision`, `securityBasisHash`, `effective: EffectiveSecurity[]`,
`observations: SecurityObservation[]`, `counts: Record<classification, number>`, `unmeasurable: string[]` (named inputs
that were absent). Pure function of the model and the user-configured sensitive-field list; no clock.

Invariants: ordering is sorted by `operationKey`, `ruleId`, `elementPointer`; an observation never uses the words
"vulnerable" or "exploitable" (a lint test over rule output); `potential-risk` is never produced from a name match alone.

## 4. Scenario

**`SecurityScenario`** (the stable row) and **`SecurityScenarioVersion`** (immutable content):

`SecurityScenario`: `id` (`ss-…`, stable across revisions), `ownerId`, `assessmentKey`, `assessmentLabel`
(`"<title> · <filename>"`, research R22), `currentVersion: number`, `reviewState`, `executionStatus`,
`origin: "rule" | "ai" | "user"`, `createdAt`.

`SecurityScenarioVersion`: `scenarioId`, `version`, `contentHash`, `specificationRevision`, `securityBasisHash`,
`content: SecurityScenarioContent`, `author: "generator" | "ai" | "user"`, `createdAt`, `editNote?`, `materialChange: boolean`,
`approval?: ApprovalRecord`, `rejection?: { reason, at }`.

`SecurityScenarioContent` (every field required by FR-019):

| Field | Type |
|---|---|
| `operationKey`, `operationMethod`, `operationPath` | strings |
| `categoryId` | registry id |
| `taxonomy` | `TaxonomyMapping[]` (edition kept per scenario) |
| `title`, `objective`, `rationale` | strings |
| `prerequisites` | `Prerequisite[]` |
| `requiredIdentities` | `{ role: string; label: string }[]` |
| `baseRequest` | existing `GeneratedRequest` |
| `mutations` | `SecurityMutation[]` (closed set, §4.1) |
| `expected` | `ExpectedBehavior` |
| `conditions` | `EvaluationCondition[]` (closed set, §4.2) |
| `impact` | string |
| `suggestedSeverity` | `"info" | "low" | "medium" | "high" | "critical"` |
| `destructive` | `{ flag: boolean; reasons: string[] }` |
| `plannedRequestCount` | integer ≥ 1 and ≤ repeat ceiling |
| `limitations`, `manualInputs` | `string[]` |
| `provenance` | `{ operationKey; specElementPointer; observationId?; ruleId?; aiModel?; aiConfidence?; aiAssumptions? }` |
| `evidenceOrigin?` | `FactOrigin` and `observationCount?` when the model came from HAR input |

`Prerequisite`: `id`, `kind: "identity" | "role" | "test-data" | "ownership" | "threshold" | "expired-credential" | "persisted-read"`,
`description`, `state: "met" | "missing" | "unsupported"`, `detail?`. Met/missing is **derived at read time** from the selected
profile, never stored.

`ApprovalRecord`: `version`, `contentHash`, `approvedAt`, `actor`, `destructiveConfirmed: boolean`.

### 4.1 `SecurityMutation` (closed discriminated union on `kind`)

`auth.omit` | `auth.invalid-token` | `auth.malformed` | `auth.expired { identity }` | `identity.swap { from, to }` |
`path-id.substitute { parameter, ownerIdentity }` | `body.add-property { path, name, valueKind }` |
`field.violate-constraint { path, constraint }` | `method.probe { method: "HEAD" | "OPTIONS" | "TRACE" }` |
`request.repeat { count }` | `input.injection-probe { path, probeId }`.

No member carries a URL, host, header name chosen by content, or free-form value except from the fixed probe set and the
existing value generators.

### 4.2 `ExpectedBehavior` and `EvaluationCondition`

`ExpectedBehavior`: `kind` (`rejected | allowed | limited | no-leak | header-policy | persisted-unchanged`), `statement`,
`basis: "documented" | "product-rule"`, `ruleId?` (named product rule), `documentedStatusCodes?: number[]`,
`citation?` (specification element pointer).

`EvaluationCondition` (closed union): `status.not-success` | `status.in-set { codes }` | `status.equals { code }` |
`status.not-equals { code }` | `header.present { name }` | `header.absent { name }` | `header.value-not-contains { name, token }` |
`body.field-absent { path }` | `body.field-present { path }` | `body.not-match-leak-pattern { patternId }` |
`repeat.limit-engaged { withinRequests }` | `persisted.field-unchanged { path }`.

`patternId` and `probeId` are members of fixed enumerations in code. No expression, regular expression or function is accepted.

### 4.3 State rules

`reviewState`: `draft`, `in_review`, `approved`, `rejected`. Allowed transitions are in
[contracts/review-and-approval-rules.md](contracts/review-and-approval-rules.md). `executionStatus`: `not_run`, `executed`, `evaluated`;
`approved + not_run → executed → evaluated`; a rerun of an approved scenario sets it to `executed` then `evaluated` again
and appends a new result (history is never overwritten).

Derived flags (never stored): `specificationNotLoaded` (no workflow model in the session; when true `stale` and `orphaned` are
not evaluated), `stale` (revision or basis hash differs from the current model for that operation), `orphaned` (operation
absent), `blocked` (any prerequisite not met), `executable` = `approved ∧ ¬specificationNotLoaded ∧ ¬stale ∧ ¬orphaned ∧ ¬blocked ∧ category permitted by the chosen profile ∧ (¬destructive ∨ profile.destructivePermitted)`.

Invariants:
1. `contentHash` = hash of the canonicalised material fields; an approval is valid only for the version whose hash it records.
2. Version rows are immutable; the original generated version (1) is never edited.
3. A material change always produces `in_review` (or `draft` for AI/user-created); a rejected scenario never becomes `executable`.
4. Scenario id is stable for the same operation key, category, mutation kind, target and parameters; the revision is a version attribute.
5. Scenario content holds no credential-shaped value (the validator's safety step rejects one), so retained rows are never a secret store.

## 5. Profile

**Lifetime**: session data (FR-051). A profile, its identities and its test data values are removed with the session. A run keeps
only a `ProfileSummary` (see §6).

**`SecurityProfile`**: `id`, `name`, `environmentId`, `allowedHosts: string[]`, `allowedPorts: number[]`,
`allowedAddressRanges: string[]` (local tier only), `tlsPolicy: "verify" | "relaxed-local"`, `identities: TestIdentity[]`,
`testData: TestDataEntry[]`, `timeoutMs`, `maxRequests`, `maxConcurrency`, `permittedCategories: string[]`,
`destructivePermitted: boolean`, `cleanup: CleanupStrategy`, `createdAt`, `updatedAt`.

`TestIdentity`: `name`, `role`, `credentialSchemes: string[]` (the security schemes the identity has a credential for) and
`expiredCredentialSchemes?: string[]` (those it has a known-expired credential for). **No secret value is a member.** The values live in
the write-only `security_credentials` store (research R8), keyed by profile, identity, scheme and kind (`active | expired`), and no
route returns one. A profile response carries `credentialStatus: { identity, scheme, kind, set }[]` instead.

`TestDataEntry`: `ownerIdentity`, `operationKey?`, `parameter`, `value` (a non-secret identifier, for example a resource id; a value
that classifies as credential-like is refused).

`CleanupStrategy`: `{ strategy: "none" } | { strategy: "delete-created-via-spec"; idField: string }`.

Validation (on save and on use): environment exists and tier ≠ `production`; base URL satisfies the destination policy;
`allowedAddressRanges` empty unless tier = `local`; `tlsPolicy = "relaxed-local"` only on `local`; limits ≤ ceilings;
categories ⊆ registry executable categories; each scheme an identity names exists in `ApiModel.securitySchemes` when a specification
is loaded; test data values are not credential-shaped. The environment is read for `name`, `tier` and `baseUrl` only; its
`variableValues` are never read. A credential that is not yet set makes the prerequisites that need it `missing`, not the profile invalid.

## 6. Run, evidence, outcome

**Lifetimes (FR-051).** `SecurityRun`, `ScenarioResult` and `CleanupResult` are **retained work** (owner-scoped). `EvidenceRecord`
is **session data**: stored apart from the result, removed with the session, and referenced by `resultId`. A retained result
never embeds evidence bodies.

**`ProfileSummary`** (kept on the run): `profileId` (ties an in-progress run to its profile for `profile_in_use`; not a secret), `profileName`, `environmentName`, `tier`, `baseUrl`, `tlsPolicy`, `permittedCategories`,
`limits`, `destructivePermitted`. No identities, test data, allowed-host lists or credentials.

**`SecurityRun`**: `id`, `ownerId`, `sessionId` (the starting session, used for the execution slot), `status: "in-progress" | "completed" | "cancelled" | "failed"`, `cancelRequested`,
`cancelReason?: "user-requested" | "backend-restart"`, `startedAt`, `completedAt?`, `profileSummary`, the in-memory-only
`profileSnapshot` used while the run executes (never stored), `plan: PlannedItem[]` (`{ scenarioId, version, plannedRequests }`), `planDigest`,
`limits: { maxRequests, maxConcurrency, timeoutMs }`, `budget: { planned, used }`, `confirmation: { targetName, targetBaseUrl, authorizationAttested, destructiveScenarioIds }`,
`summary: Record<ScenarioOutcomeKind, number>`, `cleanup: CleanupResult[]`.

**`EvidenceRecord`** (redacted at construction): `index`, `sentAt`, `durationMs`, `method`, `urlRedacted`, `requestHeadersRedacted`,
`requestBodyExcerpt?`, `destination: { host, port, addressClass, verdict: "allowed" | "blocked", reason? }`,
`redirects: { toRedacted, verdict }[]`, `responseStatus?`, `responseHeadersSelected`, `responseBodyExcerpt?`, `truncated: boolean`,
`error?: { category: "timeout" | "connect" | "tls" | "aborted" | "blocked" | "read-limit" }`.

**`ObservedSummary`** (deterministic, bounded, retained): `responseStatus?`, `responseHeadersSelected` (a fixed set of header
names with redacted values), `statement` (a sentence built from the decisive condition, for example "status 200 for a request
without credentials" or "secret-like value present at $.token"), `truncated: boolean`. It never contains a body excerpt.

**`ScenarioResult`**: `id`, `runId`, `scenarioId`, `version`, `outcome: ScenarioOutcomeKind`, `reason`, `conditionResults:
{ condition, state: "satisfied" | "violated" | "indeterminate" }[]`, `observed: ObservedSummary`, `evidenceCount`, `startedAt`,
`durationMs`. `evidenceAvailable` is derived from the presence of session evidence rows and is never stored.

`ScenarioOutcomeKind = "passed" | "failed" | "inconclusive" | "blocked" | "errored" | "not_run"`.

**`CleanupResult`**: `scenarioId?`, `action`, `state: "done" | "failed" | "skipped"`, `detail`, `leftBehind?`, `manualRemoval?`.

Invariants: `budget.used ≤ budget.planned ≤ limits.maxRequests`; a result per planned scenario exists when a run settles
(`not_run` for unreached); `blocked` and `not_run` never count as passed; evidence never contains a literal credential
value the run resolved (checked by the seeded-secret test).

## 7. Finding

**Lifetime**: retained work (owner-scoped). A finding survives session expiry; its raw evidence does not.

**`SecurityFinding`** (one per scenario version, research R24): `id` (`sf-` + hash of scenario id and version), `ownerId`,
`assessmentKey`, `scenarioId`, `scenarioVersion`, `supersedes?` (the id of the finding for an earlier version of the same
scenario), `operationKey`, `specElementPointer`, `categoryId`, `taxonomy`, `expected`, `severity: { suggested, current }`,
`confidence: { level: "high" | "medium" | "low"; basis }` (of the **latest** occurrence), `remediationId`, `status: "open" |
"accepted-risk" | "false-positive" | "resolved"`, `resolvedAssertion: "engineer-asserted" | "verified-by-rerun"`,
`occurrences: FindingOccurrence[]`, `occurrenceCount`, `firstFailedAt`, `latestFailedAt`, `unreviewedOccurrence: boolean`,
`history: { at, field, from, to, note?, actor }[]`.

**`FindingOccurrence`**: `resultId`, `runId`, `at`, `observed: ObservedSummary`, `confidence`. Evidence bodies are not a member;
they are read from session evidence by `resultId` while available, otherwise "raw evidence no longer available" is shown.

Invariants:
1. At most one finding per `(scenarioId, version)`; it exists if and only if some result of that version is `failed`; and
   `occurrenceCount` equals the number of `failed` results of that version (SC-011).
2. `severity.suggested` is immutable. Status `resolved` is `engineer-asserted` until a later result of the same version is `passed`,
   then `verified-by-rerun`.
3. A later `failed` result of the same version appends an occurrence; it reopens a `resolved` finding with a history entry; it
   leaves `accepted-risk` and `false-positive` unchanged and sets `unreviewedOccurrence = true` until the engineer acknowledges it.
4. A material edit makes a new version; its first failure creates a new finding whose `supersedes` names the earlier one.
5. An occurrence is never edited or removed except by deleting retained data.

## 8. Report and overview (computed, not stored)

**`SecurityOverview`**: observation counts by classification (all operations, FR-005); scenario counts by category and by review state (plus stale, orphaned,
blocked, specification not loaded); the active generation scope (`mode`, `included`, `excluded`); the latest run summary; finding counts by severity and by status, counting findings and
never occurrences (occurrence totals are shown beside, not added), plus the number of findings with an unreviewed occurrence; `untestedHighPriority: { operationKey; basis }[]`
(high priority = an operation with a `potential-risk` or `requires-context` observation and no executed scenario, or a
sensitive operation with none); risk and finding groups kept separate.

**`SecurityReport`**: the overview plus per-category coverage, outcomes, findings with remediation status, specification
revision, per-run profile name and tier, taxonomy edition, not-covered categories and prerequisites with reasons, limits statement.
Deterministic for identical stored records (an injected clock supplies the generated-at label).

## 9. Relationships

```text
ApiModel ─1──n─ SecurityObservation
ApiModel ─1──n─ SecurityScenario ─1──n─ SecurityScenarioVersion ─0..1─ ApprovalRecord
SecurityScenarioVersion ─n──n─ SecurityRun (via PlannedItem) ─1──n─ ScenarioResult ─0..n─ EvidenceRecord (session data)
SecurityScenarioVersion ─1──0..1─ SecurityFinding ─1──n─ FindingOccurrence ─1──1─ ScenarioResult
SecurityProfile (session) ─n──1─ Environment (existing)      SecurityRun ─1──1─ ProfileSummary
Owner (cookie) ─1──n─ scenarios, runs, findings, settings      Session ─1──n─ profiles, evidence
```

## 10. Persistence mapping

See research R13 for tables and the two lifetimes. Owner-scoped rows (scenarios, versions, runs, results, findings, settings)
carry `owner_id` and are removed only by the engineer's delete actions. Session-scoped rows (profiles, evidence) carry
`session_id` and are removed by `deleteBySession` through `onExpire`. Version content, profile, run summary and finding history are JSON
TEXT columns; evidence is encrypted JSON.

## 11. Ownership and lifetimes (FR-051, research R22)

| Data | Owner key | Removed by |
|---|---|---|
| Scenarios, versions, approvals, review history | `owner_id` | engineer deletes (all, or one assessment) |
| Runs, results (outcomes, reasons, observed summaries), cleanup results | `owner_id` | engineer deletes |
| Findings and occurrences, settings | `owner_id` | engineer deletes |
| Environments (target name, tier, base URL) | session (existing) | session expiry |
| Profiles, identities, test data values | `session_id` | session expiry |
| Identity credential values (write-only, encrypted) | `session_id` | session expiry |
| Evidence records (bodies, headers, URLs, redacted) | `session_id` | session expiry |

`ownerId` comes from the `apipilotOwner` cookie via a middleware mounted on the Security Lab router only. Caps per owner
bound growth (R13 rule 6).
