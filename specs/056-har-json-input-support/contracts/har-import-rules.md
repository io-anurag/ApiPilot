# Behavioural Contract: HAR Import Rules

The deterministic rules the HAR adapter applies. Identical input and limits produce identical output (FR-022), independent
of wall-clock time, randomness, locale and environment. Rationale and alternatives: [research.md](../research.md)
R8 to R19.

## Pipeline

```text
bytes -> detect (JSON, markers) -> validateHar -> per entry: extractEntry (allow-list + redact)
      -> classifyEntry (malformed | excluded | imported) -> originScope -> normalize paths
      -> inferPathParameters -> mergeObservations -> inferSchema -> detectDependencies
      -> buildHarModel (collisions, issue caps, reconciliation) -> ApiModel + ImportAnalysisReport
```

Nothing in the pipeline executes content, replays a request, resolves a `$ref`, opens a socket or reads a path named in
the file (FR-046). Analysis is `async` and yields every 100 entries without affecting output.

## Structural validation (FR-009)

1. Document parses as JSON within the nesting limit (detection).
2. `log` is an object, `log.entries` is an array. Otherwise `invalid_har`.
3. `log.entries` has at least one element. Otherwise `invalid_har` ("the capture contains no entries").
4. Entry count is at most `INPUT_HAR_MAX_ENTRIES`. Otherwise `input_limit_exceeded`.

`log.version`, `log.creator.name` and `log.creator.version` are read for the report only.

## Entry extraction (allow-list)

`extractEntry` builds a new object from only these fields, each optional unless marked:

`request.method` (required), `request.url` (required), `request.headers[]` (`name`, `value`), `request.queryString[]`,
`request.cookies[]` (names only), `request.postData` (`mimeType`, `text`, `params`), `response.status` (required),
`response.headers[]`, `response.cookies[]` (names only), `response.content` (`mimeType`, `text`, `encoding`, `size`),
`startedDateTime`, `time`, `pageref`, `_resourceType`, and the presence (not content) of `_webSocketMessages`. Every other
property, including every `_`-prefixed tool extension, is ignored.

Credential values, including form-field values, are replaced here (see *Redaction*). The placeholder `[redacted:<kind>]` is
recognized by the Postman exporter and turned into a variable reference ([postman-artifact-amendment.md](postman-artifact-amendment.md)). A removed-value count is accumulated per
`(location, name, kind)`.

## Malformed entries (FR-011)

An entry is malformed, listed with its zero-based position and a reason, and contributes nothing, when: it is not an
object (`not-an-object`); `request.url` is missing or not a string (`missing-url`); `request.method` is missing or empty
(`missing-method`); `request.url` does not parse (`invalid-url`) or is relative (`relative-url`); `response.status` is
missing or not an integer (`missing-response-status`). Malformed entries never stop analysis of the rest.

## Redaction (FR-047, FR-050)

Values are replaced by `[redacted:<kind>]`, `kind` in `token | apiKey | password | cookie | session`. Detected by:

| Where | Rule |
| --- | --- |
| Header name | `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `api-key` (existing predicate), plus `x-auth-token`, `x-csrf-token`, `x-xsrf-token`, `x-amz-security-token`, plus any name matching `password|secret|token|api[-_]?key|credential|bearer` |
| Query, form field, cookie and JSON body field name | The same pattern, plus exact (case-insensitive) names `key`, `sig`, `signature`, `sid`, `sessionid`, `session`, `auth`, `authorization`, `jsessionid`, `code`, `jwt` |
| Value | JWT (`eyJ` prefix, three base64url segments), `Bearer <token>`, `Basic <base64>`, AWS access key id (`AKIA` + 16 `[A-Z0-9]`) |
| URL | Userinfo (`user:pass@`) is removed from the URL; recorded as location `url-userinfo`, and the entry is listed in the report by position and host (`credentialUrlEntries`, first 20, plus `credentialUrlCount`), never with the userinfo (FR-050) |
| Cookies | Every cookie value, request and response |

Redaction preserves the structure of a body: a credential-named JSON field stays, with a placeholder value. The model records
`credentialsObserved` (location, name, kind, observation count) and never a value. One informational
`credential-detected` issue is raised per operation naming kinds and locations, never values. Report and logs carry
counts only.

## Normalization (FR-012)

URL and path normalization, applied in order:

1. Parse with `new URL(url)`. Scheme and host are lower-cased; the default port (80 for http, 443 for https) is removed.
2. Origin = `scheme://host[:port]`. Userinfo is dropped (and recorded as a credential observation).
3. Path: drop query and fragment.
4. Remove dot segments per RFC 3986 section 5.2.4 (string operation only).
5. Collapse runs of `/` into one.
6. Decode percent-escapes of unreserved characters (`A-Z a-z 0-9 - . _ ~`) and upper-case the hex digits of all other
   escapes. `%2F` is never decoded.
