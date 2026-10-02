# Data Model: Performance Test from a Postman Collection (AP-036)

Shared types live in `packages/shared-domain/src/performance.ts`. Every change there is additive, and
existing plans, snapshots and runs read unchanged. Backend-only types live in
`backend/src/performance/collection/`. `R` references point to [research.md](./research.md). No type
holds a variable value, a captured value, a literal secret or a script excerpt beyond the plan view
(R16).

## New shared types

### `CollectionPlanInfo` (on `PerformancePlan.collection`)

| Field | Type | Rule |
|---|---|---|
| `collectionId` | `string` | The stored collection's id. |
| `collectionName` | `string` | As stored, for display and the report. |
| `collectionTier` | `EnvironmentTier` | Seeds R17. |
| `collectionDigest` | `string` | SHA-256 of the stored collection JSON when built (R13). |
| `collectionState` | `"current" \| "changed" \| "deleted"` | Derived on every read. Not fingerprinted. |
| `orderedRequestIds` | `string[]` | The run panel's order at build time, at most 100 (FR-002). |
| `excludedRequestIds` | `string[]` | Removed by the engineer, code-unit sorted. |
| `leftOut` | `LeftOutRequest[]` | Run order (R4). |
| `credentialRequests` | `CredentialRequestView[]` | Plan order (R8). |
| `findings` | `ConversionFinding[]` | Step order, owner order, line (R5, R19). |
| `baseUrlVariable` | `string \| null` | R12. |
| `hosts` | `string[]` | Literal hosts, code-unit sorted (FR-016). |
| `generatedValueCount` | `number` | Dynamic-variable occurrences (R9). |
| `review` | `{ reviewed: boolean; conversionDigest: string }` | R14. Not fingerprinted. |

### `CollectionRequestRef` (on `PerformanceStep.collectionRequest`, `LeftOutRequest`, `CredentialRequestView`)

| Field | Type | Rule |
|---|---|---|
| `itemId` | `string` | A stable item id (`ensureStableIds`). |
| `name` | `string` | The request's name. |
| `folderPath` | `string[]` | Folder names from the root. Empty at the root. |

### `LeftOutRequest`

`CollectionRequestRef & { method: string; path: string; reason: LeftOutReason; detail: string | null }`

`LeftOutReason`: `"unsupported-auth" | "unsupported-body" | "unsupported-dynamic-variable" |
"unknown-dynamic-variable" | "other-host-variable" | "reserved-name"` (R4). `detail` holds the auth
type, body mode or variable name. It never holds a value.

### `CredentialRequestView`

| Field | Type | Rule |
|---|---|---|
| `stepId` | `string` | The credential request's id, also its token-source scheme (R8). |
| `request` | `CollectionRequestRef & { method; path }` | |
| `expectedStatuses` | `ExpectedStatus[]` | R7. Empty blocks generation. |
| `captures` | `Capture[]` | With `origin`. |
| `usedBy` | `{ captureName: string; stepIds: string[] }[]` | Steps that use each value. |
| `requiredValues` | `string[]` | Environment names it needs. |

### `ConversionFinding`

| Field | Type | Rule |
|---|---|---|
| `kind` | `FindingKind` | See below. |
| `owner` | `{ kind: "request"; itemId } \| { kind: "folder"; folderId; folderName } \| { kind: "collection" }` | Where the script lives. |
| `event` | `"test" \| "prerequest" \| null` | `null` for notes that are not about a script. |
| `stepIds` | `string[]` | Steps the item applies to. |
| `line` | `number \| null` | 1-based. `null` for a whole-script or plan-level finding. |
| `column` | `number \| null` | Set for `unreadable-script` only. |
| `excerpt` | `string \| null` | At most 160 characters. Plan view only. Emptied in run snapshots (R16). |
| `detail` | `string \| null` | A capture or variable name, or the codes of `contradictory-assertions`. |

