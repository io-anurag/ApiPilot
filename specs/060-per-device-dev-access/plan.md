# Implementation Plan: Per-Device Access Tokens for the Network Dev Server

Spec: [spec.md](spec.md). Touches only `frontend/devAccess/`, its tests and the documentation. No backend, shared-domain or application change.

## Design

- `frontend/devAccess/accessStore.ts` (new): in-memory map of `sha256(token)` to client address. `issue(address)` creates a token (FR-003, FR-009), `verify(token, address)` requires the digest to exist and the address to match (FR-006, FR-008).
- `frontend/devAccess/clientAddress.ts` (new): `normalizeClientAddress` (strips IPv6 zone, unwraps `::ffff:` IPv4) and `isIntranetAddress` (FR-004), built on `node:net` `BlockList`.
- `frontend/devAccess/accessControl.ts`: the shared token, `?token=` exchange and `tokensMatch` are removed. Credential checks take a `check(token)` function. `decideAccess` returns `allow`, `enroll` (a `POST` to `/__apipilot/access`, for scripts), `enroll-browser` (a user-initiated page load without a token) or `refuse`. Refusals are plain text or JSON. `isSameOrigin` supports the script endpoint.
- `frontend/devAccess/devAccessPlugin.ts`: owns one `AccessStore`, derives the client address from the socket (overridable in tests), serves enrolment, applies the check to HTTP and WebSocket upgrades.
- `frontend/devAccess/notice.ts`: notice without a token (FR-011).
- Contract: a qualifying page load is served with `Set-Cookie`. `POST /__apipilot/access` answers `201 {token}`, `403` (address or origin) or `503` (capacity).

## Tests

- Unit: `accessStore`, `clientAddress`, rewritten `accessControl` and `notice` tests.
- Integration: rewritten `devAccessServer.test.ts` against a real Vite server and the real backend host guard, with an injectable client address to prove address binding and the private-network limit.

## Constitution check

Local-first and explicit-failure principles preserved: no network call, no persistence, structured refusals, no silent fallback. The weakened property (no gatekeeper on enrolment) is an explicit, recorded requester decision, stated in the spec, the notice and the documentation.
