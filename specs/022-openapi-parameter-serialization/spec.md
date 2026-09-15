# Feature Specification: Specification-Conformant Parameter Serialization

**Feature Branch**: `022-openapi-parameter-serialization`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "QA feedback found that every generated request for an operation
with an array- or object-typed query parameter is malformed: the deterministic test designer and
the Postman export render such a parameter's value by JSON-stringifying it directly into the URL
(e.g. `?sort=[\"name\",\"-price\"]`) instead of following the OpenAPI 3.x `style`/`explode` rules
the specification declares for that parameter (`form`, `spaceDelimited`, `pipeDelimited`,
repeated-key explosion, `deepObject`). Separately, no emitted URL key or value is percent-encoded
at all, and every parameter — required or not — is always populated with a generated value even
in the primary positive-scenario builder, which can trip an API that behaves differently when an
optional filter is present vs. absent. Root-caused to: `Parameter` (shared-domain) not carrying
`style`/`explode`; `GeneratedRequest.queryParameters` being a plain `Record<string, unknown>`,
which cannot represent an exploded array (repeated key) no matter how the request builder is
fixed; and `buildUrl` (backend/src/postman/requestItem.ts) doing unconditional
`JSON.stringify`/`String()` conversion with no escaping. Fix root cause across the shared contract,
OpenAPI extraction, value generation, and Postman rendering, while preserving determinism and the
project's no-fabrication principle (an unsupported serialization style becomes a recorded
limitation, never a guess)."

## Clarifications

### Session 2026-09-14

- Q: `GeneratedRequest.queryParameters` is `Record<string, unknown>` — one JS value per parameter
  name — which cannot express `explode: true` array serialization (the same key repeated once per
  element: `sort=name&sort=price`). What's the smallest change that fixes this without disturbing
  every existing consumer of `GeneratedRequest`? → A: Keep today's shape as the *value* representation
  (a parameter still generates one JS value: a string, number, boolean, array, or object) and move
  the *serialization* decision entirely into the Postman rendering layer, which already knows each
  parameter's declared `style`/`explode` (carried on the now-extended `Parameter` type via the
  `ApiOperation` the scenario originated from). `GeneratedRequest` itself does not change shape;
  only `buildUrl`/`buildRequestItem` gain the ability to turn one array/object value into the right
  number of `{key, value}` query-string entries, or into a single joined-string entry, depending on
  the declared style. This keeps every existing rule module (which only ever produces or mutates
  one JS value per parameter) unchanged.
- Q: What happens when a query/header parameter declares a `style`/`explode` combination this
  feature does not implement (e.g. `matrix`/`label` path-parameter styles, or `content`-based
  parameters with a media-type-encoded value)? → A: No guess is made. The parameter's value is
  still generated and the request is still produced (so the scenario remains runnable/inspectable),
  but the emitted query/path text falls back to today's plain-JSON/`toString` rendering **and** a
  `GenerationLimitation` is recorded naming the operation, the parameter, and the unsupported style,
  exactly as an unmappable auth scheme is already reported today (`authMapping.ts`). This is
  additive to today's behavior (today emits the fallback text with no limitation recorded at all);
  it does not regress any currently-passing scenario.
- Q: Should `buildConformantRequest` (used by the primary positive-scenario rule) stop populating
  optional parameters, to avoid tripping an API that behaves differently when an optional filter is
  present vs. absent? → A: No — that is unrelated to serialization correctness and is already a
  deliberate, separate behavior: `buildMinimalConformantRequest` (which omits non-required
  query/header parameters) already exists and is used by the dedicated minimal-positive rule
  (`rules/minimalPositiveScenario.ts`). Changing what the *primary* positive scenario includes is a
  scenario-coverage decision, not a serialization bug, and is out of scope here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Array and Object Query Parameters Produce a Real Request (Priority: P1)

As a QA engineer exporting a collection for an operation whose specification declares an
array-typed query parameter (e.g. `sort: string[]` with `style: form, explode: true`, the OpenAPI
3.x default), I want the generated request's URL to serialize that parameter the way the
specification says the API expects it (`?sort=name&sort=-price`), not as a literal JSON array
string, so the request the collection sends is one the real API can actually parse.

**Why this priority**: This is the direct cause of "all tests under the catalog folder failing" —
every scenario for an operation with even one array/object query parameter currently sends a
request the target API is very unlikely to accept, regardless of scenario category.

