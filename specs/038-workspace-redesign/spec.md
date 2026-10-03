# Feature Specification: Workspace Redesign (Design A, "Artifact hero")

**Feature Branch**: `[038-workspace-redesign]`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: the user compared six design directions (A to F) as interactive
mockups of every current page in light and dark themes, and chose "Design A plus what you
borrowed from other designs, Lets implement" (2026-10-04). Design A keeps today's header, start
screen and top tab menu, and adds an illustrated hero and one colour per workflow. Two elements
are borrowed: Design C's artifact choices on the start screen, and Design F's command palette,
limited to switching workflows and theme. Four decisions were settled with the user before this
specification was written (see Clarifications).

## Clarifications

### Session 2026-10-04

- Q: Where do the borrowed artifact choices sit on the start screen? → A: They replace Design A's
  decorative feature row inside the hero, so the five workflow cards stay visible on a laptop
  screen without scrolling.
- Q: Does the new look apply to every page or only the shell and start screen? → A: Every page.
  Headings, the dark theme and the light background change everywhere, so the product keeps one
  presentation system (constitution XXXIII).
- Q: What does the command palette do? → A: It opens any of the five workflows, returns to the
  start screen, and switches between light and dark theme. Nothing else: no search over
  specifications, collections, plans or runs, and no stored data.
- Q: (after the first implementation) The start screen feels crammed and squeezed. → A: Return to
  Design A's proportions (two-line headline, generous spacing, readable card text). Fitting all
  five cards in a 1366 × 768 window is dropped; the workflow section must start in the first
  screen instead (FR-012, SC-001 amended).
- Q: (after the first implementation) "Don't use repeated colors" — which repetition? → A:
  Workflow colours must not reuse the status colours (success green, warning amber, danger red,
  info cyan). The brand teal is also avoided, so a workflow colour is never read as a status
  (FR-002 amended).
- Q: (after the first implementation) "There is a disconnect between home page tile color & the
  color scheme in the actual workflow page." → A: Use the tile's colour scheme throughout its
  workflow: while a workflow is open, its pages, tabs, buttons, stage tracker and background take
  that workflow's hue instead of the brand teal (FR-027).
- Q: (after the first implementation) Text alignment? → A: "Distribute text evenly between
  margins" across the whole application: prose paragraphs are justified (FR-026).
- Q: Design A's help (?) button and the chevron on the connection pill have nothing behind them
  today. What do they do? → A: The help button opens a dialog listing the keyboard shortcuts and
  what each workflow is for. The connection pill stays a plain status with no chevron.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start from the artifact I already have (Priority: P1)

As a QA engineer opening ApiPilot, I see the start screen in the new design. It tells me to start
with the artifact I have, shows which workflows each kind of artifact (an OpenAPI specification, a
Postman collection, a k6 script) can go into, and lists all five workflows as cards, each with its
own colour. I can pick a workflow either from the artifact I hold or from its card, and both get
me to the same place.

**Why this priority**: The start screen is the first thing every user sees and the only place a
session begins. Pointing each artifact at the workflows that accept it removes the most common
first-visit question ("which of these five do I need?").

**Independent Test**: Load the start screen and check the hero, the three artifact choices and
the five workflow cards. Choosing "Quick performance test" from the OpenAPI artifact and from
its card opens the same view with the same tab-menu behaviour.

**Acceptance Scenarios**:

1. **Given** no workflow has been chosen yet, **When** the start screen loads, **Then** it shows
   the headline "Start with the artifact you have.", the existing lead sentence, three artifact
   choices and five workflow cards in the top-level view order, with Guided Workflow marked
   "Recommended".
2. **Given** the OpenAPI specification artifact choice, **When** the user reads it, **Then** it
   names Guided Workflow and Quick performance test, and each name is a control that opens that
   workflow.
3. **Given** the Postman collection artifact choice, **When** the user activates its workflow
   control, **Then** Import & Run Collection opens; **given** the k6 script artifact choice,
   **then** its control opens Run k6 Script.
4. **Given** any workflow, **When** it is opened from an artifact choice, its card, its tab or
   the command palette, **Then** the resulting screen, tab-menu visibility and preserved state are
   identical.
