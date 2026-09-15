# Feature Specification: Distinct-Credential Token Provisioning for Postman Export

**Feature Branch**: `021-multi-credential-token-provisioning`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "Admin/privileged-role token provisioning for generated Postman
collections. Problem: when an OpenAPI spec groups endpoints requiring an elevated/admin
credential (e.g. an \"Admin\" tag/folder), ApiPilot's Postman export currently has no dedicated
mechanism to (a) generate a request that obtains an admin-level token/credential, or (b)
provision an environment variable placeholder to hold that admin token separately from the
regular user {{token}} variable, so admin-only endpoints in the exported collection cannot be
authenticated without manual, undocumented workarounds. Scope this spec to: detecting operations
that require a distinct/elevated security context from the OpenAPI spec (e.g. a differently-named
security scheme, or a documented scope/role indicator), exporting a request (or reusing an
existing login/token operation with different credentials) that can obtain that elevated token,
and provisioning a distinct environment variable (e.g. {{adminToken}}) referenced by the auth
block of operations requiring it. This must stay consistent with existing specs 007
(postman-collection-generator), 016 (workflow-aware-postman), and 019
(auto-workflow-chaining), and must not fabricate business rules not evidenced in the OpenAPI
document."

## Clarifications

### Session 2026-09-14

- Q: How should the export decide that an operation needs a *different* credential from another
  operation, without inventing a role/admin concept the specification never states? → A: Use the
  security scheme's own declared name/key from `components.securitySchemes` (e.g. `bearerAuth`
  vs. `adminAuth`) as the sole signal. Two operations that reference the same scheme key always
  share one credential variable; two operations referencing different scheme keys of the same
  type (e.g. two `http`/`bearer` schemes) always get distinct variables. Tag names such as
  "Admin" are not used as a signal — they are cosmetic grouping (per spec 007's folder rules) and
  are not evidence of a distinct security requirement.
- Q: What happens when no operation in the specification appears able to *produce* a value for a
  distinct credential (no login/token-style operation is discoverable for it)? → A: Provision the
  environment variable placeholder for that credential (empty value, as spec 007 already does for
  `{{token}}`) and record a `GenerationLimitation` naming the scheme and the operations that need
  it, exactly as unmappable auth already does today. Do not fabricate a token-issuing request.
- Q: Should automatic chaining (spec 019) be extended so a discovered credential-producing
  operation's response is captured straight into the new distinct variable? → A: Yes, reuse the
  existing producer/consumer extraction mechanism (spec 019) with the consumer location widened
  to include the operation's auth block, not just path parameters (see dependent bug fix tracked
  outside this spec). This spec only defines *which* variable a distinct-credential operation's
  auth block must reference; wiring the value into it is the existing chaining mechanism's
  job once it supports non-path consumers.

### Session 2026-09-15

- Q: When a specification declares two or more distinctly-keyed schemes of the same type, which
  one keeps the legacy default variable name (`token`/`apiKey`/`username`+`password`), and which
  get scheme-key-derived names? → A: Declaration order. The first-declared scheme of a given type
  in `components.securitySchemes` (document key order) keeps the existing default name; every
  later same-type scheme derives its name from its own key. This makes the single-scheme case
  (FR-002) the one-element instance of this same rule, and matches the spec's own worked example
  (`bearerAuth` declared first stays `{{token}}`; `adminAuth` declared second becomes
  `{{adminToken}}`).
- Q: What exact rule turns a non-primary scheme's key into its variable name, e.g. `adminAuth` →
  `adminToken`? → A: Strip a case-insensitive trailing `Auth`/`Scheme` suffix from the key if
  present, then append the type-specific suffix already used today (`Token` for `http`/`bearer`,
  `ApiKey` for `apiKey`, `Username`/`Password` for `http`/`basic`). If the key has no such
  trailing suffix, the type-specific suffix is appended to the full key instead (e.g.
  `partnerCredential` → `partnerCredentialToken`).
