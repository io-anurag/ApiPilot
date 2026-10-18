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
| `FRONTEND_DEV_HOST`                  | Address the Vite dev server listens on; any non-loopback value turns on the access token (see below) | `127.0.0.1`                |
| `GIT_COMMIT`                         | Commit value returned by `/api/version`                                         | Detected from Git, otherwise `unknown`  |
| `DEBUG_LOG_REAL_CLIENT_IP`           | Opt in to using the Vite proxy's forwarded client IP in diagnostics             | `false`                                 |
| `AI_PROVIDER_MODE`                   | `local` or deterministic `mock`                                                 | `mock` in tests, `local` otherwise      |
| `AI_MODEL_ID`                        | Hugging Face Transformers.js model identifier                                   | `onnx-community/Qwen3-1.7B-ONNX`        |
| `AI_MODEL_CACHE_DIR`                 | Local model cache directory                                                     | `~/.apipilot/models`                    |
| `AI_MODEL_DTYPE`                     | Optional ONNX precision/quantization                                            | Unset; fp32 is the measured CPU default |
| `AI_INFERENCE_TIMEOUT_MS`            | Per-request local inference timeout, including one failure-analysis explanation | `120000`                                |
| `AI_MODEL_CONTEXT_FLOOR_TOKENS`      | Conservative context estimate when a model reports none                         | `2048`                                  |
| `AI_USE_ACCELERATOR`                 | Experimental hardware acceleration; verified after load, may be slower          | `false`                                 |
| `AI_ENHANCEMENT_OPERATIONS_PER_UNIT` | Operations per scenario-enhancement batch                                       | `1`                                     |
| `AI_ENHANCEMENT_RUN_BUDGET_MS`       | Whole enhancement run wall-clock ceiling                                        | `300000` (5 minutes)                    |
| `AI_DEPENDENCY_OPERATIONS_PER_UNIT`  | Operations per AI dependency batch                                              | `3`                                     |
| `AI_DEPENDENCY_RUN_BUDGET_MS`        | Whole AI dependency pass ceiling                                                | `120000`                                |
| `AI_PREFILL_MS_PER_TOKEN`            | Optional viability estimate override                                            | Code default                            |
| `AI_DECODE_MS_PER_TOKEN`             | Optional viability estimate override                                            | Code default                            |
| `AI_VIABILITY_SAFETY_FACTOR`         | Optional viability margin override                                              | Code default                            |
| `APIPILOT_DB_PATH`                   | SQLite database path                                                            | `~/.apipilot/apipilot.db`               |
| `K6_BINARY_PATH`                     | Optional path to a k6 (≥ 1.0.0) you installed; never downloaded                 | Unset: the first `k6` on `PATH`         |
| `INPUT_HAR_MAX_ENTRIES`              | Most entries a HAR capture may hold before the upload is refused                | `5000`                                  |
| `INPUT_MAX_BODY_BYTES`               | Largest request or response body analyzed from a capture; larger bodies are skipped and reported | `1048576` (1 MiB)         |
| `INPUT_MAX_JSON_DEPTH`               | Deepest object or array nesting a JSON upload may have before it is refused     | `128`                                   |

**`AI_USE_ACCELERATOR` is experimental, and CPU is the recommended setting.** On Windows an enabled accelerator requests DirectML. On Linux and macOS the inference library chooses a device for its generic GPU request; ApiPilot has not measured that, so do not assume a specific accelerator there.

It was measured slower than CPU for the models ApiPilot ships (2026-10-17, one Windows laptop with Intel integrated graphics and an NVIDIA RTX 500 Ada with 4 GB of VRAM, `onnxruntime-node` 1.30.0, `@huggingface/transformers` 4.3.1, each configuration in its own process). Qwen2.5-0.5B at fp32 was correct but 2x to 4x slower than CPU on real scenario-enhancement prompts. Qwen3-1.7B, the default, returned unusable output on DirectML (garbage text or an empty reply) at fp32 and fp16 on both GPUs, while CPU returned coherent output. Other machines may differ, which is why ApiPilot verifies the accelerator at run time.

After an accelerator loads, ApiPilot runs one small fixed check inference and keeps the accelerator only if the reply is usable. If the accelerator fails to load, or loads but fails the check (`unusable-reply`, `timeout` or `inference-error`), ApiPilot falls back to CPU and records why in `reason`; it never falls back to another provider. `GET /api/ai/status` reports the device in use (`inferenceDevice`), a descriptive `acceleratorLabel` (`DirectML` on Windows, the generic `Accelerator` elsewhere), `acceleratorAdapter` (always `null`: the runtime does not expose the adapter) and `acceleratorVerification`. Its `tokensPerSecond` is a coarse, cold, single end-to-end sample that includes prompt prefill, for noticing order-of-magnitude differences rather than benchmarking, and the status does not itself compare against CPU. Reference rates measured the same way on the same laptop's CPU:

