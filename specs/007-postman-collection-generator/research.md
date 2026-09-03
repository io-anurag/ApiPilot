# AP-007 Research

## Decision: Hand-built typed serializer instead of the Postman Collection SDK

**Decision**: Build the collection and environment artifacts as plain, strongly typed TypeScript
structures serialized to JSON, rather than adopting the `postman-collection` SDK or any other
collection-building library.

**Rationale**: The three things AP-007 must guarantee — byte-identical output for identical input
(FR-018), no value in the artifact that the approved scenario did not carry (FR-003, FR-006), and
an explicit validation gate before delivery (FR-014) — are all properties of *our* emission, not
properties the SDK provides. The SDK assigns generated identifiers to collections and items unless
every id is supplied, which is a determinism hazard rather than a help, and it is a builder, not a
validator: it normalizes input rather than rejecting malformed output, so it would not satisfy
FR-014 either. The emitted subset of the format is small and fully under our control. This is not
"reinventing a standards implementation" in the sense constitution XXVIII guards against (writing
our own OpenAPI parser); it is serializing a documented JSON shape.

**Alternatives considered**:

- `postman-collection` SDK: rejected for the determinism hazard, because it adds a substantial
  dependency tree for JSON construction we can do directly, and because it does not provide the
  validation gate FR-014 requires.
- Templating the JSON as strings: rejected because it loses type safety at exactly the boundary
  where a malformed artifact is most costly, and makes structural validation harder.

## Decision: Structural validation of the emitted subset, with schema validation deferred

**Decision**: Satisfy FR-014 with a dedicated validator that checks the generated collection against
the invariants of the subset ApiPilot emits — required top-level fields, item/folder shapes, URL
composition, header and body shapes, event/script shapes, variable declarations, plus ApiPilot's own
rules (no literal host, no credential literal, stable ordering). Do not vendor the official Postman
Collection Format v2.1.0 JSON Schema in this feature.

**Rationale**: The validator's job is to catch generator defects before an engineer imports a broken
artifact, and a validator over the exact subset we emit does that with no new dependency, no network
access at build or run time (constitution XVII, and the project's prohibition on fetching external
documents), and fully deterministic behaviour. Vendoring the official schema would add a large
third-party file whose licence must be reviewed before it can be committed, and would validate
constructs ApiPilot never emits. `ajv@8` is already present in the dependency tree via
`@apidevtools/swagger-parser`, so adopting schema validation later costs only a direct dependency
declaration and the vendored schema file — this decision is cheap to revisit.

**Trade-off recorded (constitution XXX)**: A self-written validator checks our understanding of the
format rather than the format itself. It can therefore pass an artifact that a real Postman import
would reject. The mitigation is that the validator is written against the published v2.1.0 field
list and is paired with fixture artifacts checked into the repository, and that SC-007 (import and
run in a standard collection runner) remains a manual acceptance step for this feature. Adding
official-schema validation, and automated import verification once AP-010 introduces a runner, are
the two named follow-ups.

**Alternatives considered**:

- Vendor the official v2.1.0 JSON Schema and validate with `ajv`: deferred rather than rejected;
  it is the stronger guarantee, but requires a licence review and a large vendored artifact that
  this feature does not otherwise need.
- Validate by importing into Newman: rejected because Newman is an AP-010 concern, would make the
  test suite depend on a runner, and FR-023/SC-012 forbid this feature from executing anything.

## Decision: Deterministic identifiers derived from content

**Decision**: Derive every identifier the collection format requires — the collection id and each
item id — from a SHA-256 digest over stable, content-derived inputs (the ordered approved scenario
ids for the collection; the scenario id for each item), formatted as a UUID. Never call a random or
time-based id generator.

**Rationale**: FR-018 and SC-002 require identical artifacts for identical input, and the format
requires ids to be present. Content-derived ids satisfy both, and additionally give FR-026 its
traceability for free: an item id is a pure function of the approved scenario it came from, so a
request in the artifact can be mapped back to the scenario that produced it. Node's built-in
`crypto` module covers this with no dependency.

**Alternatives considered**:

- Random UUIDs: rejected outright; it breaks determinism, the feature's central guarantee.
- Sequential integers: rejected because a scenario's id would then depend on its position, so
  removing one rejected scenario would renumber every later item and break FR-018's re-export
  stability (User Story 4).

## Decision: Ordering rule

