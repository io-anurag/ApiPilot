# Phase 0 Research: Application Foundation

All Technical Context items in [plan.md](./plan.md) were resolvable from the roadmap,
constitution, and industry-standard practice for a local TypeScript web application — no
`NEEDS CLARIFICATION` markers remain.

## Decision: Monorepo tooling — npm workspaces

- **Decision**: Use native npm workspaces to manage `backend/`, `frontend/`, and
  `packages/shared-domain` from a single root `package.json`.
- **Rationale**: Ships with Node.js/npm, requires no extra dependency or config file
  beyond the `workspaces` field, and is sufficient for a 3-package monorepo. Aligns with
  constitution XXVII (Prefer Simple Architecture).
- **Alternatives considered**: Nx and Turborepo offer caching/task graphs but add
  configuration and conceptual overhead not justified at this scale; pnpm workspaces
  would require introducing a new package manager without a corresponding benefit for a
  project this size.

## Decision: Backend framework — Express 4.x

- **Decision**: Use Express for the backend HTTP API layer.
- **Rationale**: Minimal, mature (constitution XXVII/XXVIII: "mature libraries", "standard
  protocols"), huge ecosystem, and easy to keep the domain logic (in
  `packages/shared-domain`) decoupled from the web framework so Express remains
  replaceable.
- **Alternatives considered**: Fastify (faster but smaller ecosystem, no material benefit
  for a foundation with one health endpoint); NestJS (opinionated, DI-heavy framework —
  more structure than this stage needs, and risks coupling the domain model to framework
  decorators, conflicting with constitution X/XXVIII).

## Decision: Frontend tooling — React 18 + Vite 5

- **Decision**: Use Vite as the dev server/bundler and React 18 with TypeScript for the
  UI shell.
- **Rationale**: React was already specified as the intended stack in the product
  roadmap for this feature. Vite provides fast startup/HMR and first-class TypeScript
  support with minimal configuration, supporting SC-001 (under 10 minutes to a running
  app).
- **Alternatives considered**: Create React App (unmaintained, slower dev server); Next.js
  (adds server-rendering/routing conventions not needed since this is a local app calling
  a separate backend API).

## Decision: Test runner — Vitest (+ Supertest, + React Testing Library)

- **Decision**: Use Vitest as the single test runner across `backend/`, `frontend/`, and
  `packages/shared-domain`, with Supertest for backend HTTP integration tests and React
  Testing Library for frontend component smoke tests.
- **Rationale**: One test runner for the whole monorepo reduces configuration/maintenance
  surface (constitution XXVII), integrates natively with Vite's TypeScript/ESM handling,
  and is fast enough to satisfy SC-003 (full suite under 5 minutes). Supports constitution
  XXI (Testability at Every Boundary) without requiring any AI/model dependency to run.
- **Alternatives considered**: Jest (widely used, but needs extra config to work cleanly
  with Vite/ESM/TypeScript; Vitest is API-compatible and simpler in this stack).

## Decision: Package manager — npm

- **Decision**: Use npm (already bundled with Node.js) rather than introducing yarn or
  pnpm.
- **Rationale**: No additional install step for contributors; consistent with constitution
  XXVII (Prefer Simple Architecture) and FR-006 (repeatable local startup a new developer
  can follow from a clean clone).
- **Alternatives considered**: pnpm (faster installs, stricter node_modules) and yarn —
  both add a global tooling dependency not currently justified.

## Decision: Dev process orchestration — npm workspace scripts

- **Decision**: Provide root-level `npm run dev` (concurrently starts backend + frontend
  dev servers) and `npm test` (runs Vitest across all workspaces) using npm's built-in
  `--workspaces` flag plus a lightweight `concurrently` dev dependency for parallel
  process output.
- **Rationale**: Satisfies FR-006 (single documented startup process) and FR-012
  (documented instructions) without a process manager or container orchestration layer.
- **Alternatives considered**: Docker Compose (adds a virtualization dependency not
  justified for a local Node/React foundation with no external services); a custom shell
  script (less cross-platform than an npm script on Windows/macOS/Linux).