| Configuration                                    | Reported rate                       |
| ------------------------------------------------ | ----------------------------------- |
| Qwen2.5-0.5B, CPU                                | about 8.9 tokens/s (4 tokens, 0.45 s) |
| Qwen3-1.7B, CPU                                  | about 2.9 tokens/s (4 tokens, 1.4 s)  |
| Qwen2.5-0.5B, DirectML, as the status reports it | median about 4.0 tokens/s (2.2 to 4.5 over 20 loads) |

The default local model is roughly 1.7 GB on disk and measured at about 2.75 GB peak process RSS on the reference CPU profile; actual requirements depend on the selected model and dtype.

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
- The Vite dev server also binds to `127.0.0.1` unless you set `FRONTEND_DEV_HOST`; see [Opening ApiPilot from another device](#opening-apipilot-from-another-device) below.
- Do not put ApiPilot behind a public reverse proxy or deploy it as a shared service without adding authentication first.

### Opening ApiPilot from another device

The dev server forwards `/api` to the backend from your own machine, so letting it listen on a network address would give every device on that network the whole backend. That is why it listens on loopback only. `FRONTEND_DEV_HOST` lets you opt in to a network address, and when you do, an access token is mandatory. There is no setting that turns the token off, and none that turns it on for loopback.

| `FRONTEND_DEV_HOST` | Result |
| --- | --- |
| Unset, `127.0.0.1`, `localhost` or `::1` | Unchanged: loopback only, no token. |
| `0.0.0.0` or `::` | Listens on every interface; the token is required. |
| A specific address or a host name | Listens on that address; the token is required. |
| Anything that is not an address or a host name | The dev server refuses to start and names the setting. It does not fall back to another address. |

When the token is required:

- A new 256-bit random token is generated every time the dev server starts, including an automatic restart after `vite.config.ts` changes. It is held in memory only: it is never written to a file or to any log, and it cannot be set in `.env`.
- The terminal prints it once, as a ready-to-open address per network address of the machine, for example `http://192.168.1.20:5173/?token=…`. The notice is written to the terminal only, not to `logs/frontend.log`.
- Open that address once on the device you want to use. The dev server stores a session cookie (`HttpOnly`, `SameSite=Strict`) that page scripts cannot read, and redirects to the same address without the token, so it does not stay in the address bar. Reloads and new tabs on that device keep working.
- Every request is checked: pages, assets, `/api` and the live-reload connection. A request without a valid credential gets `401` and nothing else, with the same body whatever the reason.
- **Scripts and CI** cannot do the browser exchange. Send the token on each request in an `X-ApiPilot-Token` header, for example `curl -H "X-ApiPilot-Token: <token>" http://192.168.1.20:5173/api/health`. The header is checked like the cookie and is never forwarded to the backend. A `?token=` query parameter only opens a page; it has no effect on `/api` paths.
- A restart invalidates every earlier token and cookie. Open the newly printed address.
- The backend is not changed. It still listens on loopback and still applies its `Host` and `Origin` check to direct callers. A request that has passed the token check is presented to it as a same-machine request (the dev server rewrites the browser's network `Origin` to the backend's own loopback origin and removes the token).
- To browse by a machine name instead of an IP address, add that name to `server.allowedHosts` in `frontend/vite.config.ts`; Vite blocks unknown host names.

**Limits you must understand.** The connection is plain HTTP, so anyone who can read traffic on that network can read the token, and anyone who has the printed address can use ApiPilot until the next restart. There is no sign-out and no per-device identity. Use this only on a network you trust. For anything else, put TLS in front of the dev server, or skip this feature and use an SSH or VPN tunnel to the loopback address instead, for example `ssh -N -L 5173:127.0.0.1:5173 user@host`.

Only the development server is covered. `vite preview` and the backend's own start command keep their loopback behaviour.

### Security and privacy boundaries

- Uploaded specifications are parsed and analyzed but never executed.
- External `$ref` URLs are never fetched.
- There is no cloud AI provider or silent cloud fallback; current modes are local and mock.
- Real API traffic occurs only after an explicit execution action against an operator-defined environment.
- Destructive requests and production-tier environments require an additional confirmation.
- Logs exclude specifications, credentials, raw prompts, raw model responses, and complete request/response bodies.
- AI failure analysis redacts sensitive headers, query parameters, and body fields before evidence reaches the prompt or storage, replaces any sensitive value or bearer token the model's summary or steps still contain, and never sends a request to the target API. The cause is rule-derived and labelled as a likely, not confirmed, cause; only the summary and steps are AI output, labelled as an inference.
- Frontend error forwarding is best-effort, size-limited, and filtered for credential-shaped fields.
