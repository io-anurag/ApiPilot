# Phase 0 Research: Local Persistence Layer

## D1: Storage engine

**Decision**: `better-sqlite3` (synchronous native SQLite bindings), as decided with the user
before this plan began.

**Rationale**: Every existing store this feature touches (`environmentStore.ts`,
`executionRunStore.ts`, `ReadinessTracker`) is currently synchronous — callers never `await`
a store call. `better-sqlite3`'s synchronous API preserves every existing call site's
signature; an async driver (e.g. `sql.js`, `node:sqlite` on Node 22+) would force every call
site and its callers into `async`/`await` for no functional benefit at this scale (single
local process, no concurrent-writer contention to hide behind async I/O). Node 20 LTS (the
project baseline, `backend/src/server.ts:24`) excludes `node:sqlite` (Node 22+ only).

**Alternatives considered**:
- `sql.js` (WASM SQLite): avoids a native build step, but requires manually serializing the
  whole DB to disk after every write and loading it whole into memory on start — worse fit for
  a store that's read/written on every request.
- Plain JSON file store: simplest possible option, but provides no transactional multi-row
  updates (e.g. `appendResult` + summary recompute in `executionRunStore.ts` today are two
  logically-related writes) and no indexed lookup by `session_id`, which every persisted
  entity here needs.

## D2: DB file location and configuration

**Decision**: New env var `APIPILOT_DB_PATH`, default `path.join(os.homedir(), ".apipilot",
"apipilot.db")` — mirrors `AI_MODEL_CACHE_DIR`'s existing convention exactly
(`backend/src/ai/modelConfig.ts:6`: `path.join(os.homedir(), ".apipilot", "models")`). Read
directly from `process.env` in a new `backend/src/persistence/config.ts`, following
`config.ts`/`modelConfig.ts`'s existing "no external config library" pattern. Documented in
`.env.example` immediately after `AI_MODEL_CACHE_DIR`.

**Rationale**: Consistency with the one existing local-filesystem-path convention in this
codebase; operators already know this pattern from `AI_MODEL_CACHE_DIR`.

## D3: Replaceable storage boundary (constitution XXVIII)

**Decision**: Introduce per-entity repository interfaces in `backend/src/persistence/`
(`EnvironmentRepository`, `ExecutionRunRepository`, `AiDiagnosticsRepository`), each a plain
TypeScript interface with synchronous methods mirroring the existing store functions'
signatures. A single `SqliteConnection` module owns the `better-sqlite3` `Database` instance
and schema initialization; each repository is a thin class taking that connection and
implementing the interface with parameterized SQL. `environmentStore.ts`,
`executionRunStore.ts`, and the AI readiness/benchmark call sites depend only on the
repository interfaces, never on `better-sqlite3` types, so a future swap (e.g. to a different
embedded DB) touches only the repository implementations.

**Rationale**: Constitution XXVIII requires the database technology to "remain replaceable
unless explicitly justified." Repository interfaces are the smallest abstraction that
achieves this without a speculative generic data-access framework (constitution XXVII).

## D4: Session-scoped entities become disk-backed directly (no in-memory Map)

**Decision**: For `environmentStore.ts` and `executionRunStore.ts`, remove the in-memory
`Map<sessionId, T[]>` entirely and replace it with direct, per-call SQL reads/writes filtered
by `session_id` (e.g. `listEnvironments()` becomes `SELECT * FROM environments WHERE
session_id = ?`). "Automatically load previously persisted data when the backend starts"
(spec FR-004) is satisfied by construction — there is nothing to eagerly hydrate into memory;
a row is simply there to be queried the moment a matching session's request arrives, restart
or not.

**Rationale**: An eager-hydration design (load every session's rows into a `Map` on startup,
keep writing through to disk) would reintroduce exactly the unbounded-memory-growth problem
`specs/017-session-workflow-isolation` (research.md D3/D4, sessionRegistry.ts:1-9) was built
to bound — every abandoned session's data would sit in memory forever unless a session
explicitly expires. Querying SQLite directly, scoped by an indexed `session_id` column, is
simpler (constitution XXVII) and keeps the existing memory-bounding property intact: the data
that grows unboundedly now lives on disk, which is exactly what durability was asked for.
`better-sqlite3`'s synchronous, low-latency local queries make this a non-issue at this
product's scale (single local process, one operator).

