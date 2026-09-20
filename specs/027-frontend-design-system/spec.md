# Feature Specification: Frontend Design System & Application Shell

**Feature Branch**: `027-frontend-design-system`

**Created**: 2026-09-20

**Status**: Draft

**Input**: User description: "Complete visual redesign of the ApiPilot frontend into a cohesive
'API Test Engineering Workspace' design system and application shell. Phase 1 scope: establish
design tokens (colors, typography, spacing, radius, shadows) for light and dark mode; a reusable
component library (buttons, status/decision badges, cards, tabs, dialogs, inputs, selects,
empty/error/loading states, HTTP method indicators, AI-vs-deterministic provenance indicators);
and a global application shell (header, workflow-aware sidebar navigation with stage gating and
locked-stage explanations, and a reusable workflow-progress indicator). This phase does not
redesign individual page content beyond adopting the new shell; it must not change backend API
contracts, workflow/business logic, or existing component behavior. Existing functionality
(including the in-progress External Collections feature) must continue to work unchanged. Later
phases (separate specs) apply this design system page-by-page."

## Clarifications

### Session 2026-09-20

- Q: Should the shared workflow navigation include a "History" entry, even though no History
  page exists anywhere in the product today? → A: Omit History from this phase entirely — the
  shell navigation shows only the stages that exist today in the product's actual workflow. A
  future spec adds History (and its nav entry) once that page is actually built. Resolving this
  also corrected an inconsistency, found during planning, between this spec's original stage
  list and the product's real workflow: "Test Scenarios" is actually two separate stages,
  Deterministic Generation and AI Enhancement — every stage list below now uses the product's
  real 10 stage names.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Always know where you are in the workflow (Priority: P1)

As a QA engineer using ApiPilot, when I open any page in the application, I can immediately see
which stage of the OpenAPI-to-test-execution workflow I am on, which stages are already
complete, which stage is active, and which stages are not yet available — using one consistent
navigation and progress presentation across the entire product, instead of each page explaining
its place in the workflow differently or not at all.

**Why this priority**: The multi-stage workflow (Upload → Analysis → API Review → Deterministic
Generation → AI Enhancement → Scenario Review → Dependency Analysis → Workflow Review → Postman
Generation → Execution) is the core of the product. Without a consistent, always-visible sense of place, users
must rely on memory or trial and error to know what to do next. This is the single highest-value
outcome of the redesign and everything else builds on it.

**Independent Test**: Can be fully tested by navigating between every existing page and
confirming the same header/navigation/progress presentation appears, correctly reflects stage
status, and explains why any stage is locked — independent of whether any individual page's
internal content has been restyled.

**Acceptance Scenarios**:

1. **Given** a user has completed Upload and Analysis but not API Review, **When** they view the
   navigation, **Then** Upload and Analysis are marked completed, API Review is marked active,
   and every later stage is marked pending or locked.
2. **Given** a stage is locked because a prior stage is incomplete, **When** the user looks at or
   attempts to open that stage, **Then** the interface explains which prior stage must be
   completed first, rather than only appearing disabled.
3. **Given** a user resizes the browser window to a narrow width, **When** they view the shell,
   **Then** the navigation collapses into a compact, still-usable form that preserves access to
   every stage and the current-stage indicator.

---

### User Story 2 - One visual language for recurring information (Priority: P2)

As a QA engineer, I want every recurring piece of information — action buttons, decision/status
badges (e.g. accepted/rejected/pending), HTTP method indicators, AI-generated vs.
specification-derived indicators, empty results, loading activity, and error conditions — to
look and behave identically everywhere it appears in the product, so that I can recognize and
trust these patterns without re-learning them on each page.

**Why this priority**: These elements repeat across nearly every page and are currently
implemented ad hoc per component. Standardizing them is the foundation every later page-by-page
redesign phase depends on, but it delivers value on its own even before individual pages are
restyled, because it immediately removes visual inconsistency users already encounter today.

