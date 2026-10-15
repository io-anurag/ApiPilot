# Data Model: Access-Token-Protected Dev Server on a Network Address

Nothing here is persisted or shared with the backend or `shared-domain`. These are in-process types of the dev tooling in `frontend/devAccess/`, listed so the contract and tests share one vocabulary.

## ListenAddress (resolved setting)

Result of resolving `FRONTEND_DEV_HOST` (shell value first, then the repository-root `.env`, as `FRONTEND_DEV_PORT` is).

| Field | Type | Rule |
|---|---|---|
| `host` | `string` | Trimmed. Unset or empty becomes `127.0.0.1`. One pair of surrounding brackets on an IPv6 literal is removed. |
| `loopback` | `boolean` | `true` only when `host` (lowercased) is `localhost`, `127.0.0.1` or `::1`. |
| `wildcard` | `boolean` | `true` for `0.0.0.0` and `::`. |
| `protected` | `boolean` | Always `!loopback`. There is no input that changes this. |

**Validation**: valid when `net.isIP(host) !== 0` or `host` is a syntactically valid host name (labels of 1 to 63 letters, digits and hyphens, none starting or ending with a hyphen, at most 253 characters in total). Anything else makes resolution throw an error that names `FRONTEND_DEV_HOST` (FR-011).

## AccessToken

| Field | Type | Rule |
|---|---|---|
| `value` | `string` | 43 characters of base64url from 32 random bytes. Held in memory by one plugin instance. |
| `digest` | `Buffer` | SHA-256 of `value`, kept to compare against the digest of a presented value. |

**Lifecycle**: created when the plugin is constructed (dev-server start or automatic restart); never written to a file, the environment or a log; discarded with the plugin instance. A presented value from any other instance fails.

## AccessCredential (what the browser holds)

| Attribute | Value |
|---|---|
| Name | `apipilot_dev_access` |
| Value | the token |
| `HttpOnly` | yes (not readable by page scripts) |
| `SameSite` | `Strict` (not sent on cross-site requests) |
| `Path` | `/` |
| Lifetime | session (no `Max-Age` or `Expires`) |
| `Secure` | no, because the connection is plain HTTP |

## AccessHeader (what a script presents)

| Attribute | Value |
|---|---|
| Name | `X-ApiPilot-Token` |
| Value | the token, sent on every request (surrounding spaces ignored) |
| Validity | same comparison as the cookie; a repeated header never matches |
| Forwarded to the backend | never |

## AccessDecision (result of inspecting one request)

A discriminated union returned by the pure decision function.

| `kind` | Meaning | Carries |
|---|---|---|
| `allow` | A valid cookie or a valid access header was presented. | nothing |
| `exchange` | A valid `token` query parameter on `GET`/`HEAD`, on a path outside `/api`. | `location`: the same path and remaining query without `token`; `cookie`: the `Set-Cookie` value |
| `refuse` | Anything else, including a wrong, stale or malformed value and a `token` parameter on another method. | `api`: `true` when the path starts with `/api`, selecting the response form |

The decision never records, returns or logs the presented value.

## State transitions

```text
dev server starts (protected) ──► token created ──► notice printed (terminal only)
client request ──► decide() ──► allow    ──► forward (with backend-facing header rewrite for /api)
                          ├──► exchange ──► 302 + Set-Cookie, token removed from the URL
                          └──► refuse   ──► 401, uniform body
dev server restarts ──► new token ──► every earlier credential now refuses
```