**Decision**: Order folders by their grouping name, then requests within a folder by
`(path, method, category, scenario id)`, all compared with a fixed, locale-independent code-unit
comparison. Order environment variables by name using the same comparison. Serialize JSON with a
fixed key order determined by the emitting types, not by input iteration order.

**Rationale**: Determinism (FR-018) needs an ordering that does not depend on input order, object
key insertion order, or the host locale. `localeCompare` is explicitly excluded because its result
varies with the runtime's ICU data, which would make output machine-dependent — a violation of
constitution XXIV.

**Alternatives considered**:

- Preserve the approved TestModel's scenario order: rejected because upstream review edits and
  deduplication can reorder scenarios, which would produce large spurious diffs on re-export.

## Decision: Assertion translation, including wildcard and undocumented status codes

**Decision**: Translate the two assertion types the TestModel carries and nothing else.
`status-code` with an exact numeric code becomes a status assertion on that code. `status-code`
with an OpenAPI wildcard code (`1XX`–`5XX`) becomes an assertion that the response status falls in
that class. `status-code` with `default` produces no assertion and is recorded as a generation
limitation. `schema-conformance` becomes a JSON-schema assertion using the expected schema
converted from `SchemaConstraint` to a JSON Schema object. A scenario with no assertions produces a
request with no test script and a recorded limitation.

**Rationale**: `Assertion.expectedStatusCode` is copied straight from `ApiModel` response status
codes (`backend/src/testDesign/assertions.ts:47`), and OpenAPI permits `4XX` and `default` there, so
the generator must handle both without inventing a concrete code. Asserting a class for `NXX` is
exactly as specific as the specification was; `default` carries no status information at all, so
FR-007 and constitution I require a recorded gap rather than a guess.

**Alternatives considered**:

- Map `default` to a plausible code such as 400: rejected as fabrication (constitution I, XIV).
- Skip requests that carry no assertion: rejected because the request itself is still useful test
  intent that the reviewer approved; FR-007 requires emitting it and recording the gap.

## Decision: Request body content type re-derived from the ApiModel

**Decision**: The export accepts the `ApiModel` alongside the approved `TestModel`, and determines
each request's body content type by reusing `primaryRequestBodySchema`'s existing selection rule
(prefer `application/json`, otherwise the first declared content type) from
`backend/src/testDesign/requestHelpers.ts:36`. When the selected content type is not JSON, the body
is emitted as a raw body with that content type if it can be represented faithfully, and otherwise
recorded as an unsupported case under FR-021.

**Rationale**: `GeneratedRequest` carries a `body` but no content type, so the content type is not
recoverable from the TestModel alone. Re-deriving it with the *same* helper the generator upstream
used is what keeps the emitted `Content-Type` consistent with the value that was actually generated;
re-implementing the selection rule here would let the two drift. Requiring the `ApiModel` on the
export boundary matches the existing review endpoints, which already take both models.

**Alternatives considered**:

- Add a content type to `GeneratedRequest`: rejected for this feature because it changes a shared
  domain contract that AP-003, AP-005, and AP-006 all consume, for a value that is already
  derivable. Worth revisiting if a later feature needs multi-content-type scenarios.
- Assume JSON always: rejected because it would silently mislabel form or text bodies, which
  FR-021 forbids.

## Decision: Authentication mapped only from declared security schemes

**Decision**: Map `SecuritySchemeDefinition` to collection auth as follows — `http`/`bearer` to
bearer auth with a `{{token}}` variable; `http`/`basic` to basic auth with `{{username}}` and
`{{password}}`; `apiKey` to API-key auth carrying the declared parameter name, its declared location
(header or query), and a `{{apiKey}}` variable. Every other scheme type, including `oauth2` and
`openIdConnect`, produces no auth configuration and is recorded as a generation limitation. When an
operation declares several alternative requirement sets, use the first declared set and record which
one was applied.

**Rationale**: FR-009 and constitution I forbid inventing an authentication mechanism. A bearer
token is a plausible-looking stand-in for OAuth2, but the token endpoint, flow, and scopes are not
something the export can supply, so configuring it would present a guess as a contract. "First
declared set" is a deterministic, documented choice that satisfies the corresponding edge case
without needing a preference heuristic.

**Alternatives considered**:

- Treat `oauth2` as bearer: rejected as fabrication of an auth mechanism.
- Ask the user to pick among alternative requirement sets: rejected as scope creep into export
  configuration UI; the choice is recorded in the accompanying document so it is not hidden.

