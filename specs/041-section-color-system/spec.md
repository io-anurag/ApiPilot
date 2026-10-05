# AP-041 — Section colour system

Status: Implemented (frontend only; no backend, contract, routing or shared-domain change). Version 19.26.0.

## Problem

AP-038 gave each of the five top-level workflows its own hue by redefining the whole `brand` scale
per workflow (five 10-step blocks), and the 422 neutral utilities in components were raw `slate-*`
classes hand-paired with `dark:` variants, so the neutral foundation was not themeable from one place.
Colour did not tell an engineer where they were *inside* the guided workflow (eleven stages), and the
status scales used a white-on-fill pairing that failed WCAG AA (`success-600` 3.3:1, `warning-600` 3.2:1).

## Principle

Shared neutral foundation + a section accent + independent status colours.

- **Section** answers "where am I?": appears only as navigation indicators, section icons, active
  tabs, selected controls, focus rings, progress, primary actions and a faint page glow.
- **Status** (success, warning, danger, info, neutral) answers "what happened?" and is never derived from
  a section. Always paired with a text label.
- Surfaces, cards, tables, forms and dialogs use neutrals only.

## Decisions (user-confirmed 2026-10-05)

1. **Section drives the accent.** The `brand` scale follows `data-section`. Guided-workflow stages map to
   sections (`components/sectionCatalog.ts`); Import & Run, Quick performance and Performance plans open in
   Execution; Run k6 Script in Scenarios; run results/reports use Results. The five AP-038 `--color-wf-*`
   tokens remain only for start-screen tiles and tab markers. `data-workflow` and the five per-workflow
   `brand` blocks are removed.
2. **Deconflict and AA-adjust.** Hues that collided with a status hue were moved, and light values that
   failed AA as text were darkened (below).

## Tokens (single source: `frontend/src/index.css`)

| Group | Tokens |
|---|---|
| Neutrals | `background`, `surface`, `surface-elevated`, `surface-subtle`, `surface-strong`, `surface-hover`, `chrome`, `border`, `border-strong`, `text-primary`, `text-secondary`, `muted` (muted text, kept under its original name), `text-disabled`, `on-solid`, `code-surface/text/border`, `scrim` |
| Section | `section-spec`, `-analysis`, `-scenarios`, `-ai`, `-dependencies`, `-artifacts`, `-execution`, `-results` (theme-aware) |
| Brand scale | `brand-50…900`, derived per `data-section` from the section accent (`@theme inline`, so each element resolves against its nearest section) |
| Status | `success`, `warning`, `danger` (the repository's name for error), `info` plus the existing `-50…700` scales |
| Chart | `chart-1…6` (theme-aware categorical palette) |

Dark neutrals: `#090B10` / `#11151C` / `#181D26` / `#202631` family, no pure black.

## Section accents

| Section | Light (solid / text) | Dark | Change from brief |
|---|---|---|---|
| Specification | #2563EB | #60A5FA | none |
| Analysis | #0E7490 | #22D3EE | light darkened (cyan #0891B2 was 3.7:1 as text) |
| Test scenarios | #4F46E5 | #818CF8 | none |
| AI enhancement | #7C3AED | #A78BFA | none |
| Dependencies | #A21CAF | #E879F9 | amber → fuchsia (amber is the warning hue) |
| Artifacts | #C2410C | #FB923C | light darkened (#EA580C was 3.6:1) |
| Execution | #0F766E | #2DD4BF | none |
| Results | #047857 | #34D399 | light emerald, darker than success green (#16A34A was 3.3:1) |

`info` moved from cyan to a steel blue (`#476A96`) so it no longer matches Analysis. `success-600/700` and
`warning-600/700` were darkened so white text on a `-600` button passes AA.

## Known limits

- Results emerald and `success` green are adjacent hues; they are separated by labels and placement, not hue alone.
- Scenarios indigo and AI violet are perceptually close; each is always beside its stage name and icon.
- Artifacts orange sits between danger red and warning amber; same mitigation.
- Input borders (`border-border-strong`, ~1.5:1) do not meet the 3:1 non-text guidance of WCAG 1.4.11;
  unchanged from before and out of scope here.
- Backend-rendered HTML reports (performance report iframe) have their own styles and are not part of this change.
- There is no Settings screen yet, so no Settings accent was defined.
- Third-party logo colours in `WorkflowIcon.tsx` (Postman, k6, OpenAPI) are intentionally literal.

## Validation

`contrast.md`. Frontend tests (including guards that fail on hex colours or Tailwind palette utilities in
components, and on a section missing its light/dark tokens), lint and build pass. Browser walkthrough via
headless Chrome in light and dark: start screen, upload, API Review, Deterministic Generation, AI
Enhancement, Scenario Review.
