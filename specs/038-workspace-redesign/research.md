# Research: Workspace Redesign (Design A, "Artifact hero")

All decisions below come from an audit of `frontend/` on 2026-10-04 (header, entry chooser, tabs,
theme tokens, dialog, tests) and from the user's choices recorded in the spec's Clarifications.
No item remains marked NEEDS CLARIFICATION.

## D1. Display face: IBM Plex Sans replaces IBM Plex Serif

- **Decision**: Point the `--font-display` token at IBM Plex Sans. Load its 700 weight from the
  installed `@fontsource/ibm-plex-sans` package, and remove the `@fontsource/ibm-plex-serif`
  imports and the package itself, through npm.
- **Rationale**: 15 uses in 10 files reach the serif face only through the `font-display` token,
  so changing the token alone meets FR-001 on every page. Plex Sans is already self-hosted, so
  nothing new loads at runtime (local-first, no new dependency). Removing the now-unused serif
  package shrinks the bundle and the dependency list.
- **Alternatives considered**: Inter, the face in the mockups. Rejected because it is a new
  dependency for a small visual difference (CLAUDE.md §5). Keeping the serif package installed
  but unused was rejected: CLAUDE.md §55 forbids dead dependencies.

## D2. Theme tokens: same names, new values; five workflow tokens added

- **Decision**: Keep the token names (`background`, `surface`, `chrome`, `border`, `muted`) and
  change their values. Add `--color-wf-guided`, `--color-wf-import`, `--color-wf-quick`,
  `--color-wf-plans` and `--color-wf-k6` to `@theme`, each overridden under
  `:root[data-theme="dark"]`.

  | Token | Light | Dark |
  |---|---|---|
  | background | `#f6f8fb` | `#070d1a` |
  | surface | `#ffffff` | `#0f182b` |
  | chrome | `#ffffff` | `#0a1222` |
  | border | `#e1e7ef` | `#22304a` |
  | muted | `#5b6878` | `#94a1b8` |
  | body text | `#121a26` | `#e6ecf5` |
  | wf-guided (indigo) | `#4f46e5` | `#a5b4fc` |
  | wf-import (fuchsia) | `#a21caf` | `#f0abfc` |
  | wf-quick (blue) | `#1d4ed8` | `#93c5fd` |
  | wf-plans (violet) | `#6d28d9` | `#c4b5fd` |
  | wf-k6 (pink) | `#be185d` | `#f9a8d4` |

  **Amended 2026-10-04**: The first values (green, orange, purple, blue, red) reused the status
  hues, so the user asked for no repeated colours. The workflow hues now sit between 224° and
  335°. That is clear of success (142°), warning (32°), danger (0°), info (192°) and the brand
  teal (166°). Contrast as text: 6.0:1 to 7.1:1 on the light surface and 8.9:1 to 10.1:1 on the
  dark one. The headline accent uses the brand colour, the illustration connectors are neutral,
  and the page-hero glow is neutral, so none of them repeats a workflow colour.

- **Rationale**: Every page already styles its surfaces through these tokens (spec 027), so
  changing the values moves every page to the navy dark theme and the cool light background at
  once (FR-003). Measured contrast (WCAG relative luminance):
  - muted text: 5.3:1 (light) and 6.8:1 (dark) on surfaces;
  - body text: 16.4:1 and 14.9:1;
  - every workflow colour as text on its theme's surface: 4.7:1 to 8.2:1;
  - white on the light workflow colours and navy `#0b1220` on the dark ones: 4.7:1 to 8.6:1.
  All of these meet SC-005, so the workflow colours may be used for text, icons and the
  solid arrow buttons.
- **Alternatives considered**:
  - Tailwind's built-in palette classes per workflow (e.g. `orange-600`). Rejected: these are not
    theme-aware and would need a `dark:` pair at every use, which is exactly the scatter
    CLAUDE.md §29 warns against.
  - A per-design token set. Rejected as over-engineering for one design.

## D3. Hard-coded dark surfaces: audit result

- **Decision**: Recolour the only two hard-coded dark brand surfaces
  (`dark:bg-brand-900/30` and `dark:border-brand-800`, both in `EntryChooser.tsx`, which is
  rewritten anyway). Retint the dark `technical-grid` background from teal lines to a top
  blue glow over a faint neutral grid, as in Design A.
