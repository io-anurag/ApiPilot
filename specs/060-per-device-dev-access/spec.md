# Feature Specification: Per-Device Access Tokens for the Network Dev Server

**Feature Branch**: `060-per-device-dev-access`

**Created**: 2026-10-30

**Status**: Draft

**Supersedes in part**: `specs/049-lan-dev-access-token` (the shared per-launch token, the `?token=` exchange and the printed token).

**Input**: User description: "FRONTEND_DEV_HOST makes a per-launch access token mandatory when it is not loopback. Sharing that one token with every intranet user is a security concern. Each user should generate their own token, valid only on their own system."

## Background

Spec 049 lets the dev server listen on a network address behind one token generated at each launch and printed in the terminal. Every user must be handed that same token. A token that is shared cannot be traced to a person or device, and it leaks to everyone who has ever been given it.

This feature replaces the shared token with per-device tokens that each user obtains for themselves. A token is bound to the browser that received it and to the network address that browser connected from, so a copy used elsewhere is refused.

### Decisions recorded with the requester (2026-10-30)

- **Issuance is open self-service and automatic.** Any browser that can reach the dev server from a private network address is issued a token on its first page load, without a confirmation step (requester decision, 2026-10-30). There is no operator approval step. This protects against a copied token, against devices outside the private network, and against requests that carry no credential. It does **not** stop a device that is already on the private network from enrolling and using ApiPilot. The requester accepted this. Anyone who needs a gatekeeper must keep the loopback default or use an SSH/VPN tunnel.
- **Binding is cookie plus client IP**, in memory, ending at restart.
- Enrolment is limited to private-network client addresses. This is a safeguard added to the self-service decision, so that setting `FRONTEND_DEV_HOST=0.0.0.0` on a machine that is also reachable from a public address does not let the public internet enrol.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A user gets their own access (Priority: P1)

A user on the intranet opens the dev server's address. The application opens straight away: the browser is given its own token with the first page load, with no page, button or confirmation in between. Nobody has to be told a secret.

**Independent Test**: With the dev server on a non-loopback address, open it from a browser and use the application. Reload and open a second tab; both keep working. Open an `/api/...` address in the same browser; it works with the same token.

**Acceptance Scenarios**:

1. **Given** a browser with no credential on a private-network address, **When** the user starts a page load (typed address, link, bookmark), **Then** the page is served and the browser receives its own token as an `HttpOnly`, `SameSite=Strict` session cookie.
2. **Given** the browser holds that cookie, **When** it uses pages, assets, `/api` and the live-reload connection, **Then** they work as before, including state-changing requests.
3. **Given** two users open the address, **Then** each receives a different token, and neither token is shown in the terminal or in any log.
4. **Given** a subresource request, a cross-site page load, a request that does not ask for HTML, or a client outside the private networks, **Then** no token is issued and the request is refused.

### User Story 2 - A token works only on the system it was issued to (Priority: P1)

A token copied to another device, or presented from another network address, is refused.

**Acceptance Scenarios**:

1. **Given** a token issued to address A, **When** it is presented from address B, **Then** the request is refused exactly like a request with no credential.
2. **Given** the dev server restarted, **Then** every earlier token is refused.
3. **Given** a request from an address that is not loopback, private (RFC 1918), link-local, shared (CGNAT) or IPv6 unique-local, **When** it tries to enrol, **Then** it is refused with `403` and receives no token.
4. **Given** a cross-site page makes the user's browser send an enrolment request, **Then** it is refused because its `Origin` is not the dev server's own.

### User Story 3 - Scripts can get a token too (Priority: P2)

A script on the intranet requests a token with `POST /__apipilot/access` and `Accept: application/json`, then sends it in `X-ApiPilot-Token` on every request. The token is bound to the script host's address like any other.

### User Story 4 - Loopback default is unchanged (Priority: P2)