- Q: For a distinct scheme with no operation the specification explicitly marks as its issuer,
  what signal should identify the one candidate operation that plausibly obtains that scheme's
  credential (User Story 2 / FR-006)? → A: Scheme-key stem match. A candidate is an unauthenticated
  operation whose path or `operationId` contains the scheme key's normalized stem (the key with
  its trailing `Auth`/`Scheme` suffix removed) as a case-insensitive substring. Zero or multiple
  matching unauthenticated operations means no candidate, falling back to FR-007. This is grounded
  solely in the scheme key already declared in the document, not an invented role/admin concept,
  and replaces FR-006's prior reference to an "existing naming convention" that does not actually
  exist anywhere in the current pipeline.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run Elevated-Privilege Requests Without Manual Variable Surgery (Priority: P1)

As a QA engineer exporting a Postman collection from a specification that declares more than one
bearer/apiKey/basic security scheme (for example a regular `bearerAuth` used by most endpoints and
a separate `adminAuth` used only by a handful of privileged endpoints), I want each distinct
scheme to get its own named environment variable in the exported collection, so that requests
needing the elevated credential don't silently reuse (and collide with) the regular `{{token}}`
variable, and so I know exactly which variable I need to populate to run them.

**Why this priority**: Without this, every operation secured by a second scheme still points at
`{{token}}` today (`authMapping.ts`), so setting the regular user's token to make most of the
collection work makes the "admin" requests fail with the wrong caller's identity instead of
failing informatively — the finding this spec responds to.

**Independent Test**: Export a collection from a spec whose `components.securitySchemes` declares
two `http`/`bearer` schemes (e.g. `bearerAuth`, `adminAuth`), where operation set A references only
`bearerAuth` and operation set B references only `adminAuth`. Verify the exported environment
contains two distinct variables (e.g. `{{token}}` and `{{adminToken}}`), and that set B's requests'
auth blocks reference the second variable, not the first.

**Acceptance Scenarios**:

1. **Given** a specification declaring two distinctly-named `http`/`bearer` security schemes,
   **When** the collection is exported, **Then** each scheme maps to its own credential variable
   (named deterministically from the scheme key), and every operation's auth block references the
   variable for the scheme it actually declares.
2. **Given** a specification declaring only one security scheme (the common case today), **When**
   the collection is exported, **Then** behavior is unchanged from the existing single-`{{token}}`
   output (no regression for the common case).
3. **Given** two distinctly-named `apiKey` schemes with the same header name but different scheme
   keys, **When** the collection is exported, **Then** each still receives its own variable rather
   than being merged because their header names collide.

---

### User Story 2 - Discover an Existing Request That Can Obtain the Elevated Credential (Priority: P2)

As a QA engineer, when the specification also documents an operation whose response plausibly
issues the distinct credential (for example, a second login/token endpoint under the same scheme
name, or one already identified as a producer for that scheme by dependency analysis), I want the
export to point that operation at the new distinct variable's producer role, rather than treating
it identically to the regular login endpoint, so the collection is more likely to run end-to-end
without hand-editing.

**Why this priority**: Reduces the manual setup burden identified in the finding, but is
secondary to User Story 1 — even without automatic discovery, a clearly-named empty placeholder
variable is already a correctness improvement over silent collision with `{{token}}`.

**Independent Test**: Export a spec containing `POST /auth/login` (issues `bearerAuth`) and
`POST /auth/admin-login` (issues `adminAuth`, per its declared `security`), plus an operation
under `adminAuth`. Verify the exported collection either (a) marks `POST /auth/admin-login` as
the credential-producing request for `{{adminToken}}` so chaining can wire it up, or (b), if no
such operation exists in the spec, falls through to the limitation behavior in User Story 3.

**Acceptance Scenarios**:

1. **Given** an unauthenticated operation whose path or `operationId` contains the distinct
   scheme's key stem (the scheme key with a trailing `Auth`/`Scheme` suffix removed) as the sole
   such match in the specification, **When** the collection is exported, **Then** that operation
   is identified as the scheme's credential producer for downstream chaining.
2. **Given** no operation in the specification can be identified as a producer for a distinct
   scheme, **When** the collection is exported, **Then** no request is fabricated, and behavior
   falls back to User Story 3.

---

