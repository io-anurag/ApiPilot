# Feature Specification: Automatic Auth-Credential Chaining

**Feature Branch**: `023-auto-auth-credential-chaining`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "QA feedback on a generated Postman export found that a token or API
key obtained from one operation's response (e.g. `POST /auth/token`, `POST /auth/api-key`) never
reaches the Authorization header of the other operations that need it (e.g. `GET
/auth/token-info`), so every request needing that credential fails until an engineer manually
copies a real value into the environment. Root cause: the dependency graph (008) that automatic
chaining (019) reads from has no concept of an operation's declared security requirement as a
consumer at all — `extractConsumerFields` only turns declared request parameters and body fields
into consumer candidates, and a bearer/basic/apiKey requirement lives in `operation.security`, not
`operation.parameters`. Extend the dependency data model, the deterministic matching pass, and the
automatic-chaining renderer so a credential obtained from one operation's response is captured and
substituted into the Authorization configuration of the operations that declare the matching
security scheme — reusing the credential-variable naming and producer-identification contract
already defined in specs/021-multi-credential-token-provisioning, and the existing chaining
mechanism from specs/008-dependency-workflow-engine and specs/019-auto-workflow-chaining — without
fabricating a relationship the specification does not evidence."

## Clarifications

### Session 2026-09-14

- Q: How should the system represent "this operation requires a credential" as something the
  dependency graph can reason about, given today's `DependencyFieldLocation` (`path`, `query`,
  `header`, `body`) only describes a *declared request parameter or body field*, and a security
  requirement is neither? → A: Add a new location value, `"auth"`. A consumer `FieldRef` with
  `location: "auth"` represents one operation's declared security-scheme requirement, and its
  `field` names the security scheme key from `components.securitySchemes` (e.g. `bearerAuth`), not
  a parameter or body field name. This is additive to the existing union; no existing consumer of
  `DependencyFieldLocation` changes behavior for the three existing values.
