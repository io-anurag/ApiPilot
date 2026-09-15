# Contract: Automatic Auth-Credential Chaining

This feature changes no HTTP request/response shape. `POST /api/test-models/postman-collection`'s
request (`PostmanCollectionExportRequest`) and response (`ExportOutcome`/`ExportResult`) are
unchanged in field count. This document pins down the two observable contracts that *do* change:
the shared-domain `DependencyFieldLocation` union, and the export's resulting behavior for a QA
engineer reading `ExportResult`.

## 1. `DependencyFieldLocation` (`packages/shared-domain/src/apiDependency.ts`)

**Before**: `"path" | "query" | "header" | "body"`

**After**: `"path" | "query" | "header" | "body" | "auth"`

Additive only. **No consumer of `DependencyFieldLocation` in the current codebase uses an exhaustive
`switch`/discriminated-union check that the compiler would flag for a missed `"auth"` case** — every
existing consumer is an `if`-chain or a nullish-coalescing default, so each must be reviewed
manually rather than relied on to fail the build:
- `backend/src/postman/workflowVariables.ts:33-38` (`applyWorkflowSubstitutions`) — four
  `if (variable.consumerLocation === ...)` checks, no `else`. An unhandled location silently no-ops.
  This feature's own design (research.md D5) deliberately never calls this function for an
  `"auth"`-location consumer, so it never sees one in practice — but the function itself would not
  error if it did.
- `backend/src/dependencies/assembleWorkflows.ts:72` — `consumerLocation: relationship.consumer.
  location ?? "body"`. An `"auth"`-location relationship reaching this line would silently be
  tagged `"body"`. Per research.md D1, auth-credential relationships are built at export time and
  never flow into `/dependencies/analyze`'s workflow-assembly pipeline, so this should never
  happen — but nothing in the type system enforces that boundary; a future change that merges the
  two pipelines must re-audit this line.

A `FieldRef` with `location: "auth"` never appears as a *producer* field — only as a consumer — and
its `field` is a security scheme key, not a parameter/body field path; callers that assume `field`
names a request field (e.g. anything that would try to look it up in `operation.parameters` or a
body schema) must not be applied to an `"auth"`-location `FieldRef`.

## 2. `ExportResult` behavioral contract (no shape change)

| Field | Contract before this feature | Contract after this feature |
|---|---|---|
| `collection` / `environment` | An operation's `PostmanAuth` block always references `{{token}}`/`{{adminToken}}`/etc., starting empty. | **Unchanged.** This feature never alters which variable an auth block references or its structure (FR-007) — it only populates the value at collection-run time via a captured extraction. |
| `limitations` (`kind: "unresolved-credential-producer"`) | Emitted only for a non-primary scheme with no discovered producer operation (specs/021 FR-007). | Also emitted for the **primary** scheme when no producer operation is found, *and* for any scheme (primary or not) whose producer operation is found but whose documented response does not contain exactly one plausible credential field (FR-004). Message wording and per-scheme (not per-operation) cadence are unchanged. |
| `credentialProducers` | One entry per non-primary scheme with a uniquely identified producer *operation* (identification only — no field, no wiring). | Also includes the primary scheme when a producer operation is uniquely identified for it. Still identification-only; still does not by itself guarantee a chain was created (see `summary.automaticChainCount` below). |
| `summary.automaticChainCount` | Count of path parameters resolved via an automatic chain. | Also counts auth-credential consumers resolved via an automatic chain — the same counter, no new field. |
| `readme` | Lists automatic chains applied, by producer/consumer operation. | Also lists auth-credential chains, using the existing chain-reporting rendering (no new section). |

## 3. Non-goals (explicitly unchanged)

- No new `GenerationLimitationKind` value. The widened `"unresolved-credential-producer"` case reuses
  the existing kind exactly (specs/021).
- No new `ExportOptions` field. `disableAutomaticChaining` continues to govern both path-parameter
  and auth-credential automatic chaining (FR-008).
- No change to `/dependencies/analyze`'s request or response shape (research.md D1) — auth-credential
  relationships are computed at export time and never appear in a `DependencyAnalysisResult` returned
  by that endpoint.
- No change to `CredentialProducerCandidate`'s shape (specs/021, unchanged).