### User Story 3 - Know Exactly What's Missing When Nothing Can Be Automated (Priority: P3)

As a QA engineer, when the export cannot find any operation that plausibly produces a distinct
credential, I want the generated collection to still contain the correctly-named, empty
environment placeholder plus a clear, itemized limitation explaining which scheme and which
operations need it, so I know precisely what manual step remains instead of guessing why a
request fails.

**Why this priority**: Preserves the project's explicit-failure principle — an unresolved
credential must be visible, not silently broken or hidden behind a generic error.

**Independent Test**: Export a spec with a distinct `adminAuth` scheme and no discoverable
producer operation for it. Verify the environment still declares the (empty) variable, and the
generation result includes a limitation entry naming the scheme and listing the operations that
depend on it.

**Acceptance Scenarios**:

1. **Given** a distinct security scheme with no discoverable producer operation, **When** the
   collection is exported, **Then** the environment contains the placeholder variable and the
   generation result records a limitation identifying the scheme name and the affected operations.

### Edge Cases

- What happens when the same operation declares alternative security requirements from *both* the
  regular and the distinct scheme (an `OR` of requirement sets)? Existing behavior (per
  `authMapping.ts`) already picks the first declared requirement set and records the remaining
  alternatives as a limitation; this spec does not change that precedence rule, only which
  variable the chosen scheme resolves to.
- What happens when three or more distinct scheme keys of the same type exist (not just two)?
  Each distinct key MUST still receive its own variable, named deterministically from the scheme
  key, with no fixed limit on the number of distinct credential variables.
- What happens when two scheme keys are textually different but semantically identical (e.g. an
  author declared `bearerAuth` and `BearerAuth` as separate keys by typo)? Out of scope — the
  scheme key is treated as an opaque identifier from the document; ApiPilot does not infer author
  intent behind naming choices (constitution: specification-grounded, no fabricated relationships).
- What happens when a discovered "producer" candidate operation (User Story 2) itself requires
  auth (so it can't plausibly be a login endpoint)? It MUST be excluded from consideration as a
  producer; only unauthenticated operations are eligible.
- What happens when a distinct scheme's key stem matches the path/`operationId` of more than one
  unauthenticated operation, or of none? No candidate producer is selected; the export falls back
  to the FR-007 limitation behavior for that scheme, exactly as when no candidate exists at all.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The export MUST derive one credential variable per distinct security scheme key
  declared in the specification's `components.securitySchemes`, not one variable per scheme
  *type*. Two schemes of the same type (`http`/`bearer`, `apiKey`, `http`/`basic`) with different
  keys MUST receive distinct variables.
- **FR-002**: When a specification declares exactly one scheme of a given type (the common case),
  the exported variable name(s) and auth block MUST be unchanged from current behavior (`token`,
  `apiKey`, or `username`/`password`), preserving backward compatibility with existing exports.
- **FR-003**: When a specification declares more than one distinctly-keyed scheme of the same
  type, the first such scheme declared in `components.securitySchemes` (document key order) MUST
  keep the existing default variable name(s) for that type (`token`, `apiKey`, or
  `username`/`password`), exactly as the single-scheme case (FR-002). Every subsequently-declared
  same-type scheme's variable name MUST be derived deterministically from its own scheme key: a
  case-insensitive trailing `Auth`/`Scheme` suffix is removed if present, then the type-specific
  suffix is appended (`Token` for `http`/`bearer`, `ApiKey` for `apiKey`, `Username`/`Password` for
  `http`/`basic`); if the key has no such trailing suffix, the type-specific suffix is appended to
  the full key instead (e.g. `adminAuth` → `adminToken`, `partnerCredential` →
  `partnerCredentialToken`). Re-exporting the same specification always yields the same variable
  names.
- **FR-004**: Every operation's generated auth block MUST reference the credential variable
  matching the specific scheme key that operation's `security` requirement declares, not a
  single shared variable, when more than one distinctly-keyed scheme of that type exists in the
  document.
- **FR-005**: The export MUST NOT use tag names, folder names, or path segments (e.g. an "Admin"
  tag) as a signal for provisioning a distinct credential; only the declared security scheme key
  is evidence of a distinct security requirement, per the clarification above.
- **FR-006**: The export MUST attempt to identify, for each non-first-declared distinct scheme, at
  most one candidate operation in the same specification that plausibly obtains that credential:
  an operation that (a) itself requires no authentication (so it is safe to call to obtain a
  token), and (b) whose path or `operationId` contains the scheme key's normalized stem (the
  scheme key with a trailing case-insensitive `Auth`/`Scheme` suffix removed, if present) as a
  case-insensitive substring. This heuristic is grounded solely in the scheme key already declared
  in the specification; it does not use tag names, folder names, or an invented role/admin concept
  (per FR-005). When zero or more than one unauthenticated operation matches a scheme's stem, the
  export MUST NOT guess; it MUST fall back to FR-007.
