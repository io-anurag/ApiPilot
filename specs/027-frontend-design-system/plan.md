# Implementation Plan: Frontend Design System & Application Shell

**Branch**: `027-frontend-design-system` | **Date**: 2026-09-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/027-frontend-design-system/spec.md`

## Summary

A repository audit (see research.md D1) found that ApiPilot's frontend already has a
deliberately-built, partially-complete design system from prior work: Tailwind v4 tokens in
`index.css`, and "single source of truth" shared components — `StatusBadge`, `HttpMethodBadge`,
`ProvenanceBadge`, `controlStyles.ts` (`BUTTON_STYLES`), and `WorkflowStageTracker` — each
explicitly documented as consolidating what used to be duplicated per-file styling (comments
cite a prior `/speckit-analyze` finding). The workflow shell itself is a single header
(`App.tsx`) plus `WorkflowStageTracker`, not a multi-page/sidebar app (there is no router; two
top-level views are toggled by local state, an intentional prior decision).

This plan therefore treats Phase 1 as **closing the remaining gaps in an existing system**, not
building a new one: add the missing shared primitives (empty/error/loading presentation, a
reusable dialog/panel primitive, and a shared tabs primitive — research.md D6), add dark-mode
tokens (currently entirely absent), extract the inline header markup into a reviewable, reusable
`AppHeader`, and make `WorkflowStageTracker`'s already-correct gating logic explicit about *why*
a stage is locked. No new runtime dependency, router, or folder restructuring is introduced, and
no existing behavior changes.

## Technical Context

**Language/Version**: TypeScript 5.9, React 18.3 (existing `frontend/` workspace)

**Primary Dependencies**: React 18, Tailwind CSS v4 via `@tailwindcss/vite` (CSS-first `@theme`
config, no `tailwind.config.js`), Vite 8. No UI component library, icon library, animation
library, or router exists today and none is added by this feature (Constitution XXVII; CLAUDE.md
§5, §34) — existing hand-rolled inline SVG icons (e.g. `WorkflowStageTracker`'s `CheckIcon`) are
the established convention and are extended, not replaced.

**Storage**: N/A — presentation-only feature; no persistence changes.

**Testing**: Vitest + `@testing-library/react` + jsdom (`frontend/tests/unit/*.test.tsx`), one
test file per component, following the existing convention of dedicated accessibility test files
(`TestScenarioReviewAccessibility.test.tsx`, `TestGenerationWorkflowAccessibility.test.tsx`) for
keyboard/contrast/ARIA assertions.

**Target Platform**: Modern desktop browsers (Chrome/Edge/Firefox), responsive down to narrow
laptop/tablet widths per FR-009; local Vite dev server, static production build.

**Project Type**: Web application frontend only (single SPA). No backend change. The app has no
client-side router — two top-level views are toggled by local component state, a documented
decision from spec 009 (`App.tsx` D9/FR-011) that this feature does not revisit.

**Performance Goals**: None set by the spec beyond "no regression"; per CLAUDE.md §34 this
feature must not measurably increase bundle size — satisfied by adding zero new dependencies.

**Constraints**: Zero backend/API-contract change (FR-012); zero behavioral change to any
existing page, including the in-progress External Collections feature (FR-013); must extend, not
duplicate, the existing "single source of truth per concern" files (`StatusBadge`,
`HttpMethodBadge`, `ProvenanceBadge`, `controlStyles.ts`, `WorkflowStageTracker`) rather than
introduce parallel implementations; must preserve the existing flat `frontend/src/components/`
layout convention.

**Scale/Scope**: ~40 existing frontend components, 2 top-level views, 10 workflow stages
(`WORKFLOW_STAGE_ORDER`), ~35 existing unit/accessibility test files that must remain green.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|-----------|------------|
| XXVII. Prefer Simple Architecture | PASS — no new dependency, router, or infrastructure is introduced; this phase only adds a handful of presentation-only components and CSS tokens. |
| XXVIII. Technology Is Replaceable | PASS — stays on the existing Tailwind v4 + React stack; no framework swap. |
| XXXIII. Presentation Must Be Consistent, Coherent, and Usable | Directly satisfied — this is the principle's own remediation: closes the dark-mode gap and the missing empty/error/loading/dialog primitives so every page can share one presentation system. |
| XXXII. Human Review Must Remain Practical at Real Scale | N/A this phase — the bulk-review interaction patterns it governs (`TestScenarioReviewList`, `useBulkDecision`) already exist from spec 010 and are not touched; no new review surface is introduced. |
| XI. Human-in-the-Loop, II. Deterministic Before AI, XIII. Provenance | N/A — no change to what is generated, reviewed, or how provenance is computed; `ProvenanceBadge` is restyled at most, not redefined. |
| XX. Observability Without Sensitive Logging | N/A — no logging change. |
| XXVI. Specification Traceability | PASS — this plan traces to spec 027; any deviation from a page's current look during shell adoption stays within FR-014's explicit "shell/navigation only" boundary. |

No violations identified. Complexity Tracking is not needed.

**Post-design re-check** (after Phase 1): The data model (a client-derived view-model with no new
persistence, endpoint, or domain type — see data-model.md) and the research decisions (extend
existing components; no new dependency, router, or folder reorganization — see research.md
D1–D5) introduce nothing that changes the assessment above. Gate remains PASS.

## Project Structure

### Documentation (this feature)

```text
specs/027-frontend-design-system/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

No `contracts/` directory: this feature has no HTTP/API surface (FR-012 — no backend contract
change), so there is nothing for `contracts/` to document. `data-model.md` instead documents the
one presentation-level concept this feature introduces (Workflow Stage view-model, derived
client-side from existing data).

### Source Code (repository root)

Existing structure, unchanged (frontend-only feature, flat `components/` convention retained —
see research.md D3):

```text
frontend/
├── src/
│   ├── components/            # flat; new files land here alongside existing ones
│   │   ├── AppHeader.tsx           # NEW — extracted from App.tsx's inline header
│   │   ├── workflowStageViewModel.ts # NEW — STAGE_LABELS + getLockReason (data-model.md)
│   │   ├── EmptyState.tsx          # NEW
│   │   ├── ErrorState.tsx          # NEW
│   │   ├── Skeleton.tsx            # NEW
│   │   ├── Dialog.tsx              # NEW — generalized modal shell ConfirmDialog composes
│   │   ├── Tabs.tsx                # NEW — extracted from App.tsx's tab bar (research.md D6)
│   │   ├── StatusBadge.tsx         # EXTEND (dark-mode variants only)
│   │   ├── HttpMethodBadge.tsx     # EXTEND (dark-mode variants only)
│   │   ├── ProvenanceBadge.tsx     # EXTEND (dark-mode variants only)
│   │   ├── controlStyles.ts        # EXTEND (dark-mode variants only)
│   │   ├── WorkflowStageTracker.tsx# EXTEND (explicit lock-reason text, FR-004)
│   │   ├── ConfirmDialog.tsx       # EXTEND (re-platform onto Dialog.tsx, no behavior change)
│   │   └── ...                     # all other existing components unchanged this phase
│   ├── pages/                  # unchanged this phase (content redesign is a later spec)
│   ├── services/                # unchanged — no API contract touched
│   ├── App.tsx                  # EXTEND (renders AppHeader and Tabs instead of inline markup)
│   └── index.css                # EXTEND (dark-mode `@theme` tokens added alongside existing)
└── tests/unit/                  # new test per new component; existing tests must stay green
```

**Structure Decision**: Single-project web frontend (`frontend/`), no backend or contracts
directory needed. Every change lands in the existing flat `frontend/src/components/` directory
using the existing per-concern-single-file convention; no `ui/`/`layout/` subfolder split is
introduced (research.md D3). All listed "EXTEND" targets keep their current public
props/behavior — only their className output and, for `WorkflowStageTracker`, its rendered lock
explanation, change.

## Complexity Tracking

No Constitution Check violations were identified; this section is not applicable.
