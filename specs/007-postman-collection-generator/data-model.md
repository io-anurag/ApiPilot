# AP-007 Data Model

All types below are framework-independent and belong in
`packages/shared-domain/src/postmanArtifact.ts`, except where noted as internal to the backend
generator. Nothing here changes `ApiModel`, `TestModel`, `TestScenario`, or `Provenance`.

## Inputs

The export consumes contracts that already exist:

| Input        | Source                                     | Role                                                        |
| ------------ | ------------------------------------------ | ----------------------------------------------------------- |
| `ApiModel`   | AP-002                                     | Grouping (tags), security schemes, request body content types |
| `TestModel`  | AP-006 `projectApprovedTestModel`          | The approved scenarios, already free of pending and rejected |
| `ExportOptions` | The engineer, at export time            | Optional base address and variable values                    |

An approved `TestModel` reaching this boundary is treated as approved because AP-006 produced it;
this feature re-checks that every scenario carries a provenance and a resolvable operation, and
rejects the export otherwise rather than assuming.

## ExportOptions

| Field             | Meaning                                        | Invariant                                                    |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `baseUrl`         | Address the engineer will run against          | Optional; when absent the variable is declared with an empty value |
| `variableValues`  | Values for declared variables, by variable name | Optional; only names the collection actually references are accepted |
| `collectionName`  | Name for the generated collection              | Optional; defaults to a deterministic name; never affects request content |

`variableValues` never reaches the collection artifact. Values for variables marked `secret` are
written only into the environment artifact (FR-011).

## ArtifactVariable

One named placeholder the collection references.

| Field         | Meaning                                     | Invariant                                                    |
| ------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `name`        | Variable name, e.g. `baseUrl`, `token`      | Unique within an export; referenced as `{{name}}`             |
| `purpose`     | Human-readable reason the variable exists   | Non-empty; appears in the accompanying document               |
| `secret`      | Whether the variable holds a credential      | `true` for credential variables; drives the environment's value type |
| `value`       | Engineer-supplied value, if any             | Empty string when unsupplied; never invented (FR-012)          |

Standard variables: `baseUrl` (always declared), plus `token`, `username`, `password`, `apiKey` as
the mapped security schemes require, plus one variable per path parameter that has no approved
value.

## PostmanCollection

The executable artifact. Typed as the subset of Postman Collection Format v2.1.0 that ApiPilot
emits; the generator never produces a field outside this subset.

- `info`: name, a content-derived `_postman_id`, and the v2.1.0 schema identifier.
- `auth`: collection-level auth when every operation shares one mapped requirement; otherwise absent
  and applied per request.
- `variable`: the declared `ArtifactVariable` names with empty values, so the collection is importable
  and runnable without the environment file present.
- `item`: an ordered list of `PostmanFolder`.

### PostmanFolder

| Field    | Meaning                                | Invariant                                                     |
| -------- | -------------------------------------- | ------------------------------------------------------------- |
| `name`   | Grouping label                         | Derived from operation tags; deterministic fallback when absent |
| `item`   | Ordered `PostmanRequestItem` list      | Non-empty; a folder is only emitted when it has requests        |

Folder name derivation: the operation's first tag in declaration order; when an operation has no
tags, the fallback grouping is the first path segment; when the path has no segment, the fallback is
a single `Ungrouped` folder. Names that collide after normalization are disambiguated by appending
the lowest unused numeric suffix in a deterministic pass.

### PostmanRequestItem

| Field      | Meaning                                       | Invariant                                                       |
| ---------- | --------------------------------------------- | ---------------------------------------------------------------- |
| `id`       | Content-derived identifier                    | A pure function of the approved scenario id (FR-026)              |
| `name`     | `METHOD /path — category` plus disambiguation | Identifies operation and scenario purpose without opening it (FR-005) |
| `request`  | Method, URL, headers, body, auth              | Every value copied from the approved scenario (FR-003)            |
| `event`    | A single `test` script, when assertions exist | Absent when the scenario carries no assertions (FR-007)           |

The URL is composed as `{{baseUrl}}` plus the operation path with each path parameter as a `:name`
segment, the approved path parameter values in the URL `variable` list, and approved query
parameters in the URL `query` list. The body carries the content type re-derived from the `ApiModel`
(see research.md).

## Assertion translation