5. **Given** a 1366 × 768 desktop browser window at 100% zoom, **When** the start screen loads,
   **Then** the "Launch a test session" heading is visible without scrolling, and the cards follow
   directly below it with Design A's spacing (not squeezed to fit).
6. **Given** a phone-width screen, **When** the start screen loads, **Then** the hero, the
   artifact choices and the cards stack in a single column with no horizontal page scrolling,
   and the illustration may be hidden.

---

### User Story 2 - One consistent look on every page, in both themes (Priority: P1)

As a QA engineer moving between workflows, every page uses the same sans-serif headings, the
same surfaces and the same colour for a given workflow, in light and in dark theme. The top tab
menu shows each workflow's colour next to its name.

**Why this priority**: The user chose the design for the whole product. Changing only the start
screen would leave two visual systems side by side, which constitution XXXIII forbids.

**Independent Test**: Switch theme on each of the five views and on the start screen. Headings
use the sans-serif display face, the dark theme uses the navy surfaces, the light theme uses the
cool-neutral background, and each tab and card shows its workflow colour beside its text label.

**Acceptance Scenarios**:

1. **Given** any view, **When** the dark theme is selected, **Then** backgrounds, surfaces,
   borders and muted text use the navy dark palette, and no component keeps the previous
   green-black surfaces.
2. **Given** any view, **When** headings render, **Then** they use the sans-serif display face
   rather than the serif face.
3. **Given** a workflow, **When** it appears as a start-screen card, an artifact-choice control, a
   tab or a palette entry, **Then** it carries the same colour marker, always alongside its text
   name.
4. **Given** a status, method or provenance badge on any page, **When** the theme changes,
   **Then** its meaning stays conveyed by text, with contrast meeting WCAG 2.1 AA for text in
   both themes.

---

### User Story 3 - Switch workflow or theme from the keyboard (Priority: P2)

As a keyboard-oriented QA engineer, I press Ctrl+K (Cmd+K on macOS) anywhere outside a text field
to open a command palette. I type a few letters to filter, use the arrow keys to move and press
Enter to open a workflow, return to the start screen or switch theme. Escape closes it.

**Why this priority**: It speeds up moving between the five views, but every action it offers is
also reachable with the mouse, so it is not required to use the product.

**Independent Test**: Press Ctrl+K on the start screen, type "k6", press Enter on "Run k6 Script",
and check the view and tab menu match picking the card. Press Ctrl+K inside a request URL input
and check the palette does not open.

**Acceptance Scenarios**:

1. **Given** focus is not in a text field and no dialog is open, **When** the user presses
   Ctrl+K or Cmd+K, **Then** the palette opens with focus in its filter field and the first
   entry highlighted.
2. **Given** the palette is open, **When** the user types, **Then** only entries whose label
   contains the typed text (ignoring case) remain, and a "No matching commands" message shows
   when none do.
3. **Given** the palette is open, **When** the user presses the Down arrow, Up arrow or Enter,
   **Then** the highlight moves (wrapping at either end) or the highlighted entry runs and the
   palette closes.
4. **Given** the palette is open, **When** the user presses Escape or clicks outside it, **Then**
   it closes and focus returns to the element that had it before.
5. **Given** the start screen is shown, **When** the palette opens, **Then** it does not offer
   "Back to start"; while a workflow view is shown it does.
6. **Given** the current theme is light, **When** the palette opens, **Then** it offers "Switch to
   dark theme" (and the reverse in dark theme); running it changes and remembers the theme exactly
   like the header theme control.
7. **Given** focus is in an input, textarea, select or editable region, or another dialog is
   open, **When** the user presses Ctrl+K, **Then** the palette does not open and the keystroke
   behaves as it would without this feature.
8. **Given** the guided workflow is in progress (its tab menu hidden), **When** the user opens
   another workflow from the palette, **Then** the outcome matches picking that workflow's tab or
   card, and the guided run is kept, as with "Back to start".

---

### User Story 4 - Find the shortcuts and what each workflow is for (Priority: P3)

As a new user, I click the help (?) button in the header and a dialog lists the keyboard shortcuts
and a one-line purpose for each of the five workflows.