**Independent Test**: Analyze a specification with a `GET` operation declaring a query parameter of
type `array` with `style: form` and `explode: true` (the default when unspecified), generate a
positive scenario, export it, and verify the rendered URL contains one repeated `key=value` pair
per array element rather than a JSON-encoded array literal.

**Acceptance Scenarios**:

1. **Given** an array-typed query parameter with `explode: true` (default), **When** a scenario for
   that operation is exported, **Then** the URL contains one `key=element` pair per array element,
   in the array's own order.
2. **Given** an array-typed query parameter with `explode: false` and `style: form` (the OpenAPI
   default pairing), **When** exported, **Then** the URL contains one `key=e1,e2,e3` entry with
   elements comma-joined.
3. **Given** an array-typed query parameter with `style: spaceDelimited` or `style: pipeDelimited`
   and `explode: false`, **When** exported, **Then** the array elements are joined with a space
   (percent-encoded as `%20`) or `|` respectively.
4. **Given** an object-typed query parameter with `style: deepObject`, **When** exported, **Then**
   each property is rendered as its own `key[property]=value` entry.
5. **Given** an object-typed query parameter with `style: form` (default) and `explode: true`
   (default), **When** exported, **Then** each property is rendered as its own `property=value`
   entry (the OpenAPI 3.x default object/form/explode behavior).

---

### User Story 2 - Special Characters Survive the Trip Into a URL (Priority: P2)

As a QA engineer, when a generated value (a boundary string, an enum-violation sentinel, or a
real-world value containing `&`, `=`, `#`, or a space) is placed into a query or path value, I
want it percent-encoded so the request's meaning is preserved and one parameter's value can never
be misread as a second parameter or truncate the query string.

**Why this priority**: Silent corruption of the query string is a correctness bug independent of
style/explode; it affects every existing scenario category, not just array/object parameters.

**Independent Test**: Generate a scenario whose query or path value contains a character requiring
percent-encoding (e.g. a boundary string containing `&`), export it, and verify the rendered URL
percent-encodes that character rather than emitting it literally.

**Acceptance Scenarios**:

1. **Given** a generated query parameter value containing `&`, `=`, `#`, `?`, or a space, **When**
   exported, **Then** the character is percent-encoded in the rendered URL.
2. **Given** a generated path parameter value containing a character requiring encoding, **When**
   exported, **Then** the rendered path segment percent-encodes it while the `{{baseUrl}}`
   variable reference and the literal path text remain intact.

---

### User Story 3 - An Unsupported Style Is a Visible Limitation, Never a Silent Guess (Priority: P3)

As a QA engineer, when a specification declares a parameter serialization style this feature does
not implement (e.g. `matrix`/`label` path styles, or a `content`-based parameter), I want the
export to say so explicitly, so I know which request needs manual review instead of assuming every
exported request is correct.

**Why this priority**: Preserves the project's explicit-failure and no-fabrication principles;
lower priority because the common styles (User Story 1) cover the reported failures.

**Independent Test**: Analyze a specification with a path parameter declaring `style: matrix`,
export a scenario for it, and verify the generation result records a limitation naming the
operation, the parameter, and the unsupported style, while the request itself is still produced
(using today's fallback rendering) rather than omitted.

**Acceptance Scenarios**:

1. **Given** a parameter declaring an unimplemented style, **When** a scenario for its operation is
   exported, **Then** the collection still contains a runnable request for that scenario, and the
   generation result records exactly one limitation naming the operation, the parameter, and the
   declared style.

### Edge Cases

- What happens when `style`/`explode` are omitted in the specification? OpenAPI 3.x defines
  per-location defaults (query/cookie: `style: form, explode: true`; path/header: `style: simple,
  explode: false`); the omitted case MUST resolve to that default, not to an unsupported-style
  limitation.
- What happens when an array/object parameter's generated value (from a negative scenario, e.g.
  invalid-type) is not actually an array/object (e.g. a string was substituted for an array to
  violate the schema)? Serialization MUST follow the *value's actual runtime shape*, not the
  schema's declared type — a substituted scalar renders as a single scalar entry, which is exactly
  the point of that negative scenario (constitution: negative scenarios deliberately violate the
  constraint; serialization must not repair the violation).
- What happens for a header parameter with an array value? OpenAPI 3.x headers only define
  `style: simple` (comma-joined, `explode: false` default) — no repeated-header explosion exists in
  the spec; this feature implements exactly that one header behavior and does not invent others.