`FindingKind` values:
- **Statements not converted** (R5): `condition`, `loop`, `function`, `try`, `computed-name`,
  `computed-value`, `send-request`, `set-next-request`, `skip-request`, `iteration-data`, `unset`,
  `assertion-not-converted`, `no-effect`, `unsupported-statement`, `unreadable-script`,
  `superseded-setter`.
- **Scripts:** `prerequest-not-converted` (FR-009).
- **Notes:** `scope-precedence` (R6), `contradictory-assertions` (R7), `url-encoding` (R11),
  `credential-header` (R12).

### `ConvertedCaptureOrigin` (on `Capture.origin`, new optional field)

```ts
type CaptureOrigin =
  | { kind: "collection-script"; scope: "environment" | "collectionVariables" | "globals" | "variables";
      owner: ConversionFinding["owner"]; line: number }
  | { kind: "user" };   // FR-019
```

Absent on AP-035 captures, which keep their meaning.

## Changes to existing shared types

| Type | Change |
|---|---|
| `PerformancePlanSourceKind` | `+ "collection"`. |
| `PerformancePlan` | `+ collection?: CollectionPlanInfo`. |
| `PerformanceJourney.source` | `+ { kind: "collection"; collectionId: string; collectionName: string }`. |
| `PerformanceStep` | `+ collectionRequest?: CollectionRequestRef`; `scenarioChoice` `+ "collection-request"`. |
| `StepAuthKind` | `+ "collection-auth"`. `schemeName` holds the Postman auth type (`bearer`, `basic`, `apikey`, `noauth`). A step whose auth uses a credential request is `"chained-login"`, with `schemeName` set to the credential request's step id. |
| `ExpectedStatus.source` | `+ "collection"` (R7). |
| `Capture` | `+ origin?: CaptureOrigin`. The name rule for `collection-script` captures is any Postman name of 1 to 200 characters without `{`, `}` or control characters. AP-035's identifier rule still applies to captures the engineer adds. |
| `BindingTarget` | `+ { kind: "reference"; name: string; locations: ("url" \| "header" \| "body" \| "auth")[] }` (R6). |
| `UserSuppliedValueSource` | `+ "collection-variable" \| "collection-literal"` (R12). |
| `PreviewReference` | `+ { kind: "generated-value"; name: string; variable: string }` (the `$name`, R9). The capture and credential kinds are reused. |
| `PerformanceRun.planSource`, `PerformanceRunSummary.planSource` | `+ "collection"`. |
| `PerformanceRun` | unchanged. The run tag (R9) is derived from the run id when the run starts, so nothing is stored. |
| `StepResult` | unchanged. The report's credential section reads the token-refresh counts (`TokenRefreshResult`, extended with `setupFailed: { scheme; capture }[]`). |

`summarizeWriteOperations` is unchanged. Credential requests are not journey steps, so they are not
counted (R8).

## Backend types (`performance/collection/`)

### `CollectionPerformanceTest` (store entry, `collectionPlanStore.ts`)

| Field | Type |
|---|---|
| `id` | `string` (entry id, in no artifact) |
| `plan` | `PerformancePlan` (with `collection`) |
| `choices` | `CollectionPlanChoices` |
| `script?` | `GeneratedScript` |

### `CollectionPlanChoices`

| Field | Type | Rule |
|---|---|---|
| `orderedRequestIds` | `string[]` | From the build (R18). |
| `excludedRequestIds` | `string[]` | Must be ids in `orderedRequestIds`. |
| `stepOrder` | `string[] \| undefined` | A permutation of step ids. AP-029's order check applies (R6). |
| `expectedStatusCodes` | `Map<stepId, string[]>` | Steps and credential requests. |
| `thinkTimeMs`, `loadProfile`, `thresholds` | as AP-029 | |
| `addedCaptures` | `Map<stepId, Capture[]>` | FR-019. `origin: {kind:"user"}`. At most 10 per step. |
| `addedBindings` | `Map<stepId, { name: string; captureStepId: string; captureName: string }[]>` | Binds an environment reference of the step to an earlier capture. |
| `reviewedConversionDigest` | `string \| null` | R14. |

### `CollectionRequestSource` (`readCollectionRequests.ts`, R3)

