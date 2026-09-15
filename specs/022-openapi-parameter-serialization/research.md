# Phase 0 Research: Specification-Conformant Parameter Serialization

All items below were resolved during this planning pass by reading the actual implementation
(`backend/src/postman/requestItem.ts`, `backend/src/openapi/buildApiModel.ts`,
`packages/shared-domain/src/apiModel.ts` and `postmanArtifact.ts`) rather than left as
"NEEDS CLARIFICATION" — none required a further round of `/speckit-clarify` because each is
resolvable directly from the OpenAPI 3.x specification's own style definitions (which FR-002 and
the spec's Edge Cases already name as authoritative) or from an existing, already-established
repository convention.

## D1 — Where `style`/`explode` are extracted

**Decision**: Extend `extractParameters` in `backend/src/openapi/buildApiModel.ts` to read
`p.style` (string) and `p.explode` (boolean) from the raw parameter object, alongside the existing
`name`/`in`/`required`/`schema` extraction, and place them on `Parameter` only when the raw value
is actually present and of the expected type — never a fabricated default.

**Rationale**: This is the single existing place `Parameter[]` is constructed from a parsed
specification (confirmed: `extractParameters` is called once, from operation-object processing).
Adding the two fields here keeps `Parameter` an honest reflection of what the specification
declares (constitution I), and the per-location default is resolved later, at serialization time,
so `Parameter` never carries a value the specification didn't actually state.

