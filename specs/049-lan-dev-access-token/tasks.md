---

description: "Task list for the access-token-protected dev server on a network address"
---

# Tasks: Access-Token-Protected Dev Server on a Network Address

**Input**: Design documents from `/specs/049-lan-dev-access-token/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/dev-server-access.md](./contracts/dev-server-access.md), [quickstart.md](./quickstart.md)

**Tests**: Included. CLAUDE.md section 51 treats tests as part of the feature, and the security properties (SC-001, SC-005, SC-007) are only credible when exercised against a real server.

**Organization**: Grouped by user story. All new code is in the `frontend` workspace's Node-side tooling under `frontend/devAccess/`; the backend is not changed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 to US4, mapping to the user stories in spec.md

## Phase 1: Setup

**Purpose**: Make the new tooling type-checked and its types available.

- [x] T001 Add `@types/node` (same range as `backend/package.json`, `^24.19.2`) to the `devDependencies` of `frontend/package.json` using `npm install -D @types/node@^24.19.2 -w frontend`, so the lockfile is updated by npm (plan D13)
- [x] T002 [P] Create `frontend/tsconfig.tooling.json` (extends `../tsconfig.base.json`, `noEmit`, `types: ["node"]`, `include: ["devAccess"]`) and change the `build` script in `frontend/package.json` to `tsc -p tsconfig.json && tsc -p tsconfig.tooling.json && vite build`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure modules every story uses. No story can start until these are done.

**CRITICAL**: These are independent files and can be built in parallel.

- [x] T003 [P] Implement `frontend/devAccess/listenAddress.ts` per data-model.md `ListenAddress`: `resolveListenAddress(raw: string | undefined)` returning `{ host, loopback, wildcard, protected }`; unset or empty gives `127.0.0.1`; strip one pair of brackets on an IPv6 literal; loopback set exactly `localhost`, `127.0.0.1`, `::1`; `protected` is always `!loopback`; valid values are `net.isIP(host) !== 0` or a syntactically valid host name; an invalid value throws an `Error` whose message names `FRONTEND_DEV_HOST` (FR-001, FR-002, FR-011, plan D2 and D3)
- [x] T004 [P] Unit tests in `frontend/tests/unit/devAccessListenAddress.test.ts` (`// @vitest-environment node`): default, empty, each loopback name, `0.0.0.0`, `::`, `[::]`, a specific LAN address, `127.0.0.2` (protected), a valid host name, rejected values (`not a host`, `a b`, `-bad.example`, over-long label, `http://x`), and a test that reads `backend/src/security/localHostGuard.ts` as text and asserts the three loopback names appear in its set (plan D12)
- [x] T005 [P] Implement `frontend/devAccess/accessControl.ts` per data-model.md: `createAccessToken()` (32 bytes from `crypto.randomBytes`, base64url, 43 characters), `tokensMatch(a, b)` (SHA-256 of both then `crypto.timingSafeEqual`), `ACCESS_COOKIE_NAME = "apipilot_dev_access"`, `buildAccessCookie(token)` (`HttpOnly; SameSite=Strict; Path=/`, no `Max-Age` or `Expires`, no `Secure`), `readAccessCookie(cookieHeader)`, `decideAccess({ method, url, cookieHeader }, token)` returning the `allow | exchange | refuse` union (an `exchange` only for `GET`/`HEAD` with a matching `token` parameter, `location` being the same path and remaining query without `token`; a `token` parameter that does not match, or on another method, is `refuse` even when a valid cookie is also sent), `refusalBody(isApi)` giving the identical text or JSON for every reason, and `presentToBackend(headers, backendOrigin)` (rewrite `Origin` only when present; remove the access cookie from `Cookie`, deleting the header if it becomes empty). No function may log or return the presented value (FR-003, FR-005, FR-007, FR-010, research D4 to D10)
- [x] T006 [P] Unit tests in `frontend/tests/unit/devAccessAccessControl.test.ts` (`// @vitest-environment node`): token length and character set, two tokens differ, `tokensMatch` true and false including different lengths, cookie attributes exactly as the contract states, cookie parsing with several cookies and malformed headers, every `decideAccess` branch, `refusalBody` identical across reasons, `presentToBackend` (Origin present, Origin absent, cookie alone, cookie among others, no cookie header)
- [x] T007 [P] Create `frontend/devAccess/apiProxy.ts` exporting `apiProxyOptions(backendPort: string)` that returns today's `/api` proxy options unchanged (`target: http://127.0.0.1:<port>`, `changeOrigin: true`, `xfwd: true`, with the existing explanatory comments), so `vite.config.ts` and the integration test use one definition