7. Remove one trailing `/` unless the path is exactly `/`.
8. Segment case is preserved.

The report counts folded trailing slashes, collapsed duplicate slashes and removed dot segments. The first 3 raw paths of
each operation are kept as examples.

## Classification and exclusion (FR-019)

Rules apply in this order; the first match decides. Exactly one reason per entry.

| # | Outcome | Reason | Condition |
| --- | --- | --- | --- |
| 1 | malformed | see above | |
| 2 | excluded | `non-http-scheme` | scheme is not `http` or `https` (`ws`, `wss` also raise `unsupported-content`) |
| 3 | excluded | `cors-preflight` | method `OPTIONS` with an `Access-Control-Request-Method` request header |
| 4 | excluded | `streaming` | response mime type `text/event-stream`, or `_webSocketMessages` present (also `unsupported-content`) |
| 5 | excluded | `failed-request` | `response.status === 0` |
| 6 | excluded | `redirect` | status 300 to 399 except 304 |
| 7 | excluded | `not-modified` | status 304 |
| 8 | excluded | `analytics-telemetry` | host equals or is a subdomain of an entry in `analyticsHosts.ts` (checked before static assets so an analytics beacon is reported as analytics) |
| 9 | excluded | `static-asset` | `GET` or `HEAD` and (response mime `image/*`, `font/*`, `text/css`, `*/javascript`, or path extension in `.js .mjs .css .map .png .jpg .jpeg .gif .svg .ico .webp .woff .woff2 .ttf .otf .eot`) |
| 10 | excluded | `html-document` | response mime `text/html` |
| 11 | excluded | `third-party-origin` | origin not related to an anchor origin (see *First-party scope*) |
| 12 | excluded | `duplicate-method-path-other-origin` | lost a cross-origin `(method, path)` collision |

`analyticsHosts.ts` is a frozen, alphabetized constant and part of the documented contract. Initial entries:
`amplitude.com`, `clarity.ms`, `datadoghq.com`, `doubleclick.net`, `facebook.net`, `fullstory.com`,
`google-analytics.com`, `googletagmanager.com`, `googlesyndication.com`, `hotjar.com`, `hotjar.io`, `heapanalytics.com`,
`intercom.io`, `mixpanel.com`, `newrelic.com`, `nr-data.net`, `optimizely.com`, `px.ads.linkedin.com`, `segment.com`,
`segment.io`, `sentry.io`, `snowplowanalytics.com`.

`imported + excluded + malformed = total` always holds (FR-020).

### First-party scope

Anchor origins: the origin of each parseable `log.pages[].title` URL, plus the *primary API origin*, the origin with the
most API-like entries (response mime type JSON, XML or `+json`, a JSON request body, or `_resourceType` of `xhr` or
`fetch`; ties: lexicographically smallest origin). An origin is related when its **site key** equals an anchor's. Site
key: the last two host labels, or the last three when the second-level label is one of `co com org net gov ac edu`.
IP-address hosts and `localhost` compare by exact host. The primary origin is computed only over entries that reach rule
11 (that is, entries not already malformed or excluded by rules 1 to 10), so analytics and static traffic cannot
influence it.

## Ordering (determinism)

Entries are processed in chronological order. If every non-malformed entry has a valid `startedDateTime`, order is
`(timestamp, entry index)`; otherwise order is the entry index. Operations are ordered: primary origin first, then path
ascending by code point, then method rank `GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE`.

## Path parameter inference (FR-013)

Identifier-like segment: all digits; UUID; at least 8 hex characters (which includes a 24-character object id); ULID (26
characters of Crockford base32); an ISO date (`YYYY-MM-DD`); or at least 12 characters of letters, digits, `_` and `-` that
contain both a letter and a digit (`ord_7f3a9c21d4`). Everything else is literal. Within `(origin, method, segment count)`, a path's skeleton replaces identifier-like segments with a wildcard.
A wildcard position with at least 2 distinct values across a skeleton group becomes a path parameter (`inferred`,
`observationCount` = distinct values). A wildcard position with 1 distinct value stays literal and raises
`ambiguous-path` ("possible path parameter, insufficient evidence"). Parameter names: singularized preceding literal
segment + `Id`, else `id`, with numeric suffix on collision.

## Merging (FR-014)