- **FR-007**: When no credential-producing operation can be identified for a distinct scheme, the
  export MUST still emit the (empty-valued) environment placeholder variable for that scheme and
  MUST record a `GenerationLimitation` naming the scheme key and listing every operation that
  depends on it, consistent with how unmappable auth schemes are already reported today.
- **FR-008**: This feature MUST NOT introduce an "Admin" role, folder, or grouping concept of its
  own. Any folder grouping remains the existing generic tag/path-based grouping defined in spec
  007; this spec only concerns credential *variables*, not collection structure.
- **FR-009**: Wiring a discovered producer operation's response value into the new distinct
  variable (rather than merely naming the variable and identifying the producer) is delivered by
  extending the existing automatic-chaining mechanism (spec 019) to support auth-block consumers;
  this spec defines the variable-naming and producer-identification contract that mechanism must
  target, and does not itself modify the chaining engine.

### Key Entities

- **Security Scheme Key**: The identifier under which a security scheme is declared in
  `components.securitySchemes` (e.g. `bearerAuth`, `adminAuth`). Existing entity in the OpenAPI
  document; this feature uses it as the sole grouping key for credential variables.
- **Credential Variable**: An environment variable (existing `ArtifactVariable` concept from spec
  007) holding a bearer token, API key, username, or password. This feature extends the existing
  single default (`token`/`apiKey`/`username`/`password`) to one variable set per distinct scheme
  key.
- **Credential Producer Candidate**: An operation identified as capable of obtaining a given
  scheme's credential — it requires no auth itself, and its path or `operationId` uniquely matches
  the scheme key's normalized stem (per FR-006). Distinct from, but feeding into, the existing
  producer/consumer chaining concept from specs 008 and 019, which (once extended per FR-009)
  wires the candidate's response value into the credential variable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For specifications declaring a single security scheme per type (today's common
  case), 100% of existing exports produce byte-for-byte identical variable names and auth blocks
  to current behavior.
- **SC-002**: For a specification declaring two or more distinctly-keyed schemes of the same
  type, 100% of operations reference the credential variable matching their own declared scheme,
  with zero operations left pointing at the wrong scheme's variable.
- **SC-003**: When a distinct scheme has no discoverable producer operation, the export always
  reports exactly one limitation entry per unresolved scheme, naming the scheme and every
  dependent operation, so a QA engineer can identify the remaining manual step without inspecting
  generator internals.

## Assumptions

- The specification declares its security schemes under `components.securitySchemes` using
  OpenAPI 3.x conventions already parsed by `backend/src/openapi/`; no new parsing capability is
  assumed.
- "Elevated" or "admin" is a QA/business interpretation of *some* distinctly-keyed scheme; this
  spec deliberately avoids modeling roles/privilege levels and instead treats every distinctly-
  keyed scheme uniformly, so the same mechanism serves an "admin" scheme, a "partner" scheme, or
  any other second credential without special-casing a name.
- Automatic chaining's extension to auth-block consumers (referenced in FR-009) is tracked as a
  separate, already-identified bug fix outside this spec's scope; this spec is satisfiable on its
  own by correct variable naming, auth-block referencing, and limitation reporting even before
  that extension lands.
- Existing behavior for a single declared scheme per type must not regress; this is treated as a
  hard constraint (SC-001), not a nice-to-have.
