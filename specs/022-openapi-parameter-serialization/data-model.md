# Phase 1 Data Model: Specification-Conformant Parameter Serialization

All types below are additive to existing `packages/shared-domain` contracts (`apiModel.ts`,
`postmanArtifact.ts`) or are new, backend-internal types
(`backend/src/postman/parameterSerialization.ts`) not exposed across the shared-domain boundary.
No existing field is renamed, removed, or given a breaking type change; `GeneratedRequest`
(`packages/shared-domain/src/testModel.ts`) is explicitly unchanged per spec FR-008.

**Mapping from spec.md's Key Entities**: "Parameter (existing, extended)" is the existing
`Parameter` record (`packages/shared-domain/src/apiModel.ts`), gaining `style`/`explode`/
`contentEncoded`. "Serialization Style" is the `ParameterStyle` union below, paired with the
per-parameter `resolveParameterStyle` resolution the spec's Edge Cases section already describes.

## Extended (shared-domain): `Parameter` (`packages/shared-domain/src/apiModel.ts`)

```ts
export interface Parameter {
  name: string;
  location: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema: SchemaConstraint;
  /** The specification's own declared `style`, verbatim, when present (FR-001). Absent — not a
   *  fabricated default — when the specification omits it; the per-location default is resolved
   *  at serialization time (research.md D1). */
  style?: string;
  /** The specification's own declared `explode`, verbatim, when present (FR-001). Same
   *  absent-not-defaulted rule as `style`. */
  explode?: boolean;
  /** True when the specification declares this parameter via `content` (a media-type-encoded
   *  value) instead of `schema`+`style` (research.md D7). `style`/`explode` are meaningless when
   *  this is true. Absent (not `true`) carries exactly one meaning — the specification did not
   *  declare `content` for this parameter — so, unlike `style`/`explode` (whose absence triggers a
   *  genuine per-location default *resolution*), there is no second interpretation an omitted
   *  `contentEncoded` could silently collapse into; making it optional loses no information. */
  contentEncoded?: boolean;
}
```