**Checkpoint**: Foundation ready. Pure logic is complete and tested; wiring can begin.

---

## Phase 3: User Story 1 - Open ApiPilot from another device with the printed address (Priority: P1) MVP

**Goal**: With a network listen address, the engineer opens the printed address on another device and uses ApiPilot normally, including state-changing requests.

**Independent Test**: Start the dev server with protection on, request the printed address, follow the redirect with the issued cookie, then make a read and a state-changing `/api` request carrying a network `Origin`. All succeed, and the backend receives a loopback `Origin` and no access cookie.

### Tests for User Story 1

- [x] T008 [P] [US1] Unit tests for the notice in `frontend/tests/unit/devAccessNotice.test.ts` (`// @vitest-environment node`): a specific address prints one URL; a wildcard prints one URL per non-internal IPv4 and non-link-local IPv6 address from a supplied interface table (IPv6 bracketed); no qualifying address prints the "no network address" text and no loopback URL; the port comes from the bound port argument; every URL carries `?token=`
- [x] T009 [US1] Integration test in `frontend/tests/integration/devAccessServer.test.ts` (`// @vitest-environment node`, generous timeout): start a real Vite dev server with `configFile: false`, `logLevel: "silent"`, host `127.0.0.1`, port 0, the plugin forced on and `apiProxyOptions` pointing at a stub backend; the stub backend is a `node:http` server that applies the real `localHostGuard` from `backend/src/security/localHostGuard.ts` through a small express-like `res.status().json()` shim and echoes the headers it received. Send raw `node:http` requests to control `Host`, `Origin` and `Cookie`. Cover: valid token gives `302` without `token` in `Location` and a `Set-Cookie` with `HttpOnly` and `SameSite=Strict`; the cookie then loads the page; a `POST /api/echo` with `Origin: http://192.168.1.50:5173` returns `200` and the stub saw `Origin: http://127.0.0.1:<port>`, a loopback `Host` and no access cookie; a request with no `Origin` is forwarded with none added; the same request sent straight to the stub with the network `Origin` is still `403 forbidden_host` (FR-009)

### Implementation for User Story 1

- [x] T010 [P] [US1] Implement `frontend/devAccess/notice.ts` per contracts section 3: `listNoticeAddresses(host, wildcard, interfaces)` and `buildNotice({ addresses, port, token })` returning the text, including the unencrypted-connection statement and the documentation pointer (FR-004, FR-014). Pure; takes the interface table as an argument so tests do not depend on the machine
- [x] T011 [US1] Implement `frontend/devAccess/devAccessPlugin.ts` exporting `devAccessPlugin(options: { backendPort: string; host: ListenAddress })`: create the token per instance; in `configureServer` register `server.middlewares.use(...)` (no post-hook, so it runs before Vite's internal middlewares) that applies `decideAccess`: `exchange` writes `302` with `Location`, `Set-Cookie` and `Cache-Control: no-store`; `refuse` writes `401` with `refusalBody` and `Cache-Control: no-store`; `allow` calls `presentToBackend` on `req.headers` when the path starts with `/api`, then `next()`. After `listening`, print `buildNotice` with `process.stdout.write` using the actually bound port (never `console.*`, never Vite's logger) (FR-004 to FR-009, plan D8 to D11)
- [x] T012 [US1] Wire `frontend/vite.config.ts`: read `FRONTEND_DEV_HOST` from `process.env` then `rootEnv` as the port is read, call `resolveListenAddress`, set `server.host` to the result, replace the inline proxy options with `apiProxyOptions(backendPort)`, and add `devAccessPlugin(...)` to `plugins` only when `protected` is true; update the existing comment about the loopback-only bind to say it is the default and what changes with the setting (FR-001, FR-002)

**Checkpoint**: A network listen address is usable from another device. T008 and T009 pass.

---

## Phase 4: User Story 2 - Anything without the token gets nothing (Priority: P1)

**Goal**: No request without a valid credential, of any kind, returns application content or API data.

**Independent Test**: With protection on, send requests with no token, a wrong token and a stale token to a page, an asset, `/@vite/client`, reading and state-changing `/api` paths, and a WebSocket upgrade. None returns content, all `401`, and the bodies are identical.

### Tests for User Story 2

