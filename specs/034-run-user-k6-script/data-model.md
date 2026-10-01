# Data Model: Run a User-Supplied k6 Script (AP-034)

The new types live in `packages/shared-domain/src/userScript.ts`, are exported from the package
index, and have no framework dependency (CLAUDE.md §4). They reuse `LoadProfile`, `LoadStage`,
`PerformanceThresholdMetric`, `LatencyPercentiles`, `LatencySummary`, `RequestPhaseTiming`,
`RunProgress`-style counters and `PerformanceRunEnvironment` from `performance.ts`. Nothing in
`performance.ts` changes, apart from exports. R-numbers refer to [research.md](./research.md).

## Entities

### UserScriptSummary and UserScript

`UserScriptSummary` is a row of the script list (FR-003):

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID. |
| `name` | string | 1 to 100 characters after trimming. The engineer can rename it. |
| `sizeBytes` | number | At most 1,048,576. |
| `sha256` | string | Lowercase hex of the stored bytes. |
| `confirmed` | boolean | Derived: `confirmedSha256 === sha256`. |
| `lastRun` | `{ runId, status, startedAt } \| null` | |
| `updatedAt` | string | ISO time. |

`UserScript` is `UserScriptSummary` plus:

| Field | Type | Notes |
|---|---|---|
| `check` | `ScriptCheckResult` | Recomputed from the content with the current rules (R7). A stored script that a later, stricter check refuses shows its problems, and cannot run (R17). |
| `confirmation` | `ScriptConfirmation \| null` | Null unless it matches the current SHA-256. |
| `settings` | `UserScriptRunSettings` | |

Content is never part of these types. It is served only by `GET /:id/content` and
`GET /:id/download`.

### ScriptCheckResult (FR-004 to FR-009)

```ts
type ScriptCheckResult = ScriptCheckAccepted | ScriptCheckRefused;

interface ScriptCheckAccepted {
  accepted: true;
  hosts: string[];             // "https://api.example.com:443", sorted, unique (R4)
  envNames: ScriptEnvName[];   // sorted, unique (R5)
  hasDefaultFunction: boolean; // FR-027
}
interface ScriptEnvName {
  name: string;
  mappable: boolean;
  reason?: MappingNameRefusal;
  // From a const literal table's key (research R5), e.g. a generated script's VALUE_ENV
  suggestedSource?: UserScriptValueMapping["source"];
}

interface ScriptCheckRefused { accepted: false; problems: ScriptProblem[] }
interface ScriptProblem {
  rule: ScriptRuleId;
  line: number;   // 1-based
  column: number; // 1-based
  message: string;
}
type ScriptRuleId =
  | "parse-error" | "not-utf8-text" | "too-large"
  | "import-remote" | "import-file" | "import-extension" | "import-experimental"
  | "import-forbidden-builtin" | "import-not-allowed"
  | "dynamic-import" | "import-meta"
  | "forbidden-identifier" | "forbidden-property" | "computed-access"
  | "timer-string-code" | "handle-summary";
```

- Problems are sorted by line, then column, then rule id, so the same bytes give the same list
  (FR-008).
- Messages never quote string values from the script, only the construct, for example "a computed
  property name built at run time".

### ScriptConfirmation (FR-013 to FR-016)

| Field | Type | Notes |
|---|---|---|
| `sha256` | string | Equals the script's SHA-256 when present. |
| `confirmedAt` | string | ISO time. |
| `hostsStated` | string[] | The hosts the confirmation listed. |

State transitions:
- *needs confirmation* → *confirmed*: `POST /confirmation` with the matching SHA-256.
- *confirmed* → *needs confirmation*: any content change (upload over, or editor save).
- A rename keeps the state.

### UserScriptRunSettings (FR-025 to FR-028)

```ts
interface UserScriptRunSettings {
  mapping: UserScriptValueMapping[];          // sorted by name
  removedNames: string[];                     // found names the engineer removed (R12)
  load: UserScriptLoad;
  thresholds: UserScriptThreshold[];
}
interface UserScriptValueMapping {
  name: string;                               // FR-026 rule, plus the reserved start-up names (R11)
  source: { kind: "base-url" } | { kind: "environment-value"; valueName: string };
  foundInScript: boolean;                     // derived on read
}
type UserScriptLoad = { kind: "script" } | { kind: "profile"; profile: LoadProfile };
interface UserScriptThreshold {
  id: string;                                 // content-derived, as in AP-029
  scope: { kind: "run" } | { kind: "request-name"; name: string };
  metric: PerformanceThresholdMetric;
  comparator: "<=";
  limit: number;
}
type MappingNameRefusal = "invalid-characters" | "starts-with-digit" | "k6-prefix" | "reserved-startup-name";
```