`{ ref: CollectionRequestRef; folderIds: string[]; method; url; headers: {key; value}[]; body:
{ kind: "json" | "text" | "form"; text: string } | null; auth: { type: string; fields: Record<string,
string>; owner } ; scripts: { event; owner; text }[] } | { leftOut: LeftOutReason; detail }`.

It is in memory only, during assembly.

### `ScriptInputs` (R2)

```ts
interface ScriptInputs {
  steps: Map<string, RenderedStepInput>;   // template, needs, captures, tokenSchemes, expected
  tokenSources: RenderedTokenSource[];     // + captures, expected? (R10)
  unique: UniqueToken[];
  dynamic: { token: string; kind: DynamicKind }[];  // R9
}
```

## Rendered script data (R9, R10)

- **`TOKEN_SOURCES[i]`**: `{scheme, kind, request, needs, captures: [{key, source}], expected?}`.
  AP-029 sources render one capture from `responseField`, with no `expected`.
- **`JOURNEYS[].steps[]`**: `tokenScheme` is replaced by `tokenSchemes: string[]`.
- **`DYNAMIC`**: `{ "apipilot_dyn_<k>": { "kind": "<$name>" } }`, or `{}` when no dynamic variable is
  used.
- **`request.bodyKind`**: `+ "form"`.

## State and lifecycle

```text
          POST /collection-performance (orderedRequestIds)
                     │
                     ▼
   ┌──────── plan: collectionState=current, review.reviewed=false ────────┐
   │   PUT /plan (settings): stays reviewed unless the conversion changes │
   │   PUT /plan {conversionReviewed:true}: reviewed=true                 │
   └──────────────────────────────────────────────────────────────────────┘
         │ the collection's JSON changes             │ the collection is deleted
         ▼                                           ▼
   collectionState=changed                  collectionState=deleted
   (script and runs refused)                (script and runs refused; no rebuild)
         │ POST /collection-performance/rebuild
         ▼
   collectionState=current, reviewed=false, kept settings re-applied (R13)
```

A new `POST /collection-performance` with `replaceExisting` replaces the entry and its script. Runs
and reports persist independently.

## Validation rules

| Rule | Source |
|---|---|
| At most 100 ordered ids. No repeats. All ids known. | FR-002, `resolveRunOrder` |
| A step and a credential request each need at least one expected status before `POST /script`. | FR-012, R8 |
| The review must match the current conversion digest before `POST /script`. | FR-018, R14 |
| `collectionState` must be `current` before `POST /script` and `POST /runs`. | FR-022, R13 |
| `PUT /plan` refuses `bodyEdits`, `parameterEdits`, `userJourneys`, `journeyOrder`, `editProposedJourney`, `revertProposedJourney`, `alsoStandalone` and `excludedOperationKeys` on a collection plan. | FR-020 |
| Added captures follow AP-035 names, paths and limits. An added binding's capture must be on an earlier step. | FR-019, AP-035 R6, R10, R11 |

## Implementation notes (2026-10-02)

Additive fields the implementation needed, beyond the tables above:

| Type | Addition | Why |
|---|---|---|
| `CollectionPlanInfo` | `excludedRequests: (CollectionRequestRef & {method; path})[]` | The Removed view names a removed request, which is no longer a step. Derived from `excludedRequestIds`. |
| `CollectionPlanInfo` | `addedBindings: CollectionAddedBinding[]` | FR-019 bindings the engineer set, so the plan, the snapshot and **Restore** carry them. |
| `PerformanceResult.tokenRefreshes` | `setupFailed?`, `byScheme?` | The report's credential-request section (FR-028, FR-029). Present only when not empty, so earlier results are unchanged. |
| shared-domain | `CollectionPerformanceTestView`, `CollectionRebuildNotKept`, `collectionStepLabel()` | The contract's view, the rebuild's `notKept`, and one step label for the UI and the report. |

`Capture.documented` is `null` on a converted capture (a collection documents nothing) and `false`
on a body capture the engineer types (FR-019's "Not documented in a specification").
