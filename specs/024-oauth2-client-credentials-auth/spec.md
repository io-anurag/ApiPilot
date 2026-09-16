# Feature Specification: OAuth2 Client-Credentials Auth Support for Postman Export

**Feature Branch**: `024-oauth2-client-credentials-auth`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "Add OAuth2 client-credentials security-scheme support to the
Postman collection generator's auth mapping, so a specification that declares an OAuth2
(clientCredentials flow) security scheme gets a properly configured credential mechanism in the
exported collection/environment instead of today's 'unsupported-auth-scheme' limitation with no
credential variables at all. Motivated by a real-spec validation pass against
backend/tests/fixtures/openapi/paypal-invoicing-v2.yaml, which declares an `Oauth2` scheme with a
`clientCredentials` flow (`tokenUrl`, `scopes`) that `authMapping.ts`'s `classifySchemeType`
(only recognizing http/bearer, http/basic, and apiKey) cannot classify, so all 22 operations
requiring it fall through to the 'unsupported-auth-scheme' limitation and the exported environment
ends up with only `baseUrl` — no credential variable at all. `PostmanAuth`
(packages/shared-domain/src/postmanArtifact.ts) is a closed union of `bearer`/`basic`/`apikey`
today, with no oauth2 variant. Scope this iteration to the `clientCredentials` flow only —
`authorizationCode`/`implicit` require an interactive browser redirect this export can never
script, and `password` is a discouraged grant deferred to a possible future iteration. A specific
architectural subtlety: this app's own execution engine (`backend/src/execution/newmanRunner.ts`)
calls Newman's `run()` API directly in-process, not through Postman's desktop GUI — and Newman
does not perform the OAuth2 token exchange automatically the way Postman's GUI 'Get New Access
Token' helper does merely because a collection's auth block has type oauth2. This raises two
product decisions that must be resolved before planning, not assumed: how the shared `PostmanAuth`
contract represents an oauth2 scheme, and whether this iteration only labels/provisions credential
variables for manual token acquisition, or also automates the token fetch end-to-end through the
existing credential-producer/automatic-chaining mechanism so this app's own execution engine can
authenticate without a human pasting in a token."

## Clarifications

### Session 2026-09-16

- Q: How should the shared `PostmanAuth` contract represent a classified OAuth2
  `clientCredentials` scheme? → A: Add a real, distinct `oauth2` variant to the existing closed
  union (additive to `bearer`/`basic`/`apikey`), mirroring Postman's own collection auth shape,
  rather than disguising it as an `apikey` block. Any current or future frontend consumer of
  `PostmanAuth` that switches on `type` gains a new case to handle; none of the three existing
  cases change shape or meaning.
- Q: How far does this iteration automate obtaining the access token? → A: Fully — this feature
  wires an automatic client-credentials token fetch into the export, not just labeling/variable
  provisioning. Unlike the existing bearer/apiKey credential-chaining feature
  (specs/021/023), which must *discover* an ambiguous, spec-internal candidate operation as the
  credential's producer, this case has no such ambiguity: the OAuth2 security scheme's own
  `flows.clientCredentials.tokenUrl` is the authoritative, explicitly declared source of the token
  endpoint. The export therefore always synthesizes a token-fetch request from that declared value
  whenever an approved scenario requires the scheme — there is no "candidate not found" case
  parallel to specs/021 FR-007 for this mechanism, and no heuristic matching is needed.
- Q: Does `ExportOptions.disableAutomaticChaining` (specs/019 FR-011) suppress the synthesized
  token-fetch request? → A: No. That flag governs discovered chains *between approved scenarios*
  (path-parameter chaining, bearer/apiKey credential chaining from specs/021/023). The token-fetch
  request is synthesized directly from the security scheme's own declaration, not discovered
  between scenarios, so it stays included regardless of that flag — an engineer disabling chaining
  for an unrelated reason (e.g. debugging path-parameter chaining) does not unexpectedly lose
  OAuth2 automation too.