With `FRONTEND_DEV_HOST` unset or loopback there is no protection, no enrolment page and no behaviour change (spec 049 FR-001, FR-002, FR-011 still apply).

## Requirements _(mandatory)_

- **FR-001**: Listen-address resolution and the rule that any non-loopback value turns protection on are unchanged (049 FR-001, FR-002, FR-011).
- **FR-002**: There MUST be no shared token. The dev server MUST NOT print, log or otherwise expose any token, and MUST NOT accept a `token` query parameter.
- **FR-003**: `POST /__apipilot/access` MUST issue a new token from a cryptographically secure source with at least 128 bits of randomness, bound to the connecting socket's address. The address MUST be taken from the socket, never from a request header.
- **FR-004**: A token MUST be issued only to a client whose address is loopback, private, link-local, shared-address-space or IPv6 unique-local. The script endpoint MUST also refuse a request whose `Origin` is present and differs from its `Host`. A browser page load qualifies for automatic issuance only when it is a `GET` that accepts `text/html`, whose `Sec-Fetch-Dest` is absent or `document` and `Sec-Fetch-Site` is not `cross-site`.
- **FR-005**: A qualifying browser page load without a valid token MUST be served normally with the new token in a `Set-Cookie` (`HttpOnly`, `SameSite=Strict`, `Path=/`, session) and no redirect or confirmation. A script enrolment (`POST /__apipilot/access`) MUST respond `201` with `{ "token": "..." }` and `Cache-Control: no-store`.
- **FR-006**: Every other request MUST present a token by cookie or by `X-ApiPilot-Token`, and the token MUST have been issued to the address the request comes from. This covers pages, assets, `/api` of every method, and WebSocket upgrades.
- **FR-007**: Refusals keep the uniform shape of 049 FR-007: API paths get `401` JSON `{ error: "unauthorized", message }`, other paths get `401` plain text. The body is the same whether the credential was absent, wrong, stale or bound to another address, and never contains a token.
- **FR-008**: Tokens MUST be held in memory only, stored as digests, and cease to exist at restart.
- **FR-009**: Issuance MUST be bounded: at most 10 live tokens per client address (the oldest is replaced) and 1000 in total (further enrolment is refused with `503` until restart).
- **FR-010**: The backend, its loopback bind and its `Host`/`Origin` check are unchanged. An accepted `/api` request is presented to it as a same-machine request and the cookie and header are removed (049 FR-009).
- **FR-011**: The terminal notice MUST list the addresses to open, state that each user enrols for themselves and that tokens are bound to the device and end at restart, state that the connection is plain HTTP, and show how a script enrols. It contains no secret.
- **FR-012**: `.env.example`, `docs/configuration.md`, `docs/architecture.md` and `docs/USER_MANUAL.md` MUST describe the new behaviour and its limits.

## Success Criteria

- **SC-001**: 100% of requests without a valid token for their own address, across a page, an asset, a reading API path, a state-changing API path and the live-reload connection, receive no application content and no API data.
- **SC-002**: A token presented from a different address is refused in 100% of tested cases.
- **SC-003**: A user reaches a working application by opening the address, with no secret to receive and nothing to confirm.
- **SC-004**: A search of the terminal output, the dev server log and the backend logs finds no token.
- **SC-005**: With `FRONTEND_DEV_HOST` unset, behaviour and existing tests are unchanged.

## Assumptions and limits

- A client behind a shared NAT or proxy presents one address to the dev server, so users behind it share that address binding. The cookie still separates browsers; the address check does not.
- The connection is plain HTTP. An observer on the network can read a token and, if it can also use the same source address, replay it. TLS in front or an SSH/VPN tunnel remains the recommendation for an untrusted network.
- Open self-service means a person who is already on the private network can enrol. Revocation is a restart.
- `X-Forwarded-For` is deliberately ignored, so a reverse proxy in front of the dev server makes every client appear as the proxy.
- Out of scope: accounts, operator approval, persisted tokens, TLS termination, sign-out.