Validation rules:
- A name matches `^[A-Za-z_][A-Za-z0-9_]*$`.
- A name must not start with `K6_`, case-insensitively.
- A name must not equal `PATH`, `SYSTEMROOT`, `TEMP`, `TMP`, `HOME` or `TMPDIR`, case-insensitively.
- Names are unique.
- At most 100 mappings and 50 thresholds.
- Changing the settings never changes `sha256` or the confirmation (FR-028).

### MappedValueStatus (FR-025, GET /values)

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `source` | as in the mapping | |
| `present` | boolean | Whether the chosen environment has a non-empty value. |

A status never includes a value. Every mapped value is treated as secret (R12).

### UserScriptRun (FR-023, FR-029, FR-030)

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID. |
| `source` | `"user-script"` | Distinguishes it from `PerformanceRun` in shared UI code. |
| `status` | `PerformanceRunStatus` | Reused. |
| `cancelReason?` | `PerformanceRunCancelReason` | Reused. |
| `failure?` | `{ category: PerformanceRunFailureCategory; k6Message?: string }` | `k6Message` is at most 2,000 characters and appears only on `GET /runs/:runId` (R13). |
| `environment` | `PerformanceRunEnvironment` | `{ id, name, tier, baseUrl }`, reused. |
| `snapshot` | `UserScriptRunSnapshot` | |
| `k6Version` | string | |
| `k6ExitCode` | number \| null | |
| `exitMeaning` | `K6ExitMeaning \| null` | From R13's table. |
| `plannedDurationMs` | number \| null | Null when the script's own load is used. |
| `startedAt`, `endedAt?` | string | |
| `cancelRequested` | boolean | |
| `progress?` | `UserScriptRunProgress` | |
| `result?` | `UserScriptResult` | |

```ts
interface UserScriptRunSnapshot {
  scriptId: string;
  scriptName: string;
  scriptSha256: string;                       // equals the executed bytes' SHA-256 (SC-003)
  load: UserScriptLoad;
  mapping: { name: string; source: UserScriptValueMapping["source"] }[];
  thresholds: UserScriptThreshold[];
  hostsFound: string[];
}
type K6ExitMeaning =
  | "completed" | "script-thresholds-crossed" | "aborted-by-script" | "marked-failed-by-script"
  | "invalid-config" | "script-exception" | "other";
interface UserScriptRunProgress {
  elapsedMs: number;
  currentVirtualUsers: number;
  requestsSoFar: number;
  failuresSoFar: number;
}
```

`UserScriptRunSummary` is `Omit<UserScriptRun, "progress" | "result">`, with `failure.k6Message`
also removed.

### UserScriptResult (FR-031 to FR-036)

