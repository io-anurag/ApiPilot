# Feature Specification: Access-Token-Protected Dev Server on a Network Address

**Feature Branch**: `049-lan-dev-access-token`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Optional per-launch access token that lets the dev server listen on a non-loopback address without exposing the unauthenticated backend API. Today the dev server listens on loopback only, because its API proxy reaches the backend over loopback and would let any machine on the network use the whole API, bypassing the backend's loopback bind. Add an opt-in setting for the address the dev server listens on (default unchanged). When it is not loopback, protection is mandatory: a random token is generated at every launch, shown once in the terminal as a ready-to-open address, remembered by the browser without being readable by page scripts, and required on every request; requests without it get no application content and no API data. The backend's own loopback bind and host check stay as they are. Plain HTTP on a network lets an observer on that network read the token, which must be stated, with a trusted network, TLS or an SSH/VPN tunnel recommended. Out of scope: user accounts, multi-user authentication, TLS termination, persisting tokens."

## Background

ApiPilot is a single-user, local-only tool. Its backend has no authentication: it listens on loopback, and rejects any request whose `Host` or `Origin` is not a loopback name (a defence against DNS rebinding from web pages in the engineer's own browser). The development server for the web interface also listens on loopback only. It was changed from "all interfaces" to loopback in version 19.48.0 (ROADMAP item 83, 2026-10-13) because the dev server forwards `/api` to the backend from the same machine. A device on the network that could reach the dev server therefore reached the whole backend, which holds credentials, sends requests to configured targets and runs scripts and performance tests. The backend's host check does not stop that: the forwarded request carries a loopback `Host`, and a client that sends no `Origin` (for example a command-line tool) passes the `Origin` check because there is nothing to check.

The cost of the hardening is that the interface cannot be opened from another device without a tunnel. This feature lets the engineer opt in to listening on a network address, and makes that safe by requiring a secret that only the person who launched the tool has.

This feature does not add user accounts or any notion of "who" is using ApiPilot. It adds one shared secret per launch, in the manner of a notebook server's access token. The secret protects against other devices on the network. It does not protect against someone who can read the network traffic, because the connection is plain HTTP (see FR-014).

## Clarifications

### Session 2026-10-15

- Q: Does the backend also need its own secret, so that only the dev server can talk to it? → A: No. The backend stays loopback-only and is not reachable from the network by this feature. A secret between the dev server and the backend would only defend against other processes on the engineer's own machine, which the single-user model already trusts, and it would not stop a network client going through the dev server (the dev server would attach the secret for it). The token check belongs where network traffic enters (Assumptions).
- Q: How does a script, `curl` or a CI job call the API through the dev server when it cannot do the browser's address-then-cookie exchange? → A: It sends the token on each request in an `X-ApiPilot-Token` header (FR-016, Story 1 scenario 6). The header is checked exactly like the cookie and is never forwarded to the backend. A `token` query parameter is honoured only to open a page in a browser; on an API path it has no meaning to the guard, because the application's own API requests may use that name.
- Q: Should the token be optionally enabled on loopback too? → A: No. On loopback nothing changes (FR-001, Story 3). Protection is tied to the listen address, so there is no switch that can be set wrongly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open ApiPilot from another device with the printed address (Priority: P1)

An engineer sets the dev server to listen on a network address and starts it. The terminal prints an address that includes a one-time-per-launch token. The engineer opens that address on a laptop or tablet on the same network and uses ApiPilot exactly as on the machine itself: uploads a specification, reviews scenarios, approves them, runs a collection.

**Why this priority**: This is the capability the feature exists to provide. Without it the setting has no value.

**Independent Test**: Start the dev server with a network listen address, open the printed address from a second device, and complete a representative flow (upload a specification, reach scenario review, approve a scenario). Every step must work, including the steps that change state.

**Acceptance Scenarios**:

1. **Given** the dev server was started on a network address, **When** the engineer opens the printed address on another device, **Then** the application loads and the token no longer appears in the address bar.
2. **Given** the application is loaded that way, **When** the engineer performs actions that read data, **Then** they work as they do on the local machine.
3. **Given** the same state, **When** the engineer performs actions that change state (upload a specification, approve a scenario, start a run), **Then** they succeed as they do on the local machine, and are not rejected because the page is served from a network address.
4. **Given** the engineer has opened the application once, **When** they reload the page or open another tab on the same device, **Then** it keeps working without the printed address being used again.
5. **Given** the machine has several network addresses, **When** the server starts, **Then** the terminal prints a ready-to-open address for each of them, so the engineer can choose the one the other device can reach.
6. **Given** a script or command-line client that is not a browser, **When** it sends the token in an `X-ApiPilot-Token` header on a request to the API (or to any other path), **Then** the request is handled as it would be from the local machine, and the header is not passed on to the backend.

---

### User Story 2 - Anything without the token gets nothing (Priority: P1)

Another device on the network, or a person running a command-line tool, reaches the dev server's address but does not have the token, has the wrong one, or has one from an earlier launch. It receives no application content and no API data, for any kind of request.

**Why this priority**: This is the security property that makes the opt-in acceptable. A listen address without it would recreate the exposure the loopback default was introduced to close.

**Independent Test**: With the dev server on a network address, send requests without a token, with a wrong token and with a token from a previous launch to a page, a static asset, an API path (reading and changing state) and the live-reload connection. None may return application content or API data.

**Acceptance Scenarios**:

1. **Given** the dev server is on a network address, **When** a client requests any API path without a valid token, **Then** it receives a structured `401` response and no API data, and the request never reaches the backend.
2. **Given** the same state, **When** a client requests the application page or any of its assets without a valid token, **Then** it receives a short refusal that tells the engineer to use the address printed in the terminal, and no application content.
3. **Given** the same state, **When** a client tries to open the live-reload connection without a valid token, **Then** the connection is refused.
4. **Given** the dev server was restarted, **When** a device still holds the token or the browser credential from the earlier launch, **Then** it is refused exactly like a client with no token.
5. **Given** a web page on an unrelated site is open in the engineer's browser, **When** it causes the browser to send a request to the dev server's address, **Then** the request carries no valid credential and is refused.
6. **Given** the same state, **When** a client supplies a wrong token, **Then** the response does not reveal how much of the token was correct.

---

### User Story 3 - Default behaviour is unchanged, and an unprotected exposure cannot be configured (Priority: P2)

An engineer who does nothing keeps today's behaviour: the dev server listens on loopback only, no token is asked for, and nothing about the local workflow changes. An engineer who sets any non-loopback address always gets protection, and cannot turn it off.

**Why this priority**: It protects every existing user from a regression and makes the feature safe against misconfiguration. It follows the primary stories because it constrains them rather than adding a user-facing capability.

**Independent Test**: Start the dev server with the setting unset and confirm that the address is loopback, no token is requested and the application works as before. Then set each of several non-loopback values (a specific address, all addresses, an IPv6 wildcard) and confirm protection is on in every case.

**Acceptance Scenarios**:

1. **Given** the listen-address setting is unset, **When** the dev server starts, **Then** it listens on loopback only, prints no token, and does not ask for one.
2. **Given** the setting names a loopback address, **When** the dev server starts, **Then** it behaves as in the previous scenario.
3. **Given** the setting names any non-loopback address, including "all addresses", **When** the dev server starts, **Then** token protection is on, and no other setting can switch it off.
4. **Given** the setting holds a value that is not a valid address or host name, **When** the dev server starts, **Then** it refuses to start and says why, and does not fall back to another address.

---

### User Story 4 - The engineer is told what this does and does not protect (Priority: P3)

When the engineer enables a network address, both the terminal and the documentation say plainly that the connection is not encrypted, that anyone who obtains the address can use ApiPilot until the next restart, and what to do instead if the network is not trusted.

**Why this priority**: The protection has a real limit, and an engineer who does not know about it could assume more safety than exists. It is documentation and messaging, so it follows the behaviour.

**Independent Test**: Start the dev server on a network address and read the terminal notice. Read the configuration documentation for the setting.

**Acceptance Scenarios**:

1. **Given** the dev server starts on a network address, **When** the engineer reads the terminal output, **Then** it states that the connection is unencrypted and that the address is a secret to be shared with care.
2. **Given** the engineer reads the configuration documentation, **Then** it describes the setting, the token, what happens on restart, the plain-HTTP limit, and the recommended alternatives for an untrusted network (a trusted network only, TLS in front, or an SSH or VPN tunnel).

---

### Edge Cases

- **Restart.** Every launch has a new token, including a restart the dev server triggers itself (for example after its configuration changes). Open pages stop working after a restart and the engineer must use the newly printed address. A client with an old credential sees the same refusal as one with none (FR-012).
- **The printed address is shared.** Anyone who has the address can use ApiPilot until the next restart. The token is not tied to a device, and the feature does not claim otherwise.
- **The token is in the address on first load.** The address bar, browser history and any link the page makes could retain it. The token is removed from the address after it is accepted, and the printed address is meant to be opened once.
- **Several network addresses, or IPv6.** The notice lists one address per reachable interface. If none exists, the notice says no network address is available instead of printing a loopback one.
- **Requests from the browser carry the network address as their origin.** The backend rejects any `Origin` that is not loopback. A request that has already passed token validation must still reach the backend and succeed, for state-changing requests too, without the backend's check being loosened for anyone else (FR-009, Story 1 scenario 3).
- **Opening the loopback address of the same machine while the server is on a network address.** The token is still required. There is no exemption by source address, because the source address of a forwarded or tunnelled connection is not reliable evidence of who is asking.
- **The terminal output is captured.** The one printed address is the only place the token appears. It must not be copied into the dev server's log file or into any other log (FR-008).
- **A request carries the token in its address and fails for another reason.** Logs and error messages that record the request address record it without the token.
- **Direct requests to the backend.** The backend is not reachable from the network by this feature. A direct request to it with a network `Host` or `Origin` is rejected as it is today (FR-009).
- **The production-style preview and the backend's own start command.** They are outside this feature and keep their present behaviour.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide an opt-in setting for the address the dev server listens on. When it is unset, or names a loopback address, the dev server MUST behave exactly as it does today: it listens on loopback only, asks for no token, and prints no token.
- **FR-002**: When the setting names any address that is not loopback, including "all addresses" and an IPv6 wildcard, access-token protection MUST be on, and no other setting, argument or environment value may turn it off.
- **FR-003**: When protection is on, the system MUST generate a new token at every launch from a cryptographically secure source, with at least 128 bits of randomness. The token MUST be held in memory only and MUST NOT be written to any file, the environment or any store.
- **FR-004**: When protection is on, the system MUST print the token once in the terminal, as a ready-to-open address for each network address of the machine, together with the notice required by FR-014. The notice MUST NOT be repeated into any log file.
- **FR-005**: When a request carries a valid token in its address, the system MUST accept it, remember that this browser is authorised for the rest of that launch, and redirect to the same address without the token. The remembered authorisation MUST NOT be readable by scripts running in the page and MUST NOT be sent on cross-site requests.
- **FR-006**: When protection is on, every request to the dev server MUST present a valid token or a valid remembered authorisation. This covers application pages, static assets, API paths of every method, and the live-reload connection. A request without one MUST receive no application content and no API data.
- **FR-007**: A refused API request MUST receive a structured `401` response with a stable error code and a short message. A refused page or asset request MUST receive a short plain explanation that points the engineer to the address printed in the terminal. Neither may reveal whether a presented token was absent, malformed, partly correct or from an earlier launch.
- **FR-008**: The token MUST NOT appear in the dev server's log file, in the backend's logs, in error messages, or in any terminal output other than the single notice in FR-004. A request that carried the token in its address MUST be recorded without it.
- **FR-009**: This feature MUST NOT weaken or bypass the backend's protections. The backend MUST remain listening on loopback only, and its `Host` and `Origin` check MUST remain as it is for direct requests. A request that has passed FR-006 MUST work end to end as it does from the local machine, including state-changing requests, and MUST NOT be rejected because the page was served from a network address.
- **FR-010**: The comparison of a presented token with the real one MUST NOT take a time that depends on how many leading characters match.
- **FR-011**: When the setting holds a value that is not a valid address or host name, the dev server MUST refuse to start with an explicit message, and MUST NOT fall back to another address.
- **FR-012**: A token or remembered authorisation from an earlier launch MUST be refused exactly as a request with none is refused (FR-007), and the refusal MUST direct the engineer to the newly printed address.
- **FR-013**: There MUST be no exemption from FR-006 based on the address a request comes from, including requests from the machine's own loopback address while protection is on.
- **FR-014**: The terminal notice and the documentation MUST state that the connection is plain HTTP, that an observer on the same network can read the token, and that anyone holding the printed address can use ApiPilot until the next restart. They MUST recommend a trusted network, TLS in front of the dev server, or an SSH or VPN tunnel for anything else.
- **FR-016**: A client that is not a browser MUST be able to present the token on each request in an `X-ApiPilot-Token` header. The header is validated exactly as the remembered authorisation is (FR-006, FR-007, FR-010), it is never passed on to the backend or logged (FR-008), and the terminal notice (FR-004) shows how to use it. A `token` query parameter is accepted only to open a page; it has no effect on an API path.
- **FR-015**: The new setting MUST be documented in the example environment file and in the configuration documentation, with its default and the consequences of changing it.

### Key Entities

- **Listen Address Setting**: The engineer's choice of the address the dev server listens on. Its default is loopback. Whether it is loopback decides whether protection is on.
- **Access Token**: A secret generated for one launch, held in memory only, shown once in the terminal, and invalid after the next restart.
- **Access Header**: The `X-ApiPilot-Token` request header by which a script presents the token on every request, in place of a remembered authorisation.
- **Remembered Authorisation**: What the browser holds after it has presented a valid token once. It is not readable by page scripts, is not sent on cross-site requests, and is valid only for the launch that issued it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With protection on, 100% of requests without a valid token, sampled across a page, a static asset, a reading API path, a state-changing API path and the live-reload connection, receive no application content and no API data.
- **SC-002**: An engineer can open the printed address on a second device and reach a working application in one step, with nothing to configure on that device.
- **SC-003**: A representative flow (upload a specification, reach scenario review, approve a scenario, start a run) completes from a second device with the same result as on the local machine, with no request rejected because of the network address.
- **SC-004**: With the setting unset, the dev server's behaviour is unchanged: it listens on loopback, asks for no token, and the existing test suites pass without modification.
- **SC-005**: After a full session in protected mode, searching the dev server's log file, the backend's logs and the captured terminal output finds the token only in the one startup notice (which contains it in the address to open and in the script example).
- **SC-006**: For every non-loopback value of the setting that is tested (a specific address, all addresses, an IPv6 wildcard), protection is on, and no combination of other settings turns it off.
- **SC-007**: After a restart, 100% of requests that still hold the previous launch's token or remembered authorisation are refused.
- **SC-008**: The token is visible in the browser's address bar for no longer than the first page load.

## Assumptions

- The product is a single-user tool. One shared token per launch is the intended model, and "the person holding the printed address" is the only identity the system recognises. User accounts and per-user permissions are out of scope.
- Listening on a network address is rare and deliberate. It is an opt-in for an engineer who wants to use ApiPilot from another device on a network they control.
- The token check lives where network traffic enters, which is the dev server. The backend stays loopback-only and gains no new secret. A secret between the dev server and the backend would not stop a network client, because the dev server would attach it on that client's behalf, and the only thing it would add is protection against other processes on the engineer's own machine, which the single-user model already trusts. If that model changes, this decision should be revisited.
- A 128-bit random token is large enough that guessing it is impractical, so the feature adds no limit on the number of attempts. A faster-than-network guessing attack on a launch that lasts hours is not a credible threat at that size.
- The connection is plain HTTP. Encrypting it (TLS termination) is out of scope. Where encryption is needed the engineer puts a TLS proxy in front, or uses a tunnel (FR-014).
- A remembered authorisation lasts for the browser session and for the launch that issued it. There is no sign-out, because there is no account; stopping the dev server ends access for every device.
- The token is not persisted and not configurable. Pinning a token in a settings file would put a long-lived secret on disk, which the "persisting tokens" exclusion rules out.
- Only the development server is covered. The production-style preview and the backend's own start command keep their present loopback behaviour and are out of scope.
- The existing `Host` and `Origin` check and the loopback bind of the backend stay as they are and are not part of this feature's change surface, other than making sure that a request that passed the token check is not rejected by them (FR-009).
