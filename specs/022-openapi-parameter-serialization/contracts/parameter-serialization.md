# Contract: Parameter Serialization in Postman Export Rendering

This feature has no new HTTP-facing contract — `backend/src/api/postmanCollections.ts`'s request
and response shapes are unchanged. The contract this feature actually changes is the internal
rendering contract between `buildUrl`/header-building in `backend/src/postman/requestItem.ts` and
the new `backend/src/postman/parameterSerialization.ts` module, and the resulting change in what
bytes the existing `ExportResult.collection` artifact contains for an operation with a
non-trivial-style parameter. This document specifies that rendering contract precisely enough to
write conformance tests against.

## Input

- One `Parameter` (`packages/shared-domain/src/apiModel.ts`), specifically its
  `style`/`explode`/`contentEncoded`/`location` fields.
- One already-generated runtime value for that parameter, as produced by the existing rule
  modules and carried on the approved `TestScenario.request` (`pathParameters`/`queryParameters`/
  `headers`, all `Record<string, unknown>` — unchanged shape per FR-008).

## Output

- For a **query** parameter: zero or more `PostmanQueryParameter` (`{key, value}`) entries,
  appended to `PostmanUrl.query` (and reflected in `PostmanUrl.raw`'s query string), in the order
  produced by `serializeQueryParameter`.
- For a **path** parameter: one already-composed text value substituted into the `:name` path
  segment (`PostmanUrl.path`/`PostmanUrl.variable`), exactly as today's path-variable mechanism
  already substitutes a resolved value — only the value's own text now comes from
  `serializeSimpleValue` + `percentEncode` instead of `toValueText`.
- For a **header** parameter with an array/object value: one already-composed, comma-joined
  `PostmanHeader.value` (header *values* are not percent-encoded — percent-encoding is a URL
  concept; FR-006 scopes it to "a rendered URL (path segment or query string)" only).
- Zero or one `GenerationLimitation` with `kind: "unresolved-parameter-style"` per affected
  scenario, when `resolveParameterStyle(parameter).implemented` is `false` (data-model.md).

## Conformance table (per spec.md Acceptance Scenarios)

| Location | Value shape | Style | Explode | Rendered form |
|---|---|---|---|---|
| query | array | `form` | `true` (default) | `key=e1&key=e2&key=e3` (repeated key, each `ei` percent-encoded) |
| query | array | `form` | `false` | `key=e1,e2,e3` (comma literal, each `ei` percent-encoded) |
| query | array | `spaceDelimited` | `false` | `key=e1%20e2%20e3` |
| query | array | `pipeDelimited` | `false` | `key=e1\|e2\|e3` (pipe literal) |
| query | object | `deepObject` | any | `key[p1]=v1&key[p2]=v2` (one entry per property; `p*`/`v*` percent-encoded) |
| query | object | `form` | `true` (default) | `p1=v1&p2=v2` (one entry per property) |
| query | object | `form` | `false` | `key=p1,v1,p2,v2` |
| path/header | array | `simple` | `false` (default) | `e1,e2,e3` |
| path/header | array | `simple` | `true` | `e1,e2,e3` (path/header have no repeated-segment form; see research.md D4) |
| path/header | object | `simple` | `false` (default) | `p1,v1,p2,v2` |
| path/header | object | `simple` | `true` | `p1=v1,p2=v2` |
| any | scalar | any | any | `value` (percent-encoded; unchanged from today for the non-array/object case, now additionally encoded per FR-006) |
| path/query | any | `matrix`/`label`/content-encoded | any | today's exact unencoded `toValueText` fallback + one `unresolved-parameter-style` limitation |

## Determinism guarantee (SC-004)

For a fixed `ApiModel` and approved `TestModel`, every rendered URL/header byte is a pure function
of the parameter's declared `style`/`explode`/`contentEncoded` and the scenario's generated value
— no clock, randomness, or environment input. Re-exporting an unchanged approved set MUST produce
byte-identical `collection`/`environment`/`readme` artifacts, exactly as the existing
`reexportStability.test.ts` suite already verifies for every other rendering concern.

## Backward compatibility (SC-004, spec FR-008)

Every existing scenario whose parameters are all scalar-valued, standard-style (i.e., the
specification either omits `style`/`explode` or declares exactly the OpenAPI default for that
location) renders identically to before this feature **except** that its values are now
percent-encoded where they weren't previously (spec User Story 2, additive). A specification with
no character requiring encoding in any generated value (the common case for today's existing
fixtures) therefore renders byte-identical output. Fixtures that do need updated expected output
after this change must be scoped to `backend/tests/fixtures/postman/parameterFixtures.ts` (new),
never by editing `exportFixtures.ts`'s existing scalar-only fixtures out from under other tests.
