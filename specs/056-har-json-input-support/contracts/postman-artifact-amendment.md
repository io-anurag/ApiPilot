# Contract Amendment: Postman Artifact Generation

Amends [specs/007-postman-collection-generator/contracts/postman-collection-api.md](../../007-postman-collection-generator/contracts/postman-collection-api.md).
Required by spec FR-056 (form-style bodies) and FR-048 (no captured credential in an artifact), and by the clarification of
2026-10-18. Everything not stated here is unchanged. **Existing inputs must produce byte-identical artifacts** (FR-034,
SC-002): the changes below fire only on content that did not previously reach them.

Rationale and alternatives: [research.md](../research.md) R24 and R31.

## What the exporter does today (as read 2026-10-18)

- `postman/requestItem.ts` `buildBody` emits a body only for a JSON content type (`raw` mode) or a `text/*` content type
  with a string body. Any other content type emits **no body** and a `unsupported-content-type` limitation.
- Credentials become `{{token}}`-style variable references by **name or shape**: a header by `credentialKindForHeader`, a
  body field by `credentialKindForField`, and a URL value only when it is a `Bearer …` string (`isBearerTokenValue`). A
  credential-named query parameter is not substituted.
- `postman/validateCollection.ts` requires `body.mode === "raw"`.
- `performance/plan/stepRequest.ts` `templateFromItem` reads `item.request.body.raw`.

## 1. Redaction placeholders are recognized as credentials

Redaction (R18) writes `[redacted:<kind>]` with kind `token | apiKey | password | cookie | session`. A single predicate in
`testDesign/sensitiveValueDetection.ts`, `redactionPlaceholderKind(value): CredentialKind | undefined`, recognizes exactly that
form (anything else returns `undefined`) and maps `cookie` and `session` to the existing `token` variable. It is part of the one
shared definition of "this value is a credential" and is used wherever the exporter substitutes:

| Where | Change |
| --- | --- |
| Header value | `credentialKindForHeader(name, value)` also returns the placeholder's kind. |
| Body field (JSON and form) | `credentialKindForField(name, value)` also returns the placeholder's kind. |
| URL value (query and path parameter) | `urlValueText` also substitutes a placeholder with its variable reference. |

A placeholder therefore becomes `{{token}}`, `{{apiKey}}` or `{{password}}` and the variable is declared secret with no value,
as today. For input without placeholders (every OpenAPI input) none of these branches fire.

## 2. Form-style bodies

`buildBody` gains two branches, selected by the operation's primary request content type
(`primaryRequestBodyContentType`, JSON preferred, else the first declared):

| Content type | Body emitted | `Content-Type` header |
| --- | --- | --- |
| `application/x-www-form-urlencoded` | `{ mode: "urlencoded", urlencoded: [{ key, value }, …] }` | set to the content type (as for JSON today) |
| `multipart/form-data` | `{ mode: "formdata", formdata: [{ key, value, type: "text" }, …] }` | **not set**: Postman and Newman add the boundary themselves |

Preconditions: the approved body is a flat object whose values are strings, numbers, booleans or null. Values are written as
text (`String(value)`, null as the empty string), in the object's own key order. Credential-named or placeholder values become
variable references first (section 1). If the body is not a flat object, the existing `unsupported-content-type`
limitation is emitted unchanged and no body is sent.

A multipart part that carried file content never reaches a scenario (spec edge case): the HAR adapter records it as unavailable
(`multipart-file`), so no `formdata` entry of type `file` is ever generated.

For a HAR operation that has form examples, the observed-example rules select only examples whose content type equals the
operation's primary content type, so the emitted body mode always matches the example.

## 3. Validation

`validateCollection` accepts `mode` of `raw`, `urlencoded` and `formdata`. It adds two checks over every item, for all modes:

1. Credential literals in form entries: a key that `credentialKindForField` flags, or a value that is a `Bearer …` string,
   must be a variable reference (as for JSON bodies today).
2. **No placeholder text may remain**: any `[redacted:` occurrence in a URL, header or body is a validation problem. A
   generated collection that would send a literal placeholder fails with `collection_validation_failed` instead, so a gap in
   substitution cannot reach a run silently.

## 4. Consumers of `PostmanBody`

`PostmanBody` becomes a union ([data-model.md](../data-model.md), *postmanArtifact.ts*). The compiler lists the readers:

| Consumer | Required behaviour |
| --- | --- |
| `postman/validateCollection.ts` | Per section 3. |
| `performance/plan/stepRequest.ts` `templateFromItem` | `raw`: unchanged. `urlencoded`: body is the percent-encoded `key=value&…` text with the existing `form` body kind, which the k6 runtime already fills (AP-036 R11). `formdata`: not representable in a request-chain step, so `buildStepRequest` returns an unsupported result (`multipart-body`) instead of a template, and its two callers (`performance/plan/buildJourneys.ts`, `performance/plan/planStepRequest.ts`) skip the step and record it as a left-out step with the reason through the existing seeding note type; it is never silently dropped or sent as raw. The `templateFromItem` call for the OAuth2 token-fetch item is unaffected (never multipart). |
| `execution/newmanRunner.ts` | No change: Newman runs `urlencoded` and `formdata` natively, and the file's own comment already allows non-`raw` modes. |
| Collection editor and view (`externalCollections/collectionView.ts`) | Operate on uploaded collections, not generated ones; unchanged. |

Tasks must confirm there is no other reader by building with the widened type.

## 5. Documents and limitations

The generated README and the limitations panel keep the `unsupported-content-type` entry for content types still not
representable (anything other than JSON, text, urlencoded and multipart text fields). Their wording is updated to list the
supported set; no other text changes.

## 6. Regression guard (SC-002)

- A snapshot test generates the collection, environment and README for every existing OpenAPI fixture before and after the
  change and asserts byte equality.
- Unit tests cover: each new body mode, `Content-Type` header handling, key order, credential substitution in each location,
  the placeholder predicate (accepts only the exact form), the validator's two new checks, and `templateFromItem` for each mode.
- Execution: one Newman-level test posts a urlencoded and a multipart body to a local test server and asserts the server
  received the fields (no external network).
