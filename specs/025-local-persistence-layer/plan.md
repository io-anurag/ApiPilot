# Implementation Plan: Local Persistence Layer

**Branch**: `025-local-persistence-layer` | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/025-local-persistence-layer/spec.md`

## Summary

Add a `better-sqlite3`-backed local persistence layer so that environments/credentials,
execution run history, and AI readiness/benchmark diagnostics survive a backend restart.
Environments and execution runs remain session-scoped exactly as `specs/017-session-workflow-
isolation` and `specs/018-test-execution-results` originally specified — they are now backed
directly by SQLite (queried per `session_id`) instead of an in-memory `Map`, with the same
60-minute idle-eviction lifecycle, rather than eagerly hydrated into memory (research.md D4).
AI readiness/benchmark data is process-wide and persisted as historical/diagnostic
information alongside (never instead of) the existing live readiness state machine
(research.md D5/D6). Access to storage goes through repository interfaces
(`backend/src/persistence/`) so `better-sqlite3` itself stays swappable per constitution
XXVIII. This plan required amending `specs/018-test-execution-results` (FR-005 and an
Assumptions bullet) and `specs/004-ai-provider-local-inference`'s `ai-status-api.md` contract,
both of which had explicitly documented the behavior this feature changes — see those files'
diffs for the amendment text and rationale. A subsequent `/speckit.clarify` pass (2026-09-16)
resolved three open points reflected in data-model.md/contracts: an interrupted execution run
is now distinguished from a user-cancelled one via a new `cancelReason` field rather than
being indistinguishably "cancelled"; FR-009's diagnostic extensibility is architectural only
(no speculative generic table); and restart-time data recovery has a concrete <500ms budget
(SC-005).

## Technical Context

**Language/Version**: TypeScript (Node.js 20 LTS, matching `backend/src/server.ts:24`'s
enforced minimum)

**Primary Dependencies**: `better-sqlite3` (new; synchronous native SQLite bindings, research.md D1). No other new runtime dependency — encryption uses Node's built-in `node:crypto` (research.md D7).

**Storage**: SQLite, single local file at `APIPILOT_DB_PATH` (default `~/.apipilot/apipilot.db`, research.md D2)

**Testing**: Vitest + Supertest (existing backend test stack), with `:memory:` SQLite connections for full isolation (research.md D10)

**Target Platform**: Same as the rest of the backend — local Node.js process (Windows/macOS/Linux), no server/cloud deployment target introduced

**Project Type**: Web application (existing `backend/` + `frontend/` structure) — this feature is backend-only

**Performance Goals**: No new performance target; local SQLite reads/writes for a single-operator process are expected to add negligible latency (sub-millisecond) versus the in-memory `Map` access they replace

**Constraints**: Node 20 LTS rules out `node:sqlite` (Node 22+ only, research.md D1); no ORM or migration framework (constitution XXVII); credentials never logged in plaintext at rest or in diagnostics (constitution XVII/XVIII/XX)

**Scale/Scope**: Single local operator, single process, no concurrent-writer contention to design around

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| IX. Separation of Concerns | PASS — new `backend/src/persistence/` module is the only place that imports `better-sqlite3`; existing stores/routes are unaffected by the storage technology. |
| XVII. Security and Privacy by Design | PASS — `variableValues` (credential-carrying) encrypted at rest (D7); DB file path is local-only, never transmitted; no new persistence beyond what spec 025 explicitly requires. |
| XVIII. Secrets Must Never Be Part of Generated Artifacts | PASS — unaffected; this feature does not touch Postman/collection generation. |
| XIX. Fail Safely | PASS — corrupted/unreadable DB fails startup explicitly (D9), never silently discarded or auto-repaired. |
| XX. Observability Without Sensitive Logging | PASS — repository errors surface as error-category-only, mirroring the existing centralized error handler; no raw SQL, file paths, or credential values are ever logged. |
| XXI. Testability at Every Boundary | PASS — `:memory:` SQLite gives every test full isolation with no shared on-disk state (D10). |
| XXVI. Specification Traceability | PASS, with explicit amendments — `specs/018-test-execution-results` (FR-005, Assumptions) and `specs/004-ai-provider-local-inference/contracts/ai-status-api.md` are amended in place (not silently contradicted) with rationale, per the Governance conflict-resolution procedure. `specs/017-session-workflow-isolation` FR-008 is unaffected: it governs test-generation *workflow stage* state (`workflowStore.ts`), which this feature does not persist. |
| XXVII. Prefer Simple Architecture | PASS — one new dependency (`better-sqlite3`), no ORM, no migrations library, direct SQL, idempotent schema init (D8). Justified by a concrete, explicitly requested need (data survives restart), not speculative infrastructure. |
| XXVIII. Technology Is Replaceable, Domain Concepts Are Not | PASS — repository interfaces (`EnvironmentRepository`, `ExecutionRunRepository`, `AiDiagnosticsRepository`) isolate `better-sqlite3`; no shared-domain type changes shape. |
| XXX. Explicit Trade-offs | PASS — D4 (sessionRegistry bookkeeping stays in-memory; idle clock restarts after a crash) and D7 (encryption approach and alternatives rejected) are documented explicitly. |

No unresolved gate failures. Complexity Tracking table below is empty — no principle is
violated; see research.md for the trade-offs made within these constraints.

**Post-Phase-1 re-check**: Table above was re-evaluated after completing research.md and
data-model.md (not just before Phase 0); no new violation emerged during design — the schema,
repository boundary, and encryption approach in data-model.md/research.md match what this
table assumed going in.

## Project Structure

### Documentation (this feature)

```text
specs/025-local-persistence-layer/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── persistence-repositories.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── persistence/                    # NEW
│   │   ├── connection.ts               # SqliteConnection, initializeSchema()
│   │   ├── config.ts                   # APIPILOT_DB_PATH resolution (mirrors ai/modelConfig.ts)
│   │   ├── errors.ts                   # PersistenceInitializationError
│   │   ├── credentialCipher.ts         # AES-256-GCM encrypt/decrypt for variableValues
│   │   ├── environmentRepository.ts
│   │   ├── executionRunRepository.ts
│   │   └── aiDiagnosticsRepository.ts
│   ├── execution/
│   │   ├── environmentStore.ts         # MODIFIED — delegates to EnvironmentRepository
│   │   └── executionRunStore.ts        # MODIFIED — delegates to ExecutionRunRepository
│   ├── session/
│   │   └── sessionRegistry.ts          # MODIFIED — onExpire callbacks call repository deletes
│   ├── ai/
│   │   ├── readiness.ts                # MODIFIED — also records transitions via AiDiagnosticsRepository
│   │   ├── api/aiStatus.ts             # MODIFIED — includes lastKnownReadiness/latestBenchmarkRun
│   │   └── benchmark/runBenchmark.ts   # MODIFIED — also records the run via AiDiagnosticsRepository
│   └── server.ts                       # MODIFIED — opens the DB and runs markInterruptedRunsCancelled() before app.listen()
└── tests/
    └── setup/
        └── testDb.ts                    # NEW — :memory: connection wired into beforeEach

packages/shared-domain/src/execution.ts   # MODIFIED — doc comments on Environment/ExecutionRun
                                            # ("no durable persistence") are now stale and must
                                            # be corrected to reflect specs/018's amendment;
                                            # ExecutionRun also gains an optional
                                            # cancelReason?: "user-requested" | "backend-restart"
                                            # field (spec 025 Clarifications 2026-09-16 Q1,
                                            # data-model.md)

.env.example                              # MODIFIED — documents APIPILOT_DB_PATH
```

**Structure Decision**: Backend-only change within the existing `backend/src/` layout. A new
`backend/src/persistence/` module holds every `better-sqlite3` touchpoint (constitution
IX/XXVIII); no frontend change, no shared-domain type shape change (only doc-comment
corrections), no new top-level workspace package — a dedicated `@apipilot/persistence`
package was considered and rejected as premature (constitution XXVII): nothing outside
`backend/` needs this code, so a backend-internal module is the smallest structure that fits.

## Complexity Tracking

*No constitution violations requiring justification — table intentionally left empty. See
research.md for documented design trade-offs (D4, D7) made within the constitution's bounds.*
