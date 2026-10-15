# Research: Access-Token-Protected Dev Server on a Network Address

All unknowns from the Technical Context are resolved here. Facts about Vite were checked against the installed version (8.3.4) rather than recalled.

## D1. Where the check lives, and whether the backend gets a secret

**Decision**: Enforce the token in the dev server only. The backend stays loopback-bound and unchanged.

**Rationale**: The dev server is the only path by which network traffic reaches the backend. A secret shared between the proxy and the backend would not stop a network client, because the proxy would attach it on that client's behalf; it would only defend against other processes on the engineer's own machine, which the single-user model already trusts. It would also add configuration and a backend change for no gain against the threat this feature addresses.

**Alternatives considered**: (a) A proxy-to-backend secret header. Rejected for the reason above; revisit if the trust model changes. (b) Authentication in the backend. Rejected as out of scope (accounts, multi-user auth) and a much larger change. (c) Binding the dev server to a network address with no protection. Rejected: it recreates the exposure fixed in ROADMAP item 83.

## D2. Protection follows the listen address; there is no off switch

**Decision**: Protection is on if and only if the resolved host is not one of the loopback names. No setting disables it, and none enables it on loopback.

**Rationale**: A separate enable flag can be set wrongly, which is exactly the accidental-exposure case the spec forbids (FR-002, SC-006). Tying it to the address makes the unsafe combination unrepresentable.

**Loopback set**: exactly `localhost`, `127.0.0.1` and `::1`, matching `isLoopbackBindAddress` in the backend. Anything else, including `127.0.0.2`, is treated as non-loopback and protected. Doubt resolves toward protection.

## D3. Validating `FRONTEND_DEV_HOST`

**Decision**: Trim; empty or unset means `127.0.0.1`. Strip one pair of surrounding brackets from an IPv6 literal. Valid if `net.isIP()` is non-zero or the value is a syntactically valid host name (labels of letters, digits and hyphens, 1 to 63 characters, no leading or trailing hyphen, at most 253 characters in total). Otherwise throw during config load with a message naming the setting. Vite then reports it and exits non-zero (FR-011).

**Rationale**: A typo must not silently bind somewhere unintended. The message does not need to hide the value; it is not a secret.

**Wildcards**: `0.0.0.0` and `::` are valid IPs and non-loopback, so they are protected and trigger the "list every interface" notice.

## D4. Token

**Decision**: 32 bytes from `crypto.randomBytes`, encoded base64url (43 characters, 256 bits). Generated per plugin instance, so per launch and per automatic server restart.

**Rationale**: Exceeds the 128-bit floor in FR-003. A dev-server restart (for example after `vite.config.ts` changes) builds a new plugin instance, which gives a new token, matching the spec's restart edge case.

## D5. Constant-time comparison

**Decision**: Hash both values with SHA-256 and compare the digests with `crypto.timingSafeEqual`.

**Rationale**: `timingSafeEqual` requires equal-length buffers, and comparing raw strings of different lengths would leak the length. Hashing first makes both inputs 32 bytes and removes that distinction (FR-010).

## D6. The credential the browser keeps

**Decision**: Cookie `apipilot_dev_access` whose value is the token, with `HttpOnly; SameSite=Strict; Path=/` and no `Max-Age` or `Expires` (session cookie). No `Secure`, because the connection is plain HTTP and a `Secure` cookie would never be stored.

**Rationale**: `HttpOnly` keeps it out of reach of page scripts (FR-005). `SameSite=Strict` means a page on another site cannot cause the browser to send it, which closes cross-site request forgery and the DNS-rebinding path (spec Story 2 scenario 5). A session cookie ends with the browser session, and the token itself ends with the launch.

**Alternatives considered**: (a) `localStorage` and an `Authorization` header: readable by any script in the page, and every `fetch` call site would need changing. Rejected. (b) A server-issued opaque session id: no extra security, because the token is as strong and is already in the URL once. Rejected as needless state.

**Interaction with the backend's session cookie**: unrelated, different name and path of origin. The dev proxy removes `apipilot_dev_access` from the `Cookie` header it forwards, so the secret never reaches the backend or its logs.

## D7. Exchanging the token

**Decision**: On `GET` or `HEAD` with a `token` query parameter: if it matches, respond `302` to the same path and remaining query without `token`, with the `Set-Cookie` above and `Cache-Control: no-store`. If it does not match, refuse (D9), even when a valid cookie is also present. Any other method with a `token` parameter is refused.

**Rationale**: Redirecting before any other middleware means the URL carrying the token is never seen by Vite's static serving, error reporting or logger (FR-008) and is gone from the address bar after one load (SC-008). Refusing an invalid parameter keeps the behaviour uniform (FR-007).

## D8. Gating every kind of request

