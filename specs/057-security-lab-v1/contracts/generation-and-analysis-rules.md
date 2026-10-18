# Contract: Security Analysis and Scenario Generation Rules

**Status**: behavioural. **Spec**: FR-005 to FR-027. Each rule is a pure module in `backend/src/securityLab/analysis/rules/` or
`scenarios/rules/`, independently testable (CLAUDE.md §10). Identical input gives identical output in identical order.

## 1. Effective security resolution

Applied to every operation from `ApiOperation.security`, `securitySource`, `ApiModel.rootSecurity`, `rootSecurityDeclared` and
`securitySchemes`:

| Source | Meaning | Analysis result |
|---|---|---|
| `operation` | The operation's own non-empty requirement replaces the root's | informational `security-override` when a root requirement exists |
| `root` | Inherited from the root requirement | no "unprotected" observation |
| `explicit-public` | Operation declares `security: []` | informational `effective-security-public`; `requires-context` if the operation looks sensitive |
| `none-declared`, `securitySchemes` empty | Nothing declared anywhere | `not-measurable` (authentication cannot be assessed from this specification) |
| `none-declared`, schemes declared | Root and operation declare no requirement | `requires-context` (may be public or undocumented) |
| unset (HAR or definition input) | Observed or declared-without-source | `not-measurable` with the model's origin label; no "unauthenticated" claim |

An alternative `{}` (anonymous allowed) inside a requirement list is reported as `requires-context`. A root `security: []`
with no override is `none-declared` with `rootExplicitlyEmpty = true`, stated in the rationale.

## 2. Observation rules

| Rule id | Raises | Basis recorded |
|---|---|---|
| `auth-scheme-declared` | informational, one per scheme with its type and where it applies | scheme definition pointer |
| `auth-scheme-unused` | informational | no operation references it |
| `operation-uses-undeclared-scheme` | potential-risk (a specification inconsistency, not a runtime claim) | operation security pointer |
| `effective-security-*` | as §1 | `securitySource` |
| `sensitive-operation` | informational; `requires-context` when the effective security is public or none-declared | `method`, `path-token`, `identifier-parameter` (each named) |
| `sensitive-property` | informational or `requires-context` | `format-password`, `write-only`, `user-configured`, `name-match` (name-match is never stronger than `requires-context`) |
| `read-only-property-in-request` | informational (mass-assignment candidate) | `readOnly` flag in a request schema |
| `documented-error-responses` | informational: protected operation with no documented 401 or 403 | responses pointer |
| `inventory-duplicate-operation` | potential-risk (specification inconsistency) | the model's existing duplicate-operation issue |
| `inventory-deprecated` | informational | `deprecated` flag |
| `inventory-version-marker` | informational | path or server version token |
| `observed-model-limits` | not-measurable | model origin is `observed` or `inferred` |

Sensitive path tokens, parameter names and property-name patterns are a fixed, documented list in code. The user-configured
list (settings) is recorded as user-provided, never as specification fact. Output never uses "vulnerable", "exploitable" or
"proves" (lint test over rule text).

## 3. Scenario generation by category

**Scope.** Analysis (§1, §2) always covers every operation. Generation runs over the active scope: by default the operations
selected in the guided workflow's API review step (all operations when none were selected), which the engineer can widen to all
operations or narrow to chosen operations or categories (FR-018, research R23). Scenarios already generated for operations
outside a narrower scope are kept. The scope applied and the number of operations it leaves out are returned and shown.

A rule emits scenarios only when its precondition is met; otherwise it emits an **incomplete** scenario when the missing
prerequisite can be named (FR-016), or nothing when the scenario would be uninformative (FR-024).

