# Implementation Plan: Workspace Redesign (Design A, "Artifact hero")

**Branch**: `038-workspace-redesign` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/038-workspace-redesign/spec.md`

## Summary

This plan applies the Design A visual direction across the whole frontend. It changes the
existing design-token values and the display-face token, so every page follows without per-page
edits. It also adds one colour token per workflow and a single workflow catalog, which the start
screen, tabs, palette and help dialog all read.

The start screen is rebuilt as a compact hero:
- an illustration;
- three artifact choices (from Design C) that each open the workflows accepting that artifact;
- five colour-coded workflow cards.

A command palette (from Design F, limited to workflows, "Back to start" and the theme) and a help
dialog are built on the existing `Dialog`. Navigation always goes through the handlers the tabs
and cards already use, so behaviour cannot drift.

The feature is frontend-only, with no new dependency. The unused serif font package is removed.

## Technical Context

**Language/Version**: TypeScript 5.9, React 18.3 (`frontend/` workspace)

**Primary Dependencies**:
- Already present: React 18, Tailwind CSS v4 (CSS-first `@theme`, `@custom-variant dark` keyed
  on `data-theme`), Vite 8, `@fontsource/ibm-plex-sans`, `@fontsource/jetbrains-mono`.
- Added: none.
- Removed: `@fontsource/ibm-plex-serif` (research D1).

**Storage**: None new. The existing `localStorage["apipilot-theme"]` is written only through the
existing `useTheme().setTheme`.

**Testing**: Vitest, `@testing-library/react` and jsdom (`frontend/tests/unit`). A headless-Chrome
screenshot at 1366 × 657 checks the fold (quickstart scenario 2).

**Target Platform**: Desktop and mobile evergreen browsers, served locally by Vite.

**Project Type**: Web application (npm workspaces: `backend/`, `frontend/`,
`packages/shared-domain/`). Only `frontend/` changes.

**Performance Goals**: The start screen adds no network request. The palette opens within one
frame of the keystroke and filters at most eight fixed entries.

**Constraints**:
- No backend, contract or shared-domain change (FR-025).
- WCAG 2.1 AA contrast (research D2 measurements).
- Five cards above the fold at a 1366 × 657 viewport.
- Existing test contracts kept (contracts/ui-contract.md).

**Scale/Scope**:
- About 9 frontend source files edited.
- About 6 added: the catalog, `WorkflowIcon`, `EntryIllustration`, `CommandPalette`,
  `paletteCommands.ts` and `HelpDialog`.
- About 5 test files added or extended.
- About 1 existing test adjusted.

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1 (below).*

| Principle | Status | Evidence |
|---|---|---|
| I. Specification is the source of truth | Pass | spec.md, with its four clarifications from the user. |
| II–VII. Determinism and AI | N/A, pass | No AI, generation or provider change. The palette's commands are a fixed list derived from state. |
| IX. Separation of concerns | Pass | Pure functions (`paletteCommands.ts`) are separate from components. API calls are untouched in `services/`. |
| X. Domain model first | Pass | No domain type changes. The catalog is presentation metadata, kept out of `shared-domain` (research D4). |
| XIV. No silent assumptions | Pass | Every assumption is in the spec's Assumptions; the fold viewport is defined in research D10. |
| XVII. Security and privacy by design | Pass | No data leaves the browser; the palette makes no requests and stores nothing (FR-020). |
| XXI. Testability at every boundary | Pass | Pure predicates and command derivation get unit tests; components get RTL tests. |
| XXV. Incremental delivery | Pass | Stories are independent: tokens and look (US2), start screen (US1), palette (US3), help (US4). |
| XXVII. Prefer simple architecture | Pass | No router, context, store, icon library or animation library. One additive `Dialog` prop. |
| XXXI. Definition of done | Pass, planned | Tests, lint, build, docs (USER_MANUAL, architecture, ROADMAP) and version 19.20.0 are in tasks. |
| XXXII. Review at scale | N/A | No review interface changes. |
| XXXIII. Presentation consistent | Pass | One token system for every page (FR-001 to FR-004); contrast measured (D2). |

No violations, so Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/038-workspace-redesign/
├── spec.md
├── plan.md              # this file
├── research.md          # D1–D12
├── data-model.md        # catalog, artifact choices, commands, palette state
├── quickstart.md        # validation scenarios 1–7
├── contracts/
│   └── ui-contract.md   # roles, names, test ids (kept and new)
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
frontend/
├── package.json                      # remove @fontsource/ibm-plex-serif; version 19.20.0
├── src/
│   ├── index.css                     # token values, wf-* tokens, display face, background glow
│   ├── main.tsx                      # font imports: drop serif, add plex-sans 700
│   ├── App.tsx                       # TABS from catalog; lifted useTheme; palette state + shortcut
│   └── components/
│       ├── workflowCatalog.ts        # NEW: WORKFLOWS, ARTIFACT_CHOICES (research D4)
│       ├── WorkflowIcon.tsx          # NEW: five workflow + three artifact icons (D11)
│       ├── EntryIllustration.tsx     # NEW: decorative hero illustration (FR-008)
│       ├── EntryChooser.tsx          # REWRITTEN: hero, artifact choices, cards
│       ├── AppHeader.tsx             # props lifted; help + palette buttons; HelpDialog
│       ├── ThemeToggle.tsx           # restyle only (behaviour and names kept)
│       ├── Tabs.tsx                  # optional markerClassName
│       ├── Dialog.tsx                # optional onBackdropClick (additive)
│       ├── paletteCommands.ts         # NEW: pure command/shortcut helpers (D7)
│       ├── CommandPalette.tsx        # NEW
│       └── HelpDialog.tsx            # NEW
└── tests/unit/
    ├── workflowCatalog.test.ts       # NEW
    ├── paletteCommands.test.ts        # NEW
    ├── CommandPalette.test.tsx       # NEW
    ├── EntryChooser.test.tsx         # NEW
    ├── HelpDialog.test.tsx           # NEW
    ├── AppHeader.test.tsx            # props updated; help/palette buttons
    ├── Tabs.test.tsx                 # marker does not change names
    ├── Dialog.test.tsx               # onBackdropClick
    ├── App.test.tsx                  # palette integration: shortcut, guards, guided hidden tabs
    └── UserScriptPage.test.tsx       # one query made exact (intentional, below)
docs/USER_MANUAL.md, docs/architecture.md, specs/ROADMAP.md     # documentation
package.json, backend/package.json, packages/shared-domain/package.json, package-lock.json  # 19.20.0
```

**Structure Decision**: The existing web-application layout is kept. All code lives in
`frontend/src/components/`, next to the shell components it extends (`AppHeader`, `Tabs`,
`Dialog`, `ThemeToggle`), following spec 027's placement.

### Intentional test changes (SC-006)

- `UserScriptPage.test.tsx`, "Run k6 Script entry › is offered on the start screen": the query
  changes from `{ name: /Run k6 Script/ }` to `{ name: "Run k6 Script" }`. The start screen now
  also has an artifact control named "Run k6 Script, for a k6 script", which the regex would also
  match (research D9).
- `AppHeader.test.tsx`: renders with the new required props (`theme`, `onThemeChange`,
  `onOpenCommandPalette`). Its four existing assertions stay unchanged.

## Complexity Tracking

None.

## Post-design Constitution re-check

The design artifacts introduce no persistence, network access, AI, dependency or domain change.
Accessibility contracts are explicit (contracts/ui-contract.md). The gate still passes.