**Decision**: Register the guard in the plugin's `configureServer` hook with `server.middlewares.use(...)` and no returned function, so it runs before Vite's internal middlewares (assets, HMR client, `/@vite/*`, the `/api` proxy). For WebSocket upgrades, register `server.httpServer.prependListener("upgrade", ...)` that checks the cookie and, on failure, writes a `401` and destroys the socket.

**Rationale**: Vite documents that middlewares added in `configureServer` without a post-hook run first. Vite 8 also has its own WebSocket token and host validation (`hostValidationMiddleware`, which allows IP-literal hosts and `localhost` and blocks other names), but those protect against browser-driven attacks and do not authenticate a person, so they are not a substitute. `prependListener` guarantees the check runs before Vite's own upgrade handling; the `ws` library already closes a destroyed socket safely if later listeners still run.

**Host names**: Vite's host validation allows IP literals and `localhost`. An engineer who browses by a machine name needs `server.allowedHosts`. That is out of scope here and noted in the documentation.

## D9. Refusal responses

**Decision**: Always `401`, `Cache-Control: no-store`, and a body that is the same for a missing, malformed, partly correct or stale credential. For paths starting with `/api`: `application/json` `{"error":"unauthorized","message":"..."}`. For everything else: `text/plain` with one sentence pointing to the address printed in the terminal.

**Rationale**: FR-007 and FR-012. A uniform answer reveals nothing about how close a guess was or whether a token ever existed.

## D10. Making an authorised request pass the backend's guard

**Problem**: The backend's `localHostGuard` rejects any request whose `Host` or `Origin` is not loopback. `changeOrigin: true` already rewrites `Host`. A browser on another device sends `Origin: http://<lan-ip>:5173` on state-changing requests (and some others), which the guard would reject with `403`. Without handling this, the feature would work for reads and break uploads, approvals and runs (spec Story 1 scenario 3).

**Decision**: The guard, after it has accepted a request whose path starts with `/api`, adjusts the incoming request's own headers before the proxy copies them: if `Origin` is present it becomes `http://127.0.0.1:<backendPort>`, and the `apipilot_dev_access` cookie is removed from `Cookie` (the header is deleted if it becomes empty). This happens only when protection is on, and only after acceptance.

**Rationale**: The backend's guard exists to stop a hostile page from reaching a loopback service. After the dev server has proven that the caller holds the token, presenting the request to the backend as same-machine is accurate, and the backend's own check is untouched for every direct caller (FR-009). Doing it on the incoming request avoids relying on the proxy's `proxyReq` event: `http-proxy-3` emits it from the outgoing request's `socket` event, by which point the request may already have generated its headers, and `setHeader` would throw. Mutating `req.headers` ahead of the proxy has no such ordering question, because the proxy builds the outgoing headers from it.

**Alternatives considered**: (a) Relax the backend guard to allow a configured extra origin. Rejected: weakens the backend. (b) Use the proxy `headers` option to force `Origin`. Rejected: it would also add an `Origin` to requests that had none. (c) Drop `Origin` entirely. Rejected: the backend's session and logging code may read it. (d) Rewrite in the proxy's `proxyReq` event. Rejected for the ordering risk above.

## D11. The terminal notice

**Decision**: After the server is listening, write to `process.stdout` (never Vite's logger, which feeds `logs/frontend.log`) a block containing: one URL per address, `http://<address>:<port>/?token=<token>`, a one-line statement that the connection is unencrypted and the URL is a secret, and a pointer to the documentation. Addresses: if the host is a specific address, that address; if it is a wildcard, every non-internal IPv4 address and every non-link-local IPv6 address from `os.networkInterfaces()`; IPv6 is bracketed. If none, say so and print no loopback URL. The port is read from the listening socket, because Vite may move to the next free port.

**Rationale**: FR-004, FR-014, and the spec edge cases for several addresses and none. `no-console` is an ESLint error, so `process.stdout.write` is used.

## D12. Duplication of the loopback set

**Decision**: Keep a local copy in `frontend/devAccess/listenAddress.ts`. A unit test reads `backend/src/security/localHostGuard.ts` and asserts that the same three names appear in its set.

**Rationale**: Vite loads its config before the workspaces are built, and the frontend must not import backend source. The shared-domain package is for contracts consumed at runtime by both layers, not for tooling policy. A test is the lightest way to stop the two lists drifting.

## D13. Type-checking the tooling

**Decision**: Add `frontend/tsconfig.tooling.json` (noEmit, `types: ["node"]`, includes `devAccess/`) and run it in the frontend build script before `vite build`. Add `@types/node` to the frontend workspace's devDependencies.

**Rationale**: `frontend/tsconfig.json` has `rootDir: src` and includes only `src`, so security-relevant tooling would otherwise never be type-checked (CLAUDE.md §44). The existing `viteLogger.ts` has the same gap; closing it for that file is out of scope.

## D14. Versioning

**Decision**: Minor bump to 19.52.0 across root, backend, frontend and shared-domain, per the repository's practice for a feature, with a ROADMAP entry.
