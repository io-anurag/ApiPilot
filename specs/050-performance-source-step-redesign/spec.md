# Feature Specification: Performance Source Step Redesign

**Feature Branch**: `050-performance-source-step-redesign`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Redesign the Performance path's Source step (the first screen of New performance test): clearer source cards, an upload card that looks like the start screen's upload card, and a top area that looks like the other workflow screens. Design reviewed as a light and dark mock before implementation."

## Background

AP-047 merged Quick Performance Test and Performance Plans into one Performance tab with a five-step path (Source, Operations, Plan, Load, Run). Its Source step works but reads as unfinished next to the rest of the product: the four sources are text-only tiles, the upload sits alone in the left half of an otherwise empty page, and the top of the path is a bordered strip that no other screen uses.

This feature changes how the Source step and the path's frame look and are laid out. It changes no behaviour: the sources, their order, the gating of Next, the upload and its replace flow, the read-only state once a plan exists, and what is kept across "Back to start" are exactly those of specs/047-unified-performance-tab.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recognise a source at a glance (Priority: P1)

An engineer opening a new performance test sees four source cards. Each has an icon, a name, what it produces, and what it needs, and the chosen one is clearly marked.

**Independent Test**: Open Performance, pick any source, and read the Source step.

**Acceptance Scenarios**:

1. **Given** the Source step, **When** it is shown, **Then** the four sources are offered in the order OpenAPI specification, Guided workflow, Postman collection, Empty plan, each with an icon, its existing description and a one-line "Needs ..." statement.
2. **Given** a source is chosen, **When** the step is shown, **Then** that card is marked by a visible check and by `aria-pressed`, not by colour alone.
3. **Given** a plan exists, **When** the step is shown, **Then** the chosen source stays marked and every other card is disabled, as before.
4. **Given** the entry screen, **When** a source is picked, **Then** it behaves as before and shows no check, because nothing is selected yet.

---

### User Story 2 - Upload like on the start screen (Priority: P1)

For an OpenAPI specification the engineer uploads from a card that has the same anatomy as the start screen's "Upload specification" card.

**Acceptance Scenarios**:

1. **Given** the source is a specification and none was uploaded, **When** the step is shown, **Then** a card shows an accent bar, a header with the title and "OpenAPI 3.x · YAML · up to 10 MB", the heading "Upload specification", the local-processing sentence of the start screen, and the drop area with its icon, "Drag and drop your specification here" and "or click to browse your files".
2. **Given** a specification was uploaded earlier in this session, **When** the step is shown, **Then** the same card shows its name, file name, operation count and "Upload a different specification" in place of the drop area.
3. **Given** the other three sources, **When** the step is shown, **Then** the same card explains the source (existing text) and offers no upload.
4. **Given** any of these, **Then** upload validation, the size limit, error display and the replace confirmation are unchanged (047 FR-023 to FR-025).

---

### User Story 3 - A top area like the other screens (Priority: P2)

The path starts with a plain "← Back to start" link and the boxed stepper used on Import & Run Collection, instead of a bordered header strip.

**Acceptance Scenarios**:

1. **Given** the path, **When** it is shown, **Then** the top row holds "← Back to start", "← Plans", the plan name (or "New performance test") and its draft or saved status, without a surrounding box (047 FR-012 still holds).
2. **Given** the path, **When** the engineer reads the footer, **Then** Back and Next sit in one bar, with the reason Next is unavailable next to Next.

### Edge Cases

- A narrow window shows the cards in one or two columns and the stepper in two; nothing is hidden.
- Dark theme uses only the existing theme tokens.
- A reduced-motion preference removes the colour transitions' effect (the global rule already applies).

## Requirements *(mandatory)*

- **FR-001**: The Source step MUST present the four sources as cards with icon, name, description and a "Needs ..." line (User Story 1).
- **FR-002**: The chosen source MUST be shown by a check and `aria-pressed`; the card MUST remain a button so the entry screen's behaviour is unchanged.
- **FR-003**: The specification upload MUST be presented as a card with the anatomy of the start screen's upload card (User Story 2), with the drop area reachable by keyboard and labelled "Upload OpenAPI specification".
- **FR-004**: The path's top area MUST be a plain "← Back to start" link, the existing stepper, and no bordered header strip; plan name and status MUST stay visible (047 FR-012).
- **FR-005**: The path's footer MUST keep Back and Next and show the reason Next is unavailable (047 FR-009).
- **FR-006**: No behaviour, request, route, contract or shared-domain type MAY change; no stored data is affected.
- **FR-007**: All colour MUST come from the existing design tokens, usable in light and dark, with no new dependency and no new token.

## Success Criteria

- **SC-001**: Every behaviour test of specs/047 for the Source step and the path frame still passes, with at most selector changes where a visible label was reworded.
- **SC-002**: The Source step has no horizontal page scroll at 320 px and no vertical scrollbar appears on the top navigation.

## Assumptions

- The design reference is the reviewed light and dark mock of the Source step; it is not committed.
- The start screen's local-processing sentence is true of the Performance upload too, because it uses the same local upload endpoint and no AI provider.
- The Operations, Plan, Load and Run steps are not restyled by this feature.