- [x] T013 [US2] Extend `frontend/tests/integration/devAccessServer.test.ts` with the refusal matrix: no credential, wrong `?token=`, wrong `?token=` together with a valid cookie, `token` on a `POST`, a malformed `Cookie`, against `/`, `/index.html`, `/@vite/client`, `/src/main.tsx`, `GET /api/echo`, `POST /api/echo`, `DELETE /api/echo` (each `401`, `Cache-Control: no-store`, no backend call recorded by the stub); assert the `/api` body is the JSON form and every other body the text form, and that the bodies are byte-identical across reasons (FR-007); a raw WebSocket upgrade (`Connection: Upgrade`, `Sec-WebSocket-Protocol: vite-hmr`) without a cookie gets `401` and is closed, and with a valid cookie is not answered by the guard's `401`; restart: start a second server instance, then confirm the first instance's token and cookie are refused by the second (FR-012, SC-007)
- [x] T014 [US2] Add a no-leak test in the same file: capture everything written to `process.stdout`, `process.stderr` and Vite's logger during a full session (exchange, allowed, refused requests); assert the token appears exactly once, in the notice, and the stub backend never received it in any header or URL (FR-008, SC-005)

### Implementation for User Story 2

- [x] T015 [US2] Add the WebSocket gate to `frontend/devAccess/devAccessPlugin.ts`: `server.httpServer?.prependListener("upgrade", ...)` that reads the cookie from `req.headers.cookie` and, unless valid, writes `HTTP/1.1 401 Unauthorized`, `Connection: close` and an empty body, then destroys the socket (FR-006, research D8)
- [x] T016 [US2] Review `frontend/devAccess/*.ts` for any path that could record the presented value (error messages, thrown objects, debug output) and fix any found; confirm a token-bearing URL is redirected before any later middleware can see it (FR-008)

**Checkpoint**: US1 and US2 together form the security-complete increment. T013 and T014 pass.

---

## Phase 5: User Story 3 - Default behaviour is unchanged, and unprotected exposure cannot be configured (Priority: P2)

**Goal**: Unset or loopback behaves as today. Any non-loopback value is always protected. An invalid value refuses to start.

**Independent Test**: Resolve the real `frontend/vite.config.ts` under several `FRONTEND_DEV_HOST` values and inspect the resulting config.

### Tests for User Story 3

- [x] T017 [P] [US3] Integration test `frontend/tests/integration/devAccessConfig.test.ts` (`// @vitest-environment node`): use Vite's `resolveConfig` with `configFile` set to the real `frontend/vite.config.ts`, setting `process.env.FRONTEND_DEV_HOST` per case and restoring it afterwards. Unset, empty, `127.0.0.1`, `localhost`, `::1`: `server.host` is the loopback value and no `apipilot-dev-access` plugin is present, the proxy target is unchanged. `0.0.0.0`, `::`, a specific address, a host name: the plugin is present and no other environment value removes it (set `DEBUG_LOG_REAL_CLIENT_IP`, `NODE_ENV`, and a made-up `FRONTEND_DEV_ACCESS=off` to prove there is no switch). An invalid value: `resolveConfig` rejects with a message naming `FRONTEND_DEV_HOST`, with no fallback (FR-001, FR-002, FR-011, SC-004, SC-006)

### Implementation for User Story 3

- [x] T018 [US3] Make T017 pass: confirm `frontend/vite.config.ts` and `frontend/devAccess/listenAddress.ts` give the exact behaviour above, and give the plugin the name `apipilot-dev-access` so tests and tooling can identify it; fix any gap the test exposes
- [x] T019 [P] [US3] Add `FRONTEND_DEV_HOST` to `.env.example` next to `FRONTEND_DEV_PORT`: default `127.0.0.1`, what a non-loopback value does (token always on, no switch), the plain-HTTP warning, and that the backend stays loopback-only (FR-015)

**Checkpoint**: Default users see no change, and no configuration exposes the server unprotected.

---

## Phase 6: User Story 4 - The engineer is told what this does and does not protect (Priority: P3)

**Goal**: The terminal and the documentation state the limits plainly.

**Independent Test**: Start on a network address and read the notice; read the configuration documentation.

- [x] T020 [P] [US4] Add to `frontend/tests/unit/devAccessNotice.test.ts` assertions that the notice states the connection is unencrypted, that the address is a secret that stops working on restart, and points to `docs/configuration.md` (FR-014)
- [x] T021 [P] [US4] Update `docs/configuration.md`: the `FRONTEND_DEV_HOST` row in the variables table, and a section covering the token, the one-time printed address, what a restart does, the plain-HTTP limit, the recommended alternatives (trusted network, TLS in front, SSH or VPN tunnel), that `server.allowedHosts` is needed to browse by machine name, and correct the existing line that says the Vite dev server always binds `127.0.0.1` (FR-014, FR-015)
- [x] T022 [P] [US4] Update `docs/architecture.md` (the security-model paragraph around the loopback bind and the Vite dev server), `README.md` (the "Security model: single-user, local-only" section), and `docs/USER_MANUAL.md` (how to open ApiPilot from another device, using the printed address)