| TestModel assertion                        | Emitted check                                  |
| ------------------------------------------ | ----------------------------------------------- |
| `status-code` with exact code, e.g. `201`  | Response status equals that code                 |
| `status-code` with wildcard, e.g. `4XX`    | Response status falls in that class              |
| `status-code` with `default`               | No check; recorded as a `GenerationLimitation`   |
| `schema-conformance` with `expectedSchema` | Response body conforms to the converted schema   |
| No assertions                              | No script; recorded as a `GenerationLimitation`  |

`SchemaConstraint` converts to a JSON Schema object by copying only the fields that were actually
declared: `type`, `enum`, `format`, `minimum`, `maximum`, `pattern`, `minLength`, `maxLength`,
`minItems`, `maxItems`, recursive `properties` and `items`, and `required` only when non-empty.
Absent constraints are omitted rather than defaulted, so the emitted schema is exactly as strict as
the specification was (constitution I).

## PostmanEnvironment

| Field                      | Meaning                              | Invariant                                          |
| -------------------------- | ------------------------------------ | --------------------------------------------------- |
| `name`                     | Environment name                     | Deterministic, derived from the collection name      |
| `_postman_variable_scope`  | Fixed scope marker                   | Always `environment`                                 |
| `values`                   | One entry per `ArtifactVariable`     | Ordered by name; secret variables typed as secret    |

Each entry carries `key`, `value`, `type` (`secret` for credential variables, `default` otherwise),
and `enabled`. Supplied values appear here and only here.

## ArtifactDocument

The accompanying `README.md`, generated deterministically from the export result. It states the
request count, the folder organization, the counts of approved scenarios by provenance source
(`RULE` and `AI` — the only origins `Provenance.source` carries; the user-modified flag lives on
AP-006's `ReviewScenario`, which this boundary does not receive), the variables that must be
supplied before running with their
purposes, how to import and run the artifacts, and the full limitation list. It contains no request
payloads and no variable values (FR-025).

## ValidationReport

| Field       | Meaning                              | Invariant                                                  |
| ----------- | ------------------------------------ | ----------------------------------------------------------- |
| `valid`     | Whether the collection passed        | `false` blocks delivery entirely (FR-015)                   |
| `problems`  | Ordered list of failures             | Each names the failing location and what was expected        |

Validation runs on the serialized collection before the response is built. Checked invariants
include: required top-level and item fields present; every URL beginning with `{{baseUrl}}`; no
literal host anywhere in the artifact; no value matching a credential pattern outside a `{{…}}`
reference; every `{{…}}` reference declared as an `ArtifactVariable`; every item id unique;
folders and items in the defined order; and every emitted field within the supported subset.

## GenerationLimitation

A recorded case where approved test intent could not be fully expressed.

| Field         | Meaning                                              | Invariant                                     |
| ------------- | ---------------------------------------------------- | ---------------------------------------------- |
| `kind`        | One of the categories below                          | Drives grouping in the accompanying document   |
| `scenarioId`  | Affected scenario, when the limitation is per-scenario | Absent for operation-level limitations       |
| `location`    | Operation path and method, or the artifact location  | Non-empty                                      |
| `message`     | What could not be expressed and why                  | Non-empty; contains no payload or credential   |

Kinds: `no-expected-outcome`, `undocumented-status-code`, `unsupported-auth-scheme`,
`unsupported-content-type`, `unresolved-path-parameter`, `specification-analysis-issue`,
`alternative-auth-requirement-selected`.

A limitation never blocks the export; a validation problem always does. That distinction is the
difference between "we told you what we could not express" and "we produced something broken".

## ExportResult

The single value the generator returns and the endpoint serializes.

| Field         | Meaning                                     |
| ------------- | ------------------------------------------- |
| `collection`  | The `PostmanCollection`                     |
| `environment` | The `PostmanEnvironment`                    |
| `readme`      | The `ArtifactDocument` content              |
| `validation`  | The `ValidationReport`                      |
| `limitations` | Ordered `GenerationLimitation` list          |
| `summary`     | Request count and counts by provenance source |

## Failure outcomes

These are refusals, not results. Each produces an error response rather than an `ExportResult`.

| Outcome                     | Cause                                                    | Requirement |
| --------------------------- | -------------------------------------------------------- | ----------- |
| `empty-approved-test-model` | The approved TestModel has no scenarios                   | FR-020      |
| `unknown-operation`         | A scenario references an operation absent from the ApiModel | FR-002    |
| `workflow-intent-unsupported` | The TestModel carries multi-step workflow intent        | FR-030      |
| `collection-validation-failed` | The generated collection failed validation             | FR-015      |