**Why this priority**: It makes the palette discoverable and answers "what is this workflow
for?", but the start screen already carries the same descriptions.

**Independent Test**: Click the help button. The dialog names the shortcuts, Ctrl+K among them,
and the five workflows with their purposes. It closes with Escape or its close button and returns
focus to the help button.

**Acceptance Scenarios**:

1. **Given** any view, **When** the user activates the help button, **Then** a dialog titled
   "Keyboard shortcuts and workflows" opens listing Ctrl+K / Cmd+K (open command palette), Escape
   (close a dialog or the palette), arrow keys and Enter (move and choose in the palette), and the
   five workflows each with its existing one-line description.
2. **Given** the help dialog is open, **When** the user presses Escape or the close button,
   **Then** it closes and focus returns to the help button.

---

### Edge Cases

- The palette shortcut is pressed while the help dialog, a confirmation dialog or any other
  dialog is open: the palette does not open (FR-018).
- The palette shortcut is pressed while the palette is already open: it stays open, and the
  browser's own Ctrl+K action is suppressed (FR-017).
- A workflow is chosen from the palette while another view's dialog is open: this cannot happen,
  because the palette cannot open while a dialog is open.
- The filter matches nothing: the palette shows "No matching commands", and Enter does nothing.
- The connection check is still running or has failed: the header shows "Connecting…" or
  "Disconnected" exactly as today. The palette and help dialog still work, because they need no
  backend.
- Reduced motion is requested by the operating system: the palette, the dialog and the card hover
  effects open and change without animation.
- The browser window is narrower than the header content: the subtitle truncates first, and the
  help, theme and connection controls stay reachable.
- The stored theme is missing or invalid: theme resolution falls back as today (stored choice,
  else the operating-system preference).
- The guided workflow automatically hands off to Import & Run Collection while the palette is
  closed: behaviour is unchanged. The palette has no state of its own that could go stale.

## Requirements *(mandatory)*

### Functional Requirements

**Visual system (all pages)**

- **FR-001**: Every heading that uses the display face MUST use a sans-serif display face. No
  page may keep the serif display face.
- **FR-002**: Each of the five top-level workflows MUST have one defined colour, used for that
  workflow wherever it is represented: Guided Workflow indigo, Import & Run Collection fuchsia,
  Quick performance test blue, Performance plans violet, Run k6 Script pink. No workflow colour
  may reuse a status hue (success green, warning amber, danger red, info cyan) or the brand
  teal. Each colour MUST be defined once as a named design token per theme.
- **FR-003**: The light theme MUST use a cool-neutral page background. The dark theme MUST use a
  navy palette for background, surfaces, chrome, borders and muted text. Both MUST be delivered
  through the existing token names, so every page that already uses those tokens follows without
  per-page changes.
- **FR-004**: Every component that today hard-codes a dark-theme surface colour outside the tokens
  MUST be brought onto the navy palette, so no green-black surface remains in dark theme.
- **FR-005**: The existing brand teal and the semantic colours (success, warning, danger, info)
  MUST keep their meaning. Every workflow colour MUST always be shown alongside its workflow's
  text name, never as the only signal.

**Header**

- **FR-006**: The header MUST show the logo, the "ApiPilot" name, the version badge and the "API
  test engineering workspace" subtitle. On the right, in this order, it MUST show the two-segment
  light/dark theme control, a help button with the accessible name "Keyboard shortcuts and help",
  a command palette button with the accessible name "Open command palette" whose visible
  shortcut hint is Ctrl K (⌘ K on macOS), and the connection status.
- **FR-007**: The connection status MUST keep its three states ("Connecting…", "Connected",
  "Disconnected"), its existing test identifier, its alert role when disconnected and its error
  tooltip. It MUST NOT show a dropdown affordance.

**Start screen**

- **FR-008**: The start screen hero MUST show the eyebrow "API test engineering workspace", the
  headline "Start with the artifact you have." with the word "artifact" accented, the existing
  lead sentence, and a decorative illustration. The illustration shows an OpenAPI document
  passing through the ApiPilot logo to three outputs labelled Test scenarios, Postman collection
  and k6 performance tests. It MUST be hidden from assistive technology and MUST NOT require a
  new image file.
