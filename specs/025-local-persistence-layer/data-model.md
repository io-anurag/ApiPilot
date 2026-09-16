# Phase 1 Data Model: Local Persistence Layer

All tables live in one SQLite file at `APIPILOT_DB_PATH` (research.md D2). Every table uses
`TEXT` primary keys (existing domain ids are already `randomUUID()` strings — no new id
scheme). Timestamps are stored as ISO-8601 `TEXT`, matching every existing shared-domain type
(`Environment`, `ExecutionRun`, `ReadinessState` already use ISO-8601 strings, never `Date` or
epoch numbers) so no conversion layer is needed between a DB row and the existing
shared-domain type.

## environments

Backs `Environment` (`packages/shared-domain/src/execution.ts:20`). Session-scoped (research.md D4).

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `Environment.id` |
| `session_id` | `TEXT NOT NULL` | Owning session; indexed |
| `name` | `TEXT NOT NULL` | Unique per `session_id` (`UNIQUE(session_id, name)`) — same constraint `assertNameAvailable` enforces today |
| `tier` | `TEXT NOT NULL` | `EnvironmentTier` |
| `base_url` | `TEXT NOT NULL` | |
| `variable_values_encrypted` | `BLOB NOT NULL` | AES-256-GCM ciphertext of `JSON.stringify(variableValues)` (research.md D7) |
| `variable_values_iv` | `BLOB NOT NULL` | Per-row random IV |
| `request_delay_ms` | `INTEGER NOT NULL` | |

Index: `CREATE INDEX idx_environments_session ON environments(session_id)`.

Repository (`EnvironmentRepository`) methods mirror `environmentStore.ts`'s existing exported
functions exactly (`list`, `get`, `create`, `update`), each taking/returning the plain
`Environment` shape — encryption/decryption of `variableValues` happens inside the repository,
never visible to callers.

## execution_runs

Backs `ExecutionRun` (`packages/shared-domain/src/execution.ts:105`). Session-scoped.

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `ExecutionRun.id` |
| `session_id` | `TEXT NOT NULL` | Indexed |
| `workflow_id` | `TEXT NOT NULL` | |
| `environment_id` | `TEXT NOT NULL` | |
| `environment_snapshot` | `TEXT NOT NULL` | JSON of `Pick<Environment, "name"\|"tier"\|"baseUrl">` — never encrypted, excludes credentials by construction (FR-017 of spec 018, unchanged) |
| `status` | `TEXT NOT NULL` | `ExecutionRunStatus` |
| `started_at` | `TEXT NOT NULL` | |
| `completed_at` | `TEXT` | Nullable |
| `results` | `TEXT NOT NULL` | JSON array of `RequestResult` — see note below |
| `cancel_requested` | `INTEGER NOT NULL` | `0`/`1` |
| `cancel_reason` | `TEXT` | Nullable; `"user-requested"` \| `"backend-restart"`. Set only when `status = 'cancelled'` (spec 025 Clarifications 2026-09-16, Q1) |

Index: `CREATE INDEX idx_execution_runs_session ON execution_runs(session_id)`.

`summary` (`ExecutionRunSummary`) is not stored as a column — exactly as today, it is
recomputed from `results` (`recomputeSummary` in `executionRunStore.ts:44-58`) each time the
row is read back into an `ExecutionRun`, preserving the existing "derived, never
independently-writable" invariant.

`results` is stored as a single JSON `TEXT` column rather than a child table. A normalized
`request_results` child table was considered and rejected for v1: nothing today queries
individual results independently of their parent run (`listRuns`/`getRun` always return whole
runs with all results attached), so a child table would add join complexity with no present
benefit (constitution XXVII). If per-result querying becomes a real need, this is the natural
place to normalize later.

