# Implementation Plan: Test Scenario Review

**Branch**: `006-test-scenario-review` | **Date**: 2026-09-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-test-scenario-review/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

AP-006 adds a human-in-the-loop review boundary over a supplied deterministic or enhanced
TestModel. Reviewers can inspect scenarios, filter the review set, accept or reject scenarios,
record rejection feedback, edit supported test intent, and explicitly regenerate AI suggestions.
The design keeps review state separate from scenario provenance, preserves the last valid state
on failed or stale updates, and exposes only accepted scenarios through an approved TestModel
view.

## Technical Context

**Language/Version**: TypeScript on Node.js 20 LTS; React and Vite for the existing web UI

**Primary Dependencies**: Existing npm workspaces, Express, React, Vitest, Supertest, React
Testing Library, and `@apipilot/shared-domain`; no new dependency required

**Storage**: N/A for the initial feature; review state is session-scoped and stateless at the
HTTP boundary

**Testing**: Shared-domain unit tests, backend domain unit tests, Supertest integration tests,
and React Testing Library component tests

**Target Platform**: Local Node.js web service and browser-based React application

**Project Type**: TypeScript web application monorepo with backend API, frontend UI, and shared
domain package

**Performance Goals**: Successful review decisions should update the visible state and summary
within 2 seconds; review actions must not block on API execution or artifact generation

**Constraints**: Preserve AP-005 provenance; validate edits against ApiModel and supported test
intent; prevent pending/rejected scenarios from approved output; detect stale revisions; redact
sensitive values; keep AI regeneration behind `AIProvider`; no persistence, execution, approval
automation, or artifact generation in this feature

**Scale/Scope**: One TestModel per review workspace, with at least 50 scenarios supported for
search, filtering, summary, and per-scenario review; no multi-user durable collaboration

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- Specification Is the Source of Truth: PASS. Review edits are validated against the ApiModel
  and cannot invent contract facts.
- Deterministic Before AI: PASS. Review transitions, summaries, policy checks, duplicate
  prevention, and stale-update detection are deterministic; AI is used only for explicit
  regeneration.
- AI Is an Assistant, Not the Authority: PASS. AI origin remains visible and regeneration
  always returns the scenario to pending review.
- Human-in-the-Loop: PASS. Acceptance, rejection, editing, and regeneration are explicit
  reviewer actions.
- Test Provenance and Traceability: PASS. Decision and edit history retain prior origins.
- Security and Privacy by Design: PASS. Sensitive request values are minimized and redacted at
  display and diagnostic boundaries.
- Fail Safely: PASS. Invalid edits, failed regeneration, and stale updates preserve the last
  confirmed valid state.
- Separation of Concerns: PASS. Shared contracts, backend review logic, HTTP adaptation, and
  presentation remain separate.

**Post-design gate status**: PASS. The research and contracts preserve the same boundaries;
no constitution violation requires a complexity exception.

## Project Structure

### Documentation (this feature)

```text
specs/006-test-scenario-review/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── testDesign/
│   └── api/
└── tests/
    ├── integration/
    └── unit/testDesign/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

packages/shared-domain/
├── src/
└── tests/
```

**Structure Decision**: Extend the existing shared-domain package with review contracts; add
pure review-state functions beside the existing backend test-design logic; expose thin review
route adapters; and add a review page, service, and components beside the current frontend
scenario views. Keep review state separate from TestScenario provenance and keep the initial
boundary stateless.

## Complexity Tracking

No constitution violations. No complexity exceptions required.
