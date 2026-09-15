# Quickstart: Validating Specification-Conformant Parameter Serialization

This is a validation guide, not an implementation guide — see `data-model.md` and
`contracts/parameter-serialization.md` for the actual type/function contracts, and `tasks.md` for
the implementation task breakdown.

## Prerequisites

- Repository dependencies installed (`npm install` at the repo root — npm workspaces).
- Backend workspace buildable: `npm run build -w backend`.

## Scenario 1 — Array query parameter, default style (`form`/`explode: true`)

1. Analyze a specification containing a `GET` operation with a query parameter `sort` declared as
   `type: array, items: { type: string }` and no `style`/`explode` (the OpenAPI default applies).
2. Run the deterministic test designer to produce a positive scenario for that operation, where
   `sort` receives an array value (e.g. `["name", "-price"]`).
3. Export the approved scenario to a Postman collection.
4. **Expected**: The rendered request's URL query string contains `sort=name&sort=-price` (two
   repeated `sort` entries, in the array's own order) — not `sort=%5B%22name%22%2C%22-price%22%5D`
   (a percent-encoded JSON array) and not `sort=["name","-price"]` (today's bug).

## Scenario 2 — Array query parameter, `form`/`explode: false`

1. Same as Scenario 1, but the specification declares `style: form, explode: false` on `sort`.
2. **Expected**: `sort=name,-price` — one entry, comma-joined, comma literal.

## Scenario 3 — `spaceDelimited` / `pipeDelimited`

1. Same as Scenario 1, but `style: spaceDelimited, explode: false` (or `pipeDelimited`).
2. **Expected**: `sort=name%20-price` (space encoded as `%20`) or `sort=name|-price` (pipe
   literal), respectively.

## Scenario 4 — `deepObject` query parameter

1. A query parameter `filter` declared `type: object, properties: { status: {...}, owner: {...}
   } }` with `style: deepObject`.
2. **Expected**: `filter[status]=active&filter[owner]=alice` (one entry per property).

## Scenario 5 — Percent-encoding a special character

1. A boundary-string rule generates a value containing `&` for a query parameter (e.g. a
   maxLength boundary string `"a&b"`).
2. **Expected**: The rendered URL contains `%26` in place of the raw `&`; parsing the rendered
   query string back with a standard parser yields the original `"a&b"` value for that one
   parameter — it is never misread as introducing a second parameter.

## Scenario 6 — Unsupported style (`matrix`)

1. A path parameter declares `style: matrix`.
2. Export a scenario for that operation.
3. **Expected**: The collection still contains a runnable request for that scenario (using
   today's existing plain-text rendering for that one parameter), and
   `ExportResult.limitations` contains exactly one entry with
   `kind: "unresolved-parameter-style"` naming the operation, the parameter, and `"matrix"`.

## Scenario 7 — Negative scenario, runtime-type mismatch

1. An `invalid-type` scenario substitutes a plain string for an array-typed query parameter.
2. **Expected**: The rendered URL contains one scalar `key=value` entry (the substituted string,
   percent-encoded) — serialization follows the value's actual runtime shape, not the schema's
   declared `array` type; the negative scenario's constraint violation is preserved, not "repaired"
   by array-aware serialization.

## Scenario 8 — Determinism / re-export stability (SC-004)

1. Export the same approved `TestModel` twice without any review-decision change.
2. **Expected**: `serializeArtifact(collection)` and `serializeArtifact(environment)` are
   byte-identical across both exports (same check `reexportStability.test.ts` already performs for
   every other rendering concern).

## Automated coverage

These scenarios map directly onto:
- `backend/tests/unit/postman/parameterSerialization.test.ts` (new) — Scenarios 1-4, 7.
- `backend/tests/unit/postman/requestItem.test.ts` (extended) — Scenarios 5, 6, end-to-end
  request-item assembly.
- `backend/tests/unit/openapi/buildApiModel.test.ts` (extended) — `style`/`explode`/
  `contentEncoded` extraction and per-location default resolution.
- `backend/tests/unit/postman/reexportStability.test.ts` / `determinism.test.ts` (extended) —
  Scenario 8.
- `backend/tests/integration/postmanCollection.test.ts` (extended) — one HTTP-level end-to-end
  case combining an array and an object query parameter.
