# Feature Specification: Home, redesigned from the approved mock-up

**Feature Branch**: `059-home-redesign`
**Created**: 2026-10-19
**Status**: Implemented
**Amends**: `specs/058-home-declutter` (FR-001 to FR-007, SC-001 to SC-003) and, through it, `specs/054-sidebar-shell-redesign` FR-018 to
FR-021. Everything else in both, and the data Home reads, is unchanged.

## Why

The engineer supplied a mock-up (light and dark) for Home and asked for it exactly: a welcome hero, then three numbered steps (start with
the artifact you have, launch a test session, explore results and insights), then Next steps and Recent runs side by side, then the AI
provider. It replaces the two-state Home of AP-058. The mock-up is the authority for layout, hierarchy, copy and styling.

## Deliberate departures from the mock-up

Each is stated here so the review sees it, not discovers it.

1. **No fabricated figures.** The mock-up shows 78%, 62%, 12% and 24%. Those are sample values. Home shows the figure from the coverage
   snapshot, and, when there is no specification or coverage failed, the reason in words with no bar (AP-054 FR-019, constitution on
   specification-grounded values). The panel itself is always present, as in the mock-up.
2. **No Settings entry and no Configure button.** Neither a settings destination nor any in-app way to configure the AI provider exists
   (the provider is chosen by `AI_PROVIDER_MODE`). A control with no behaviour is not added. A settings screen is a separate specification.
3. **Catalog wording.** Workflow titles and one-sentence descriptions come from `workflowCatalog.ts`, the single source the sidebar,
   palette and Help dialog share, so they can differ slightly from the mock-up's sample sentences.
4. **Palette tokens.** Colours come from the AP-054 tokens (accent lime, olive brand ramp, status colours). The "pending review" bar uses
   the palette-neutral `info` colour, not blue, as the tokens forbid blue.
5. **Results links.** Coverage and Security Lab stay reachable from Home as two text links in the step 3 header (AP-058 FR-002), because
   Security Lab is otherwise not reachable from the page body.

## Requirements

- **FR-001** Home MUST have one layout in every state, top to bottom: hero; step 1; step 2; step 3; Next steps and Recent runs side by
  side from the `lg` breakpoint, stacked below it; the AI provider card.
- **FR-002** The hero MUST show the eyebrow "Welcome to ApiPilot", the heading "From API specification to executable tests with AI", the
  supporting sentence, a **Get started** button (opens Guided Workflow, the recommended workflow) and a **Learn more** button (opens the
  Help dialog), and a decorative illustration. The illustration is hidden from assistive technology.
- **FR-003** Step 1 MUST show the three artifacts (OpenAPI specification, Postman collection, k6 script), each naming the workflows that
  accept it. Choosing an artifact's workflow starts that workflow. Each control's accessible name says what it starts, for example
  "Start Guided Workflow with an OpenAPI specification".
- **FR-004** Step 2 MUST show the four workflows in order with an arrow between neighbours from the `xl` breakpoint, each with its icon,
  title and catalog sentence. A **Recommended** marker appears once, in the step header, and Guided Workflow is the highlighted tile and is
  described by it. An unfinished Performance draft MUST say "Draft in progress" in words on its tile.
- **FR-005** Step 3 MUST show four figures (Specification coverage, Runtime-verified, Open gaps high priority, Scenarios pending review),
  each with a one-line meaning and, when the figure has data, a bar and its value; when it has none, its reason in words and no bar. With a
  specification loaded the step names it (title, file, operation and scenario counts).
- **FR-006** Next steps MUST show the first pending step as the one button with the rest as links, or "Nothing is waiting on you." with
  "You're all set! Start a new test session or dive into recent results." in words when none. Until the session's workflow has been read
  once it MUST show a loading state, so its content never flips after first paint.
- **FR-007** Recent runs MUST show the newest five runs, each with its workflow icon, subject, workflow, start time, status in words and an
  **Open results** control. **View all** (shown only when more than five were read) expands to every run read and back.
- **FR-008** The AI provider card MUST show the provider's readiness and the provider in words, the reason when unavailable, "AI status
  unavailable" when unreadable and a checking state while it loads. It never shows a model identifier.
- **FR-009** Light and dark MUST both match the mock-up; Home MUST fit a 375 px wide window without horizontal page scroll; every control
  keeps an accessible name, keyboard path and visible focus; state is never carried by colour alone; animation respects reduced motion.
- **FR-010** Home MUST read only while visible, once per visit, and never poll. No endpoint, payload, stored datum or shared-domain type
  changes.

## Success criteria

- **SC-001** The first screenful at 1440 by 900 shows the hero and the start of step 1, in both themes.
- **SC-002** Home's text contains no number that is not computed from the coverage snapshot.
- **SC-003** No horizontal overflow at 375 px in light and dark.

## Out of scope

A Settings screen or any control that configures the AI provider; moving AI status into the header; changes to the sidebar, header or
Coverage screen.
