# Data Model: Request-Chain Performance Plans (AP-037)

**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

The shared types are in `packages/shared-domain/src/requestChain.ts` (new) and are exported from
the package index. They are framework-agnostic and hold no secret value or data set value. Backend
storage types are in `backend/src/persistence/chainPlanRepository.ts` and
`chainPlanDataSetRepository.ts`. Run types extend `performance.ts` additively.

## Plan

```ts
type StepMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
type StepRuns = "every-iteration" | "once-per-virtual-user" | "once-before-load";   // FR-008

interface NameValue { name: string; value: string }

type StepBody =                                            // FR-003, research R4
  | { kind: "none" }
  | { kind: "raw"; contentType: string; text: string }     // text ≤ 256 KiB
  | { kind: "form"; fields: NameValue[] };

type ExtractorSource =                                     // FR-009
  | { kind: "body"; path: string }                         // AP-035 closed field-path grammar
  | { kind: "header"; name: string };                      // matched case-insensitively

interface Extractor { id: string; name: string; source: ExtractorSource }

type CheckExpected =
  | { type: "text"; value: string }                        // may contain {{name}}
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean };

type StepCheck =                                           // FR-016: data only
  | { id: string; kind: "field-exists"; path: string }
  | { id: string; kind: "field-equals"; path: string; expected: CheckExpected }
  | { id: string; kind: "body-contains"; text: string }
  | { id: string; kind: "time-at-most"; maxMs: number };   // 1 … 600000

type StepSource =                                          // FR-033, research R9
  | { kind: "added" }
  | { kind: "operation"; operationKey: string; label: string; passwordFields: string[] }
  | { kind: "workflow"; workflowId: string; workflowName: string; operationKey: string; label: string; passwordFields: string[] }
  | { kind: "collection"; collectionId: string; collectionName: string; itemId: string; label: string };

interface ChainStep {
  id: string;                     // "s<n>", unique in the plan, never reused
  name: string;                   // shown in lists and the report; default "METHOD /path"
  method: StepMethod;
  url: string;                    // no "?" or "#"; starts with {{baseUrl}} or a literal origin (R7)
  query: NameValue[];
  headers: NameValue[];           // not Host or Content-Length
  body: StepBody;
  expectedStatuses: string[];     // "200", "2XX"; ≥ 1 to generate (FR-006)
  extractors: Extractor[];        // ≤ 10
  checks: StepCheck[];            // ≤ 10
  runs: StepRuns;
  thinkTimeMs: number | null;     // null → plan default (FR-007)
  source: StepSource;
  seedDigest: string | null;      // null for "added"
  changed: boolean;               // derived on save: digest(content) !== seedDigest
}

interface Chain { id: string; name: string; steps: ChainStep[] }   // "c<n>"

interface SeedingReportItem {
  kind:
    | "pre-request-script" | "unrecognised-statement" | "unsupported-dynamic-variable"
    | "left-out-request" | "no-positive-scenario" | "workflow-fallback"
    | "basic-auth-encoded-value" | "literal-credential-moved" | "literal-credential-dropped";
  sourceLabel: string;            // request, operation or workflow it concerns
  detail: string;                 // fixed text with names, lines and labels; never a value
  stepId: string | null;
}

interface SeedingReport {
  source:
    | { kind: "specification"; filename: string }
    | { kind: "workflow"; specificationTitle: string }
    | { kind: "collection"; collectionId: string; collectionName: string };
  seededAt: string;               // ISO time; not fingerprinted
  items: SeedingReportItem[];
}

interface ChainPlan {
  id: string;                     // UUID (storage key)
  name: string;                   // 1 … 120 characters
  revision: number;               // optimistic concurrency, +1 per save (R2)
  chains: Chain[];                // 1 … 20; ≤ 50 steps each
  loadProfile: LoadProfile;       // existing type, unchanged
  thinkTimeMs: number;            // default for steps without their own
  thresholds: PerformanceThreshold[];   // existing type; step scope uses ChainStep.id
  targetEnvironmentId: string | null;
  secretNames: string[];          // value names marked secret, sorted
  dataSets: DataSetInfo[];        // metadata only; values are never here
  seedingReport: SeedingReport | null;
  nextChainNumber: number;
  nextStepNumber: number;
  nextItemNumber: number;         // extractor and check ids "x<n>", "k<n>"
  fingerprint: string;            // R22
  createdAt: string;
  updatedAt: string;
}
```