Per operation: observation count; `statusCounts`; `queryParameterCounts` and `headerCounts` (denominator is the
operation's observation count); up to 5 examples (identical examples collapse and are counted; order: observations
descending, then first entry index). Non-path parameters get `requiredUnknown: true`. Request headers are kept except the
transport and browser noise set: `host`, `connection`, `content-length`, `accept-encoding`, `accept-language`,
`user-agent`, `origin`, `referer`, `pragma`, `cache-control`, `upgrade-insecure-requests`, `dnt`, any `sec-*`, any
HTTP/2 pseudo-header (`:method` and the like), and `if-*` conditional headers. `content-type` and `accept` are kept.

## Schema inference (FR-015)

Structural only: `type`, `properties`, `items`, `required`. `required` is the set of paths present in every observation of
that body. Never inferred: `enum`, `format`, ranges, patterns, lengths, item counts. Schemas are kept per direction, per
status, per content type. Disagreeing types: the field has no `type` and `conflicting-types` is raised (operation, status,
field path, never a value). `integer` and `number` observations of one field are `number`. Evidence
(`presentIn`, type histogram, observation total) is recorded per field path.

## Body handling (FR-018)

| Situation | Result |
| --- | --- |
| No `postData`/`content` | `missing` |
| Empty text | `empty` |
| `content.encoding: "base64"` | decoded if declared size is within the body limit; else `oversized` |
| Any other declared encoding | `undecodable-encoding` |
| `Content-Encoding` gzip, br or deflate and no usable text | `compressed` (never decompressed) |
| Binary mime type | `binary` |
| Text longer than `INPUT_MAX_BODY_BYTES` | `oversized` |
| Declared JSON that does not parse | `invalid-json` |
| Declared `content.size` larger than the text length | `truncated` |
| JSON nested deeper than 32 | `too-deep` |
| `application/x-www-form-urlencoded` | available as a flat object of field name to string value, from `postData.params` (or parsed from `postData.text` when `params` is absent); credential values replaced; duplicate field names keep the first value and are counted as an `incomplete-observation` |
| `multipart/form-data`, text fields only | available as a flat object of text field name to string value, from `postData.params`; credential values replaced |
| `multipart/form-data` with a part that has `fileName` or `contentType` (file content) | `multipart-file`: the request body is unavailable for replay; the text fields are still recorded as evidence |
| Parses as JSON | available |

An entry with an unavailable body still contributes method, path, status and its other facts. One `unsupported-content`
(binary, compressed, encoding, streaming, multipart-file, too-deep, oversized) or `incomplete-observation` (missing,
truncated, invalid-json, duplicate form field) issue is raised per `(operation, reason)`.

Form bodies are modelled as a content type whose constraint has one string-typed property per observed field and `required`
per the all-observations rule; presence is the only structure inferred (spec edge case). A request example with such a body
carries `body` as the flat object and `contentType`.

## Dependency evidence (FR-038)

See [observed-generation-rules.md](observed-generation-rules.md), *Dependency evidence*.

## Limits (FR-045)

| Limit | Default | Variable | Effect on exceed |
| --- | --- | --- | --- |
| Upload size | 10 MiB | (unchanged) | `413 file_too_large` |
| HAR entries | 5,000 | `INPUT_HAR_MAX_ENTRIES` | `413 input_limit_exceeded` |
| Document JSON nesting | 128 | `INPUT_MAX_JSON_DEPTH` | `413 input_limit_exceeded` |
| Analyzed body size | 1,048,576 bytes | `INPUT_MAX_BODY_BYTES` | body skipped (`oversized`), reported in `limitsApplied` |
| Embedded body nesting | 32 | constant | body skipped (`too-deep`) |
| Derived operations | 2,000 | constant | `413 input_limit_exceeded` |
| Examples per operation | 5 | constant | extras counted |
| Issues per kind | 200 | constant | one summary issue |
| Exclusion samples per reason | 20 | constant | counts only |

## Report (FR-020, FR-042)

`ApiModel.importReport` is an `ImportAnalysisReport` ([data-model.md](../data-model.md)). It contains no credential value.
Exclusions are grouped by reason with counts and up to 20 redacted samples (method, host, normalized path). Every
`ambiguous-path`, `conflicting-types`, `unsupported-content`, `incomplete-observation` and `credential-detected` finding is
also an `AnalysisIssue` in `summary.issues`, so the existing issue presentation shows it (US3 scenario 4).

## Never assumed (FR-016, FR-017)

The model contains no status code, field, constraint, authentication scheme, response header or assertion that was not
observed. Unknown values are unknown (`requiredUnknown`), not defaulted. `securitySchemes` is empty for HAR input.