**Independent Test**: Can be fully tested by locating every current occurrence of a status
badge, HTTP method indicator, provenance indicator, and loading/empty/error state, and
confirming each has been replaced with the shared presentation pattern that renders identically
regardless of which page it appears on.

**Acceptance Scenarios**:

1. **Given** the same decision status (e.g. "Accepted") appears on two different pages, **When**
   the user views both, **Then** the badge uses identical color, shape, icon, and label.
2. **Given** a page is waiting on data, has no data, or failed to load data, **When** the user
   views that page, **Then** the interface shows the shared loading, empty, or error pattern
   (never an unstyled or missing state) and the error state explains what happened and what the
   user can do next.
3. **Given** a piece of content originated from the OpenAPI specification versus from AI
   inference, **When** the user views it, **Then** the two are visually distinguishable using the
   same provenance indicator convention everywhere content provenance is shown.

---

### User Story 3 - Usable in any environment the user works in (Priority: P3)

As a QA engineer who may work in a light or dark operating-system theme, on a laptop, or with a
narrower browser window, I want the shared shell and components to remain legible, accessible,
and fully operable in every one of those conditions, so that my working environment never gets in
the way of using the product.

**Why this priority**: This does not unlock new capability on its own, but an inconsistent or
broken presentation in any of these conditions would undermine trust in stories 1 and 2. It is
lower priority than establishing the patterns themselves, but still required before this phase is
considered done.

**Independent Test**: Can be fully tested by exercising the shell and every shared component
under a light theme, a dark theme, and at least three representative viewport widths, and
confirming no content is unreadable, clipped, overlapping, or unreachable by keyboard.

**Acceptance Scenarios**:

1. **Given** the user's system is set to a dark color theme, **When** they open ApiPilot,
   **Then** the shell and every shared component remain legible with sufficient contrast, and no
   element is left showing unstyled or mismatched colors.
2. **Given** a user navigates using only a keyboard, **When** they tab through the shell's
   navigation and any shared interactive component, **Then** every control is reachable and shows
   a visible focus indicator.
3. **Given** a status is shown to the user, **When** they cannot perceive color (e.g. color
   blindness or a monochrome display), **Then** the status is still identifiable from text or an
   icon alone.

---

### Edge Cases

- What happens when a workflow stage is locked — the interface must state the reason (which
  prior stage is incomplete), not merely render the stage as disabled or hide it silently.
- What happens when a page has an unusually long value to display in shared chrome (e.g. a very
  long API path or file name in the header) — it must truncate or wrap without breaking the
  layout or hiding critical actions.
- What happens when local AI is unavailable — any AI-readiness indicator in the shared shell must
  communicate that deterministic functionality remains available, and must not read as an
  application failure.
- What happens to the in-progress External Collections feature (uncommitted at the time of this
  spec) once the shell and shared components are introduced — it must continue to function and
  display correctly without special-case handling.
- What happens when a user has "reduce motion" enabled at the operating-system level — shell
  transitions (e.g. navigation expand/collapse, stage-status changes) must be reduced or removed
  rather than forced.
- What happens when many workflow stages are locked simultaneously (e.g. immediately after
  Upload) — the navigation must still clearly communicate the full workflow sequence, not just
  the currently reachable stage.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide one consistent application shell (header, workflow
  navigation, and main content region) that every page in the application uses.
- **FR-002**: The workflow navigation MUST present stages in the actual product workflow order
  (Upload, Analysis, API Review, Deterministic Generation, AI Enhancement, Scenario Review,
  Dependency Analysis, Workflow Review, Postman Generation, Execution), not a generic or
  alphabetical menu, and MUST NOT include a stage that does not exist in the product today (e.g.
  History).
- **FR-003**: The workflow navigation MUST visually distinguish, for every stage: completed,
  active, pending, and locked status.
- **FR-004**: When a stage is locked, the interface MUST explain to the user why it is
  unavailable (e.g., which prior stage must be completed first).