- **FR-009**: Below the lead, the hero MUST present three artifact choices: "OpenAPI
  specification" (Guided Workflow, Quick performance test), "Postman collection" (Import & Run
  Collection) and "k6 script" (Run k6 Script). Each named workflow MUST be its own control, and
  activating it MUST open that workflow exactly as its card does.
- **FR-010**: Below the hero, the start screen MUST show the label "Choose a workflow", the
  heading "Launch a test session", the note "Your work remains available for this browser
  session.", and five workflow cards in the top-level view order.
- **FR-011**: Each workflow card MUST be a single control whose accessible name is the workflow
  title and whose accessible description is the workflow's existing description. Each card MUST
  show the workflow's colour, an icon, the title, the description and an arrow affordance. Guided
  Workflow's card MUST show a "Recommended" label as text.
- **FR-012**: At 1366 × 768 and 100% zoom, the "Launch a test session" heading MUST be visible
  without scrolling; the cards follow it and MAY continue below the first screen, so that the
  page keeps Design A's spacing rather than being compressed. At phone width the start screen MUST
  stack into one column with no horizontal page scrolling.

**Top tab menu**

- **FR-013**: Each top-level tab MUST show its workflow's colour marker beside its label. Tab
  roles, labels, order, the current-page indication and keyboard behaviour MUST stay unchanged.
- **FR-014**: When the tab menu appears, when the guided workflow hides it, "Back to start" and
  keeping every reached view mounted MUST all behave exactly as before this feature.

**Command palette**

- **FR-015**: Pressing Ctrl+K, Cmd+K on macOS, or activating the header's palette button MUST open
  a modal command palette. It MUST offer exactly these entries:
  - the five workflows, in top-level view order;
  - "Back to start", only while a workflow view is shown (not on the start screen);
  - "Switch to dark theme" or "Switch to light theme", whichever is the opposite of the current
    theme.
- **FR-016**: Typing in the palette's filter field MUST narrow the entries to labels containing the
  typed text, ignoring case. When nothing matches, the palette MUST show "No matching commands".
  Up and Down arrows MUST move the highlight and wrap at either end. Enter MUST run the
  highlighted entry and close the palette. Clicking an entry MUST run it.
- **FR-017**: While the palette is open, Ctrl+K or Cmd+K MUST NOT trigger the browser's own
  action. Escape or a click outside MUST close the palette and return focus to the element that
  had it before it opened.
- **FR-018**: The shortcut MUST NOT open the palette while focus is in an input, textarea, select
  or editable region, or while any other dialog is open. In those cases the keystroke MUST be left
  unhandled.
- **FR-019**: Running a workflow entry MUST have exactly the effect of choosing that workflow's
  tab when the tab menu is shown, and of choosing its card on the start screen otherwise (the
  start screen is shown, or the guided workflow has hidden the tab menu). This includes tab-menu
  visibility and keeping each reached view mounted. Running "Back to start" MUST
  have exactly the effect of the existing "Back to start" control. Running a theme entry MUST
  have exactly the effect of the header theme control, including remembering the choice.
- **FR-020**: The palette MUST make no network request, MUST store nothing, and MUST offer no
  entry other than those in FR-015.

**Help dialog**

- **FR-021**: The help button MUST open a dialog titled "Keyboard shortcuts and workflows" with
  two parts:
  - the shortcuts: Ctrl+K / Cmd+K opens the command palette; Escape closes a dialog or the
    palette; Up/Down and Enter move and choose in the palette;
  - the five workflows, each with its existing one-line description.
  Escape or the close button MUST close it and return focus to the help button.

**Accessibility and behaviour**

- **FR-022**: The palette and the help dialog MUST be announced as modal dialogs with accessible
  names. They MUST keep keyboard focus inside while open and return it on close. The palette's
  entries MUST be exposed as a list of options with the highlighted one indicated to assistive
  technology.
- **FR-023**: Every interactive element this feature introduces or restyles MUST be keyboard
  reachable with a visible focus indicator.
- **FR-024**: Transitions and hover effects this feature introduces MUST be disabled when the
  user's system requests reduced motion.
