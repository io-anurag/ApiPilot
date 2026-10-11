# Contract: Coverage routes (AP-046)

Both routes are session-scoped (the existing session middleware), read-only, and compute from the session's current workflow plus stored runs. They never mutate state, call no AI, and make no network requests. Types are in `packages/shared-domain/src/coverage.ts` (see [data-model.md](../data-model.md)).

## `GET /api/coverage`

### Request

Query parameters, all optional:

| Parameter | Values | Effect |
|---|---|---|
| `runId` | a run id visible to the session | Evaluate that run only instead of the latest qualifying run per scenario |
| `method` | HTTP method, repeatable | Filter operations table, gaps and recommendations |
| `q` | text, max 200 chars | Case-insensitive substring match on path |
| `state` | `CoverageState`, repeatable | Filter by requirement state |
| `category` | `positive \| negative \| boundary \| security` | Restrict requirements to the group; `security` returns 400 `category_unavailable` with the reason (additive) |
| `priority` | `high \| medium \| low`, repeatable | Filter by priority |
| `gapKind` | `missing \| failed \| insufficient \| stale` | Missing coverage, executed failure, inconclusive evidence, or evidence needing re-execution (additive; `stale` is accepted but yields no rows until decision D-1) |
| `sort` | `priority \| method \| path \| specification \| runtime` | Default `priority` |
| `order` | `asc \| desc` | Default per sort key |

Filtering narrows `operations`, `gaps`, `recommendations` and the filter-sensitive `metrics`; the unfiltered totals are always returned as `totals` so the UI can show "X of Y".

### Responses

| Status | Body | When |
|---|---|---|
| 200 | `CoverageSnapshot` | Normal, including zero scenarios and zero runs (values are real zeros, notices explain) |
| 400 | `{ error: "invalid_filter", message }` | Unknown enumeration value or over-long `q` |
| 404 | `{ error: "run_not_found", message }` | `runId` not visible to the session |
| 409 | `{ error: "no_active_workflow", message }` | Session has no workflow with an `ApiModel`; the UI shows an empty state with a link to the specification step |
| 500 | `{ error: "internal_server_error" }` | Centralized handler; no stack, paths or internals |

### Guarantees

- Identical inputs and `calculatedAt` produce identical bodies (deterministic ordering everywhere).
- No `NaN`, `Infinity` or missing percentage: zero denominators yield `percentage: null` and `available: false`.
- No request or response bodies, header values, URLs with query strings, tokens, cookies, `rawCapture` or environment variable values appear in the body.
- A run whose results cannot be joined to a current scenario contributes only to `execution.unattributedResults` and a notice.
- The snapshot names the evidence mode, contributing runs and environments; exports repeat them.
- Rejected review scenarios never count; accepted and pending counts are reported in `context.scenarioCounts`.

## `GET /api/coverage/export`

### Request

Same query parameters as above plus:

| Parameter | Values | Effect |
|---|---|---|
| `format` | `html \| json` (required) | Output format |
| `scope` | `filtered \| all` (default `filtered`) | Apply the filters or export the unfiltered view |

### Responses

| Status | Body | When |
|---|---|---|
| 200 | `text/html; charset=utf-8` or `application/json`, `Content-Disposition: attachment` | Normal |
| 400, 404, 409, 500 | As above | As above |

### Guarantees

- Both formats are produced from the same `filterSnapshot` output as the screen route, so figures match the chosen scope (FR-037).
- The document includes specification name and revision, generation and execution context, metric definitions and denominators, both coverage dimensions, gaps with priority and rationale, not-measurable items, and evidence references (run id, scenario id, item id, outcome). The HTML is self-contained and escapes all interpolated text.
- No new dependency; no PDF output.

## Frontend client contract

`services/coverageClient.ts` returns `{ ok: true, snapshot } | { ok: false, error, message }`, mapping the codes above to user-facing states: `no_active_workflow` → empty state, `run_not_found` → recoverable error, `invalid_filter` → logged client defect, network failure → error state (never rendered as empty coverage).
