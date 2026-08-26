# Phase 0 Research: OpenAPI Specification Engine

## Decision: YAML parsing library — `js-yaml`

**Rationale**: `js-yaml` is the de facto standard YAML parser in the Node.js ecosystem —
mature, widely used, actively maintained, and dependency-light. It parses YAML 1.1/1.2 into
plain JavaScript objects, which is exactly what is needed before OpenAPI-specific
validation runs. Using a standard library instead of a hand-rolled parser satisfies
constitution XXVIII (prefer mature standard implementations over reinventing them).

**Alternatives considered**: A custom YAML tokenizer/parser was rejected — YAML has many
edge cases (anchors, multi-document streams, flow vs. block style) that a mature library
already handles correctly and safely (e.g., guarding against unsafe type coercion).

## Decision: OpenAPI validation & `$ref` resolution — `@apidevtools/swagger-parser`

**Rationale**: `swagger-parser` is a mature, widely-adopted library that validates OpenAPI
3.x (and Swagger 2.0) documents against the official schema and resolves `$ref` pointers
(`dereference`/`bundle` APIs), including built-in circular-reference detection
(`$refs.circular`). Using it directly satisfies FR-003 (validation), FR-005 (internal `$ref`
resolution), and FR-006 (circular/unresolved ref detection) without building a custom
OpenAPI validator, consistent with constitution XXVII (Prefer Simple Architecture) and
XXVIII (Technology Is Replaceable).

**Version gating**: Because the library also accepts Swagger 2.0 documents, this feature
performs an explicit check on the document's declared `openapi` field (must start with
`"3."`) before further processing, and rejects anything else with a clear "unsupported
version" error (FR-004) — the library's own acceptance of 2.0 documents is not sufficient
to satisfy the "OpenAPI 3.x only" scope decision.

**External `$ref` handling**: Only internal (same-document, `#/...`) references are
resolved. Before invoking dereferencing, the raw document is scanned for any `$ref` value
that does not start with `#/`; each such reference is recorded as "unresolved (external)"
in the Analysis Summary and is never fetched over the network or filesystem — satisfying
FR-006 and the spec's Assumption that external `$ref` resolution is out of scope, while
avoiding any unintended outbound network/file access (constitution XVII).

**Alternatives considered**: A hand-written JSON Schema validator plus custom `$ref`
resolver was rejected as unnecessary reinvention of a well-solved problem, and as a larger
attack surface for path-traversal/SSRF-style risks around `$ref` resolution than a
battle-tested library configured conservatively.

## Decision: File upload handling — `multer` (in-memory storage)

**Rationale**: `multer` is the standard Express middleware for `multipart/form-data` file
uploads. Configuring it with in-memory storage (`memoryStorage`) and an explicit `limits.
fileSize` matching the documented maximum (FR-015) rejects oversized uploads at the HTTP
boundary before any parsing occurs, and avoids ever writing the uploaded file to disk —
consistent with the "no persistence" decision below and constitution XVII.

**Alternatives considered**: Disk-based storage (`diskStorage`) was rejected because it
would persist potentially sensitive specification content to disk without a documented
need, increasing the security/privacy surface for no benefit at this stage.

## Decision: No persistence — uploaded specs and the derived `ApiModel` are in-memory only

**Rationale**: The uploaded specification and its derived `ApiModel` exist only for the
duration of a single analysis request/response cycle (or, at most, the current server
process's memory for the active session) and are never written to a database or disk. This
is the simplest possible design (constitution XXVII), avoids unnecessary retention of
potentially sensitive, proprietary API contracts (constitution XVII), and is consistent
with AP-001's stateless backend. It is intentionally the more conservative and easily
reversible choice: adding persistence later (e.g., to let a user revisit a prior analysis)
is a straightforward additive change, whereas starting with persistence and later having to
remove it would be a larger, riskier rework.

**Alternatives considered**: Persisting uploaded specs/`ApiModel` to a local file or
embedded database was rejected for this feature — no requirement in the spec or roadmap
calls for revisiting a previous analysis across sessions, and introducing storage now would
be infrastructure added "because it might be useful later," which constitution XXVII
explicitly disallows without a proven need.

## Decision: Duplicate `operationId` / path+method handling — accept and flag, do not reject

**Rationale**: A specification with a duplicate `operationId` or duplicate path+method
combination is still a validly structured OpenAPI document from a parsing standpoint (the
duplication itself is a spec-authoring problem, not a syntax error). Rejecting the entire
upload would prevent the QA engineer from seeing anything at all. Instead, duplicates are
detected during extraction and listed explicitly in the Analysis Summary as a flagged
ambiguity (FR-013), consistent with "fail safely" (constitution XIX) by surfacing the issue
rather than silently keeping only one occurrence or silently rejecting useful input.

**Alternatives considered**: Rejecting the whole specification outright was rejected as too
strict — it would block otherwise-usable specifications over a single naming collision that
the QA engineer may want to see surfaced and fix at the source, not be blocked by ApiPilot.

## Decision: Security requirement representation — preserve raw OpenAPI structure (OR-of-ANDs)

**Rationale**: OpenAPI represents a security requirement as an array of objects, where the
array expresses "any of" (OR) and the keys within a single object express "all of" (AND).
The `ApiModel`'s `SecurityScheme` requirement representation mirrors this structure exactly
(a list of requirement sets, each a list of scheme references with required scopes) rather
than collapsing it into a simplified single-scheme-per-operation model. This satisfies
constitution I (Specification Is the Source of Truth) by not losing or distorting
information the specification actually declares.

**Alternatives considered**: A simplified "one required scheme per operation" model was
rejected because it cannot represent legitimate OpenAPI documents that declare alternative
or combined authentication requirements, which would silently misrepresent the contract.
