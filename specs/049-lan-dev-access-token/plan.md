# Implementation Plan: Access-Token-Protected Dev Server on a Network Address

**Branch**: `049-lan-dev-access-token` | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/049-lan-dev-access-token/spec.md`

## Summary

Add an opt-in `FRONTEND_DEV_HOST` setting for the address the Vite dev server listens on. Unset or loopback keeps today's behaviour exactly. Any other value turns on mandatory access-token protection that cannot be switched off: a 256-bit random token is generated per launch, printed once in the terminal as ready-to-open addresses, exchanged on first visit for an `HttpOnly`, `SameSite=Strict` session cookie, and required on every HTTP request and WebSocket upgrade the dev server receives. Refusals are a uniform `401` (JSON for `/api`, short text elsewhere) that reveals nothing about why.

The whole feature is a Vite plugin plus pure helper modules in `frontend/devAccess/`, wired in `frontend/vite.config.ts`. The backend is not changed. After accepting a request to `/api`, the guard rewrites its non-loopback `Origin` to the backend's own loopback origin and removes the access cookie before the proxy forwards it, so requests that passed the token check still pass the backend's unchanged `Host`/`Origin` guard (FR-009) while that guard stays exactly as strict for direct callers.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 (dev tooling, run by Vite at startup)

**Primary Dependencies**: `vite` 8.3.4 (existing), Node built-ins only (`node:crypto`, `node:net`, `node:os`, `node:http`). No new runtime dependency. `@types/node` added to the frontend workspace's devDependencies for the new tooling typecheck (already present in `backend`).

**Storage**: None. The token lives in memory for one dev-server instance and is never written anywhere (FR-003).

**Testing**: Vitest (frontend project) with `// @vitest-environment node`. Unit tests for the pure modules. An integration test starts a real Vite dev server on an ephemeral loopback port with the plugin forced on, behind a stub backend that applies the real `localHostGuard`, and sends raw `node:http` requests so `Host`, `Origin` and `Cookie` can be set freely.

**Target Platform**: Developer machines (Windows, macOS, Linux). Dev server only. `vite preview` and the backend start command are out of scope.

**Project Type**: Web application (npm-workspaces monorepo). Change is confined to the `frontend` workspace's Node-side tooling, plus docs and root `.env.example`.

**Performance Goals**: None beyond not adding perceptible latency: one SHA-256 comparison per request.

**Constraints**: Token never logged (CLAUDE.md §49, constitution XX); terminal notice must bypass Vite's logger (it feeds `logs/frontend.log`); `no-console` ESLint rule forbids `console.*`, so the notice is written with `process.stdout.write`; fail safe on an invalid host value (constitution XIX); default behaviour byte-identical when the setting is unset (SC-004).

**Scale/Scope**: Single user, a handful of devices. Not a multi-user system.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Assessment |
|---|---|
| XVII. Security and Privacy by Design | **PASS with documented relaxation.** "Local-only mode MUST provide a meaningful privacy boundary." Local-only stays the default and is unchanged. Network listening is an explicit opt-in, always token-protected, with the plain-HTTP limit stated in the terminal and in the docs (FR-014), which is the "clearly indicate" the principle asks for. The principle does not forbid a network listener, so no amendment is needed. |
| XVIII. Secrets | **PASS.** The token is a runtime secret that never enters a generated artifact, `.env`, a log or a file (FR-003, FR-008). Pinning it in `.env` is deliberately not supported. |
| XIX. Fail Safely | **PASS.** An invalid `FRONTEND_DEV_HOST` stops the server with a clear message; there is no fallback address (FR-011). Any doubt about a host value resolves to "protected". |
| XX. Observability Without Sensitive Logging | **PASS.** The token appears only in the one startup notice, written to the terminal, not through Vite's logger. Requests carrying it are redirected before any later middleware can log them. |
| XXI. Testability at Every Boundary | **PASS.** Host policy, token, cookie and decision logic are pure and unit tested. The wiring is covered by a real-server integration test. |
| XXVII. Prefer Simple Architecture | **PASS.** One plugin, no dependency, no backend change. The rejected alternative (a second secret between proxy and backend) is recorded in research.md D1. |
| XXX. Explicit Trade-offs | **PASS.** Plain HTTP on a network, shared token, no sign-out are stated as limits (spec Assumptions, FR-014). |
| XIV. No Silent Assumptions | **PASS.** Nothing is inferred silently: no exemption by source address (FR-013), no default exposure. |
| CLAUDE.md §26-§43 (UI) | **Not applicable.** No application UI. The refusal body is a short plain-text message. |

**Post-design re-check**: still PASS. Design added one dev-only type dependency (`@types/node`) and no runtime dependency. No Complexity Tracking entries are needed.

## Project Structure

### Documentation (this feature)

```text
specs/049-lan-dev-access-token/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rejected alternatives
├── data-model.md        # Phase 1: listen-address policy, token, credential
├── quickstart.md        # Phase 1: how to run and verify
├── contracts/
│   └── dev-server-access.md   # Phase 1: setting, terminal notice, request/response contract
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
frontend/
├── devAccess/
│   ├── listenAddress.ts     # resolve + validate FRONTEND_DEV_HOST, loopback policy (pure)
│   ├── accessControl.ts     # token generation, constant-time compare, cookie, request decision, refusals (pure)
│   ├── apiProxy.ts          # the one /api proxy options factory, shared by vite.config.ts and the integration test
│   ├── notice.ts            # terminal notice: addresses to print and the text (pure)
│   └── devAccessPlugin.ts   # Vite plugin: HTTP gate, WebSocket gate, backend-facing header rewrite, prints the notice
├── tsconfig.tooling.json    # noEmit typecheck for devAccess/ (frontend/tsconfig.json only covers src/)
├── vite.config.ts           # reads the setting, applies the plugin when protected, uses apiProxy()
└── tests/
    ├── unit/devAccess*.test.ts           # listenAddress, accessControl (incl. backend-facing header rewrite), notice
    └── integration/
        ├── devAccessServer.test.ts       # real Vite server + stub backend using the real localHostGuard
        └── devAccessConfig.test.ts       # the real vite.config.ts resolved under different FRONTEND_DEV_HOST values
.env.example                 # FRONTEND_DEV_HOST documented
docs/configuration.md        # setting, token, restart behaviour, plain-HTTP limit
docs/architecture.md         # security-model paragraph updated
docs/USER_MANUAL.md          # how to open from another device
README.md                    # "Security model" section updated
specs/ROADMAP.md             # new item, version bump to 19.52.0
```

**Structure Decision**: Keep everything in the frontend workspace's Node-side tooling, next to `viteLogger.ts`, because the dev server is the only place network traffic enters. The backend and `shared-domain` are untouched. The loopback-name set is duplicated from `backend/src/security/localHostGuard.ts` because Vite loads its config before any workspace is built and the frontend cannot depend on the backend; a unit test pins the two sets together by reading the backend module's source.

## Complexity Tracking

No constitution violations to justify.