**Interrupted-run marking (FR-008, resolved by spec 025 Clarifications 2026-09-16 Q1)**: on
backend startup, before accepting requests, run:
```sql
UPDATE execution_runs
SET status = 'cancelled', cancel_reason = 'backend-restart', completed_at = <startup timestamp>
WHERE status = 'in-progress'
```
This is the only startup-time write. It reuses the existing `"cancelled"` terminal status
(spec 018's `ExecutionRunStatus` has no separate "interrupted" value, and the clarification
session confirmed no new status value should be added) — an in-progress run found at startup
could only have gotten that way by the process stopping mid-run, which is exactly what
cancellation already represents to the rest of the system (not attempted further, terminal,
distinct from `"completed"`). What changed after clarification: `cancel_reason` distinguishes
*why* a run is `"cancelled"` so run history remains diagnostically honest —
`"backend-restart"` here, versus `"user-requested"` when `ExecutionRunRepository.settle(...,
"cancelled", "user-requested")` is called from the existing user-initiated cancel path
(`POST .../execution/cancel` → `requestCancel` → the orchestration loop observing
`cancelRequested` and calling `settle`).

**Shared-domain impact**: `ExecutionRun` (`packages/shared-domain/src/execution.ts:105`) gains
one new optional field, `cancelReason?: "user-requested" | "backend-restart"`, present only
when `status === "cancelled"`. This is additive — no existing field's meaning or shape
changes, and every other `ExecutionRunStatus` value (`"in-progress"`, `"completed"`) is
unaffected.

## ai_readiness_history

Backs research.md D5. Append-only; not session-scoped (AI readiness is process-wide, not
per-user).

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `state` | `TEXT NOT NULL` | `ReadinessState["state"]` |
| `reason` | `TEXT` | Nullable |
| `model_id` | `TEXT` | Nullable |
| `accelerator_requested` | `INTEGER NOT NULL` | `0`/`1` |
| `accelerator_active` | `INTEGER NOT NULL` | `0`/`1` |
| `updated_at` | `TEXT NOT NULL` | |

`AiDiagnosticsRepository.recordReadinessTransition(state: ReadinessState)` inserts one row;
called from `ReadinessTracker`'s existing `markLoading`/`markReady`/`markUnavailable` methods
in addition to (never instead of) their current in-memory state update.
`getLastKnownReadiness(): ReadinessState | undefined` reads the most recent row by `id`.

## benchmark_runs

Backs `BenchmarkReport` (`packages/shared-domain/src/aiProvider.ts:106`, research.md D6). Not
session-scoped.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `run_at` | `TEXT NOT NULL` | `BenchmarkReport.runAt` |
| `workload_set_id` | `TEXT NOT NULL` | |
| `candidates` | `TEXT NOT NULL` | JSON array of `BenchmarkCandidateResult` |
| `selected_model_id` | `TEXT NOT NULL` | |
| `selection_rationale` | `TEXT NOT NULL` | |

`AiDiagnosticsRepository.recordBenchmarkRun(report: BenchmarkReport)` inserts one row, called
from `runBenchmark.ts`'s `main()` immediately after writing the JSON file.
`getLatestBenchmarkRun(): BenchmarkReport | undefined` reads the most recent row.

## Schema versioning

`PRAGMA user_version = 1` is set once all `CREATE TABLE IF NOT EXISTS` statements have run
(research.md D8). No migration library; a future schema change reads `user_version` to decide
whether an upgrade step is needed.

## Repository interfaces (constitution XXVIII boundary)

```text
backend/src/persistence/
├── connection.ts        # SqliteConnection: opens/owns the Database handle, initializeSchema()
├── errors.ts             # PersistenceInitializationError
├── environmentRepository.ts   # EnvironmentRepository interface + SqliteEnvironmentRepository
├── executionRunRepository.ts  # ExecutionRunRepository interface + SqliteExecutionRunRepository
├── aiDiagnosticsRepository.ts # AiDiagnosticsRepository interface + SqliteAiDiagnosticsRepository
└── credentialCipher.ts   # encrypt/decrypt variableValues (research.md D7), key file management
```

`environmentStore.ts`, `executionRunStore.ts`, `readiness.ts`, and `runBenchmark.ts` import
only the repository interfaces (and a module-level singleton instance wired at process start,
mirroring how `getAIProvider()` already wires the process-wide `AIProvider` singleton in
`backend/src/ai/index.ts`) — never `better-sqlite3` types directly.
