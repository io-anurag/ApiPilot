# Data Model: Chain Debug Run

All types live in `packages/shared-domain/src/chainDebugRun.ts` and are exported from the package. Nothing here is persisted. The only server-side state is the in-memory reveal store (R5) and a per-plan in-progress flag.

## `MaskedText`

Text whose sensitive parts are replaced by segments.

```text
MaskedText   = readonly TextSegment[]
TextSegment  = { kind: "text"; text: string }
             | { kind: "masked"; valueId: string; revealable: boolean; label: string }
```

- `label` says what was masked in words (for example `Authorization header`, `secret value client_secret`, `field access_token`), never any part of the value.
- Concatenating the `text` segments and a placeholder per masked segment gives the displayed content. Text is never reformatted: with the held values substituted back, the segments reproduce the original bytes exactly.
- `valueId` is meaningful only within one Debug run and is opaque.

## `DebugRunResult`

| Field | Meaning |
|---|---|
| `debugRunId` | Opaque id; keys the reveal store. |
| `planId`, `environment` | Plan id; environment `{ id, name, tier, baseUrl }`. |
| `startedAt`, `durationMs` | Wall-clock start (ISO) and total duration. |
| `outcome` | `"completed" \| "stopped-early" \| "setup-failed" \| "cancelled"`. |
| `setup` | `DebugStepOutcome[]` for the once-before-load steps, in order. |
| `chains` | `DebugChainOutcome[]`, one per chain in plan order. |
| `dataRow` | `{ dataSetName; rowNumber: 1 }[]`, the row used per data set (FR rule: first row). |
| `notes` | Plain statements, such as "Think time not waited out." |

## `DebugChainOutcome`

`{ chainId, chainName, steps: DebugStepOutcome[], stoppedAt?: { stepId, cause } }`

## `DebugStepOutcome`

A discriminated union on `status`.

**`sent`**

| Field | Meaning |
|---|---|
| `stepId`, `stepName` | From the plan. |
| `request` | `{ method; url: MaskedText; headers: DebugHeader[]; body: DebugBody }` as actually sent. |
| `response` | `{ status; statusText; headers: DebugHeader[]; body: DebugBody; redirects: MaskedText[]; sizeBytes } \| null`. `null` when there was no response. |
| `noResponseReason` | `"refused" \| "timeout" \| "dns" \| "host-not-allowed-redirect" \| "aborted" \| "error"`, present when `response` is `null`. |
| `durationMs` | Time to the final response or failure. |
| `statusExpected` | `{ expected: string[]; received: number \| null; ok: boolean }`. |
| `extractors` | `DebugExtractorOutcome[]`. |
| `checks` | `DebugCheckOutcome[]`. |

**`not-sent`**

`{ status: "not-sent"; stepId; stepName; cause: DebugSkipCause }`

`DebugSkipCause`:
- `{ kind: "stopped-by"; stepId; stepName; reason: "extractor-failed" \| "unexpected-status" \| "setup-failed" }`
- `{ kind: "missing-value"; names: string[] }`
- `{ kind: "missing-extracted"; names: string[] }`
- `{ kind: "host-not-allowed"; host: string }`
- `{ kind: "not-reached"; reason: "run-cancelled" \| "run-time-cap" }`

## `DebugHeader` and `DebugBody`

```text
DebugHeader = { name: string; value: MaskedText }
DebugBody   = { kind: "none" }
            | { kind: "text"; contentType: string | null; text: MaskedText;
                sizeBytes: number; truncated: boolean }
            | { kind: "binary"; contentType: string | null; sizeBytes: number }
```

Header names are never masked, only values. Bodies are truncated after masking.

## `DebugExtractorOutcome`

```text
{ extractorId; name; source: { kind: "body"; path } | { kind: "header"; name };
  outcome: { kind: "extracted"; value: MaskedText }
         | { kind: "failed"; reason: DebugExtractorFailure } }

DebugExtractorFailure =
    { code: "not-extracted-status" }                    // not attempted: status was not expected
  | { code: "body-not-json"; contentType: string | null }
  | { code: "path-not-found"; path: string }
  | { code: "value-not-scalar"; found: "object" | "array" | "null" | "empty-text" }
  | { code: "header-missing"; header: string }
```

`extracted` shows a value only as `MaskedText`: a credential-like value is a masked segment (revealable). A non-credential value is shown as text.

## `DebugCheckOutcome`

`{ checkId; kind; passed: boolean; detail: string }` where `detail` states what was compared, for example `expected 200 ms or less, took 412 ms`. A check detail never contains a body value; it names the path or text searched for, which is plan content.

## Reveal store (server memory only)

`Map<debugRunId, { sessionId; expiresAt; values: Map<valueId, string> }>`. Holds only revealable values. Expires after 30 minutes, is replaced by a new Debug run for the same plan, and is dropped on discard or session end. Never serialised.

## State and lifecycle

A Debug run has no persisted lifecycle: requested, executing (per-plan flag set), result returned, flag cleared. `cancelled` is an `outcome` of a result that is never delivered to a disconnected client but is recorded in the log event as a category only.

## Validation rules

- `valueId` unique within a result.
- A `masked` segment with `revealable: false` has no entry in the reveal store.
- No `text` segment contains the value of any secret environment value or secret data-column value (enforced by the masker and by a leak test).
