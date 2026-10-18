# Contract Amendment: Upload and Format Detection

Amends [specs/002-openapi-specification-engine/contracts/specifications-api.md](../../002-openapi-specification-engine/contracts/specifications-api.md)
and [specs/009-e2e-test-generation-workflow/contracts/test-generation-workflow-api.md](../../009-e2e-test-generation-workflow/contracts/test-generation-workflow-api.md).
Everything not stated here is unchanged. All additions are additive (FR-053).

Affected routes:

- `POST /api/specifications` (stateless analysis, returns the model)
- `POST /api/test-generation-workflow` (starts the guided workflow; `?discardExisting=true` unchanged)

Not affected: the AP-032 quick performance upload, which stays OpenAPI-YAML-only (FR-054), and the standalone Postman
collection import (`/api/external-collections`).

## Request

Unchanged: `multipart/form-data`, one `file` field, memory-only, **10 MiB** limit enforced before parsing (not raised).
The accepted file extensions in the UI are `.yaml`, `.yml`, `.json`, `.har`. The server never routes by extension or
filename; any bytes are judged by content (R3).

## Success: `200 OK`

### `POST /api/specifications`

```json
{
  "apiModel": { "...": "as today; new optional fields only for HAR and definition input" },
  "input": { "format": "openapi-json", "label": "OpenAPI (JSON)", "filename": "petstore.json" }
}
```

`input` is added for every format, including `openapi-yaml`. `apiModel` for OpenAPI input is unchanged.

### `POST /api/test-generation-workflow`

```json
{ "workflow": { "...": "as today", "input": { "format": "har", "label": "HAR capture", "filename": "capture.har" } } }
```

`workflow.input` is added for every format. For HAR input `workflow.apiModel.importReport` is present (see
[har-import-rules.md](har-import-rules.md), *Report*). `workflow.generationNotes` appears after deterministic generation
when any operation produced no scenarios.

### Format labels

| `format` | `label` |
| --- | --- |
| `openapi-yaml` | `OpenAPI (YAML)` |
| `openapi-json` | `OpenAPI (JSON)` |
| `har` | `HAR capture` |
| `api-definition` | `ApiPilot API definition` |

## Errors

Every error body is `{ "error": "<code>", "message": "<text>" }` with an optional `problems` array of strings. No error
contains a stack trace, a filesystem path, a file name from inside the document, or any value from the document. A
failure creates no workflow and no partial model, and the session's existing workflow is untouched, because the
current workflow is replaced only after analysis succeeds.

| Status | `error` | When | Notes |
| --- | --- | --- | --- |
| 400 | `invalid_yaml` | **Unchanged.** Non-JSON content that fails YAML parsing, and empty, whitespace-only or BOM-only uploads. Also a missing `file` field. | Existing messages, byte for byte. |
| 400 | `unsupported_version` | **Unchanged.** OpenAPI marker present, version not 3.x (including Swagger 2.0), YAML or JSON. | Same message as YAML. |
| 400 | `invalid_json` | Content starts with `{` or `[`, is not valid JSON, and is not valid YAML either. | Message gives the parse position only. |
| 400 | `unrecognized_input_format` | JSON that carries none of the four format markers, or a JSON array or scalar. | Names the supported formats; says nothing was identified. Echoes none of the document. |
| 400 | `ambiguous_input_format` | JSON that carries markers of two or more families. | Names the matched families. No precedence applied. |
| 400 | `postman_collection_detected` | JSON recognized as a Postman collection. | Adds `"redirectTo": "import-run-collection"`. Nothing is imported. The message names Import & Run Collection. |
| 400 | `invalid_har` | HAR marker present but structure invalid: `log.entries` is not an array, or it is empty. | Actionable message per cause (FR-009). |
| 400 | `invalid_definition` | Definition marker present but the document violates version 1. | `problems`: every violation as `"<JSON Pointer>: <corrective message>"` (FR-024). |
| 400 | `no_operations_derived` | A HAR produced no operation (every entry excluded or malformed). | Adds `report`: `{ counts, exclusions, malformedEntries }` so the user sees why (FR-021, US3 scenario 6). |
| 413 | `file_too_large` | **Unchanged.** Over the upload limit. | |
| 413 | `input_limit_exceeded` | Entry count, document nesting depth or derived-operation limit exceeded. | Adds `"limit": "<name>"` and `"maximum": <number>`, and the message names the limit and the remedy (for example, capture a narrower session). |
| 500 | `internal_server_error` | **Unchanged.** Any unexpected failure. | No detail. |

Body-size and body-depth limits do not reject the upload; they skip the body and report it (see
[har-import-rules.md](har-import-rules.md), *Limits*).

`409 workflow_in_progress` on `POST /api/test-generation-workflow` is unchanged and applies to every format.

### Example: unrecognized JSON

```json
{
  "error": "unrecognized_input_format",
  "message": "The JSON file was not recognized. No OpenAPI, HAR, ApiPilot API definition or Postman collection marker was found. Supported inputs: OpenAPI 3.x (YAML or JSON), HAR capture, ApiPilot API definition (JSON)."
}
```

### Example: Postman collection

```json
{
  "error": "postman_collection_detected",
  "message": "This file is a Postman collection, which the guided workflow does not use. Nothing was imported. Open Import & Run Collection to import and run it.",
  "redirectTo": "import-run-collection"
}
```

### Example: HAR with nothing importable

```json
{
  "error": "no_operations_derived",
  "message": "No API operations could be derived from this capture: 212 entries were excluded and 3 were malformed.",
  "report": {
    "counts": { "total": 215, "imported": 0, "excluded": 212, "malformed": 3, "operations": 0 },
    "exclusions": [
      { "reason": "static-asset", "count": 150, "samples": [] },
      { "reason": "analytics-telemetry", "count": 62, "samples": [] }
    ],
    "malformedEntries": [ { "entryIndex": 4, "reason": "missing-response-status" } ]
  }
}
```

## Logging contract

`request_received`, `request_succeeded` and `request_failed` keep their existing fields. The input layer adds events
`input_detected` (`format`, `durationMs`), `har_analyzed` (the five counts, `durationMs`), `definition_validated`
(`problemCount`) and `input_rejected` (`errorCategory`, plus `limit` when applicable). No event carries a URL, header,
body, credential, filename content or document key.

## Frontend client contract

`testGenerationWorkflowClient.startWorkflow` already returns `{ ok: false, error, message, problems? }`; it additionally
exposes `redirectTo` and `report` when present. The page shows `problems` as a list, shows the Postman message with an
action to open Import & Run Collection, and shows `report` counts for `no_operations_derived`.