**Idle-session eviction still applies**: `sessionRegistry.ts`'s existing `onExpire` callbacks
(currently `sessionEnvironments.delete(sessionId)` / `sessionStates.delete(sessionId)`) change
to `DELETE FROM environments WHERE session_id = ?` / `DELETE FROM execution_runs WHERE
session_id = ?`. The 60-minute idle-eviction behavior (`sessionRegistry.ts:19`, FR-007 of spec
017) is unchanged in effect — it now bounds disk rows instead of Map entries.

**Known limitation (constitution XXX, explicit trade-off)**: `sessionRegistry.ts`'s own
live/absent/expired bookkeeping remains in-memory and is not persisted by this feature — only
the entity tables (`environments`, `execution_runs`) are durable. After a backend restart, a
session id's registry entry starts fresh (`touch()` creates a new "live" entry with
`lastActivityAt = now`) regardless of how long the process was actually down. In practice
this means: if a browser tab with an open `sessionId` cookie makes a request after a restart,
its persisted environments/runs are found and used exactly as before the restart, even if the
process was down for longer than the 60-minute idle window — the idle clock effectively
restarts at the moment of the first post-restart request. This is judged acceptable: it only
ever makes data available *longer* than the idle-eviction policy would strictly allow, never
shorter, and persisting the registry itself was not requested and adds no independent value
(rationale below in "Non-goals").

**Non-goal**: Persisting `sessionRegistry.ts`'s bookkeeping is out of scope. It exists only to
bound memory/disk growth from abandoned sessions, not to preserve product data; persisting it
would add complexity with no corresponding requirement (constitution XXVII).

## D5: AI readiness — persisted as history, not resumed as live state

**Decision**: The live `ReadinessTracker` (`backend/src/ai/readiness.ts`) is unchanged — it
still starts every process at `not-loaded` and transitions only via explicit
`markLoading`/`markReady`/`markUnavailable` calls driven by a real load attempt, per its
existing FR-019 guarantee ("nothing... re-attempts a load automatically after a failure").
Additively, every transition is also appended to a new `ai_readiness_history` table (state,
reason, modelId, accelerator flags, timestamp). On startup, the backend reads the single most
recent row as `lastKnownReadiness` — a clearly separate, historical field — exposed alongside
(never instead of) the live `getReadiness()` snapshot.

**Rationale**: A "ready" or "loading" state is not resumable across a restart — the actual
ONNX model is not in memory, so silently reporting `state: "ready"` from a stale persisted
value before re-loading anything would misrepresent live status (violating CLAUDE.md §18: "do
not silently transition between states"). What the user actually asked for ("last failure
etc.") is historical/diagnostic value, not a resumed live state — e.g., "the model failed to
load for reason X the last time this ran," visible immediately on the next startup before any
new load attempt completes. Keeping the two fields separate (`readiness` live, `lastKnown*`
historical) preserves the existing readiness state machine's semantics exactly.

## D6: Benchmark results — additive DB write alongside the existing file artifact

**Decision**: `backend/src/ai/benchmark/runBenchmark.ts` continues to write
`specs/004-ai-provider-local-inference/benchmark-results.json` exactly as today (a versioned,
checked-in engineering artifact per constitution XXIII — this is evidence for a model
selection decision, not runtime state, and must remain human-reviewable in the spec
directory). Additively, the same `BenchmarkReport` is inserted as a row in a new
`benchmark_runs` table via the same `AiDiagnosticsRepository` used by D5, so the running
server can expose the most recent run without reading a file at request time.

**Rationale**: The JSON artifact and the DB row serve different audiences — the file is a
durable, git-tracked record for engineering review (constitution XXII/XXIII); the DB row is
for the running application to answer "what did the last benchmark find" without filesystem
access to a spec directory that may not exist in a deployed build. Duplicating the same
`BenchmarkReport` shape into both avoids introducing a new schema for one of them.

**Contract note**: `specs/004-ai-provider-local-inference/contracts/ai-status-api.md`
currently states the `GET /api/ai/status` shape "MUST NOT be extended speculatively (e.g.,
adding benchmark data or inference history) ahead of a concrete need from a later feature."
This feature is that concrete need; Phase 1 updates that contract's note accordingly rather
than silently overriding it.