- Q: How should the synthesized token-fetch request authenticate the client ID and secret to the
  token endpoint? → A: HTTP Basic auth header (`Authorization: Basic base64(clientId:clientSecret)`),
  with the request body carrying only `grant_type=client_credentials` and, when scopes are
  declared, `scope`. This is RFC 6749's own default expectation and is specifically what the
  motivating PayPal specification's `/v1/oauth2/token` endpoint requires — body-embedded
  credentials (without Basic auth) are not used, so the feature works against the real API that
  motivated it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An OAuth2 Client-Credentials Scheme Is Recognized, Not Flagged Unsupported (Priority: P1)

As a QA engineer whose OpenAPI specification declares an OAuth2 security scheme using the
`clientCredentials` flow (e.g. PayPal's Invoicing API), I want the exported Postman collection and
environment to represent that scheme with real credential variables instead of the current
"unsupported-auth-scheme" limitation and an environment that only contains `baseUrl`, so I have a
concrete, correctly-labeled place to put my client ID and secret rather than no mechanism at all.

**Why this priority**: This is the entire premise of the request — without it, every operation
protected by a declared OAuth2 `clientCredentials` scheme exports with no credential mechanism
whatsoever, which is exactly the gap the PayPal validation pass surfaced across all 22 of its
operations.

**Independent Test**: Export an approved scenario set for a specification whose only security
scheme is OAuth2 with a `clientCredentials` flow (real `tokenUrl` and declared scopes). Verify no
"unsupported-auth-scheme" limitation is recorded for that scheme, and the exported environment
provisions a client-ID and client-secret variable (empty placeholders) instead of only `baseUrl`.

**Acceptance Scenarios**:

1. **Given** a specification declaring exactly one OAuth2 `clientCredentials` scheme, **When**
   the collection is exported, **Then** the "unsupported-auth-scheme" limitation is no longer
   recorded for any operation requiring that scheme.
2. **Given** the same specification, **When** the collection is exported, **Then** the environment
   artifact provisions a client-ID and a client-secret variable (empty values, consistent with how
   today's `{{token}}`/`{{apiKey}}` placeholders are provisioned) named per the existing
   scheme-key-derived naming convention (specs/021-multi-credential-token-provisioning).
3. **Given** the scheme's `clientCredentials` flow declares a `tokenUrl` and one or more scopes,
   **When** the collection is exported, **Then** the `tokenUrl` and scopes appear in the export
   verbatim (as a variable, auth configuration field, or README content) — never fabricated or
   guessed when the specification's own declared value is available.

---

### User Story 2 - The Exported Collection Authenticates Without a Manual Token-Paste Step (Priority: P1)

As a QA engineer, once I fill in the real client ID and client secret for a classified OAuth2
`clientCredentials` scheme, I want the exported collection to obtain its own access token and
authenticate every request requiring that scheme automatically when the collection runs — whether
run through this app's own execution engine or through Postman/Newman directly — so I never have
to manually obtain and paste in a token before a run succeeds.

**Why this priority**: This is the actual value the clarification session selected (full
automation, not just labeling) — without it, User Story 1's correctly-labeled scheme would still
require the same manual workaround engineers face today for every other unmappable scheme.

**Independent Test**: Supply real client-ID/client-secret values for a classified OAuth2
`clientCredentials` scheme whose `tokenUrl` is reachable. Run the exported collection (via this
app's own execution engine and, separately, via Newman directly). Verify a token-fetch request
executes before any request requiring that scheme, and every such request's Authorization header
carries a valid token with no manual step in between.

**Acceptance Scenarios**:

1. **Given** an approved scenario set containing at least one operation that requires a classified
   OAuth2 `clientCredentials` scheme, **When** the collection is exported, **Then** the export
   includes a synthesized token-fetch request for that scheme, built from its own declared
   `tokenUrl` and scopes, positioned to run before every request requiring that scheme.
2. **Given** real values are supplied for that scheme's client-ID/client-secret variables and the
   `tokenUrl` is reachable, **When** the collection is run in order, **Then** the token-fetch
   request succeeds and captures the resulting access token into the variable every dependent
   request's Authorization configuration already references — no separate manual step.
3. **Given** no approved scenario requires a given classified OAuth2 scheme, **When** the
   collection is exported, **Then** no token-fetch request is synthesized for that scheme (no
   unused artifact).
4. **Given** the token-fetch request fails at run time (unreachable `tokenUrl`, or the supplied
   client ID/secret are rejected), **When** the collection is run, **Then** every dependent
   request visibly fails authentication in the run results — the export does not retry, does not
   substitute a fallback, and does not obscure that the token-fetch step failed.

---

### User Story 3 - Non-Automatable OAuth2 Flows Keep Today's Honest Limitation (Priority: P2)

As a QA engineer whose specification declares OAuth2 using `authorizationCode`, `implicit`, or
`password`, I want the export to keep reporting today's "unsupported-auth-scheme" limitation
exactly as it does now, so I am not misled into thinking a flow this export cannot script has been
handled.

**Why this priority**: Directly protects the no-fabrication principle this codebase already
follows for every other unmappable scheme — secondary because it is a non-regression guarantee
rather than new capability.

**Independent Test**: Export a specification declaring an OAuth2 scheme with an
`authorizationCode` (or `implicit`, or `password`) flow. Verify the "unsupported-auth-scheme"
limitation is still recorded for every operation requiring it, identically to today's behavior.

**Acceptance Scenarios**:

1. **Given** a specification declaring an OAuth2 scheme whose only flow is `authorizationCode` or
   `implicit`, **When** exported, **Then** the "unsupported-auth-scheme" limitation is recorded for
   every operation requiring that scheme, exactly as today.
2. **Given** a specification declaring an OAuth2 scheme whose only flow is `password`, **When**
   exported, **Then** the "unsupported-auth-scheme" limitation is recorded for every operation
   requiring that scheme (this iteration does not extend support to `password`).

### Edge Cases

- What happens when an OAuth2 scheme declares more than one flow (e.g. both `clientCredentials`
  and `authorizationCode` on the same scheme object)? The scheme is still classified as supported
  via its `clientCredentials` flow (FR-001); the other declared flow on the same scheme object is
  not separately reported as unsupported, since the scheme as a whole now has a working mechanism.
- What happens when the `clientCredentials` flow declares no `scopes` at all (an empty object)?
  The export proceeds with no scope value populated anywhere — an empty declared value is not
  treated as a missing/error case, and no scope is fabricated.
- What happens when a specification declares both an OAuth2 `clientCredentials` scheme and an
  `http`/`bearer` or `apiKey` scheme? Each scheme is classified, named, and provisioned
  independently, following the existing distinct-credential naming rules
  (specs/021-multi-credential-token-provisioning) — same as any two distinctly-keyed schemes of
  different types today.
- What happens when re-exporting the same approved input? The output remains byte-for-byte
  identical (constitution: reproducible execution) — no timestamp, random token, or environment-
  dependent value is introduced by this feature.
- What happens when the declared `tokenUrl` is relative (e.g. `/v1/oauth2/token`, as in the
  motivating PayPal specification) rather than an absolute URL? It is resolved against the same
  base URL variable every other request in the export already uses — never against a fabricated
  or hard-coded host.
- What happens when two or more approved operations require the *same* OAuth2 scheme? Exactly one
  token-fetch request is synthesized for that scheme (not one per dependent operation), positioned
  to run before all of them.
- What happens across multiple runs of a long-lived collection where a fetched token could expire
  mid-run? Out of scope for this iteration — the token-fetch request runs once per collection run,
  with no refresh/retry logic; a mid-run expiry surfaces as an ordinary authentication failure on
  whichever request encounters it, the same as any other runtime auth failure (User Story 2,
  Acceptance Scenario 4).
- What happens if the export's automatic-chaining feature is disabled for the run
  (`ExportOptions.disableAutomaticChaining`, specs/019 FR-011)? Per FR-008, that flag does not
  suppress the token-fetch request — unlike bearer/apiKey credential chaining (specs/021/023), it
  is not a discovered chain between two approved scenarios, but synthesized directly from the
  security scheme's own declaration, so it remains included.
- What happens when the specification's token endpoint only accepts body-embedded client
  credentials rather than HTTP Basic auth? Out of scope for this iteration (FR-004c fixes HTTP
  Basic auth as the sole client-authentication method); such a provider's token-fetch request
  would fail authentication, surfacing via FR-004b exactly like any other rejected credential —
  no fallback to a second auth method is attempted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST classify an OAuth2 security scheme that declares a `clientCredentials`
  flow as a supported scheme, reading its `tokenUrl` and `scopes` verbatim from the specification.
  An OAuth2 scheme whose only declared flow(s) are `authorizationCode`, `implicit`, or `password`
  MUST continue to produce today's "unsupported-auth-scheme" limitation unchanged (no regression
  for those flows; `password` support is explicitly deferred, not added, by this feature).
- **FR-002**: For each classified OAuth2 `clientCredentials` scheme, the system MUST provision a
  client-ID and a client-secret credential variable (empty placeholder values, the same pattern
  used for today's `{{token}}`/`{{apiKey}}`/`{{username}}`+`{{password}}` variables), plus a
  distinct access-token variable that every dependent operation's Authorization configuration
  references — all named following the existing scheme-key-derived naming convention
  (specs/021-multi-credential-token-provisioning FR-001-004) so a primary vs. a distinctly-keyed
  additional OAuth2 scheme are named consistently with how other scheme types already are.
- **FR-003**: The shared `PostmanAuth` contract (packages/shared-domain/src/postmanArtifact.ts)
  MUST gain a new, distinct `oauth2` variant — additive to the existing `bearer`/`basic`/`apikey`
  cases, which MUST NOT change shape or meaning. The new variant identifies the auth block as
  OAuth2-derived and references the credential variables FR-002 provisions, rather than disguising
  the scheme as an `apikey` block.
- **FR-004**: For each classified OAuth2 `clientCredentials` scheme that at least one approved
  scenario requires, the system MUST synthesize exactly one token-fetch request — built directly
  from that scheme's own declared `tokenUrl` and scopes, using the client-ID/client-secret
  variables (FR-002) as its credentials — and include it in the export, positioned to run before
  every request requiring that scheme. No candidate-discovery or ambiguity-resolution step is
  needed (unlike specs/021/023's bearer/apiKey credential-producer discovery): the scheme's own
  `tokenUrl` is the sole, authoritative, always-present source.
- **FR-004a**: The token-fetch request's successful response MUST have its access token captured
  into the same access-token variable (FR-002) every dependent request's Authorization
  configuration already references, so that configuration needs no separate rewrite once the
  value is populated — mirroring how specs/023 FR-006/FR-007 already populate an existing
  reference rather than rewriting it.
- **FR-004b**: When the token-fetch request fails at run time (unreachable `tokenUrl`, or rejected
  client-ID/client-secret), every dependent request's authentication MUST visibly fail in the run
  results. This feature MUST NOT retry the token fetch, substitute a fallback credential, or
  otherwise obscure that the token-fetch step failed. Refreshing a token that expires mid-run is
  explicitly out of scope.
- **FR-004c**: The token-fetch request MUST authenticate the client ID and secret to the token
  endpoint using an HTTP Basic auth header (`Authorization: Basic base64(clientId:clientSecret)`),
  with the request body carrying only `grant_type=client_credentials` and, when the scheme
  declares scopes (FR-005), `scope` — never embedding the client secret in the request body. This
  matches RFC 6749's own default client-authentication expectation and is specifically what the
  motivating PayPal specification's token endpoint requires.
- **FR-005**: Every scope declared under the scheme's `clientCredentials` flow MUST be included in
  the token-fetch request's grant verbatim — never a fabricated scope added, and never a declared
  scope silently dropped.
- **FR-006**: This feature MUST NOT change how any existing supported scheme type
  (`http`/`bearer`, `http`/`basic`, `apiKey`) is classified, named, or provisioned.
- **FR-007**: Re-exporting the same approved input MUST continue to produce a byte-for-byte
  identical artifact (determinism is not regressed by this feature).
- **FR-008**: `ExportOptions.disableAutomaticChaining` (specs/019 FR-011) MUST NOT suppress the
  token-fetch request FR-004 synthesizes. That flag governs discovered chains *between approved
  scenarios* (path-parameter chaining, and bearer/apiKey credential chaining from specs/021/023);
  the token-fetch request is not such a chain — it is synthesized directly from the security
  scheme's own declaration — so it remains included whenever the scheme is required, regardless
  of that flag.

### Key Entities

- **OAuth2 Client-Credentials Scheme**: A security scheme of `type: oauth2` whose `flows` object
  declares `clientCredentials`, carrying a `tokenUrl` and zero or more `scopes` — all read verbatim
  from the specification, never inferred.
- **Client Credential Variables**: The client-ID, client-secret, and access-token placeholders
  provisioned for a classified scheme (FR-002), named per the existing scheme-key-derived
  convention shared with other credential variable types.
- **OAuth2 Token-Fetch Request**: A request synthesized directly from a classified scheme's own
  declared `tokenUrl`/scopes (FR-004) — not discovered via the ambiguous producer-candidate
  heuristic specs/021/023 use for bearer/apiKey credentials, since the token endpoint is always
  explicitly declared. Captures its response into the scheme's access-token variable (FR-004a).
- **Non-Automatable OAuth2 Scheme**: A security scheme of `type: oauth2` whose only declared
  flow(s) are `authorizationCode`, `implicit`, or `password` — continues to produce today's
  "unsupported-auth-scheme" limitation, unaffected by this feature (User Story 3).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a specification whose only security scheme is OAuth2 `clientCredentials`, 0% of
  the operations requiring it appear in the "unsupported-auth-scheme" limitation after export
  (down from 100% today).
- **SC-002**: For that same specification, the exported environment provisions at least three new
  variables (client ID, client secret, access token) beyond `baseUrl`, where today it provisions
  none, and includes exactly one synthesized token-fetch request.
- **SC-003**: Every `tokenUrl` and scope value that appears anywhere in the export for a classified
  scheme matches the specification's own declared value exactly — zero fabricated values.
- **SC-004**: For a specification declaring only `authorizationCode`/`implicit`/`password` OAuth2
  flows, the export's limitation output is unchanged from today's behavior (0 regressions).
- **SC-005**: Re-exporting the same approved input twice produces byte-for-byte identical
  collection, environment, and README artifacts.
- **SC-006**: Given real, valid client-ID/client-secret values and a reachable `tokenUrl`, running
  the exported collection authenticates every request requiring the scheme with zero manual steps
  between import and a successful run.

## Assumptions

- This iteration is scoped to the `clientCredentials` OAuth2 flow only. `authorizationCode` and
  `implicit` are permanently out of scope for automation (they require an interactive user-browser
  redirect no static export can script); `password` is deferred to a possible future iteration
  (User Story 3, FR-001), not added now.
- A scheme is classified as OAuth2-`clientCredentials`-supported based solely on its own declared
  `flows.clientCredentials` object — no naming convention (e.g. a scheme key containing "oauth")
  is used as a substitute signal.
- This feature reuses, rather than redefines, the existing scheme-key-derived credential-variable
  naming convention from specs/021-multi-credential-token-provisioning.
- Token refresh/expiry handling across a long-running suite is out of scope (FR-004b); the
  token-fetch request runs once per collection run.
- HTTP Basic auth (FR-004c) is assumed to be an acceptable client-authentication method for
  every specification this feature targets; a provider whose token endpoint requires
  body-embedded credentials instead is out of scope for this iteration.
