# Contract: Persistence Repository Interfaces

**Type**: Internal (in-process) contract — this feature introduces no new external HTTP
endpoint of its own. The one external contract change (`GET /api/ai/status`) is documented as
an amendment in
[specs/004-ai-provider-local-inference/contracts/ai-status-api.md](../../004-ai-provider-local-inference/contracts/ai-status-api.md).

**Purpose**: Defines the boundary through which `environmentStore.ts`, `executionRunStore.ts`,
`ReadinessTracker`, and `runBenchmark.ts` access durable storage, per constitution XXVIII
(Technology Is Replaceable). No caller of these interfaces may import `better-sqlite3`
directly.

## EnvironmentRepository

```ts
interface EnvironmentRepository {
  list(sessionId: string): Environment[];
  get(sessionId: string, environmentId: string): Environment | undefined;
  create(sessionId: string, input: EnvironmentInput): Environment;
  update(sessionId: string, environmentId: string, input: EnvironmentInput): Environment;
  deleteBySession(sessionId: string): void; // called by sessionRegistry's onExpire
}
```

- `create`/`update` throw `DuplicateEnvironmentNameError` for a name collision within the same
  `sessionId` — same error type and trigger condition as today's `environmentStore.ts`.
- `variableValues` is encrypted/decrypted entirely inside the implementation (research.md D7);
  every method's public shape is the plain `Environment`/`EnvironmentInput`, unchanged from
  today's `environmentStore.ts` exports.

## ExecutionRunRepository

```ts
interface ExecutionRunRepository {
  listBySession(sessionId: string): ExecutionRun[]; // newest first
  get(sessionId: string, runId: string): ExecutionRun | undefined;
  getInProgress(sessionId: string): ExecutionRun | undefined;
  create(sessionId: string, run: ExecutionRun): void;
  appendResult(sessionId: string, runId: string, result: RequestResult): ExecutionRun;
  settle(
    sessionId: string,
    runId: string,
    status: "completed" | "cancelled",
    cancelReason?: "user-requested" | "backend-restart", // required in practice when status === "cancelled" (data-model.md)
  ): ExecutionRun;
  requestCancel(sessionId: string, runId: string): ExecutionRun;
  deleteBySession(sessionId: string): void; // called by sessionRegistry's onExpire
  markInterruptedRunsCancelled(): void; // called once at startup; settles every "in-progress" run as cancelled/"backend-restart" (data-model.md)
}
```

- `summary` is never a repository input — it is recomputed from `results` on every read,
  exactly as `executionRunStore.ts`'s `recomputeSummary` does today.
- All error types (`RunNotFoundError`) are unchanged.
- The existing user-initiated cancel path (`POST .../execution/cancel`) calls `settle(...,
  "cancelled", "user-requested")`; `markInterruptedRunsCancelled()` is the only caller that uses
  `"backend-restart"` (spec 025 Clarifications 2026-09-16, Q1).

## AiDiagnosticsRepository

```ts
interface AiDiagnosticsRepository {
  recordReadinessTransition(state: ReadinessState): void;
  getLastKnownReadiness(): ReadinessState | undefined;
  recordBenchmarkRun(report: BenchmarkReport): void;
  getLatestBenchmarkRun(): BenchmarkReport | undefined;
}
```

- Not session-scoped — a single process-wide history.
- `recordReadinessTransition` is called from inside `ReadinessTracker`'s existing
  `markLoading`/`markReady`/`markUnavailable` methods, in addition to the existing in-memory
  update; it never changes what `getState()` returns.

## Error behavior (all repositories)

- A repository method MUST NOT throw a raw `better-sqlite3` error to its caller. Any
  unexpected DB error during a request is caught by the caller's existing error-handling path
  (`app.ts`'s centralized error handler) and results in the same safe `5xx` JSON body as any
  other unexpected error — no stack trace, no SQL text, no file path (constitution XX).
- Startup-time failures (DB file cannot be opened/read) are not a repository method's
  concern — they surface once, at process start, as `PersistenceInitializationError`
  (research.md D9), before any repository is constructed.

## Test-only surface

```ts
function createTestPersistence(): {
  environments: EnvironmentRepository;
  executionRuns: ExecutionRunRepository;
  aiDiagnostics: AiDiagnosticsRepository;
};
```

Opens a fresh `:memory:` connection and returns repositories backed by it (research.md D10).
Used by `backend/tests/setup/testDb.ts` and by any unit test that constructs a repository
directly rather than going through the process-wide singleton.