## D7: Credential-at-rest protection

**Decision**: Encrypt `Environment.variableValues` (the field that can carry credential-like
values, e.g. a token) at rest using Node's built-in `node:crypto` (AES-256-GCM), with the
symmetric key stored in a separate local file (`<same directory as APIPILOT_DB_PATH>/db.key`,
generated on first run if absent, `0600`-equivalent permissions where the platform supports
it). All other fields (`name`, `tier`, `baseUrl`, `requestDelayMs`) are stored in plaintext —
only the value bag that can carry secrets is encrypted.

**Rationale**: Spec 025 deferred this decision to planning. The constitution requires avoiding
"unnecessary persistence" and logging of credentials (XVII, XX) but does not mandate
encryption at rest for local single-operator storage; however, given ApiPilot is developed
under ISO/IEC 27001:2022 governance and `variableValues` is the one field explicitly called
out across specs 017/018 as credential-carrying, storing it in plaintext in a DB file that
could be casually copied, backed up, or committed by mistake is a meaningfully worse posture
than the in-memory-only status quo it replaces. `node:crypto` is a Node built-in — no new
dependency (constitution §5, "smallest dependency that solves the actual requirement"). A
separate key file (not a hardcoded/derived-from-nothing key) keeps the DB file alone
insufficient to decrypt credentials if copied without its key file, a reasonable local-first
threat model without introducing OS keychain integration (out of scope; no such dependency
exists today and it would be genuinely new infrastructure, constitution XXVII).

**Alternatives considered**:
- No encryption (plaintext): simplest, but meaningfully weakens the credential-handling
  posture the platform otherwise maintains (constitution XVII/XVIII) for what is explicitly
  known to be credential-carrying data.
- OS keychain / credential manager integration: stronger, but a new dependency and platform-
  specific code path with no existing precedent in this codebase — disproportionate to a
  local single-operator tool; revisit only if a later specification establishes a concrete
  need (constitution XXVII).

## D8: Schema initialization ("migration on first run")

**Decision**: A single idempotent `initializeSchema(db)` function runs `CREATE TABLE IF NOT
EXISTS` for every table on every connection open (server start, or test setup). No migration
framework/library is introduced. `PRAGMA user_version` is set to `1` after initialization,
reserving the mechanism for a future schema change to detect and react to, without building
that mechanism now (constitution XXVII — no infrastructure for a hypothetical future need).

**Rationale**: This is a v1 schema with no prior version to migrate from; the smallest correct
solution is idempotent `CREATE TABLE IF NOT EXISTS`, not a migrations library. If a future
feature needs to alter this schema, `user_version` gives it a documented, versioned starting
point rather than an undocumented one.

## D9: Corrupted or unreadable DB file

**Decision**: Opening the DB (`new Database(path)`) that fails (e.g., "file is not a
database", permission denied) is caught once at startup in `server.ts`, wrapped in a new
`PersistenceInitializationError`, logged (error category only, per constitution XX), and the
process exits with a non-zero code — mirroring the existing `EADDRINUSE` handling pattern in
`server.ts:43-51`. The system MUST NOT delete, rename, or silently recreate a file it cannot
read.

**Rationale**: Directly satisfies spec FR-007 and constitution XIX (Fail Safely): a corrupted
file is far more likely to represent something worth investigating (disk failure, a
half-written file from a crashed process, a wrong path) than something to be silently
discarded.

## D10: Test isolation

**Decision**: `SqliteConnection` accepts an explicit path; passing `:memory:` (a
`better-sqlite3` in-memory database, no file created) is used by every automated test. A new
`backend/tests/setup/testDb.ts` provides a `beforeEach` that opens a fresh `:memory:`
connection and swaps it into the repositories under test (via the same factory functions
production code uses), so no test run ever touches a real `APIPILOT_DB_PATH` file, and no
state leaks between tests. This mirrors the existing `resetEnvironmentStore()` /
`resetExecutionRunStore()` test-only-hook convention: those hooks are replaced by a
`resetDb()` that re-runs `initializeSchema` against a fresh `:memory:` connection.

**Rationale**: Satisfies spec FR-011 and constitution XXI (deterministic, isolated test
boundaries) with no added dependency — `:memory:` is a built-in `better-sqlite3` mode.