## Decision: Credential substitution reuses the existing detection predicates

**Decision**: Satisfy FR-013 by substituting a variable reference (`{{token}}`, `{{apiKey}}`,
`{{password}}`) where AP-006's existing sensitive-value detection already identifies a credential,
extracting the shared predicates from `backend/src/testDesign/reviewSensitiveValues.ts` into a
module both the review redactor and the export substituter consume.

**Rationale**: Two different definitions of "this value is a credential" in one codebase is exactly
the drift that lets a secret through one path while the other blocks it. Review needs
`[redacted]` because it renders for a human; export needs `{{token}}` because the request must still
run. The detection is the shared part, the replacement is not. Extracting the predicates is a small,
justified refactor (CLAUDE.md §59) rather than a parallel implementation.

**Alternatives considered**:

- Duplicate the patterns in the generator: rejected for the drift risk above.
- Reuse `redactSensitiveRequestValues` directly: rejected because `[redacted]` would be emitted into
  a runnable artifact, producing requests that fail for a reason unrelated to the test intent.

## Decision: Base address is always a variable

**Decision**: Every request URL is composed as `{{baseUrl}}` followed by the operation path with
path parameters expressed as `:name` segments and their approved values carried in the URL's
variable list. `{{baseUrl}}` is declared in the environment artifact, with the engineer's supplied
value if one was given and an empty value otherwise.

**Rationale**: `ApiModel` carries no server address (`packages/shared-domain/src/apiModel.ts:1`), so
there is no specification-derived host to use, and FR-008/FR-012 forbid inventing one. Expressing
path parameters as `:name` with a variable entry keeps the operation path readable in the collection
UI while preserving the approved value exactly, which serves both FR-003 and FR-005.

**Alternatives considered**:

- Substitute path parameter values directly into the URL string: rejected because the request name
  and URL would no longer show which operation it belongs to, weakening FR-005 and SC-008.

## Decision: Stateless export endpoint returning all three artifacts

**Decision**: Expose `POST /api/test-models/postman-collection`, taking the `ApiModel`, the approved
`TestModel`, and optional environment values, and returning the collection, the environment, the
accompanying document, the validation report, and the recorded limitations in one response. Persist
nothing. The frontend writes the three files from that single response.

**Rationale**: This matches the stateless boundary every prior feature uses (AP-002, AP-003, AP-005,
AP-006 all take models in and return results without storage), satisfies FR-024's no-retention rule
and FR-022's single-action requirement, and avoids introducing an archive dependency purely to bundle
three text files.

**Alternatives considered**:

- Return a ZIP archive: rejected because it adds a dependency to bundle three small text files and
  makes the response opaque to tests that need to assert artifact content.
- Three separate endpoints: rejected because generation must be one deterministic operation — the
  environment's variable list is a product of generating the collection, so splitting them invites
  inconsistent pairs.

## Decision: No styling framework introduced

**Decision**: Build the export UI with the same plain semantic HTML the existing pages use, adding
no CSS framework.

**Rationale**: The frontend currently ships no stylesheet and no `className` usage at all, and
Tailwind is not installed. Introducing a styling system inside a generator feature would be exactly
the unrelated scope CLAUDE.md §58 prohibits. Accessibility requirements are met through semantic
elements, accessible names, and text-based state rather than colour.

**Alternatives considered**:

- Introduce Tailwind v4 here because CLAUDE.md names it as the intended direction: rejected as a
  separate, self-contained migration that should not ride along with artifact generation.

## Decision: Multi-step workflow intent is detected and refused, not rendered

**Decision**: Per the spec's resolved clarification, implement single-operation export only. Detect
whether a supplied approved TestModel carries multi-step workflow intent and, if so, fail the export
explicitly (FR-030) rather than emitting the steps as unrelated requests. Do not define a workflow
domain contract in this feature.

**Rationale**: The current `TestScenario` contract has no workflow, ordering, or extraction fields,
so today the detection is a guard against a future model this generator has not been taught to
render. Defining that contract here would pre-empt AP-008, which owns it. FR-029 records the required
rendering behaviour so AP-008 has a defined target.

**Alternatives considered**:

- Render workflows now: rejected; it requires inventing AP-008's contract.
- Silently export workflow steps as independent requests: rejected because it would present a suite
  that cannot pass — later steps depend on earlier extracted values — as a successful export.