**Alternatives considered**: Resolving the default at extraction time and always populating
`style`/`explode` — rejected because it would make `Parameter` indistinguishable between "the spec
said `form`" and "the spec said nothing", which spec 021's `SchemeVariablePlanEntry` precedent
(resolve at use, don't persist a fabricated default) already established as the project's pattern
for exactly this situation.

## D2 — Where serialization logic lives

**Decision**: New module `backend/src/postman/parameterSerialization.ts`, exporting pure functions
consumed by `buildUrl` (and the header-building loop) in `requestItem.ts` — `buildUrl` is
confirmed to be the sole production call site that turns a `GeneratedRequest`'s path/query values
into URL text (the only other place `queryParameters`/`pathParameters` are touched is
`workflowVariables.ts`, which only ever substitutes one scalar `{{variable}}` string per consumer
field, never producing an array/object, so it needs no change).

**Rationale**: Mirrors the separation spec 021 used for `credentialProducers.ts` — a small,
independently-testable pure module rather than inlining branching logic into `buildUrl`, which
already has several responsibilities (path-segment routing, credential detection, query assembly).

**Alternatives considered**: Extending `authMapping.ts` — rejected, unrelated concern (auth vs.
parameter value rendering) with no shared logic. Inlining into `requestItem.ts` directly —
rejected because it would make the style-resolution and encoding rules harder to unit-test in
isolation from full request assembly.

## D3 — Percent-encoding: what gets encoded, and what stays literal

**Decision**: Every *value* placed into a URL (a scalar, one array element, one object property's
value, one object property's own name) is percent-encoded individually via `encodeURIComponent`
before being combined into the final text. The *structural* characters a style itself defines —
the `,` in a `form`/`explode:false` join, the `|` in `pipeDelimited`, the `[`/`]` around a
`deepObject` property name, the `&`/`=` between key-value pairs, the repeated key in
`explode:true` — are never encoded; they are the OpenAPI-declared wire syntax the receiving API is
built to parse. `spaceDelimited`'s separator is the one exception that *is* itself encoded
(`%20`), because the raw specification defines the separator as a literal space character, which
is unsafe to place unencoded in a URL — this exact behavior (`%20`, not `+`) is spelled out in
spec.md's Acceptance Scenario 3 and Edge Case list.

**Rationale**: `encodeURIComponent` percent-encodes exactly the characters that would otherwise be
misread as URL/query-string syntax (`&`, `=`, `#`, `?`, space, etc. — satisfying FR-006 and
SC-002), while leaving a style's own declared separator literal preserves the wire format an OpenAPI-
conformant API expects to parse (satisfying FR-003/FR-004's literal examples, e.g. `key=e1,e2,e3`
with the commas intact). Naively encoding the fully-joined string would corrupt the separator
itself and defeat the whole purpose of implementing the style.

**Alternatives considered**: Encoding the entire joined string in one pass — rejected, it would
percent-encode the style's own separator and produce a string the target API's style-aware parser
cannot decode back into the same array/object shape (violates SC-001). Using `encodeURI` instead
of `encodeURIComponent` — rejected, `encodeURI` deliberately leaves `&`, `=`, `#`, and other
query-string-significant characters unencoded, which is exactly what FR-006 requires encoding.

## D4 — `simple` style applies identically to path and header

**Decision**: Path parameters using the (default, and only implemented) `simple` style share the
same comma-join serializer as header parameters (FR-005), rather than needing a separate
path-specific rule. `explode` still distinguishes `simple`'s two sub-forms for an object value:
`explode:false` → `key[property1,value1,property2,value2]`-style flat comma list
(`prop1,val1,prop2,val2`); `explode:true` → `prop1=val1,prop2=val2`, still comma-joined within the
one path segment (no repeated-segment explosion is possible for a single path position).

**Rationale**: OpenAPI 3.x defines `style: simple` once, with one shared behavior table, and
explicitly scopes it to both `path` and `header` locations identically — the spec's own Edge Cases
section already states "path/header: `style: simple, explode: false`" as one combined default,
confirming the two locations are meant to behave the same way, not merely default the same way.
Reusing one serializer for both locations avoids a parallel, undocumented second implementation of
the identical style.

**Alternatives considered**: Treating path parameters as scalar-only and leaving an array/object
path value on today's fallback rendering — rejected; nothing in spec.md scopes FR-003/FR-004's
array/object handling to query-only in a way that would exclude path, and OpenAPI 3.x does define
`simple` for arrays/objects at path locations, so falling back would silently under-implement a
style the specification does define, contradicting FR-001's stated goal ("downstream generation
and rendering can serialize a value the way the specification requires instead of guessing") for a
location this feature otherwise covers.

## D5 — Element/property order

**Decision**: The order elements appear in the rendered URL (repeated keys for `explode:true`
arrays, property order for `deepObject`/`form` objects) is exactly the generated value's own
runtime order (array index order; object key order as produced by the generating rule module) —
never re-sorted. Only the *set of distinct top-level parameter names* continues to go through the
existing `sortedEntries` ordering (`backend/src/postman/ordering.ts`) for determinism across
different parameters, exactly as today.

**Rationale**: Directly required by spec.md Acceptance Scenario 1 ("in the array's own order") and
consistent with constitution XVI/XXIV — the generating rule module already produces its value
deterministically; serialization must reproduce that order, not impose a new one.

**Alternatives considered**: Sorting array elements or object properties alphabetically for
"determinism" — rejected; the value is already deterministic once generated, and re-sorting would
change the semantic meaning of an ordered array (e.g., a `sort` parameter's element order is
meaningful) and contradicts the explicit acceptance scenario.

## D6 — `matrix`/`label`/`content` fallback renders exactly like today, unencoded

**Decision**: When `resolveStyle` determines the resolved style is one this feature does not
implement, `buildUrl` MUST route that one parameter through the pre-existing `toValueText`
rendering path (unchanged, still unencoded), not through the new percent-encoding pipeline — while
still recording the new `unresolved-parameter-style` limitation.

**Rationale**: Spec.md's clarification is explicit: "the emitted query/path text falls back to
today's plain-JSON/`toString` rendering... This is additive to today's behavior... it does not
regress any currently-passing scenario." Passing an unimplemented style's value through the new
encoder would be a silent, undocumented behavior change for exactly the case FR-007 says must stay
recognizable as a fallback, and could not be represented in a way the (unknown) `matrix`/`label`
wire format actually expects anyway — encoding it would be no more "correct" than not encoding it,
so preserving today's exact text keeps this change's blast radius limited to the styles it
actually implements.

**Alternatives considered**: Applying percent-encoding to the fallback text too, since FR-006 says
"every key and value" — considered, but rejected: FR-007 is a more specific carve-out for exactly
this case ("falls back to today's plain-JSON/toString rendering", stated as a deliberate,
zero-regression choice), and the fallback path was never claimed to be a correct rendering of that
style in the first place, so encoding it would not make it more correct, only different from
today's byte-for-byte output for a case explicitly promised not to regress.

## D7 — Detecting a `content`-based parameter

**Decision**: Add one additional additive field to `Parameter`: `contentEncoded: boolean`, set to
`true` in `extractParameters` when the raw parameter object declares `content` (a plain object) —
the OpenAPI 3.x alternative to `schema`+`style` for a parameter whose value is encoded per a
declared media type rather than a serialization style. `resolveParameterStyle` treats
`contentEncoded: true` as unimplemented (falls back + limitation, D6) regardless of any `style`
value, since `style` is not meaningful for a `content`-based parameter.

**Rationale**: FR-007 explicitly requires detecting "a `content`-based parameter" as one of the
unsupported cases, but nothing in today's `Parameter`/`extractParameters` currently distinguishes
"the specification declared `content` instead of `schema`+`style`" from "the specification simply
omitted `style`" — without a dedicated field, the two are indistinguishable and the system would
either wrongly apply a style default (fabricating behavior the specification never declared, since
a `content`-based parameter's `style` is meaningless) or silently mis-detect one case as the other.
This field is read directly from the specification's own declared shape (constitution I) exactly
like `style`/`explode`, not inferred or guessed.

**Alternatives considered**: Inferring "content-based" from `schema` being empty/absent — rejected
as a guess (constitution XIV); an operation could legitimately declare a `schema`-only parameter
with an empty object schema for other reasons, and absence of a signal is not evidence of a
specific cause.

## D8 — New `GenerationLimitationKind` naming and shape

**Decision**: `"unresolved-parameter-style"`, one `GenerationLimitation` per affected *scenario*
(carrying `scenarioId`, `location: "METHOD /path"`, and a `message` naming the parameter and its
declared style) — following the existing per-scenario granularity every other rendering-layer
limitation kind in `requestItem.ts`/`buildBody` already uses (`unresolved-path-parameter`,
`unsupported-content-type`), rather than spec 021's per-scheme (once-per-export) granularity.

**Rationale**: Spec 021's `unresolved-credential-producer` is deliberately once-per-specification
because a security scheme is a specification-level fact independent of which scenarios are
approved. A parameter's unsupported style, by contrast, only matters for the scenarios that
actually got exported and reach `buildUrl` — the existing `unresolved-path-parameter` limitation
(same file, same rendering layer) is the closer precedent, not `unresolved-credential-producer`.

**Alternatives considered**: Once-per-operation-per-parameter (spec 021's pattern) — rejected;
FR-007's Acceptance Scenario says "the generation result records exactly one limitation naming the
operation, the parameter, and the declared style" for *a scenario export*, matching the
per-scenario existing convention, not a once-per-specification one.