**Validation on save** (`422 invalid_step`, `plan_limit_exceeded` and others; contracts):
- names follow the reference grammar `[A-Za-z0-9_]+`;
- field paths parse with `parseCapturePath`;
- header names are RFC 7230 tokens other than `Host` and `Content-Length`;
- every limit in research R26 holds.

Literal credentials are moved before the document is stored (R8).

**Identity**:
- Chain, step, extractor and check ids come from the plan's counters, so they are deterministic
  for seeding (FR-020) and stable across saves.
- Duplicating a plan copies the ids. Duplicating a step gives it new ids and `source: added`.

## Data sets

```ts
type DataSetMode = "row-per-virtual-user" | "row-per-iteration";   // FR-043

interface DataSetColumn { name: string; secret: boolean }

interface DataSetInfo {
  id: string;                     // UUID
  name: string;                   // 1 … 120 characters
  mode: DataSetMode;
  columns: DataSetColumn[];       // ≤ 50, names unique across the plan's data sets
  rowCount: number;               // ≤ 100000
  sizeBytes: number;              // ≤ 5 MiB
  sha256: string;                 // of the uploaded bytes (FR-046)
}

interface DataSetPreview {        // FR-045: first 5 rows
  columns: DataSetColumn[];
  rows: (string | null)[][];      // null where the column is secret
}
```

A plan holds at most 5 data sets. Their order in `ChainPlan.dataSets` is their index in the script.

## Analysis (derived; never stored)