- Q: The existing deterministic matching pass (`fieldsNameMatch` in `deterministicMatching.ts`)
  connects a producer and consumer by comparing field *names* (exact match, or one side "id" and
  the other id-shaped). Should credential matching reuse that same name-based heuristic? → A: No —
  matching a response body field to a security scheme by name would be both too strict (a login
  response's token field is rarely literally named after the scheme key, e.g. `bearerAuth`) and too
  loose (an unrelated field coincidentally named `token` would match). Instead, reuse the
  Credential Producer Candidate concept already specified in
  specs/021-multi-credential-token-provisioning (FR-006): for each distinct security scheme, at
  most one operation that itself requires no authentication is eligible to produce that scheme's
  credential. When exactly one such candidate exists in the standalone scenario set and its
  response documents exactly one field of a plausible credential shape (a string field, per the
  scheme's type: any string field for `apiKey`/`basic`, a string field for `http`/`bearer`), that
  field becomes the relationship's producer; when more than one field qualifies or no candidate
  exists, no relationship is created and the existing spec 021 FR-007 limitation reporting applies
  instead of a guess.
- Q: Once a credential relationship is confirmed and its response value captured into a chain
  variable, how does an operation's *rendered* auth block end up referencing that variable instead
  of the static `{{token}}`/`{{apiKey}}` `authMapping.ts` emits today? → A: `authMapping.ts`'s
  output already names the variable deterministically from the security scheme key
  (specs/021-multi-credential-token-provisioning FR-001-004: `{{token}}` for the sole/default
  scheme, `{{<schemeKey>Token}}`/`{{<schemeKey>ApiKey}}` for an additional distinctly-keyed scheme).
  This feature's chain variable (produced by the existing `workflowVariableName` mechanism) is
  renamed to exactly that same credential-variable name when a chain resolves an "auth" consumer,
  so the operation's already-emitted auth block (referencing that name) needs no separate rewrite —
  the chain simply populates the variable the auth block was always going to reference.

### Session 2026-09-15

- Q: Should credential-producer discovery (specs/021-multi-credential-token-provisioning FR-006)
  be extended to cover the primary/default security scheme of each type too, not only
  non-first-declared ones, given `credentialProducers.ts` as shipped skips every `isPrimary` scheme
  entirely, while this spec's own User Story 1 (a login endpoint feeding the default `{{token}}`
  variable) is exactly the primary-scheme case? -> A: Yes -- this spec extends specs/021 FR-006's
  producer-candidate discovery to the primary (first-declared-per-type) scheme as well as every
  non-first-declared scheme, using the identical eligibility rule for both. Without this extension,
  User Story 1's own worked example could never be resolved by this feature.
- Q: Once the primary scheme is in scope for producer discovery, what identifies its sole candidate
  operation, given specs/021 FR-006's heuristic (the operation's path or `operationId` containing
  the scheme key's own normalized stem) was designed to tell a *second* scheme apart from the
  first, not to recognize a login endpoint by convention -- and a stem like `bearer` (from
  `bearerAuth`) will often not appear in a login endpoint's path (e.g. `POST /auth/token`)? -> A:
  Reuse the identical stem-match heuristic for the primary scheme, with no relaxed or
  name-convention-based fallback (e.g. matching generic words like "token" or "login"). Whether a
  given specification's login endpoint is found therefore depends on how its author named the
  security scheme key. When the stem-match yields zero or multiple candidates for the primary
  scheme, the existing specs/021 FR-007 unresolved-credential limitation applies exactly as it
  already does for secondary schemes -- this feature never falls back to guessing from a generic
  naming convention.
- Q: Given specs/021's `credentialProducers.ts` already explicitly declines producer-candidate
  discovery for `http`/`basic` schemes (a single response field cannot represent a
  username+password pair without fabricating which field is which), is `http`/`basic` actually in
  scope for this feature's automatic credential capture? -> A: No -- `http`/`basic` keeps specs/021's
  existing exclusion unchanged; this feature does not introduce a two-field matching heuristic for
  it. A `http`/`basic`-scheme operation still correctly gets an `auth`-location consumer field
  (FR-001), so it is represented in the dependency graph and reported accurately, but no producer
  relationship is ever created for a `http`/`basic` scheme -- it always falls through to the existing
  specs/021 FR-007 unresolved-credential limitation. The Assumptions bullet listing `http`/`basic`
  in this spec's scope means the `"auth"` location model treats it uniformly, not that it is
  auto-captured.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Token Obtained From Login Reaches Every Request That Needs It (Priority: P1)

As a QA engineer, when my approved scenarios include an operation that returns a bearer token
(e.g. `POST /auth/token`) and other operations that declare the matching bearer security scheme
(e.g. `GET /auth/token-info`), I want the exported collection to capture the token from the
producing response and substitute it into the `{{token}}` variable those operations' Authorization
headers already reference, so the collection runs end-to-end immediately after import instead of
failing every authenticated request until I manually paste in a real token.

**Why this priority**: This is the entire premise of the request — without it, essentially every
authenticated operation in a freshly exported collection fails on first run, which is exactly the
finding this spec responds to (`GET /auth/token-info`, and any other bearer-authenticated
operation).

**Independent Test**: Export an approved scenario set containing a positive scenario for an
unauthenticated token-issuing operation whose response documents exactly one plausible credential
field, plus a scenario for an operation declaring the matching bearer security scheme. Verify the
producing request's test script captures that field into the `{{token}}` variable and the
consuming request's Authorization configuration resolves to a real value at runtime — with no
"unresolved credential" limitation recorded for that operation pair.

**Acceptance Scenarios**:

1. **Given** an unauthenticated operation that is the sole credential-producer candidate for a
   bearer scheme (per specs/021 FR-006), and its approved positive scenario's documented response
   contains exactly one plausible credential field, **When** the collection is exported, **Then**
   the producing request's test script extracts that field into the scheme's credential variable,
   and every operation declaring that scheme no longer appears in the unresolved-credential
   limitation list.
2. **Given** the same setup, **When** the exported collection is run in order (producer before
   consumers, as the ordering guard already requires for path-parameter chaining), **Then** every
   consuming request's Authorization header carries the captured value.

---

### User Story 2 - A Distinct (e.g. Second) Credential Chains Independently (Priority: P2)

As a QA engineer working with a specification that declares more than one distinctly-keyed
security scheme (per specs/021-multi-credential-token-provisioning), I want each scheme's
credential to be captured and chained independently, so a second credential (whatever its
business meaning) is resolved the same way the primary one is, without the two colliding.

**Why this priority**: Directly extends specs/021's variable-naming contract to the chaining
mechanism; secondary because it only matters once a specification actually declares more than one
distinctly-keyed scheme.

**Independent Test**: Export a specification declaring two distinctly-keyed bearer schemes, each
with its own unauthenticated producer candidate and its own consumers. Verify each scheme's
consumers reference and receive only their own scheme's captured variable, never the other
scheme's.

**Acceptance Scenarios**:

1. **Given** two distinctly-keyed security schemes each with an identifiable producer candidate,
   **When** the collection is exported, **Then** two independent chains are recorded, each
   populating only its own scheme's credential variable.

---

### User Story 3 - Ambiguity Is Reported, Never Guessed (Priority: P3)

As a QA engineer, when the export cannot uniquely identify a credential-producing operation or a
single plausible credential field on its response, I want the existing unresolved-credential
limitation (specs/021 FR-007) to remain in place exactly as today, rather than the system guessing
at a wrong field or a wrong producer.

**Why this priority**: Preserves the no-fabrication principle; without this guarantee, an
incorrect automatic chain would be worse than today's explicit manual-fill-in gap because it would
look resolved while silently sending the wrong value.

**Independent Test**: Export a specification where a security scheme's only unauthenticated
candidate operation documents two equally plausible string fields in its response (e.g. `token`
and `refreshToken`). Verify no chain is created for that scheme and the specs/021 FR-007
limitation is recorded unchanged.

**Acceptance Scenarios**:

1. **Given** a producer candidate whose response documents more than one plausible credential
   field, **When** exported, **Then** no automatic chain is created for that scheme, and the
   existing unresolved-credential limitation is recorded.
2. **Given** more than one operation that could plausibly serve as a scheme's producer candidate
   (ambiguous per specs/021 FR-006), **When** exported, **Then** no automatic chain is created, and
   the existing limitation is recorded.

### Edge Cases

- What happens when the same operation is both a security-scheme requirement's consumer *and* the
  producer for a different scheme (e.g. an admin-login endpoint that itself requires a base
  token)? The producer-eligibility rule from specs/021 FR-006 (producer candidate must itself
  require no authentication) already excludes this case from being treated as a producer for the
  *other* scheme; it still participates normally as a consumer of whichever scheme it does require.
- What happens when a credential-producing operation's positive scenario is rejected (not part of
  the approved/standalone set)? No chain is created for that scheme, consistent with how
  path-parameter chaining already requires the producer's positive scenario to be present
  (`automaticChaining.ts`'s `positiveProducerScenario`).
- What happens when `ExportOptions.disableAutomaticChaining` is set? Per spec 019 FR-011, the
  existing flag already disables automatic chaining for the whole export; this feature does not
  introduce a second, separate flag — auth-credential chaining is disabled by the same flag.
- What happens with an ordering conflict (a consumer scenario emitted before its would-be
  producer)? The existing FR-015 ordering guard in `automaticChaining.ts` (never reorder the
  collection to make a chain work; decline instead) applies unchanged to auth-credential chains.
- What happens when the primary scheme's login endpoint's path/`operationId` does not contain the
  scheme key's own stem (e.g. scheme key `bearerAuth`, endpoint `POST /auth/token`)? No candidate
  is identified via the stem-match rule (FR-002), and the existing specs/021 FR-007
  unresolved-credential limitation is recorded for that scheme; this feature does not fall back to
  a looser, name-convention heuristic.
- What happens for operations that declare a `http`/`basic` scheme? They still receive an
  `auth`-location consumer field (FR-001) so they are represented in the dependency graph, but per
  FR-002a no producer relationship is ever created for `http`/`basic`; the specs/021 FR-007
  limitation always applies to it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The shared dependency data model MUST gain a new `DependencyFieldLocation` value,
  `"auth"`, representing an operation's declared security-scheme requirement as a consumer field,
  whose `field` names the security scheme key. This is additive; the three existing location
  values' behavior MUST NOT change.
- **FR-002**: For each `http`/`bearer` and `apiKey` security scheme declared by the specification —
  including the primary (first-declared-per-type) scheme, not only non-first-declared ones (per
  the Clarifications above, extending specs/021-multi-credential-token-provisioning FR-006's
  discovery scope) — the system MUST identify at most one credential-producer candidate operation,
  using exactly the eligibility rule already defined in specs/021 FR-006: the operation requires no
  authentication itself, and its path or `operationId` contains the scheme key's normalized stem as
  a case-insensitive substring. No relaxed or name-convention-based fallback (e.g. matching generic
  words like "token" or "login") is used for the primary scheme; the same strict rule applies to
  every scheme uniformly.
- **FR-002a**: `http`/`basic` security schemes MUST NOT participate in credential-producer-candidate
  discovery or automatic credential-chain creation, consistent with specs/021's existing exclusion
  (a single response field cannot represent a username+password pair without fabricating which
  field is which). A `http`/`basic`-scheme operation still gets an `auth`-location consumer field
  (FR-001) so it is represented in the dependency graph and reported accurately, but no chain is
  ever created for it; it always falls through to the specs/021 FR-007 unresolved-credential
  limitation.
- **FR-003**: When a producer candidate's approved positive scenario's documented response
  contains exactly one field of a plausible credential shape (a string-typed field), the system
  MUST treat that field as the scheme's producer field for a dependency relationship whose consumer
  side is every operation declaring that scheme (`location: "auth"`, `field: <schemeKey>`).
- **FR-004**: When a producer candidate's response documents zero or more than one plausible
  credential field, the system MUST NOT create a relationship for that scheme, and MUST leave the
  existing specs/021 FR-007 unresolved-credential limitation as the reported outcome.
- **FR-005**: The automatic-chaining renderer (specs/019) MUST accept `"auth"`-location consumers
  as eligible, subject to the same CONFIRMED/LIKELY confidence, cycle, rejection, and ordering
  (FR-015) guards it already applies to path-parameter consumers.
- **FR-006**: When an auth-credential chain is applied, the variable it populates MUST be exactly
  the credential variable name `authMapping.ts` already emits for that security scheme (per
  specs/021 FR-001-004: `token`/`apiKey`/`username`+`password` for the sole scheme of a type, or
  the scheme-key-derived name for an additional distinctly-keyed scheme) — never a separate
  chain-scoped name a consuming operation's auth block does not already reference.
- **FR-007**: Applying an auth-credential chain MUST NOT alter which operations are treated as
  requiring which security scheme, nor any operation's auth block structure — it only supplies a
  value for a variable that structure already references.
- **FR-008**: This feature MUST NOT introduce a second opt-out flag; `ExportOptions
  .disableAutomaticChaining` (specs/019 FR-011) continues to govern both path-parameter and
  auth-credential automatic chaining.
- **FR-009**: When an auth-credential chain is applied, the export's chain/limitation reporting
  (specs/019 FR-010, specs/021 FR-007) MUST reflect the outcome exactly as today's path-parameter
  chains and unresolved-credential limitations are reported, so an engineer sees one consistent
  provenance/limitation model regardless of which mechanism resolved (or failed to resolve) a
  variable.

### Key Entities

- **Auth Consumer Field**: A `FieldRef` with `location: "auth"`, `field` set to a security scheme
  key, representing every operation that declares that scheme as a dependency-graph consumer.
  New concept, additive to the existing `FieldRef`/`DependencyFieldLocation` model (spec 008).
- **Credential Producer Candidate**: Entity from specs/021-multi-credential-token-provisioning
  FR-006/002, reused as the source of producer eligibility here with its discovery scope extended
  (per the Clarifications above) to the primary scheme of each type, not only non-first-declared
  ones; `http`/`basic` schemes remain excluded per FR-002a.
- **Auth-Credential Relationship**: An `ApiDependencyRelationship` whose consumer side is an Auth
  Consumer Field and whose producer side is a Credential Producer Candidate's uniquely-identified
  response field.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a specification with an unambiguous single-field credential-producing operation
  and one or more operations declaring the matching scheme, 100% of those consuming operations no
  longer appear in the unresolved-credential limitation list after export.
- **SC-002**: For a specification declaring two or more distinctly-keyed schemes each with an
  unambiguous producer, each scheme's consumers receive only that scheme's captured value — zero
  cross-scheme leakage.
- **SC-003**: For every case where producer or field identification is ambiguous, zero automatic
  chains are created and the existing limitation reporting is preserved unchanged — no fabricated
  or guessed wiring.
- **SC-004**: Re-exporting the same approved input continues to produce byte-for-byte identical
  artifacts (determinism is not regressed).

## Assumptions

- specs/021-multi-credential-token-provisioning lands (or is implemented alongside this feature),
  since this spec directly reuses its credential-variable-naming and producer-eligibility contract
  rather than redefining either.
- "Plausible credential shape" (FR-003/004) is deliberately narrow (a string-typed response field)
  to avoid guessing at a numeric or boolean field as a credential; a specification whose actual
  token field is nested inside a non-string wrapper is out of scope and falls through to the
  existing limitation.
- This feature's `"auth"`-location consumer model (FR-001) covers `http`/`bearer`, `http`/`basic`,
  and `apiKey` schemes uniformly, consistently with specs/021's scope; it does not add OAuth2/OIDC
  flow support, which remains explicitly unmapped per `authMapping.ts`'s existing, deliberate scope
  limit. Automatic credential *capture and chaining*, however, applies only to `http`/`bearer` and
  `apiKey` schemes (FR-002/FR-002a) — `http`/`basic` is represented but never auto-chained, per the
  Clarifications above.
- Body-located and query-located auth-adjacent consumers (e.g. an API key expected as a query
  parameter already covered by `isSecurityCoveredParameter`'s exclusion) are handled by the new
  `"auth"` location uniformly; this feature does not need a separate location per security-scheme
  `in` value.