```ts
interface UserScriptResult {
  totals: RequestGroupMetrics & {
    iterations: number;
    iterationDurationMs: (LatencyPercentiles & LatencySummary) | null;
    dataSentBytes: number;
    dataReceivedBytes: number;
  };
  requestGroups: RequestGroupResult[];        // at most 100, in first-appearance order
  otherRequests: (RequestGroupResult & { combinedNames: number }) | null;
  hostsReceived: { origin: string; requests: number }[]; // at most 50, sorted by origin
  otherHostsCount: number;
  checks: { name: string; passes: number; fails: number }[];        // at most 100
  groups: { name: string; durationMs: (LatencyPercentiles & LatencySummary) | null }[];
  customMetrics: CustomMetricSummary[];       // at most 100, sorted by name
  scriptThresholds: { metric: string; expressions: string[] }[];
  scriptThresholdsOutcome: "crossed" | "not-crossed" | "none-defined";
  apiPilotThresholds: { thresholdId: string; measured: number | null; passed: boolean }[];
  timeline: { bucketMs: number; points: TimelinePoint[] }; // TimelinePoint reused
  findings: UserScriptFinding[];
  findingsRulesetVersion: number;             // USER_SCRIPT_FINDINGS_RULESET_VERSION = 1
  latencyPrecision: "within-1-percent";
}
interface RequestGroupMetrics {
  requests: number;
  failures: number;                           // http_req_failed = 1
  failureRatePercent: number;
  throughputPerSecond: number;
  latencyMs: LatencyPercentiles | null;
  latencySummaryMs: LatencySummary | null;
  statusesReceived: { status: number; count: number }[]; // 0 = no response
  phaseTimings: RequestPhaseTiming[];
}
interface RequestGroupResult extends RequestGroupMetrics {
  displayName: string;                        // R14 rule; never a raw URL
  named: boolean;                             // false when shown as METHOD host/path
  writes: { method: WriteMethod; sent: number; succeeded: number }[];
  timeline: StepTimelinePoint[];              // reused shape
}
type CustomMetricSummary =
  | { name: string; type: "counter"; total: number; ratePerSecond: number }
  | { name: string; type: "gauge"; last: number; min: number; max: number }
  | { name: string; type: "rate"; percentTrue: number; samples: number }
  | { name: string; type: "trend"; percentiles: LatencyPercentiles; summary: LatencySummary };
interface UserScriptFinding { ruleId: UserScriptFindingRuleId; subjects: string[]; message: string; values: Record<string, number> }
type UserScriptFindingRuleId =
  | "apipilot-threshold-failed" | "script-thresholds-crossed" | "slowest-request"
  | "failures-start" | "most-frequent-failing-status" | "names-combined"
  | "hosts-outside-environment" | "script-ended-run";
```

## Storage

### `user_scripts` (new, `persistence/connection.ts`)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | |
| `session_id` | TEXT NOT NULL | Indexed with `updated_at`. |
| `name` | TEXT NOT NULL | |
| `content_encrypted` | BLOB NOT NULL | AES-256-GCM (`credentialCipher`). |
| `content_iv` | BLOB NOT NULL | |
| `size_bytes` | INTEGER NOT NULL | |
| `sha256` | TEXT NOT NULL | |
| `confirmed_sha256` | TEXT | Null when never confirmed. |
| `confirmed_at` | TEXT | |
| `confirmed_hosts_encrypted` | BLOB | |
| `confirmed_hosts_iv` | BLOB | |
| `settings` | TEXT NOT NULL | JSON `UserScriptRunSettings` without `foundInScript`. Holds no values. |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |

### `user_script_runs` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | |
| `session_id` | TEXT NOT NULL | |
| `script_id` | TEXT NOT NULL | No foreign key: runs outlive a deleted script (spec Edge Cases). |
| `status` | TEXT NOT NULL | |
| `cancel_reason` | TEXT | |
| `failure_category` | TEXT | |
| `cancel_requested` | INTEGER NOT NULL DEFAULT 0 | |
| `environment_snapshot` | TEXT NOT NULL | Name, tier and base URL only, as in AP-029. |
| `snapshot_encrypted` | BLOB NOT NULL | `UserScriptRunSnapshot`. |
| `snapshot_iv` | BLOB NOT NULL | |
| `k6_version` | TEXT NOT NULL | |
| `k6_exit_code` | INTEGER | |
| `planned_duration_ms` | INTEGER | Null for the script's own load. |
| `started_at` | TEXT NOT NULL | |
| `ended_at` | TEXT | |
| `progress` | TEXT | Counts only. |
| `result_encrypted` | BLOB | |
| `result_iv` | BLOB | |
| `failure_message_encrypted` | BLOB | |
| `failure_message_iv` | BLOB | |

Both tables are created with `CREATE TABLE IF NOT EXISTS` in `initializeSchema()`. Rows are
deleted by session through `onExpire` listeners. `markInterruptedUserScriptRunsCancelled()` runs at
startup alongside the existing recovery calls.

## In-memory state

- **`checkCache`:** `Map<sha256, ScriptCheckResult>`, bounded to 64 entries by least-recent use.
  It is safe to drop at any time, because the check is deterministic.
- **`liveHandles`:** the existing map in `runPerformanceTest.ts`, keyed by run id and used for both
  run kinds.