- What happens with a `cookie` parameter? Out of scope for this feature; cookie parameters are
  already rendered as a single scalar text value today and this feature does not change that.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The shared `Parameter` contract MUST carry the parameter's declared `style` and
  `explode` (when the specification declares them), so downstream generation and rendering can
  serialize a value the way the specification requires instead of guessing.
- **FR-002**: When a specification omits `style`/`explode` for a parameter, the system MUST resolve
  the OpenAPI 3.x per-location default (query/cookie: `form`/`explode: true`; path/header:
  `simple`/`explode: false`) rather than treating the omission as unsupported.
- **FR-003**: For a query parameter with an array-typed generated value, the rendered URL MUST
  serialize it according to the resolved `style`/`explode`: repeated `key=element` pairs for
  `form`/`explode: true`; a single comma-joined `key=e1,e2,e3` for `form`/`explode: false`; a
  single space-joined (percent-encoded) or `|`-joined entry for `spaceDelimited`/`pipeDelimited`
  respectively.
- **FR-004**: For a query parameter with an object-typed generated value, the rendered URL MUST
  serialize it according to the resolved style: one `property=value` entry per property for
  `form`/`explode: true` (the default); a single `key=prop1,value1,prop2,value2` entry for
  `form`/`explode: false`; one `key[property]=value` entry per property for `deepObject`.
  keeping every emitted value's own scalar rendering unchanged.
- **FR-005**: For a header parameter with an array- or object-typed generated value, the rendered
  header MUST comma-join the value's elements (or its property/value pairs) per the `simple` style,
  since headers define no other serialization style.
- **FR-006**: Every key and value the system emits into a rendered URL (path segment or query
  string) MUST be percent-encoded, so no generated value's characters can be misread as query
  string syntax or corrupt the request's structure.
- **FR-007**: When a parameter declares a serialization style this feature does not implement
  (`matrix`, `label`, or a `content`-based parameter), the system MUST still produce a runnable
  request for the scenario (using today's existing scalar/JSON rendering as a fallback) and MUST
  record a `GenerationLimitation` naming the operation, the parameter, and the declared style,
  rather than silently guessing at an unimplemented serialization.
- **FR-008**: This feature MUST NOT change `GeneratedRequest`'s shape, the value(s) any existing
  rule module generates, or which parameters are included in a request (required vs. optional) —
  only how an already-generated value is rendered into a URL/header is in scope.

### Key Entities

- **Parameter** (existing, extended): gains `style` and `explode` fields sourced directly from the
  specification, with no fabricated default persisted (the default is resolved at serialization
  time, not written back into the parsed model).
- **Serialization Style**: One of the seven the OpenAPI 3.x specification defines
  (`form`, `spaceDelimited`, `pipeDelimited`, `deepObject` for query; `simple`, `label`, `matrix`
  for path/header), paired with `explode: boolean`. This feature implements `form`,
  `spaceDelimited`, `pipeDelimited`, `deepObject`, and `simple`; `label` and `matrix` are recorded
  as limitations per FR-007.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a representative specification containing array- and object-typed query
  parameters across every implemented style, 100% of exported scenario URLs for those operations
  parse back (by a standard query-string parser) into the same array/object shape the
  specification's `style`/`explode` combination defines — not a JSON-stringified literal.
- **SC-002**: 100% of generated URLs (path and query) contain no unencoded `&`, `=`, `#`, or space
  characters originating from a generated value.
- **SC-003**: Every operation using an unimplemented serialization style produces exactly one
  limitation entry naming the operation, parameter, and style, with zero silently-guessed
  serializations.
- **SC-004**: Re-exporting the same approved test set continues to produce byte-for-byte identical
  artifacts (determinism, FR-018 of spec 007, is not regressed by this change).

## Assumptions

- The specification is already parsed by `backend/src/openapi/` using OpenAPI 3.x conventions; this
  feature extends that existing extraction rather than introducing new parsing capability.
- `buildMinimalConformantRequest`'s existing required-only behavior is unaffected and remains the
  only mechanism for omitting optional parameters (per the clarification above).
- Rule modules that mutate a base request (`singleFieldMutation.ts`, `boundaryMutation.ts`,
  `requiredFieldScenarios.ts`, etc.) are unaffected: they still produce one JS value per parameter;
  only the rendering step (`backend/src/postman/requestItem.ts`) changes how that value becomes URL
  text.
- This feature does not address query-parameter *value generation* (e.g. which string a
  non-enum `sort` parameter receives) — that is a separate, already-identified value-generation
  gap and is not fixed by correct serialization alone.
