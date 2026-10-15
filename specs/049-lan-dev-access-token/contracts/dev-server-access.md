# Contract: Dev Server Access Protection

Interfaces this feature adds or changes. The backend's HTTP API contracts are not changed.

## 1. Setting

| Name | Where read | Default | Effect |
|---|---|---|---|
| `FRONTEND_DEV_HOST` | shell, then repository-root `.env` (same order as `FRONTEND_DEV_PORT`) | `127.0.0.1` | The address the dev server listens on. Loopback or unset: behaviour unchanged, no token. Any other valid value: protection on, cannot be disabled. An invalid value stops startup. |

`.env.example` documents it, with the plain-HTTP warning. There is no setting to turn protection on or off.

## 2. Startup behaviour

| Condition | Result |
|---|---|
| Unset, empty or loopback | Listens on that loopback address. Nothing is printed about a token. Identical to today. |
| Valid, non-loopback | Listens on that address (or every interface for a wildcard). Protection is on. The notice below is printed once. |
| Invalid value | Config load throws an error that names `FRONTEND_DEV_HOST`; the process exits non-zero. No fallback address. |

## 3. Terminal notice (stdout only)

Printed once, after the server is listening, only when protection is on. Written with `process.stdout.write`, never through Vite's logger, so it never reaches `logs/frontend.log`.

```text
ApiPilot dev server is listening on a network address and is protected by an access token.
Open one of these addresses on the device you want to use (keep them secret; they stop working when the server restarts):

  http://192.168.1.20:5173/?token=<43 characters>
  http://[2001:db8::20]:5173/?token=<43 characters>

Scripts and other non-browser clients: send the token on every request in an X-ApiPilot-Token header, for example:
  curl -H "X-ApiPilot-Token: <43 characters>" http://192.168.1.20:5173/api/health

The connection is plain HTTP: anyone who can read traffic on this network can read the token.
Use a trusted network, put TLS in front, or use an SSH or VPN tunnel. See docs/configuration.md.
```

- A specific address prints one line; a wildcard prints one line per non-internal IPv4 address and per non-link-local IPv6 address.
- If no address qualifies, the notice says so and prints no loopback URL.
- The port is the one actually bound (Vite may move to the next free port).

## 4. Requests to the dev server (protection on)

Every request is inspected before any other handling: pages, assets, Vite internals, `/api`, and WebSocket upgrades.

| Request | Response |
|---|---|
| Valid cookie `apipilot_dev_access`, or a valid `X-ApiPilot-Token` header (whole value equals the token; surrounding spaces ignored; a repeated header never matches) | Handled as normal. For `/api`, the request is first presented to the backend as same-machine (section 6). |
| `GET`/`HEAD` with a valid `?token=` on a path outside `/api` | `302`, `Location` = same path and query without `token`, `Set-Cookie: apipilot_dev_access=<token>; HttpOnly; SameSite=Strict; Path=/`, `Cache-Control: no-store`. |
| `?token=` on a path under `/api` | The parameter is ignored. The cookie or header decides, as for any other `/api` request. |
| Anything else (no credential, wrong, stale, malformed, a `token` parameter that does not match or on a method other than `GET`/`HEAD`) | `401`, `Cache-Control: no-store`. The body is identical whatever the reason. A wrong `?token=` is refused even when a valid cookie or header is also sent. |
| WebSocket upgrade without a valid cookie or header | `HTTP/1.1 401 Unauthorized`, connection closed. |

### Refusal bodies

For paths starting with `/api`:

```json
{ "error": "unauthorized", "message": "Access token required. Open the address printed in the terminal where the dev server was started." }
```

`Content-Type: application/json`.

For every other path, `Content-Type: text/plain; charset=utf-8`:

```text
Access token required. Open the address printed in the terminal where the dev server was started.
```

The message is the same for a missing, wrong or stale credential (FR-007, FR-012).

## 5. What is never emitted

The token appears nowhere except the notice in section 3 and, transiently, in the first request's URL and the `Set-Cookie` of the `302`. It is not logged by the dev server or the backend, not forwarded to the backend, and not present in error messages. Requests carrying it are redirected before any later middleware runs.

## 6. Presentation to the backend (requests that passed)

For an accepted request whose path starts with `/api`, before the proxy forwards it:

| Header | Change |
|---|---|
| `Origin` | If present, replaced by `http://127.0.0.1:<BACKEND_PORT>`. If absent, left absent. |
| `Cookie` | `apipilot_dev_access` removed; the header is deleted if nothing else remains. |
| `X-ApiPilot-Token` | Removed. |
| `Host` | Already rewritten to the backend's by the proxy's `changeOrigin`. |

The backend's `Host`/`Origin` guard is unchanged. A direct request to the backend with a network `Host` or `Origin` is still rejected with `403 forbidden_host`.

## 7. Compatibility

- Default behaviour (unset or loopback) is unchanged, so existing flows, tests and `npm run dev` are unaffected.
- No change to backend routes, shared-domain contracts or the frontend's API client.
- `npm run stop` finds the dev server by listening port, independent of the host, so it is unaffected.