- **Rationale**: A grep for `dark:(bg|border|from|to|via)-*-(800|900|950)` and for hex colours in
  `.tsx`/`.ts` found only these, so FR-004 needs no per-page edits. Brand-tinted translucent
  highlights (`dark:bg-brand-500/10` and the like) are tints of the brand colour, not
  green-black surfaces, and stay: on navy they read as the teal accent Design A uses.
- **Alternatives considered**: A visual sweep page by page. It is still done, as quickstart
  scenario 6 (SC-004), to confirm the grep result.

## D4. One workflow catalog shared by start screen, tabs, palette and help

- **Decision**: Add `frontend/src/components/workflowCatalog.ts`, a readonly ordered list of the
  five workflows. Each entry has:
  - `id`, the existing `EntryChoice` value;
  - `title` (start-screen title);
  - `tabLabel` (the existing tab text, kept verbatim: "Quick Performance Test" keeps its
    capitals);
  - `description` (the existing entry-chooser sentence);
  - `icon`;
  - literal Tailwind class strings for its colour (marker, text, solid, tint).

  The catalog also holds the three artifact choices. `App.tsx` builds `TABS` from it; the
  entry chooser, palette and help dialog read it.
- **Rationale**:
  - Today the five titles and descriptions live in `EntryChooser.tsx` and the tab labels in
    `App.tsx`, and this feature adds two more consumers. One source prevents drift.
  - Class strings are literal so Tailwind's scanner sees them; this mirrors the existing
    `controlStyles.ts` convention.
  - The catalog is presentation metadata, not domain data, so it stays in `frontend/` rather
    than `shared-domain` (CLAUDE.md §4).
- **Alternatives considered**: Building class names from the id at runtime (`bg-wf-${id}`).
  Rejected because Tailwind cannot see generated class names.

## D5. Theme state lifted from `AppHeader` to `App`

- **Decision**: `App` calls `useTheme()` once and passes `theme` and `onThemeChange` to
  `AppHeader` (and through it to `ThemeToggle`). The palette's theme entry calls the same setter.
- **Rationale**: `useTheme` keeps the theme in React state. Two calls (header and palette) would
  hold two copies, and the palette's label ("Switch to dark theme") would go stale after a header
  change. One owner keeps FR-019's "exactly the effect of the header control".
- **Alternatives considered**: A React context for the theme. Rejected because only two consumers
  exist, one level apart (CLAUDE.md §60).

## D6. Palette built on the existing `Dialog`; one additive option

- **Decision**: `CommandPalette` renders inside the existing `Dialog`, which already provides the
  modal semantics, focus trap, Escape-to-close and focus restore. `Dialog` gains one optional
  prop, `onBackdropClick`, called when the backdrop itself (not the panel) is clicked. Existing
  callers do not pass it, so their behaviour is unchanged. The palette uses the ARIA combobox
  pattern:
  - the filter input has `role="combobox"`, `aria-expanded`, `aria-controls` and
    `aria-activedescendant`;
  - the entries have `role="listbox"`, each with `role="option"` and `aria-selected` (FR-022).
- **Rationale**: Reusing `Dialog` keeps one modal implementation (spec 027 FR-006). The combobox
  pattern is the standard accessible shape for a filter-and-choose list.
- **Alternatives considered**:
  - A second modal implementation. Rejected because it duplicates `Dialog`.
  - A native `<dialog>` element. Rejected: the product has standardised on `Dialog`, and jsdom's
    `<dialog>` support is incomplete for tests.

## D7. Shortcut handling is a pure predicate plus one listener in `App`

- **Decision**: `frontend/src/components/paletteCommands.ts` exports pure functions:
  - `isPaletteShortcut(event)`: Ctrl+K or Meta+K, no Alt or Shift, either key case;
  - `isEditableTarget(target)`: input, textarea, select or contentEditable;
  - `buildCommands({ workflowShown, theme })`;
  - `filterCommands(commands, query)`;
  - `isMacPlatform(navigatorLike)`.

  `App` adds one `keydown` listener on `document`. It opens the palette only when:
  - the shortcut matches;
  - the target is not editable;
  - no element with `aria-modal="true"` is in the document.

  While the palette is open, the listener calls `preventDefault()` on the shortcut and does
  nothing else (FR-017). In every other case it leaves the event untouched (FR-018).