| Category | Scenarios (mutations → expected) | Precondition | Notes |
|---|---|---|---|
| authentication | `auth.omit`, `auth.invalid-token`, `auth.malformed` → `rejected`; `auth.expired` → `rejected` | effective security non-empty with a scheme the sender can express (bearer, basic, apiKey in header or query); not generated for `explicit-public`, `none-declared`, unset | `auth.expired` is incomplete without an expired credential. OAuth2 token exchange is unsupported: an unsupported prerequisite, no guessed token. |
| authorization | `identity.swap` with a lower-privilege identity → `rejected` | the specification or a user-configured policy states a role requirement (scopes in the effective requirement count as documented) and two roles are configured | Without a stated policy no scenario (no invented policy). |
| broken-object-level-authorization | `path-id.substitute` with another identity's resource, on read, update and delete operations that take a resource id → `rejected` | two identities and owned-resource test data for the owner | Incomplete (with the missing data named) otherwise. Update and delete are destructive. |
| object-property-authorization | `body.add-property` of a `readOnly` or configured protected property → `rejected` or `persisted-unchanged` | a request body schema and a known protected property | `persisted-unchanged` only when a safe read operation and test data exist; otherwise the limitation states the persisted state is not verifiable. |
| input-validation | `field.violate-constraint` per violated declared constraint → `rejected`; `input.injection-probe` from the fixed set → `no-leak` plus `rejected` | declared constraint exists; injection probes only when the profile permits the category and the operation is not destructive | Reuses testDesign value generators; one scenario per constraint kind, deduplicated. |
| resource-consumption | `request.repeat` N → `limited` (`repeat.limit-engaged`) | a documented rate-limit header or threshold, or a configured threshold | N = min(threshold + margin, ceiling). If the threshold exceeds the ceiling the scenario says it is unreachable and can only be `inconclusive` about it. |
| sensitive-data-exposure | baseline request → `no-leak` (`body.field-absent`, `body.not-match-leak-pattern`) | a field classified with a stated basis (`format-password`, `write-only`, `user-configured`) in a response schema | A name-match-only field produces no scenario. |
| security-misconfiguration | `method.probe` → `rejected` (not success) for methods the spec does not document on the path; header policy checks (`header.present`: documented security headers only); error-response leak check (`body.not-match-leak-pattern`) on a documented-error request | method probes always safe methods; header checks only for headers the specification documents or the user configures | No undocumented status invented. |
| sensitive-business-flows | none by default | a user-defined policy, bounded actions and test data | Support is `limited`; V1 emits an observation and a limitation, not an executable scenario. |
| ssrf-unsafe-consumption | none | controlled callback verification (absent) | An observation lists URL-typed parameters as candidates and states the limit. |
| api-inventory | none (analysis-only) | | Observations only. |

## 4. Destructive classification

`destructive.flag = true` when any holds: the base operation is `POST`, `PUT`, `PATCH` or `DELETE`
(`DESTRUCTIVE_METHODS`, reused); the mutation is `identity.swap` or `path-id.substitute` on a non-safe method; the scenario creates data
and the profile's cleanup strategy is `none` (evaluated at run planning, flag raised in the preview, FR-045). `reasons[]` names
each cause. An edit can raise but never lower the flag.

## 5. Expected-behavior product rules (named)

| Rule id | Statement |
|---|---|
| `SL-REJECT-NOT-SUCCESS` | A request without valid authorization for an operation that requires it must not be processed as successful (no 2xx). |
| `SL-REJECT-CROSS-IDENTITY` | A request acting on another identity's resource without permission must not be processed as successful. |
| `SL-REJECT-PROTECTED-PROPERTY` | A request that sets a read-only or protected property must be rejected or must leave the property unchanged. |
| `SL-REJECT-CONSTRAINT-VIOLATION` | A request that violates a declared constraint must not be processed as successful. |
| `SL-REJECT-UNDOCUMENTED-METHOD` | A method the specification does not document for a path must not be processed as successful. |
| `SL-LIMIT-ENGAGED` | Repeated requests beyond a documented or configured threshold should engage the limit. |
| `SL-NO-LEAK-PATTERN` | A response must not contain a stack trace, server banner, internal path, SQL error or secret-shaped value. |

Where the specification documents a status for the situation the scenario cites it (`basis: documented`) and the condition
becomes `status.in-set` of the documented codes; otherwise the named rule applies and no status is invented.

## 6. Dedupe and bounds

Dedupe key: canonical JSON of `[operationKey, categoryId, mutations, expected.kind, conditions]`. First wins; contributing
rule ids are kept in `provenance`. Generation caps per operation and category are fixed in code (documented) so a
specification of 50 operations yields a reviewable number of scenarios (Principle XII); the response reports what a cap
omitted.