**Amended during `/speckit-analyze` remediation (2026-09-15, finding C1)**: `contentEncoded` was
originally specified as non-optional, on spec 021's `ExportResult.credentialProducers` precedent
(force every construction site to state the fact explicitly). That precedent doesn't transfer
cleanly here: `ExportResult` is built at one production call site, so making its field required
surfaces the new fact at a handful of places; `Parameter` object literals are constructed directly
in roughly twenty existing test fixture files across the backend test suite (`exportFixtures.ts`,
`dependencyFixtures.ts` (both copies), `reviewScenarioFixtures.ts`, `nestedRequiredApiModel.ts`,
`constraintsApiModel.ts`, and over a dozen `*.test.ts` files), none of which tasks.md's original
draft assigned a task to update. Since "declared absent" and "declared `false`" are the *same*
fact for `contentEncoded` (unlike `style`/`explode`, where absence genuinely means "resolve the
per-location default," a distinct third state), making it optional — treated as `false` by
`resolveParameterStyle` whenever it is not literally `true` — loses no information and avoids an
unplanned, repo-wide mechanical edit for no traceability benefit. `style`/`explode` remain optional
for their original (different) reason.

### Rules encoded by `extractParameters` (traces to spec FRs)

| Rule | Spec reference |
|---|---|
| `style` and `explode` are copied verbatim from the raw parameter object only when present and of the expected type (`string`/`boolean`); otherwise left `undefined`. | FR-001 |
| `contentEncoded` is set to `true` iff the raw parameter object declares a plain-object `content` field; otherwise left `undefined` (equivalent to `false` everywhere it is read). | FR-007, research.md D7 |

## New (backend-internal): `backend/src/postman/parameterSerialization.ts`

```ts
export type ParameterStyle =
  | "form" | "spaceDelimited" | "pipeDelimited" | "deepObject"  // query
  | "simple"                                                     // path, header
  | "matrix" | "label";                                          // path (unimplemented)

/** One parameter's fully resolved serialization behavior for this export (FR-001-FR-003, Edge Cases). */
export interface ResolvedParameterStyle {
  style: ParameterStyle;
  explode: boolean;
  /** False for matrix/label/contentEncoded — the caller must use the D6 fallback+limitation path,
   *  never this module's encoding pipeline, for such a parameter. */
  implemented: boolean;
}

/**
 * Resolves a `Parameter`'s effective style/explode, applying the OpenAPI 3.x per-location default
 * (query/cookie: form/true; path/header: simple/false) when the specification declared neither
 * (Edge Cases). Pure function of the one `Parameter`.
 */
export function resolveParameterStyle(parameter: Parameter): ResolvedParameterStyle;

/** One `{key, value}` pair destined for `PostmanUrl.query` (reuses the existing shared-domain shape). */
export interface SerializedQueryEntry {
  key: string;
  value: string;
}

/**
 * Serializes one query parameter's already-generated runtime value into the entries
 * `PostmanUrl.query` needs, per the resolved style (FR-003, FR-004). Every emitted key/value
 * piece is percent-encoded individually; the style's own structural separator (`,`, `|`, `[`/`]`,
 * repeated key) is never encoded — `spaceDelimited`'s separator is the one exception, itself
 * encoded as `%20` (research.md D3). Follows the value's own runtime shape (array/object/scalar),
 * never the schema's declared type (spec Edge Cases — a negative scenario's substituted scalar
 * renders as one scalar entry).
 */
export function serializeQueryParameter(
  name: string,
  value: unknown,
  resolved: ResolvedParameterStyle,
): SerializedQueryEntry[];

/**
 * Serializes one path or header parameter's value under the `simple` style (FR-005, research.md
 * D4) into one already-composed, percent-encoded text value — comma-joining array elements, or
 * `explode`-dependent property rendering for an object value, exactly as `simple` defines for
 * both locations alike.
 */
export function serializeSimpleValue(value: unknown, explode: boolean): string;

/** Percent-encodes one text fragment (`encodeURIComponent`) — the sole encoding primitive every
 *  other function in this module builds on (research.md D3). */
export function percentEncode(text: string): string;
```

### Rules encoded by `resolveParameterStyle`/`serializeQueryParameter`/`serializeSimpleValue` (traces to spec FRs)

| Rule | Spec reference |
|---|---|
| `resolved.implemented` is `false` whenever `parameter.contentEncoded` is `true`, or the resolved style is `matrix`/`label`. | FR-007 |
| Query, `form`, `explode: true`, array value → one `{key, value}` entry per element, in the array's own order. | FR-003, Acceptance Scenario 1 |
| Query, `form`, `explode: false`, array value → one entry, elements comma-joined (comma literal, each element percent-encoded). | FR-003, Acceptance Scenario 2 |
| Query, `spaceDelimited`/`pipeDelimited`, `explode: false`, array value → one entry, elements joined by `%20`/`\|` respectively. | FR-003, Acceptance Scenario 3 |
| Query, `deepObject`, object value → one `key[property]=value` entry per property. | FR-004, Acceptance Scenario 4 |
| Query, `form`, `explode: true` (default), object value → one `property=value` entry per property. | FR-004, Acceptance Scenario 5 |
| Query, `form`, `explode: false`, object value → one entry, `key=prop1,value1,prop2,value2`. | FR-004 |
| Path/header, `simple`, any value → one comma-joined text value (object rendering depends on `explode`, per research.md D4). | FR-005, research.md D4 |
| A substituted value whose runtime type doesn't match the schema (negative scenario) serializes per its actual runtime shape. | Edge Cases |

## Extended (shared-domain): `GenerationLimitationKind` (`packages/shared-domain/src/postmanArtifact.ts`)

```ts
export type GenerationLimitationKind =
  | "no-expected-outcome"
  | "undocumented-status-code"
  | "unsupported-auth-scheme"
  | "unsupported-content-type"
  | "unresolved-path-parameter"
  | "specification-analysis-issue"
  | "alternative-auth-requirement-selected"
  | "workflow-missing-scenario"
  | "workflow-unsupported-sequence"
  | "workflow-unresolved-handoff"
  | "workflow-unsupported-extraction-path"
  | "workflow-unsupported-request-representation"
  | "unresolved-credential-producer"
  | "unresolved-parameter-style"; // NEW (FR-007)
```

## New `GenerationLimitation` usage for FR-007 (no type change — usage convention)

A `GenerationLimitation` with `kind: "unresolved-parameter-style"` is emitted **once per affected
scenario** (matching `unresolved-path-parameter`'s existing per-scenario granularity in the same
rendering layer, not spec 021's per-specification granularity — research.md D8):

- `scenarioId`: the scenario whose request contains the unimplemented-style parameter.
- `location`: `"METHOD /path"`, the same convention every other `requestItem.ts` limitation uses.
- `message`: names the parameter and its declared (or content-based) style, e.g. `The "coords"
  path parameter declares the "matrix" style, which this export cannot serialize, so its value is
  rendered using today's plain-text fallback.`

## Reused types (no data-model change — listed for traceability)

- `PostmanQueryParameter`, `PostmanUrl`, `PostmanHeader` — `packages/shared-domain/src/postmanArtifact.ts`. Unmodified; `PostmanQueryParameter`'s existing `{key, value}[]` array shape already supports repeated keys (an `explode: true` array's multiple entries), so no shape change is needed to represent the new serialization outputs.
- `GeneratedRequest` — `packages/shared-domain/src/testModel.ts`. Explicitly unchanged (spec FR-008); `queryParameters`/`pathParameters` remain `Record<string, unknown>`, one JS value per parameter name.
- `SchemaConstraint` — unmodified; serialization follows the generated value's runtime shape, not the schema (Edge Cases).
- `sortedEntries`, `compareCodeUnits` — `backend/src/postman/ordering.ts`. Unmodified; still used to order the set of distinct parameter names deterministically. Ordering *within* one parameter's own array/object value is the value's own runtime order (research.md D5), not re-sorted.