- **FR-005**: The system MUST provide one reusable workflow-progress indicator used everywhere
  workflow progress is shown, rather than each page building its own.
- **FR-006**: The system MUST provide a single set of reusable presentation components — at
  minimum, action buttons, status/decision badges, HTTP method indicators, AI-vs-deterministic
  provenance indicators, tabbed content panels, and empty-state, error-state, and loading-state
  patterns — such that the same concept renders identically everywhere it appears.
- **FR-007**: Every existing loading, empty-result, or error condition in the application MUST be
  presented using the shared loading, empty, or error pattern rather than an ad hoc or absent
  state.
- **FR-008**: The shell and shared components MUST remain legible and accessible in both a light
  and a dark presentation.
- **FR-009**: The shell and shared components MUST remain usable, without required horizontal
  page scrolling or inaccessible/clipped/overlapping content, across common desktop, laptop, and
  narrow browser-window widths.
- **FR-010**: No status or state introduced by the shell or shared components MUST be
  communicated by color alone; each MUST also carry a text label or icon.
- **FR-011**: Every interactive element introduced by the shell and shared components MUST be
  operable by keyboard and MUST show a visible focus indicator.
- **FR-012**: This phase MUST NOT change any existing workflow behavior, business rule, API
  contract, or the functional behavior of any existing page; it is limited to the presentation
  layer and the introduction of the shared shell and components.
- **FR-013**: All existing functionality, including the in-progress External Collections
  import/execution feature, MUST continue to work unchanged after this phase is complete.
- **FR-014**: Every existing page MUST adopt the new shell and navigation; redesigning the
  internal content layout of individual pages is explicitly out of scope for this phase and is
  deferred to subsequent, separate specifications.
- **FR-015**: Any transition or animation introduced by the shell (e.g., navigation
  expand/collapse, stage-status change) MUST be reduced or removed when the user has requested
  reduced motion.

### Key Entities

- **Workflow Stage**: A presentation-level representation of one step in the product's workflow
  (Upload, Analysis, API Review, Deterministic Generation, AI Enhancement, Scenario Review,
  Dependency Analysis, Workflow Review, Postman Generation, Execution). Carries a display order, a
  status (completed / active / pending / locked), and, when locked, a reason. Derived from
  existing workflow state already available to the frontend; this phase introduces no new backend
  data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can correctly identify the current workflow stage and the status of every
  other stage within 5 seconds of opening any page, without consulting documentation.
- **SC-002**: 100% of existing pages use the shared shell and the shared component set; none
  renders its own ad hoc header, navigation, status badge, or loading/empty/error pattern.
- **SC-003**: All automated frontend tests that passed before this phase continue to pass
  afterward, with zero regressions in workflow behavior or in the External Collections feature.
- **SC-004**: Every status or decision indicator in the shell and shared components meets a
  recognized text-contrast accessibility threshold and conveys its state through text or an icon
  in addition to color.
- **SC-005**: The shell and shared components render without overlapping, clipped, or
  inaccessible content across at least three representative viewport widths and in both light and
  dark presentation.

## Assumptions

- The existing page/route structure is retained; this phase changes shared presentation chrome
  and navigation, not the application's routing architecture.
- Locked-stage status is derived entirely from workflow state the frontend already has access to;
  no new backend endpoint or contract change is required for this phase.
- Where the product does not yet have an explicit light/dark theme switcher, the shell follows the
  user's operating-system/browser theme preference by default; adding a manual switcher is a
  reasonable enhancement but not required to satisfy this spec.
- Subsequent, separately specified phases will apply this design system to the internal content of
  each individual workflow page (Analysis, API Review, Deterministic Generation, AI Enhancement,
  Scenario Review, Dependency Analysis, Workflow Review, Postman Generation, Execution/Results);
  this spec covers only the shared foundation (design tokens, component library, and application
  shell) those phases will build on. A History page is not part of this list — it does not exist
  in the product yet, and this spec does not commit to building it.