- **Rationale**: Pure predicates are unit-testable without rendering (CLAUDE.md §10, §45).
  Checking for any `aria-modal` element covers every dialog in the product, because they all
  render through `Dialog`, without a global registry.
- **Alternatives considered**: A dialog-open counter in context. Rejected as extra state that
  must be kept in sync by every dialog.

## D8. Palette workflow action: tab when the menu is shown, card otherwise

- **Decision**: In `App`, the palette's workflow action calls `handleTabChange(id)` when
  `started && tabsVisible`, and `handleSelect(id)` otherwise. "Back to start" calls
  `handleExitToStart()` and is offered only when `started` is true.
- **Rationale**: These are the exact handlers the tabs and cards use, so FR-019 holds by
  construction. With the guided workflow in progress (tab menu hidden), `handleSelect` matches
  "Back to start, then pick the card", and the guided workflow stays mounted as it does today.
- **Alternatives considered**: A new navigation function for the palette. Rejected: two code
  paths for one outcome would drift.

## D9. Accessible names that keep existing tests unambiguous

- **Decision**:
  - Workflow cards keep accessible names equal to the workflow title, which the tests rely on
    (e.g. `getByRole("button", { name: "Guided Workflow" })`).
  - Artifact-choice workflow controls get a longer name that starts with the visible text, e.g.
    "Guided Workflow, for an OpenAPI specification" (WCAG 2.5.3, label in name).
  - Exact-name queries therefore still find exactly one button. One existing test,
    `UserScriptPage.test.tsx` "is offered on the start screen", queries `/Run k6 Script/` as a
    regex and would now match two buttons. It changes to the exact name "Run k6 Script"; this is
    an intentional change listed in plan.md (SC-006).
  - The palette is closed by default, so its options never compete with start-screen queries.
- **Alternatives considered**: Hiding artifact controls from the accessibility tree. Rejected:
  it would break FR-009 and keyboard access.

## D10. Fold budget for SC-001 (amended)

**Amendment (2026-10-04)**: The budget below was met (cards' bottom edge at 644 px), but the user
found the result crammed and squeezed. The start screen now uses Design A's proportions: a
two-line `text-5xl` headline, `text-lg` lead, 48 px between sections, and cards with `p-5`,
`text-sm` descriptions and the arrow at the bottom. At 1366 × 657 the section heading's top edge
sits at 606 px and the cards start at 658 px, just below the first screen. The original decision
is kept below for the record.


- **Decision**: Treat "1366 × 768 window" as a 1366 × 657 viewport, Chrome's usable area at that
  window size with tabs and an address bar. Budget it as follows:

  | Region | Height |
  |---|---|
  | Header | 64 px |
  | Top padding | 24 px |
  | Hero: eyebrow, two-line 40 px headline, two-line lead, ~76 px artifact row | ≤ 300 px |
  | Section heading | 56 px |
  | Cards | ≤ 190 px |
  | **Total** | **≤ 634 px** |

  The illustration sits beside the text, so it adds no height. The old
  `min-h-[calc(100vh-9rem)]` vertical centring is removed, because it would push the cards down.
- **Rationale**: Measurable with a headless browser screenshot at 1366 × 657 (quickstart
  scenario 2).
- **Alternatives considered**: A one-line headline at a smaller size. Kept in reserve if the
  measurement fails.

## D11. Icons

- **Decision**: A new `WorkflowIcon` component with five inline SVG icons:
  - document with tick (Guided Workflow);
  - document with down arrow (Import & Run Collection);
  - circled play (Quick performance test);
  - line chart (Performance plans);
  - document with code brackets (Run k6 Script).

  Also three artifact icons: document, collection and script. They follow the existing hand-drawn
  inline SVG convention, so `EntryFeatureIcon` stays as is for the pages that already use it.
- **Rationale**: No icon library exists or is added (spec 027 D1).

## D12. Reduced motion and responsiveness

- **Decision**:
  - New transitions use `motion-safe:` variants. The global reduced-motion rule in `index.css`
    already neutralises transitions as a second guard (FR-024).
  - At phone width the illustration is hidden (`hidden lg:block`), the artifact row and cards
    stack in one column, and the tab menu keeps its existing horizontal scroll.
  - In the header, the palette button's shortcut hint and the subtitle hide or truncate before
    the help, theme and connection controls do.
- **Rationale**: CLAUDE.md §36 and §42; the spec's edge case on narrow headers.