- **FR-027**: While a workflow is open, every element that uses the brand colour (primary
  buttons, the active tab, the stage tracker, focus rings, tinted panels, provenance and the
  background glow) MUST use that workflow's hue, the same hue as its start-screen tile. The start
  screen keeps the brand teal. Status colours (success, warning, danger, info) are unaffected.
- **FR-026**: Prose paragraphs across the application MUST be justified (distributed evenly
  between their margins) with hyphenation. Monospace text (paths, code, identifiers) and
  single-line UI text (buttons, labels, badges, table cells) keep their alignment, and any
  explicitly centred text stays centred.
- **FR-025**: This feature MUST NOT change any backend endpoint, API contract, shared-domain type,
  workflow stage logic, stored data or request sent by the frontend.

### Key Entities

- **Workflow (top-level view)**: one of the five existing views. Each has an identifier, a title,
  a one-line description, an icon and one colour. These are already defined in the frontend's
  view list; this feature adds the colour and the icon association.
- **Artifact choice**: one of three kinds of input an engineer may already hold (OpenAPI
  specification, Postman collection, k6 script), with the ordered list of workflows that accept
  it. A fixed mapping, not stored data.
- **Command**: an entry in the palette, with a label and an action (open a workflow, back to
  start, switch theme). Derived on each opening from the current session state, never stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At 1366 × 768 and 100% zoom, the workflow section heading is visible on the start
  screen without scrolling, in both themes, and the hero, artifact choices and cards keep Design
  A's spacing (the user judged the compressed version crammed).
- **SC-002**: Each of the five workflows can be opened from the start screen in one action, from
  its artifact choice (where one applies) or from its card. The two paths produce identical
  outcomes in 100% of automated checks.
- **SC-003**: From any view, a keyboard user can open any other workflow or switch theme in at
  most four keystrokes (open the palette, up to two filter characters, Enter), with no pointer.
- **SC-004**: In dark theme, a sweep of the five views and the start screen finds zero surfaces in
  the previous green-black palette and zero headings in the serif face.
- **SC-005**: Text on every surface this feature introduces or recolours meets WCAG 2.1 AA
  contrast in both themes (4.5:1 for body text, 3:1 for large text and focus indicators).
- **SC-006**: Every existing frontend automated test still passes. A test changes only where this
  specification intentionally changes copy or structure, and each such change is listed in the
  plan.
- **SC-007**: The palette and help dialog cause zero network requests and write nothing to
  storage other than the theme choice the theme entry already writes.

## Assumptions

- The sans-serif display face is the one already shipped with the product (IBM Plex Sans), so no
  new font or other dependency is added. The mockups used a similar sans-serif face; the small
  difference is accepted.
- The existing brand teal scale stays as it is. The mockups' slightly different green is not a
  requirement.
- The illustration is decorative. On narrow screens it may be hidden, because the artifact choices
  and cards carry the same information.
- The start screen's existing copy (lead sentence, workflow descriptions, the session note) is
  reused verbatim. Only the headline treatment, the artifact choices and the section label are
  new or rearranged.
- The workflow colours are chosen to meet contrast requirements against both themes' surfaces.
  Where a colour cannot meet them as text, it is used only for markers, icons and borders next to
  text that does.
- "Back to start" in the palette is offered while a workflow view is shown, which matches when
  the existing "Back to start" controls are visible.
- On macOS the shortcut is Cmd+K and the header hint reads "⌘ K"; elsewhere it is Ctrl+K and the
  hint reads "Ctrl K". The platform is detected from the browser.
- This feature is frontend-only (FR-025). The documentation (user manual, architecture notes,
  roadmap) is updated and the workspace version is raised to 19.20.0, following the repository's
  practice for every feature.

## Out of Scope

- Any search over specifications, collections, plans, scripts or runs; recent items; favourites;
  history; settings pages; dashboards or statistics (seen in Designs B, D and F, not chosen).
- A left sidebar, a persistent pipeline strip or an artifact context bar on inner pages (Designs
  B, C, E and F).
- Changes to the content, layout or behaviour of the five views beyond the shared visual system
  (headings, surfaces, colours) described above.
- New fonts, image assets, icon libraries or other dependencies.