**Checkpoint**: Every story is complete and documented.

---

## Phase 7: Polish and Cross-Cutting

- [x] T023 Add item 95 to `specs/ROADMAP.md` for this feature (what changed, the decision not to add a backend secret, the Origin presentation, the tests), and bump the version to 19.52.0 across root, backend, frontend and shared-domain with `npm version 19.52.0 --workspaces --include-workspace-root --no-git-tag-version`
- [x] T027 [US1] Added during implementation (a gap found when asked how a script calls the API): the `X-ApiPilot-Token` header for non-browser clients (spec FR-016): `ACCESS_HEADER_NAME`, `hasValidAccessHeader` and `hasValidCredential` in `frontend/devAccess/accessControl.ts`; the guard and the WebSocket gate use it; `presentToBackend` removes it; the notice shows a `curl` example. A `?token=` parameter is honoured only outside `/api`. Unit and integration tests added; spec, contract, data model, quickstart, docs and `.env.example` updated
- [x] T028 [US2] Added during implementation: a control test in `frontend/tests/integration/devAccessServer.test.ts` showing the backend's real guard answers `403 forbidden_host` to a network `Origin` when the guard's backend-facing rewrite is absent, so the rewrite is shown to be needed and its absence detectable
- [x] T029 Tightened `resolveListenAddress` after a test found that `999.999.999.999` passed as a host name: a host name whose last label is all digits is now rejected (spec FR-011)
- [x] T024 Run `npm run lint`, `npm run build` and `npm test`; fix only regressions from this feature and report any unrelated failure with its output (CLAUDE.md section 54)
- [x] T025 Run the quickstart against a real server: start the dev server with `FRONTEND_DEV_HOST=0.0.0.0`, confirm the printed notice, and run the `curl` refusal checks and the token and cookie flow from `specs/049-lan-dev-access-token/quickstart.md`; confirm the token is absent from `logs/frontend.log`; then restore the default and confirm it behaves as before
- [x] T026 Mark every task above complete in this file, and review the final diff for unrelated changes, secrets and leftover scratch files

---

## Dependencies and Execution Order

- **Phase 1** has no dependencies. T001 and T002 touch the same `frontend/package.json`, so run T001 first, then T002.
- **Phase 2** depends on Phase 1 only for the typecheck (T002). T003 to T007 are independent files and can run in parallel; each test task follows its implementation task.
- **US1 (Phase 3)** depends on Phase 2. T008 and T010 are independent files. T011 needs T005, T007 and T010. T012 needs T003, T007 and T011. T009 needs T011 and T012's pieces (it builds its own server, so it needs T011 and T007).
- **US2 (Phase 4)** depends on T011. T013 and T014 extend the integration file from T009 and so run after it. T015 edits `devAccessPlugin.ts` after T011. T016 follows T015.
- **US3 (Phase 5)** depends on T012. T017 and T019 are independent.
- **US4 (Phase 6)** depends on T010 for the notice text; T020 to T022 are independent files.
- **Polish (Phase 7)** depends on all stories.

### Parallel opportunities

- Phase 2: T003, T005, T007 together, then T004 and T006 together.
- Phase 3: T008 and T010 together, before T011.
- Phase 5 and Phase 6: T017, T019, T020, T021, T022 are in different files and can run together once their prerequisites are done.

## Implementation Strategy

### MVP first

Phases 1, 2, 3 and 4 together are the smallest safe increment: a network address is usable, and everything without the token is refused. US1 alone is not safe to ship, because the plugin's refusal behaviour is part of the same middleware; US2's remaining work is the WebSocket gate and the verification that nothing leaks. Stop and validate after Phase 4.

### Incremental delivery

1. Setup and Foundational, then US1 and US2 as one increment, validated by the integration tests.
2. US3 to lock the defaults and the misconfiguration behaviour.
3. US4 for the documentation, then Polish.

## Notes

- No backend files change. If a task seems to need one, stop and reconsider: the design is that the backend's guard is untouched (FR-009).
- Never log, print or return the presented token anywhere except the single startup notice.
- `console.*` is an ESLint error; the notice uses `process.stdout.write`.
- Changes stay uncommitted for review.