```ts
type PlanBlocker =
  | { kind: "missing-expected-status"; stepId: string }
  | { kind: "use-before-extraction"; stepId: string; name: string }
  | { kind: "setup-uses-iteration-value"; stepId: string; name: string }
  | { kind: "host-from-variable"; stepId: string; name: string }
  | { kind: "invalid-url"; stepId: string }
  | { kind: "invalid-reference"; stepId: string; text: string }
  | { kind: "invalid-field-path"; stepId: string; itemId: string; reason: string }
  | { kind: "no-runnable-chain" };                // every chain empty

type PlanNotice =
  | { kind: "empty-chain"; chainId: string }
  | { kind: "extracted-more-than-once"; name: string; stepIds: string[] }
  | { kind: "column-shadows-environment"; name: string; dataSetId: string }
  | { kind: "data-set-unused"; dataSetId: string };

interface RequiredValue {                         // FR-015
  name: string;
  stepIds: string[];
  secret: boolean;
  provided: boolean | null;                       // null when no target environment
}

interface ChainPlanAnalysis {
  blockers: PlanBlocker[];                        // any → no script (FR-014)
  notices: PlanNotice[];
  requiredValues: RequiredValue[];
  dataSetUsage: { dataSetId: string; column: string; stepIds: string[] }[];
  hosts: string[];                                // "{{baseUrl}}" first, then literal origins (R7)
  writeSummary: WriteOperationSummary;            // existing type; operationKey = step id
  extractedNames: { name: string; stepIds: string[] }[];   // for the `{{` suggestions (FR-005)
}

interface AnalysisContext {
  environmentValueNames: string[] | null;         // names only, never values
}
```

`analyzeChainPlan(plan, context): ChainPlanAnalysis` and `chainRunOrder(plan)` are pure and shared
by the frontend and the backend (research R3, R6).

## Credential moves (save response only)

```ts
interface MovedCredential {
  stepId: string;
  location: { kind: "header"; name: string } | { kind: "body-field"; path: string };
  valueName: string;              // the new secret environment value, e.g. "authorization_s2"
  environmentName: string;
}
```

## Run snapshot and run

```ts
interface ChainRunSnapshot {               // FR-033: structure and provenance only
  planId: string;
  planName: string;
  fingerprint: string;
  chains: {
    id: string;
    name: string;
    steps: {
      id: string;
      name: string;
      method: StepMethod;
      pathTemplate: string;        // URL without query; references as {{name}}; no values
      runs: StepRuns;
      expectedStatuses: string[];
      extractorNames: string[];
      checks: { id: string; kind: StepCheck["kind"]; path: string | null; maxMs: number | null }[];
      source: { kind: StepSource["kind"]; label: string | null };   // no passwordFields
      changed: boolean;
    }[];
  }[];
  loadProfile: LoadProfile;
  thinkTimeMs: number;
  thresholds: PerformanceThreshold[];
  hosts: string[];
  dataSets: { id: string; name: string; mode: DataSetMode; columns: DataSetColumn[]; rowCount: number; sha256: string }[];
  writeSummary: WriteOperationSummary;
  seedSource: SeedingReport["source"] | null;
  contentNotice: "user-authored-unverified";   // constitution XVII: step content is the engineer's, not verified by ApiPilot
}

interface ChainRun {
  id: string;
  planSource: "chain";
  planId: string;
  status: PerformanceRunStatus;
  cancelReason?: PerformanceRunCancelReason;
  failure?: { category: ChainRunFailureCategory };   // PerformanceRunFailureCategory | "setup-step-failed"
  environment: PerformanceRunEnvironment;
  snapshot: ChainRunSnapshot;
  scriptSha256: string;
  k6Version: string;
  plannedDurationMs: number;
  startedAt: string;
  endedAt?: string;
  cancelRequested: boolean;
  progress?: RunProgress;
  result?: PerformanceResult;
}

type ChainRunSummary = Omit<ChainRun, "snapshot" | "progress" | "result">;
```

**Check labels.**
- A check's expected value and a `body-contains` text are not recorded in the snapshot.
- The report labels checks by kind and path, for example "field `id` equals (value set in plan)".
- An expected value that is exactly one `{{name}}` reference is shown as that name.

**`PerformanceResult` additions** (all optional, absent on older runs):
- `steps[].checks?: { checkId: string; kind: string; passed: number; failed: number }[]`;
- `setupSteps?: { stepId: string; outcome: "ok" | "failed"; reason: string | null; latencyMs: number | null }[]`;
- `dataSets?: { dataSetId: string; takes: number; rowsUsed: number; wrapped: boolean }[]`;
- `tokenRefreshes.bySetupStep?: { stepId: string; refreshed: number; failed: number }[]`.

`StepResult.captures` carries extractor outcomes, and `JourneyResult` (journey id = chain id)
carries `cutShortByCapture` (extractor name), as for AP-035.

## Storage

### `chain_plans` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT NOT NULL | indexed with `updated_at` |
| `name` | TEXT NOT NULL | plain, for the list |
| `revision` | INTEGER NOT NULL | |
| `fingerprint` | TEXT NOT NULL | |
| `chain_count`, `step_count` | INTEGER NOT NULL | for the list without decrypting |
| `seed_source` | TEXT NULL | `specification`, `workflow`, `collection` or null, for the list's `seedSource` |
| `document_encrypted`, `document_iv` | BLOB NOT NULL | the `ChainPlan` JSON without `dataSets` |
| `created_at`, `updated_at` | TEXT NOT NULL | |

### `chain_plan_data_sets` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `plan_id`, `session_id` | TEXT NOT NULL | removed with the plan and with the session |
| `position` | INTEGER NOT NULL | script index |
| `name`, `mode` | TEXT NOT NULL | |
| `columns` | TEXT NOT NULL | JSON `DataSetColumn[]`; names only |
| `row_count`, `size_bytes` | INTEGER NOT NULL | |
| `sha256` | TEXT NOT NULL | |
| `content_encrypted`, `content_iv` | BLOB NOT NULL | the uploaded bytes (FR-044) |
| `created_at`, `updated_at` | TEXT NOT NULL | |

### `performance_runs` (additive columns)

| Column | Type | Notes |
|---|---|---|
| `plan_source` | existing | `'chain'` for chain runs |
| `chain_plan_id` | TEXT NULL | the plan the run came from; the plan may since be deleted |
| `plan_document_encrypted`, `plan_document_iv` | BLOB NULL | the run's plan copy for restore (R21) |

`plan_snapshot` holds `ChainRunSnapshot` JSON for chain rows.

## Lifecycle

```text
               seed (spec | workflow | collection)        new (empty: one chain "Chain 1")
                         \                                   /
                          v                                 v
                       ┌────────────── saved plan (revision n) ──────────────┐
                       │   PUT (revision n) → revision n+1, analysis,         │
                       │   credentials moved, script marked out of date       │
                       └──────────────────────────────────────────────────────┘
                                │ POST script (no blockers)
                                v
                        script current (fingerprint = plan.fingerprint)
                                │ POST runs (explicit trigger, environment named)
                                v
          in-progress ──► completed | cancelled | failed (setup-step-failed, k6-…)
                                │
                     Run again (same script + data set SHA-256) │ restore → plan replaced or new plan
```

- **Removal.** Deleting a plan deletes its data sets. Its runs remain, with `chain_plan_id` pointing
  at nothing, and their reports still render. Session expiry deletes plans, data sets and runs.
- **Restarts.** A backend restart keeps plans and data sets unchanged (SC-008). Generated scripts
  are in memory, as today, and need regenerating; the plan shows "Script not generated".
