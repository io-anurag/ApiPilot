# Configuration, persistence, and security

Operator reference for running ApiPilot. For installation and first run, see the [README](../README.md).

## Configuration

Copy `.env.example` to `.env` to override defaults. The root `.env` is loaded by `backend/src/loadEnv.ts`; the Vite dev server and `npm run stop` read the two ports from the same file, and a variable already set in the shell takes precedence everywhere. Backend startup validates the enhancement run budget and initializes persistence before accepting requests.

`.env.example` leaves the tuning variables (timeouts, batch sizes, run budgets, throughput estimates) empty or commented out, so the defaults in `backend/src/ai/modelConfig.ts` apply; set one only to override it. Relative paths in `AI_MODEL_CACHE_DIR` and `APIPILOT_DB_PATH` resolve from the backend's working directory, which is `backend/` under the npm scripts; the example's `models` and `db/apipilot.db` therefore land in the git-ignored `backend/models/` and `backend/db/`.

| Variable                             | Purpose                                                                         | Default                                 |
| ------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------- |
| `BACKEND_PORT`                       | Express listener port                                                           | `4000`                                  |
| `BACKEND_HOST`                       | Interface the backend binds to; non-loopback values expose an unauthenticated server | `127.0.0.1`                        |
| `FRONTEND_DEV_PORT`                  | Vite development server port                                                    | `5173`                                  |
| `GIT_COMMIT`                         | Commit value returned by `/api/version`                                         | Detected from Git, otherwise `unknown`  |
| `DEBUG_LOG_REAL_CLIENT_IP`           | Opt in to using the Vite proxy's forwarded client IP in diagnostics             | `false`                                 |
| `AI_PROVIDER_MODE`                   | `local` or deterministic `mock`                                                 | `mock` in tests, `local` otherwise      |
| `AI_MODEL_ID`                        | Hugging Face Transformers.js model identifier                                   | `onnx-community/Qwen3-1.7B-ONNX`        |
| `AI_MODEL_CACHE_DIR`                 | Local model cache directory                                                     | `~/.apipilot/models`                    |
| `AI_MODEL_DTYPE`                     | Optional ONNX precision/quantization                                            | Unset; fp32 is the measured CPU default |
| `AI_INFERENCE_TIMEOUT_MS`            | Per-request local inference timeout, including one failure-analysis explanation | `120000`                                |
| `AI_MODEL_CONTEXT_FLOOR_TOKENS`      | Conservative context estimate when a model reports none                         | `2048`                                  |
| `AI_USE_ACCELERATOR`                 | Attempt hardware acceleration                                                   | `false`                                 |
| `AI_ENHANCEMENT_OPERATIONS_PER_UNIT` | Operations per scenario-enhancement batch                                       | `1`                                     |
| `AI_ENHANCEMENT_RUN_BUDGET_MS`       | Whole enhancement run wall-clock ceiling                                        | `300000` (5 minutes)                    |
| `AI_DEPENDENCY_OPERATIONS_PER_UNIT`  | Operations per AI dependency batch                                              | `3`                                     |
| `AI_DEPENDENCY_RUN_BUDGET_MS`        | Whole AI dependency pass ceiling                                                | `120000`                                |
| `AI_PREFILL_MS_PER_TOKEN`            | Optional viability estimate override                                            | Code default                            |
| `AI_DECODE_MS_PER_TOKEN`             | Optional viability estimate override                                            | Code default                            |
| `AI_VIABILITY_SAFETY_FACTOR`         | Optional viability margin override                                              | Code default                            |
| `APIPILOT_DB_PATH`                   | SQLite database path                                                            | `~/.apipilot/apipilot.db`               |
| `K6_BINARY_PATH`                     | Optional path to a k6 (≥ 1.0.0) you installed; never downloaded                 | Unset: the first `k6` on `PATH`         |

On Windows, an enabled accelerator requests DirectML; Linux uses CUDA where available and macOS uses CoreML where available. Check `/api/ai/status` because requesting an accelerator does not guarantee that it initialized. The default local model is roughly 1.7 GB on disk and measured at about 2.75 GB peak process RSS on the reference CPU profile; actual requirements depend on the selected model and dtype.

## Persistence and sessions

### Session model

There is no login or account system. Each browser receives an unguessable UUID in an HTTP-only, same-site cookie. `AsyncLocalStorage` scopes the current workflow to that session, so concurrent browsers do not share workflow state. Sessions are evicted after 60 minutes of inactivity. Guided workflow state is in memory and is lost on backend restart; a reload or second tab in the same active browser session resumes it.

### SQLite persistence

`better-sqlite3` creates the configured database and schema on first use. The persisted categories are:

- Session-owned environments and their execution run history.
- Session-owned uploaded collections, their runs, and AI failure analyses (one encrypted analysis per failed result, replaced atomically when the result is analyzed again). Analyses stored by the earlier AI-decided version are removed at startup, with the count logged, because their cause was chosen by the AI.
- AI readiness history and benchmark diagnostics, which are process-wide rather than session-owned.

Environment variable and credential-like values are encrypted with AES-256-GCM. The key is stored in a sibling `${APIPILOT_DB_PATH}.key` file, so the database and key must be backed up together. Threat model: the file key protects against a copied database file only; the file's `0o600` mode has no effect on Windows, so anyone who can read the data directory can read both. Set `APIPILOT_KEY` (64 hex characters or base64 of 32 bytes) to supply the key from the environment instead; it takes precedence, no key file is created, and a malformed value fails startup. Changing the key makes previously stored values undecryptable. A corrupted or unreadable database fails startup explicitly. Runs left in progress during a backend restart are recorded as cancelled with a backend-restart reason.

## Security model: single-user, local-only

ApiPilot is a single-user tool meant to run on your own machine. It has no authentication or multi-user model: browser sessions are random per-browser cookies that keep workflows separate, not a login. The backend executes scripts and holds stored credentials, so it must not be reachable by others.

- The backend binds to `127.0.0.1` by default. Set `BACKEND_HOST` only if you deliberately accept exposing it; a startup warning is logged when you do.
- While bound to loopback, requests whose `Host` or `Origin` header is not `localhost`, `127.0.0.1` or `[::1]` are rejected with `403 forbidden_host`, which blocks DNS-rebinding attacks from web pages you visit.
- The Vite dev server also binds to `127.0.0.1`.
- Do not put ApiPilot behind a public reverse proxy or deploy it as a shared service without adding authentication first.

### Security and privacy boundaries

- Uploaded specifications are parsed and analyzed but never executed.
- External `$ref` URLs are never fetched.
- There is no cloud AI provider or silent cloud fallback; current modes are local and mock.
- Real API traffic occurs only after an explicit execution action against an operator-defined environment.
- Destructive requests and production-tier environments require an additional confirmation.
- Logs exclude specifications, credentials, raw prompts, raw model responses, and complete request/response bodies.
- AI failure analysis redacts sensitive headers, query parameters, and body fields before evidence reaches the prompt or storage, replaces any sensitive value or bearer token the model's summary or steps still contain, and never sends a request to the target API. The cause is rule-derived and labelled as a likely, not confirmed, cause; only the summary and steps are AI output, labelled as an inference.
- Frontend error forwarding is best-effort, size-limited, and filtered for credential-shaped fields.
